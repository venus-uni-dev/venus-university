import { beforeEach, describe, expect, it } from 'vitest'
import {
  beginCrossing,
  cancelCrossing,
  curtainCovered,
  endCrossing,
  holdDone,
  idleCrossing,
  nameCrossingWait,
  revealed,
  step,
  useCrossingStore,
  type CrossingCore
} from '../src/renderer/stores/crossingStore'

/**
 * When a crossing releases its two swaps, may open, and reports a load: a swap freed before
 * full cover changes the screen visibly, a reveal skipping what it owes cuts the splash short,
 * and a loading mark with nothing behind it reports a wait that is not happening.
 */

/** Runs a crossing's events in order from `begin`, collecting every swap released. */
function play(
  events: Parameters<typeof step>[1][],
  from: CrossingCore = idleCrossing
): { core: CrossingCore; run: string[] } {
  let core = from
  const run: string[] = []
  for (const event of events) {
    const next = step(core, event)
    core = next.core
    run.push(...next.run)
  }
  return { core, run }
}

describe('a crossing', () => {
  it('holds every swap until the opaque sheet has covered the stage', () => {
    const started = play(['begin', 'ready'])

    // However early the reply, nothing is released while the stage can still be seen: there is
    // one moment a screen may change, and it is the one nobody is looking at.
    expect(started.run).toEqual([])
    expect(started.core.phase).toBe('closing')

    const covered = step(started.core, 'curtainCovered')
    // Both under one cover, and the caller's own order kept.
    expect(covered.run).toEqual(['begin', 'end'])
    // Ready or not, the curtain stays down for the performance it owes.
    expect(covered.core.phase).toBe('holding')
  })

  it('holds the curtain down until the screen it is waiting for arrives', () => {
    const started = play(['begin', 'curtainCovered'])

    // The view is swapped under the cover; nothing reveals it yet.
    expect(started.run).toEqual(['begin'])
    expect(started.core.phase).toBe('holding')

    const ready = step(started.core, 'ready')
    expect(ready.run).toEqual(['end'])
    // Still the performance to finish, whichever way round the two answers land.
    expect(ready.core.phase).toBe('holding')
    const done = step(ready.core, 'holdDone')
    expect(done.run).toEqual([])
    expect(done.core.phase).toBe('opening')
    expect(step(done.core, 'revealed').core.phase).toBe('idle')
  })

  it('starts under a cover that was already down, and opens from there', () => {
    // The app's own boot: nothing wiped to the cover, so the swap it owes is released on the
    // first frame and the curtain still performs the beat every crossing carries.
    const started = play(['cover'])
    expect(started.run).toEqual(['begin'])
    expect(started.core.phase).toBe('holding')
    expect(started.core.hold).toBe(true)

    const ready = step(started.core, 'ready')
    expect(ready.run).toEqual(['end'])
    expect(step(ready.core, 'holdDone').core.phase).toBe('opening')
  })

  it('waits for the screen when the curtain finishes speaking first', () => {
    const said = play(['begin', 'curtainCovered', 'holdDone'])
    expect(said.core.phase).toBe('holding')
    expect(said.run).toEqual(['begin'])

    const ready = step(said.core, 'ready')
    expect(ready.run).toEqual(['end'])
    expect(ready.core.phase).toBe('opening')
  })

  it('draws no load on a cover that was never told about one', () => {
    // The boundary's own crossing: everything it needs was paid for before the cover went up,
    // and however long the splash keeps the curtain down, none of it is a wait.
    const { core } = play(['begin', 'curtainCovered', 'ready'])

    expect(core.waited).toBe(false)
  })

  it('draws the load a screen only owned up to under the cover', () => {
    // A slot that finds nothing was banked for it, long after the curtain landed (`beginSlot`).
    const covered = play(['begin', 'curtainCovered', 'wait'])
    expect(covered.core.waited).toBe(true)

    // And it stands until the screen is ready, which is what the mark is reporting.
    expect(step(covered.core, 'ready').core.waited).toBe(true)
  })

  it('drops a cancelled crossing where it stands, running neither swap', () => {
    const covered = play(['begin', 'curtainCovered'])

    const gone = step(covered.core, 'cancel')
    expect(gone.core).toEqual(idleCrossing)
    expect(gone.run).toEqual([])
  })

  it('refuses a second cover while one is running, and its swap with it', () => {
    // What Quickstart once tripped over: a `begin` fired mid-crossing is refused along with
    // the view change it was carrying, so a running crossing is ended and never replaced. A
    // screen that has something to hand over under a cover already down hands it to `ready`.
    const covered = play(['begin', 'curtainCovered'])

    const refused = step(covered.core, 'begin')
    expect(refused.core).toEqual(covered.core)
    expect(refused.run).toEqual([])
  })
})

/**
 * The same rules through the closures the views actually call (Quickstart): that the answer to
 * a question asked under a held curtain is what ends the crossing it was asked on, in whichever
 * phase the answer lands — the window a fast reader once fell through.
 */
describe('a question asked under the cover', () => {
  beforeEach(() => cancelCrossing())

  it('opens onto the screen the answer hands over, once the curtain has rested', () => {
    const seen: string[] = []
    beginCrossing(() => seen.push('quickstart'))

    curtainCovered()
    // The view is swapped under the cover, and the question is raised over it.
    expect(seen).toEqual(['quickstart'])
    expect(useCrossingStore.getState().phase).toBe('holding')

    // The curtain finishes its beat with the question still up: nothing opens on its own.
    holdDone()
    expect(useCrossingStore.getState().phase).toBe('holding')

    endCrossing(() => seen.push('classSelect'))
    expect(seen).toEqual(['quickstart', 'classSelect'])
    expect(useCrossingStore.getState().phase).toBe('opening')
    revealed()
    expect(useCrossingStore.getState().phase).toBe('idle')
  })

  it('takes an answer given before the curtain has finished resting', () => {
    // The reader who presses Enter the moment the question appears: the swap goes under the
    // cover at once and the reveal still waits out the beat the curtain owes.
    const seen: string[] = []
    beginCrossing(() => seen.push('quickstart'))
    curtainCovered()

    endCrossing(() => seen.push('classSelect'))
    expect(seen).toEqual(['quickstart', 'classSelect'])
    expect(useCrossingStore.getState().phase).toBe('holding')

    holdDone()
    expect(useCrossingStore.getState().phase).toBe('opening')
  })

  it('says what the wait is for only once there is a reader waiting on it', () => {
    // New Game asks the reader his name over the curtain and only *then* names what it is
    // holding for: a caption on a screen the reader is still answering a question on is
    // reporting a wait he is not in yet.
    beginCrossing()
    curtainCovered()
    expect(useCrossingStore.getState().waited).toBe(false)
    expect(useCrossingStore.getState().reason).toBe(null)

    nameCrossingWait('Generating class schedule')
    // A reason declares the wait it is a caption on: the mark and the words arrive together.
    expect(useCrossingStore.getState().waited).toBe(true)
    expect(useCrossingStore.getState().reason).toBe('Generating class schedule')

    endCrossing()
    holdDone()
    revealed()
    // Dropped with the rest of the payload, so the next cover starts saying nothing.
    expect(useCrossingStore.getState().reason).toBe(null)
    expect(useCrossingStore.getState().waited).toBe(false)
  })

  it('lets a failure under the cover swap the menu back in', () => {
    // A quickstart that cannot read its own cast leaves the same way, so nothing strands a
    // curtain that nothing times out.
    const seen: string[] = []
    beginCrossing(() => seen.push('quickstart'))
    curtainCovered()

    endCrossing(() => seen.push('mainMenu'))
    expect(seen).toEqual(['quickstart', 'mainMenu'])

    holdDone()
    expect(useCrossingStore.getState().phase).toBe('opening')
    revealed()
    expect(useCrossingStore.getState().phase).toBe('idle')
  })
})
