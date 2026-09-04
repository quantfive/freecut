import type { Meta, StoryObj } from '@storybook/react-vite'
import { Magnet, Redo2, Scissors, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GlobalTooltip } from '@/components/ui/global-tooltip'

const meta = {
  title: 'UI/GlobalTooltip',
  component: GlobalTooltip,
} satisfies Meta<typeof GlobalTooltip>

export default meta

type Story = StoryObj<typeof meta>

/**
 * One tooltip instance for the whole app: it listens for hover on any element
 * carrying `data-tooltip` instead of mounting a Radix tooltip per button, which
 * is what keeps a dense toolbar cheap. Hover the buttons below to see it — the
 * first opens after 300 ms, and moving straight to a neighbour opens instantly.
 */
export const ToolbarHover: Story = {
  render: () => (
    <>
      <GlobalTooltip />
      <div className="inline-flex items-center gap-1 rounded-md border border-border bg-panel-header p-1">
        <Button variant="ghost" size="icon" data-tooltip="Undo — ⌘Z" aria-label="Undo">
          <Undo2 />
        </Button>
        <Button variant="ghost" size="icon" data-tooltip="Redo — ⇧⌘Z" aria-label="Redo">
          <Redo2 />
        </Button>
        <Button variant="ghost" size="icon" data-tooltip="Split at playhead — S" aria-label="Split">
          <Scissors />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          data-tooltip="Toggle snapping — N"
          aria-label="Snapping"
        >
          <Magnet />
        </Button>
      </div>
    </>
  ),
}

/** `data-tooltip-side` picks the side per trigger. */
export const Sides: Story = {
  render: () => (
    <>
      <GlobalTooltip />
      <div className="grid w-fit grid-cols-2 gap-12 p-12">
        {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
          <Button
            key={side}
            variant="outline"
            size="sm"
            className="capitalize"
            data-tooltip={`Opens on the ${side}`}
            data-tooltip-side={side}
          >
            {side}
          </Button>
        ))}
      </div>
    </>
  ),
}
