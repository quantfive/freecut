export { FreeCutEditorSurface } from '@/features/editor/host/editor-surface'
export { EditorHostProvider } from '@/features/editor/host/context-provider'
export {
  DEFAULT_HOST_CAPABILITIES,
  SUPPORTED_HOST_COMMANDS,
  capabilityForCommand,
  createLocalEditorHost,
  isHostCapabilityEnabled,
} from '@/features/editor/host/contract'
export type { EditorHostContextValue } from '@/features/editor/host/context'
export type { EditorHostProviderProps } from '@/features/editor/host/context-provider'
export type {
  EditorCapability,
  EditorCapabilityMap,
  EditorHost,
  EditorHostNavigation,
  EmbeddedEditorAsset,
  EmbeddedEditorProject,
  EmbeddedEditorSnapshot,
  HostAppliedEditResult,
  HostConflictResult,
  HostEditResult,
  HostMediaKind,
  HostNotice,
  LocalEditorHostOptions,
  MediaLocator,
  ResolvedMediaLocator,
} from '@/features/editor/host/contract'
