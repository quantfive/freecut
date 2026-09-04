import type { Meta, StoryObj } from '@storybook/react-vite'
import { ScrollArea } from '@/components/ui/scroll-area'

const meta = {
  title: 'UI/ScrollArea',
  component: ScrollArea,
} satisfies Meta<typeof ScrollArea>

export default meta

type Story = StoryObj<typeof meta>

const takes = Array.from({ length: 24 }, (_, index) => ({
  name: `A0${String(index + 1).padStart(2, '0')}_C${index + 1}.mov`,
  duration: `00:0${index % 6}:${String((index * 7) % 60).padStart(2, '0')}:12`,
}))

export const Vertical: Story = {
  render: (args) => (
    <ScrollArea {...args} className="h-72 w-80 rounded-lg border border-border bg-card">
      <div className="p-2">
        {takes.map((take) => (
          <div
            key={take.name}
            className="flex items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
          >
            <span className="truncate">{take.name}</span>
            <span className="ml-3 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
              {take.duration}
            </span>
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
}

/** Short content leaves the rail hidden — the scrollbar only fades in on overflow. */
export const NoOverflow: Story = {
  render: (args) => (
    <ScrollArea {...args} className="h-72 w-80 rounded-lg border border-border bg-card">
      <div className="p-2">
        {takes.slice(0, 3).map((take) => (
          <div key={take.name} className="px-2 py-1.5 text-sm">
            {take.name}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
}
