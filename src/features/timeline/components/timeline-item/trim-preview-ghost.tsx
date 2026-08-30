import type { CSSProperties } from 'react'

interface TrimPreviewGhostProps {
  handle: 'start' | 'end'
  deltaFrames: number
  constrained: boolean
  visualWidthFrames: number
}

/**
 * Lightweight, non-interactive trim affordance. The clip geometry already
 * shows the projected edge; this mask keeps the old/new boundary legible while
 * the program monitor is still decoding the replacement frame.
 */
export function TrimPreviewGhost({
  handle,
  deltaFrames,
  constrained,
  visualWidthFrames,
}: TrimPreviewGhostProps) {
  if (deltaFrames === 0) return null

  const edge = handle === 'start' ? 'left' : 'right'
  const maskWidth = Math.min(
    45,
    Math.max(6, (Math.abs(deltaFrames) / Math.max(1, visualWidthFrames)) * 100),
  )
  const tone = constrained ? 'rgba(251, 191, 36, 0.3)' : 'rgba(251, 146, 60, 0.25)'
  const edgeStyle: CSSProperties = {
    [edge]: 0,
    width: `${maskWidth}%`,
    background: `linear-gradient(${handle === 'start' ? '90deg' : '270deg'}, ${tone}, transparent)`,
  }

  return (
    <div
      aria-hidden="true"
      data-trim-preview-mask
      data-trim-preview-constrained={constrained ? 'true' : undefined}
      className="pointer-events-none absolute inset-y-0 z-[18] border-orange-200/70"
      style={{
        ...edgeStyle,
        [handle === 'start' ? 'borderRightWidth' : 'borderLeftWidth']: '1px',
      }}
    >
      <div
        data-trim-preview-ghost
        data-trim-preview-delta={`${deltaFrames > 0 ? '+' : ''}${deltaFrames}f`}
        className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded-sm border border-white/30 bg-slate-950/75 px-1 py-0.5 text-[9px] font-medium text-white shadow-sm"
        style={{ [handle === 'start' ? 'left' : 'right']: 'calc(100% + 4px)' }}
      >
        {deltaFrames > 0 ? '+' : ''}
        {deltaFrames}f
      </div>
    </div>
  )
}
