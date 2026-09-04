import type { Meta, StoryObj } from '@storybook/react-vite'
import { LanguageSwitcher } from '@/shared/ui/language-switcher'

const meta = {
  title: 'Editor Surfaces/LanguageSwitcher',
  component: LanguageSwitcher,
} satisfies Meta<typeof LanguageSwitcher>

export default meta

type Story = StoryObj<typeof meta>

/**
 * Reads the live i18next instance (initialised by the Storybook preview), so
 * picking a language here really switches the catalog's own strings — the
 * translated components in this Storybook follow it.
 */
export const Default: Story = {
  render: (args) => (
    <div className="flex h-72 items-start">
      <LanguageSwitcher {...args} />
    </div>
  ),
}
