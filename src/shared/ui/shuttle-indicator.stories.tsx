import type { Meta, StoryObj } from '@storybook/react-vite'
import { ShuttleIndicator } from '@/shared/ui/shuttle-indicator'

const meta = {
  title: 'Editor Surfaces/ShuttleIndicator',
  component: ShuttleIndicator,
  args: { active: true, playbackRate: 2 },
  argTypes: {
    active: { control: 'boolean' },
    playbackRate: { control: { type: 'range', min: -8, max: 8, step: 1 } },
  },
} satisfies Meta<typeof ShuttleIndicator>

export default meta

type Story = StoryObj<typeof meta>

/** The J/K/L shuttle readout: direction, key hint and rate, in mono. */
export const Forward: Story = {}

export const Reverse: Story = { args: { playbackRate: -4 } }

/** At 1× it stays neutral graphite; above 1× it takes the signal orange. */
export const Rates: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {[-8, -4, -2, -1, 1, 2, 4, 8].map((rate) => (
        <ShuttleIndicator key={rate} active playbackRate={rate} />
      ))}
    </div>
  ),
}

/** Renders nothing when playback is stopped or the rate is zero. */
export const Hidden: Story = {
  args: { active: false },
  render: (args) => (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <ShuttleIndicator {...args} />
      <span>(nothing renders while stopped)</span>
    </div>
  ),
}
