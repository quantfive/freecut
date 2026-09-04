import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '@/components/ui/button'
import { WindowPortal } from '@/components/ui/window-portal'

const meta = {
  title: 'UI/WindowPortal',
  component: WindowPortal,
  args: {
    title: 'FreeCut — Preview',
    width: 640,
    height: 400,
    children: null,
    onClose: () => undefined,
  },
} satisfies Meta<typeof WindowPortal>

export default meta

type Story = StoryObj<typeof meta>

/**
 * Renders its children into a real second browser window — how the preview is
 * popped out onto a second display. The window can only be opened from a user
 * gesture, so the story mounts it on click; a blocked pop-up surfaces through
 * `onBlocked` rather than failing silently.
 */
export const PopOut: Story = {
  render: function PopOutStory(args) {
    const [open, setOpen] = useState(false)
    const [blocked, setBlocked] = useState(false)

    return (
      <div className="space-y-3">
        <Button variant="outline" onClick={() => setOpen((value) => !value)}>
          {open ? 'Close pop-out window' : 'Open pop-out window'}
        </Button>
        {blocked && (
          <p className="text-sm text-destructive">
            The browser blocked the pop-up. Allow pop-ups for this origin and try again.
          </p>
        )}
        {open && (
          <WindowPortal
            {...args}
            onBlocked={() => {
              setBlocked(true)
              setOpen(false)
            }}
            onClose={() => setOpen(false)}
          >
            <div className="flex h-full items-center justify-center bg-background text-foreground">
              <p className="text-sm text-muted-foreground">
                This content lives in a second window.
              </p>
            </div>
          </WindowPortal>
        )}
      </div>
    )
  },
}
