import { useState, type ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Combobox } from '@/components/ui/combobox'
import { Label } from '@/components/ui/label'

const fonts = [
  { value: 'ibm-plex-sans', label: 'IBM Plex Sans', keywords: ['plex', 'sans'] },
  { value: 'ibm-plex-mono', label: 'IBM Plex Mono', keywords: ['plex', 'mono', 'code'] },
  { value: 'inter', label: 'Inter' },
  { value: 'source-serif', label: 'Source Serif 4', keywords: ['serif'] },
  { value: 'jetbrains-mono', label: 'JetBrains Mono', keywords: ['mono', 'code'] },
  { value: 'space-grotesk', label: 'Space Grotesk' },
  { value: 'work-sans', label: 'Work Sans' },
  { value: 'dm-serif-display', label: 'DM Serif Display', keywords: ['serif', 'display'] },
]

const meta = {
  title: 'UI/Combobox',
  component: Combobox,
  args: {
    options: fonts,
    placeholder: 'Select a font',
    searchPlaceholder: 'Search fonts…',
    value: '',
    onValueChange: () => undefined,
  },
} satisfies Meta<typeof Combobox>

export default meta

type Story = StoryObj<typeof meta>

function ControlledCombobox({
  initialValue = '',
  ...args
}: Omit<ComponentProps<typeof Combobox>, 'value' | 'onValueChange'> & {
  initialValue?: string
}) {
  const [value, setValue] = useState(initialValue)
  return (
    <div className="w-72 space-y-2">
      <Label htmlFor="font-family">Font family</Label>
      <Combobox {...args} id="font-family" value={value} onValueChange={setValue} />
    </div>
  )
}

/** A searchable select: filters on label, value and the optional `keywords`. */
export const Default: Story = {
  render: (args) => <ControlledCombobox {...args} />,
}

export const WithSelection: Story = {
  render: (args) => <ControlledCombobox {...args} initialValue="ibm-plex-mono" />,
}

export const Disabled: Story = {
  args: { disabled: true },
  render: (args) => <ControlledCombobox {...args} initialValue="inter" />,
}

/** The empty message shows when nothing matches the query. */
export const NoOptions: Story = {
  args: { options: [], emptyMessage: 'No fonts installed.' },
  render: (args) => <ControlledCombobox {...args} />,
}
