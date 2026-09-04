import type { Meta, StoryObj } from '@storybook/react-vite'
import { ChevronRight } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

const meta = {
  title: 'UI/Collapsible',
  component: Collapsible,
} satisfies Meta<typeof Collapsible>

export default meta

type Story = StoryObj<typeof meta>

/**
 * The unstyled Radix primitive — panels wrap it with their own chrome (see
 * Property Controls / PropertySection for the editor's styled use).
 */
export const Default: Story = {
  args: { defaultOpen: true },
  render: (args) => (
    <Collapsible {...args} className="w-72 rounded-lg border border-border bg-card p-3">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 text-sm font-medium">
        <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
        Audio channels
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-1 pl-6 font-mono text-xs tabular-nums text-muted-foreground">
        <p>L −6.0 dB</p>
        <p>R −6.0 dB</p>
      </CollapsibleContent>
    </Collapsible>
  ),
}

export const Closed: Story = {
  args: { defaultOpen: false },
  render: Default.render,
}
