import { useLayoutEffect, useState, type RefObject } from 'react'

export const MOBILE_EDITOR_MAX_WIDTH = 767

export function useCompactEditorLayout(rootRef: RefObject<HTMLElement | null>): boolean {
  const [compact, setCompact] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= MOBILE_EDITOR_MAX_WIDTH,
  )

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return

    const update = (width: number) => {
      const nextCompact = width <= MOBILE_EDITOR_MAX_WIDTH
      setCompact((current) => (current === nextCompact ? current : nextCompact))
    }

    update(root.getBoundingClientRect().width || root.clientWidth || window.innerWidth)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) update(entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width)
    })
    observer.observe(root)
    return () => observer.disconnect()
  }, [rootRef])

  return compact
}
