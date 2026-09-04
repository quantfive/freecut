import { useState, type ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { ColorPicker } from '@/shared/ui/property-controls/color-picker'

const meta = {
  title: 'Property Controls/ColorPicker',
  component: ColorPicker,
  args: { color: '#ff8c3a', onChange: () => undefined },
} satisfies Meta<typeof ColorPicker>

export default meta

type Story = StoryObj<typeof meta>

const presets = ['#ff8c3a', '#f2f2f2', '#1f1f1f', '#4ba3e3', '#5fbd6b', '#e53e3e']

function Live({
  initial = '#ff8c3a',
  ...args
}: Partial<ComponentProps<typeof ColorPicker>> & {
  initial?: string
}) {
  const [color, setColor] = useState(initial)
  return (
    <div className="w-64 rounded-lg border border-border bg-panel-bg p-3">
      <ColorPicker {...args} color={color} onChange={setColor} onLiveChange={setColor} />
    </div>
  )
}

/** Inline mode — no label, just the swatch and its hex field. */
export const Inline: Story = {
  render: () => <Live />,
}

/** With a `label` it wraps itself in a `PropertyRow`. */
export const WithLabel: Story = {
  render: () => <Live label="Fill" />,
}

export const WithPresets: Story = {
  render: () => <Live label="Fill" presets={presets} />,
}

/** `allowAlpha` switches to 8-digit hex and adds the alpha slider. */
export const WithAlpha: Story = {
  render: () => <Live initial="#ff8c3acc" label="Shadow" allowAlpha presets={presets} />,
}

/** A reset arrow appears once the value differs from `defaultColor`. */
export const Resettable: Story = {
  render: () => (
    <Live initial="#4ba3e3" label="Fill" defaultColor="#ff8c3a" onReset={() => undefined} />
  ),
}

export const Disabled: Story = {
  args: { disabled: true },
  render: (args) => <Live {...args} label="Fill" />,
}
