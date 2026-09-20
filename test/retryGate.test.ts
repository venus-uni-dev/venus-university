import { describe, expect, it, vi } from 'vitest'
import { createRetryGate } from '../src/renderer/stores/retryGate'
import type { AppError } from '@shared/types'

/**
 * The retry-or-leave gate both classifiers park on: a dropped asker is a texting thread stuck
 * on "Waiting for <Name>..." for the rest of the playthrough, and two texting replies can
 * genuinely be out at once.
 */

/** A distinguishable failure, so an assertion can say *whose* is on screen. */
function error(message: string): AppError {
  return { code: 'UNKNOWN', message }
}

/** Lets a resolved promise run its `.then` before the assertions read it. */
function flush(): Promise<void> {
  return Promise.resolve()
}

describe('createRetryGate', () => {
  it('queues a second asker instead of dropping the first, and answers them in turn', async () => {
    // The bug this defends: one resolver slot means the second `ask` overwrites
    // the first, whose promise never settles — its thread stays locked forever.
    const setError = vi.fn()
    const gate = createRetryGate(setError)

    const settled: string[] = []
    const first = gate.ask(error('one')).then((retry) => settled.push(`one:${retry}`))
    const second = gate.ask(error('two')).then((retry) => settled.push(`two:${retry}`))

    // Only the head is on screen; the second failure waits its turn.
    expect(setError).toHaveBeenCalledTimes(1)
    expect(setError).toHaveBeenLastCalledWith(error('one'))

    gate.answer(true)
    await first
    expect(settled).toEqual(['one:true'])
    // The second asker's error takes the modal rather than it closing.
    expect(setError).toHaveBeenLastCalledWith(error('two'))

    gate.answer(false)
    await second
    expect(settled).toEqual(['one:true', 'two:false'])
    expect(setError).toHaveBeenLastCalledWith(null)
  })

  it('drops every parked asker on a reset without answering any of them', async () => {
    // Teardown abandons its callers rather than telling them to stop, so
    // neither promise settles — and a later answer must not resurrect one.
    const gate = createRetryGate(vi.fn())

    let settled = 0
    void gate.ask(error('one')).then(() => (settled += 1))
    void gate.ask(error('two')).then(() => (settled += 1))

    gate.reset()
    gate.answer(true)
    await flush()
    expect(settled).toBe(0)
  })
})
