/**
 * Deterministic time conversion at the CodePress/FreeCut boundary.
 *
 * FreeCut stores positions as integer frames while the public command
 * contract stores integer microseconds.  Floating-point multiplication is
 * deliberately not used for the decision whether a command is frame aligned;
 * the rational arithmetic below makes that decision stable across browsers,
 * workers, and Node.
 */

export interface FrameRate {
  readonly numerator: bigint
  readonly denominator: bigint
  readonly value: number
}

export type TimingRounding = 'nearest' | 'floor' | 'ceil'

export class FrameTimingError extends Error {
  readonly microseconds: number
  readonly fps: number

  constructor(microseconds: number, fps: number) {
    super(`${microseconds}µs is not aligned to an integer frame at ${fps}fps`)
    this.name = 'FrameTimingError'
    this.microseconds = microseconds
    this.fps = fps
  }
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left
  let b = right < 0n ? -right : right
  while (b !== 0n) {
    const next = a % b
    a = b
    b = next
  }
  return a
}

function decimalToRational(value: number): { numerator: bigint; denominator: bigint } {
  if (!Number.isFinite(value) || value <= 0)
    throw new RangeError('fps must be a finite positive number')
  const text = String(value).toLowerCase()
  const [mantissa, exponentText] = text.split('e')
  const exponent = exponentText ? Number(exponentText) : 0
  const [whole, fraction = ''] = mantissa!.split('.')
  const digits = `${whole}${fraction}`
  let numerator = BigInt(digits)
  let denominator = 10n ** BigInt(fraction.length)
  if (exponent > 0) numerator *= 10n ** BigInt(exponent)
  if (exponent < 0) denominator *= 10n ** BigInt(-exponent)
  const divisor = gcd(numerator, denominator)
  return { numerator: numerator / divisor, denominator: denominator / divisor }
}

export function normalizeFrameRate(fps: number): FrameRate {
  const rational = decimalToRational(fps)
  return { ...rational, value: fps }
}

function assertMicroseconds(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError('microseconds must be a safe non-negative integer')
}

function assertFrames(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError('frames must be a safe non-negative integer')
}

function divideRounded(numerator: bigint, denominator: bigint, rounding: TimingRounding): bigint {
  if (denominator <= 0n) throw new RangeError('denominator must be positive')
  const quotient = numerator / denominator
  const remainder = numerator % denominator
  if (remainder === 0n) return quotient
  if (rounding === 'floor') return quotient
  if (rounding === 'ceil') return quotient + 1n
  return remainder * 2n >= denominator ? quotient + 1n : quotient
}

/** Convert an integer microsecond timestamp to a frame, requiring alignment by default. */
export function microsecondsToFrames(
  microseconds: number,
  fps: number | FrameRate,
  options: { rounding?: TimingRounding; requireAligned?: boolean } = {},
): number {
  assertMicroseconds(microseconds)
  const rate = typeof fps === 'number' ? normalizeFrameRate(fps) : fps
  const numerator = BigInt(microseconds) * rate.numerator
  const denominator = 1_000_000n * rate.denominator
  const frame = divideRounded(numerator, denominator, options.rounding ?? 'nearest')
  if (options.requireAligned !== false) {
    // A frame duration is often fractional in microseconds (for example
    // 29.97fps). The contract remains integer-valued, so alignment means the
    // canonical nearest-integer-microsecond representation of that frame,
    // rather than requiring an impossible exact rational value.
    const canonical = divideRounded(
      frame * 1_000_000n * rate.denominator,
      rate.numerator,
      'nearest',
    )
    if (canonical !== BigInt(microseconds)) throw new FrameTimingError(microseconds, rate.value)
  }
  const result = Number(frame)
  assertFrames(result)
  return result
}

/** Convert an integer frame position to the nearest integer microsecond. */
export function framesToMicroseconds(
  frames: number,
  fps: number | FrameRate,
  rounding: TimingRounding = 'nearest',
): number {
  assertFrames(frames)
  const rate = typeof fps === 'number' ? normalizeFrameRate(fps) : fps
  const numerator = BigInt(frames) * 1_000_000n * rate.denominator
  const microseconds = divideRounded(numerator, rate.numerator, rounding)
  const result = Number(microseconds)
  assertMicroseconds(result)
  return result
}

export function isFrameAligned(microseconds: number, fps: number | FrameRate): boolean {
  try {
    microsecondsToFrames(microseconds, fps)
    return true
  } catch (error) {
    if (error instanceof FrameTimingError) return false
    throw error
  }
}

export function assertFrameAligned(microseconds: number, fps: number | FrameRate): number {
  return microsecondsToFrames(microseconds, fps, { requireAligned: true })
}

export interface FrameInterval {
  start: number
  end: number
}

export function microsecondIntervalToFrames(
  start_us: number,
  end_us: number,
  fps: number | FrameRate,
): FrameInterval {
  const start = assertFrameAligned(start_us, fps)
  const end = assertFrameAligned(end_us, fps)
  if (end <= start) throw new RangeError('end_us must be greater than start_us')
  return { start, end }
}
