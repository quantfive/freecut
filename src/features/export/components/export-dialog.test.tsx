import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { ClientCodec } from '../utils/client-renderer'
import { ExportDialog } from './export-dialog'

const mockStartExport = vi.fn()
const mockCancelExport = vi.fn()
const mockDownloadVideo = vi.fn()
const mockResetState = vi.fn()
const mockGetSupportedCodecs = vi.fn<(...args: unknown[]) => Promise<ClientCodec[]>>()

const { mainSequence, selectedSequence, mockGetExportableSequence } = vi.hoisted(() => {
  const sequence = (id: string | null, name: string, itemId: string) => {
    const trackId = `track-${itemId}`
    const item = {
      id: itemId,
      trackId,
      type: 'text' as const,
      from: 0,
      durationInFrames: 30,
      label: name,
      text: name,
      color: '#ffffff',
    }
    return {
      id,
      name,
      tracks: [
        {
          id: trackId,
          name: 'V1',
          kind: 'video' as const,
          height: 60,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 0,
          items: [item],
        },
      ],
      items: [item],
      transitions: [],
      keyframes: [],
      fps: 30,
      width: 1920,
      height: 1080,
      backgroundColor: '#000000',
      masterBusDb: 0,
      durationFrames: 30,
      inPoint: null,
      outPoint: null,
      markers: [],
    }
  }

  const main = sequence(null, 'Main Timeline', 'main-title')
  const selected = sequence('agent-cut', 'Agent Cut', 'agent-title')
  return {
    mainSequence: main,
    selectedSequence: selected,
    mockGetExportableSequence: vi.fn((id: string | null) => (id === selected.id ? selected : main)),
  }
})

vi.mock('@/features/export/deps/timeline-compositions', () => ({
  getActiveExportSequenceId: () => null,
  getExportableSequence: mockGetExportableSequence,
  listExportableSequences: () => [
    { id: null, name: mainSequence.name },
    { id: selectedSequence.id, name: selectedSequence.name },
  ],
}))

vi.mock('../hooks/use-client-render', () => ({
  useClientRender: () => ({
    isExporting: false,
    progress: 0,
    renderedFrames: undefined,
    totalFrames: undefined,
    status: 'idle',
    error: null,
    result: null,
    startExport: mockStartExport,
    cancelExport: mockCancelExport,
    downloadVideo: mockDownloadVideo,
    resetState: mockResetState,
    getSupportedCodecs: mockGetSupportedCodecs,
    estimateFileSize: vi.fn(),
  }),
}))

vi.mock('@/features/export/deps/projects', () => ({
  useProjectStore: (
    selector: (state: {
      currentProject: { metadata: { width: number; height: number } }
    }) => unknown,
  ) =>
    selector({
      currentProject: {
        metadata: {
          width: 1920,
          height: 1080,
        },
      },
    }),
}))

vi.mock('@/features/export/deps/timeline', () => ({
  useTimelineStore: (
    selector: (state: {
      fps: number
      items: Array<{ from: number; durationInFrames: number }>
      inPoint: number | null
      outPoint: number | null
    }) => unknown,
  ) =>
    selector({
      fps: 30,
      items: [],
      inPoint: null,
      outPoint: null,
    }),
}))

vi.mock('./export-preview-player', () => ({
  ExportPreviewPlayer: () => <div data-testid="export-preview-player" />,
}))

describe('ExportDialog', () => {
  beforeEach(() => {
    mockStartExport.mockReset()
    mockCancelExport.mockReset()
    mockDownloadVideo.mockReset()
    mockResetState.mockReset()
    mockGetSupportedCodecs.mockReset()

    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = () => {}
    }
  })

  it('defaults to mp4 with H.264 codec', async () => {
    mockGetSupportedCodecs.mockResolvedValue(['avc'])

    render(<ExportDialog open onClose={() => {}} />)

    await waitFor(() => {
      expect(mockGetSupportedCodecs).toHaveBeenCalledWith({
        resolution: { width: 1920, height: 1080 },
        bitrate: 3_000_000,
      })
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Format')).toHaveTextContent('MP4')
      expect(screen.getByLabelText('Codec')).toHaveTextContent('H.264')
    })
  })

  it('disables unsupported format and codec choices in the browser capability matrix', async () => {
    mockGetSupportedCodecs.mockResolvedValue(['avc'])

    render(<ExportDialog open onClose={() => {}} />)

    await waitFor(() => {
      expect(mockGetSupportedCodecs).toHaveBeenCalled()
    })

    fireEvent.keyDown(screen.getByLabelText('Format'), { key: 'ArrowDown' })

    const webmOption = await screen.findByRole('option', { name: /WebM/i })
    expect(webmOption).toHaveAttribute('data-disabled')

    fireEvent.keyDown(screen.getByLabelText('Format'), { key: 'Escape' })
    fireEvent.keyDown(screen.getByLabelText('Codec'), { key: 'ArrowDown' })

    const h265Option = await screen.findByRole('option', { name: /H\.265/i })
    expect(h265Option).toHaveAttribute('data-disabled')
  })

  it('passes the selected sequence snapshot to direct export', async () => {
    mockGetSupportedCodecs.mockResolvedValue(['avc'])
    mockStartExport.mockResolvedValue(undefined)

    render(<ExportDialog open onClose={() => {}} />)

    fireEvent.keyDown(screen.getByLabelText('Sequence'), { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: selectedSequence.name }))

    const exportButton = screen.getByRole('button', { name: 'Export Video' })
    await waitFor(() => expect(exportButton).not.toBeDisabled())
    fireEvent.click(exportButton)

    await waitFor(() => {
      expect(mockStartExport).toHaveBeenCalledWith(expect.any(Object), selectedSequence)
    })
  })
})
