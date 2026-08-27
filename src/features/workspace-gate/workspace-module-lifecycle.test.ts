// @vitest-environment node

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vite-plus/test'

describe('workspace module lifecycle', () => {
  it('loads activation-owned modules before navigation can abort their requests', () => {
    const source = readFileSync(new URL('./workspace-gate.tsx', import.meta.url), 'utf8')

    expect(source).not.toContain("await import('@/infrastructure/storage/workspace-fs/bootstrap')")
    expect(source).not.toContain("import('./deps/trash-auto-purge')")
    expect(source).toContain(
      "import { bootstrapWorkspace } from '@/infrastructure/storage/workspace-fs/bootstrap'",
    )
    expect(source).toContain("import { autoPurgeExpiredTrash } from './deps/trash-auto-purge'")
  })
})
