// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { AudioItem, TimelineItem, TimelineTrack } from '@/types/timeline'

const mocks = vi.hoisted(() => ({
  acquire: vi.fn<(mediaId: string, blob: Blob) => string>(),
  release: vi.fn<(mediaId: string) => void>(),
  getMediaFile: vi.fn<(mediaId: string) => Promise<Blob | null>>(),
  importGeneratedImage: vi.fn(),
  deleteMediaFromProject: vi.fn<(projectId: string, mediaId: string) => Promise<void>>(),
  prependMediaItem: vi.fn(),
  getPrimaryVideoTrack: vi.fn(),
  getCanvas: vi.fn(),
  disposeInput: vi.fn(),
  disposeSink: vi.fn(),
  mediaItems: [] as Array<Record<string, unknown>>,
  mediaState: {
    currentProjectId: 'project-1' as string | null,
    mediaById: {} as Record<string, Record<string, unknown>>,
    prependMediaItem: (media: Record<string, unknown>) => {
      mocks.prependMediaItem(media)
      mocks.mediaItems.unshift(media)
    },
  },
}))

vi.mock('@/features/timeline/deps/media-library-store', () => ({
  useMediaLibraryStore: {
    getState: () => mocks.mediaState,
  },
}))

vi.mock('@/features/timeline/deps/media-library-service', () => ({
  importMediaLibraryService: async () => ({
    mediaLibraryService: {
      getMediaFile: mocks.getMediaFile,
      importGeneratedImage: mocks.importGeneratedImage,
      deleteMediaFromProject: mocks.deleteMediaFromProject,
    },
  }),
}))

vi.mock('@/infrastructure/browser/blob-url-manager', () => ({
  blobUrlManager: {
    acquire: mocks.acquire,
    release: mocks.release,
  },
}))

vi.mock('mediabunny', () => {
  class Input {
    getPrimaryVideoTrack = mocks.getPrimaryVideoTrack
    dispose = mocks.disposeInput
  }

  class BlobSource {}

  class CanvasSink {
    getCanvas = mocks.getCanvas
    dispose = mocks.disposeSink
  }

  return { Input, BlobSource, CanvasSink, ALL_FORMATS: [] }
})

import { useSelectionStore } from '@/shared/state/selection'
import {
  makeTimelineAudioItem,
  makeTimelineTrack,
  makeTimelineVideoItem,
} from '../../../test-helpers'
import { useItemsStore } from '../../items-store'
import { useTimelineCommandStore } from '../../timeline-command-store'
import { useTimelineSettingsStore } from '../../timeline-settings-store'
import { useTransitionsStore } from '../../transitions-store'
import { insertFreezeFrame } from './freeze-frame-actions'

const originalSplitItem = useItemsStore.getState()._splitItem
const originalAddItem = useItemsStore.getState()._addItem

const generatedMedia = {
  id: 'freeze-media',
  fileName: 'freeze.png',
  mimeType: 'image/png',
  duration: 0,
  createdAt: 1,
  updatedAt: 1,
}

function videoTrack(overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return makeTimelineTrack({
    id: 'video-track',
    name: 'V1',
    kind: 'video',
    order: 0,
    ...overrides,
  })
}

function video(overrides: Partial<Extract<TimelineItem, { type: 'video' }>> = {}) {
  return makeTimelineVideoItem({
    id: 'video',
    trackId: 'video-track',
    from: 0,
    durationInFrames: 120,
    sourceStart: 0,
    sourceEnd: 120,
    sourceDuration: 120,
    sourceFps: 30,
    mediaId: 'media-1',
    ...overrides,
  })
}

function snapshot() {
  return {
    items: structuredClone(useItemsStore.getState().items),
    tracks: structuredClone(useItemsStore.getState().tracks),
    transitions: structuredClone(useTransitionsStore.getState().transitions),
    selection: structuredClone(useSelectionStore.getState().selectedItemIds),
    dirty: useTimelineSettingsStore.getState().isDirty,
    undoDepth: useTimelineCommandStore.getState().undoStack.length,
    redoDepth: useTimelineCommandStore.getState().redoStack.length,
    mediaItems: structuredClone(mocks.mediaItems),
  }
}

function expectSnapshot(expected: ReturnType<typeof snapshot>): void {
  expect(useItemsStore.getState().items).toEqual(expected.items)
  expect(useItemsStore.getState().tracks).toEqual(expected.tracks)
  expect(useTransitionsStore.getState().transitions).toEqual(expected.transitions)
  expect(useSelectionStore.getState().selectedItemIds).toEqual(expected.selection)
  expect(useTimelineSettingsStore.getState().isDirty).toBe(expected.dirty)
  expect(useTimelineCommandStore.getState().undoStack).toHaveLength(expected.undoDepth)
  expect(useTimelineCommandStore.getState().redoStack).toHaveLength(expected.redoDepth)
  expect(mocks.mediaItems).toEqual(expected.mediaItems)
}

function deferGeneratedImageImport() {
  let release!: (media: typeof generatedMedia) => void
  let reportStarted!: () => void
  const started = new Promise<void>((resolve) => {
    reportStarted = resolve
  })
  mocks.importGeneratedImage.mockImplementation(
    () =>
      new Promise<typeof generatedMedia>((resolve) => {
        release = resolve
        reportStarted()
      }),
  )
  return { started, release: () => release(generatedMedia) }
}

describe('freeze-frame async atomicity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useItemsStore.setState({ _splitItem: originalSplitItem, _addItem: originalAddItem })
    useItemsStore.getState().setTracks([videoTrack()])
    useItemsStore.getState().setItems([video()])
    useTransitionsStore.getState().setTransitions([])
    useSelectionStore.getState().clearSelection()
    useSelectionStore.getState().selectItems(['sentinel-selection'])
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })

    mocks.mediaItems = [{ id: 'media-1', fileName: 'source.mp4' }]
    mocks.mediaState.currentProjectId = 'project-1'
    mocks.mediaState.mediaById = {
      'media-1': {
        id: 'media-1',
        fileName: 'source.mp4',
        mimeType: 'video/mp4',
        duration: 4,
        fps: 30,
      },
    }
    mocks.getMediaFile.mockResolvedValue(new Blob(['video'], { type: 'video/mp4' }))
    mocks.getPrimaryVideoTrack.mockResolvedValue({ displayWidth: 1920, displayHeight: 1080 })
    mocks.getCanvas.mockResolvedValue({
      canvas: {
        convertToBlob: async () => new Blob(['frame'], { type: 'image/png' }),
      },
    })
    mocks.importGeneratedImage.mockResolvedValue(generatedMedia)
    mocks.deleteMediaFromProject.mockResolvedValue(undefined)
    mocks.acquire.mockReturnValue('blob:freeze-media')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps a successful output and undoes the timeline mutation in one step', async () => {
    await expect(insertFreezeFrame('video', 60)).resolves.toBe(true)

    expect(mocks.deleteMediaFromProject).not.toHaveBeenCalled()
    expect(mocks.release).not.toHaveBeenCalled()
    expect(mocks.prependMediaItem).toHaveBeenCalledWith(generatedMedia)
    expect(useItemsStore.getState().items).toHaveLength(3)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)

    useTimelineCommandStore.getState().undo()
    expect(useItemsStore.getState().items).toEqual([video()])
  })

  it('does not write or shift the old lane after the source item moves lanes', async () => {
    useItemsStore
      .getState()
      .setTracks([videoTrack(), videoTrack({ id: 'video-track-2', name: 'V2', order: 1 })])
    useItemsStore.getState().setItems([video(), video({ id: 'old-lane-downstream', from: 120 })])
    const deferred = deferGeneratedImageImport()
    const pending = insertFreezeFrame('video', 60)
    await deferred.started

    useItemsStore.getState()._moveItem('video', 0, 'video-track-2')
    useItemsStore
      .getState()
      .setTracks([
        videoTrack({ locked: true }),
        videoTrack({ id: 'video-track-2', name: 'V2', order: 1 }),
      ])
    const before = snapshot()
    deferred.release()

    await expect(pending).resolves.toBe(false)
    expectSnapshot(before)
    expect(mocks.deleteMediaFromProject).toHaveBeenCalledWith('project-1', 'freeze-media')
    expect(mocks.release).toHaveBeenCalledWith('freeze-media')
  })

  it('rejects a target track lock that appears while persistence is awaiting', async () => {
    const deferred = deferGeneratedImageImport()
    const pending = insertFreezeFrame('video', 60)
    await deferred.started

    useItemsStore.getState().setTracks([videoTrack({ locked: true })])
    const before = snapshot()
    deferred.release()

    await expect(pending).resolves.toBe(false)
    expectSnapshot(before)
    expect(mocks.deleteMediaFromProject).toHaveBeenCalledWith('project-1', 'freeze-media')
    expect(mocks.release).toHaveBeenCalledWith('freeze-media')
  })

  it.each([
    ['deletion', () => useItemsStore.getState()._removeItems(['video'])],
    ['source change', () => useItemsStore.getState()._updateItem('video', { sourceStart: 12 })],
  ])(
    'rejects source item %s after persistence and cleans media/blob state',
    async (_case, drift) => {
      const deferred = deferGeneratedImageImport()
      const pending = insertFreezeFrame('video', 60)
      await deferred.started

      drift()
      const before = snapshot()
      deferred.release()

      await expect(pending).resolves.toBe(false)
      expectSnapshot(before)
      expect(mocks.deleteMediaFromProject).toHaveBeenCalledWith('project-1', 'freeze-media')
      expect(mocks.release).toHaveBeenCalledWith('freeze-media')
      expect(mocks.prependMediaItem).not.toHaveBeenCalled()
    },
  )

  it('rejects source media deletion after persistence and cleans media/blob state', async () => {
    const deferred = deferGeneratedImageImport()
    const pending = insertFreezeFrame('video', 60)
    await deferred.started

    delete mocks.mediaState.mediaById['media-1']
    const before = snapshot()
    deferred.release()

    await expect(pending).resolves.toBe(false)
    expectSnapshot(before)
    expect(mocks.deleteMediaFromProject).toHaveBeenCalledWith('project-1', 'freeze-media')
    expect(mocks.release).toHaveBeenCalledWith('freeze-media')
  })

  it('rejects downstream lane cohort drift after persistence', async () => {
    const deferred = deferGeneratedImageImport()
    const pending = insertFreezeFrame('video', 60)
    await deferred.started

    useItemsStore.getState()._addItem(video({ id: 'late-item', from: 120 }))
    const before = snapshot()
    deferred.release()

    await expect(pending).resolves.toBe(false)
    expectSnapshot(before)
    expect(mocks.deleteMediaFromProject).toHaveBeenCalledWith('project-1', 'freeze-media')
    expect(mocks.release).toHaveBeenCalledWith('freeze-media')
  })

  it('rejects linked companion drift after persistence', async () => {
    const audioTrack = makeTimelineTrack({
      id: 'audio-track',
      name: 'A1',
      kind: 'audio',
      order: 1,
    })
    const linkedVideo = video({ linkedGroupId: 'linked-av' })
    const linkedAudio: AudioItem = makeTimelineAudioItem({
      id: 'audio',
      trackId: 'audio-track',
      linkedGroupId: 'linked-av',
      from: 0,
      durationInFrames: 120,
      sourceStart: 0,
      sourceEnd: 120,
      sourceDuration: 120,
      mediaId: 'media-1',
    })
    useItemsStore.getState().setTracks([videoTrack(), audioTrack])
    useItemsStore.getState().setItems([linkedVideo, linkedAudio])
    const deferred = deferGeneratedImageImport()
    const pending = insertFreezeFrame('video', 60)
    await deferred.started

    useItemsStore.getState()._moveItem('audio', 12)
    const before = snapshot()
    deferred.release()

    await expect(pending).resolves.toBe(false)
    expectSnapshot(before)
    expect(mocks.deleteMediaFromProject).toHaveBeenCalledWith('project-1', 'freeze-media')
    expect(mocks.release).toHaveBeenCalledWith('freeze-media')
  })

  it('cleans persisted media when blob URL acquisition throws', async () => {
    mocks.acquire.mockImplementation(() => {
      throw new Error('blob acquisition failed')
    })
    const before = snapshot()

    await expect(insertFreezeFrame('video', 60)).resolves.toBe(false)

    expectSnapshot(before)
    expect(mocks.deleteMediaFromProject).toHaveBeenCalledWith('project-1', 'freeze-media')
    expect(mocks.release).toHaveBeenCalledWith('freeze-media')
  })

  it.each([
    ['returns false', () => vi.spyOn(useItemsStore.getState(), '_splitItem').mockReturnValue(null)],
    [
      'throws',
      () =>
        vi.spyOn(useItemsStore.getState(), '_splitItem').mockImplementation(() => {
          throw new Error('split mutation failed')
        }),
    ],
    [
      'throws after splitting',
      () =>
        vi.spyOn(useItemsStore.getState(), '_addItem').mockImplementation(() => {
          throw new Error('add mutation failed')
        }),
    ],
  ])('cleans persisted media when execute %s', async (_case, mockSplit) => {
    mockSplit()
    const before = snapshot()

    await expect(insertFreezeFrame('video', 60)).resolves.toBe(false)

    expectSnapshot(before)
    expect(mocks.deleteMediaFromProject).toHaveBeenCalledWith('project-1', 'freeze-media')
    expect(mocks.release).toHaveBeenCalledWith('freeze-media')
    expect(mocks.prependMediaItem).not.toHaveBeenCalled()
  })

  it('does not remove successful persisted output when the media UI prepend throws', async () => {
    mocks.prependMediaItem.mockImplementation(() => {
      throw new Error('media UI refresh failed')
    })

    await expect(insertFreezeFrame('video', 60)).resolves.toBe(true)

    expect(useItemsStore.getState().items).toHaveLength(3)
    expect(mocks.deleteMediaFromProject).not.toHaveBeenCalled()
    expect(mocks.release).not.toHaveBeenCalled()
  })
})
