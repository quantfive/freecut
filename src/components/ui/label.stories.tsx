import type { Meta, StoryObj } from '@storybook/react-vite'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

const meta = {
  title: 'UI/Label',
  component: Label,
  args: { children: 'Frame rate' },
} satisfies Meta<typeof Label>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithInput: Story = {
  render: (args) => (
    <div className="w-72 space-y-2">
      <Label {...args} htmlFor="fps" />
      <Input id="fps" defaultValue="23.976" className="font-mono tabular-nums" />
    </div>
  ),
}

/**
 * `peer-disabled:` dims the label when the control it labels is disabled — the
 * label has to sit after the peer for the variant to apply.
 */
export const PeerDisabled: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Switch id="proxy-media" className="peer" disabled />
      <Label htmlFor="proxy-media">Use proxy media</Label>
    </div>
  ),
}
