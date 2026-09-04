import type { Meta, StoryObj } from '@storybook/react-vite'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const meta = {
  title: 'UI/Tabs',
  component: Tabs,
  args: { defaultValue: 'edit' },
} satisfies Meta<typeof Tabs>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <Tabs {...args} className="w-96">
      <TabsList>
        <TabsTrigger value="edit">Edit</TabsTrigger>
        <TabsTrigger value="color">Color</TabsTrigger>
        <TabsTrigger value="audio">Audio</TabsTrigger>
      </TabsList>
      <TabsContent value="edit" className="text-sm text-muted-foreground">
        Trim, ripple and roll the selected clip.
      </TabsContent>
      <TabsContent value="color" className="text-sm text-muted-foreground">
        Wheels, curves and scopes for the current grade.
      </TabsContent>
      <TabsContent value="audio" className="text-sm text-muted-foreground">
        Levels, EQ and fades for the selected audio clip.
      </TabsContent>
    </Tabs>
  ),
}

export const WithDisabledTab: Story = {
  render: (args) => (
    <Tabs {...args} className="w-96">
      <TabsList>
        <TabsTrigger value="edit">Edit</TabsTrigger>
        <TabsTrigger value="color">Color</TabsTrigger>
        <TabsTrigger value="effects" disabled>
          Effects
        </TabsTrigger>
      </TabsList>
      <TabsContent value="edit" className="text-sm text-muted-foreground">
        Effects are unavailable until a clip is selected.
      </TabsContent>
    </Tabs>
  ),
}

/** The list does not scroll — many tabs simply widen it, so panels cap the count. */
export const ManyTabs: Story = {
  render: (args) => (
    <Tabs {...args} className="w-full max-w-2xl">
      <TabsList>
        {['edit', 'color', 'audio', 'effects', 'text', 'export'].map((value) => (
          <TabsTrigger key={value} value={value} className="capitalize">
            {value}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="edit" className="text-sm text-muted-foreground">
        Six triggers is about the practical ceiling for a side panel.
      </TabsContent>
    </Tabs>
  ),
}
