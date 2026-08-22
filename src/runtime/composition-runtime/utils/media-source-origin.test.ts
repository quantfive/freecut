import { describe, expect, it } from 'vite-plus/test'
import { isWebAudioSafeMediaSource } from './media-source-origin'

describe('isWebAudioSafeMediaSource', () => {
  it('treats same-origin absolute and relative URLs as graph-safe', () => {
    expect(isWebAudioSafeMediaSource(`${location.origin}/media/clip.mp4`)).toBe(true)
    expect(isWebAudioSafeMediaSource('/media/clip.mp4')).toBe(true)
  })

  it('treats blob: and data: URLs as graph-safe', () => {
    expect(isWebAudioSafeMediaSource('blob:http://localhost:3000/uuid-1')).toBe(true)
    expect(isWebAudioSafeMediaSource('data:audio/mpeg;base64,AAAA')).toBe(true)
  })

  it('treats cross-origin URLs as unsafe for the Web Audio graph', () => {
    expect(isWebAudioSafeMediaSource('https://cdn.example.com/x.mp4')).toBe(false)
    expect(isWebAudioSafeMediaSource('https://signed.example.com/object?signature=1')).toBe(false)
  })

  it('treats empty and unparsable sources as graph-safe (legacy behavior)', () => {
    expect(isWebAudioSafeMediaSource('')).toBe(true)
  })
})
