import { useState, type ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { NumberInput } from '@/shared/ui/property-controls/number-input'
import { PropertyRow } from '@/shared/ui/property-controls/property-row'

const meta = {
  title: 'Property Controls/NumberInput',
  component: NumberInput,
  args: { value: 100, onChange: () => undefined },
} satisfies Meta<typeof NumberInput>

export default meta

type Story = StoryObj<typeof meta>

function Live({
  initial = 100,
  ...args
}: Partial<ComponentProps<typeof NumberInput>> & {
  initial?: number
}) {
  const [value, setValue] = useState(initial)
  return (
    <div className="w-40">
      <NumberInput {...args} value={value} onChange={setValue} onLiveChange={setValue} />
    </div>
  )
}

/**
 * The inspector's workhorse field. Drag the label or the value to scrub, use the
 * arrow keys to step (shift for 10×), or click to type an exact value.
 */
export const Default: Story = {
  render: () => <Live />,
}

export const WithLabelAndUnit: Story = {
  render: () => <Live initial={100} label="S" unit="%" min={0} max={400} />,
}

/** Multi-selection with differing values shows `mixed` until one is committed. */
export const Mixed: Story = {
  args: { value: 'mixed' },
  render: (args) => (
    <div className="w-40">
      <NumberInput {...args} label="R" unit="°" />
    </div>
  ),
}

export const Clamped: Story = {
  render: () => <Live initial={50} label="O" unit="%" min={0} max={100} step={5} />,
}

/** `formatInputValue` / `parseInputValue` let a field read in its own notation. */
export const CustomFormatting: Story = {
  render: () => (
    <Live
      initial={-6}
      label="dB"
      min={-60}
      max={12}
      step={0.5}
      formatInputValue={(value) => value.toFixed(1)}
      parseInputValue={(raw) => Number.parseFloat(raw)}
    />
  ),
}

export const Disabled: Story = {
  args: { disabled: true, label: 'X', value: 960 },
  render: (args) => (
    <div className="w-40">
      <NumberInput {...args} />
    </div>
  ),
}

export const InPropertyRow: Story = {
  render: () => (
    <div className="w-64 rounded-lg border border-border bg-panel-bg p-3">
      <PropertyRow label="Position">
        <div className="flex gap-1">
          <Live initial={960} label="X" />
          <Live initial={540} label="Y" />
        </div>
      </PropertyRow>
    </div>
  ),
}
