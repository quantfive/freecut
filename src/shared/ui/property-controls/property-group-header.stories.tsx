import type { Meta, StoryObj } from '@storybook/react-vite'
import { PropertyGroupHeader } from '@/shared/ui/property-controls/property-group-header'
import { PropertyRow } from '@/shared/ui/property-controls/property-row'
import { NumberInput } from '@/shared/ui/property-controls/number-input'

const meta = {
  title: 'Property Controls/PropertyGroupHeader',
  component: PropertyGroupHeader,
  args: { children: 'Motion' },
} satisfies Meta<typeof PropertyGroupHeader>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

/**
 * Used instead of a `PropertyRow` label when the group wraps its own mini-layout
 * and needs the full panel width rather than sharing it with a left gutter.
 */
export const InPanel: Story = {
  render: () => (
    <div className="w-64 space-y-3 rounded-lg border border-border bg-panel-bg p-3">
      <div className="space-y-1">
        <PropertyGroupHeader>In</PropertyGroupHeader>
        <PropertyRow label="Duration">
          <NumberInput value={12} unit="f" onChange={() => undefined} />
        </PropertyRow>
      </div>
      <div className="space-y-1">
        <PropertyGroupHeader>Out</PropertyGroupHeader>
        <PropertyRow label="Duration">
          <NumberInput value={18} unit="f" onChange={() => undefined} />
        </PropertyRow>
      </div>
    </div>
  ),
}
