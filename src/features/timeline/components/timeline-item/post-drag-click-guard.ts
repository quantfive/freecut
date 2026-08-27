let removePendingClickOwnership: (() => void) | null = null

function clearPendingClickOwnership() {
  removePendingClickOwnership?.()
  removePendingClickOwnership = null
}

/**
 * Own the browser-generated click that immediately follows a completed mouse
 * gesture. A later independent click always starts with another mousedown,
 * which clears the ownership before that click can be dispatched.
 */
export function suppressPostTimelineGestureClick(): void {
  clearPendingClickOwnership()
  if (typeof document === 'undefined') return

  const handleIndependentMouseDown = () => {
    clearPendingClickOwnership()
  }
  const handleClick = (event: MouseEvent) => {
    // Keyboard activation and HTMLElement.click() do not belong to the mouse
    // gesture and must remain available.
    if (event.detail === 0) return

    clearPendingClickOwnership()
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
  }

  removePendingClickOwnership = () => {
    document.removeEventListener('mousedown', handleIndependentMouseDown, true)
    document.removeEventListener('click', handleClick, true)
  }
  document.addEventListener('mousedown', handleIndependentMouseDown, true)
  document.addEventListener('click', handleClick, true)
}

export function resetPostTimelineGestureClickForTest(): void {
  clearPendingClickOwnership()
}
