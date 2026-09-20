import { appError, toAppError } from './errors'
import type { AppError, JobProgress } from './types'
import { withRetry } from './retry'
import { randomId } from './uuid'

/** Serial job queue with retry, backoff and cancel-by-group. */

/** What a job's `run` function is handed. */
interface JobContext {
  /** Aborts when the job's group is cancelled. */
  signal: AbortSignal
  /** Reports a human-readable step. */
  report: (step: string) => void
}

export interface JobSpec<T> {
  /** Cancellation group — `cancelGroup(group)` drops every job sharing it. */
  group: string
  /** Sub-identifier within the group, surfaced in progress events. */
  key?: string
  run: (context: JobContext) => Promise<T>
}

interface QueuedJob<T = unknown> {
  jobId: string
  group: string
  key?: string
  run: (context: JobContext) => Promise<T>
  controller: AbortController
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

const queue: QueuedJob[] = []
let running: QueuedJob | null = null
/** Resolves when the currently running job settles; null when nothing runs. */
let runningSettled: Promise<void> | null = null
let pumping = false

/** Non-queued work by group, so `cancelGroup` can abort the pre-sprite LLM write too. */
const abortables = new Map<string, Set<AbortController>>()

/** Enrols a non-queued operation in `group`; callers must `release()` in `finally`. */
function registerAbortable(group: string): { signal: AbortSignal; release: () => void } {
  const controller = new AbortController()
  const set = abortables.get(group) ?? new Set<AbortController>()
  set.add(controller)
  abortables.set(group, set)

  return {
    signal: controller.signal,
    release: () => {
      const current = abortables.get(group)
      if (!current) return
      current.delete(controller)
      if (current.size === 0) abortables.delete(group)
    }
  }
}

/** Where progress events go; wired to the renderer once, in `ipc.ts`. */
let sink: ((progress: JobProgress) => void) | null = null

/** Registers the progress sink. Called once at startup. */
export function setProgressSink(fn: (progress: JobProgress) => void): void {
  sink = fn
}

/** The one cancellation error, raised from all four abort paths below. */
function cancelledError(): AppError {
  return appError('CANCELLED', 'The job was cancelled.')
}

/** Emits one progress event, if a sink is registered. */
function emit(job: QueuedJob, progress: Omit<JobProgress, 'jobId' | 'group' | 'key'>): void {
  try {
    sink?.({ jobId: job.jobId, group: job.group, key: job.key, ...progress })
  } catch (err) {
    console.error('[jobs] progress sink threw:', err)
  }
}

/** Queues a job and resolves with its result once it has run serially. */
export function enqueue<T>(spec: JobSpec<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const job: QueuedJob<T> = {
      jobId: randomId(),
      group: spec.group,
      key: spec.key,
      run: spec.run,
      controller: new AbortController(),
      resolve,
      reject
    }

    queue.push(job as QueuedJob)
    emit(job as QueuedJob, { status: 'queued', step: 'Queued' })
    void pump()
  })
}

/** Runs queued jobs one at a time until the queue drains. */
async function pump(): Promise<void> {
  if (pumping) return
  pumping = true

  try {
    for (;;) {
      const job = queue.shift()
      if (!job) return

      running = job
      // Lets `cancelGroup` await the abort actually taking effect.
      let markSettled = (): void => {}
      runningSettled = new Promise<void>((resolve) => {
        markSettled = resolve
      })
      emit(job, { status: 'running', step: 'Starting' })

      try {
        // A job cancelled between queueing and starting must not run at all.
        if (job.controller.signal.aborted) throw cancelledError()

        const result = await withRetry(
          () =>
            job.run({
              signal: job.controller.signal,
              report: (step) => emit(job, { status: 'running', step })
            }),
          {
            signal: job.controller.signal,
            onRetry: (attempt, waitMs) =>
              emit(job, {
                status: 'running',
                step: `Attempt ${attempt} failed — retrying in ${Math.round(waitMs / 1000)}s`
              })
          }
        )

        emit(job, { status: 'done', step: 'Done' })
        job.resolve(result)
      } catch (err) {
        const aborted = job.controller.signal.aborted
        const error = aborted ? cancelledError() : toAppError(err, 'JOB_FAILED')
        emit(job, { status: 'error', step: aborted ? 'Cancelled' : 'Failed', error })
        job.reject(error)
      } finally {
        running = null
        runningSettled = null
        markSettled()
      }
    }
  } finally {
    pumping = false
  }
}

/**
 * Drops every queued job `matches` accepts and aborts the running one if it matches, resolving
 * only once that job has settled.
 */
async function cancelMatching(matches: (job: QueuedJob) => boolean): Promise<void> {
  for (let i = queue.length - 1; i >= 0; i--) {
    const job = queue[i]
    if (!matches(job)) continue
    queue.splice(i, 1)
    job.controller.abort()
    emit(job, { status: 'error', step: 'Cancelled', error: cancelledError() })
    job.reject(cancelledError())
  }

  if (!running || !matches(running)) return

  const settled = runningSettled
  running.controller.abort()
  await settled
}

/**
 * Cancels queued, running and registered non-queued work in `group`, resolving
 * only after the running job settles.
 */
export async function cancelGroup(group: string): Promise<void> {
  const inGroup = (job: QueuedJob): boolean => job.group === group

  // Queued jobs go first so nothing new starts while the running one settles.
  const settling = cancelMatching(inGroup)

  for (const controller of abortables.get(group) ?? []) {
    controller.abort()
  }

  await settling
}

/** Cancels one *set* of a character's images rather than the whole character. */
export async function cancelKeys(group: string, keys: string[]): Promise<void> {
  const wanted = new Set(keys)
  await cancelMatching((job) => job.group === group && job.key !== undefined && wanted.has(job.key))
}

/** Runs one unqueued operation under `group`'s abort signal, releasing it however it ends. */
export async function runAbortable<T>(
  group: string,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const { signal, release } = registerAbortable(group)
  try {
    return await run(signal)
  } finally {
    release()
  }
}
