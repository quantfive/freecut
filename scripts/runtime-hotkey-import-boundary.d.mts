export interface RuntimeHotkeyBoundarySource {
  path: string
  source: string
}

export interface RuntimeHotkeyImportViolation {
  path: string
  line: number
  column: number
  allowedPath: string
  message: string
}

export declare const RUNTIME_HOTKEY_ADAPTER_PATH: 'src/hooks/use-hotkey-registration.ts'

export declare function findReactHotkeysHookImportViolations(
  sources: RuntimeHotkeyBoundarySource[],
  allowedPath?: string,
): RuntimeHotkeyImportViolation[]
