import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { useEditorStore } from '@/shared/state/editor'
import { VideoConfigProvider } from '@/runtime/composition-runtime/deps/player'
import { ItemVisualWrapper } from './item-visual-wrapper'

afterEach(() => {
  cleanup()
  useEditorStore.setState({ hostMode: false })
})

describe('host explicit media geometry', () => {
  it.each([
    { hostMode: true, sourceWidth: 1920, sourceHeight: 1080, height: '100%' },
    { hostMode: false, sourceWidth: 1920, sourceHeight: 1080, height: '56.25%' },
    { hostMode: true, sourceWidth: 400, sourceHeight: 400, height: '100%' },
  ])(
    'renders requested bounds for $hostMode / $sourceWidth x $sourceHeight',
    ({ hostMode, sourceWidth, sourceHeight, height }) => {
      useEditorStore.setState({ hostMode })
      const view = render(
        <VideoConfigProvider
          id="geometry"
          width={1920}
          height={1080}
          fps={30}
          durationInFrames={90}
        >
          <ItemVisualWrapper
            item={{
              id: 'image',
              type: 'image',
              trackId: 'track',
              from: 0,
              durationInFrames: 90,
              label: 'Image',
              src: 'blob:test',
              transform: { width: 400, height: 400 },
            }}
            mediaContent={{ fitMode: 'contain', sourceWidth, sourceHeight }}
          >
            <img data-testid="media" alt="" />
          </ItemVisualWrapper>
        </VideoConfigProvider>,
      )
      expect(view.getByTestId('media').parentElement?.style.height).toBe(height)
      expect(view.getByTestId('media').parentElement?.style.width).toBe('100%')
    },
  )
})
