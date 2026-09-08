import { useEffect, useRef, type RefObject } from 'react'

/** Retained editors cancel gestures without unmounting their timeline. */
export function useTimelineGestureCancellation(
  ownerRef: RefObject<HTMLElement | null> | undefined,
  cancel: (updateReactState: boolean) => void,
) {
  const latest = useRef({ ownerRef, cancel })
  latest.current = { ownerRef, cancel }

  useEffect(() => {
    const onCancel = (event: Event) => {
      const owner = latest.current.ownerRef?.current
      const root = owner?.closest(
        '[data-editor-workspace-shell], [data-freecut-editor-surface], [role="application"]',
      )
      // No owner is not permission to cancel another editor's gesture.
      if (!root || event.target !== root) return
      latest.current.cancel(true)
    }
    window.addEventListener('freecut:cancel-timeline-gesture', onCancel)
    return () => {
      window.removeEventListener('freecut:cancel-timeline-gesture', onCancel)
      latest.current.cancel(false)
    }
  }, [])
}
