import { useRef } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { VerticalScrollbarOverlay } from '@/shared/ui/vertical-scrollbar-overlay'

const meta = {
  title: 'Editor Surfaces/VerticalScrollbarOverlay',
  component: VerticalScrollbarOverlay,
  args: { ariaLabel: 'Scroll tracks' },
} satisfies Meta<typeof VerticalScrollbarOverlay>

export default meta

type Story = StoryObj<typeof meta>

/**
 * Timeline surfaces hide their native rail so the overlay can sit inside the
 * track area. Scroll the well, or drag the rail on the right.
 */
export const OverTracks: Story = {
  render: function OverTracksStory(args) {
    const scrollRef = useRef<HTMLDivElement>(null)

    return (
      <div className="relative h-64 w-[28rem] overflow-hidden rounded-md border border-border bg-timeline-bg">
        <div
          ref={scrollRef}
          className="h-full overflow-y-auto pr-4 [&::-webkit-scrollbar]:w-0"
          id="track-stack"
        >
          {Array.from({ length: 12 }, (_, index) => (
            <div
              key={index}
              className="m-2 flex h-12 items-center rounded-sm bg-timeline-video px-3 text-xs"
            >
              V{12 - index}
            </div>
          ))}
        </div>
        <VerticalScrollbarOverlay
          {...args}
          scrollRef={scrollRef}
          ariaControls="track-stack"
          className="absolute right-0 top-0 h-full w-3"
        />
      </div>
    )
  },
}

/** With nothing to scroll the thumb collapses and the rail stays empty. */
export const NoOverflow: Story = {
  render: function NoOverflowStory(args) {
    const scrollRef = useRef<HTMLDivElement>(null)

    return (
      <div className="relative h-64 w-[28rem] overflow-hidden rounded-md border border-border bg-timeline-bg">
        <div ref={scrollRef} className="h-full overflow-y-auto pr-4" id="short-stack">
          <div className="m-2 flex h-12 items-center rounded-sm bg-timeline-audio px-3 text-xs">
            A1
          </div>
        </div>
        <VerticalScrollbarOverlay
          {...args}
          scrollRef={scrollRef}
          ariaControls="short-stack"
          className="absolute right-0 top-0 h-full w-3"
        />
      </div>
    )
  },
}
