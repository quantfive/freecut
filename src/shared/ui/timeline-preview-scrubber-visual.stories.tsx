import { useEffect, type ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { usePlaybackStore } from '@/shared/state/playback'
import { TimelinePreviewScrubberVisual } from '@/shared/ui/timeline-preview-scrubber-visual'

const meta = {
  title: 'Editor Surfaces/TimelinePreviewScrubberVisual',
  component: TimelinePreviewScrubberVisual,
  args: { fps: 24, frameToPixels: (frame: number) => frame * 4 },
} satisfies Meta<typeof TimelinePreviewScrubberVisual>

export default meta

type Story = StoryObj<typeof meta>

/**
 * The ghost playhead that follows the pointer across every Edit timeline. It
 * reads the preview frame straight from the playback store and positions itself
 * imperatively, so these stories seed that store rather than pass a position.
 */
function ScrubberStage({
  previewFrame,
  children,
}: {
  previewFrame: number | null
  children: ReactNode
}) {
  useEffect(() => {
    usePlaybackStore.getState().setPreviewFrame(previewFrame)
    return () => usePlaybackStore.getState().setPreviewFrame(null)
  }, [previewFrame])

  return (
    <div className="relative h-32 w-[28rem] overflow-hidden rounded-md border border-border bg-timeline-bg">
      <div className="absolute inset-x-0 top-0 h-6 border-b border-border bg-panel-header" />
      <div className="absolute left-3 top-9 h-10 w-40 rounded-sm bg-timeline-video" />
      {children}
    </div>
  )
}

export const OverTracks: Story = {
  render: (args) => (
    <ScrubberStage previewFrame={40}>
      <TimelinePreviewScrubberVisual {...args} />
    </ScrubberStage>
  ),
}

/** In the ruler it gains the timecode tooltip. */
export const InRuler: Story = {
  args: { inRuler: true },
  render: (args) => (
    <ScrubberStage previewFrame={64}>
      <TimelinePreviewScrubberVisual {...args} />
    </ScrubberStage>
  ),
}

/** Suppressed (a drag is in progress) or with no preview frame: nothing renders. */
export const Suppressed: Story = {
  args: { suppressed: true },
  render: (args) => (
    <ScrubberStage previewFrame={40}>
      <TimelinePreviewScrubberVisual {...args} />
    </ScrubberStage>
  ),
}
