import { memo } from 'react'
import { cn } from '@/shared/ui/cn'

interface SharedRollingTrimHandleProps {
  edge: 'start' | 'end'
  editPointFrame: number
  minFrame: number
  maxFrame: number
  leftLabel: string
  rightLabel: string
  onMouseDown: (event: React.MouseEvent, handle: 'start' | 'end') => void
  onKeyboardStep: (handle: 'start' | 'end', deltaFrames: number) => void
}

/**
 * A compact rolling-edit target centered on a real cut. It occupies only the
 * middle of the clip edge so the ordinary full-height trim target remains
 * available above and below it.
 */
export const SharedRollingTrimHandle = memo(function SharedRollingTrimHandle({
  edge,
  editPointFrame,
  minFrame,
  maxFrame,
  leftLabel,
  rightLabel,
  onMouseDown,
  onKeyboardStep,
}: SharedRollingTrimHandleProps) {
  const label = `Rolling trim between ${leftLabel} and ${rightLabel}`

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuemin={Math.round(minFrame)}
      aria-valuemax={Math.round(maxFrame)}
      aria-valuenow={Math.round(editPointFrame)}
      aria-valuetext={`Frame ${Math.round(editPointFrame)}`}
      data-rolling-trim-handle={edge}
      className={cn(
        'absolute top-1/2 z-40 flex h-5 w-3 -translate-y-1/2 items-center justify-center gap-0.5 rounded-sm border border-amber-200/90 bg-slate-950/90 shadow-[0_0_0_1px_rgba(15,23,42,0.8),0_0_8px_rgba(251,191,36,0.5)]',
        'cursor-trim-center touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300',
        edge === 'start' ? 'left-0 -translate-x-1/2' : 'right-0 translate-x-1/2',
      )}
      title={label}
      onMouseDown={(event) => onMouseDown(event, edge)}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        event.stopPropagation()
        onKeyboardStep(edge, event.key === 'ArrowLeft' ? -1 : 1)
      }}
    >
      <span aria-hidden="true" className="h-3 w-px bg-amber-200" />
      <span aria-hidden="true" className="h-3 w-px bg-amber-200" />
    </div>
  )
})
