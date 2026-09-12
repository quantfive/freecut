// codepress_generated: true
// Explicit preview-only config: preserve the customer's normal Vite configuration.
import { mergeConfig } from 'vite-plus'
import appConfig from '../../vite.config'

const basePath = process.env.CODEPRESS_BASE_PATH || '/'
const base = `/${basePath.split('/').filter(Boolean).join('/')}`.replace(/\/?$/, '/')
const clientPort = Number(process.env.CODEPRESS_HMR_CLIENT_PORT || '443')
const protocol = process.env.CODEPRESS_HMR_PROTOCOL || 'wss'
if (!Number.isInteger(clientPort) || clientPort < 1 || clientPort > 65535) {
  throw new Error('CODEPRESS_HMR_CLIENT_PORT must be an integer from 1 to 65535')
}
if (protocol !== 'ws' && protocol !== 'wss') {
  throw new Error('CODEPRESS_HMR_PROTOCOL must be ws or wss')
}

export default mergeConfig(appConfig, {
  base,
  server: {
    allowedHosts: true,
    hmr: { clientPort, protocol },
  },
})
