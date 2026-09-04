import type { Meta, StoryObj } from '@storybook/react-vite'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'

const meta = {
  title: 'UI/Toaster',
  component: Toaster,
} satisfies Meta<typeof Toaster>

export default meta

type Story = StoryObj<typeof meta>

/**
 * One `Toaster` is mounted at the app root; features call `toast()` from sonner.
 * It is pinned bottom-right with rich colours and a close button.
 */
export const Playground: Story = {
  render: (args) => (
    <>
      <Toaster {...args} />
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => toast('Marker added at 00:01:12:04')}>
          Neutral
        </Button>
        <Button variant="outline" onClick={() => toast.success('Export finished')}>
          Success
        </Button>
        <Button
          variant="outline"
          onClick={() => toast.error('Media offline', { description: 'A001_C003.mov is missing.' })}
        >
          Error
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            toast('Clip deleted', {
              description: '3 clips removed from V1.',
              action: { label: 'Undo', onClick: () => toast('Restored') },
            })
          }
        >
          With action
        </Button>
        <Button variant="outline" onClick={() => toast.loading('Generating proxies…')}>
          Loading
        </Button>
      </div>
    </>
  ),
}

/** Toasts stack bottom-up; the description line drops to muted ink. */
export const Stacked: Story = {
  render: (args) => (
    <>
      <Toaster {...args} />
      <Button
        variant="outline"
        onClick={() => {
          toast.success('Proxy generated', { description: 'A001_C003.mov' })
          toast.success('Proxy generated', { description: 'A001_C007.mov' })
          toast.error('Proxy failed', { description: 'A002_C001.mov — unsupported codec' })
        }}
      >
        Show three toasts
      </Button>
    </>
  ),
}
