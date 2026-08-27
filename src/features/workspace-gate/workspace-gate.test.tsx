import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const harness = vi.hoisted(() => ({
  bootstrapWorkspace: vi.fn(),
  autoPurgeExpiredTrash: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  setWorkspaceRoot: vi.fn(),
}))

vi.mock('@/infrastructure/storage/handles-db', () => ({
  ensureKnownWorkspaceForCurrent: vi.fn(async () => undefined),
  getWorkspaceHandleRecord: vi.fn(async () => ({
    handle: { name: 'QA workspace' },
    name: 'QA workspace',
  })),
  isFileSystemAccessSupported: vi.fn(() => true),
  queryHandlePermission: vi.fn(async () => 'granted'),
  requestHandlePermission: vi.fn(async () => 'granted'),
  saveWorkspaceHandleRecord: vi.fn(async () => undefined),
}))
vi.mock('@/infrastructure/storage/workspace-fs/root', () => ({
  onPermissionLost: vi.fn(() => () => undefined),
  setWorkspaceRoot: harness.setWorkspaceRoot,
}))
vi.mock('@/infrastructure/storage/workspace-fs/bootstrap', () => ({
  bootstrapWorkspace: harness.bootstrapWorkspace,
}))
vi.mock('./deps/trash-auto-purge', () => ({
  autoPurgeExpiredTrash: harness.autoPurgeExpiredTrash,
}))
vi.mock('./use-pathname', () => ({ usePathname: () => '/projects' }))
vi.mock('./workspace-gate-splash', () => ({ WorkspaceGateSplash: () => <div>splash</div> }))
vi.mock('@/shared/logging/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: harness.loggerWarn,
    error: harness.loggerError,
  }),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import { WorkspaceGate } from './workspace-gate'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('WorkspaceGate activation lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('aborts and settles owned bootstrap work on unmount without scheduling follow-up work', async () => {
    const bootstrap = deferred()
    let observedSignal: AbortSignal | undefined
    harness.bootstrapWorkspace.mockImplementation(
      (_handle: FileSystemDirectoryHandle, options?: { signal?: AbortSignal }) => {
        observedSignal = options?.signal
        return bootstrap.promise
      },
    )

    const view = render(
      <WorkspaceGate>
        <div>ready</div>
      </WorkspaceGate>,
    )
    await waitFor(() => expect(harness.bootstrapWorkspace).toHaveBeenCalledTimes(1))

    view.unmount()
    expect(observedSignal?.aborted).toBe(true)

    await act(async () => {
      bootstrap.resolve()
      await bootstrap.promise
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(harness.autoPurgeExpiredTrash).not.toHaveBeenCalled()
    expect(harness.loggerWarn).not.toHaveBeenCalled()
    expect(harness.loggerError).not.toHaveBeenCalled()
  })

  it('keeps a genuine bootstrap failure visible as one warning', async () => {
    harness.bootstrapWorkspace.mockRejectedValue(new Error('disk failed'))
    render(
      <WorkspaceGate>
        <div>ready</div>
      </WorkspaceGate>,
    )

    await waitFor(() => expect(harness.loggerWarn).toHaveBeenCalledTimes(1))
    expect(harness.loggerWarn).toHaveBeenCalledWith(
      'bootstrapWorkspace failed',
      expect.objectContaining({ message: 'disk failed' }),
    )
    expect(harness.loggerError).not.toHaveBeenCalled()
  })
})
