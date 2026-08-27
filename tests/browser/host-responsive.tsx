import { createRoot } from 'react-dom/client'
import { FreeCutEditorSurface } from '../../src/features/editor/host/editor-surface'
import type { EditorHost, EmbeddedEditorSnapshot } from '../../src/features/editor/host/contract'
import { useEditorStore } from '../../src/shared/state/editor'

declare global {
  interface Window {
    __freecutHostFixture: {
      openSource(): void
    }
  }
}

const snapshot: EmbeddedEditorSnapshot = {
  project: {
    id: 'responsive-host-project',
    name: 'Responsive host',
    width: 1920,
    height: 1080,
    fps: 30,
  },
  timeline: {
    timelineId: 'responsive-host-timeline',
    revision: 0,
    fps: 30,
    durationInFrames: 300,
    media: [],
    tracks: [],
    width: 1920,
    height: 1080,
  },
  assets: [
    {
      id: 'fixture-image',
      kind: 'image',
      fileName: 'fixture.svg',
      mimeType: 'image/svg+xml',
      durationSeconds: 10,
      width: 640,
      height: 360,
      fps: 30,
    },
  ],
}

const imageSource =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#e56b2f"/></svg>',
  )

const host: EditorHost = {
  capabilities: {
    'media.resolve': true,
    'project.navigate': true,
    'workspace.edit': true,
  },
  load: () => snapshot,
  resolveMedia: () => ({ source: imageSource }),
  submitEdit: () => {
    throw new Error('The responsive fixture does not submit edits')
  },
  navigation: { back: () => undefined },
}

window.__freecutHostFixture = {
  openSource: () => useEditorStore.getState().setSourcePreviewMediaId('fixture-image'),
}

const hostBox = document.querySelector<HTMLElement>('[data-host-box]')
if (!hostBox) throw new Error('Missing host box')
createRoot(hostBox).render(<FreeCutEditorSurface host={host} />)
