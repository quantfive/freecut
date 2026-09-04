import type { Meta, StoryObj } from '@storybook/react-vite'
import { PickWhipOverlay } from '@/shared/ui/pick-whip-overlay'
import type {
  MotionPickWhipOverlaySnapshot,
  MotionPickWhipPresentation,
} from '@/shared/hooks/use-pick-whip-drag'

const clipBounds = { left: 0, top: 0, right: 448, bottom: 224 }

/** The overlay drives itself imperatively from the presentation's subscription;
 * these stories publish nothing and just render the initial snapshot. */
function staticPresentation(
  snapshot: Partial<MotionPickWhipOverlaySnapshot>,
): MotionPickWhipPresentation {
  const current: MotionPickWhipOverlaySnapshot = {
    startX: 60,
    startY: 48,
    currentX: 330,
    currentY: 170,
    valid: true,
    clipBounds,
    ...snapshot,
  }
  return {
    current,
    publish: () => undefined,
    subscribe: () => () => undefined,
  }
}

const meta = {
  title: 'Editor Surfaces/PickWhipOverlay',
  component: PickWhipOverlay,
  args: { presentation: staticPresentation({}), testId: 'pick-whip-story' },
} satisfies Meta<typeof PickWhipOverlay>

export default meta

type Story = StoryObj<typeof meta>

function Stage({ presentation }: { presentation: MotionPickWhipPresentation }) {
  return (
    <div className="relative h-56 w-[28rem] overflow-hidden rounded-md border border-border bg-panel-bg">
      <div className="absolute left-10 top-10 h-4 w-28 rounded-sm bg-accent" />
      <div className="absolute left-[19rem] top-[9.5rem] h-4 w-24 rounded-sm bg-accent" />
      <PickWhipOverlay presentation={presentation} testId="pick-whip-story" />
    </div>
  )
}

/** Dragging onto a valid target: the curve goes orange. */
export const Valid: Story = {
  render: () => <Stage presentation={staticPresentation({ valid: true })} />,
}

/** Over an ineligible row: red, with the reason rendered beside the cursor. */
export const Rejected: Story = {
  render: () => (
    <Stage
      presentation={staticPresentation({
        valid: false,
        rejectionMessage: 'A property cannot be parented to itself.',
      })}
    />
  ),
}

/** Over empty space: neutral slate, no target yet. */
export const NoTarget: Story = {
  render: () => <Stage presentation={staticPresentation({ valid: false })} />,
}
