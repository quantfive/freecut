import type { Meta, StoryObj } from '@storybook/react-vite'
import { Loader2, Play, Scissors, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

const meta = {
  title: 'UI/Button',
  component: Button,
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'],
    },
    size: { control: 'select', options: ['default', 'sm', 'lg', 'icon'] },
    disabled: { control: 'boolean' },
  },
  args: { children: 'Export' },
} satisfies Meta<typeof Button>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <Button {...args} variant="default">
        Export
      </Button>
      <Button {...args} variant="secondary">
        Add media
      </Button>
      <Button {...args} variant="outline">
        Cancel
      </Button>
      <Button {...args} variant="ghost">
        Rename
      </Button>
      <Button {...args} variant="destructive">
        Delete clip
      </Button>
      <Button {...args} variant="link">
        Open docs
      </Button>
    </div>
  ),
}

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <Button {...args} size="sm">
        Small
      </Button>
      <Button {...args} size="default">
        Default
      </Button>
      <Button {...args} size="lg">
        Large
      </Button>
      <Button {...args} size="icon" aria-label="Split clip">
        <Scissors />
      </Button>
    </div>
  ),
}

export const WithIcon: Story = {
  args: {
    children: (
      <>
        <Play />
        Play from in point
      </>
    ),
  },
}

export const Disabled: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <Button {...args} disabled>
        Export
      </Button>
      <Button {...args} variant="outline" disabled>
        Cancel
      </Button>
      <Button {...args} variant="destructive" disabled>
        <Trash2 />
        Delete clip
      </Button>
    </div>
  ),
}

export const Loading: Story = {
  args: {
    disabled: true,
    children: (
      <>
        <Loader2 className="animate-spin" />
        Rendering…
      </>
    ),
  },
}

/** Long labels must not wrap — the toolbar relies on `whitespace-nowrap`. */
export const LongLabel: Story = {
  render: (args) => (
    <div className="w-64 rounded-md border border-border p-3">
      <Button {...args} className="w-full">
        Replace selected clip with proxy media
      </Button>
    </div>
  ),
}
