/** Fisher–Yates, on a copy — the caller's array is never reordered. */
export function shuffle<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const shuffled = [...items]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

/** One item drawn uniformly. */
export function pick<T>(items: readonly T[], rand: () => number = Math.random): T {
  return items[Math.floor(rand() * items.length)]
}
