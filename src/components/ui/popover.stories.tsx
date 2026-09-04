import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const meta = {
  title: 'UI/Popover',
  component: Popover,
} satisfies Meta<typeof Popover>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { defaultOpen: true },
  render: (args) => (
    <div className="flex h-72 items-start justify-center">
      <Popover {...args}>
        <PopoverTrigger asChild>
          <Button variant="outline">Sequence settings</Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">Sequence settings</p>
            <p className="text-xs text-muted-foreground">Applies to the open timeline.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pop-fps" className="text-xs">
              Frame rate
            </Label>
            <Input id="pop-fps" defaultValue="23.976" className="font-mono tabular-nums" />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  ),
}

export const AlignStart: Story = {
  args: { defaultOpen: true },
  render: (args) => (
    <div className="flex h-72 items-start justify-center">
      <Popover {...args}>
        <PopoverTrigger asChild>
          <Button variant="outline">Aligned to start</Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 text-sm text-muted-foreground">
          Content aligns to the trigger's leading edge.
        </PopoverContent>
      </Popover>
    </div>
  ),
}

export const OnClick: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">Open on click</Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 text-sm text-muted-foreground">
        Dismisses on outside click or Escape.
      </PopoverContent>
    </Popover>
  ),
}
