import { createContext, useContext } from 'react'
import {
  isHostCapabilityEnabled,
  type EditorCapability,
  type EditorCapabilityMap,
  type EditorHost,
} from './contract'

export interface EditorHostContextValue {
  mode: 'local' | 'host'
  capabilities: EditorCapabilityMap
  host?: EditorHost
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
