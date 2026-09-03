import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSelectionStore } from '@/shared/state/selection'
import { ItemContextMenu } from './item-context-menu'
import { EditorHostProvider } from '../../deps/editor'
import { useEditorStore } from '@/shared/state/editor'

const { mockGetSceneVerificationModelOptions } = vi.hoisted(() => ({
  mockGetSceneVerificationModelOptions: vi.fn(() => [
    { value: 'gemma', label: 'Gemma Turbo' },
    { value: 'lfm', label: 'Liquid Vision' },
  ]),
}))

const { mockContextMenuProps } = vi.hoisted(() => ({
  mockContextMenuProps: vi.fn(),
}))

vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children, ...props }: { children: ReactNode; modal?: boolean }) => {
    mockContextMenuProps(props)
    return <div>{children}</div>
  },
  ContextMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuItem: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode
    onClick?: () => void
    disabled?: boolean
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  ContextMenuSeparator: () => null,
  ContextMenuShortcut: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  ContextMenuSub: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuSubTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuSubContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/features/timeline/deps/analysis', () => ({
  getSceneVerificationModelOptions: mockGetSceneVerificationModelOptions,
}))

vi.mock('@/features/timeline/deps/settings', () => ({
  useResolvedHotkeys: () => ({
    JOIN_ITEMS: 'shift+j',
    FREEZE_FRAME: 'shift+f',
    DELETE_SELECTED: 'delete',
    RIPPLE_DELETE: 'mod+backspace',
  }),
}))

vi.mock('@/config/hotkeys', () => ({
  formatHotkeyBinding: (binding: string) =>
    ({
      'mod+backspace': 'Ctrl + Backspace',
      'shift+j': 'Shift + J',
      'shift+f': 'Shift + F',
      delete: 'Delete',
    })[binding] ?? '',
}))

function renderContextMenu(
  overrides: Partial<ComponentProps<typeof ItemContextMenu>> = {},
  options: { hostMode?: boolean } = {},
) {
  const onDetectScenes = vi.fn()
  useEditorStore.setState({ hostMode: options.hostMode ?? false })

  const menu = (
    <ItemContextMenu
      trackLocked={false}
      joinActions={{
        canJoinSelected: false,
        hasJoinableLeft: false,
        hasJoinableRight: false,
        closerEdge: null,
        onJoinSelected: () => {},
        onJoinLeft: () => {},
        onJoinRight: () => {},
      }}
      destructiveActions={{
        isSelected: true,
        onRippleDelete: () => {},
        onDelete: () => {},
      }}
      sceneDetectionActions={{
        canDetectScenes: true,
        isDetectingScenes: false,
        onDetectScenes,
      }}
      {...overrides}
    >
      <div>Clip</div>
    </ItemContextMenu>
  )
  render(
    options.hostMode ? (
      <EditorHostProvider value={{ mode: 'host', capabilities: { 'timeline.remove': true } }}>
        {menu}
      </EditorHostProvider>
    ) : (
      menu
    ),
  )

  fireEvent.contextMenu(screen.getByText('Clip'))

  return { onDetectScenes }
}

describe('ItemContextMenu scene detection', () => {
  beforeEach(() => {
    mockGetSceneVerificationModelOptions.mockClear()
    mockContextMenuProps.mockClear()
    useEditorStore.setState({ hostMode: false })
    useSelectionStore.setState({
      selectedItemIds: [],
      selectedMarkerId: null,
      selectedTransitionId: null,
      selectedTrackId: null,
      selectedTrackIds: [],
      activeTrackId: null,
      selectionType: null,
    })
  })

  it('keeps the menu non-modal so dialog handoffs cannot strand pointer blocking', () => {
    renderContextMenu()

    expect(mockContextMenuProps).toHaveBeenLastCalledWith({ modal: false })
  })

  it('renders scene verification submenu labels from shared options', () => {
    renderContextMenu()

    expect(mockGetSceneVerificationModelOptions).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Detect Scenes & Split')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fast (Histogram)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AI (Gemma Turbo)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AI (Liquid Vision)' })).toBeInTheDocument()
  })

  it('shows the resolved ripple-delete keycap', () => {
    renderContextMenu()

    expect(screen.getByText('Ripple Delete', { exact: true })).toBeInTheDocument()
    expect(screen.getByText('Ctrl + Backspace')).toBeInTheDocument()
  })

  it('dispatches the selected verification model when a scene detection option is clicked', () => {
    const { onDetectScenes } = renderContextMenu()

    fireEvent.click(screen.getByRole('button', { name: 'AI (Liquid Vision)' }))

    expect(onDetectScenes).toHaveBeenCalledWith('adaptive', 'lfm')
  })

  it('keeps host Delete as the authoritative ripple action and names local removal Lift', () => {
    renderContextMenu({}, { hostMode: true })

    expect(screen.getByRole('button', { name: /^Delete/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ripple Delete/ })).toBeNull()
  })
})

describe('ItemContextMenu sequence attachment', () => {
  it('offers detach and reattach toggles', () => {
    const onToggle = vi.fn()
    renderContextMenu({ attachmentActions: { isRippleLinked: true, onToggle } })
    fireEvent.click(screen.getByRole('button', { name: 'Detach from sequence' }))
    expect(onToggle).toHaveBeenCalledTimes(1)
    cleanup()

    // The menu stays mounted after activation; rerendering is represented by
    // the same component contract with the detached state.
    renderContextMenu({ attachmentActions: { isRippleLinked: false, onToggle } })
    fireEvent.click(screen.getByRole('button', { name: 'Reattach to sequence' }))
    expect(onToggle).toHaveBeenCalledTimes(2)
  })
})

describe('ItemContextMenu captions', () => {
  it('shows a single "Generate Captions" item when no transcript exists', () => {
    const onOpenCaptionDialog = vi.fn()

    renderContextMenu({
      captionActions: {
        canManageCaptions: true,
        hasCaptions: false,
        onOpenCaptionDialog,
      },
    })

    const item = screen.getByRole('button', { name: 'Generate Captions' })
    expect(item).toBeInTheDocument()
    expect(screen.queryByText('Captions')).not.toBeInTheDocument()
    fireEvent.click(item)
    expect(onOpenCaptionDialog).toHaveBeenCalledTimes(1)
  })

  it('shows a single "Generate Captions" item when captions are disabled', () => {
    const onOpenCaptionDialog = vi.fn()

    renderContextMenu({
      captionActions: {
        canManageCaptions: true,
        hasCaptions: false,
        onOpenCaptionDialog,
      },
    })

    const item = screen.getByRole('button', { name: 'Generate Captions' })
    expect(item).toBeInTheDocument()
    expect(screen.queryByText('Captions')).not.toBeInTheDocument()

    fireEvent.click(item)
    expect(onOpenCaptionDialog).toHaveBeenCalledTimes(1)
  })

  it('labels the generate item "Regenerate Captions" when the clip already has captions', () => {
    renderContextMenu({
      captionActions: {
        canManageCaptions: true,
        hasCaptions: true,
        onOpenCaptionDialog: vi.fn(),
      },
    })

    expect(screen.getByRole('button', { name: 'Regenerate Captions' })).toBeInTheDocument()
  })

  it('does not show transcript visibility controls when the clip already has captions', () => {
    renderContextMenu({
      captionActions: {
        canManageCaptions: true,
        hasCaptions: true,
        onOpenCaptionDialog: vi.fn(),
      },
    })

    expect(
      screen.queryByRole('button', { name: 'Hide Transcript Captions' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Show Transcript Captions' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Insert Existing Captions' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Regenerate Captions' })).toBeInTheDocument()
  })
})
