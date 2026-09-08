// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { useEffect } from 'react'
const { pause, cancel, actionMounts, actionUnmounts, selection } = vi.hoisted(() => ({
  pause: vi.fn(),
  cancel: vi.fn(),
  actionMounts: vi.fn(),
  actionUnmounts: vi.fn(),
  selection: { selectedItemIds: ['clip-1'] },
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/shared/state/playback', () => ({ usePlaybackStore: { getState: () => ({ pause }) } }))
vi.mock('@/shared/state/selection', () => ({
  useSelectionStore: (select: (s: typeof selection) => unknown) => select(selection),
}))
vi.mock('./media-sidebar', () => ({
  MediaSidebar: ({ transcriptActions }: { transcriptActions: React.ReactNode }) => (
    <>
      <input aria-label="Transcript search" />
      {transcriptActions}
    </>
  ),
}))
vi.mock('./properties-sidebar', () => ({
  PropertiesSidebar: () => <input aria-label="Property" />,
}))
vi.mock('./audio-meter-panel', () => ({ AudioMeterPanel: () => <div>Meter</div> }))
import { EditorWorkspaceShell } from './editor-workspace-shell'
class ResizeObserverMock {
  observe() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverMock)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  selection.selectedItemIds = ['clip-1']
})
function PollingActions() {
  useEffect(() => {
    actionMounts()
    return actionUnmounts
  }, [])
  return <span>Consent pending</span>
}

describe('editor workspace columns', () => {
  it('retains search, pending work and timeline while each column hides; cancels before hiding', () => {
    const onLayoutChange = vi.fn()
    const { container } = render(
      <EditorWorkspaceShell options={{ onLayoutChange, transcriptActions: <PollingActions /> }}>
        <input aria-label="Timeline state" />
      </EditorWorkspaceShell>,
    )
    const search = screen.getByLabelText('Transcript search') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'keep my search' } })
    const editor = container.querySelector<HTMLElement>('[data-editor-column="editor"]')!
    const listener = (event: Event) => {
      expect(editor.style.display).toBe('flex')
      expect(event.target).toBe(container.firstElementChild)
      cancel()
    }
    window.addEventListener('freecut:cancel-timeline-gesture', listener)
    fireEvent.click(screen.getByRole('button', { name: 'editor.refresh.hideLibrary' }))
    expect(onLayoutChange).toHaveBeenLastCalledWith({
      minimumWidth: 480,
      libraryVisible: false,
      editorVisible: true,
    })
    fireEvent.click(screen.getByRole('button', { name: 'editor.refresh.hideEditor' }))
    expect(cancel).toHaveBeenCalledOnce()
    expect(pause).toHaveBeenCalledOnce()
    expect(editor.style.display).toBe('none')
    expect(actionMounts).toHaveBeenCalledOnce()
    expect(actionUnmounts).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'editor.refresh.showLibrary' }))
    expect(onLayoutChange).toHaveBeenLastCalledWith({
      minimumWidth: 260,
      libraryVisible: true,
      editorVisible: false,
    })
    fireEvent.click(screen.getByRole('button', { name: 'editor.refresh.showEditor' }))
    expect(search.value).toBe('keep my search')
    expect(screen.getByLabelText('Timeline state')).toBeTruthy()
    expect(onLayoutChange).toHaveBeenLastCalledWith({
      minimumWidth: 748,
      libraryVisible: true,
      editorVisible: true,
    })
    window.removeEventListener('freecut:cancel-timeline-gesture', listener)
  })
  it('closes stale clip settings and restores trigger focus', () => {
    const { rerender } = render(
      <EditorWorkspaceShell>
        <div />
      </EditorWorkspaceShell>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'editor.refresh.clipSettings' }))
    expect(screen.getByRole('region', { name: 'editor.refresh.settings' })).toBeTruthy()
    selection.selectedItemIds = []
    rerender(
      <EditorWorkspaceShell>
        <div />
      </EditorWorkspaceShell>,
    )
    expect(screen.queryByRole('region', { name: 'editor.refresh.settings' })).toBeNull()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'editor.refresh.canvasSettings' }),
    )
  })
  it('closes stale settings without stealing focus from the host chat', () => {
    const workspace = (
      <>
        <textarea aria-label="Host chat" />
        <EditorWorkspaceShell>
          <div />
        </EditorWorkspaceShell>
      </>
    )
    const { rerender } = render(workspace)
    fireEvent.click(screen.getByRole('button', { name: 'editor.refresh.clipSettings' }))
    const chat = screen.getByRole('textbox', { name: 'Host chat' })
    chat.focus()
    selection.selectedItemIds = []
    rerender(
      <>
        <textarea aria-label="Host chat" />
        <EditorWorkspaceShell>
          <div />
        </EditorWorkspaceShell>
      </>,
    )
    expect(screen.queryByRole('region', { name: 'editor.refresh.settings' })).toBeNull()
    expect(document.activeElement).toBe(chat)
    fireEvent.change(chat, { target: { value: 'continue the draft' } })
    expect(chat).toHaveValue('continue the draft')
  })

  it('resizes with keyboard without resetting the reading state', () => {
    render(
      <EditorWorkspaceShell>
        <div />
      </EditorWorkspaceShell>,
    )
    const separator = screen.getByRole('separator')
    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(separator.getAttribute('aria-valuenow')).toBe('296')
  })
})
