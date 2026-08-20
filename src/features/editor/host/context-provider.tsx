import type { ReactNode } from 'react'
import { EditorHostContext, type EditorHostContextValue } from './context'

export interface EditorHostProviderProps {
  value: EditorHostContextValue
  children: ReactNode
}

export function EditorHostProvider({ value, children }: EditorHostProviderProps) {
  return <EditorHostContext.Provider value={value}>{children}</EditorHostContext.Provider>
}
