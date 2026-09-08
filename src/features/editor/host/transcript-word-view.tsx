import { transcriptSelectionIndex } from '@/shared/utils/transcript-selection'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { useEditorStore } from '@/shared/state/editor'
import type { EmbeddedEditorHostRuntime } from './runtime'
import type { HostTranscriptRange, HostTranscriptSection } from './contract'
import {
  hostWordSelectionRanges,
  mapHostTranscriptWords,
  type HostWordOccurrence,
} from './transcript-words'

function selectionDurationFrames(words: readonly HostWordOccurrence[]): number {
  const intervals = hostWordSelectionRanges(words)
    .map((range) => {
      const selected = words.filter(
        (word) =>
          word.itemId === range.itemId &&
          word.sourceStartUs >= range.startUs &&
          word.sourceEndUs <= range.endUs,
      )
      return {
        start: Math.min(...selected.map((word) => word.startFrame)),
        end: Math.max(...selected.map((word) => word.endFrame)),
      }
    })
    .sort((a, b) => a.start - b.start)
  let end = 0
  let duration = 0
  for (const interval of intervals) {
    duration += Math.max(0, interval.end - Math.max(end, interval.start))
    end = Math.max(end, interval.end)
  }
  return duration
}

export function HostTranscriptWordView({
  runtime,
  assetId,
  sections,
  query,
  canCut,
  busy,
  onDelete,
}: {
  runtime: EmbeddedEditorHostRuntime
  assetId: string
  sections: readonly HostTranscriptSection[]
  query: string
  canCut: boolean
  busy: boolean
  onDelete: (ranges: HostTranscriptRange[], revision: number) => Promise<void>
}) {
  const [document, setDocument] = useState(() => runtime.controller.getSnapshot().timeline)
  const [scope, setScope] = useState('edit')
  const selectedClips = useSelectionStore((state) => state.selectedItemIds)
  const [selection, setSelection] = useState<{
    anchor: number
    focus: number
    revision: number
    projection: string
  } | null>(null)
  const [following, setFollowing] = useState(true)
  const scroll = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  useEffect(() => () => useEditorStore.getState().setTranscriptEditorShortcutScopeActive(false), [])
  const inFlight = useRef(false)
  const currentFrame = usePlaybackStore((state) => state.currentFrame)
  const playing = usePlaybackStore((state) => state.isPlaying)
  useEffect(
    () => runtime.controller.subscribe((snapshot) => setDocument(snapshot.timeline)),
    [runtime],
  )
  const words = useMemo(
    () =>
      mapHostTranscriptWords(document, assetId, sections).filter(
        (word) => scope === 'edit' || selectedClips.includes(word.itemId),
      ),
    [document, assetId, sections, scope, selectedClips],
  )
  // Pagination can reorder repeated occurrences without changing the timeline revision.
  // Bind indices to the complete measured projection, including retranscribed timings/text.
  const projection = useMemo(() => JSON.stringify(words), [words])
  const otherSources = document.tracks.some((track) =>
    track.items.some((item) => 'mediaId' in item && item.mediaId !== assetId),
  )
  const active = words.findIndex(
    (word) => currentFrame >= word.startFrame && currentFrame < word.endFrame,
  )
  const stale =
    selection !== null &&
    (selection.revision !== document.revision || selection.projection !== projection)
  const selected =
    selection && !stale
      ? words.slice(
          Math.min(selection.anchor, selection.focus),
          Math.max(selection.anchor, selection.focus) + 1,
        )
      : []
  const duration = selectionDurationFrames(selected) / runtime.controller.getSnapshot().project.fps

  useEffect(() => {
    if (following && playing && active >= 0)
      scroll.current
        ?.querySelector(`[data-word-index="${active}"]`)
        ?.scrollIntoView({ block: 'nearest' })
  }, [following, playing, active])
  useEffect(() => {
    const stop = () => {
      dragging.current = false
    }
    window.addEventListener('pointerup', stop)
    return () => window.removeEventListener('pointerup', stop)
  }, [])
  const choose = (index: number, extend: boolean) => {
    setFollowing(false)
    setSelection((previous) => ({
      anchor:
        extend && previous?.revision === document.revision && previous.projection === projection
          ? previous.anchor
          : index,
      focus: index,
      revision: document.revision,
      projection,
    }))
    usePlaybackStore.getState().setCurrentFrame(Math.floor(words[index]!.startFrame))
  }
  const remove = async () => {
    if (!canCut || busy || inFlight.current || selected.length === 0 || !selection || stale) return
    inFlight.current = true
    try {
      await onDelete(hostWordSelectionRanges(selected), selection.revision)
      setSelection(null)
    } finally {
      inFlight.current = false
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="host-transcript-words">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
        <select
          aria-label="Transcript scope"
          value={scope}
          onChange={(event) => {
            setScope(event.target.value)
            setSelection(null)
          }}
          className="min-w-0 max-w-full rounded bg-secondary px-2 py-1"
        >
          <option value="edit">{otherSources ? 'This edit · current source' : 'This edit'}</option>
          <option value="selection">Selected clip</option>
        </select>
        {!following && (
          <Button size="sm" variant="ghost" onClick={() => setFollowing(true)}>
            Resume following
          </Button>
        )}
      </div>
      {otherSources && (
        <p className="px-3 pb-2 text-xs text-muted-foreground">
          Showing this transcript’s source in the current edit. Other source transcripts are not
          included.
        </p>
      )}
      <div
        ref={scroll}
        tabIndex={0}
        role="region"
        aria-label="Timed transcript words"
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2 outline-none"
        onFocus={() => useEditorStore.getState().setTranscriptEditorShortcutScopeActive(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            useEditorStore.getState().setTranscriptEditorShortcutScopeActive(false)
        }}
        onWheel={() => setFollowing(false)}
        onTouchMove={() => setFollowing(false)}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) setFollowing(false)
        }}
        onPointerMove={(event) => {
          if (!dragging.current) return
          const element = globalThis.document
            .elementFromPoint(event.clientX, event.clientY)
            ?.closest<HTMLElement>('[data-word-index]')
          if (element && scroll.current?.contains(element)) {
            const index = Number(element.dataset.wordIndex)
            setSelection((previous) => (previous ? { ...previous, focus: index } : previous))
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Backspace' || event.key === 'Delete') {
            event.preventDefault()
            event.stopPropagation()
            void remove()
          } else if (event.key === 'Escape') {
            event.stopPropagation()
            setSelection(null)
          } else {
            const next = transcriptSelectionIndex(
              event.key,
              stale ? 0 : (selection?.focus ?? 0),
              words.length,
            )
            if (next === null) return
            event.preventDefault()
            event.stopPropagation()
            choose(next, event.shiftKey)
          }
        }}
      >
        {words.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No timed words in {scope === 'selection' ? 'the selected clip' : 'this edit'}.
          </p>
        )}
        <div className="max-w-[62ch] text-sm leading-8">
          {words.map((word, index) => {
            const previous = words[index - 1]
            const paragraph =
              !previous || previous.itemId !== word.itemId || previous.sectionId !== word.sectionId
            const chosen = selected.some((entry) => entry.key === word.key)
            const matches =
              query && word.text.toLocaleLowerCase().includes(query.toLocaleLowerCase())
            return (
              <span key={word.key}>
                {paragraph && (
                  <span className="mt-3 block font-mono text-[11px] text-muted-foreground">
                    {Math.floor(
                      word.startFrame / runtime.controller.getSnapshot().project.fps / 60,
                    )}
                    :
                    {String(
                      Math.floor(word.startFrame / runtime.controller.getSnapshot().project.fps) %
                        60,
                    ).padStart(2, '0')}
                  </span>
                )}
                <button
                  type="button"
                  tabIndex={-1}
                  data-word-index={index}
                  aria-pressed={chosen}
                  aria-current={active === index ? 'true' : undefined}
                  className={`rounded px-0.5 outline-offset-2 ${chosen ? 'bg-primary/20 outline outline-1 outline-primary' : active === index ? 'bg-secondary underline decoration-2' : matches ? 'bg-yellow-500/20' : 'hover:bg-secondary/60'}`}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    dragging.current = true
                    choose(index, event.shiftKey)
                    scroll.current?.focus({ preventScroll: true })
                    scroll.current?.setPointerCapture?.(event.pointerId)
                  }}
                  onClick={(event) => {
                    if (event.detail === 0) choose(index, event.shiftKey)
                  }}
                >
                  {word.text}
                </button>{' '}
              </span>
            )
          })}
        </div>
      </div>
      {stale && (
        <p role="status" className="px-3 py-2 text-xs">
          The edit or transcript changed. Select the words again.
        </p>
      )}
      {!canCut && (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          This host needs occurrence-aware transcript editing before words can be cut.
        </p>
      )}
      <div className="border-t border-border p-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={!canCut || busy || selected.length === 0}
          onClick={() => void remove()}
        >
          Delete selection{selected.length ? ` · ${duration.toFixed(2)}s` : ''}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          Select words, then Backspace or Delete to cut footage and close the gap. Undo restores the
          cut.
        </p>
      </div>
    </div>
  )
}
