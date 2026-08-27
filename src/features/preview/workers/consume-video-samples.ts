interface ClosableSample {
  close?: () => void
}

/**
 * Consume a timestamp-aligned VideoSample iterator with one explicit ownership
 * boundary. A sample that arrives just as cancellation wins is still closed
 * before the iterator is torn down.
 */
export async function consumeVideoSamples<T extends ClosableSample>(
  iterator: AsyncGenerator<T | null, void, unknown>,
  timestamps: readonly number[],
  shouldContinue: () => boolean,
  consume: (sample: T, timestamp: number) => void,
): Promise<void> {
  let index = 0
  try {
    for await (const sample of iterator) {
      try {
        if (!shouldContinue()) break
        const timestamp = timestamps[index]
        index += 1
        if (!sample || timestamp === undefined) continue
        consume(sample, timestamp)
      } finally {
        sample?.close?.()
      }
    }
  } finally {
    await iterator.return?.()
  }
}
