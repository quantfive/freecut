import type { Meta, StoryObj } from '@storybook/react-vite'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'

const meta = {
  title: 'UI/Slider',
  component: Slider,
  args: { defaultValue: [60], min: 0, max: 100, step: 1 },
} satisfies Meta<typeof Slider>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => <Slider {...args} className="w-72" />,
}

export const WithValueReadout: Story = {
  render: (args) => (
    <div className="w-72 space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="opacity">Opacity</Label>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">60%</span>
      </div>
      <Slider {...args} id="opacity" />
    </div>
  ),
}

/** Two thumbs — the shape used for in/out range trims. */
export const Range: Story = {
  args: { defaultValue: [25, 75] },
  render: (args) => <Slider {...args} className="w-72" />,
}

export const Stepped: Story = {
  args: { defaultValue: [50], step: 25 },
  render: (args) => <Slider {...args} className="w-72" />,
}

export const Disabled: Story = {
  args: { disabled: true },
  render: (args) => <Slider {...args} className="w-72" />,
}
