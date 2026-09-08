import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useSelectionStore } from '@/shared/state/selection'
import { usePlaybackStore } from '@/shared/state/playback'
import { useEditorStore } from '@/shared/state/editor'
import { makeCaptionOperationId } from '../codepress/caption-commands'
import { HostCaptionEditor } from './caption-editor-context'
import {
  captionRangesForEdit,
  loadCaptionSections,
  validateCaptionPreview,
  captionStatusOrThrow,
  assertCaptionTargetAvailable,
  replaceGeneratedCaptionCues,
} from './caption-generation'
import { useEditorCapability, useEditorHostContext } from './context'
import type { HostTranscriptCommandPreview, HostTranscriptCommandPreviewRequest } from './contract'
import { useHostTranscriptEditorRuntime } from './transcript-editor-context'

/** Focused Library tool: generation previews never modify footage. */
export function HostCaptionLibrary() {
  const { host, mode } = useEditorHostContext()
  const runtime = useHostTranscriptEditorRuntime()
  const canCaption = useEditorCapability('timeline.caption')
  const selectedIds = useSelectionStore((state) => state.selectedItemIds)
  const [scope, setScope] = useState('edit')
  const [replaceAll, setReplaceAll] = useState(false)
  const [hasGeneratedTrack, setHasGeneratedTrack] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  const [preview, setPreview] = useState<HostTranscriptCommandPreview | null>(null)
  const requestGeneration = useRef(0)
  const port = host?.transcript

  useEffect(() => {
    const unsubscribe = useSelectionStore.subscribe((state, previous) => {
      if (state.selectedItemIds !== previous.selectedItemIds) {
        requestGeneration.current += 1
        setPreview(null)
      }
    })
    return () => {
      requestGeneration.current += 1
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!runtime) return
    const sync = () => {
      setPreview(null)
      setReplaceAll(false)
      setHasGeneratedTrack(
        runtime.controller
          .getSnapshot()
          .timeline.tracks.some((track) => track.id === 'host-transcript-captions'),
      )
    }
    sync()
    return runtime.controller.subscribe(sync)
  }, [runtime])
  useEffect(() => setPreview(null), [scope, selectedIds])

  async function prepare() {
    if (!port || !runtime || busy) return
    const generation = ++requestGeneration.current
    const assertCurrentRequest = () => {
      if (generation !== requestGeneration.current)
        throw new Error(
          'The selection changed while captions were loading. Preview again using the current selection.',
        )
    }
    setBusy(true)
    setError(false)
    setPreview(null)
    setMessage('Loading the edited transcript…')
    try {
      const status = captionStatusOrThrow(await port.getStatus())
      assertCurrentRequest()
      const snapshot = runtime.controller.getSnapshot()
      assertCaptionTargetAvailable(snapshot.timeline, replaceAll)
      const sections = await loadCaptionSections(port, status.transcriptId)
      assertCurrentRequest()
      const ranges = captionRangesForEdit(
        snapshot.timeline,
        status.assetId,
        sections,
        scope === 'selected' ? new Set(selectedIds) : undefined,
      )
      const request: HostTranscriptCommandPreviewRequest = {
        transcriptId: status.transcriptId,
        assetId: status.assetId,
        sourceAssetHash: status.sourceAssetHash,
        operationId: makeCaptionOperationId('caption-preview'),
        idempotencyKey: makeCaptionOperationId('caption-preview-key'),
        baseRevision: snapshot.timeline.revision,
        action: 'captions',
        timestampCapability: 'section',
        ranges,
        captionTrackId: 'host-transcript-captions',
        captionTrackName: 'Transcript captions',
        captionLanguage: status.language,
      }
      const validated = validateCaptionPreview(
        await port.previewCommands(request),
        request,
        snapshot.timeline.timelineId,
      )
      assertCurrentRequest()
      if (runtime.controller.getSnapshot().timeline.revision !== snapshot.timeline.revision)
        throw new Error(
          'The edit changed while captions were loading. Preview again using the latest edit.',
        )
      setPreview(replaceGeneratedCaptionCues(validated, request, snapshot.timeline))
      setMessage(
        'Review the cues below. Apply replaces the generated caption track in one undoable edit.',
      )
    } catch (caught) {
      setError(true)
      setMessage(
        caught instanceof Error ? caught.message : 'Could not prepare captions. Retry preview.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!runtime || !preview || busy) return
    setBusy(true)
    setError(false)
    setMessage('Applying captions…')
    try {
      const result = await runtime.controller.submitEdit(preview.commandBatch)
      if (result.status !== 'applied' && result.status !== 'replayed')
        throw new Error(
          result.status === 'unsupported'
            ? result.reason
            : 'Caption apply did not complete. Preview again using the latest edit.',
        )
      setPreview(null)
      setMessage(
        'Captions applied. Use Undo to restore the previous captions. Text corrections here never cut footage.',
      )
    } catch (caught) {
      setError(true)
      setMessage(
        caught instanceof Error
          ? caught.message
          : 'Could not apply captions. Preview again to retry.',
      )
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  const available = canCaption && port?.occurrenceSelection === true
  const cues =
    preview?.commandBatch.commands.flatMap((command) =>
      command.type === 'upsert_caption_cues' ? command.cues : [],
    ) ?? []
  return (
    <div className="min-w-0 space-y-4 p-3" data-testid="caption-library">
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Create captions</h2>
        <p className="text-xs text-muted-foreground">
          Captions display text in your video. Create them from the words remaining in this edit,
          then adjust their text and style below.
        </p>
        <label className="block text-xs">
          Caption scope
          <select
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2"
            value={scope}
            onChange={(event) => {
              requestGeneration.current += 1
              setScope(event.target.value)
            }}
            disabled={busy}
          >
            <option value="edit">This edit</option>
            <option value="selected">Selected clip</option>
          </select>
        </label>
        {!available && (
          <p role="status" className="text-xs text-muted-foreground">
            {mode === 'local'
              ? 'For local media, open Transcript to generate timing. Select a clip and use Generate Captions in its context menu; caption styling is available in Clip settings.'
              : !port
                ? 'This host does not provide a transcript. Caption tracks can still be edited below when supported.'
                : 'This host needs support for captions bound to edited clip occurrences. Caption creation is unavailable until the host is updated.'}
          </p>
        )}
        {hasGeneratedTrack && (
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={replaceAll}
              disabled={busy}
              onChange={(event) => {
                setReplaceAll(event.target.checked)
                setPreview(null)
              }}
            />
            Replace all cues in “Transcript captions”, including manual corrections. Other tracks
            stay unchanged.
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={
              !available ||
              busy ||
              (hasGeneratedTrack && !replaceAll) ||
              (scope === 'selected' && !selectedIds.length)
            }
            onClick={() => void prepare()}
          >
            {busy ? 'Working…' : 'Preview captions'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => useEditorStore.getState().setActiveTab('transcript')}
          >
            Open Transcript
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Uses the host’s current transcript asset. Existing captions follow supported footage cuts.
          Preview again to replace generated captions from the current transcript.
        </p>
      </div>
      {message && (
        <p role={error ? 'alert' : 'status'} className="text-xs">
          {message}
        </p>
      )}
      {preview && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <h3 className="text-xs font-semibold">{cues.length} cues ready · footage unchanged</h3>
          <ul className="max-h-48 space-y-2 overflow-auto">
            {cues.map((cue) => (
              <li key={cue.cue_id} className="text-xs">
                <button
                  className="text-left hover:underline"
                  onClick={() => {
                    const fps = runtime!.controller.getSnapshot().timeline.fps
                    usePlaybackStore
                      .getState()
                      .setCurrentFrame(
                        Math.round(
                          (cue.start_us / 1_000_000) * (typeof fps === 'number' ? fps : fps.value),
                        ),
                      )
                  }}
                >
                  <span className="text-muted-foreground">
                    {(cue.start_us / 1_000_000).toFixed(2)}–{(cue.end_us / 1_000_000).toFixed(2)}s
                  </span>{' '}
                  {cue.text}
                </button>
              </li>
            ))}
          </ul>
          <Button size="sm" disabled={busy} onClick={() => void apply()}>
            Apply captions
          </Button>
        </div>
      )}
      <HostCaptionEditor />
      <p className="text-xs text-muted-foreground">
        Visible caption tracks appear in the video preview and rendered video. Check captions across
        each cut before exporting.
      </p>
    </div>
  )
}
