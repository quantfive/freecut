import type { DocPageContent } from '../docs-content'

const page = {
  order: 8,
  slug: 'preview',
  title: 'Preview and Playback',
  description:
    'Play, step frames, zoom the monitor, go fullscreen, save frames, and use proxy playback.',
  category: 'Core Editing',
  related: ['timeline', 'effects-color'],
  sections: [
    {
      title: 'Play and navigate',
      blocks: [
        {
          kind: 'list',
          items: [
            'Play and pause with the preview controls or `Space`.',
            'Use `J`, `K`, and `L` for reverse shuttle, pause, and forward shuttle. Repeated `J` or `L` presses increase shuttle speed.',
            'Step one frame at a time with `Left` and `Right` for frame-accurate checks.',
            'Jump to the start of the timeline with `Home` and the end with `End`.',
            'Read the timecode display to confirm the exact playhead position.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'When the pointer is over the Source Monitor, `J`, `K`, and `L` control the source. Otherwise they control the program timeline.',
        },
      ],
    },
    {
      title: 'Frame the view',
      blocks: [
        {
          kind: 'list',
          items: [
            'Adjust preview zoom to inspect detail; this does not change the export canvas.',
            'Use **Fullscreen** when reviewing motion or framing, and Exit Fullscreen to return.',
            'Use **Save frame** to write the current frame to an image file.',
            'Transform, mask, and edit overlays appear on the monitor when a matching item is selected.',
          ],
        },
      ],
    },
    {
      title: 'Playback performance and audio',
      blocks: [
        {
          kind: 'list',
          items: [
            'When proxies exist, FreeCut uses them for smoother playback of heavy media; exports still use the originals.',
            'The monitor volume control affects local playback only.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Exports use the project mix, so monitor volume never changes the rendered audio.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
