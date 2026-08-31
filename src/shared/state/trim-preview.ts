import { create } from 'zustand'
import type { TrimProjection } from '@/shared/timeline/trim-preview'

interface TrimPreviewState {
  projection: TrimProjection | null
  constrained: boolean
  constraintLabel: string | null
  /** Transitions hidden from the projected composition while breaking a cut. */
  transitionIdsToRemove: string[]
}

interface TrimPreviewActions {
  setPreview: (params: {
    projection: TrimProjection
    constrained: boolean
    constraintLabel: string | null
    transitionIdsToRemove?: readonly string[]
  }) => void
  clearPreview: () => void
}

const initialState = (): TrimPreviewState => ({
  projection: null,
  constrained: false,
  constraintLabel: null,
  transitionIdsToRemove: [],
})

/**
 * Ephemeral trim presentation state. It carries only a pure projection and is
 * deliberately separate from the authoritative items/history stores.
 */
export const useTrimPreviewStore = create<TrimPreviewState & TrimPreviewActions>()((set) => ({
  ...initialState(),
  setPreview: ({ projection, constrained, constraintLabel, transitionIdsToRemove = [] }) =>
    set({
      projection,
      constrained,
      constraintLabel,
      transitionIdsToRemove: [...transitionIdsToRemove],
    }),
  clearPreview: () => set(initialState()),
}))
