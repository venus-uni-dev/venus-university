import { create } from 'zustand'
import {
  charKeyOf,
  fullNameOf,
  type Character,
  type CreatedEnrollment,
  type CreatedPlaythrough,
  type Enrollment,
  type EnrollmentDraft,
  type GameSave,
  type PlaythroughDraft,
  type PlaythroughRecord,
  type PlaythroughSummary,
  type Result,
  type SaveDraft
} from '@shared/types'
import { useUiStore } from './uiStore'

/** One save as the Load Game Modal lists it: the file, its roster and its load gate. */
export interface ResolvedSave {
  saveId: string
  /** Epoch ms — the save's own date, or the file's when it could not be read. */
  savedAt: number
  /** The save, or null when the file was refused on read. */
  save: GameSave | null
  /** The playthrough's record, or null when that was what was refused. */
  record: PlaythroughRecord | null
  /** Resolved characters, in `save.chars` order. Missing ones are absent. */
  characters: Character[]
  /** Why this save cannot be loaded, or null when it can. */
  unloadable: string | null
}

/** One playthrough that never got a timetable: the semester on disk, its roster and its gate. */
export interface ResolvedEnrollment {
  playthroughId: string
  enrollment: Enrollment
  /** Resolved characters, in enrollment order. Missing ones are absent. */
  characters: Character[]
  /** Why the registrar cannot reopen on it, or null when it can. */
  unloadable: string | null
}

/** Which of the two a resume answered with: a save, or a semester still at the registrar. */
export function isEnrollment(
  entry: ResolvedSave | ResolvedEnrollment
): entry is ResolvedEnrollment {
  return 'enrollment' in entry
}

interface SaveStoreState {
  playthroughs: PlaythroughSummary[]
  /** Every character on disk, fetched once with the playthrough list; absent means deleted. */
  characters: Map<string, Character>
  /** The playthrough whose saves are on screen, or null at the top level. */
  selected: PlaythroughSummary | null
  saves: ResolvedSave[]
  loading: boolean
  /** Whether the playthrough list has been asked for yet — distinct from none on disk. */
  loaded: boolean

  /** Lists every playthrough — the first level of Load Game. */
  loadPlaythroughs: () => Promise<void>
  /** Opens one playthrough: lists its saves and resolves the roster once. */
  open: (playthrough: PlaythroughSummary) => Promise<void>
  /** Returns to the playthrough list. */
  back: () => void
  removeSave: (saveId: string) => Promise<void>
  removePlaythrough: (playthroughId: string) => Promise<void>
  /**
   * Reads one playthrough's enrollment, with the roster resolved and the same load gate a
   * save gets. Null when the file was refused, which reports itself.
   */
  resolveEnrollment: (playthrough: PlaythroughSummary) => Promise<ResolvedEnrollment | null>
  /**
   * What Continue opens on the most recently played playthrough: its newest save, or the
   * semester waiting at the registrar where it has none. Roster resolved and load gate
   * applied either way; null when nothing is on disk or the read failed.
   */
  continueNewest: () => Promise<ResolvedSave | ResolvedEnrollment | null>
  /**
   * Writes the semester the registrar is about to offer, minting the playthrough folder it
   * will belong to. The caller reads the failure, which it has a screen to put back first.
   */
  enroll: (draft: EnrollmentDraft) => Promise<Result<CreatedEnrollment>>
  /** Starts a new playthrough: its record, then its opening slot-save. */
  createPlaythrough: (
    record: PlaythroughDraft,
    save: SaveDraft,
    playthroughId?: string
  ) => Promise<Result<CreatedPlaythrough>>
}

/** The most recently played playthrough by `savedAt`; list order is creation order. */
export function newestPlaythrough(
  playthroughs: readonly PlaythroughSummary[]
): PlaythroughSummary | null {
  let newest: PlaythroughSummary | null = null
  for (const playthrough of playthroughs) {
    if (!newest || playthrough.savedAt > newest.savedAt) newest = playthrough
  }
  return newest
}

/** Decides whether a save can still be loaded; failures stay per-save. */
export function unloadableReason(
  chars: readonly string[],
  resolved: Map<string, Character>
): string | null {
  const missing = chars.filter((charId) => !resolved.has(charId))
  if (missing.length > 0) {
    return `missing: ${missing.join(', ')}`
  }

  // charKey uniqueness again: renames since Start Game's charKey check can collide.
  const seen = new Map<string, string>()
  const collisions: string[] = []
  for (const charId of chars) {
    const character = resolved.get(charId)
    if (!character) continue
    const key = charKeyOf(character.firstName, character.lastName)
    const previous = seen.get(key)
    if (previous) {
      const other = resolved.get(previous)
      collisions.push(
        `${fullNameOf(character)}${other ? ` and ${fullNameOf(other)}` : ''}`
      )
    } else {
      seen.set(key, charId)
    }
  }
  if (collisions.length > 0) {
    return `duplicate names: ${collisions.join('; ')}`
  }

  return null
}

/** A playthrough's cast in save order, for the faces Load Game lists it by; deleted
    characters are simply absent. */
export function castOf(
  chars: readonly string[],
  characters: Map<string, Character>
): Character[] {
  return chars
    .map((charId) => characters.get(charId))
    .filter((c): c is Character => Boolean(c))
}

/** All `saves:*` IPC lives here, never in components. */
export const useSaveStore = create<SaveStoreState>((set, get) => ({
  playthroughs: [],
  characters: new Map(),
  selected: null,
  saves: [],
  loading: false,
  loaded: false,

  loadPlaythroughs: async () => {
    set({ loading: true, selected: null, saves: [] })
    const result = await window.api.saves.playthroughs()
    if (!result.ok) {
      set({ loading: false })
      useUiStore.getState().showError(result.error)
      return
    }

    // A failed character list is not fatal: every playthrough then reads as unloadable.
    const characters = await window.api.chars.list()
    set({
      playthroughs: result.data,
      characters: new Map(
        characters.ok ? characters.data.map((character) => [character.charId, character]) : []
      ),
      loading: false,
      loaded: true
    })
  },

  open: async (playthrough) => {
    set({ loading: true, selected: playthrough, saves: [] })
    const result = await window.api.saves.list(playthrough.playthroughId)
    if (!result.ok) {
      set({ loading: false, selected: null })
      useUiStore.getState().showError(result.error)
      return
    }

    const resolved = get().characters
    const { record, error: recordError, saves } = result.data

    // `saves:list` already sorts newest-first; the resolve pass preserves it. A save refused on
    // read carries the refusal as its reason, and a refused record refuses all of them.
    set({
      saves: saves.map(({ saveId, savedAt, save, error }) => ({
        saveId,
        savedAt,
        save,
        record,
        characters: record ? castOf(record.chars, resolved) : [],
        unloadable: !record
          ? (recordError?.message ?? 'unreadable')
          : save
            ? unloadableReason(record.chars, resolved)
            : (error?.message ?? 'unreadable')
      })),
      loading: false
    })
  },

  back: () => set({ selected: null, saves: [] }),

  removeSave: async (saveId) => {
    const selected = get().selected
    if (!selected) return

    const result = await window.api.saves.delete(selected.playthroughId, saveId)
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      return
    }
    set({ saves: get().saves.filter((entry) => entry.saveId !== saveId) })
  },

  removePlaythrough: async (playthroughId) => {
    const result = await window.api.saves.deletePlaythrough(playthroughId)
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      return
    }
    // Labels are positional, so the surviving playthroughs have to renumber.
    void get().loadPlaythroughs()
  },

  resolveEnrollment: async (playthrough) => {
    const result = await window.api.saves.enrollment(playthrough.playthroughId)
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      return null
    }

    const enrollment = result.data
    const resolved = get().characters
    return {
      playthroughId: playthrough.playthroughId,
      enrollment,
      characters: castOf(enrollment.chars, resolved),
      unloadable: unloadableReason(enrollment.chars, resolved)
    }
  },

  continueNewest: async () => {
    const newest = newestPlaythrough(get().playthroughs)
    if (!newest) return null
    // A folder with no save in it has a registrar behind it rather than a game.
    if (newest.enrolling) return get().resolveEnrollment(newest)

    // The same read Load Game's second level makes. `saves:list` sorts newest-first
    // with the autosave ahead of every slot-save, so the head is the last save.
    await get().open(newest)
    return get().saves[0] ?? null
  },

  enroll: (draft) => window.api.saves.enroll(draft),

  createPlaythrough: (record, save, playthroughId) =>
    window.api.saves.create(record, save, playthroughId)
}))
