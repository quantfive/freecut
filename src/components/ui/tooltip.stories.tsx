import type { Meta, StoryObj } from '@storybook/react-vite'
import { Magnet, Scissors } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const meta = {
  title: 'UI/Tooltip',
  component: Tooltip,
} satisfies Meta<typeof Tooltip>

export default meta

type Story = StoryObj<typeof meta>

/**
 * The Radix tooltip, used where a trigger needs rich content or a controlled
 * side. Dense toolbars use the single-instance `GlobalTooltip` instead.
 * `TooltipProvider` is mounted globally by the Storybook preview decorator.
 */
export const Default: Story = {
  args: { open: true },
  render: (args) => (
    <div className="flex h-32 items-end justify-center">
      <Tooltip {...args}>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Split clip">
            <Scissors />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Split at playhead — S</TooltipContent>
      </Tooltip>
    </div>
  ),
}

export const Sides: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-16 p-16">
      {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
        <Tooltip key={side} open>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm" className="capitalize">
              {side}
            </Button>
          </TooltipTrigger>
          <TooltipContent side={side}>Snapping — N</TooltipContent>
        </Tooltip>
      ))}
    </div>
  ),
}

export const OnHover: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Toggle snapping">
          <Magnet />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Toggle snapping — N</TooltipContent>
    </Tooltip>
  ),
}
