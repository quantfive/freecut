import { createContext, useContext } from 'react'
import {
  isHostCapabilityEnabled,
  type EditorCapability,
  type EditorCapabilityMap,
  type EditorHost,
} from './contract'

/** UI producer for destructive host timeline edits. */
export interface HostTimelineEditPort {
  /** Ask the host authority to ripple-delete the selected timeline anchors. */
  requestRippleDelete(itemIds: readonly string[]): Promise<void> | void
  requestSetItemAttachment?: (
    itemIds: readonly string[],
    rippleLinked: boolean,
  ) => Promise<void> | void
}

export interface EditorHostContextValue {
  mode: 'local' | 'host'
  capabilities: EditorCapabilityMap
  host?: EditorHost
  timeline?: HostTimelineEditPort
}

const localContext: EditorHostContextValue = {
  mode: 'local',
  capabilities: {},
}

export const EditorHostContext = createContext<EditorHostContextValue>(localContext)

export function useEditorHostContext(): EditorHostContextValue {
  return useContext(EditorHostContext)
}

export function useEditorHostMode(): boolean {
  return useEditorHostContext().mode === 'host'
}

export function useEditorCapability(capability: EditorCapability): boolean {
  const { mode, capabilities } = useEditorHostContext()
  return mode === 'local' || isHostCapabilityEnabled(capabilities, capability)
}
