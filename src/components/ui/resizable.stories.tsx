import type { Meta, StoryObj } from '@storybook/react-vite'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'

const meta = {
  title: 'UI/Resizable',
  component: ResizablePanelGroup,
} satisfies Meta<typeof ResizablePanelGroup>

export default meta

type Story = StoryObj<typeof meta>

function Pane({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-panel-bg text-sm text-muted-foreground">
      {label}
    </div>
  )
}

export const Horizontal: Story = {
  args: { direction: 'horizontal' },
  render: (args) => (
    <ResizablePanelGroup
      {...args}
      className="h-72 w-full max-w-3xl rounded-lg border border-border"
    >
      <ResizablePanel defaultSize={30} minSize={15}>
        <Pane label="Media" />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={70}>
        <Pane label="Preview" />
      </ResizablePanel>
    </ResizablePanelGroup>
  ),
}

/** `withHandle` adds the grip — used where the divider is easy to miss. */
export const WithGrip: Story = {
  args: { direction: 'horizontal' },
  render: (args) => (
    <ResizablePanelGroup
      {...args}
      className="h-72 w-full max-w-3xl rounded-lg border border-border"
    >
      <ResizablePanel defaultSize={50}>
        <Pane label="Preview" />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={50}>
        <Pane label="Inspector" />
      </ResizablePanel>
    </ResizablePanelGroup>
  ),
}

/** The editor's real shape: panels above, the timeline well below. */
export const EditorLayout: Story = {
  args: { direction: 'vertical' },
  render: (args) => (
    <ResizablePanelGroup
      {...args}
      className="h-96 w-full max-w-3xl rounded-lg border border-border"
    >
      <ResizablePanel defaultSize={60}>
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={35} minSize={20}>
            <Pane label="Media" />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={65}>
            <Pane label="Preview" />
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={40} minSize={20}>
        <div className="flex h-full items-center justify-center bg-timeline-bg text-sm text-muted-foreground">
          Timeline
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  ),
}
