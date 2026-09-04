import type { Decorator, Preview } from '@storybook/react-vite'
import { TooltipProvider } from '@/components/ui/tooltip'
// Side-effect imports: the app's global stylesheet (Tailwind theme, OKLCH tokens,
// timeline theme extension, animation utilities) and the i18next instance that
// translated components — Dialog, FloatingPanel, LanguageSwitcher — read from.
import '@/index.css'
import '@/i18n'

/**
 * FreeCut is dark-only by design, so every story renders on the app background with
 * the shared tooltip provider already mounted — the same chrome a component sees
 * inside the editor.
 */
const withEditorSurface: Decorator = (Story) => (
  <TooltipProvider delayDuration={200} skipDelayDuration={300}>
    <div className="min-h-screen bg-background p-6 text-foreground">
      <Story />
    </div>
  </TooltipProvider>
)

const preview: Preview = {
  decorators: [withEditorSurface],
  parameters: {
    // The decorator owns padding, and panels/overlays need the full frame.
    layout: 'fullscreen',
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    options: {
      storySort: {
        order: ['Foundations', 'UI', 'Property Controls', 'Editor Surfaces', 'Brand'],
      },
    },
  },
}

export default preview
