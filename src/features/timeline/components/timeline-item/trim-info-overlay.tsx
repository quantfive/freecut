import { useState, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'

/**
 * Floating timecode readout shown above a clip edge during a trim gesture.
 *
 * Rendered into a body portal so it escapes the clip's `contain: paint` box and
 * is positioned against the live `getBoundingClientRect()` of `anchorRef`.
 * `measureKey` forces a reposition whenever the anchored geometry changes.
 */
export function TrimInfoOverlay({
  anchorRef,
  side,
  delta,
  duration,
  boundary,
  remaining,
  constraintLabel,
  measureKey,
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>
  side: 'start' | 'end'
  delta: string
  duration: string
  boundary?: string
  remaining?: string
  constraintLabel?: string | null
  measureKey: string
}) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return

    const rect = anchor.getBoundingClientRect()
    const x = side === 'start' ? rect.left : rect.right
    setPosition({
      x: Math.max(164, Math.min(window.innerWidth - 164, x)),
      y: Math.max(4, rect.top - 6),
    })
  }, [anchorRef, side])

  useLayoutEffect(() => {
    updatePosition()
    const rafId = window.requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [measureKey, updatePosition])

  if (!position) return null

  return createPortal(
    <div
      data-trim-feedback=""
      className="pointer-events-none fixed z-[10000] min-w-[160px] rounded-sm bg-neutral-950/90 px-2 py-1.5 text-center font-mono text-xs font-semibold leading-tight text-white shadow-[0_2px_8px_rgba(0,0,0,0.45)] ring-1 ring-white/15 tabular-nums"
      style={{
        left: position.x,
        top: position.y,
        transform:
          side === 'start' ? 'translate(-2px, -100%)' : 'translate(calc(-100% + 2px), -100%)',
      }}
    >
      <div>
        {side === 'start' ? 'Start' : 'End'} {boundary} · {delta}
      </div>
      <div className="text-white/80">Duration {duration}</div>
      {remaining !== undefined && <div className="text-white/80">Source remaining {remaining}</div>}
      {constraintLabel && (
        <div className="text-amber-200">
          {constraintLabel === 'no handle' ? 'Source limit reached' : constraintLabel}
        </div>
      )}
      <div className="mt-1 text-white/80">Esc to cancel</div>
    </div>,
    document.body,
  )
}
