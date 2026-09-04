import type { Meta, StoryObj } from '@storybook/react-vite'
import { Download, FileVideo, FolderOpen, Save, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const meta = {
  title: 'UI/DropdownMenu',
  component: DropdownMenu,
} satisfies Meta<typeof DropdownMenu>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { defaultOpen: true },
  render: (args) => (
    <div className="flex h-80 items-start">
      <DropdownMenu {...args}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">File</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Project</DropdownMenuLabel>
          <DropdownMenuItem>
            <FolderOpen />
            Open project…
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Save />
            Save
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>
            <FileVideo />
            Import media…
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Download />
            Export…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled>
            <Settings />
            Preferences (desktop only)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ),
}

export const WithCheckboxItems: Story = {
  args: { defaultOpen: true },
  render: (args) => (
    <div className="flex h-72 items-start">
      <DropdownMenu {...args}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">View</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Timeline</DropdownMenuLabel>
          <DropdownMenuCheckboxItem checked>Show audio waveforms</DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked>Show snapping guides</DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem>Show frame numbers</DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ),
}

/** `inset` reserves the indicator gutter so plain items line up under checkable ones. */
export const InsetItems: Story = {
  args: { defaultOpen: true },
  render: (args) => (
    <div className="flex h-64 items-start">
      <DropdownMenu {...args}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">Track</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuCheckboxItem checked>Lock track</DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem inset>Add track above</DropdownMenuItem>
          <DropdownMenuItem inset>Add track below</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ),
}
