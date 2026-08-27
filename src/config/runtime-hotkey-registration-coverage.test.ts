// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

const SRC_ROOT = join(process.cwd(), 'src')

function productionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return productionSourceFiles(path)
    if (!/\.tsx?$/.test(entry.name) || /\.test\./.test(entry.name)) return []
    return [path]
  })
}

describe('runtime hotkey registration coverage', () => {
  it('routes every direct command-map useHotkeys registration through the runtime map', () => {
    const directRegistrationFiles = productionSourceFiles(SRC_ROOT).filter((path) => {
      const source = readFileSync(path, 'utf8')
      return /useHotkeys\(\s*hotkeys\.[A-Z0-9_]+/.test(source)
    })

    expect(directRegistrationFiles.length).toBeGreaterThan(0)
    for (const path of directRegistrationFiles) {
      expect(readFileSync(path, 'utf8'), relative(process.cwd(), path)).toContain(
        'useRuntimeHotkeys',
      )
    }
  })

  it('feeds derived keyframe registrations and local source-monitor matching from the runtime map', () => {
    const keyframePanel = readFileSync(
      join(SRC_ROOT, 'features/timeline/components/keyframe-graph-panel.tsx'),
      'utf8',
    )
    const sourceMonitor = readFileSync(
      join(SRC_ROOT, 'features/preview/components/source-monitor.tsx'),
      'utf8',
    )

    expect(keyframePanel).toContain('useRuntimeHotkeys')
    expect(keyframePanel).toMatch(/shortcuts=\{\{[\s\S]*hotkeys\.EDIT_KEYFRAME_ADD/)
    expect(sourceMonitor).toContain('useRuntimeHotkeys')
    expect(sourceMonitor).toMatch(/doesHotkeyEventMatchBinding\(e, runtimeHotkeys\.MARK_IN\)/)
    expect(sourceMonitor).toMatch(/doesHotkeyEventMatchBinding\(e, runtimeHotkeys\.MARK_OUT\)/)
    expect(sourceMonitor).toMatch(/doesHotkeyEventMatchBinding\(e, runtimeHotkeys\.CLEAR_IN_OUT\)/)
  })
})
