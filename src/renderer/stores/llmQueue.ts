/**
 * A serial lane for cloud-LLM calls that a player can fire in bulk. Only character writing
 * uses it; scene, classifier, ledger and class-generation calls stay off it.
 */

/** The tail of the chain; every enqueued call links onto it. */
let tail: Promise<unknown> = Promise.resolve()

/** Runs `job` once every call enqueued before it has settled. */
export function enqueueLlm<T>(job: () => Promise<T>): Promise<T> {
  // `catch` before chaining, so one rejected call does not poison the lane.
  const result = tail.then(job, job)
  tail = result.catch(() => undefined)
  return result
}
