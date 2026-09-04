import type { Meta, StoryObj } from '@storybook/react-vite'
import { FreeCutLogo } from '@/components/brand/freecut-logo'

const meta = {
  title: 'Brand/FreeCutLogo',
  component: FreeCutLogo,
  argTypes: {
    variant: { control: 'inline-radio', options: ['full', 'icon'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
  },
} satisfies Meta<typeof FreeCutLogo>

export default meta

type Story = StoryObj<typeof meta>

export const Full: Story = { args: { variant: 'full', size: 'md' } }

export const Icon: Story = { args: { variant: 'icon', size: 'md' } }

export const Sizes: Story = {
  render: () => (
    <div className="flex items-end gap-8">
      {(['sm', 'md', 'lg'] as const).map((size) => (
        <div key={size} className="flex flex-col items-center gap-2">
          <FreeCutLogo size={size} />
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {size}
          </span>
        </div>
      ))}
    </div>
  ),
}

/** The mark takes the signal orange; the wordmark stays ink. */
export const OnPanel: Story = {
  render: () => (
    <div className="flex w-80 items-center justify-between rounded-lg border border-border bg-panel-header px-4 py-3">
      <FreeCutLogo size="sm" />
      <span className="font-mono text-xs tabular-nums text-muted-foreground">v0.0.0</span>
    </div>
  ),
}
