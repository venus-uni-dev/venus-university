/**
 * The grab bag: how an authored pool is dealt so nothing repeats until at least half of it has
 * been seen. What's set aside is stored as a list of keys, so a pool edited between builds only
 * loses the keys it no longer has.
 */

/** One draw's result: the item, and the set-aside list the caller stores back. */
export interface BagDraw<T> {
  item: T
  drawn: string[]
}

/** The keys of `items` still in the bag, in authored order; empty once every one is set aside. */
function remaining<T>(items: readonly T[], keyOf: (item: T) => string, drawn: ReadonlySet<string>): T[] {
  return items.filter((item) => !drawn.has(keyOf(item)))
}

/**
 * Draws one item. `drawn` is the set-aside list as stored; the returned `drawn` replaces it.
 * Keys that name nothing in `items` are dropped on the way through. Throws on an empty pool.
 * `accept` narrows the draw to the items it passes, and a draw with nothing unseen acceptable
 * repeats one without turning the bag.
 */
export function drawFromBag<T>(
  items: readonly T[],
  drawn: readonly string[],
  keyOf: (item: T) => string,
  rand: () => number = Math.random,
  accept?: (item: T) => boolean
): BagDraw<T> {
  if (items.length === 0) throw new Error('drawFromBag: the pool is empty')

  const known = new Set(items.map(keyOf))
  const aside = new Set(drawn.filter((key) => known.has(key)))
  const split = Math.ceil(items.length / 2)
  const firstHalf = items.slice(0, split)
  const secondHalf = items.slice(split)

  const ok = accept ?? ((): boolean => true)
  const pick = (half: readonly T[]): T[] => remaining(half, keyOf, aside).filter(ok)

  let candidates = pick(firstHalf)
  if (candidates.length === 0) candidates = pick(secondHalf)
  // Nothing unseen is acceptable: repeat one rather than resetting a bag with items left in it.
  if (candidates.length === 0 && remaining(items, keyOf, aside).length > 0) candidates = items.filter(ok)
  if (candidates.length === 0) {
    aside.clear()
    candidates = firstHalf.filter(ok)
    if (candidates.length === 0) candidates = secondHalf.filter(ok)
  }
  if (candidates.length === 0) throw new Error('drawFromBag: nothing in the pool passes the filter')

  const item = candidates[Math.floor(rand() * candidates.length)]
  aside.add(keyOf(item))
  return { item, drawn: [...aside] }
}

/**
 * Draws `count` distinct items in a row. A draw already made by this call is skipped even when
 * the bag refills part-way through; `count` is clamped to the pool.
 */
export function drawManyFromBag<T>(
  items: readonly T[],
  drawn: readonly string[],
  keyOf: (item: T) => string,
  count: number,
  rand: () => number = Math.random
): { items: T[]; drawn: string[] } {
  const wanted = Math.min(count, items.length)
  const picked: T[] = []
  const pickedKeys = new Set<string>()
  let aside = drawn
  while (picked.length < wanted) {
    const draw = drawFromBag(items, aside, keyOf, rand)
    aside = draw.drawn
    const key = keyOf(draw.item)
    if (pickedKeys.has(key)) continue
    pickedKeys.add(key)
    picked.push(draw.item)
  }
  return { items: picked, drawn: [...aside] }
}
