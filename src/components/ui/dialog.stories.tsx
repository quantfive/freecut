import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'

const meta = {
  title: 'UI/Dialog',
  component: Dialog,
} satisfies Meta<typeof Dialog>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { defaultOpen: true },
  render: (args) => (
    <Dialog {...args}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export sequence</DialogTitle>
          <DialogDescription>
            Renders the full timeline. You can keep editing while it runs.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="export-name">File name</Label>
          <Input id="export-name" defaultValue="interview-cut-03.mp4" />
        </div>
        <DialogFooter>
          <Button variant="outline">Cancel</Button>
          <Button>Start export</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

/** Progress dialogs hide the close affordance so a render is not dismissed by accident. */
export const WithoutCloseButton: Story = {
  args: { defaultOpen: true },
  render: (args) => (
    <Dialog {...args}>
      <DialogContent hideCloseButton className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Rendering</DialogTitle>
          <DialogDescription>Frame 1 728 of 2 400</DialogDescription>
        </DialogHeader>
        <Progress value={72} className="h-2" />
        <DialogFooter>
          <Button variant="outline">Cancel render</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

export const LongContent: Story = {
  args: { defaultOpen: true },
  render: (args) => (
    <Dialog {...args}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Relink offline media</DialogTitle>
          <DialogDescription>
            Four clips point at files that are no longer readable. Relinking asks for the folder
            they moved to and rewrites every reference in the project, including clips nested inside
            compositions. Nothing is re-encoded, and the edit is left untouched — only the path each
            clip resolves through changes.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-1 font-mono text-xs tabular-nums text-muted-foreground">
          <li>A001_C003.mov</li>
          <li>A001_C007.mov</li>
          <li>A002_C001.mov</li>
          <li>voiceover-take-4.wav</li>
        </ul>
        <DialogFooter>
          <Button variant="outline">Later</Button>
          <Button>Choose folder…</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

/**
 * `ui/dialog` deliberately exports no `DialogTrigger` — every caller in the editor
 * drives `open` from its own store, so the controlled shape is the real one.
 */
export const Controlled: Story = {
  render: function ControlledDialog() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <Button variant="outline" onClick={() => setOpen(true)}>
          Project settings
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Project settings</DialogTitle>
              <DialogDescription>Resolution, frame rate and colour space.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => setOpen(false)}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    )
  },
}
