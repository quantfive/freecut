import type { Meta, StoryObj } from '@storybook/react-vite'
import { Separator } from '@/components/ui/separator'

const meta = {
  title: 'UI/Separator',
  component: Separator,
  argTypes: { orientation: { control: 'inline-radio', options: ['horizontal', 'vertical'] } },
} satisfies Meta<typeof Separator>

export default meta

type Story = StoryObj<typeof meta>

export const Horizontal: Story = {
  render: (args) => (
    <div className="w-72">
      <p className="text-sm font-medium">Sequence settings</p>
      <Separator {...args} className="my-3" />
      <p className="text-sm text-muted-foreground">1920 × 1080 · 23.976 fps</p>
    </div>
  ),
}

export const Vertical: Story = {
  args: { orientation: 'vertical' },
  render: (args) => (
    <div className="flex h-8 items-center gap-3 text-sm">
      <span>Edit</span>
      <Separator {...args} />
      <span>Color</span>
      <Separator {...args} />
      <span>Export</span>
    </div>
  ),
}
