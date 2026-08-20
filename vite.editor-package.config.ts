import { defineConfig, lazyPlugins } from 'vite-plus'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const outDir = fileURLToPath(new URL('./packages/freecut-editor/dist', import.meta.url))

const hostDisabledWorkerNames = [
  'clip-worker-',
  'embeddings-worker-',
  'export-render.worker-',
  'frame-interpolation-worker-',
  'gemma-scene-worker-',
  'kokoro-',
  'lfm-scene-worker-',
  'parakeet.worker-',
  'ort.bundle.min-',
  'transformers.web-',
  'upscale-worker-',
]

function statExists(filePath: string): boolean {
  try {
    statSync(filePath)
    return true
  } catch {
    return false
  }
}

// fallow-ignore-next-line complexity
function removeHostDisabledWorkers() {
  for (const directory of [path.join(outDir, 'assets'), path.join(outDir, 'chunks')]) {
    if (!statExists(directory)) continue
    for (const entry of readdirSync(directory)) {
      if (!hostDisabledWorkerNames.some((name) => entry.startsWith(name))) continue
      rmSync(path.join(directory, entry), { force: true })
    }
  }
}

function normalizeEditorPackageAssets() {
  return {
    name: 'freecut-editor-package-assets',
    buildStart() {
      rmSync(outDir, { recursive: true, force: true })
    },
    writeBundle() {
      mkdirSync(outDir, { recursive: true })
      const cssFiles: string[] = []
      const visit = (directory: string) => {
        for (const entry of readdirSync(directory).sort()) {
          const absolute = path.join(directory, entry)
          if (statSync(absolute).isDirectory()) visit(absolute)
          else if (entry.endsWith('.css')) cssFiles.push(absolute)
        }
      }
      visit(outDir)
      if (cssFiles.length > 0) {
        const stylePath = fileURLToPath(
          new URL('./packages/freecut-editor/dist/style.css', import.meta.url),
        )
        const css = cssFiles
          .sort((left, right) => left.localeCompare(right))
          .map((filePath) => readFileSync(filePath, 'utf8'))
          .join('\n')
        writeFileSync(stylePath, css)
        for (const filePath of cssFiles) {
          if (filePath !== stylePath) rmSync(filePath, { force: true })
        }
      }
      removeHostDisabledWorkers()
      copyFileSync(
        fileURLToPath(new URL('./packages/freecut-editor/src/index.d.ts', import.meta.url)),
        fileURLToPath(new URL('./packages/freecut-editor/dist/index.d.ts', import.meta.url)),
      )
    },
  }
}

export default defineConfig({
  plugins: lazyPlugins(() => [react(), tailwindcss(), normalizeEditorPackageAssets()]),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    target: 'esnext',
    outDir,
    emptyOutDir: true,
    sourcemap: false,
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL('./packages/freecut-editor/src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: [/^react(?:\/|$)/, /^react-dom(?:\/|$)/],
      output: {
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'chunks/[name]-[hash].js',
        entryFileNames: 'index.js',
      },
    },
  },
  root,
  publicDir: false,
})
