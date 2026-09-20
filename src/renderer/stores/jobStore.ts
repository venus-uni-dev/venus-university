import { create } from 'zustand'
import type { JobProgress } from '@shared/types'

/** Store key for a job. */
function jobKeyOf(job: Pick<JobProgress, 'jobId' | 'group' | 'key'>): string {
  return `${job.group}:${job.key ?? job.jobId}`
}

interface JobStoreState {
  /** Live job state keyed by `group:key` (see {@link jobKeyOf}). */
  jobs: Record<string, JobProgress>
  upsertJob: (job: JobProgress) => void
  /** Drops every job belonging to a cancellation group (mirrors `jobQueue.cancelGroup`). */
  clearGroup: (group: string) => void
}

export const useJobStore = create<JobStoreState>((set) => ({
  jobs: {},

  upsertJob: (job) => set((state) => ({ jobs: { ...state.jobs, [jobKeyOf(job)]: job } })),

  clearGroup: (group) =>
    set((state) => ({
      jobs: Object.fromEntries(Object.entries(state.jobs).filter(([, job]) => job.group !== group))
    }))
}))

/** Subscribes to `jobs:progress` at module scope so outliving jobs are not missed. */
window.api.jobs.onProgress((progress) => {
  useJobStore.getState().upsertJob(progress)
})
