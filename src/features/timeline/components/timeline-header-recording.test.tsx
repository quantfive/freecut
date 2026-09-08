import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useEditorStore } from '@/shared/state/editor'
import { useMicRecordingStore } from '@/shared/state/mic-recording-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { useMediaLibraryStore } from '../deps/media-library-store'
import { useItemsStore } from '../stores/items-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { TimelineHeader } from './timeline-header'

const capture = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  dispose: vi.fn(),
  importAudio: vi.fn(),
}))
vi.mock('@/infrastructure/audio/mic-recorder', () => ({
  MicRecorder: class {
    start = capture.start
    stop = capture.stop
    dispose = capture.dispose
    elapsedMs = () => 1000
  },
  hasMicRecordingSupport: () => true,
  enumerateAudioInputs: async () => [],
  extensionForMimeType: () => 'webm',
  startMicLevelMonitor: vi.fn(),
}))
vi.mock('../deps/media-library-service', () => ({
  importMediaLibraryService: async () => ({
    mediaLibraryService: { importRecordedAudio: capture.importAudio },
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  useEditorStore.setState({ hostMode: false })
  useMicRecordingStore.getState().reset()
  useMediaLibraryStore.setState({ currentProjectId: 'recording-project' })
  useItemsStore.getState().setItems([])
  useItemsStore.getState().setTracks([])
  useTimelineSettingsStore.setState({ fps: 30 })
  usePlaybackStore.setState({ isPlaying: false, currentFrame: 15 })
  capture.start.mockResolvedValue(undefined)
  capture.stop.mockResolvedValue({
    blob: new Blob(['same-take']),
    mimeType: 'audio/webm',
    durationMs: 1000,
  })
  capture.importAudio.mockResolvedValue({
    id: 'saved-take',
    duration: 1,
    type: 'audio',
    fileName: 'take.webm',
  })
})
afterEach(() => {
  cleanup()
  useMicRecordingStore.getState().reset()
})

describe('timeline voiceover owner', () => {
  it('preserves the take across More dismissal/reopening, then saves that same recorder', async () => {
    render(<TimelineHeader />)
    const more = screen.getByRole('button', { name: 'More timeline tools' })
    fireEvent.click(more)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Record voiceover' }))
    await waitFor(() => expect(useMicRecordingStore.getState().status).toBe('recording'))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(useMicRecordingStore.getState().status).toBe('recording')
    expect(capture.dispose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Stop and save' })).toBeVisible()
    fireEvent.click(more)
    await screen.findByRole('dialog')
    fireEvent.click(more)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(useMicRecordingStore.getState().status).toBe('recording')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop and save' })))
    await waitFor(() => expect(useMicRecordingStore.getState().status).toBe('idle'))
    expect(capture.start).toHaveBeenCalledTimes(1)
    expect(capture.stop).toHaveBeenCalledTimes(1)
    expect(capture.dispose).not.toHaveBeenCalled()
    expect(capture.importAudio).toHaveBeenCalledTimes(1)
    expect(useItemsStore.getState().items).toEqual([
      expect.objectContaining({ mediaId: 'saved-take', from: 15, durationInFrames: 30 }),
    ])
  })

  it('disposes an active take on actual editor header unmount without saving', async () => {
    const view = render(<TimelineHeader />)
    fireEvent.click(screen.getByRole('button', { name: 'More timeline tools' }))
    fireEvent.click(screen.getByRole('button', { name: 'Record voiceover' }))
    await waitFor(() => expect(useMicRecordingStore.getState().status).toBe('recording'))
    view.unmount()
    expect(capture.dispose).toHaveBeenCalledTimes(1)
    expect(capture.stop).not.toHaveBeenCalled()
    expect(capture.importAudio).not.toHaveBeenCalled()
    expect(useMicRecordingStore.getState().status).toBe('idle')
    expect(usePlaybackStore.getState().isPlaying).toBe(false)
  })
})
