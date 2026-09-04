import { useEffect, useState, type ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'

/**
 * The design language itself — colour ramp, type scale, spacing, radii,
 * elevation and easing — read live out of `src/index.css` and the timeline
 * theme extension, so this page cannot drift from the tokens the app ships.
 */
const meta = {
  title: 'Foundations/Design Tokens',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

/** Resolves a custom property off `:root` so swatches show the real value. */
function useTokenValue(token: string): string {
  const [value, setValue] = useState('')

  useEffect(() => {
    const resolved = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
    setValue(resolved)
  }, [token])

  return value
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {hint && <p className="max-w-2xl text-sm text-muted-foreground">{hint}</p>}
      </header>
      {children}
    </section>
  )
}

function Swatch({ token, name, note }: { token: string; name: string; note?: string }) {
  const value = useTokenValue(token)

  return (
    <div className="flex items-center gap-3">
      <span
        className="h-11 w-11 shrink-0 rounded-md border border-border"
        style={{ backgroundColor: `var(${token})` }}
      />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{name}</span>
        <span className="block truncate font-mono text-[11px] text-muted-foreground">{token}</span>
        <span className="block truncate font-mono text-[11px] text-muted-foreground">
          {value || '—'}
        </span>
        {note && <span className="block text-xs text-muted-foreground">{note}</span>}
      </span>
    </div>
  )
}

function SwatchGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
}

/**
 * A near-monochrome graphite ramp lit by a single warm orange. Depth comes from
 * stepping lightness, not from shadows — the timeline floor is darkest, panels
 * sit above it, popovers in between.
 */
export const Colors: Story = {
  render: () => (
    <div className="space-y-10">
      <Section
        title="Signal"
        hint="Orange means active. Playback, the playhead, focus rings, selection — never decoration. Its rarity is what makes it legible."
      >
        <SwatchGrid>
          <Swatch token="--primary" name="Signal orange" note="Playback, active, focus" />
          <Swatch token="--primary-foreground" name="On signal" note="Near-black text on orange" />
          <Swatch token="--ring" name="Focus ring" />
        </SwatchGrid>
      </Section>

      <Section
        title="Surfaces"
        hint="The value hierarchy: timeline floor 0.12 → panel header 0.14 → popover 0.16 → panel 0.18. Separate two surfaces by value before reaching for a border."
      >
        <SwatchGrid>
          <Swatch token="--timeline-bg" name="Timeline floor" note="0.12 — the darkest surface" />
          <Swatch token="--panel-header" name="Panel header" note="0.14" />
          <Swatch token="--background" name="Canvas" note="0.15 — app background" />
          <Swatch token="--popover" name="Popover" note="0.16 — menus, dropdowns" />
          <Swatch token="--card" name="Panel surface" note="0.18" />
          <Swatch token="--muted" name="Muted fill" note="0.20" />
          <Swatch token="--secondary" name="Raised graphite" note="0.22" />
          <Swatch token="--accent" name="Hover graphite" note="0.24" />
          <Swatch token="--border" name="Border" note="0.25" />
        </SwatchGrid>
      </Section>

      <Section title="Ink">
        <SwatchGrid>
          <Swatch token="--foreground" name="Ink" note="Primary text" />
          <Swatch token="--card-foreground" name="Panel ink" />
          <Swatch token="--muted-foreground" name="Muted ink" note="Secondary text, placeholders" />
          <Swatch token="--destructive" name="Error red" note="Delete, irreversible" />
        </SwatchGrid>
      </Section>

      <Section
        title="Timeline hues"
        hint="These are data, not styling. Each encodes a clip type or an edit landmark, and must keep its meaning — never repurposed for decoration, never the only signal of state."
      >
        <SwatchGrid>
          <Swatch token="--color-timeline-video" name="Video" />
          <Swatch token="--color-timeline-audio" name="Audio" />
          <Swatch token="--color-timeline-image" name="Image" />
          <Swatch token="--color-timeline-text" name="Text" />
          <Swatch token="--color-timeline-shape" name="Shape" />
          <Swatch token="--color-timeline-baseclip" name="Base clip" />
          <Swatch token="--color-timeline-playhead" name="Playhead" />
          <Swatch token="--color-timeline-in" name="Mark in" />
          <Swatch token="--color-timeline-out" name="Mark out" />
          <Swatch token="--color-timeline-marker" name="Marker" />
          <Swatch token="--color-timeline-snap" name="Snap indicator" />
          <Swatch token="--color-timeline-join" name="Join indicator" />
        </SwatchGrid>
      </Section>
    </div>
  ),
}

const typeScale = [
  { name: 'Headline', className: 'text-xl font-semibold tracking-tight', role: 'Dialog titles' },
  { name: 'Title', className: 'text-base font-semibold', role: 'Panel titles' },
  { name: 'Body', className: 'text-sm', role: 'Default UI text, menu items' },
  { name: 'Label', className: 'text-xs font-medium', role: 'Control labels, captions' },
  {
    name: 'Mono',
    className: 'font-mono text-xs tabular-nums',
    role: 'Timecode, frames, fps, dB',
  },
]

/**
 * IBM Plex Sans does the interface work; IBM Plex Mono takes every value an
 * editor reads precisely, so digits align and never jump width.
 */
export const Typography: Story = {
  render: () => (
    <div className="space-y-10">
      <Section title="Scale">
        <div className="space-y-5">
          {typeScale.map((step) => (
            <div key={step.name} className="border-b border-border pb-4">
              <div className="mb-1 flex items-baseline gap-3">
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  {step.name}
                </span>
                <span className="text-xs text-muted-foreground">{step.role}</span>
              </div>
              <p className={step.className}>Ripple delete closes the gap — 00:01:12:04</p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Mono for data"
        hint="Every timecode, frame count, frame rate and level is set in IBM Plex Mono with tabular figures. Prose and labels stay in Plex Sans."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="mb-2 text-xs text-muted-foreground">Mono, tabular</p>
            <p className="font-mono text-sm tabular-nums">00:00:04:11</p>
            <p className="font-mono text-sm tabular-nums">00:01:12:04</p>
            <p className="font-mono text-sm tabular-nums">23.976 fps · −6.0 dB</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="mb-2 text-xs text-muted-foreground">Sans — digits drift</p>
            <p className="text-sm">00:00:04:11</p>
            <p className="text-sm">00:01:12:04</p>
            <p className="text-sm">23.976 fps · −6.0 dB</p>
          </div>
        </div>
      </Section>
    </div>
  ),
}

const spacingSteps = [
  { name: 'xs', className: 'w-1', px: '4px' },
  { name: 'sm', className: 'w-2', px: '8px' },
  { name: 'md', className: 'w-3', px: '12px' },
  { name: 'lg', className: 'w-4', px: '16px' },
  { name: 'xl', className: 'w-6', px: '24px' },
]

const radiusSteps = [
  { name: 'sm', token: '--radius-sm', className: 'rounded-sm' },
  { name: 'md', token: '--radius-md', className: 'rounded-md' },
  { name: 'lg', token: '--radius-lg', className: 'rounded-lg' },
  { name: 'xl', token: '--radius-xl', className: 'rounded-xl' },
]

export const SpacingAndRadii: Story = {
  render: () => (
    <div className="space-y-10">
      <Section title="Spacing" hint="A 4px base unit; panels pad at 12–16px.">
        <div className="space-y-2">
          {spacingSteps.map((step) => (
            <div key={step.name} className="flex items-center gap-3">
              <span className="w-8 font-mono text-[11px] text-muted-foreground">{step.name}</span>
              <span className={`h-4 ${step.className} rounded-sm bg-primary`} />
              <span className="font-mono text-[11px] text-muted-foreground">{step.px}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Radii" hint="Softly rounded, never pill-shaped, never sharp.">
        <div className="flex flex-wrap gap-6">
          {radiusSteps.map((step) => (
            <div key={step.name} className="flex flex-col items-center gap-2">
              <span className={`h-16 w-16 border border-border bg-card ${step.className}`} />
              <span className="font-mono text-[11px] text-muted-foreground">{step.name}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  ),
}

/**
 * Flat by default. Panels are separated by value, not lift; shadows are for
 * things that genuinely float, plus the orange glow on active elements.
 */
export const Elevation: Story = {
  render: () => (
    <div className="flex flex-wrap gap-6">
      <div className="w-56 rounded-lg border border-border bg-card p-4">
        <p className="text-sm font-medium">Flat panel</p>
        <p className="mt-1 text-xs text-muted-foreground">Default. No shadow.</p>
      </div>
      <div
        className="w-56 rounded-lg border border-border bg-popover p-4"
        style={{ boxShadow: '0 4px 24px oklch(0 0 0 / 0.5)' }}
      >
        <p className="text-sm font-medium">Floating layer</p>
        <p className="mt-1 text-xs text-muted-foreground">Menus, popovers, dialogs.</p>
      </div>
      <div className="glow-primary w-56 rounded-lg border border-primary/40 bg-card p-4">
        <p className="text-sm font-medium text-primary">Signal glow</p>
        <p className="mt-1 text-xs text-muted-foreground">Active / playing elements only.</p>
      </div>
    </div>
  ),
}

const easings = [
  { token: '--ease-out-strong', name: 'ease-out-strong', role: 'UI entrances and exits' },
  { token: '--ease-in-out-strong', name: 'ease-in-out-strong', role: 'On-screen movement' },
  { token: '--ease-drawer', name: 'ease-drawer', role: 'Drawer and panel slides' },
]

/** Shared curves — reference these instead of hand-rolling cubic-beziers. */
export const Motion: Story = {
  render: function MotionStory() {
    const [shifted, setShifted] = useState(false)

    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setShifted((value) => !value)}
          className="rounded-md bg-secondary px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary/80"
        >
          Play the curves
        </button>
        <div className="space-y-3">
          {easings.map((easing) => (
            <div key={easing.token} className="space-y-1">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[11px] text-muted-foreground">{easing.name}</span>
                <span className="text-xs text-muted-foreground">{easing.role}</span>
              </div>
              <div className="h-8 rounded-md border border-border bg-card p-1">
                <span
                  className="block h-6 w-6 rounded-sm bg-primary transition-transform duration-700"
                  style={{
                    transform: shifted ? 'translateX(20rem)' : 'translateX(0)',
                    transitionTimingFunction: `var(${easing.token})`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  },
}
