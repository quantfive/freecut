import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  applyCaptionCommands,
  captionCuePrecondition,
  createCaptionCommandBatch,
  frameCueToCommandCue,
  isCaptionApplySuccess,
  makeCaptionOperationId,
  type CaptionCommandSubmitter,
  type CaptionDocumentPort,
  type CaptionCommandPort,
} from './caption-commands'
import { captionStyleOrDefault, validateFrameCaptionCues } from './caption-validation'
import {
  controlledDocumentToFreeCutDocument,
  type FreeCutFrameCaptionCue,
  type FreeCutFrameDocument,
} from './document'
import {
  CaptionEditorView,
  type CaptionCueDraft,
  type CaptionTrackDraft,
} from './caption-editor-view'
import type { CaptionStyle, EditApplyResult, Precondition } from './contract'
import type { FrameRateLike } from './timing'

export interface CaptionEditorProps {
  /** The frame-document port supplied by the standalone adapter or host surface. */
  adapter: CaptionDocumentPort
  /** Optional async host submission path; omitted for the synchronous local adapter. */
  submit?: CaptionCommandSubmitter
  /** Frame currently shown by the host preview. */
  currentFrame?: number
  /** Host-owned loading state while an authoritative document is being fetched. */
  loading?: boolean
  /** Host-owned load error. Caption mutations are reported in this surface too. */
  error?: string | null
  onRetry?: () => void
  onSeek?: (frame: number) => void
  className?: string
}

const EMPTY_STYLE: CaptionStyle = captionStyleOrDefault(undefined)

function frameRateValue(fps: FrameRateLike): number {
  return typeof fps === 'number' ? fps : fps.value
}

function makeId(prefix: string, existing: ReadonlySet<string>): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  const candidate = `${prefix}-${random}`
  return existing.has(candidate) ? `${prefix}-${Date.now()}` : candidate
}

function snapshotToFrameDocument(adapter: CaptionDocumentPort): FreeCutFrameDocument | null {
  try {
    return controlledDocumentToFreeCutDocument(adapter.getSnapshot().document)
  } catch {
    return null
  }
}

function draftForCue(cue: FreeCutFrameCaptionCue): CaptionCueDraft {
  return {
    start_frame: cue.from,
    end_frame: cue.from + cue.durationInFrames,
    text: cue.text,
    speaker: cue.speaker ?? '',
  }
}

function cueFromDraft(cue: FreeCutFrameCaptionCue, draft: CaptionCueDraft): FreeCutFrameCaptionCue {
  return {
    ...cue,
    from: draft.start_frame,
    durationInFrames: draft.end_frame - draft.start_frame,
    text: draft.text,
    ...(draft.speaker.trim() ? { speaker: draft.speaker.trim() } : { speaker: null }),
  }
}

function resultMessage(result: EditApplyResult): string {
  if (!isCaptionApplySuccess(result)) return result.error.message
  return result.status === 'replayed' ? 'Caption edit replayed safely.' : 'Caption edit applied.'
}

export function CaptionEditor({
  adapter,
  submit,
  currentFrame = 0,
  loading = false,
  error = null,
  onRetry,
  onSeek,
  className,
}: CaptionEditorProps) {
  const [document, setDocument] = useState<FreeCutFrameDocument | null>(() =>
    snapshotToFrameDocument(adapter),
  )
  const [adapterError, setAdapterError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [busy, setBusy] = useState(false)
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null)
  const [editingCueId, setEditingCueId] = useState<string | null>(null)
  const [cueDrafts, setCueDrafts] = useState<Record<string, CaptionCueDraft>>({})
  const [trackDrafts, setTrackDrafts] = useState<Record<string, CaptionTrackDraft>>({})
  const [styleTargetCueId, setStyleTargetCueId] = useState<string | null>(null)
  const [styleDraft, setStyleDraft] = useState<CaptionStyle>(EMPTY_STYLE)

  const syncDocument = useCallback(() => {
    const next = snapshotToFrameDocument(adapter)
    if (next) {
      setDocument(next)
      setAdapterError(null)
    } else {
      setAdapterError('The caption document could not be translated to frame-native data.')
    }
  }, [adapter])

  useEffect(() => {
    syncDocument()
    return adapter.subscribe(syncDocument)
  }, [adapter, syncDocument])

  const tracks = useMemo(
    () => document?.tracks.filter((track) => track.kind === 'caption') ?? [],
    [document],
  )
  const activeTrack = tracks.find((track) => track.id === activeTrackId) ?? tracks[0]
  const activeCue = activeTrack?.items.find(
    (item): item is FreeCutFrameCaptionCue =>
      item.type === 'caption_cue' &&
      currentFrame >= item.from &&
      currentFrame < item.from + item.durationInFrames,
  )
  const durationInFrames = document?.durationInFrames ?? 0
  const fps = document?.fps ?? 30
  const editingTrackDraft = useMemo(
    () =>
      activeTrack
        ? (trackDrafts[activeTrack.id] ?? {
            name: activeTrack.name,
            language: activeTrack.language ?? '',
          })
        : null,
    [activeTrack, trackDrafts],
  )
  const styleTargetCue = activeTrack?.items.find(
    (item): item is FreeCutFrameCaptionCue =>
      item.type === 'caption_cue' && item.id === styleTargetCueId,
  )

  useEffect(() => {
    if (activeTrackId && tracks.some((track) => track.id === activeTrackId)) return
    setActiveTrackId(tracks[0]?.id ?? null)
  }, [activeTrackId, tracks])

  useEffect(() => {
    if (!activeTrack) {
      setStyleTargetCueId(null)
      setStyleDraft(EMPTY_STYLE)
      return
    }
    const target = activeTrack.items.find(
      (item): item is FreeCutFrameCaptionCue =>
        item.type === 'caption_cue' && item.id === styleTargetCueId,
    )
    setStyleDraft(captionStyleOrDefault(target?.style ?? activeTrack.defaultStyle))
  }, [activeTrack, styleTargetCueId])

  const runCommands = useCallback(
    (
      commands: Parameters<typeof applyCaptionCommands>[1],
      preconditions: readonly Precondition[] = [],
    ): Promise<boolean> => {
      if (busy || !document) return Promise.resolve(false)
      setBusy(true)
      setAdapterError(null)
      setAnnouncement('Saving caption edit…')
      const options = {
        operationId: makeCaptionOperationId(),
        preconditions,
      }
      const result = submit
        ? submit(createCaptionCommandBatch(adapter, commands, fps, options))
        : applyCaptionCommands(adapter as CaptionCommandPort, commands, fps, options)
      return Promise.resolve(result)
        .then((applied) => {
          const message = resultMessage(applied)
          if (applied.status === 'rejected') {
            setAdapterError(message)
            setAnnouncement(
              'Caption edit was rejected. Refresh the authoritative revision before retrying.',
            )
            return false
          }
          syncDocument()
          setAnnouncement(message)
          return true
        })
        .catch((caught) => {
          const message = caught instanceof Error ? caught.message : 'Caption edit failed.'
          setAdapterError(message)
          setAnnouncement('Caption edit failed.')
          return false
        })
        .finally(() => setBusy(false))
    },
    [adapter, busy, document, fps, submit, syncDocument],
  )

  const addTrack = useCallback(async () => {
    const ids = new Set(tracks.map((track) => track.id))
    const trackId = makeId('caption-track', ids)
    const applied = await runCommands([
      {
        command_id: makeCaptionOperationId('add-caption-track'),
        type: 'add_caption_track',
        track_id: trackId,
        name: `Captions ${tracks.length + 1}`,
        language: 'en',
        index: document?.tracks.length ?? 0,
      },
    ])
    if (applied) setActiveTrackId(trackId)
  }, [document?.tracks.length, runCommands, tracks])

  const removeTrack = useCallback(async () => {
    if (!activeTrack) return
    await runCommands(
      [
        {
          command_id: makeCaptionOperationId('remove-caption-track'),
          type: 'remove_caption_track',
          track_id: activeTrack.id,
        },
      ],
      [{ type: 'track_exists', track_id: activeTrack.id }],
    )
  }, [activeTrack, runCommands])

  const saveTrack = useCallback(async () => {
    if (!activeTrack || !editingTrackDraft) return
    if (!editingTrackDraft.name.trim() || editingTrackDraft.name.length > 128) {
      setAdapterError('Track name must be non-empty and at most 128 characters.')
      return
    }
    if (editingTrackDraft.language.length > 32) {
      setAdapterError('Track language must be at most 32 characters.')
      return
    }
    await runCommands(
      [
        {
          command_id: makeCaptionOperationId('update-caption-track'),
          type: 'update_caption_track',
          track_id: activeTrack.id,
          name: editingTrackDraft.name.trim(),
          language: editingTrackDraft.language.trim() || 'und',
        },
      ],
      [{ type: 'track_exists', track_id: activeTrack.id }],
    )
  }, [activeTrack, editingTrackDraft, runCommands])

  const toggleDisplay = useCallback(async () => {
    if (!activeTrack) return
    await runCommands(
      [
        {
          command_id: makeCaptionOperationId('toggle-caption-track'),
          type: 'update_track',
          track_id: activeTrack.id,
          muted: !activeTrack.muted,
        },
      ],
      [{ type: 'track_exists', track_id: activeTrack.id }],
    )
  }, [activeTrack, runCommands])

  const addCue = useCallback(async () => {
    if (!activeTrack || durationInFrames < 2) {
      setAdapterError('The timeline is too short to add a caption cue.')
      return
    }
    const cues = activeTrack.items.filter(
      (item): item is FreeCutFrameCaptionCue => item.type === 'caption_cue',
    )
    const startFrame = cues.reduce(
      (latest, cue) => Math.max(latest, cue.from + cue.durationInFrames),
      0,
    )
    const endFrame = Math.min(
      durationInFrames,
      startFrame + Math.max(1, Math.round(frameRateValue(fps))),
    )
    if (endFrame <= startFrame) {
      setAdapterError('There is no bounded space left for another caption cue.')
      return
    }
    const cueId = makeId(`${activeTrack.id}-cue`, new Set(cues.map((cue) => cue.id)))
    const cue: FreeCutFrameCaptionCue = {
      type: 'caption_cue',
      id: cueId,
      trackId: activeTrack.id,
      from: startFrame,
      durationInFrames: endFrame - startFrame,
      text: 'New caption',
    }
    if (validateFrameCaptionCues([...cues, cue], durationInFrames).length > 0) {
      setAdapterError('The new caption cue would exceed the bounded track range.')
      return
    }
    const applied = await runCommands(
      [
        {
          command_id: makeCaptionOperationId('add-caption-cue'),
          type: 'upsert_caption_cues',
          track_id: activeTrack.id,
          cues: [frameCueToCommandCue(cue)],
        },
      ],
      [{ type: 'track_exists', track_id: activeTrack.id }],
    )
    if (applied) {
      setEditingCueId(cueId)
      setCueDrafts((previous) => ({ ...previous, [cueId]: draftForCue(cue) }))
    }
  }, [activeTrack, durationInFrames, fps, runCommands])

  const beginEditCue = useCallback((cue: FreeCutFrameCaptionCue) => {
    setEditingCueId(cue.id)
    setCueDrafts((previous) => ({ ...previous, [cue.id]: previous[cue.id] ?? draftForCue(cue) }))
  }, [])

  const cancelEditCue = useCallback((cueId: string) => {
    setEditingCueId((current) => (current === cueId ? null : current))
  }, [])

  const saveCue = useCallback(
    async (trackId: string, cue: FreeCutFrameCaptionCue) => {
      const draft = cueDrafts[cue.id] ?? draftForCue(cue)
      const nextCue = cueFromDraft(cue, draft)
      const cues =
        tracks
          .find((track) => track.id === trackId)
          ?.items.filter((item): item is FreeCutFrameCaptionCue => item.type === 'caption_cue')
          .map((candidate) => (candidate.id === cue.id ? nextCue : candidate)) ?? []
      const issues = validateFrameCaptionCues(cues, durationInFrames)
      if (issues.length > 0) {
        setAdapterError(issues[0]?.message ?? 'Cue timing is invalid.')
        return
      }
      const applied = await runCommands(
        [
          {
            command_id: makeCaptionOperationId('update-caption-cue'),
            type: 'upsert_caption_cues',
            track_id: trackId,
            cues: [frameCueToCommandCue(nextCue)],
          },
        ],
        [captionCuePrecondition(cue, fps)],
      )
      if (applied) setEditingCueId(null)
    },
    [cueDrafts, durationInFrames, fps, runCommands, tracks],
  )

  const removeCue = useCallback(
    async (trackId: string, cue: FreeCutFrameCaptionCue) => {
      await runCommands(
        [
          {
            command_id: makeCaptionOperationId('remove-caption-cue'),
            type: 'remove_caption_cues',
            track_id: trackId,
            cue_ids: [cue.id],
          },
        ],
        [captionCuePrecondition(cue, fps)],
      )
    },
    [fps, runCommands],
  )

  const applyStyle = useCallback(async () => {
    if (!activeTrack) return
    const cue = styleTargetCue
    await runCommands(
      [
        {
          command_id: makeCaptionOperationId('set-caption-style'),
          type: 'set_caption_style',
          track_id: activeTrack.id,
          cue_ids: cue ? [cue.id] : null,
          style: styleDraft,
        },
      ],
      [
        { type: 'track_exists', track_id: activeTrack.id },
        ...(cue ? [captionCuePrecondition(cue, fps)] : []),
      ],
    )
  }, [activeTrack, fps, runCommands, styleDraft, styleTargetCue])

  const updateTrackDraft = useCallback(
    (patch: Partial<CaptionTrackDraft>) => {
      if (!activeTrack) return
      setTrackDrafts((previous) => ({
        ...previous,
        [activeTrack.id]: {
          name: previous[activeTrack.id]?.name ?? activeTrack.name,
          language: previous[activeTrack.id]?.language ?? activeTrack.language ?? '',
          ...patch,
        },
      }))
    },
    [activeTrack],
  )

  const updateStyleDraft = useCallback((patch: Partial<CaptionStyle>) => {
    setStyleDraft((previous) => ({ ...previous, ...patch }))
  }, [])

  return (
    <CaptionEditorView
      adapterError={adapterError}
      activeCue={activeCue}
      activeTrack={activeTrack}
      activeTrackId={activeTrack?.id ?? activeTrackId}
      announcement={announcement}
      busy={busy}
      className={className}
      currentFrame={currentFrame}
      cueDrafts={cueDrafts}
      document={document}
      editingCueId={editingCueId}
      editingTrackDraft={editingTrackDraft}
      error={error}
      fps={fps}
      loading={loading}
      onAddCue={addCue}
      onAddTrack={addTrack}
      onApplyStyle={applyStyle}
      onBeginEditCue={beginEditCue}
      onCancelEditCue={cancelEditCue}
      onCueDraftChange={(cueId, draft) =>
        setCueDrafts((previous) => ({ ...previous, [cueId]: draft }))
      }
      onRemoveCue={removeCue}
      onRemoveTrack={removeTrack}
      onRetry={onRetry}
      onSaveCue={saveCue}
      onSaveTrack={saveTrack}
      onSeek={onSeek}
      onSelectTrack={(trackId) => {
        setActiveTrackId(trackId)
        setEditingCueId(null)
      }}
      onStyleChange={updateStyleDraft}
      onStyleTargetChange={setStyleTargetCueId}
      onToggleDisplay={toggleDisplay}
      onTrackDraftChange={updateTrackDraft}
      styleDraft={styleDraft}
      styleTargetCueId={styleTargetCueId}
      tracks={tracks}
    />
  )
}
