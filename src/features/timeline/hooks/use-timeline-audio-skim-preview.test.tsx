// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { useEditorStore } from '@/shared/state/editor'
import { usePlaybackStore } from '@/shared/state/playback'
import { useTimelineAudioSkimPreview } from './use-timeline-audio-skim-preview'

describe('useTimelineAudioSkimPreview', () => {
  afterEach(() => {
    useEditorStore.setState({ hostMode: false })
    vi.restoreAllMocks()
  })

  it('does not subscribe to playback audio skim in host mode', () => {
    useEditorStore.setState({ hostMode: true })
    const subscribe = vi.spyOn(usePlaybackStore, 'subscribe')

    const { unmount } = renderHook(() => useTimelineAudioSkimPreview())

    expect(subscribe).not.toHaveBeenCalled()
    unmount()
  })
})
