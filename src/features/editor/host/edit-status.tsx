import { useSyncExternalStore } from 'react'
import type { HostEditorController } from './controller'

/** Recovery retries the exact request, including after an unknown save outcome. */
export function HostEditStatus({ controller }: { controller: HostEditorController }) {
  const state = useSyncExternalStore(
    controller.subscribeTransaction,
    controller.getTransactionState,
    controller.getTransactionState,
  )
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="host-edit-status"
      className="flex shrink-0 items-center justify-end gap-2 px-3 py-1 text-xs text-muted-foreground"
    >
      {state === 'saving'
        ? 'Saving…'
        : state === 'retry'
          ? 'Couldn’t confirm save. Retry before making another edit.'
          : 'Saved'}
      {state === 'retry' && (
        <button
          type="button"
          className="rounded border px-2 py-1 text-foreground"
          onClick={() => {
            void controller.retryPendingEdit().catch(() => undefined)
          }}
        >
          Retry save
        </button>
      )}
    </div>
  )
}
