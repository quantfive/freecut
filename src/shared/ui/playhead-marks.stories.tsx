import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { PlayheadMarks } from '@/shared/ui/playhead-marks'

const meta = {
  title: 'Editor Surfaces/PlayheadMarks',
  component: PlayheadMarks,
  argTypes: {
    handle: { control: 'inline-radio', options: ['flag', 'none'] },
    pointer: { control: 'boolean' },
  },
} satisfies Meta<typeof PlayheadMarks>

export default meta

type Story = StoryObj<typeof meta>

/** Purely visual — the parent positions the group at the current frame. */
function TimelineWell({ children, left = 160 }: { children: ReactNode; left?: number }) {
  return (
    <div className="relative h-32 w-[28rem] overflow-hidden rounded-md border border-border bg-timeline-bg">
      <div className="absolute inset-x-0 top-0 h-6 border-b border-border bg-panel-header" />
      <div className="absolute left-3 top-9 h-10 w-40 rounded-sm bg-timeline-video" />
      <div className="absolute left-44 top-9 h-10 w-32 rounded-sm bg-timeline-audio" />
      <div className="absolute inset-y-0" style={{ left }}>
        {children}
      </div>
    </div>
  )
}

export const Flag: Story = {
  args: { handle: 'flag' },
  render: (args) => (
    <TimelineWell>
      <PlayheadMarks {...args} />
    </TimelineWell>
  ),
}

/** `none` draws just the line — for a split ruler whose flag lives above. */
export const LineOnly: Story = {
  args: { handle: 'none' },
  render: (args) => (
    <TimelineWell>
      <PlayheadMarks {...args} />
    </TimelineWell>
  ),
}

/** The Color navigator adds a downward pointer under the flag. */
export const WithPointer: Story = {
  args: { handle: 'flag', pointer: true },
  render: (args) => (
    <TimelineWell>
      <PlayheadMarks {...args} />
    </TimelineWell>
  ),
}

/** The Edit ruler drops the group into the tick lane below the in/out bar. */
export const Offset: Story = {
  args: { handle: 'flag', topOffsetPx: 12 },
  render: (args) => (
    <TimelineWell>
      <PlayheadMarks {...args} />
    </TimelineWell>
  ),
}
