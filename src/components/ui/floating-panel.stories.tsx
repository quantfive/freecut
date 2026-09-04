import type { Meta, StoryObj } from '@storybook/react-vite'
import { Pin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FloatingPanel } from '@/components/ui/floating-panel'

const meta = {
  title: 'UI/FloatingPanel',
  component: FloatingPanel,
  args: { defaultBounds: { x: 120, y: 120, width: 320, height: 260 }, children: null },
} satisfies Meta<typeof FloatingPanel>

export default meta

type Story = StoryObj<typeof meta>

/**
 * A draggable, resizable panel portalled to `document.body` — used for detached
 * scopes and inspectors. Drag the header, or pull any edge or corner to resize.
 * No `storageKey` here, so each story starts from `defaultBounds` instead of
 * restoring a persisted position.
 */
export const Default: Story = {
  render: (args) => (
    <FloatingPanel {...args} title="Scopes">
      <div className="space-y-2 p-3 text-sm text-muted-foreground">
        <p>Waveform, vectorscope and histogram for the current frame.</p>
        <p className="font-mono text-xs tabular-nums">Y 0.18 — 0.92</p>
      </div>
    </FloatingPanel>
  ),
}

export const WithHeaderAction: Story = {
  render: (args) => (
    <FloatingPanel
      {...args}
      title="Audio meters"
      headerExtra={
        <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Pin panel">
          <Pin className="h-3.5 w-3.5" />
        </Button>
      }
      onClose={() => undefined}
    >
      <div className="p-3 font-mono text-xs tabular-nums text-muted-foreground">
        <p>L −6.0 dB</p>
        <p>R −6.4 dB</p>
      </div>
    </FloatingPanel>
  ),
}

/** `autoHeight` lets the body set the height; resizing is off for these. */
export const AutoHeight: Story = {
  args: {
    defaultBounds: { x: 480, y: 120, width: 260, height: 0 },
    autoHeight: true,
    resizable: false,
  },
  render: (args) => (
    <FloatingPanel {...args} title="Snap settings">
      <div className="space-y-1 p-3 text-sm text-muted-foreground">
        <p>Snap to clip edges</p>
        <p>Snap to playhead</p>
        <p>Snap to markers</p>
      </div>
    </FloatingPanel>
  ),
}

/** Untitled panels drop the header text but keep the drag surface. */
export const Untitled: Story = {
  args: { defaultBounds: { x: 120, y: 420, width: 260, height: 180 } },
  render: (args) => (
    <FloatingPanel {...args}>
      <div className="p-3 text-sm text-muted-foreground">No title — the bar is the grip.</div>
    </FloatingPanel>
  ),
}
