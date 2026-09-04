import type { Meta, StoryObj } from '@storybook/react-vite'
import { AlertTriangle, Info } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'

const meta = {
  title: 'UI/Alert',
  component: Alert,
  argTypes: { variant: { control: 'inline-radio', options: ['default', 'destructive'] } },
} satisfies Meta<typeof Alert>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <Alert {...args} className="max-w-md">
      <Info />
      <AlertDescription>
        Proxy media is generated in the background. The timeline stays editable while it runs.
      </AlertDescription>
    </Alert>
  ),
}

export const Destructive: Story = {
  args: { variant: 'destructive' },
  render: (args) => (
    <Alert {...args} className="max-w-md">
      <AlertTriangle />
      <AlertDescription>
        This clip's source file is offline. Relink it before exporting.
      </AlertDescription>
    </Alert>
  ),
}

/** Without an icon the description fills the full width — no left gutter. */
export const WithoutIcon: Story = {
  render: (args) => (
    <Alert {...args} className="max-w-md">
      <AlertDescription>Autosave is on. Your project is saved locally.</AlertDescription>
    </Alert>
  ),
}

export const LongContent: Story = {
  args: { variant: 'destructive' },
  render: (args) => (
    <Alert {...args} className="max-w-md">
      <AlertTriangle />
      <AlertDescription>
        Hardware encoding is unavailable in this browser, so the export fell back to a software
        encoder. Renders will take noticeably longer, and very long sequences may exceed the
        available memory. Try a Chromium-based browser for hardware acceleration.
      </AlertDescription>
    </Alert>
  ),
}
