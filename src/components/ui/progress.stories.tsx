import type { Meta, StoryObj } from '@storybook/react-vite'
import { Progress } from '@/components/ui/progress'

const meta = {
  title: 'UI/Progress',
  component: Progress,
  args: { value: 45 },
  argTypes: { value: { control: { type: 'range', min: 0, max: 100, step: 1 } } },
} satisfies Meta<typeof Progress>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => <Progress {...args} className="w-80" />,
}

export const Steps: Story = {
  render: () => (
    <div className="w-80 space-y-4">
      {[0, 25, 60, 100].map((value) => (
        <div key={value} className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Rendering</span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{value}%</span>
          </div>
          <Progress value={value} />
        </div>
      ))}
    </div>
  ),
}

/** Export dialogs pair the bar with a mono readout of frames done. */
export const WithExportReadout: Story = {
  args: { value: 72 },
  render: (args) => (
    <div className="w-80 rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-medium">Exporting sequence</span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">1 728 / 2 400</span>
      </div>
      <Progress {...args} className="h-2" />
    </div>
  ),
}
