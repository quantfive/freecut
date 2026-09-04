import type { Meta, StoryObj } from '@storybook/react-vite'
import { DiscordIcon } from '@/components/brand/discord-icon'
import { Button } from '@/components/ui/button'

const meta = {
  title: 'Brand/DiscordIcon',
  component: DiscordIcon,
} satisfies Meta<typeof DiscordIcon>

export default meta

type Story = StoryObj<typeof meta>

/** Lucide ships no Discord glyph, so the official mark is inlined. It paints in
 * `currentColor`, so it inherits text colour exactly like a lucide icon. */
export const Default: Story = {
  render: (args) => <DiscordIcon {...args} className="h-6 w-6" />,
}

export const Sizes: Story = {
  render: () => (
    <div className="flex items-end gap-6">
      {['h-4 w-4', 'h-5 w-5', 'h-6 w-6', 'h-8 w-8'].map((size) => (
        <DiscordIcon key={size} className={size} />
      ))}
    </div>
  ),
}

export const InButton: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Button variant="ghost" size="icon" aria-label="Join the Discord">
        <DiscordIcon />
      </Button>
      <Button variant="outline">
        <DiscordIcon />
        Join the Discord
      </Button>
    </div>
  ),
}
