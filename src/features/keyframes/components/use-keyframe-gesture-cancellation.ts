import { useEffect, useRef, type RefObject } from 'react'

/** Cancel retained keyframe gestures only for their nearest editor instance. */
export function useKeyframeGestureCancellation(
  ownerRef: RefObject<Element | null>,
  cancel: (updateReactState: boolean) => void,
) {
  const latest = useRef({ ownerRef, cancel })
  latest.current = { ownerRef, cancel }
  useEffect(() => {
    const onCancel = (event: Event) => {
      const root = latest.current.ownerRef.current?.closest(
        '[data-editor-workspace-shell], [data-freecut-editor-surface], [role="application"]',
      )
      if (root && event.target === root) latest.current.cancel(true)
    }
    window.addEventListener('freecut:cancel-timeline-gesture', onCancel)
    return () => {
      window.removeEventListener('freecut:cancel-timeline-gesture', onCancel)
      latest.current.cancel(false)
    }
  }, [])
}

export function releaseKeyframePointerCapture(target: Element | null, pointerId: number) {
  try {
    target?.releasePointerCapture(pointerId)
  } catch {
    // The browser may already have released capture during hide/unmount.
  }
}
