// @vitest-environment node

import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vite-plus/test'
import {
  controlledDocumentToFreeCutDocument,
  createCodePressCommandAdapter,
  freeCutDocumentToControlledDocument,
  type EditCommandBatch,
  type MediaReference,
} from '@/features/editor/codepress'
import {
  DEFAULT_HOST_CAPABILITIES,
  SUPPORTED_HOST_COMMANDS,
  capabilityForCommand,
  createLocalEditorHost,
  type EditorHost,
  type EmbeddedEditorSnapshot,
  type HostEditResult,
  type MediaLocator,
} from './contract'
import { HostEditorController, deriveSupportedHostEdit } from './controller'
import { hostSnapshotToNativeTimeline, nativeTimelineToFrameDocument } from './document'
import { EmbeddedEditorHostRuntime } from './runtime'
import { useMediaLibraryStore } from '@/features/editor/deps/media-library'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'

const mediaReference: MediaReference = {
  media_id: 'media-1',
  media_kind: 'video',
  content_hash: 'sha256:media-1',
  duration_us: 10_000_000,
  availability: { mode: 'cloud', cloud: { object_id: 'opaque-media-object-1' } },
}

function snapshot(
  overrides: Partial<EmbeddedEditorSnapshot['timeline']> = {},
): EmbeddedEditorSnapshot {
  return {
    project: {
      id: 'project-1',
      name: 'Host project',
      width: 1920,
      height: 1080,
      fps: 30,
      backgroundColor: '#000000',
    },
    timeline: {
      timelineId: 'timeline-1',
      revision: 0,
      fps: 30,
      durationInFrames: 300,
      media: [mediaReference],
      tracks: [
        {
          id: 'track-1',
          kind: 'video',
          name: 'Video 1',
          locked: false,
          muted: false,
          items: [
            {
              type: 'video',
              id: 'clip-1',
              trackId: 'track-1',
              mediaId: 'media-1',
              from: 0,
              durationInFrames: 60,
              sourceStart: 0,
              sourceEnd: 60,
            },
          ],
        },
      ],
      width: 1920,
      height: 1080,
      backgroundColor: '#000000',
      ...overrides,
    },
    assets: [
      {
        id: 'media-1',
        kind: 'video',
        fileName: 'host-video.mp4',
        mimeType: 'video/mp4',
        durationSeconds: 10,
        width: 1920,
        height: 1080,
        fps: 30,
        contentHash: 'sha256:media-1',
      },
    ],
  }
}

function movedSnapshot(): EmbeddedEditorSnapshot {
  const base = snapshot()
  const [track] = base.timeline.tracks
  return {
    ...base,
    timeline: {
      ...base.timeline,
      tracks: [
        {
          ...track!,
          items: [{ ...track!.items[0]!, from: 30 }],
        },
      ],
    },
  }
}

interface FakeHostHarness {
  host: EditorHost
  submitEdit: ReturnType<typeof vi.fn>
  remoteAdapter: ReturnType<typeof createCodePressCommandAdapter>
  getRemoteSnapshot: () => EmbeddedEditorSnapshot
}

function createFakeHost(
  initial: EmbeddedEditorSnapshot,
  capabilities: EditorHost['capabilities'] = DEFAULT_HOST_CAPABILITIES,
): FakeHostHarness {
  const remoteAdapter = createCodePressCommandAdapter({
    document: freeCutDocumentToControlledDocument(initial.timeline),
  })
  let remoteSnapshot = initial
  const submitEdit = vi.fn(async (batch: EditCommandBatch): Promise<HostEditResult> => {
    const result = remoteAdapter.apply(batch)
    if (result.status === 'rejected') {
      return {
        status: result.error.code === 'revision_conflict' ? 'conflict' : 'rejected',
        snapshot: remoteSnapshot,
        result,
      }
    }

    remoteSnapshot = {
      ...remoteSnapshot,
      timeline: controlledDocumentToFreeCutDocument(remoteAdapter.getDocument()),
    }
    return { status: result.status, snapshot: remoteSnapshot, result }
  })
  const host: EditorHost = {
    capabilities,
    load: () => initial,
    resolveMedia: vi.fn(async (locator: MediaLocator) => ({
      source: `https://host.invalid/media/${locator.mediaId}`,
      expiresAt: 123,
    })),
    submitEdit,
  }
  return { host, submitEdit, remoteAdapter, getRemoteSnapshot: () => remoteSnapshot }
}

function commandForMove(initial: EmbeddedEditorSnapshot): EditCommandBatch {
  const derived = deriveSupportedHostEdit(initial.timeline, movedSnapshot().timeline, {
    operationId: 'operation-move-1',
    idempotencyKey: 'idempotency-move-1',
  })
  expect(derived.batch).not.toBeNull()
  return derived.batch!
}

describe('embedded FreeCut host controller', () => {
  it('loads a fake-host snapshot and resolves an opaque media locator', async () => {
    const initial = snapshot()
    const harness = createFakeHost(initial, {})
    const loaded = await harness.host.load()
    const controller = new HostEditorController(harness.host, loaded)
    const locator: MediaLocator = { mediaId: 'media-1', kind: 'video', variant: 'source' }

    expect(controller.getSnapshot().project.id).toBe('project-1')
    await expect(controller.resolveMedia(locator)).resolves.toMatchObject({
      source: 'https://host.invalid/media/media-1',
    })
    expect(harness.host.resolveMedia).toHaveBeenCalledWith(locator)
    expect(hostSnapshotToNativeTimeline(initial).items[0]).toMatchObject({
      mediaId: 'media-1',
      src: '',
    })
  })

  it('keeps caption styles and caption-role items on the host-backed native bridge', () => {
    const initial = snapshot({
      tracks: [
        {
          id: 'caption-track',
          kind: 'caption',
          name: 'English',
          language: 'en',
          locked: false,
          muted: false,
          defaultStyle: { font_family: 'Inter', background_opacity: 0.6 },
          items: [
            {
              type: 'caption_cue',
              id: 'caption-cue',
              trackId: 'caption-track',
              from: 10,
              durationInFrames: 30,
              text: 'Hello host',
              style: { font_size: 48, alignment: 'center', background_opacity: 0.35 },
            },
          ],
        },
      ],
    })
    const native = hostSnapshotToNativeTimeline(initial)
    expect(native.items[0]).toMatchObject({
      type: 'text',
      textRole: 'caption',
      fontSize: 48,
      textAlign: 'center',
      backgroundOpacity: 0.35,
    })

    const converted = nativeTimelineToFrameDocument(
      { tracks: native.tracks, items: native.items, fps: native.fps },
      initial.timeline,
    )
    expect(converted).toMatchObject({ ok: true })
    if (!converted.ok) return
    expect(converted.document.tracks[0]).toMatchObject({
      kind: 'caption',
      defaultStyle: { font_family: 'Inter', background_opacity: 0.6 },
    })
    expect(converted.document.tracks[0]?.items[0]).toMatchObject({
      type: 'caption_cue',
      id: 'caption-cue',
      from: 10,
      durationInFrames: 30,
      style: { background_opacity: 0.35 },
    })
    expect(capabilityForCommand('set_caption_style')).toBe('timeline.caption')
  })

  it('submits a supported edit and replaces state with the authoritative revision', async () => {
    const initial = snapshot()
    const harness = createFakeHost(initial)
    const controller = new HostEditorController(harness.host, initial)
    const batch = commandForMove(initial)

    const result = await controller.submitEdit(batch)

    expect(result.status).toBe('applied')
    expect(harness.submitEdit).toHaveBeenCalledWith(batch)
    expect(controller.getSnapshot().timeline.revision).toBe(1)
    expect(controller.getSnapshot().timeline.tracks[0]!.items[0]).toMatchObject({ from: 30 })
  })

  it('keeps transformed clip moves supported across native transform key names', () => {
    const base = snapshot()
    const track = base.timeline.tracks[0]!
    const transformed = {
      ...base,
      timeline: {
        ...base.timeline,
        tracks: [
          {
            ...track,
            items: [
              {
                ...track.items[0]!,
                transform: {
                  position_x: 12,
                  position_y: -8,
                  scale_x: 1,
                  scale_y: 1,
                  rotation_degrees: 0,
                  anchor_x: 0,
                  anchor_y: 0,
                },
              },
            ],
          },
        ],
      },
    }
    const next = {
      ...transformed,
      timeline: {
        ...transformed.timeline,
        tracks: [
          {
            ...transformed.timeline.tracks[0]!,
            items: [{ ...transformed.timeline.tracks[0]!.items[0]!, from: 30 }],
          },
        ],
      },
    }

    expect(
      deriveSupportedHostEdit(transformed.timeline, next.timeline, {
        operationId: 'operation-transformed-move',
        idempotencyKey: 'idempotency-transformed-move',
      }).batch?.commands[0]?.type,
    ).toBe('move_item')
  })

  it('supports authoritative replacement and idempotent replay', async () => {
    const initial = snapshot()
    const harness = createFakeHost(initial)
    const controller = new HostEditorController(harness.host, initial)
    const batch = commandForMove(initial)

    await expect(controller.submitEdit(batch)).resolves.toMatchObject({ status: 'applied' })
    await expect(controller.submitEdit(batch)).resolves.toMatchObject({ status: 'replayed' })

    const replacement = {
      ...initial,
      timeline: { ...initial.timeline, revision: 17, durationInFrames: 600 },
    }
    controller.replaceAuthoritativeSnapshot(replacement)
    expect(controller.getSnapshot().timeline.revision).toBe(17)
    expect(controller.getDocument().timeline.revision).toBe(17)
  })

  it('returns a conflict and adopts the host snapshot when the remote revision is stale', async () => {
    const initial = snapshot()
    const harness = createFakeHost(initial)
    const remoteChange = harness.remoteAdapter.apply({
      contract_version: 1,
      timeline_id: 'timeline-1',
      operation_id: 'remote-change',
      idempotency_key: 'remote-change-idem',
      base_revision: 0,
      preconditions: [],
      commands: [
        {
          command_id: 'remote-move',
          type: 'move_item',
          item_id: 'clip-1',
          to_track_id: 'track-1',
          timeline_start_us: 1_000_000,
          index: 0,
        },
      ],
    })
    expect(remoteChange.status).toBe('applied')
    const conflictSnapshot = {
      ...initial,
      timeline: {
        ...initial.timeline,
        revision: 1,
        tracks: [
          {
            ...initial.timeline.tracks[0]!,
            items: [{ ...initial.timeline.tracks[0]!.items[0]!, from: 30 }],
          },
        ],
      },
    }
    harness.submitEdit.mockImplementation(async (batch: EditCommandBatch) => {
      const result = harness.remoteAdapter.apply(batch)
      if (result.status !== 'rejected') throw new Error('expected stale remote revision')
      return { status: 'conflict', snapshot: conflictSnapshot, result }
    })
    const controller = new HostEditorController(harness.host, initial)
    const result = await controller.submitEdit(commandForMove(initial))

    expect(result.status).toBe('conflict')
    expect(controller.getSnapshot().timeline.revision).toBe(1)
    expect(controller.getSnapshot().timeline.tracks[0]!.items[0]).toMatchObject({ from: 30 })
  })

  it('submits a transcript ripple_delete batch through timeline.remove', async () => {
    const initial = snapshot()
    const harness = createFakeHost(initial)
    const controller = new HostEditorController(harness.host, initial)
    const batch: EditCommandBatch = {
      contract_version: 1,
      timeline_id: initial.timeline.timelineId,
      operation_id: 'operation-ripple-1',
      idempotency_key: 'idempotency-ripple-1',
      base_revision: 0,
      preconditions: [],
      commands: [
        {
          command_id: 'transcript-cut-1',
          type: 'ripple_delete',
          start_us: 500_000,
          end_us: 1_000_000,
          track_ids: null,
        },
      ],
    }

    expect(capabilityForCommand('ripple_delete')).toBe('timeline.remove')

    const result = await controller.submitEdit(batch)

    expect(result.status).toBe('applied')
    expect(harness.submitEdit).toHaveBeenCalledWith(batch)
    expect(controller.getSnapshot().timeline.revision).toBe(1)
  })

  it('gates a ripple_delete batch when timeline.remove is off', async () => {
    const initial = snapshot()
    const harness = createFakeHost(initial, {
      ...DEFAULT_HOST_CAPABILITIES,
      'timeline.remove': false,
    })
    const controller = new HostEditorController(harness.host, initial)

    const result = await controller.submitEdit({
      contract_version: 1,
      timeline_id: initial.timeline.timelineId,
      operation_id: 'operation-ripple-2',
      idempotency_key: 'idempotency-ripple-2',
      base_revision: 0,
      preconditions: [],
      commands: [
        {
          command_id: 'transcript-cut-2',
          type: 'ripple_delete',
          start_us: 500_000,
          end_us: 1_000_000,
          track_ids: null,
        },
      ],
    })

    expect(result.status).toBe('unsupported')
    expect(harness.submitEdit).not.toHaveBeenCalled()
  })

  it('gates unsupported capabilities before calling the host', async () => {
    const initial = snapshot()
    const harness = createFakeHost(initial, {
      ...DEFAULT_HOST_CAPABILITIES,
      'timeline.move': false,
    })
    const controller = new HostEditorController(harness.host, initial)

    const result = await controller.submitEdit(commandForMove(initial))

    expect(result.status).toBe('unsupported')
    expect(harness.submitEdit).not.toHaveBeenCalled()
    expect(controller.getSnapshot().timeline.revision).toBe(0)
  })

  it('keeps host mode outside local persistence and blob-url acquisition', async () => {
    const runtimeSource = readFileSync(new URL('./runtime.ts', import.meta.url), 'utf8')
    expect(runtimeSource).not.toMatch(
      /\b(loadTimeline|saveTimeline|loadMediaItems|getProject|updateProject)\b/,
    )

    const { installRuntimeMediaResolver, resolveMediaUrl } =
      await import('@/features/editor/deps/media-library')
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL')
    const cleanup = installRuntimeMediaResolver((mediaId) => `https://host.invalid/${mediaId}`)
    await expect(resolveMediaUrl('media-1')).resolves.toBe('https://host.invalid/media-1')
    expect(createObjectUrl).not.toHaveBeenCalled()
    cleanup()
    createObjectUrl.mockRestore()
  })

  it('mounts host stores without invoking local project or timeline loaders', () => {
    const initial = snapshot()
    const harness = createFakeHost(initial)
    const loadTimeline = vi.spyOn(useTimelineStore.getState(), 'loadTimeline')
    const loadMediaItems = vi.spyOn(useMediaLibraryStore.getState(), 'loadMediaItems')
    const runtime = new EmbeddedEditorHostRuntime(harness.host, initial)

    runtime.mountStores()
    runtime.unmountStores()

    expect(loadTimeline).not.toHaveBeenCalled()
    expect(loadMediaItems).not.toHaveBeenCalled()
    loadTimeline.mockRestore()
    loadMediaItems.mockRestore()
  })

  it('keeps the public host adapter bounded to the supported command slice', () => {
    expect(SUPPORTED_HOST_COMMANDS).toEqual([
      'add_clip',
      'add_text',
      'move_item',
      'trim_item',
      'split_item',
      'remove_item',
      'ripple_delete',
      'add_track',
      'update_track',
      'add_caption_track',
      'remove_caption_track',
      'update_caption_track',
      'upsert_caption_cues',
      'remove_caption_cues',
      'set_caption_style',
    ])
    const adapter = createLocalEditorHost({
      load: () => snapshot(),
      resolveMedia: () => null,
      submitEdit: () => {
        throw new Error('not used')
      },
    })
    expect(adapter.capabilities).toEqual({})
  })

  describe('host round-trip stability', () => {
    async function flushReconcile(): Promise<void> {
      for (let i = 0; i < 10; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }

    function minimalTwoClipSnapshot(): EmbeddedEditorSnapshot {
      const initial = snapshot()
      const track = initial.timeline.tracks[0]!
      return {
        ...initial,
        timeline: {
          ...initial.timeline,
          tracks: [
            {
              ...track,
              items: [
                // Minimal host clips: no volume/speed/opacity/transform keys,
                // and clip-2 omits sourceStart/sourceEnd entirely.
                {
                  type: 'video',
                  id: 'clip-1',
                  trackId: 'track-1',
                  mediaId: 'media-1',
                  from: 0,
                  durationInFrames: 60,
                  sourceStart: 0,
                  sourceEnd: 60,
                },
                {
                  type: 'video',
                  id: 'clip-2',
                  trackId: 'track-1',
                  mediaId: 'media-1',
                  from: 60,
                  durationInFrames: 60,
                },
              ],
            },
          ],
        },
      }
    }

    it('derives a move_item command for a store drag of a minimal host clip', async () => {
      const initial = minimalTwoClipSnapshot()
      const harness = createFakeHost(initial)
      const runtime = new EmbeddedEditorHostRuntime(harness.host, initial)
      runtime.mountStores()
      try {
        useTimelineStore.getState().moveItem('clip-1', 30)
        await flushReconcile()

        expect(harness.submitEdit).toHaveBeenCalledTimes(1)
        const batch = harness.submitEdit.mock.calls[0]![0] as EditCommandBatch
        expect(batch.commands).toEqual([
          expect.objectContaining({ type: 'move_item', item_id: 'clip-1' }),
        ])
        // The untouched clip must not leak into the derived change set.
        expect(batch.commands.some((command) => command.command_id.includes('clip-2'))).toBe(false)
      } finally {
        runtime.unmountStores()
      }
    })

    it('derives a trim_item command for a store trim of a minimal host clip', async () => {
      const initial = minimalTwoClipSnapshot()
      const harness = createFakeHost(initial)
      const runtime = new EmbeddedEditorHostRuntime(harness.host, initial)
      runtime.mountStores()
      try {
        useTimelineStore.getState().updateItem('clip-1', { durationInFrames: 40, sourceEnd: 40 })
        await flushReconcile()

        expect(harness.submitEdit).toHaveBeenCalledTimes(1)
        const batch = harness.submitEdit.mock.calls[0]![0] as EditCommandBatch
        expect(batch.commands).toEqual([
          expect.objectContaining({ type: 'trim_item', item_id: 'clip-1', edge: 'end' }),
        ])
      } finally {
        runtime.unmountStores()
      }
    })

    it('derives a move_item command for a host text item with the default color', async () => {
      const initial = snapshot()
      const track = initial.timeline.tracks[0]!
      const withText: EmbeddedEditorSnapshot = {
        ...initial,
        timeline: {
          ...initial.timeline,
          tracks: [
            {
              ...track,
              items: [
                ...track.items,
                {
                  type: 'text',
                  id: 'text-1',
                  trackId: 'track-1',
                  from: 10,
                  durationInFrames: 20,
                  text: 'Hello host',
                },
              ],
            },
          ],
        },
      }
      const harness = createFakeHost(withText)
      const runtime = new EmbeddedEditorHostRuntime(harness.host, withText)
      runtime.mountStores()
      try {
        // The native bridge defaults the text color to #ffffff; the round trip
        // must not turn that default into a style mutation.
        expect(
          useTimelineStore.getState().items.find((item) => item.id === 'text-1'),
        ).toMatchObject({ type: 'text', color: '#ffffff' })

        useTimelineStore.getState().moveItem('text-1', 40)
        await flushReconcile()

        expect(harness.submitEdit).toHaveBeenCalledTimes(1)
        const batch = harness.submitEdit.mock.calls[0]![0] as EditCommandBatch
        expect(batch.commands).toEqual([
          expect.objectContaining({ type: 'move_item', item_id: 'text-1' }),
        ])
      } finally {
        runtime.unmountStores()
      }
    })

    it('keeps a clip carrying top-level opacity movable through the round trip', async () => {
      const initial = snapshot()
      const track = initial.timeline.tracks[0]!
      const clip = track.items[0]!
      if (clip.type !== 'video') throw new Error('expected a video clip')
      const withOpacity: EmbeddedEditorSnapshot = {
        ...initial,
        timeline: {
          ...initial.timeline,
          tracks: [
            {
              ...track,
              items: [{ ...clip, opacity: 0.5 }],
            },
          ],
        },
      }
      const harness = createFakeHost(withOpacity)
      const runtime = new EmbeddedEditorHostRuntime(harness.host, withOpacity)
      runtime.mountStores()
      try {
        useTimelineStore.getState().moveItem('clip-1', 30)
        await flushReconcile()

        expect(harness.submitEdit).toHaveBeenCalledTimes(1)
        const batch = harness.submitEdit.mock.calls[0]![0] as EditCommandBatch
        expect(batch.commands).toEqual([
          expect.objectContaining({ type: 'move_item', item_id: 'clip-1' }),
        ])
      } finally {
        runtime.unmountStores()
      }
    })

    it('batches one remove_item command per removed item', () => {
      const initial = minimalTwoClipSnapshot()
      const next: EmbeddedEditorSnapshot = {
        ...initial,
        timeline: {
          ...initial.timeline,
          tracks: [{ ...initial.timeline.tracks[0]!, items: [] }],
        },
      }

      const derived = deriveSupportedHostEdit(initial.timeline, next.timeline, {
        operationId: 'operation-remove-2',
        idempotencyKey: 'idempotency-remove-2',
      })

      expect(derived.batch?.commands).toEqual([
        expect.objectContaining({ type: 'remove_item', item_id: 'clip-1' }),
        expect.objectContaining({ type: 'remove_item', item_id: 'clip-2' }),
      ])
      expect(derived.batch?.preconditions).toHaveLength(2)
    })

    it('forwards a multi-select store removal to the host as one batched operation', async () => {
      const initial = minimalTwoClipSnapshot()
      const harness = createFakeHost(initial)
      const runtime = new EmbeddedEditorHostRuntime(harness.host, initial)
      runtime.mountStores()
      try {
        useTimelineStore.getState().removeItems(['clip-1', 'clip-2'])
        await flushReconcile()

        expect(harness.submitEdit).toHaveBeenCalledTimes(1)
        const batch = harness.submitEdit.mock.calls[0]![0] as EditCommandBatch
        expect(batch.commands).toEqual([
          expect.objectContaining({ type: 'remove_item', item_id: 'clip-1' }),
          expect.objectContaining({ type: 'remove_item', item_id: 'clip-2' }),
        ])
      } finally {
        runtime.unmountStores()
      }
    })

    it('rejects removals beyond the host per-operation command limit', () => {
      const initial = snapshot()
      const track = initial.timeline.tracks[0]!
      const items = Array.from({ length: 65 }, (_, index) => ({
        type: 'video' as const,
        id: `clip-${index}`,
        trackId: 'track-1',
        mediaId: 'media-1',
        from: index * 60,
        durationInFrames: 60,
      }))
      const previous = {
        ...initial.timeline,
        tracks: [{ ...track, items }],
      }
      const next = {
        ...initial.timeline,
        tracks: [{ ...track, items: [] }],
      }

      const derived = deriveSupportedHostEdit(previous, next)

      expect(derived.batch).toBeNull()
      expect(derived.reason).toMatch(/exceeds the 64-command host operation limit/)
    })
  })
})
