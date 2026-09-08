/** Keyboard movement in a flat, document-ordered transcript. */
export function transcriptSelectionIndex(
  key: string,
  current: number,
  length: number,
): number | null {
  if (length === 0) return null
  if (key === 'Home') return 0
  if (key === 'End') return length - 1
  const directions: Record<string, number> = {
    ArrowLeft: -1,
    ArrowUp: -1,
    ArrowRight: 1,
    ArrowDown: 1,
  }
  const direction = directions[key]
  if (direction === undefined) return null
  return Math.max(0, Math.min(length - 1, Math.max(0, current) + direction))
}
