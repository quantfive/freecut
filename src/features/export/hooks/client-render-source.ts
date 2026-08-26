import type { ExportableSequence } from '@/features/export/deps/timeline-compositions'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'

type TimelineRenderSource = Pick<
  ExportableSequence,
  'tracks' | 'items' | 'transitions' | 'fps' | 'inPoint' | 'outPoint' | 'keyframes'
>

type PlaybackRenderSource = Pick<ExportableSequence, 'busAudioEq' | 'masterBusDb'>

interface ProjectRenderMetadata {
  width?: number
  height?: number
  backgroundColor?: string
}

/**
 * Select one complete render source. Once a sequence snapshot is supplied,
 * its nullable/optional values are authoritative too: an unset range or EQ
 * must not inherit state from whichever timeline happens to be active.
 */
export function resolveClientRenderSource(
  sequence: ExportableSequence | undefined,
  timeline: TimelineRenderSource,
  playback: PlaybackRenderSource,
  projectMetadata: ProjectRenderMetadata | undefined,
) {
  const source = sequence ?? timeline
  return {
    tracks: source.tracks,
    items: source.items,
    transitions: source.transitions,
    fps: source.fps,
    inPoint: source.inPoint,
    outPoint: source.outPoint,
    keyframes: source.keyframes,
    busAudioEq: sequence ? sequence.busAudioEq : playback.busAudioEq,
    masterBusDb: sequence ? sequence.masterBusDb : playback.masterBusDb,
    backgroundColor: sequence ? sequence.backgroundColor : projectMetadata?.backgroundColor,
    width: sequence?.width ?? projectMetadata?.width ?? DEFAULT_PROJECT_WIDTH,
    height: sequence?.height ?? projectMetadata?.height ?? DEFAULT_PROJECT_HEIGHT,
  }
}
