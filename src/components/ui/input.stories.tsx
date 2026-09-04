import type { Meta, StoryObj } from '@storybook/react-vite'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const meta = {
  title: 'UI/Input',
  component: Input,
  args: { placeholder: 'Sequence name' },
  argTypes: {
    type: { control: 'select', options: ['text', 'number', 'search', 'file'] },
    disabled: { control: 'boolean' },
  },
} satisfies Meta<typeof Input>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => <Input {...args} className="w-72" />,
}

export const WithLabel: Story = {
  render: (args) => (
    <div className="w-72 space-y-2">
      <Label htmlFor="sequence-name">Sequence name</Label>
      <Input {...args} id="sequence-name" />
    </div>
  ),
}

export const Filled: Story = {
  args: { defaultValue: 'Interview — cut 03' },
  render: (args) => <Input {...args} className="w-72" />,
}

/** Frame counts and durations are read precisely, so numeric fields go mono. */
export const Numeric: Story = {
  args: { type: 'number', defaultValue: 1920 },
  render: (args) => (
    <div className="flex w-72 items-center gap-2">
      <Label htmlFor="frame-width" className="text-xs text-muted-foreground">
        Width
      </Label>
      <Input {...args} id="frame-width" className="font-mono tabular-nums" />
    </div>
  ),
}

export const Disabled: Story = {
  args: { disabled: true, defaultValue: 'Locked while rendering' },
  render: (args) => <Input {...args} className="w-72" />,
}

export const FileInput: Story = {
  args: { type: 'file' },
  render: (args) => <Input {...args} className="w-72" />,
}
