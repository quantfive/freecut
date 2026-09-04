import type { Meta, StoryObj } from '@storybook/react-vite'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const meta = {
  title: 'UI/Textarea',
  component: Textarea,
  args: { placeholder: 'Caption text…' },
  argTypes: { disabled: { control: 'boolean' } },
} satisfies Meta<typeof Textarea>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => <Textarea {...args} className="w-80" />,
}

export const WithLabel: Story = {
  render: (args) => (
    <div className="w-80 space-y-2">
      <Label htmlFor="caption-body">Caption</Label>
      <Textarea {...args} id="caption-body" rows={4} />
    </div>
  ),
}

/** Resizing is disabled by design — the panel owns the height, not the user. */
export const LongContent: Story = {
  args: {
    rows: 6,
    defaultValue:
      'Every timecode, frame count and duration in this editor is set in IBM Plex Mono so digits align and do not jump width while the playhead moves. Prose stays in Plex Sans.',
  },
  render: (args) => <Textarea {...args} className="w-80" />,
}

export const Disabled: Story = {
  args: { disabled: true, defaultValue: 'Locked while rendering' },
  render: (args) => <Textarea {...args} className="w-80" />,
}
