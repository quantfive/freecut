import type { StorybookConfig } from '@storybook/react-vite'

/**
 * Hosts allowed to reach the Storybook dev server and its manager websocket.
 *
 * CodePress serves the preview from a public proxied origin, and Storybook validates
 * the websocket Origin independently of Vite. The two static suffixes cover the
 * production and staging preview domains; `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` is
 * injected at runtime and carries the MicroVM endpoint host, which differs per
 * environment. All three must be present — a non-empty allowlist disables the
 * allow-all fallback, so listing one environment alone would 403 the other.
 */
const previewAllowedHosts = ['.preview.codepress.dev', '.preview-staging.codepress.dev']
  .concat((process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS ?? '').split(','))
  .map((host) => host.trim())
  .filter(Boolean)

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.tsx'],
  framework: {
    name: '@storybook/react-vite',
    options: {
      builder: {
        // Not the app config — see the header comment in vite.storybook.config.ts.
        viteConfigPath: 'vite.storybook.config.ts',
      },
    },
  },
  core: {
    disableTelemetry: true,
    allowedHosts: previewAllowedHosts,
  },
  viteFinal: (viteConfig) => ({
    ...viteConfig,
    server: {
      ...viteConfig.server,
      // The preview origin terminates HTTPS on 443, so the HMR client must dial the
      // proxy rather than the container's own dev port. Both values are injected by
      // the CodePress runtime; locally the defaults keep plain same-port websockets.
      hmr: {
        protocol: (process.env.CODEPRESS_HMR_PROTOCOL ?? 'ws') as 'ws' | 'wss',
        ...(process.env.CODEPRESS_HMR_CLIENT_PORT
          ? { clientPort: Number.parseInt(process.env.CODEPRESS_HMR_CLIENT_PORT, 10) }
          : {}),
      },
    },
  }),
}

export default config
