import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

const meta = {
  title: 'UI/AlertDialog',
  component: AlertDialog,
} satisfies Meta<typeof AlertDialog>

export default meta

type Story = StoryObj<typeof meta>

/** Confirmation for a destructive, unqueued action — no close X, an explicit cancel. */
export const Destructive: Story = {
  args: { defaultOpen: true },
  render: (args) => (
    <AlertDialog {...args}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete 3 clips?</AlertDialogTitle>
          <AlertDialogDescription>
            The clips are removed from the timeline. The source media on disk is untouched.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
}

export const LongDescription: Story = {
  args: { defaultOpen: true },
  render: (args) => (
    <AlertDialog {...args}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Bake motion into keyframes?</AlertDialogTitle>
          <AlertDialogDescription>
            Baking converts the generated motion into explicit keyframes on the clip. You can edit
            each keyframe afterwards, but the generator's parameters are no longer live — changing
            them will not update this clip. Undo restores the generated motion.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction>Bake</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
}
