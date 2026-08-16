import { assertFrameAligned, type FrameRateLike } from './timing'
import type {
  CaptionCue,
  ClipItem,
  EditCommand,
  EditCommandBatch,
  ItemPropertiesPatch,
  Keyframe,
  TextItem,
  TimelineItem,
  Transition,
} from './contract'

export type Frame = number

export type FrameClipItem = Omit<
  ClipItem,
  | 'timeline_start_us'
  | 'timeline_end_us'
  | 'source_start_us'
  | 'source_end_us'
  | 'fade_in_us'
  | 'fade_out_us'
  | 'transition_in'
  | 'transition_out'
  | 'keyframes'
> & {
  timeline_start_frame: Frame
  timeline_end_frame: Frame
  source_start_frame: Frame
  source_end_frame: Frame
  fade_in_frame?: Frame
  fade_out_frame?: Frame
  transition_in?: FrameTransition | null
  transition_out?: FrameTransition | null
  keyframes?: readonly FrameKeyframe[]
}

export type FrameTextItem = Omit<
  TextItem,
  'timeline_start_us' | 'timeline_end_us' | 'keyframes'
> & {
  timeline_start_frame: Frame
  timeline_end_frame: Frame
  keyframes?: readonly FrameKeyframe[]
}

export type FrameCaptionCue = Omit<CaptionCue, 'start_us' | 'end_us'> & {
  start_frame: Frame
  end_frame: Frame
}

export type FrameItem = FrameClipItem | FrameTextItem | FrameCaptionCue

export interface FrameTransition {
  transition_type: Transition['transition_type']
  duration_frame: Frame
}

export interface FrameKeyframe extends Omit<Keyframe, 'time_us'> {
  time_frame: Frame
}

export type FrameItemPropertiesPatch = Omit<
  ItemPropertiesPatch,
  'fade_in_us' | 'fade_out_us' | 'transition_in' | 'transition_out' | 'keyframes'
> & {
  fade_in_frame?: Frame | null
  fade_out_frame?: Frame | null
  transition_in?: FrameTransition | null
  transition_out?: FrameTransition | null
  keyframes?: readonly FrameKeyframe[]
}

export type FrameEditCommand =
  | (Omit<Extract<EditCommand, { type: 'add_clip' }>, 'item'> & { item: FrameClipItem })
  | (Omit<Extract<EditCommand, { type: 'add_text' }>, 'item'> & { item: FrameTextItem })
  | (Omit<Extract<EditCommand, { type: 'duplicate_item' }>, 'timeline_start_us'> & {
      timeline_start_frame?: Frame
    })
  | Extract<EditCommand, { type: 'remove_item' }>
  | (Omit<Extract<EditCommand, { type: 'move_item' }>, 'timeline_start_us'> & {
      timeline_start_frame: Frame
    })
  | (Omit<Extract<EditCommand, { type: 'trim_item' }>, 'timeline_us' | 'source_us'> & {
      timeline_frame: Frame
      source_frame: Frame
    })
  | (Omit<Extract<EditCommand, { type: 'split_item' }>, 'at_timeline_us' | 'at_source_us'> & {
      at_timeline_frame: Frame
      at_source_frame: Frame
    })
  | (Omit<Extract<EditCommand, { type: 'ripple_delete' }>, 'start_us' | 'end_us'> & {
      start_frame: Frame
      end_frame: Frame
    })
  | Extract<
      EditCommand,
      {
        type:
          | 'add_track'
          | 'remove_track'
          | 'move_track'
          | 'update_track'
          | 'add_caption_track'
          | 'remove_caption_track'
          | 'update_caption_track'
      }
    >
  | (Omit<Extract<EditCommand, { type: 'upsert_caption_cues' }>, 'cues'> & {
      cues: readonly FrameCaptionCue[]
    })
  | Extract<EditCommand, { type: 'remove_caption_cues' }>
  | (Omit<Extract<EditCommand, { type: 'set_item_properties' }>, 'properties'> & {
      properties: FrameItemPropertiesPatch
    })
  | Extract<EditCommand, { type: 'set_caption_style' | 'request_job' }>

export interface FrameEditCommandBatch extends Omit<EditCommandBatch, 'commands'> {
  fps: FrameRateLike
  commands: readonly FrameEditCommand[]
}

function transitionToFrames(
  transition: Transition | null | undefined,
  fps: FrameRateLike,
): FrameTransition | null | undefined {
  if (transition === undefined) return undefined
  if (transition === null) return null
  return {
    transition_type: transition.transition_type,
    duration_frame: assertFrameAligned(transition.duration_us, fps),
  }
}

function keyframeToFrames(keyframe: Keyframe, fps: FrameRateLike): FrameKeyframe {
  return {
    property: keyframe.property,
    time_frame: assertFrameAligned(keyframe.time_us, fps),
    value: keyframe.value,
    interpolation: keyframe.interpolation,
  }
}

function itemToFrames(item: TimelineItem, fps: FrameRateLike): FrameItem {
  if (item.item_type === 'caption_cue') {
    return {
      ...item,
      start_frame: assertFrameAligned(item.start_us, fps),
      end_frame: assertFrameAligned(item.end_us, fps),
    }
  }
  if (item.item_type === 'text') {
    return {
      ...item,
      timeline_start_frame: assertFrameAligned(item.timeline_start_us, fps),
      timeline_end_frame: assertFrameAligned(item.timeline_end_us, fps),
      keyframes: item.keyframes?.map((keyframe) => keyframeToFrames(keyframe, fps)),
    }
  }
  return {
    ...item,
    timeline_start_frame: assertFrameAligned(item.timeline_start_us, fps),
    timeline_end_frame: assertFrameAligned(item.timeline_end_us, fps),
    source_start_frame: assertFrameAligned(item.source_start_us, fps),
    source_end_frame: assertFrameAligned(item.source_end_us, fps),
    fade_in_frame:
      item.fade_in_us === undefined ? undefined : assertFrameAligned(item.fade_in_us, fps),
    fade_out_frame:
      item.fade_out_us === undefined ? undefined : assertFrameAligned(item.fade_out_us, fps),
    transition_in: transitionToFrames(item.transition_in, fps),
    transition_out: transitionToFrames(item.transition_out, fps),
    keyframes: item.keyframes?.map((keyframe) => keyframeToFrames(keyframe, fps)),
  }
}

function propertiesToFrames(
  properties: ItemPropertiesPatch,
  fps: FrameRateLike,
): FrameItemPropertiesPatch {
  return {
    ...properties,
    fade_in_frame:
      properties.fade_in_us === undefined
        ? undefined
        : properties.fade_in_us === null
          ? null
          : assertFrameAligned(properties.fade_in_us, fps),
    fade_out_frame:
      properties.fade_out_us === undefined
        ? undefined
        : properties.fade_out_us === null
          ? null
          : assertFrameAligned(properties.fade_out_us, fps),
    transition_in: transitionToFrames(properties.transition_in, fps),
    transition_out: transitionToFrames(properties.transition_out, fps),
    keyframes: properties.keyframes?.map((keyframe) => keyframeToFrames(keyframe, fps)),
  }
}

export function translateCommandToFrames(
  command: EditCommand,
  fps: FrameRateLike,
): FrameEditCommand {
  switch (command.type) {
    case 'add_clip':
      return { ...command, item: itemToFrames(command.item, fps) as FrameClipItem }
    case 'add_text':
      return { ...command, item: itemToFrames(command.item, fps) as FrameTextItem }
    case 'duplicate_item':
      return {
        ...command,
        ...(command.timeline_start_us === undefined
          ? {}
          : { timeline_start_frame: assertFrameAligned(command.timeline_start_us, fps) }),
      }
    case 'remove_item':
      return command
    case 'move_item':
      return {
        ...command,
        timeline_start_frame: assertFrameAligned(command.timeline_start_us, fps),
      }
    case 'trim_item':
      return {
        ...command,
        timeline_frame: assertFrameAligned(command.timeline_us, fps),
        source_frame: assertFrameAligned(command.source_us, fps),
      }
    case 'split_item':
      return {
        ...command,
        at_timeline_frame: assertFrameAligned(command.at_timeline_us, fps),
        at_source_frame: assertFrameAligned(command.at_source_us, fps),
      }
    case 'ripple_delete':
      return {
        ...command,
        start_frame: assertFrameAligned(command.start_us, fps),
        end_frame: assertFrameAligned(command.end_us, fps),
      }
    case 'upsert_caption_cues':
      return {
        ...command,
        cues: command.cues.map((cue) => itemToFrames(cue, fps) as FrameCaptionCue),
      }
    case 'set_item_properties':
      return { ...command, properties: propertiesToFrames(command.properties, fps) }
    case 'add_track':
    case 'remove_track':
    case 'move_track':
    case 'update_track':
    case 'add_caption_track':
    case 'remove_caption_track':
    case 'update_caption_track':
    case 'remove_caption_cues':
    case 'set_caption_style':
    case 'request_job':
      return command
  }
}

export function translateCommandBatchToFrames(
  batch: EditCommandBatch,
  fps: FrameRateLike,
): FrameEditCommandBatch {
  return {
    ...batch,
    fps,
    commands: batch.commands.map((command) => translateCommandToFrames(command, fps)),
  }
}
