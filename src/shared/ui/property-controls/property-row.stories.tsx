import type { Meta, StoryObj } from '@storybook/react-vite'
import { PropertyRow } from '@/shared/ui/property-controls/property-row'
import { NumberInput } from '@/shared/ui/property-controls/number-input'
import { Switch } from '@/components/ui/switch'

const meta = {
  title: 'Property Controls/PropertyRow',
  component: PropertyRow,
  args: { label: 'Scale', children: null },
} satisfies Meta<typeof PropertyRow>

export default meta

type Story = StoryObj<typeof meta>

/** The two-column layout every inspector control sits in: label left, control right. */
export const Default: Story = {
  render: (args) => (
    <div className="w-64 rounded-lg border border-border bg-panel-bg p-3">
      <PropertyRow {...args}>
        <NumberInput value={100} unit="%" onChange={() => undefined} />
      </PropertyRow>
    </div>
  ),
}

/** With a `tooltip`, the label becomes the trigger — it opens on the left. */
export const WithTooltip: Story = {
  args: { label: 'Anchor', tooltip: 'The point transforms rotate and scale around.' },
  render: (args) => (
    <div className="w-64 rounded-lg border border-border bg-panel-bg p-3">
      <PropertyRow {...args}>
        <div className="flex gap-1">
          <NumberInput value={960} label="X" onChange={() => undefined} />
          <NumberInput value={540} label="Y" onChange={() => undefined} />
        </div>
      </PropertyRow>
    </div>
  ),
}

export const Stacked: Story = {
  render: () => (
    <div className="w-64 rounded-lg border border-border bg-panel-bg p-3">
      <PropertyRow label="Opacity">
        <NumberInput value={100} unit="%" min={0} max={100} onChange={() => undefined} />
      </PropertyRow>
      <PropertyRow label="Rotation">
        <NumberInput value={0} unit="°" onChange={() => undefined} />
      </PropertyRow>
      <PropertyRow label="Snapping">
        <Switch defaultChecked />
      </PropertyRow>
    </div>
  ),
}

/** A long label keeps its 56px minimum and the control keeps the rest. */
export const LongLabel: Story = {
  args: { label: 'Frame blending mode' },
  render: (args) => (
    <div className="w-64 rounded-lg border border-border bg-panel-bg p-3">
      <PropertyRow {...args}>
        <NumberInput value={2} onChange={() => undefined} />
      </PropertyRow>
    </div>
  ),
}
