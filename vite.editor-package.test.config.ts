import { defineConfig, lazyPlugins } from 'vite-plus'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: lazyPlugins(() => [react()]),
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  ssr: {
    noExternal: ['@quantfive/freecut-editor-surface'],
  },
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
    globals: true,
    include: ['consumer-smoke.test.tsx'],
    setupFiles: ['consumer-smoke.setup.ts'],
    server: {
      deps: {
        inline: ['@quantfive/freecut-editor-surface'],
      },
    },
  },
})
