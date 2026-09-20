import type { BankedOpening, LedgerResponse, TimeSlot } from '@shared/types'
import type { Verdict } from './classify'
import type { TurnSnapshot } from './state'

/**
 * The loop's late-bound edges, so its import graph stays one-directional: the **slot cycle**
 * (`gameLoop.ts`, called by `loop/turn`/`loop/exams`) and the **hangout** (`loop/hangouts`,
 * started by `textingLoop`) — two cycles in opposite directions. Imports nothing but types.
 */

interface SlotCycle {
  /** Advances playback by one line or handles queue-drain outcomes. */
  advance: () => void
  /** The whole end of a scene, as one unit. */
  runEnding: (solo: boolean) => Promise<void>
  /** The opening for the slot this ending leads into, or null if abandoned. */
  fetchEndingOpening: (ledger: LedgerResponse) => Promise<BankedOpening | null>
  /** Re-runs a rewound turn down the path it came from — intro, hangout or typed. */
  dispatchTurn: (snapshot: TurnSnapshot) => void
  /** Fires the texting ledger for the slot's messages, at scene start. */
  prefetchTextLedger: () => void
  /** The slot's texting ledger — the matching prefetch, or a fresh call. */
  claimTextLedger: (date: number, time: TimeSlot) => Promise<LedgerResponse | null>
}

interface HangoutEntry {
  /** Starts an armed hangout's scene while the player is still reading. */
  prefetchHangoutScene: (charId: string, description: string) => Promise<void>
  /**
   * Opens the scene an agreed hangout became — the Begin button, and a
   * retry, which carries back the verdict the failed attempt settled.
   */
  startHangoutScene: (charId: string, description: string, preset?: Verdict) => Promise<void>
}

let slotCycle: SlotCycle | null = null
let hangoutEntry: HangoutEntry | null = null

/** Called once by `gameLoop.ts` at module scope. */
export function registerLoopHooks(registered: SlotCycle): void {
  slotCycle = registered
}

/** Called once by `loop/hangouts.ts` at module scope. */
export function registerHangoutEntry(registered: HangoutEntry): void {
  hangoutEntry = registered
}

/**
 * Throws when unregistered: a module reached without its owner loaded is an import-graph
 * mistake, and a silently dropped `advance()` would strand playback.
 */
function need<T>(registered: T | null, what: string): T {
  if (!registered) throw new Error(`[loop] ${what} has not been registered`)
  return registered
}

export function advance(): void {
  need(slotCycle, 'the slot cycle').advance()
}

export function runEnding(solo: boolean): Promise<void> {
  return need(slotCycle, 'the slot cycle').runEnding(solo)
}

export function fetchEndingOpening(ledger: LedgerResponse): Promise<BankedOpening | null> {
  return need(slotCycle, 'the slot cycle').fetchEndingOpening(ledger)
}

export function dispatchTurn(snapshot: TurnSnapshot): void {
  need(slotCycle, 'the slot cycle').dispatchTurn(snapshot)
}

export function prefetchTextLedger(): void {
  need(slotCycle, 'the slot cycle').prefetchTextLedger()
}

export function claimTextLedger(date: number, time: TimeSlot): Promise<LedgerResponse | null> {
  return need(slotCycle, 'the slot cycle').claimTextLedger(date, time)
}

export function prefetchHangoutScene(charId: string, description: string): Promise<void> {
  return need(hangoutEntry, 'the hangout entry').prefetchHangoutScene(charId, description)
}

export function startHangoutScene(
  charId: string,
  description: string,
  preset?: Verdict
): Promise<void> {
  return need(hangoutEntry, 'the hangout entry').startHangoutScene(charId, description, preset)
}
