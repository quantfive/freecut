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
  type HostAppliedEditResult,
  type HostEditResult,
  type HostNotice,
  type MediaLocator,
} from './contract'
import {
  HostEditorController,
  NO_SUPPORTED_EDIT_REASON,
  deriveRippleDelete,
  deriveSupportedHostEdit,
} from './controller'
import { framesToMicroseconds } from '@/features/editor/codepress/timing'
import { hostSnapshotToNativeTimeline, nativeTimelineToFrameDocument } from './document'
import { EmbeddedEditorHostRuntime } from './runtime'
import { useMediaLibraryStore } from '@/features/editor/deps/media-library'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import { usePlaybackStore } from '@/shared/state/playback'

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

  it('restores the validation adapter after transport rejection so Delete can retry', async () => {
    const initial = snapshot()
    let attempts = 0
    const submitEdit = vi.fn(async (_batch: EditCommandBatch): Promise<HostEditResult> => {
      attempts += 1
      if (attempts === 1) throw new Error('host transport unavailable')
      return {
        status: 'applied',
        snapshot: initial,
        result: { status: 'applied' } as HostAppliedEditResult['result'],
      }
    })
    const host: EditorHost = {
      capabilities: DEFAULT_HOST_CAPABILITIES,
      load: () => initial,
      resolveMedia: () => null,
      submitEdit,
    }
    const controller = new HostEditorController(host, initial)

    await expect(controller.requestRippleDelete(['clip-1'])).rejects.toThrow(
      'host transport unavailable',
    )
    await expect(controller.requestRippleDelete(['clip-1'])).resolves.toMatchObject({
      status: 'applied',
    })
    expect(submitEdit).toHaveBeenCalledTimes(2)
  })

  it('preserves regular text linked-group metadata through a supported host move', () => {
    const initial = snapshot({
      tracks: [
        {
          id: 'text-track',
          kind: 'video',
          name: 'Text',
          locked: false,
          muted: false,
          items: [
            {
              type: 'text',
              id: 'text-1',
              trackId: 'text-track',
              from: 0,
              durationInFrames: 30,
              text: 'Linked text',
              linkedGroupId: 'cohort-text',
            },
          ],
        },
      ],
    })
    const native = hostSnapshotToNativeTimeline(initial)
    const moved = nativeTimelineToFrameDocument(
      {
        tracks: native.tracks,
        items: native.items.map((item) => (item.id === 'text-1' ? { ...item, from: 30 } : item)),
        fps: native.fps,
      },
      initial.timeline,
    )

    expect(moved).toMatchObject({ ok: true })
    if (!moved.ok) return
    expect(moved.document.tracks[0]?.items[0]).toMatchObject({ linkedGroupId: 'cohort-text' })
    const derived = deriveSupportedHostEdit(initial.timeline, moved.document, {
      operationId: 'operation-text-move',
      idempotencyKey: 'idempotency-text-move',
    })
    expect(derived.batch?.commands[0]).toMatchObject({ type: 'move_item', item_id: 'text-1' })
  })

  it.each([
    ['null', null],
    ['absent', undefined],
  ] as const)(
    'treats %s regular-text linked-group metadata as unset during a move',
    (_label, linkedGroupId) => {
      const textItem = {
        type: 'text' as const,
        id: 'text-1',
        trackId: 'text-track',
        from: 0,
        durationInFrames: 30,
        text: 'Unlinked text',
        ...(linkedGroupId === undefined ? {} : { linkedGroupId }),
      }
      const initial = snapshot({
        tracks: [
          {
            id: 'text-track',
            kind: 'video',
            name: 'Text',
            locked: false,
            muted: false,
            items: [textItem],
          },
        ],
      })
      const native = hostSnapshotToNativeTimeline(initial)
      const moved = nativeTimelineToFrameDocument(
        {
          tracks: native.tracks,
          items: native.items.map((item) => (item.id === 'text-1' ? { ...item, from: 30 } : item)),
          fps: native.fps,
        },
        initial.timeline,
      )

      expect(moved).toMatchObject({ ok: true })
      if (!moved.ok) return
      expect(moved.document.tracks[0]?.items[0]).not.toHaveProperty('linkedGroupId')
      const derived = deriveSupportedHostEdit(initial.timeline, moved.document, {
        operationId: `operation-text-${_label}-move`,
        idempotencyKey: `idempotency-text-${_label}-move`,
      })
      expect(derived.batch?.commands[0]).toMatchObject({ type: 'move_item', item_id: 'text-1' })
    },
  )

  it('produces one authoritative ripple command from selected cohort anchors', () => {
    const initial = snapshot({
      tracks: [
        {
          id: 'track-video',
          kind: 'video',
          name: 'Video',
          locked: false,
          muted: false,
          syncLock: true,
          items: [
            {
              type: 'video',
              id: 'video-1',
              trackId: 'track-video',
              mediaId: 'media-1',
              linkedGroupId: 'cohort-1',
              from: 30,
              durationInFrames: 60,
              sourceStart: 0,
              sourceEnd: 60,
            },
          ],
        },
        {
          id: 'track-audio',
          kind: 'audio',
          name: 'Audio',
          locked: false,
          muted: false,
          syncLock: true,
          items: [
            {
              type: 'audio',
              id: 'audio-1',
              trackId: 'track-audio',
              mediaId: 'media-1',
              linkedGroupId: 'cohort-1',
              from: 30,
              durationInFrames: 60,
              sourceStart: 0,
              sourceEnd: 60,
            },
          ],
        },
      ],
    })

    const derived = deriveRippleDelete(initial.timeline, ['video-1'], {
      operationId: 'operation-delete-1',
      idempotencyKey: 'idempotency-delete-1',
    })

    expect(derived.batch).toMatchObject({
      timeline_id: 'timeline-1',
      base_revision: 0,
      preconditions: [
        {
          type: 'item_at',
          item_id: 'video-1',
          timeline_start_us: 1_000_000,
          timeline_end_us: 3_000_000,
        },
      ],
      commands: [
        {
          command_id: 'ripple-delete-operation-delete-1',
          type: 'ripple_delete',
          start_us: 1_000_000,
          end_us: 3_000_000,
          track_ids: null,
          item_ids: ['video-1'],
          intent: 'ripple',
        },
      ],
    })
  })

  it('submits the UI ripple producer without changing stores before the receipt', async () => {
    const initial = snapshot()
    const harness = createFakeHost(initial)
    const controller = new HostEditorController(harness.host, initial)

    const result = await controller.requestRippleDelete(['clip-1'])

    expect(result.status).toBe('applied')
    expect(harness.submitEdit).toHaveBeenCalledOnce()
    expect(harness.submitEdit.mock.calls[0]?.[0].commands).toEqual([
      expect.objectContaining({ type: 'ripple_delete', item_ids: ['clip-1'], intent: 'ripple' }),
    ])
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

    /** The same fixture with a second, empty track for cross-track moves. */
    function twoTrackSnapshot(): EmbeddedEditorSnapshot {
      const initial = minimalTwoClipSnapshot()
      return {
        ...initial,
        timeline: {
          ...initial.timeline,
          tracks: [
            ...initial.timeline.tracks,
            {
              id: 'track-2',
              kind: 'video' as const,
              name: 'Video 2',
              locked: false,
              muted: false,
              items: [],
            },
          ],
        },
      }
    }

    /** Rewrite clip-2 — the fixture clip that states no source range. */
    function withClipTwo(
      timeline: EmbeddedEditorSnapshot['timeline'],
      overrides: Record<string, unknown>,
    ): EmbeddedEditorSnapshot['timeline'] {
      const nextTrackId = (overrides.trackId as string | undefined) ?? 'track-1'
      return {
        ...timeline,
        tracks: timeline.tracks.map((track) => {
          const kept = track.items.filter((item) => item.id !== 'clip-2')
          if (track.id !== nextTrackId) return { ...track, items: kept }
          const source = timeline.tracks
            .flatMap((candidate) => candidate.items)
            .find((item) => item.id === 'clip-2')!
          return { ...track, items: [...kept, { ...source, ...overrides }] }
        }),
      }
    }

    /**
     * A host that keeps its authoritative document in the frame-native shape
     * and applies a move by rewriting `from` alone.  Unlike `createFakeHost`
     * it never materializes source bounds on the way through the CodePress
     * wire shape, which is how a host that stores FreeCut frame documents
     * behaves — and the only way to observe whether the bridge invents a
     * source range from the timeline position.
     */
    function createFrameNativeHost(initial: EmbeddedEditorSnapshot) {
      let current = initial
      const notices: HostNotice[] = []
      const submitEdit = vi.fn((batch: EditCommandBatch): HostEditResult => {
        const command = batch.commands[0]
        if (batch.commands.length !== 1 || command?.type !== 'move_item') {
          throw new Error(`Unexpected host batch: ${batch.commands.map((one) => one.type).join()}`)
        }
        const from = Math.round((command.timeline_start_us * 30) / 1_000_000)
        current = {
          ...current,
          timeline: {
            ...current.timeline,
            revision: current.timeline.revision + 1,
            tracks: current.timeline.tracks.map((track) => ({
              ...track,
              items: track.items.map((item) =>
                item.id === command.item_id ? { ...item, from } : item,
              ),
            })),
          },
        }
        return {
          status: 'applied',
          snapshot: current,
          // The runtime reads `status` and, on a rejection, the error; the
          // full operation receipt is not what this fixture exercises.
          result: { status: 'applied' } as HostAppliedEditResult['result'],
        }
      })
      const host: EditorHost = {
        capabilities: DEFAULT_HOST_CAPABILITIES,
        load: () => current,
        resolveMedia: () => null,
        submitEdit,
        notify: (notice) => notices.push(notice),
      }
      return { host, submitEdit, notices, getSnapshot: () => current }
    }

    /** Two video tracks the host itself names with classic V# labels. */
    function classicallyNamedSnapshot(): EmbeddedEditorSnapshot {
      const initial = snapshot()
      const track = initial.timeline.tracks[0]!
      return {
        ...initial,
        timeline: {
          ...initial.timeline,
          tracks: [
            { ...track, name: 'V1' },
            {
              id: 'track-2',
              kind: 'video' as const,
              name: 'V2',
              locked: false,
              muted: false,
              items: [],
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

    it('classifies a same-track move of a clip that states no source range', () => {
      const initial = minimalTwoClipSnapshot()
      const derived = deriveSupportedHostEdit(
        initial.timeline,
        withClipTwo(initial.timeline, { from: 150 }),
        { operationId: 'op-move-bare-same', idempotencyKey: 'idem-move-bare-same' },
      )

      // Inferring the source range from `from` turns this into a trim: a wrong
      // command that the host would happily apply.
      expect(derived.batch?.commands).toEqual([
        expect.objectContaining({ type: 'move_item', item_id: 'clip-2', to_track_id: 'track-1' }),
      ])
    })

    it('classifies a cross-track move of a clip that states no source range', () => {
      const initial = twoTrackSnapshot()
      const derived = deriveSupportedHostEdit(
        initial.timeline,
        withClipTwo(initial.timeline, { from: 150, trackId: 'track-2' }),
        { operationId: 'op-move-bare-cross', idempotencyKey: 'idem-move-bare-cross' },
      )

      expect(derived.reason).toBeUndefined()
      expect(derived.batch?.commands).toEqual([
        expect.objectContaining({ type: 'move_item', item_id: 'clip-2', to_track_id: 'track-2' }),
      ])
    })

    it('still trims a clip that states no source range when its duration shrinks', () => {
      const initial = minimalTwoClipSnapshot()
      const derived = deriveSupportedHostEdit(
        initial.timeline,
        // The native bridge always materializes explicit bounds on the way back.
        withClipTwo(initial.timeline, { durationInFrames: 40, sourceStart: 60, sourceEnd: 100 }),
        { operationId: 'op-trim-bare', idempotencyKey: 'idem-trim-bare' },
      )

      expect(derived.batch?.commands).toEqual([
        expect.objectContaining({ type: 'trim_item', item_id: 'clip-2', edge: 'end' }),
      ])
    })

    it('still trims a clip that carries an explicit source range', () => {
      const initial = minimalTwoClipSnapshot()
      const track = initial.timeline.tracks[0]!
      const next = {
        ...initial.timeline,
        tracks: [
          {
            ...track,
            items: [{ ...track.items[0]!, durationInFrames: 40, sourceEnd: 40 }, track.items[1]!],
          },
        ],
      }

      expect(
        deriveSupportedHostEdit(initial.timeline, next, {
          operationId: 'op-trim-explicit',
          idempotencyKey: 'idem-trim-explicit',
        }).batch?.commands,
      ).toEqual([expect.objectContaining({ type: 'trim_item', item_id: 'clip-1', edge: 'end' })])
    })

    it('serializes a contiguous host ripple-end trim as one trim plus downstream moves', () => {
      const initial = minimalTwoClipSnapshot()
      const track = initial.timeline.tracks[0]!
      const next = {
        ...initial.timeline,
        tracks: [
          {
            ...track,
            items: [
              { ...track.items[0]!, durationInFrames: 40, sourceEnd: 40 },
              { ...track.items[1]!, from: 40 },
            ],
          },
        ],
      }

      const derived = deriveSupportedHostEdit(initial.timeline, next, {
        operationId: 'op-ripple-end',
        idempotencyKey: 'idem-ripple-end',
      })

      expect(derived.batch?.commands).toEqual([
        expect.objectContaining({ type: 'trim_item', item_id: 'clip-1', edge: 'end' }),
        expect.objectContaining({ type: 'move_item', item_id: 'clip-2' }),
      ])
    })

    it('serializes a host ripple trim when downstream clips already have a gap', () => {
      const initial = minimalTwoClipSnapshot()
      const track = initial.timeline.tracks[0]!
      const gapped = {
        ...initial.timeline,
        tracks: [
          {
            ...track,
            items: [track.items[0]!, { ...track.items[1]!, from: 90 }],
          },
        ],
      }
      const next = {
        ...gapped,
        tracks: [
          {
            ...gapped.tracks[0]!,
            items: [
              { ...gapped.tracks[0]!.items[0]!, durationInFrames: 40, sourceEnd: 40 },
              { ...gapped.tracks[0]!.items[1]!, from: 70 },
            ],
          },
        ],
      }

      const derived = deriveSupportedHostEdit(gapped, next, {
        operationId: 'op-ripple-gapped',
        idempotencyKey: 'idem-ripple-gapped',
      })

      expect(derived.reason).toBeUndefined()
      expect(derived.batch?.commands).toEqual([
        expect.objectContaining({ type: 'trim_item', item_id: 'clip-1', edge: 'end' }),
        expect.objectContaining({ type: 'move_item', item_id: 'clip-2' }),
      ])
    })

    it('anchors a contiguous host ripple-start trim before moving downstream clips', () => {
      const initial = minimalTwoClipSnapshot()
      const track = initial.timeline.tracks[0]!
      const next = {
        ...initial.timeline,
        tracks: [
          {
            ...track,
            items: [
              {
                ...track.items[0]!,
                from: 0,
                durationInFrames: 40,
                sourceStart: 20,
                sourceEnd: 60,
              },
              { ...track.items[1]!, from: 40 },
            ],
          },
        ],
      }

      const derived = deriveSupportedHostEdit(initial.timeline, next, {
        operationId: 'op-ripple-start',
        idempotencyKey: 'idem-ripple-start',
      })

      expect(derived.batch?.commands).toEqual([
        expect.objectContaining({
          type: 'trim_item',
          item_id: 'clip-1',
          edge: 'start',
          timeline_us: 666_667,
        }),
        expect.objectContaining({ type: 'move_item', item_id: 'clip-1', timeline_start_us: 0 }),
        expect.objectContaining({ type: 'move_item', item_id: 'clip-2' }),
      ])
    })

    it('moves a clip whose transform key is present on only one side', () => {
      const initial = minimalTwoClipSnapshot()
      const withIdentity = withClipTwo(initial.timeline, {
        transform: { x: 0, y: 0, scale_x: 1, scale_y: 1, rotation_degrees: 0 },
      })

      expect(
        deriveSupportedHostEdit(withIdentity, withClipTwo(initial.timeline, { from: 150 }), {
          operationId: 'op-identity-transform',
          idempotencyKey: 'idem-identity-transform',
        }).batch?.commands,
      ).toEqual([expect.objectContaining({ type: 'move_item', item_id: 'clip-2' })])
    })

    it('keeps a genuinely non-identity transform change unsupported', () => {
      const initial = minimalTwoClipSnapshot()
      const derived = deriveSupportedHostEdit(
        initial.timeline,
        withClipTwo(initial.timeline, { from: 150, transform: { position_x: 24 } }),
        { operationId: 'op-real-transform', idempotencyKey: 'idem-real-transform' },
      )

      expect(derived.batch).toBeNull()
      expect(derived.detail?.failedPredicates).toEqual(['transform'])
      expect(derived.detail?.changedFields).toEqual(['transform.x'])
    })

    it('names the failing predicate and the differing fields on a rejected change', () => {
      const initial = minimalTwoClipSnapshot()
      const derived = deriveSupportedHostEdit(
        initial.timeline,
        withClipTwo(initial.timeline, { from: 150, volume: 0.25 }),
        { operationId: 'op-property-edit', idempotencyKey: 'idem-property-edit' },
      )

      expect(derived.batch).toBeNull()
      expect(derived.reason).toMatch(
        /^Property, effect, or animation edits are unsupported by the host slice\b/,
      )
      expect(derived.reason).toContain('mismatch: metadata')
      expect(derived.reason).toContain('fields: volume')
      expect(derived.detail).toEqual({
        code: 'unclassified_item_change',
        itemId: 'clip-2',
        failedPredicates: ['metadata'],
        changedFields: ['volume'],
      })
      // Field names only: no values, ids, or serialized items in the toast.
      expect(derived.reason).not.toContain('0.25')
    })

    it('reports how many items changed when the diff is ambiguous', () => {
      const initial = minimalTwoClipSnapshot()
      const track = initial.timeline.tracks[0]!
      const next = {
        ...initial.timeline,
        tracks: [
          {
            ...track,
            items: [
              { ...track.items[0]!, from: 200 },
              { ...track.items[1]!, from: 400 },
            ],
          },
        ],
      }

      const derived = deriveSupportedHostEdit(initial.timeline, next)

      expect(derived.batch).toBeNull()
      expect(derived.reason).toMatch(/^Multiple or ambiguous timeline changes are unsupported\b/)
      expect(derived.reason).toContain('added 0, removed 0, changed 2')
      expect(derived.detail).toEqual({
        code: 'ambiguous_change',
        changeCounts: { added: 0, removed: 0, changed: 2 },
      })
    })

    it('derives a move_item command for a store drag of a clip carrying an identity transform', async () => {
      const base = minimalTwoClipSnapshot()
      const initial: EmbeddedEditorSnapshot = {
        ...base,
        timeline: withClipTwo(base.timeline, {
          transform: { x: 0, y: 0, scale_x: 1, scale_y: 1, rotation_degrees: 0 },
        }),
      }
      const harness = createFakeHost(initial)
      const runtime = new EmbeddedEditorHostRuntime(harness.host, initial)
      runtime.mountStores()
      try {
        useTimelineStore.getState().moveItem('clip-2', 150)
        await flushReconcile()

        expect(harness.submitEdit).toHaveBeenCalledTimes(1)
        const batch = harness.submitEdit.mock.calls[0]![0] as EditCommandBatch
        expect(batch.commands).toEqual([
          expect.objectContaining({ type: 'move_item', item_id: 'clip-2' }),
        ])
      } finally {
        runtime.unmountStores()
      }
    })

    it('forwards the structured rejection detail on the host notice', async () => {
      const initial = minimalTwoClipSnapshot()
      const harness = createFakeHost(initial)
      const notices: HostNotice[] = []
      const runtime = new EmbeddedEditorHostRuntime(
        { ...harness.host, notify: (notice) => notices.push(notice) },
        initial,
      )
      runtime.mountStores()
      try {
        useTimelineStore.getState().updateItem('clip-2', { volume: 0.25 })
        await flushReconcile()

        expect(harness.submitEdit).not.toHaveBeenCalled()
        expect(notices).toEqual([
          expect.objectContaining({
            kind: 'unsupported',
            detail: expect.objectContaining({
              code: 'unclassified_item_change',
              itemId: 'clip-2',
              changedFields: ['volume'],
            }),
          }),
        ])
      } finally {
        runtime.unmountStores()
      }
    })

    /**
     * The frame window of the source media a clip actually plays.  Read the
     * same way every native renderer reads it (`sourceStart ?? 0`), so the
     * assertion holds whether the bridge omits the bounds or materializes
     * them — it is about what plays, not about which keys are present.
     */
    function effectiveSourceWindow(item: {
      durationInFrames: number
      sourceStart?: number
      sourceEnd?: number
    }): [number, number] {
      const start = item.sourceStart ?? 0
      return [start, item.sourceEnd ?? start + item.durationInFrames]
    }

    function nativeClip(snapshotValue: EmbeddedEditorSnapshot, id: string) {
      return hostSnapshotToNativeTimeline(snapshotValue).items.find((item) => item.id === id)!
    }

    /** A host snapshot whose clip-2 sits at `from` and states no source range. */
    function bareClipAt(from: number): EmbeddedEditorSnapshot {
      const initial = minimalTwoClipSnapshot()
      return { ...initial, timeline: withClipTwo(initial.timeline, { from }) }
    }

    it('plays a host clip that states no source range from the start of its media', () => {
      const initial = minimalTwoClipSnapshot()

      // clip-1 states 0..60 explicitly; clip-2 states nothing and sits at 60.
      expect(effectiveSourceWindow(nativeClip(initial, 'clip-1'))).toEqual([0, 60])
      expect(effectiveSourceWindow(nativeClip(initial, 'clip-2'))).toEqual([0, 60])
    })

    it('keeps the rendered source range of a bare host clip fixed across moves', () => {
      // Two successive moves of the same clip.  Deriving a bound from `from`
      // makes the played media drift with the timeline position.
      expect(effectiveSourceWindow(nativeClip(bareClipAt(60), 'clip-2'))).toEqual([0, 60])
      expect(effectiveSourceWindow(nativeClip(bareClipAt(120), 'clip-2'))).toEqual([0, 60])
      expect(effectiveSourceWindow(nativeClip(bareClipAt(180), 'clip-2'))).toEqual([0, 60])
    })

    it('keeps the store source range of a bare host clip fixed across two real drags', async () => {
      const initial = minimalTwoClipSnapshot()
      const harness = createFrameNativeHost(initial)
      const runtime = new EmbeddedEditorHostRuntime(harness.host, initial)
      runtime.mountStores()
      try {
        const storedClipTwo = () =>
          useTimelineStore.getState().items.find((item) => item.id === 'clip-2')!

        expect(effectiveSourceWindow(storedClipTwo())).toEqual([0, 60])

        useTimelineStore.getState().moveItem('clip-2', 120)
        await flushReconcile()
        expect(harness.submitEdit).toHaveBeenCalledTimes(1)
        expect(storedClipTwo().from).toBe(120)
        expect(effectiveSourceWindow(storedClipTwo())).toEqual([0, 60])

        useTimelineStore.getState().moveItem('clip-2', 180)
        await flushReconcile()
        expect(harness.submitEdit).toHaveBeenCalledTimes(2)
        expect(storedClipTwo().from).toBe(180)
        expect(effectiveSourceWindow(storedClipTwo())).toEqual([0, 60])

        expect(harness.notices).toEqual([])
      } finally {
        runtime.unmountStores()
      }
    })

    it('trims a bare host clip against its media start, not its timeline position', () => {
      const initial = minimalTwoClipSnapshot()
      const derived = deriveSupportedHostEdit(
        initial.timeline,
        // A pure end-trim: clip-2 keeps `from: 60` and still states no bounds.
        withClipTwo(initial.timeline, { durationInFrames: 40 }),
        { operationId: 'op-trim-bare-source', idempotencyKey: 'idem-trim-bare-source' },
      )

      expect(derived.batch?.commands).toEqual([
        expect.objectContaining({
          type: 'trim_item',
          item_id: 'clip-2',
          edge: 'end',
          timeline_us: framesToMicroseconds(100, 30),
          // 40 source frames in, counted from the start of the media — not
          // from + duration, which would trim at source frame 100.
          source_us: framesToMicroseconds(40, 30),
        }),
      ])
    })

    it('does not reject the first edit after mounting a clip that states only a source end', async () => {
      const base = minimalTwoClipSnapshot()
      const initial: EmbeddedEditorSnapshot = {
        ...base,
        timeline: withClipTwo(base.timeline, { durationInFrames: 40, sourceEnd: 40 }),
      }
      const harness = createFakeHost(initial)
      const notices: HostNotice[] = []
      const runtime = new EmbeddedEditorHostRuntime(
        { ...harness.host, notify: (notice) => notices.push(notice) },
        initial,
      )
      runtime.mountStores()
      try {
        useTimelineStore.getState().moveItem('clip-1', 200)
        await flushReconcile()

        // The store fills the missing start with 0 (items-store-normalize);
        // synthesizing `from` on the authoritative side instead makes clip-2
        // look edited on mount and rejects the user's unrelated drag.
        expect(notices).toEqual([])
        expect(harness.submitEdit).toHaveBeenCalledTimes(1)
      } finally {
        runtime.unmountStores()
      }
    })

    it('keeps host track names on mount when they are classic V# labels', () => {
      const initial = classicallyNamedSnapshot()
      const harness = createFakeHost(initial)
      const runtime = new EmbeddedEditorHostRuntime(harness.host, initial)
      runtime.mountStores()
      try {
        expect(useTimelineStore.getState().tracks.map((track) => track.name)).toEqual(['V1', 'V2'])
      } finally {
        runtime.unmountStores()
      }
    })

    it('does not reject the first edit after mounting host tracks named V1/V2', async () => {
      const initial = classicallyNamedSnapshot()
      const harness = createFakeHost(initial)
      const notices: HostNotice[] = []
      const runtime = new EmbeddedEditorHostRuntime(
        { ...harness.host, notify: (notice) => notices.push(notice) },
        initial,
      )
      runtime.mountStores()
      try {
        useTimelineStore.getState().moveItem('clip-1', 90)
        await flushReconcile()

        // Mounting must not renumber host-owned track names: doing so makes
        // every later edit fail the track-settings guard.
        expect(notices).toEqual([])
        expect(harness.submitEdit).toHaveBeenCalledTimes(1)
        const batch = harness.submitEdit.mock.calls[0]![0] as EditCommandBatch
        expect(batch.commands).toEqual([
          expect.objectContaining({ type: 'move_item', item_id: 'clip-1' }),
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

    /**
     * Playback is not an edit, but it does write to the timeline store.  The
     * DaVinci-style page following in `timeline-content` moves the native
     * scroll container once the playhead reaches a viewport edge, and that
     * container's debounced scroll handler persists the new `scrollPosition`
     * on the timeline settings store — one of the domain stores the host
     * runtime's `useTimelineStore.subscribe` is wired to.  So roughly one
     * viewport-page into playback a reconcile runs against a document nobody
     * touched.  A no-op diff must stay silent there: a rejection notifies the
     * host *and* re-applies the authoritative snapshot, which rewinds the
     * playhead to 0 and stops playback under the user.
     */
    function playbackPageFollowScroll(): void {
      useTimelineStore.getState().setScrollPosition(1280)
    }

    async function expectSilentReconcile(initial: EmbeddedEditorSnapshot): Promise<void> {
      const harness = createFakeHost(initial)
      const notices: HostNotice[] = []
      const runtime = new EmbeddedEditorHostRuntime(
        { ...harness.host, notify: (notice) => notices.push(notice) },
        initial,
      )
      runtime.mountStores()
      try {
        usePlaybackStore.getState().setCurrentFrame(90)
        playbackPageFollowScroll()
        await flushReconcile()

        expect(notices).toEqual([])
        expect(harness.submitEdit).not.toHaveBeenCalled()
        expect(usePlaybackStore.getState().currentFrame).toBe(90)
      } finally {
        runtime.unmountStores()
      }
    }

    it('stays silent when playback scroll reconciles an untouched host document', async () => {
      await expectSilentReconcile(minimalTwoClipSnapshot())
    })

    /**
     * The silent path is a binding between two modules, not a message:
     * `deriveSupportedHostEdit` returns this reason and `reconcileTimeline`
     * branches on it to skip both the notice and the snapshot restore.  Assert
     * the reason *is* the constant the runtime imports rather than a string
     * that happens to read the same, so re-inlining a literal on either side
     * fails here instead of quietly restoring the snapshot on every playback
     * scroll again.
     */
    it('routes the silent no-op through the constant the runtime branches on', async () => {
      const initial = minimalTwoClipSnapshot()
      const harness = createFakeHost(initial)
      const notices: HostNotice[] = []
      const runtime = new EmbeddedEditorHostRuntime(
        { ...harness.host, notify: (notice) => notices.push(notice) },
        initial,
      )
      runtime.mountStores()
      try {
        playbackPageFollowScroll()
        await flushReconcile()

        expect(notices).toEqual([])
        expect(deriveSupportedHostEdit(initial.timeline, initial.timeline).reason).toBe(
          NO_SUPPORTED_EDIT_REASON,
        )
      } finally {
        runtime.unmountStores()
      }
    })

    it('stays silent when playback scroll reconciles an untouched clip with a transform', async () => {
      const base = minimalTwoClipSnapshot()
      // A host clip whose transform is identity apart from opacity: the bridge
      // collapses it to a top-level `opacity` key on the way back, so the
      // item serializes differently while every classifier predicate still
      // says nothing about it changed.
      await expectSilentReconcile({
        ...base,
        timeline: withClipTwo(base.timeline, { transform: { opacity: 1 } }),
      })
    })

    /**
     * The invariant that keeps the two comparisons from drifting apart again:
     * whatever the classifier normalizes away must not enrol the item as
     * changed.  Every row below is a shape the bridge really produces, and
     * each one used to reach the classifier with no branch to take.
     */
    it('never enrols an item the classifier considers unchanged', () => {
      const initial = minimalTwoClipSnapshot()
      const equivalent: Array<[string, Record<string, unknown>]> = [
        // transformsEquivalent: an absent transform against a materialized
        // identity one, in either carrier the bridge uses for it.
        ['a materialized identity transform', { transform: { x: 0, y: 0, opacity: 1 } }],
        ['a materialized top-level opacity', { opacity: 1 }],
        // sourceBoundUnchanged: a bound stated on one side only.
        ['a materialized source range', { sourceStart: 0, sourceEnd: 60 }],
      ]

      for (const [label, overrides] of equivalent) {
        const derived = deriveSupportedHostEdit(
          initial.timeline,
          withClipTwo(initial.timeline, overrides),
        )
        expect(derived, label).toEqual({ batch: null, reason: 'No supported edit was detected' })
      }
    })

    it('still names a real resize once identity transforms compare equal', () => {
      const base = minimalTwoClipSnapshot()
      const sized = withClipTwo(base.timeline, {
        transform: {
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          anchorX: 0,
          anchorY: 0,
          rotation: 0,
          opacity: 1,
        },
      })
      const resized = withClipTwo(sized, {
        transform: {
          x: 0,
          y: 0,
          width: 1280,
          height: 720,
          anchorX: 0,
          anchorY: 0,
          rotation: 0,
          opacity: 1,
        },
      })

      const derived = deriveSupportedHostEdit(sized, resized)

      // The normalized transform has to carry the size, or a gizmo resize is
      // indistinguishable from an untouched clip and is silently swallowed.
      expect(derived.batch).toBeNull()
      // `timelinePosition` rides along on every rejection of a clip that did
      // not also move; `transform` is the predicate this pins.
      expect(derived.detail?.failedPredicates).toEqual(['transform', 'timelinePosition'])
      expect(derived.detail?.changedFields).toEqual(['transform.height', 'transform.width'])
    })
  })
})
