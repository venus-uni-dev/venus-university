import { create } from 'zustand'
import type { TimeSlot } from '@shared/types'
import type { Weather } from '@shared/weather'
import type { ScreenTheme } from '../views/clockTheme'

/**
 * The crossing: the transition between two screens, which can double as a loading screen, and
 * the cover performance it gives (the quiet hold, theme handoff, day-change splash). This file
 * owns the phases and clocks; `components/Crossing.tsx` draws them.
 */

/** The leader's run, and how far behind it the chaser starts. Both in seconds. */
export const CROSS_SECONDS = 0.3
export const CROSS_CHASE = 0.12

export type CrossingPhase = 'idle' | 'closing' | 'holding' | 'opening'

/** Which slot the curtain announces, and what else is happening on it. */
export interface SlotStamp {
  date: number
  time: TimeSlot
  /** The occasion's title, where the slot falls on one. */
  occasion: string | null
  /** The slot's sky, which picks the mark the splash wears. */
  weather: Weather
  /**
   * What the curtain prints in place of the weekday and the readings, for a slot that is not a
   * date: the epilogue's.
   */
  words?: { word: string; meta: string }
}

/**
 * What the crossing is carrying, beside its timing. Set once at `begin` and dropped at idle;
 * the layer draws it and nothing else reads it.
 */
interface CrossingPayload {
  /** The theme the stage is in as the cover goes up; null leaves the layer on the clock. */
  from: ScreenTheme | null
  /** The theme the screen under the cover will be in; null means it does not change. */
  to: ScreenTheme | null
  /** Whether the curtain crosses from one polarity to the other while it is opaque. */
  fade: boolean
  splash: SlotStamp | null
  /**
   * What the wait is for, in the reader's own words, or null when the curtain only says there is
   * one. **A caption on the mark, never a state of its own** — written and dropped together
   * with the wait it captions.
   */
  reason: string | null
}

const noPayload: CrossingPayload = {
  from: null,
  to: null,
  fade: false,
  splash: null,
  reason: null
}

/** What the layer draws. The rest of a crossing's state is module-scope below. */
interface CrossingState extends CrossingPayload {
  phase: CrossingPhase
  /** Whether this crossing is covering a wait — the whole of when the bunny is drawn. */
  waited: boolean
  /** Whether the screen under the cover has said it is ready: the wait is over. */
  ready: boolean
}

export const useCrossingStore = create<CrossingState>(() => ({
  phase: 'idle',
  waited: false,
  ready: false,
  ...noPayload
}))

/** What the machine below is told; each is one thing that has happened. */
type CrossingEvent =
  | 'begin'
  | 'cover'
  | 'ready'
  | 'wait'
  | 'curtainCovered'
  | 'holdDone'
  | 'revealed'
  | 'cancel'

/** The part of a crossing the decision is made from. */
export interface CrossingCore {
  phase: CrossingPhase
  /**
   * Whether this crossing is covering a load, and so draws the mark that says so. Declared by
   * the caller and never inferred from timing: a crossing's cover outlasts the wipe either way.
   */
  waited: boolean
  /** Whether the next screen has said it is ready. */
  ready: boolean
  /**
   * Whether the curtain still owes its performance (the hold, plus whatever it was raised to
   * say). The reveal waits on this and on `ready` independently: `ready` says the crossing *may*
   * open, this says the curtain has finished.
   */
  hold: boolean
}

export const idleCrossing: CrossingCore = {
  phase: 'idle',
  waited: false,
  ready: false,
  hold: false
}

/**
 * The crossing's timing as a pure state machine: which events advance which phase and release
 * `begin` or `end`. Both run only at full cover; the reveal waits on the screen and curtain alike.
 */
export function step(
  core: CrossingCore,
  event: CrossingEvent
): { core: CrossingCore; run: ('begin' | 'end')[] } {
  const still = { core, run: [] as ('begin' | 'end')[] }

  switch (event) {
    case 'begin':
      if (core.phase !== 'idle') return still
      return {
        core: {
          phase: 'closing',
          waited: core.waited,
          ready: false,
          // Every crossing performs: the quiet hold is owed even where there is nothing to say.
          hold: true
        },
        run: []
      }

    // The cover nothing wiped to — the app's own start, painted behind the curtain from its
    // first frame; it begins where `curtainCovered` would have put it, so the swap owed to full
    // cover is released at once and the hold every crossing owes runs from the first frame.
    case 'cover':
      if (core.phase !== 'idle') return still
      return {
        core: { phase: 'holding', waited: core.waited, ready: false, hold: true },
        run: ['begin']
      }

    case 'ready':
      // At full cover the swap runs either way; only the reveal waits on the performance.
      if (core.phase === 'holding') {
        return core.hold
          ? { core: { ...core, ready: true }, run: ['end'] }
          : { core: { ...core, phase: 'opening', ready: true }, run: ['end'] }
      }
      if (core.phase === 'idle') return still
      return { core: { ...core, ready: true }, run: [] }

    case 'wait':
      // A load the caller only found out it owed once the cover was up — the slot opening that
      // discovers no opening was banked for it. A crossing already revealed keeps its answer:
      // there is nothing left to draw a mark on.
      if (core.phase === 'idle' || core.phase === 'opening') return still
      return { core: { ...core, waited: true }, run: [] }

    case 'curtainCovered':
      if (core.phase !== 'closing') return still
      return core.ready
        ? { core: { ...core, phase: 'holding' }, run: ['begin', 'end'] }
        : { core: { ...core, phase: 'holding' }, run: ['begin'] }

    case 'holdDone': {
      if (core.phase === 'idle' || core.phase === 'opening') return still
      // Cleared wherever it lands, so a performance that finishes before the cover does cannot
      // hold the reveal afterwards. In `holding` the end swap has already gone with `ready`.
      const cleared = { ...core, hold: false }
      return core.phase === 'holding' && core.ready
        ? { core: { ...cleared, phase: 'opening' }, run: [] }
        : { core: cleared, run: [] }
    }

    case 'revealed':
      if (core.phase !== 'opening') return still
      return { core: idleCrossing, run: [] }

    case 'cancel':
      // From anywhere, releasing nothing: what is being torn down is the screen the swaps
      // were written for.
      return { core: idleCrossing, run: [] }
  }
}

/**
 * The live core, its payload, and the closures the phases above release: everything owed to
 * full cover, in the order it was handed over, and the one owed to the reveal.
 */
let core: CrossingCore = idleCrossing
let payload: CrossingPayload = noPayload
let written: CrossingPayload = noPayload
let coverSwaps: (() => void)[] = []
let endSwap: (() => void) | null = null

/** Runs what `step` released, in the order it named, each exactly once. */
function advance(event: CrossingEvent): void {
  const next = step(core, event)
  core = next.core
  for (const which of next.run) {
    if (which === 'begin') {
      const owed = coverSwaps
      coverSwaps = []
      for (const swap of owed) swap()
    } else {
      const swap = endSwap
      endSwap = null
      swap?.()
    }
  }
  if (core.phase === 'idle') {
    coverSwaps = []
    endSwap = null
    payload = noPayload
  }
  const state = useCrossingStore.getState()
  if (
    state.phase !== core.phase ||
    state.waited !== core.waited ||
    state.ready !== core.ready ||
    written !== payload
  ) {
    written = payload
    useCrossingStore.setState({
      phase: core.phase,
      waited: core.waited,
      ready: core.ready,
      ...payload
    })
  }
}

/** What a caller hands a crossing beside its swap. */
export interface CrossingOptions {
  /** The theme the stage is in now — the screen's own, so the two cannot disagree. */
  from?: ScreenTheme
  /** The theme the screen under the cover will be in. */
  to?: ScreenTheme
  /** The slot the curtain announces while it is down. */
  splash?: SlotStamp
  /**
   * Whether the cover is going up over a call the caller is still waiting on, which is the whole
   * of when the loading mark is drawn. Left out, it is not — a crossing covers a screen
   * change whether or not anything is being fetched, and most of them fetch nothing.
   */
  wait?: boolean
  /**
   * What that wait is for, drawn beside the mark. Only meaningful with `wait`, and a caller
   * that knows only under the cover names it later with {@link nameCrossingWait}.
   */
  reason?: string
  /**
   * Whether the cover is already down when the crossing starts, so there is no wipe to it —
   * the app's own boot, painted behind the curtain rather than covered by one.
   */
  covered?: boolean
}

/**
 * Covers the screen and runs `swap` under full cover; returns false and drops the swap if
 * another crossing is already running. `opts` says what the curtain does while down.
 */
export function beginCrossing(swap?: () => void, opts?: CrossingOptions): boolean {
  if (core.phase !== 'idle') return false
  const from = opts?.from ?? null
  const to = opts?.to ?? null
  const splash = opts?.splash ?? null
  // A polarity is only crossed where both ends are known and they differ; the layer draws the
  // clock's own theme wherever a caller names neither.
  const fade = from !== null && to !== null && from !== to
  payload = { from, to, fade, splash, reason: opts?.reason ?? null }
  coverSwaps = swap ? [swap] : []
  // Set on the core before `begin` carries it over, which is what keeps `step` a function of the
  // core alone — and what lets a test seed a crossing without going through a payload.
  if (opts?.wait) core = { ...core, waited: true }
  advance(opts?.covered ? 'cover' : 'begin')
  return true
}

/**
 * Runs `swap` under full cover without signaling readiness — for a caller whose wait isn't over
 * when its screen changes (e.g. `enterGame`). Queued while closing, run in order after the
 * begin-swap; already covered or outside a crossing, it runs at once, like `endCrossing`.
 */
export function coverSwap(swap: () => void): void {
  if (core.phase === 'closing') {
    coverSwaps.push(swap)
    return
  }
  swap()
}

/**
 * Says the next screen is ready, and reveals it. `swap` runs under cover too, after everything
 * the cover already owed — what a caller could only know once the wait was over. **Outside a
 * crossing it runs at once**: every path that abandons a start calls this, and none may strand.
 */
export function endCrossing(swap?: () => void): void {
  if (core.phase === 'idle' || core.phase === 'opening') {
    swap?.()
    return
  }
  endSwap = swap ?? null
  advance('ready')
}

/**
 * Says this crossing is covering a load after all: the mark goes up and stays up until the
 * screen is ready. For the wait a caller only discovers under the cover — the slot opening that
 * finds nothing was banked for it (`beginSlot`).
 */
export function markCrossingWait(): void {
  advance('wait')
}

/**
 * The same, with the reason written beside the mark, after `begin` — the two screens that call
 * this only know what they are waiting for once a question in front of the curtain is answered.
 */
export function nameCrossingWait(reason: string): void {
  if (core.phase === 'idle' || core.phase === 'opening') return
  payload = { ...payload, reason }
  advance('wait')
}

/**
 * Drops the crossing where it stands, running neither swap — for a teardown that takes the
 * screen those swaps were written for with it.
 */
export function cancelCrossing(): void {
  advance('cancel')
}

/** The layer's three reports. */
export function curtainCovered(): void {
  advance('curtainCovered')
}

/** The curtain has finished saying what it was raised to say. */
export function holdDone(): void {
  advance('holdDone')
}

export function revealed(): void {
  advance('revealed')
}
