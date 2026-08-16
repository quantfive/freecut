/** Stable alias for hosts that want the controlled editor boundary by name. */
export {
  CodePressCommandAdapter as ControlledEditor,
  createCodePressCommandAdapter as createControlledEditor,
} from './adapter'
export type {
  CodePressCommandAdapterOptions as ControlledEditorOptions,
  AdapterSnapshot as ControlledEditorSnapshot,
} from './adapter'
export type { ControlledEditorDocument, ControlledEditorPort } from './interfaces'
