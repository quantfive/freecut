import type { ReactNode } from 'react'
import { EditorHostContext, type EditorHostContextValue } from './context'

export function EditorHostProvider({
  value,
  children,
}: {
  value: EditorHostContextValue
  children: ReactNode
}) {
  return <EditorHostContext.Provider value={value}>{children}</EditorHostContext.Provider>
}
