/* eslint-disable react/only-export-components */

import { createContext, useContext, type ReactNode } from 'react'

import { EmbeddedEditorHostRuntime } from './runtime'

const HostTranscriptEditorRuntimeContext = createContext<EmbeddedEditorHostRuntime | null>(null)

/** Supplies the already-mounted host runtime to the Media/Transcript surface. */
export function HostTranscriptEditorProvider({
  runtime,
  children,
}: {
  runtime: EmbeddedEditorHostRuntime
  children: ReactNode
}) {
  return (
    <HostTranscriptEditorRuntimeContext.Provider value={runtime}>
      {children}
    </HostTranscriptEditorRuntimeContext.Provider>
  )
}

export function useHostTranscriptEditorRuntime(): EmbeddedEditorHostRuntime | null {
  return useContext(HostTranscriptEditorRuntimeContext)
}
