import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '@/components/ui/button'
import { MotionBakeConfirmationDialog } from '@/shared/ui/motion-bake-confirmation-dialog'

const meta = {
  title: 'Editor Surfaces/MotionBakeConfirmationDialog',
  component: MotionBakeConfirmationDialog,
  args: { open: true, onOpenChange: () => undefined, onConfirm: () => undefined },
} satisfies Meta<typeof MotionBakeConfirmationDialog>

export default meta

type Story = StoryObj<typeof meta>

/** Copy comes from i18next, so this also proves the catalog's translations load. */
export const Open: Story = {}

export const Controlled: Story = {
  render: function ControlledBakeDialog(args) {
    const [open, setOpen] = useState(false)
    return (
      <>
        <Button variant="outline" onClick={() => setOpen(true)}>
          Bake motion
        </Button>
        <MotionBakeConfirmationDialog
          {...args}
          open={open}
          onOpenChange={setOpen}
          onConfirm={() => setOpen(false)}
        />
      </>
    )
  },
}
