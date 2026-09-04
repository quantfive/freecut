import { useState, type ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { SliderInput } from '@/shared/ui/property-controls/slider-input'

const meta = {
  title: 'Property Controls/SliderInput',
  component: SliderInput,
  args: { value: 60, min: 0, max: 100, onChange: () => undefined },
} satisfies Meta<typeof SliderInput>

export default meta

type Story = StoryObj<typeof meta>

function Live({
  initial = 60,
  ...args
}: Partial<ComponentProps<typeof SliderInput>> & {
  initial?: number
  min: number
  max: number
}) {
  const [value, setValue] = useState(initial)
  return (
    <div className="w-64">
      <SliderInput {...args} value={value} onChange={setValue} onLiveChange={setValue} />
    </div>
  )
}

/**
 * Label and value ride inside the track. Click anywhere to spring to that value,
 * drag past either end for rubber-band, or click the number to type one.
 */
export const Default: Story = {
  render: () => <Live label="Opacity" min={0} max={100} unit="%" />,
}

export const Bipolar: Story = {
  render: () => <Live initial={0} label="Exposure" min={-100} max={100} step={1} />,
}

export const FractionalStep: Story = {
  render: () => <Live initial={1} label="Speed" min={0.1} max={4} step={0.05} unit="×" />,
}

export const AtBounds: Story = {
  render: () => (
    <div className="space-y-3">
      <Live initial={0} label="Min" min={0} max={100} unit="%" />
      <Live initial={100} label="Max" min={0} max={100} unit="%" />
    </div>
  ),
}

export const Mixed: Story = {
  args: { value: 'mixed' },
  render: (args) => (
    <div className="w-64">
      <SliderInput {...args} label="Opacity" unit="%" />
    </div>
  ),
}

export const Disabled: Story = {
  args: { disabled: true, value: 40 },
  render: (args) => (
    <div className="w-64">
      <SliderInput {...args} label="Opacity" unit="%" />
    </div>
  ),
}
