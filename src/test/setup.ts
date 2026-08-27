import '@testing-library/jest-dom'
import { afterEach } from 'vite-plus/test'
import '@/i18n'
import { resetAutoKeyframeStore } from '@/features/keyframes/stores/auto-keyframe-store'

function ensureTestLocalStorage(): void {
  try {
    if (typeof globalThis.localStorage !== 'undefined') return
  } catch {
    // Opaque jsdom origins can expose a throwing localStorage accessor.
  }

  const values = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  })
}

ensureTestLocalStorage()

// Mock ImageData for Canvas operations
type TestGlobalWithImageData = typeof globalThis & { ImageData?: typeof ImageData }
const testGlobal = globalThis as TestGlobalWithImageData

if (typeof testGlobal.ImageData === 'undefined') {
  class MockImageData {
    width: number
    height: number
    data: Uint8ClampedArray

    constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
      if (typeof dataOrWidth === 'number') {
        this.width = dataOrWidth
        this.height = widthOrHeight
        this.data = new Uint8ClampedArray(this.width * this.height * 4)
      } else {
        this.data = dataOrWidth
        this.width = widthOrHeight
        this.height = height ?? Math.floor(dataOrWidth.length / (widthOrHeight * 4))
      }
    }
  }

  testGlobal.ImageData = MockImageData as unknown as typeof ImageData
}

// Mock ResizeObserver — jsdom omits it; components that measure natural height
// (e.g. the shortcuts dialog command list) construct one on mount.
type TestGlobalWithResizeObserver = typeof globalThis & { ResizeObserver?: typeof ResizeObserver }
const testGlobalRO = globalThis as TestGlobalWithResizeObserver

if (typeof testGlobalRO.ResizeObserver === 'undefined') {
  class MockResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  testGlobalRO.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver
}

afterEach(() => {
  resetAutoKeyframeStore()
})
