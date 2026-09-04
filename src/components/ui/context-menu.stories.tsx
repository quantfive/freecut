import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

const meta = {
  title: 'UI/ContextMenu',
  component: ContextMenu,
} satisfies Meta<typeof ContextMenu>

export default meta

type Story = StoryObj<typeof meta>

/** Right-click the clip below — this is the timeline's clip menu. */
export const ClipMenu: Story = {
  render: (args) => (
    <ContextMenu {...args}>
      <ContextMenuTrigger asChild>
        <div className="flex h-16 w-80 cursor-default items-center rounded-md border border-timeline-video bg-timeline-video px-3 text-sm">
          A001_C003.mov
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <ContextMenuLabel>Clip</ContextMenuLabel>
        <ContextMenuItem>
          Cut
          <ContextMenuShortcut>⌘X</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem>
          Copy
          <ContextMenuShortcut>⌘C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem>
          Split at playhead
          <ContextMenuShortcut>S</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Speed</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-40">
            <ContextMenuItem>50%</ContextMenuItem>
            <ContextMenuItem>100%</ContextMenuItem>
            <ContextMenuItem>200%</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem>
          Ripple delete
          <ContextMenuShortcut>⇧⌫</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled>Reveal in Finder (desktop only)</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
}

/** Disabled and shortcut-bearing items, on the media-bin row menu. */
export const MediaBinMenu: Story = {
  render: (args) => (
    <ContextMenu {...args}>
      <ContextMenuTrigger asChild>
        <div className="flex h-12 w-80 cursor-default items-center justify-between rounded-md border border-border bg-card px-3 text-sm">
          <span>voiceover-take-4.wav</span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">00:01:12:04</span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem>
          Insert at playhead
          <ContextMenuShortcut>,</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem>
          Overwrite at playhead
          <ContextMenuShortcut>.</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem>Rename…</ContextMenuItem>
        <ContextMenuItem disabled>Reveal in Finder (desktop only)</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
}
