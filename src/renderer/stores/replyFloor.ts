/**
 * The floor under every reply the player is sitting and waiting for: a
 * conversation and a scene both take at least this long, however fast the model was.
 */

/** Charged against the call's latency rather than added to it. */
export const REPLY_FLOOR_MS = 3000

/** How much of the floor a wait that began at `startedAt` has left to pay. */
export function owedFloor(startedAt: number): number {
  return Math.max(0, REPLY_FLOOR_MS - (performance.now() - startedAt))
}
