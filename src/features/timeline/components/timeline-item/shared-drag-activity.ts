import { useSelectionStore } from '@/shared/state/selection'

type DragActivityListener = (isDragActive: boolean) => void

const listeners = new Set<DragActivityListener>()
let isDragActiveSnapshot = false
let unsubscribeSelectionStore: (() => void) | null = null

function publishDragActivity(isDragActive: boolean): void {
  if (isDragActive === isDragActiveSnapshot) return
  isDragActiveSnapshot = isDragActive
  for (const listener of listeners) listener(isDragActive)
}

function connectSelectionStore(): void {
  if (unsubscribeSelectionStore) return
  isDragActiveSnapshot = !!useSelectionStore.getState().dragState?.isDragging
  unsubscribeSelectionStore = useSelectionStore.subscribe((state) => {
    publishDragActivity(!!state.dragState?.isDragging)
  })
}

function disconnectSelectionStoreIfIdle(): void {
  if (listeners.size > 0 || !unsubscribeSelectionStore) return
  unsubscribeSelectionStore()
  unsubscribeSelectionStore = null
}

/**
 * Shares one raw selection-store subscription across every mounted timeline
 * item. Selection changes now invoke one cheap drag-state check instead of one
 * callback per clip; listeners only fan out when drag activity actually flips.
 */
export function subscribeSelectionDragActivity(listener: DragActivityListener): () => void {
  listeners.add(listener)
  connectSelectionStore()
  listener(isDragActiveSnapshot)

  return () => {
    listeners.delete(listener)
    disconnectSelectionStoreIfIdle()
  }
}
