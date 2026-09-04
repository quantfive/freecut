import type { ViteUserConfig } from 'vite-plus'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

/**
 * Vite config used only by Storybook — `.storybook/main.ts` points the builder here.
 *
 * The app's `vite.config.ts` carries lint/fmt/staged/test sections, a two-entry build
 * (index.html + headless.html) and a build-only service-worker plugin that rewrites
 * `dist/sw.js` after the bundle closes. None of that applies to a component catalog,
 * and the SW plugin would run against a Storybook bundle that has no `sw.js`.
 *
 * Storybook therefore gets its own slim config with only what the components need:
 * React Fast Refresh, Tailwind v4, and the `@` alias.
 */
const config: ViteUserConfig = {
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    // Same reason as the app config: keep every UI dependency on one React copy so
    // Radix never lands on a stale dispatcher across an HMR refresh.
    dedupe: ['react', 'react-dom'],
  },
}

export default config
