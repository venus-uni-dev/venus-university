/**
 * The people who paid for or playtested the game, and how their names are weighted into the
 * feed's handle bag. What anybody gave is not in this file.
 */

/** One supporter's weight in the feed's handle bag. */
export interface SupporterHandle {
  name: string
  marbles: number
}

/** The shipped supporter list: who to thank, and how many marbles each name holds. */
export interface Supporters {
  donors: readonly string[]
  playtesters: readonly string[]
  handles: readonly SupporterHandle[]
}

/** One entry of the handle bag: its set-aside key, the name shown, and whether it is a real person's. */
export interface FeedHandle {
  key: string
  handle: string
  supporter: boolean
}

/**
 * Builds the handle bag: every generated name a supporter has not taken, with each supporter's
 * marbles spread at even intervals through them, so about half of anyone's fall in each half.
 */
export function feedHandlePool(
  generated: readonly string[],
  handles: readonly SupporterHandle[]
): FeedHandle[] {
  const taken = new Set(handles.map((one) => one.name.toLowerCase()))
  const kept = generated.filter((handle) => !taken.has(handle.toLowerCase()))

  const placed: { at: number; entry: FeedHandle }[] = kept.map((handle, index) => ({
    at: index + 0.5,
    entry: { key: handle, handle, supporter: false }
  }))

  for (const one of handles) {
    for (let i = 0; i < one.marbles; i++) {
      placed.push({
        at: ((i + 0.5) * kept.length) / one.marbles,
        entry: { key: `${one.name}#${i + 1}`, handle: one.name, supporter: true }
      })
    }
  }

  return placed.sort((a, b) => a.at - b.at).map((one) => one.entry)
}
