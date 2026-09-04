import { useState, type ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { RotaryKnob } from '@/shared/ui/property-controls/rotary-knob'

const meta = {
  title: 'Property Controls/RotaryKnob',
  component: RotaryKnob,
  args: { value: 0, min: -100, max: 100, onChange: () => undefined },
} satisfies Meta<typeof RotaryKnob>

export default meta

type Story = StoryObj<typeof meta>

function Live({
  initial = 0,
  ...args
}: Partial<ComponentProps<typeof RotaryKnob>> & {
  initial?: number
  min: number
  max: number
}) {
  const [value, setValue] = useState(initial)
  return <RotaryKnob {...args} value={value} onChange={setValue} onLiveChange={setValue} />
}

/** A 270° arc knob for bipolar trims — drag vertically to turn it. */
export const Default: Story = {
  render: () => <Live min={-100} max={100} />,
}

export const Sizes: Story = {
  render: () => (
    <div className="flex items-end gap-6">
      {[24, 28, 40, 56].map((size) => (
        <div key={size} className="flex flex-col items-center gap-2">
          <Live initial={35} min={-100} max={100} size={size} />
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{size}px</span>
        </div>
      ))}
    </div>
  ),
}

export const AtBounds: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <Live initial={-100} min={-100} max={100} />
      <Live initial={0} min={-100} max={100} />
      <Live initial={100} min={-100} max={100} />
    </div>
  ),
}

/** Mixed selections render the arc empty until a value is committed. */
export const Mixed: Story = {
  args: { value: 'mixed' },
  render: (args) => <RotaryKnob {...args} />,
}
