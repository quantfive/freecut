import type { Meta, StoryObj } from '@storybook/react-vite'
import { Move3d, SlidersHorizontal, Volume2 } from 'lucide-react'
import { NumberInput } from '@/shared/ui/property-controls/number-input'
import { PropertyRow } from '@/shared/ui/property-controls/property-row'
import { PropertySection } from '@/shared/ui/property-controls/property-section'

const meta = {
  title: 'Property Controls/PropertySection',
  component: PropertySection,
  args: { title: 'Transform', defaultOpen: true, children: null },
} satisfies Meta<typeof PropertySection>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <div className="w-64 rounded-lg border border-border bg-panel-bg">
      <PropertySection {...args}>
        <PropertyRow label="Position">
          <div className="flex gap-1">
            <NumberInput value={960} label="X" onChange={() => undefined} />
            <NumberInput value={540} label="Y" onChange={() => undefined} />
          </div>
        </PropertyRow>
        <PropertyRow label="Scale">
          <NumberInput value={100} unit="%" onChange={() => undefined} />
        </PropertyRow>
      </PropertySection>
    </div>
  ),
}

export const WithIcon: Story = {
  args: { icon: Move3d },
  render: Default.render,
}

export const Collapsed: Story = {
  args: { defaultOpen: false },
  render: Default.render,
}

/**
 * Sections share an open state broadcast: shift-clicking any header collapses
 * every mounted section at once, or expands them all when it was already closed.
 */
export const ShiftClickCollapsesAll: Story = {
  render: () => (
    <div className="w-64 divide-y divide-border rounded-lg border border-border bg-panel-bg">
      <PropertySection title="Transform" icon={Move3d}>
        <PropertyRow label="Scale">
          <NumberInput value={100} unit="%" onChange={() => undefined} />
        </PropertyRow>
      </PropertySection>
      <PropertySection title="Effects" icon={SlidersHorizontal}>
        <PropertyRow label="Blur">
          <NumberInput value={0} onChange={() => undefined} />
        </PropertyRow>
      </PropertySection>
      <PropertySection title="Audio" icon={Volume2}>
        <PropertyRow label="Level">
          <NumberInput value={-6} unit="dB" onChange={() => undefined} />
        </PropertyRow>
      </PropertySection>
    </div>
  ),
}
