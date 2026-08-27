// @vitest-environment node

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vite-plus/test'

describe('audio meter waveform source ownership', () => {
  it('uses the registered shared media URL instead of a page-owned throwaway blob URL', () => {
    const source = readFileSync(new URL('./audio-meter-panel.tsx', import.meta.url), 'utf8')

    expect(source).toContain(
      "import { resolveMediaUrl } from '@/features/editor/deps/media-library'",
    )
    expect(source).toContain('resolveMediaUrl(mediaId)')
    expect(source).not.toContain('.getMediaBlobUrl(mediaId)')
    expect(source).not.toContain('URL.revokeObjectURL(blobUrl)')
  })
})
