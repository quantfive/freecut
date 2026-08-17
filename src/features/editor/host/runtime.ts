import {
  installRuntimeMediaResolver,
  useMediaLibraryStore,
} from '@/features/editor/deps/media-library'
import { useProjectStore } from '@/features/editor/deps/projects'
import {
  useCompositionNavigationStore,
  useCompositionsStore,
  useItemsStore,
  useTimelineCommandStore,
  useTimelineSettingsStore,
  useTimelineStore,
} from '@/features/editor/deps/timeline-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import { useGizmoStore, useMaskEditorStore } from '@/features/editor/deps/preview'
import type { EmbeddedEditorSnapshot, EditorHost, HostNotice } from './contract'
import { HostEditorController, deriveSupportedHostEdit } from './controller'
import {
  hostAssetsToMediaMetadata,
  hostSnapshotToNativeTimeline,
  hostSnapshotToProject,
  nativeTimelineToFrameDocument,
} from './document'

export interface EmbeddedEditorHostRuntimeContract {
  mountStores(): void
  unmountStores(): void
}

function scheduleMicrotask(callback: () => void): void {
  if (typeof queueMicrotask === 'function') queueMicrotask(callback)
  else void Promise.resolve().then(callback)
}

/**
 * Bridges the real FreeCut Zustand editor stores to a host controller.  The
 * stores remain an in-memory rendering implementation; every supported edit
 * must cross the controller before the next authoritative snapshot is kept.
 */
export class EmbeddedEditorHostRuntime implements EmbeddedEditorHostRuntimeContract {
  readonly controller: HostEditorController
  readonly host: EditorHost
  readonly projectId: string

  private mounted = false
  private applyingAuthoritative = false
  private reconcileScheduled = false
  private editInFlight = false
  private unsubscribeResolver: (() => void) | null = null
  private unsubscribeController: (() => void) | null = null
  private unsubscribeTimeline: (() => void) | null = null
  private authoritativeSnapshot: EmbeddedEditorSnapshot

  constructor(host: EditorHost, snapshot: EmbeddedEditorSnapshot) {
    this.host = host
    this.projectId = snapshot.project.id
    this.authoritativeSnapshot = snapshot
    this.controller = new HostEditorController(host, snapshot)
  }

  mountStores(): void {
    if (this.mounted) return
    this.mounted = true
    useEditorStore.setState({ hostMode: true })
    useSelectionStore.getState().clearSelection()
    useSelectionStore.getState().setActiveTool('select')
    useGizmoStore.getState().cancelInteraction()
    useGizmoStore.getState().clearPreview()
    useMaskEditorStore.getState().stopEditing()
    this.applySnapshotToStores(this.authoritativeSnapshot)

    this.unsubscribeResolver = installRuntimeMediaResolver(async (mediaId) => {
      const asset = this.authoritativeSnapshot.assets.find((candidate) => candidate.id === mediaId)
      if (!asset) return null
      const resolved = await this.controller.resolveMedia({
        mediaId,
        kind: asset.kind,
        variant: 'source',
      })
      return resolved?.source ?? null
    })

    this.unsubscribeController = this.controller.subscribe((snapshot) => {
      this.authoritativeSnapshot = snapshot
      this.applySnapshotToStores(snapshot)
    })
    this.unsubscribeTimeline = useTimelineStore.subscribe(() => this.scheduleReconcile())
  }

  unmountStores(): void {
    if (!this.mounted) return
    this.mounted = false
    this.unsubscribeTimeline?.()
    this.unsubscribeTimeline = null
    this.unsubscribeController?.()
    this.unsubscribeController = null
    this.unsubscribeResolver?.()
    this.unsubscribeResolver = null

    usePlaybackStore.getState().pause()
    useGizmoStore.getState().cancelInteraction()
    useGizmoStore.getState().clearPreview()
    useMaskEditorStore.getState().stopEditing()
    useSelectionStore.getState().clearSelection()
    useEditorStore.setState({ hostMode: false })
    useSelectionStore.getState().setActiveTool('select')
    useMediaLibraryStore.getState().setCurrentProject(null)
    useProjectStore.getState().setCurrentProject(null)
    useTimelineStore.getState().clearTimeline()
    useTimelineSettingsStore.getState().setTimelineLoading(false)
    useTimelineCommandStore.getState().clearHistory()
  }

  private applySnapshotToStores(snapshot: EmbeddedEditorSnapshot): void {
    const native = hostSnapshotToNativeTimeline(snapshot)
    this.applyingAuthoritative = true
    try {
      useProjectStore.getState().setCurrentProject(hostSnapshotToProject(snapshot))
      // The first host slice exposes the normal Edit layout only.  Set this
      // in memory so a local user's persisted Color/Motion preference cannot
      // activate an unsupported host workspace.
      useEditorStore.setState({ workspace: 'edit', activeTab: 'media' })

      const mediaItems = hostAssetsToMediaMetadata(snapshot.assets)
      useMediaLibraryStore.getState().setCurrentProject(snapshot.project.id)
      useMediaLibraryStore.setState({
        currentProjectId: snapshot.project.id,
        mediaItems,
        mediaById: Object.fromEntries(mediaItems.map((media) => [media.id, media])),
        isLoading: false,
        error: null,
        brokenMediaIds: [],
        brokenMediaInfo: new Map(),
        orphanedClips: [],
        transcriptStatus: new Map(),
        transcriptProgress: new Map(),
      })

      // Set the domain stores directly through their existing in-memory bulk
      // setters; no timeline persistence module is imported or called here.
      useItemsStore.getState().setTracks(native.tracks)
      useItemsStore.getState().setItems(native.items)
      useTimelineStore.setState({
        transitions: [],
        keyframes: [],
        markers: [],
        inPoint: null,
        outPoint: null,
      })
      useCompositionsStore.getState().setCompositions([])
      useCompositionNavigationStore.getState().resetToRoot()
      useTimelineSettingsStore.getState().setFps(native.fps)
      useTimelineSettingsStore.getState().setScrollPosition(0)
      useTimelineSettingsStore.getState().setTimelineLoading(false)
      useTimelineSettingsStore.getState().markClean()
      useTimelineStore.temporal.getState().clear()
      usePlaybackStore.getState().setCurrentFrame(0)
    } finally {
      this.applyingAuthoritative = false
    }
  }

  private scheduleReconcile(): void {
    if (!this.mounted || this.applyingAuthoritative || this.reconcileScheduled) return
    this.reconcileScheduled = true
    scheduleMicrotask(() => {
      this.reconcileScheduled = false
      if (!this.mounted || this.applyingAuthoritative) return
      void this.reconcileTimeline()
    })
  }

  // fallow-ignore-next-line complexity
  private async reconcileTimeline(): Promise<void> {
    const authoritativeDocument = this.authoritativeSnapshot.timeline
    const unsupportedStoreMutation = this.findUnsupportedStoreMutation()
    if (unsupportedStoreMutation) {
      this.restoreAuthoritative('unsupported', unsupportedStoreMutation)
      return
    }

    const converted = nativeTimelineToFrameDocument(
      useTimelineStore.getState(),
      authoritativeDocument,
    )
    if (!converted.ok) {
      this.restoreAuthoritative('unsupported', converted.failure.reason)
      return
    }

    const derived = deriveSupportedHostEdit(authoritativeDocument, converted.document)
    if (!derived.batch) {
      // Changes to transient view state do not constitute edits.  Anything
      // else is restored and surfaced as a visible host notice.
      if (derived.reason !== 'No supported edit was detected') {
        this.restoreAuthoritative('unsupported', derived.reason ?? 'Unsupported host edit')
      }
      return
    }

    if (this.editInFlight) {
      this.restoreAuthoritative('unsupported', 'Wait for the current host edit to finish')
      return
    }

    this.editInFlight = true
    try {
      const result = await this.controller.submitEdit(derived.batch)
      if (result.status === 'unsupported') {
        this.restoreAuthoritative('unsupported', result.reason)
      }
      // Applied, replayed, conflict, and rejected results all replace the
      // local store through the controller subscription or this fallback.
      if (result.status === 'rejected')
        this.restoreAuthoritative('error', result.result.error.message)
    } catch (error) {
      this.restoreAuthoritative(
        'error',
        error instanceof Error ? error.message : 'Host edit submission failed',
      )
    } finally {
      this.editInFlight = false
    }
  }

  private restoreAuthoritative(kind: HostNotice['kind'], message: string): void {
    this.host.notify?.({ kind, message })
    this.applySnapshotToStores(this.authoritativeSnapshot)
  }

  // fallow-ignore-next-line complexity
  private findUnsupportedStoreMutation(): string | null {
    const timeline = useTimelineStore.getState()
    if (timeline.markers.length > 0) return 'Timeline markers are not supported in host mode'
    if (timeline.transitions.length > 0) return 'Transitions are not supported in host mode'
    if (timeline.keyframes.length > 0) return 'Keyframes are not supported in host mode'
    if (useCompositionsStore.getState().compositions.length > 0) {
      return 'Compositions are not supported in host mode'
    }

    const authoritativeTracks = hostSnapshotToNativeTimeline(this.authoritativeSnapshot).tracks
    const authoritativeById = new Map(
      authoritativeTracks.map((track) => [track.id, track] as const),
    )
    for (const track of timeline.tracks) {
      const expected = authoritativeById.get(track.id)
      if (!expected) continue
      if (
        track.name !== expected.name ||
        track.kind !== expected.kind ||
        track.locked !== expected.locked ||
        track.muted !== expected.muted
      ) {
        return 'Track settings are not supported in host mode'
      }
    }

    if (
      authoritativeTracks.some(
        (track) => !timeline.tracks.some((current) => current.id === track.id),
      )
    ) {
      return 'Removing tracks is not supported in host mode'
    }

    const expectedOrder = authoritativeTracks
      .map((track) => track.id)
      .filter((id) => timeline.tracks.some((track) => track.id === id))
    const currentOrder = timeline.tracks
      .map((track) => track.id)
      .filter((id) => authoritativeById.has(id))
    if (expectedOrder.join('|') !== currentOrder.join('|')) {
      return 'Track reordering is not supported in host mode'
    }

    return null
  }
}
