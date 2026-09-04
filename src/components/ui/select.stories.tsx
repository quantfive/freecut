import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const meta = {
  title: 'UI/Select',
  component: Select,
} satisfies Meta<typeof Select>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <Select {...args}>
      <SelectTrigger className="w-56">
        <SelectValue placeholder="Frame rate" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="23.976">23.976 fps</SelectItem>
        <SelectItem value="24">24 fps</SelectItem>
        <SelectItem value="25">25 fps</SelectItem>
        <SelectItem value="29.97">29.97 fps</SelectItem>
        <SelectItem value="60">60 fps</SelectItem>
      </SelectContent>
    </Select>
  ),
}

export const WithValue: Story = {
  args: { defaultValue: '23.976' },
  render: Default.render,
}

export const Grouped: Story = {
  args: { defaultValue: 'h264' },
  render: (args) => (
    <Select {...args}>
      <SelectTrigger className="w-56">
        <SelectValue placeholder="Codec" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Video</SelectLabel>
          <SelectItem value="h264">H.264</SelectItem>
          <SelectItem value="h265">H.265 / HEVC</SelectItem>
          <SelectItem value="prores">ProRes 422</SelectItem>
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Audio only</SelectLabel>
          <SelectItem value="aac">AAC</SelectItem>
          <SelectItem value="mp3">MP3</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
}

export const Disabled: Story = {
  args: { disabled: true, defaultValue: '23.976' },
  render: Default.render,
}

/** The trigger clamps to one line; long option labels truncate rather than wrap. */
export const LongOptionLabels: Story = {
  render: (args) => (
    <Select {...args}>
      <SelectTrigger className="w-56">
        <SelectValue placeholder="Preset" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="web">Web 1080p — H.264, 12 Mb/s, AAC 192 kb/s</SelectItem>
        <SelectItem value="master">Master 4K — ProRes 422 HQ, PCM 48 kHz</SelectItem>
      </SelectContent>
    </Select>
  ),
}
