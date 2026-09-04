import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'

const meta = {
  title: 'UI/Accordion',
  component: Accordion,
} satisfies Meta<typeof Accordion>

export default meta

type Story = StoryObj<typeof meta>

export const Single: Story = {
  args: { type: 'single', collapsible: true, defaultValue: 'transform' },
  render: (args) => (
    <Accordion {...args} className="w-80">
      <AccordionItem value="transform">
        <AccordionTrigger>Transform</AccordionTrigger>
        <AccordionContent className="text-sm text-muted-foreground">
          Position, scale, rotation and anchor point.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="opacity">
        <AccordionTrigger>Opacity</AccordionTrigger>
        <AccordionContent className="text-sm text-muted-foreground">
          Blend mode and opacity keyframes.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="speed">
        <AccordionTrigger>Speed / duration</AccordionTrigger>
        <AccordionContent className="text-sm text-muted-foreground">
          Rate, reverse and frame blending.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
}

export const Multiple: Story = {
  args: { type: 'multiple', defaultValue: ['transform', 'opacity'] },
  render: (args) => (
    <Accordion {...args} className="w-80">
      <AccordionItem value="transform">
        <AccordionTrigger>Transform</AccordionTrigger>
        <AccordionContent className="text-sm text-muted-foreground">
          Position, scale, rotation and anchor point.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="opacity">
        <AccordionTrigger>Opacity</AccordionTrigger>
        <AccordionContent className="text-sm text-muted-foreground">
          Blend mode and opacity keyframes.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
}

/** A long body wraps inside the panel width rather than widening it. */
export const LongContent: Story = {
  args: { type: 'single', collapsible: true, defaultValue: 'about' },
  render: (args) => (
    <Accordion {...args} className="w-80">
      <AccordionItem value="about">
        <AccordionTrigger>About frame blending</AccordionTrigger>
        <AccordionContent className="text-sm text-muted-foreground">
          Frame blending interpolates between source frames when a clip is retimed, which smooths
          slow motion at the cost of render time. Optical flow produces the cleanest result but is
          the slowest of the three modes, so it is usually left off until the final export.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
}
