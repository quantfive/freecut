import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { CodePressCommandAdapter } from './adapter'
import { CaptionEditor } from './caption-editor'
import { framesToMicroseconds, type FrameRateLike } from './timing'
import type { ControlledEditorDocument } from './interfaces'

const fps: FrameRateLike = {
  numerator: 30_000n,
  denominator: 1_001n,
  value: 30_000 / 1_001,
}

function adapterWithTrack(): CodePressCommandAdapter {
  const document: ControlledEditorDocument = {
    fps,
    width: 1280,
    height: 720,
    timeline: {
      contract_version: 1,
      schema_version: 1,
      timeline_id: 'timeline-caption-ui',
      revision: 0,
      duration_us: framesToMicroseconds(180, fps),
      media: [],
      tracks: [
        {
          track_id: 'captions-en',
          kind: 'caption',
          name: 'English',
          language: 'en',
          locked: false,
          muted: false,
          items: [
            {
              item_type: 'caption_cue',
              cue_id: 'cue-1',
              track_id: 'captions-en',
              start_us: framesToMicroseconds(10, fps),
              end_us: framesToMicroseconds(40, fps),
              text: 'Hello',
            },
          ],
        },
      ],
    },
  }
  return new CodePressCommandAdapter({ document })
}

afterEach(() => cleanup())

describe('CaptionEditor', () => {
  it('shows an accessible empty state and adds a caption track through the adapter', async () => {
    const adapter = adapterWithTrack()
    adapter.apply({
      contract_version: 1,
      timeline_id: 'timeline-caption-ui',
      operation_id: 'remove-initial-track',
      idempotency_key: 'remove-initial-track',
      base_revision: 0,
      preconditions: [],
      commands: [
        { command_id: 'remove-track', type: 'remove_caption_track', track_id: 'captions-en' },
      ],
    })
    render(<CaptionEditor adapter={adapter} />)
    expect(await screen.findByTestId('caption-editor-empty')).toHaveAttribute('role', 'status')
    fireEvent.click(screen.getByRole('button', { name: 'Add caption track' }))
    await waitFor(() => expect(screen.getByLabelText('Caption track')).toBeInTheDocument())
    expect(adapter.getSnapshot().document.timeline.tracks).toHaveLength(1)
  })

  it('adds, edits, styles, toggles, seeks, and removes a bounded cue', async () => {
    const adapter = adapterWithTrack()
    const onSeek = vi.fn()
    render(<CaptionEditor adapter={adapter} currentFrame={12} onSeek={onSeek} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add cue' }))
    expect(await screen.findByTestId(/caption-cue-captions-en-cue-/)).toBeInTheDocument()

    const editButtons = screen.getAllByRole('button', { name: /Edit cue/ })
    fireEvent.click(editButtons.at(-1)!)
    const textareas = screen.getAllByLabelText('Text')
    fireEvent.change(textareas.at(-1)!, { target: { value: 'Edited caption' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save cue' }))
    await waitFor(() => {
      const cues = adapter.getSnapshot().document.timeline.tracks[0]?.items ?? []
      expect(
        cues.some((item) => item.item_type === 'caption_cue' && item.text === 'Edited caption'),
      ).toBe(true)
    })

    fireEvent.change(screen.getByLabelText('Size'), {
      target: { value: '48' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply style' }))
    await waitFor(() =>
      expect(adapter.getSnapshot().document.timeline.tracks[0]?.default_style).toMatchObject({
        font_size: 48,
      }),
    )

    fireEvent.click(screen.getByRole('switch', { name: 'Display captions in preview' }))
    await waitFor(() => expect(adapter.getSnapshot().document.timeline.tracks[0]?.muted).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: /Seek to cue 1/ }))
    expect(onSeek).toHaveBeenCalled()

    const removeButtons = screen.getAllByRole('button', { name: /Remove cue/ })
    fireEvent.click(removeButtons.at(-1)!)
    await waitFor(() =>
      expect(adapter.getSnapshot().document.timeline.tracks[0]?.items).toHaveLength(1),
    )
  })

  it('renders loading and retryable error states', () => {
    const adapter = adapterWithTrack()
    const onRetry = vi.fn()
    const { rerender } = render(<CaptionEditor adapter={adapter} loading />)
    expect(screen.getByTestId('caption-editor-loading')).toHaveAttribute('aria-busy', 'true')
    rerender(<CaptionEditor adapter={adapter} error="Network unavailable" onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Network unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
