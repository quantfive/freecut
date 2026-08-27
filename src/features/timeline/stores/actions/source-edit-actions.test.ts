// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'

const mocks = vi.hoisted(() => ({
  mediaById: {} as Record<string, unknown>,
  resolveMediaUrl: async (): Promise<string | null> => 'blob:source-media',
}))

vi.mock('@/features/timeline/deps/media-library-store', () => ({
  useMediaLibraryStore: {
    getState: () => ({ mediaById: mocks.mediaById }),
  },
}))

vi.mock('@/features/timeline/deps/projects', () => ({
  useProjectStore: {
    getState: () => ({
      currentProject: { metadata: { width: 1920, height: 1080, fps: 30 } },
    }),
  },
}))

vi.mock('@/features/timeline/deps/media-library-service', () => ({
  importMediaLibraryService: async () => ({
    mediaLibraryService: {
      getThumbnailBlobUrl: async () => null,
    },
  }),
}))

vi.mock('@/features/timeline/deps/media-library-resolver', () => ({
  getMediaType: (mimeType: string) =>
    mimeType.startsWith('video')
      ? 'video'
      : mimeType.startsWith('audio')
        ? 'audio'
        : mimeType.startsWith('image')
          ? 'image'
          : 'unknown',
  resolveMediaUrl: () => mocks.resolveMediaUrl(),
}))

import { makeTimelineTrack, makeTimelineVideoItem } from '../../test-helpers'
import { resetPlaybackPreviewState } from '@/shared/state/playback-preview-test-helpers'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import { useSourcePlayerStore } from '@/shared/state/source-player'
import { usePlaybackStore } from '@/shared/state/playback'
import { useItemsStore } from '../items-store'
import { useTransitionsStore } from '../transitions-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { performInsertEdit, performOverwriteEdit } from './source-edit-actions'

function setSourceMedia(overrides: Record<string, unknown> = {}) {
  mocks.mediaById = {
    'media-1': {
      id: 'media-1',
      fileName: 'clip.mp4',
      mimeType: 'video/mp4',
      duration: 4, // seconds → 120 source frames at 30fps
      fps: 30,
      width: 1920,
      height: 1080,
      audioCodec: undefined, // video-only by default — keeps tests on one track
      ...overrides,
    },
  }
}

function trackItems(trackId: string): TimelineItem[] {
  return useItemsStore
    .getState()
    .items.filter((item) => item.trackId === trackId)
    .sort((a, b) => a.from - b.from)
}

describe('source edit actions', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useItemsStore
      .getState()
      .setTracks([
        makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 }),
        makeTimelineTrack({ id: 'track-a1', name: 'A1', kind: 'audio', order: 1 }),
      ])
    useItemsStore.getState().setItems([])
    useTransitionsStore.getState().setTransitions([])
    useSelectionStore.getState().setActiveTrack(null)
    useEditorStore.setState({
      sourcePreviewMediaId: 'media-1',
      sourcePatchVideoEnabled: true,
      sourcePatchAudioEnabled: true,
      sourcePatchVideoTrackId: null,
      sourcePatchAudioTrackId: null,
    })
    useSourcePlayerStore.setState({ inPoint: 30, outPoint: 90 })
    resetPlaybackPreviewState(0)
    mocks.resolveMediaUrl = async () => 'blob:source-media'
    setSourceMedia()
  })

  describe('performInsertEdit', () => {
    it('inserts the in/out range at the playhead on an empty track', async () => {
      usePlaybackStore.setState({ currentFrame: 10 })

      await performInsertEdit()

      const items = trackItems('track-v1')
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({
        from: 10,
        durationInFrames: 60,
        sourceStart: 30,
        sourceEnd: 90,
        mediaId: 'media-1',
      })
      // Playhead advances to the end of the inserted clip
      expect(usePlaybackStore.getState().currentFrame).toBe(70)
      expect(useTimelineSettingsStore.getState().isDirty).toBe(true)
    })

    it('splits a straddling clip and shifts downstream items right', async () => {
      useItemsStore.getState().setItems([
        makeTimelineVideoItem({
          id: 'existing',
          from: 0,
          durationInFrames: 120,
          sourceEnd: 120,
          sourceDuration: 120,
        }),
      ])
      usePlaybackStore.setState({ currentFrame: 50 })

      await performInsertEdit()

      const items = trackItems('track-v1')
      expect(items).toHaveLength(3)
      // Left half of the split stays put
      expect(items[0]).toMatchObject({ from: 0, durationInFrames: 50 })
      // Inserted clip occupies the cut
      expect(items[1]).toMatchObject({ from: 50, durationInFrames: 60, mediaId: 'media-1' })
      // Right half shifted by the inserted duration
      expect(items[2]).toMatchObject({ from: 110, durationInFrames: 70 })
    })

    it('is undoable as a single entry', async () => {
      usePlaybackStore.setState({ currentFrame: 0 })
      const undoDepth = useTimelineCommandStore.getState().undoStack.length

      await performInsertEdit()
      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepth + 1)

      useTimelineCommandStore.getState().undo()
      expect(useItemsStore.getState().items).toHaveLength(0)
    })

    it('does nothing when no source is open in the source monitor', async () => {
      useEditorStore.setState({ sourcePreviewMediaId: null })

      await performInsertEdit()

      expect(useItemsStore.getState().items).toHaveLength(0)
    })

    it('auto-creates a new track instead of editing onto a locked one', async () => {
      useItemsStore
        .getState()
        .setTracks([
          makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0, locked: true }),
          makeTimelineTrack({ id: 'track-a1', name: 'A1', kind: 'audio', order: 1 }),
        ])
      usePlaybackStore.setState({ currentFrame: 0 })

      await performInsertEdit()

      // The locked track is skipped — a fresh video track receives the clip
      expect(trackItems('track-v1')).toHaveLength(0)
      const items = useItemsStore.getState().items
      expect(items).toHaveLength(1)
      const newTrack = useItemsStore.getState().tracks.find((t) => t.id === items[0]?.trackId)
      expect(newTrack?.locked).toBeFalsy()
      expect(newTrack?.id).not.toBe('track-v1')
    })

    it('creates a linked audio companion when the source has audio', async () => {
      setSourceMedia({ audioCodec: 'aac' })
      usePlaybackStore.setState({ currentFrame: 0 })

      await performInsertEdit()

      const videoItems = trackItems('track-v1')
      const audioItems = trackItems('track-a1')
      expect(videoItems).toHaveLength(1)
      expect(audioItems).toHaveLength(1)
      expect(videoItems[0]?.linkedGroupId).toBeTruthy()
      expect(audioItems[0]?.linkedGroupId).toBe(videoItems[0]?.linkedGroupId)
      expect(audioItems[0]).toMatchObject({ from: 0, durationInFrames: 60 })
    })

    it('treats an inherited group lock as a locked target lane', async () => {
      useItemsStore.getState().setTracks([
        makeTimelineTrack({
          id: 'group',
          name: 'Locked Group',
          order: 0,
          isGroup: true,
          locked: true,
        }),
        makeTimelineTrack({
          id: 'track-v1',
          name: 'V1',
          kind: 'video',
          order: 1,
          parentTrackId: 'group',
        }),
      ])
      usePlaybackStore.setState({ currentFrame: 0 })

      await performInsertEdit()

      expect(trackItems('track-v1')).toHaveLength(0)
      const inserted = useItemsStore.getState().items
      expect(inserted).toHaveLength(1)
      expect(inserted[0]?.trackId).not.toBe('track-v1')
    })

    it('revalidates target locks immediately before the async commit', async () => {
      let releaseUrl!: (url: string) => void
      let reportStarted!: () => void
      const started = new Promise<void>((resolve) => {
        reportStarted = resolve
      })
      mocks.resolveMediaUrl = () =>
        new Promise<string>((resolve) => {
          releaseUrl = resolve
          reportStarted()
        })
      usePlaybackStore.setState({ currentFrame: 0 })

      const pendingEdit = performInsertEdit()
      await started
      useItemsStore.getState().setTracks([
        makeTimelineTrack({
          id: 'track-v1',
          name: 'V1',
          kind: 'video',
          order: 0,
          locked: true,
        }),
        makeTimelineTrack({ id: 'track-a1', name: 'A1', kind: 'audio', order: 1 }),
      ])
      releaseUrl('blob:source-media')
      await pendingEdit

      expect(useItemsStore.getState().items).toHaveLength(0)
      expect(useItemsStore.getState().tracks[0]?.locked).toBe(true)
      expect(usePlaybackStore.getState().currentFrame).toBe(0)
      expect(useTimelineSettingsStore.getState().isDirty).toBe(false)
      expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
    })
  })

  describe('performOverwriteEdit', () => {
    it('overwrites the middle of a clip, preserving head and tail', async () => {
      useItemsStore.getState().setItems([
        makeTimelineVideoItem({
          id: 'existing',
          from: 0,
          durationInFrames: 120,
          sourceEnd: 120,
          sourceDuration: 120,
        }),
      ])
      usePlaybackStore.setState({ currentFrame: 30 })

      await performOverwriteEdit()

      const items = trackItems('track-v1')
      expect(items).toHaveLength(3)
      expect(items[0]).toMatchObject({ from: 0, durationInFrames: 30 })
      expect(items[1]).toMatchObject({ from: 30, durationInFrames: 60, mediaId: 'media-1' })
      expect(items[2]).toMatchObject({ from: 90, durationInFrames: 30 })
      // Timeline length unchanged — overwrite never shifts downstream content
      const last = items[2]!
      expect(last.from + last.durationInFrames).toBe(120)
      expect(usePlaybackStore.getState().currentFrame).toBe(90)
    })

    it('removes clips fully covered by the overwrite region', async () => {
      useItemsStore
        .getState()
        .setItems([makeTimelineVideoItem({ id: 'covered', from: 10, durationInFrames: 40 })])
      usePlaybackStore.setState({ currentFrame: 0 })

      await performOverwriteEdit()

      const items = trackItems('track-v1')
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({ from: 0, durationInFrames: 60, mediaId: 'media-1' })
      expect(items.find((item) => item.id === 'covered')).toBeUndefined()
    })

    it('trims only the overlapped tail of a preceding clip', async () => {
      useItemsStore
        .getState()
        .setItems([
          makeTimelineVideoItem({ id: 'head', from: 0, durationInFrames: 60, sourceEnd: 60 }),
        ])
      usePlaybackStore.setState({ currentFrame: 40 })

      await performOverwriteEdit()

      const items = trackItems('track-v1')
      expect(items).toHaveLength(2)
      expect(items[0]).toMatchObject({ from: 0, durationInFrames: 40 })
      expect(items[1]).toMatchObject({ from: 40, durationInFrames: 60, mediaId: 'media-1' })
    })
  })

  it.each([
    ['insert', performInsertEdit],
    ['overwrite', performOverwriteEdit],
  ])(
    'rejects %s atomically when an overlapping target clip has a locked linked companion',
    async (_name, action) => {
      for (const linkedSelectionEnabled of [true, false]) {
        useTimelineCommandStore.getState().clearHistory()
        useTimelineSettingsStore.setState({ isDirty: false })
        useEditorStore.setState({ linkedSelectionEnabled })
        useItemsStore.getState().setTracks([
          makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 }),
          makeTimelineTrack({
            id: 'track-a1',
            name: 'A1',
            kind: 'audio',
            order: 1,
            locked: true,
          }),
        ])
        const linkedVideo = makeTimelineVideoItem({
          id: 'existing-video',
          trackId: 'track-v1',
          from: 0,
          durationInFrames: 120,
          sourceEnd: 120,
          sourceDuration: 120,
          linkedGroupId: 'linked-av',
        })
        const linkedAudio: TimelineItem = {
          ...linkedVideo,
          id: 'existing-audio',
          type: 'audio',
          trackId: 'track-a1',
          src: 'blob:audio',
        }
        useItemsStore.getState().setItems([linkedVideo, linkedAudio])
        usePlaybackStore.setState({ currentFrame: 30 })
        const itemsBefore = structuredClone(useItemsStore.getState().items)
        const transitionsBefore = structuredClone(useTransitionsStore.getState().transitions)
        const playheadBefore = usePlaybackStore.getState().currentFrame

        await action()

        expect(useItemsStore.getState().items).toEqual(itemsBefore)
        expect(useTransitionsStore.getState().transitions).toEqual(transitionsBefore)
        expect(usePlaybackStore.getState().currentFrame).toBe(playheadBefore)
        expect(useTimelineSettingsStore.getState().isDirty).toBe(false)
        expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
      }
    },
  )
})
