import type { Meta, StoryObj } from '@storybook/react-vite'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

const meta = {
  title: 'UI/Switch',
  component: Switch,
  argTypes: { checked: { control: 'boolean' }, disabled: { control: 'boolean' } },
} satisfies Meta<typeof Switch>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Checked: Story = { args: { defaultChecked: true } }

export const WithLabel: Story = {
  render: (args) => (
    <div className="flex items-center gap-2">
      <Switch {...args} id="snapping" defaultChecked />
      <Label htmlFor="snapping">Snapping</Label>
    </div>
  ),
}

export const States: Story = {
  render: () => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Switch id="s-off" />
        <Label htmlFor="s-off">Off</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="s-on" defaultChecked />
        <Label htmlFor="s-on">On</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="s-off-disabled" disabled />
        <Label htmlFor="s-off-disabled">Off, disabled</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="s-on-disabled" defaultChecked disabled />
        <Label htmlFor="s-on-disabled">On, disabled</Label>
      </div>
    </div>
  ),
}
