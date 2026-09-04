import type { Meta, StoryObj } from '@storybook/react-vite'
import { MarqueeOverlay } from '@/shared/marquee/marquee-overlay'
import type { MarqueeController, MarqueeState } from '@/shared/marquee/use-marquee-selection'

/**
 * The overlay subscribes straight to the marquee controller so only it
 * re-renders per pointer move. These stories hand it a frozen snapshot instead
 * of a live drag.
 */
function staticController(state: MarqueeState): MarqueeController {
  return { subscribe: () => () => undefined, getSnapshot: () => state }
}

const meta = {
  title: 'Editor Surfaces/MarqueeOverlay',
  component: MarqueeOverlay,
  args: {
    marquee: staticController({ active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 }),
  },
} satisfies Meta<typeof MarqueeOverlay>

export default meta

type Story = StoryObj<typeof meta>

function SelectionSurface({ marquee }: { marquee: MarqueeController }) {
  return (
    <div className="relative h-56 w-[28rem] overflow-hidden rounded-md border border-border bg-timeline-bg">
      <div className="absolute left-4 top-6 h-12 w-32 rounded-sm bg-timeline-video" />
      <div className="absolute left-40 top-6 h-12 w-24 rounded-sm bg-timeline-image" />
      <div className="absolute left-4 top-24 h-12 w-52 rounded-sm bg-timeline-audio" />
      <MarqueeOverlay marquee={marquee} />
    </div>
  )
}

export const Dragging: Story = {
  render: () => (
    <SelectionSurface
      marquee={staticController({
        active: true,
        startX: 16,
        startY: 16,
        currentX: 268,
        currentY: 124,
      })}
    />
  ),
}

/** Dragging up and to the left is the same rect — the corners are normalised. */
export const DraggedBackwards: Story = {
  render: () => (
    <SelectionSurface
      marquee={staticController({
        active: true,
        startX: 268,
        startY: 124,
        currentX: 16,
        currentY: 16,
      })}
    />
  ),
}

/** Inactive renders nothing at all. */
export const Inactive: Story = {
  render: () => (
    <SelectionSurface
      marquee={staticController({
        active: false,
        startX: 0,
        startY: 0,
        currentX: 0,
        currentY: 0,
      })}
    />
  ),
}
