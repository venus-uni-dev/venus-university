import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTypingPacer, typingDelayFor } from '../src/renderer/stores/textingPace'
import { REPLY_FLOOR_MS } from '../src/renderer/stores/replyFloor'
import { useBunnyboardStore } from '../src/renderer/stores/bunnyboardStore'

/**
 * The release queue her replies drain through. The pacer owns the composer
 * lock and the `...` bubble together: a queue that never settles leaves the
 * thread unusable, and a typing flag left up leaves her forever about to answer.
 */

beforeEach(() => {
  vi.useFakeTimers()
  useBunnyboardStore.setState({ typingCharIds: [] })
})

afterEach(() => {
  vi.useRealTimers()
})

/** Whether the thread is showing its `...` bubble right now. */
function typing(): boolean {
  return useBunnyboardStore.getState().typingCharIds.includes('a')
}

describe('createTypingPacer', () => {
  it('pays the reply floor before the bubble goes up, then releases in order', async () => {
    const released: string[] = []
    const pacer = createTypingPacer('a', (text) => released.push(text))
    pacer.push('hey')
    pacer.push('you around?')

    // Nothing is showing yet: she is reading what he sent, not answering it.
    await vi.advanceTimersByTimeAsync(REPLY_FLOOR_MS - 1)
    expect(typing()).toBe(false)
    expect(released).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    expect(typing()).toBe(true)

    await vi.advanceTimersByTimeAsync(typingDelayFor('hey'))
    expect(released).toEqual(['hey'])
    // Still typing: the second text is the reason the bubble stays up.
    expect(typing()).toBe(true)

    await vi.advanceTimersByTimeAsync(typingDelayFor('you around?'))
    expect(released).toEqual(['hey', 'you around?'])
    expect(typing()).toBe(false)
  })

  it('resolves drain once everything queued has landed', async () => {
    const released: string[] = []
    const pacer = createTypingPacer('a', (text) => released.push(text))
    pacer.push('hey')

    let drained = false
    void pacer.drain().then(() => {
      drained = true
    })

    await vi.advanceTimersByTimeAsync(REPLY_FLOOR_MS)
    expect(drained).toBe(false)

    await vi.advanceTimersByTimeAsync(typingDelayFor('hey'))
    expect(drained).toBe(true)
    expect(released).toEqual(['hey'])
  })

  // A reply with no texts never starts the runner, so the empty-queue clause is
  // the only thing standing between `await pacer.drain()` and a locked composer.
  it('resolves drain immediately when there was never anything to wait for', async () => {
    const pacer = createTypingPacer('a', () => {})
    await expect(pacer.drain()).resolves.toBeUndefined()
  })

  it('drops what is unreleased on a cancel and keeps what has landed', async () => {
    const released: string[] = []
    const pacer = createTypingPacer('a', (text) => released.push(text))
    pacer.push('hey')
    pacer.push('you around?')

    await vi.advanceTimersByTimeAsync(REPLY_FLOOR_MS + typingDelayFor('hey'))
    expect(released).toEqual(['hey'])

    pacer.cancel()
    // The bubble comes down with the queue, so the two cannot disagree.
    expect(typing()).toBe(false)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(released).toEqual(['hey'])
    expect(typing()).toBe(false)
  })

  it('settles a drain that was waiting on the queue it cancelled', async () => {
    // The whole point of the cancel path: a caller parked on `drain` when the
    // player leaves the thread must not be parked there forever.
    const pacer = createTypingPacer('a', () => {})
    pacer.push('hey')
    const drain = pacer.drain()

    await vi.advanceTimersByTimeAsync(REPLY_FLOOR_MS)
    pacer.cancel()
    await vi.advanceTimersByTimeAsync(typingDelayFor('hey'))
    await expect(drain).resolves.toBeUndefined()
  })

  it('accepts a text that arrives after the queue has already drained', async () => {
    // The stream emits as the model writes, so a second text can land after the
    // first has been released and the runner has stopped.
    const released: string[] = []
    const pacer = createTypingPacer('a', (text) => released.push(text))
    pacer.push('hey')
    await vi.advanceTimersByTimeAsync(REPLY_FLOOR_MS + typingDelayFor('hey'))
    expect(typing()).toBe(false)

    pacer.push('you around?')
    await vi.advanceTimersByTimeAsync(typingDelayFor('you around?'))
    expect(released).toEqual(['hey', 'you around?'])
    expect(typing()).toBe(false)
  })
})
