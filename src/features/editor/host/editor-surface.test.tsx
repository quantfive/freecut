// @vitest-environment jsdom

import { useEditorHostContext } from './context'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { EditorHost, EmbeddedEditorSnapshot } from './contract'

vi.mock('@/features/editor/components/editor', () => ({
  LoadedEditor: ({ projectId }: { projectId: string }) => {
    const { mode } = useEditorHostContext()
    return (
      <div data-testid="loaded-editor">
        {mode}:{projectId}
      </div>
    )
  },
}))

import { FreeCutEditorSurface } from './editor-surface'

const fakeSnapshot: EmbeddedEditorSnapshot = {
  project: { id: 'surface-project', name: 'Surface', width: 1920, height: 1080, fps: 30 },
  timeline: {
    timelineId: 'surface-timeline',
    revision: 0,
    fps: 30,
    durationInFrames: 30,
    media: [],
    tracks: [],
    width: 1920,
    height: 1080,
  },
  assets: [],
}

function fakeHost(): EditorHost {
  return {
    capabilities: { 'media.resolve': true, 'workspace.edit': true },
    load: vi.fn(async () => fakeSnapshot),
    resolveMedia: vi.fn(() => null),
    submitEdit: vi.fn(() => {
      throw new Error('not used by surface mount test')
    }),
  }
}

describe('FreeCut host browser surface', () => {
  it('injects a fake host into the real LoadedEditor entry', async () => {
    const host = fakeHost()
    render(<FreeCutEditorSurface host={host} />)

    await waitFor(() => expect(screen.getByTestId('loaded-editor')).toBeInTheDocument())
    expect(screen.getByTestId('loaded-editor')).toHaveTextContent('host:surface-project')
    expect(host.load).toHaveBeenCalledTimes(1)
  })
})
