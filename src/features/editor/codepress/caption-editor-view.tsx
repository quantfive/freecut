import type { CSSProperties } from 'react'
import { Captions, Check, Eye, EyeOff, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/shared/ui/cn'

import { captionStyleOrDefault } from './caption-validation'
import type { CaptionStyle } from './contract'
import type { FreeCutFrameCaptionCue, FreeCutFrameDocument, FreeCutFrameTrack } from './document'
import type { FrameRateLike } from './timing'

export interface CaptionCueDraft {
  start_frame: number
  end_frame: number
  text: string
  speaker: string
}

export interface CaptionTrackDraft {
  name: string
  language: string
}

interface CaptionEditorViewProps {
  adapterError: string | null
  activeCue?: FreeCutFrameCaptionCue
  activeTrack?: FreeCutFrameTrack
  activeTrackId: string | null
  announcement: string
  busy: boolean
  className?: string
  currentFrame: number
  cueDrafts: Record<string, CaptionCueDraft>
  document: FreeCutFrameDocument | null
  editingCueId: string | null
  editingTrackDraft: CaptionTrackDraft | null
  error: string | null
  fps: FrameRateLike
  loading: boolean
  onAddCue: () => void
  onAddTrack: () => void
  onApplyStyle: () => void
  onBeginEditCue: (cue: FreeCutFrameCaptionCue) => void
  onCancelEditCue: (cueId: string) => void
  onCueDraftChange: (cueId: string, draft: CaptionCueDraft) => void
  onRemoveCue: (trackId: string, cue: FreeCutFrameCaptionCue) => void
  onRemoveTrack: () => void
  onRetry?: () => void
  onSaveCue: (trackId: string, cue: FreeCutFrameCaptionCue) => void
  onSaveTrack: () => void
  onSeek?: (frame: number) => void
  onSelectTrack: (trackId: string) => void
  onStyleChange: (patch: Partial<CaptionStyle>) => void
  onStyleTargetChange: (cueId: string | null) => void
  onToggleDisplay: () => void
  onTrackDraftChange: (patch: Partial<CaptionTrackDraft>) => void
  styleDraft: CaptionStyle
  styleTargetCueId: string | null
  tracks: readonly FreeCutFrameTrack[]
}

interface CaptionStyleControlsProps {
  activeTrack: FreeCutFrameTrack
  busy: boolean
  onApplyStyle: () => void
  onStyleChange: (patch: Partial<CaptionStyle>) => void
  onStyleTargetChange: (cueId: string | null) => void
  styleDraft: CaptionStyle
  styleTargetCueId: string | null
}

interface CaptionPreviewProps {
  activeCue?: FreeCutFrameCaptionCue
  activeTrack: FreeCutFrameTrack
  currentFrame: number
  fps: FrameRateLike
}

function frameRateValue(fps: FrameRateLike): number {
  return typeof fps === 'number' ? fps : fps.value
}

function formatFrame(frame: number, fps: FrameRateLike): string {
  const seconds = frame / frameRateValue(fps)
  return `${seconds.toFixed(2)}s · frame ${frame}`
}

function CaptionStyleControls({
  activeTrack,
  busy,
  onApplyStyle,
  onStyleChange,
  onStyleTargetChange,
  styleDraft,
  styleTargetCueId,
}: CaptionStyleControlsProps) {
  const cues = activeTrack.items.filter(
    (item): item is FreeCutFrameCaptionCue => item.type === 'caption_cue',
  )

  return (
    <div
      className="rounded-md border border-border/70 bg-muted/10 p-3"
      data-testid="caption-style-controls"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold">Caption style</h3>
          <p className="text-[11px] text-muted-foreground">
            Apply a default or cue-specific style through the command contract.
          </p>
        </div>
        <select
          aria-label="Caption style target"
          value={styleTargetCueId ?? ''}
          onChange={(event) => onStyleTargetChange(event.target.value || null)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="">Track default</option>
          {cues.map((cue) => (
            <option key={cue.id} value={cue.id}>
              Cue: {cue.text.slice(0, 24)}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label htmlFor="caption-font-family" className="text-[11px]">
            Font
          </Label>
          <Input
            id="caption-font-family"
            value={styleDraft.font_family ?? ''}
            onChange={(event) => onStyleChange({ font_family: event.target.value })}
            className="mt-1 h-8 text-xs"
            maxLength={128}
          />
        </div>
        <div>
          <Label htmlFor="caption-font-size" className="text-[11px]">
            Size
          </Label>
          <Input
            id="caption-font-size"
            type="number"
            min={1}
            max={512}
            step={1}
            value={styleDraft.font_size ?? 42}
            onChange={(event) => onStyleChange({ font_size: Number(event.target.value) })}
            className="mt-1 h-8 text-xs"
          />
        </div>
        <div>
          <Label htmlFor="caption-color" className="text-[11px]">
            Color
          </Label>
          <Input
            id="caption-color"
            type="text"
            value={styleDraft.color ?? '#ffffff'}
            onChange={(event) => onStyleChange({ color: event.target.value })}
            className="mt-1 h-8 text-xs"
            maxLength={128}
          />
        </div>
        <div>
          <Label htmlFor="caption-alignment" className="text-[11px]">
            Alignment
          </Label>
          <select
            id="caption-alignment"
            value={styleDraft.alignment ?? 'center'}
            onChange={(event) =>
              onStyleChange({ alignment: event.target.value as CaptionStyle['alignment'] })
            }
            className="mt-1 flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={onApplyStyle}
        disabled={busy}
      >
        <Check className="mr-1.5 h-3.5 w-3.5" />
        Apply style
      </Button>
    </div>
  )
}

function CaptionPreview({ activeCue, activeTrack, currentFrame, fps }: CaptionPreviewProps) {
  const previewStyle = captionStyleOrDefault(activeCue?.style ?? activeTrack.defaultStyle)

  return (
    <div
      className="rounded-md border border-border/70 bg-background p-3"
      data-testid="caption-preview"
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Preview · {formatFrame(currentFrame, fps)}
      </p>
      <div className="mt-2 flex min-h-14 items-center justify-center rounded bg-black px-4 py-3">
        {activeTrack.muted ? (
          <p className="text-xs text-slate-400">Captions hidden</p>
        ) : activeCue ? (
          <p
            className="max-w-full rounded px-3 py-1 text-center text-sm"
            style={
              {
                fontFamily: previewStyle.font_family,
                fontSize: `${previewStyle.font_size ?? 42}px`,
                color: previewStyle.color,
                backgroundColor: previewStyle.background_color,
                textAlign: previewStyle.alignment,
              } as CSSProperties
            }
          >
            {activeCue.text}
          </p>
        ) : (
          <p className="text-xs text-slate-400">No caption at this frame</p>
        )}
      </div>
    </div>
  )
}

interface CaptionCueRowProps {
  busy: boolean
  cue: FreeCutFrameCaptionCue
  draft: CaptionCueDraft
  durationInFrames: number
  fps: FrameRateLike
  index: number
  isEditing: boolean
  onBeginEdit: () => void
  onCancelEdit: () => void
  onDraftChange: (draft: CaptionCueDraft) => void
  onRemove: () => void
  onSave: () => void
  onSeek?: () => void
}

function CaptionCueRow({
  busy,
  cue,
  draft,
  durationInFrames,
  fps,
  index,
  isEditing,
  onBeginEdit,
  onCancelEdit,
  onDraftChange,
  onRemove,
  onSave,
  onSeek,
}: CaptionCueRowProps) {
  return (
    <li className="rounded-md border border-border/70 p-3" data-testid={`caption-cue-${cue.id}`}>
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          className="min-w-0 text-left"
          onClick={onSeek}
          aria-label={`Seek to cue ${index + 1} at frame ${cue.from}`}
        >
          <span className="block truncate text-xs font-medium">{cue.text || 'Untitled cue'}</span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            {formatFrame(cue.from, fps)} → {formatFrame(cue.from + cue.durationInFrames, fps)}
          </span>
        </button>
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onBeginEdit}
            disabled={busy}
            aria-label={`Edit cue ${index + 1}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            disabled={busy}
            aria-label={`Remove cue ${index + 1}`}
          >
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      </div>
      {isEditing ? (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor={`caption-${cue.id}-start`} className="text-[11px]">
                Start frame
              </Label>
              <Input
                id={`caption-${cue.id}-start`}
                type="number"
                min={0}
                max={durationInFrames}
                step={1}
                value={draft.start_frame}
                onChange={(event) =>
                  onDraftChange({ ...draft, start_frame: Number(event.target.value) })
                }
                className="mt-1 h-8 text-xs"
              />
            </div>
            <div>
              <Label htmlFor={`caption-${cue.id}-end`} className="text-[11px]">
                End frame
              </Label>
              <Input
                id={`caption-${cue.id}-end`}
                type="number"
                min={1}
                max={durationInFrames}
                step={1}
                value={draft.end_frame}
                onChange={(event) =>
                  onDraftChange({ ...draft, end_frame: Number(event.target.value) })
                }
                className="mt-1 h-8 text-xs"
              />
            </div>
          </div>
          <div>
            <Label htmlFor={`caption-${cue.id}-text`} className="text-[11px]">
              Text
            </Label>
            <Textarea
              id={`caption-${cue.id}-text`}
              value={draft.text}
              maxLength={32000}
              onChange={(event) => onDraftChange({ ...draft, text: event.target.value })}
              className="mt-1 min-h-16 text-xs"
            />
          </div>
          <div>
            <Label htmlFor={`caption-${cue.id}-speaker`} className="text-[11px]">
              Speaker (optional)
            </Label>
            <Input
              id={`caption-${cue.id}-speaker`}
              value={draft.speaker}
              maxLength={128}
              onChange={(event) => onDraftChange({ ...draft, speaker: event.target.value })}
              className="mt-1 h-8 text-xs"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancelEdit}
              disabled={busy}
            >
              <X className="mr-1.5 h-3.5 w-3.5" />
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={onSave} disabled={busy}>
              <Check className="mr-1.5 h-3.5 w-3.5" />
              Save cue
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  )
}

interface CaptionCueListProps {
  activeTrack: FreeCutFrameTrack
  busy: boolean
  cueDrafts: Record<string, CaptionCueDraft>
  durationInFrames: number
  editingCueId: string | null
  fps: FrameRateLike
  onAddCue: () => void
  onBeginEditCue: (cue: FreeCutFrameCaptionCue) => void
  onCancelEditCue: (cueId: string) => void
  onCueDraftChange: (cueId: string, draft: CaptionCueDraft) => void
  onRemoveCue: (trackId: string, cue: FreeCutFrameCaptionCue) => void
  onSaveCue: (trackId: string, cue: FreeCutFrameCaptionCue) => void
  onSeek?: (frame: number) => void
}

function CaptionCueList({
  activeTrack,
  busy,
  cueDrafts,
  durationInFrames,
  editingCueId,
  fps,
  onAddCue,
  onBeginEditCue,
  onCancelEditCue,
  onCueDraftChange,
  onRemoveCue,
  onSaveCue,
  onSeek,
}: CaptionCueListProps) {
  const cues = activeTrack.items.filter(
    (item): item is FreeCutFrameCaptionCue => item.type === 'caption_cue',
  )

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold">Cue list</h3>
          <p className="text-[11px] text-muted-foreground">
            {cues.length} cue{cues.length === 1 ? '' : 's'} · {durationInFrames} frame timeline
          </p>
        </div>
        <Button type="button" size="sm" onClick={onAddCue} disabled={busy}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add cue
        </Button>
      </div>
      {cues.length === 0 ? (
        <p
          className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground"
          role="status"
        >
          No cues in this track yet.
        </p>
      ) : (
        <ol
          className="max-h-[28rem] space-y-2 overflow-y-auto"
          aria-label={`${activeTrack.name} cues`}
        >
          {cues.map((cue, index) => (
            <CaptionCueRow
              key={cue.id}
              busy={busy}
              cue={cue}
              draft={
                cueDrafts[cue.id] ?? {
                  start_frame: cue.from,
                  end_frame: cue.from + cue.durationInFrames,
                  text: cue.text,
                  speaker: cue.speaker ?? '',
                }
              }
              durationInFrames={durationInFrames}
              fps={fps}
              index={index}
              isEditing={editingCueId === cue.id}
              onBeginEdit={() => onBeginEditCue(cue)}
              onCancelEdit={() => onCancelEditCue(cue.id)}
              onDraftChange={(draft) => onCueDraftChange(cue.id, draft)}
              onRemove={() => onRemoveCue(activeTrack.id, cue)}
              onSave={() => onSaveCue(activeTrack.id, cue)}
              onSeek={onSeek ? () => onSeek(cue.from) : undefined}
            />
          ))}
        </ol>
      )}
    </>
  )
}

interface CaptionTrackEditorProps {
  activeCue?: FreeCutFrameCaptionCue
  activeTrack: FreeCutFrameTrack
  busy: boolean
  cueDrafts: Record<string, CaptionCueDraft>
  currentFrame: number
  durationInFrames: number
  editingCueId: string | null
  editingTrackDraft: CaptionTrackDraft | null
  fps: FrameRateLike
  onAddCue: () => void
  onApplyStyle: () => void
  onBeginEditCue: (cue: FreeCutFrameCaptionCue) => void
  onCancelEditCue: (cueId: string) => void
  onCueDraftChange: (cueId: string, draft: CaptionCueDraft) => void
  onRemoveCue: (trackId: string, cue: FreeCutFrameCaptionCue) => void
  onSaveCue: (trackId: string, cue: FreeCutFrameCaptionCue) => void
  onSaveTrack: () => void
  onSeek?: (frame: number) => void
  onStyleChange: (patch: Partial<CaptionStyle>) => void
  onStyleTargetChange: (cueId: string | null) => void
  onToggleDisplay: () => void
  onTrackDraftChange: (patch: Partial<CaptionTrackDraft>) => void
  styleDraft: CaptionStyle
  styleTargetCueId: string | null
}

function CaptionTrackEditor({
  activeCue,
  activeTrack,
  busy,
  cueDrafts,
  currentFrame,
  durationInFrames,
  editingCueId,
  editingTrackDraft,
  fps,
  onAddCue,
  onApplyStyle,
  onBeginEditCue,
  onCancelEditCue,
  onCueDraftChange,
  onRemoveCue,
  onSaveCue,
  onSaveTrack,
  onSeek,
  onStyleChange,
  onStyleTargetChange,
  onToggleDisplay,
  onTrackDraftChange,
  styleDraft,
  styleTargetCueId,
}: CaptionTrackEditorProps) {
  return (
    <>
      <div className="grid gap-3 rounded-md border border-border/70 bg-muted/10 p-3 sm:grid-cols-[1fr_8rem_auto]">
        <div>
          <Label htmlFor="caption-track-name" className="text-xs">
            Track name
          </Label>
          <Input
            id="caption-track-name"
            value={editingTrackDraft?.name ?? ''}
            onChange={(event) => onTrackDraftChange({ name: event.target.value })}
            className="mt-1 h-8 text-xs"
            maxLength={128}
          />
        </div>
        <div>
          <Label htmlFor="caption-track-language" className="text-xs">
            Language
          </Label>
          <Input
            id="caption-track-language"
            value={editingTrackDraft?.language ?? ''}
            onChange={(event) => onTrackDraftChange({ language: event.target.value })}
            className="mt-1 h-8 text-xs"
            maxLength={32}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-end"
          onClick={onSaveTrack}
          disabled={busy}
        >
          <Check className="mr-1.5 h-3.5 w-3.5" />
          Save track
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/70 bg-muted/10 px-3 py-2">
        <div className="flex items-center gap-2">
          {activeTrack.muted ? (
            <EyeOff className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          ) : (
            <Eye className="h-4 w-4 text-primary" aria-hidden="true" />
          )}
          <Label htmlFor="caption-display-toggle" className="text-xs font-medium">
            Display captions in preview
          </Label>
        </div>
        <Switch
          id="caption-display-toggle"
          checked={!activeTrack.muted}
          onCheckedChange={onToggleDisplay}
          disabled={busy}
          aria-label="Display captions in preview"
        />
      </div>

      <CaptionStyleControls
        activeTrack={activeTrack}
        busy={busy}
        onApplyStyle={onApplyStyle}
        onStyleChange={onStyleChange}
        onStyleTargetChange={onStyleTargetChange}
        styleDraft={styleDraft}
        styleTargetCueId={styleTargetCueId}
      />

      <CaptionPreview
        activeCue={activeCue}
        activeTrack={activeTrack}
        currentFrame={currentFrame}
        fps={fps}
      />

      <CaptionCueList
        activeTrack={activeTrack}
        busy={busy}
        cueDrafts={cueDrafts}
        durationInFrames={durationInFrames}
        editingCueId={editingCueId}
        fps={fps}
        onAddCue={onAddCue}
        onBeginEditCue={onBeginEditCue}
        onCancelEditCue={onCancelEditCue}
        onCueDraftChange={onCueDraftChange}
        onRemoveCue={onRemoveCue}
        onSaveCue={onSaveCue}
        onSeek={onSeek}
      />
    </>
  )
}

export function CaptionEditorView({
  adapterError,
  activeCue,
  activeTrack,
  activeTrackId,
  announcement,
  busy,
  className,
  currentFrame,
  cueDrafts,
  document,
  editingCueId,
  editingTrackDraft,
  error,
  fps,
  loading,
  onAddCue,
  onAddTrack,
  onApplyStyle,
  onBeginEditCue,
  onCancelEditCue,
  onCueDraftChange,
  onRemoveCue,
  onRemoveTrack,
  onRetry,
  onSaveCue,
  onSaveTrack,
  onSeek,
  onSelectTrack,
  onStyleChange,
  onStyleTargetChange,
  onToggleDisplay,
  onTrackDraftChange,
  styleDraft,
  styleTargetCueId,
  tracks,
}: CaptionEditorViewProps) {
  if (loading) {
    return (
      <section
        className={cn('rounded-lg border border-border bg-card p-4', className)}
        data-testid="caption-editor-loading"
        aria-busy="true"
      >
        <p className="text-sm text-muted-foreground" role="status">
          Loading captions…
        </p>
      </section>
    )
  }

  if (error || adapterError || !document) {
    return (
      <section
        className={cn('rounded-lg border border-destructive/40 bg-card p-4', className)}
        data-testid="caption-editor-error"
        role="alert"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Captions unavailable</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {error ?? adapterError ?? 'The caption document could not be loaded.'}
            </p>
          </div>
          {onRetry ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Retry
            </Button>
          ) : null}
        </div>
      </section>
    )
  }

  return (
    <section
      className={cn(
        'flex min-h-0 flex-col gap-4 rounded-lg border border-border bg-card p-4',
        className,
      )}
      data-testid="caption-editor"
      aria-label="Caption editor"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Captions className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Captions</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Frame-aligned cues are saved through the controlled command contract.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={onAddTrack}
          disabled={busy}
          data-testid="caption-add-track"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add track
        </Button>
      </div>

      <p className="sr-only" aria-live="polite" data-testid="caption-editor-announcement">
        {announcement}
      </p>

      {tracks.length === 0 ? (
        <div
          className="rounded-md border border-dashed border-border p-6 text-center"
          data-testid="caption-editor-empty"
          role="status"
        >
          <Captions className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 text-sm font-medium">No caption tracks yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add a track to begin editing timed captions.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={onAddTrack}
            disabled={busy}
          >
            Add caption track
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[12rem] flex-1">
              <Label htmlFor="caption-track-select" className="text-xs">
                Caption track
              </Label>
              <select
                id="caption-track-select"
                value={activeTrackId ?? ''}
                onChange={(event) => onSelectTrack(event.target.value)}
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                {tracks.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.name} · {track.language ?? 'und'}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRemoveTrack}
              disabled={busy || !activeTrack}
              aria-label="Remove selected caption track"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Remove track
            </Button>
          </div>

          {activeTrack ? (
            <CaptionTrackEditor
              activeCue={activeCue}
              activeTrack={activeTrack}
              busy={busy}
              cueDrafts={cueDrafts}
              currentFrame={currentFrame}
              durationInFrames={document.durationInFrames}
              editingCueId={editingCueId}
              editingTrackDraft={editingTrackDraft}
              fps={fps}
              onAddCue={onAddCue}
              onApplyStyle={onApplyStyle}
              onBeginEditCue={onBeginEditCue}
              onCancelEditCue={onCancelEditCue}
              onCueDraftChange={onCueDraftChange}
              onRemoveCue={onRemoveCue}
              onSaveCue={onSaveCue}
              onSaveTrack={onSaveTrack}
              onSeek={onSeek}
              onStyleChange={onStyleChange}
              onStyleTargetChange={onStyleTargetChange}
              onToggleDisplay={onToggleDisplay}
              onTrackDraftChange={onTrackDraftChange}
              styleDraft={styleDraft}
              styleTargetCueId={styleTargetCueId}
            />
          ) : null}
        </>
      )}
    </section>
  )
}
