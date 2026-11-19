import { create } from 'zustand'
import type { Application } from '@shared/application'
import { playthroughLabel, playthroughNameOf, renamedRecord } from '@shared/saveRules'
import { semesterOf, withTransfers, type SemesterView } from '@shared/semesters'
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
  type SaveDraft,
  type SaveSummary,
  type SemesterRecord
} from '@shared/types'
import { useUiStore } from './uiStore'

/** One save as a list of saves shows it: the file's summary, its roster and its load gate. */
export interface ResolvedSave {
  saveId: string
  /** Epoch ms — the save's own date, or the file's when it could not be read. */
  savedAt: number
  /** What the list draws of the save, or null when the file was refused on read. */
  summary: SaveSummary | null
  /** The playthrough's record, or null when that was what was refused. */
  record: PlaythroughRecord | null
  /**
   * Resolved characters of the save's semester, its roster in order and then its graduates.
   * Missing ones are absent.
   */
  characters: Character[]
  /** Why this save cannot be loaded, or null when it can. */
  unloadable: string | null
}

/** One save read whole, ready to be entered: the file, its record, its roster and its gate. */
export interface LoadedSave {
  save: GameSave
  record: PlaythroughRecord
  /**
   * Resolved characters of the save's semester, its roster in order, then its graduates, then
   * its waiting transfers. Missing ones are absent.
   */
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

/** One playthrough that is still a New Game being set up: the application, its roster and its gate. */
export interface ResolvedApplication {
  playthroughId: string
  application: Application
  /** Why New Game cannot reopen on it, or null when it can. */
  unloadable: string | null
}

/** What a resume answers with: a save, a semester still at the registrar, or a New Game being set up. */
export type Resumed = LoadedSave | ResolvedEnrollment | ResolvedApplication

/** Whether a resume answered with a semester still at the registrar. */
export function isEnrollment(entry: Resumed): entry is ResolvedEnrollment {
  return 'enrollment' in entry
}

/** Whether a resume answered with a New Game still being set up. */
export function isApplication(entry: Resumed): entry is ResolvedApplication {
  return 'application' in entry
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
  /**
   * Lists one playthrough's saves with the roster resolved, leaving the open playthrough alone.
   * A refused listing reports itself and answers with none.
   */
  listSavesOf: (playthroughId: string) => Promise<ResolvedSave[]>
  /** Reads one save whole, roster resolved and gate applied; null when the read was refused. */
  readSave: (playthroughId: string, saveId: string) => Promise<LoadedSave | null>
  /**
   * Deletes one save of any playthrough; false when the delete was refused, which reports itself.
   * `keep` names the replays the game being played will write next, which the delete never takes.
   */
  removeSaveOf: (playthroughId: string, saveId: string, keep?: string[]) => Promise<boolean>
  /** Deletes one save of the open playthrough and drops it from the list, as `removeSaveOf` does. */
  removeSave: (saveId: string, keep?: string[]) => Promise<void>
  removePlaythrough: (playthroughId: string) => Promise<void>
  /**
   * Gives a playthrough the player's own name, or its place in creation order back where the
   * name is blank, and relabels it where it is listed; false when the write was refused, which
   * reports itself.
   */
  renamePlaythrough: (playthroughId: string, name: string) => Promise<boolean>
  /**
   * Reads one playthrough's enrollment, with the roster resolved and the same load gate a
   * save gets. Null when the file was refused, which reports itself.
   */
  resolveEnrollment: (playthrough: PlaythroughSummary) => Promise<ResolvedEnrollment | null>
  /**
   * Reads one playthrough's New Game in progress, with the roster resolved and the same load gate
   * an enrollment gets. Null when the file was refused, which reports itself.
   */
  resolveApplication: (playthrough: PlaythroughSummary) => Promise<ResolvedApplication | null>
  /**
   * What Continue opens on the most recently played playthrough: its newest save, or the
   * semester waiting at the registrar or the New Game being set up where it has none. Roster
   * resolved and load gate applied either way; null when nothing is on disk, the newest file was
   * refused or a read failed.
   */
  continueNewest: () => Promise<Resumed | null>
  /**
   * Writes the semester the registrar is about to offer: a first semester into a playthrough
   * folder it mints, a next one beside the record of `playthroughId`. The caller reads the
   * failure, which it has a screen to put back first.
   */
  enroll: (draft: EnrollmentDraft, playthroughId?: string) => Promise<Result<CreatedEnrollment>>
  /** Begins a next semester: the record's new semester, then its opening save. */
  continueSemester: (
    playthroughId: string,
    semesterId: string,
    semester: SemesterRecord,
    save: SaveDraft
  ) => Promise<Result<CreatedPlaythrough>>
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

/**
 * Decides whether a save can still be loaded; failures stay per-save. A missing roster
 * character refuses it, a missing graduate does not, and a charKey two of them share does.
 */
export function unloadableReason(
  chars: readonly string[],
  resolved: Map<string, Character>,
  alumni: readonly string[] = []
): string | null {
  const missing = chars.filter((charId) => !resolved.has(charId))
  if (missing.length > 0) {
    return `missing: ${missing.join(', ')}`
  }

  // charKey uniqueness again: renames since Start Game's charKey check can collide.
  const seen = new Map<string, string>()
  const collisions: string[] = []
  for (const charId of [...chars, ...alumni]) {
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

/**
 * The semester a save of `record` is in, or null where the record does not hold it.
 */
function semesterOfSave(
  record: PlaythroughRecord,
  semester: string | undefined
): SemesterView | null {
  try {
    return semesterOf(record, semester)
  } catch {
    return null
  }
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

/**
 * One playthrough's saves in the listing's own order, the roster resolved against the characters
 * on hand once the listing is in. A save refused on read carries the refusal as its reason, and
 * a refused record refuses all of them; a refused listing reports itself and answers null.
 */
async function resolvedSavesOf(playthroughId: string): Promise<ResolvedSave[] | null> {
  const result = await window.api.saves.list(playthroughId)
  if (!result.ok) {
    useUiStore.getState().showError(result.error)
    return null
  }

  const resolved = useSaveStore.getState().characters
  const { record, error: recordError, saves } = result.data
  return saves.map(({ saveId, savedAt, summary, error }) => {
    // Each save is read against its own semester, which saves in one folder need not share, with
    // whoever transferred into it joined on.
    const read = record && summary ? semesterOfSave(record, summary.semester) : null
    const semester = read ? withTransfers(read, summary) : null
    return {
      saveId,
      savedAt,
      summary,
      record,
      characters: semester ? castOf([...semester.chars, ...semester.alumni], resolved) : [],
      unloadable: !record
        ? (recordError?.message ?? 'unreadable')
        : summary && semester
          ? unloadableReason(semester.chars, resolved, semester.alumni)
          : (error?.message ?? 'unreadable')
    }
  })
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
    const saves = await resolvedSavesOf(playthrough.playthroughId)
    if (!saves) {
      set({ loading: false, selected: null })
      return
    }
    set({ saves, loading: false })
  },

  back: () => set({ selected: null, saves: [] }),

  listSavesOf: async (playthroughId) => (await resolvedSavesOf(playthroughId)) ?? [],

  readSave: async (playthroughId, saveId) => {
    const result = await window.api.saves.read(playthroughId, saveId)
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      return null
    }

    const { record, save } = result.data
    const resolved = get().characters
    // The service refuses a save whose semester the record does not hold.
    const semester = withTransfers(semesterOf(record, save.semester), save)
    // A waiting transfer whose character is gone gates nothing: the load drops her.
    const waiting = (save.pendingTransfers ?? []).map((entry) => entry.charId)
    return {
      save,
      record,
      characters: castOf([...semester.chars, ...semester.alumni, ...waiting], resolved),
      unloadable: unloadableReason(semester.chars, resolved, semester.alumni)
    }
  },

  removeSaveOf: async (playthroughId, saveId, keep) => {
    const result = await window.api.saves.delete(playthroughId, saveId, keep)
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      return false
    }
    return true
  },

  removeSave: async (saveId, keep) => {
    const selected = get().selected
    if (!selected) return

    if (!(await get().removeSaveOf(selected.playthroughId, saveId, keep))) return
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

  renamePlaythrough: async (playthroughId, name) => {
    const result = await window.api.saves.rename(playthroughId, name)
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      return false
    }

    // Relabelled in place rather than listed again, which would close the playthrough on screen.
    const kept = playthroughNameOf(name)
    const relabel = (playthrough: PlaythroughSummary): PlaythroughSummary => {
      if (playthrough.playthroughId !== playthroughId) return playthrough
      const { name: _previous, ...rest } = playthrough
      const label = playthroughLabel(kept, playthrough.position)
      return kept === null ? { ...rest, label } : { ...rest, label, name: kept }
    }
    const { playthroughs, selected, saves } = get()
    const opened = selected?.playthroughId === playthroughId
    set({
      playthroughs: playthroughs.map(relabel),
      selected: selected && relabel(selected),
      // The open playthrough's saves carry the record the write just changed.
      saves: opened
        ? saves.map((entry) =>
            entry.record ? { ...entry, record: renamedRecord(entry.record, name) } : entry
          )
        : saves
    })
    return true
  },

  resolveEnrollment: async (playthrough) => {
    const result = await window.api.saves.enrollment(playthrough.playthroughId)
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      return null
    }

    const enrollment = result.data
    const resolved = get().characters
    const alumni = enrollment.continued?.alumni ?? []
    return {
      playthroughId: playthrough.playthroughId,
      enrollment,
      characters: castOf([...enrollment.chars, ...alumni], resolved),
      unloadable: unloadableReason(enrollment.chars, resolved, alumni)
    }
  },

  resolveApplication: async (playthrough) => {
    const result = await window.api.saves.application(playthrough.playthroughId)
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      return null
    }

    const application = result.data
    const resolved = get().characters
    const alumni = application.continued?.alumni ?? []
    return {
      playthroughId: playthrough.playthroughId,
      application,
      unloadable: unloadableReason(application.chars, resolved, alumni)
    }
  },

  continueNewest: async () => {
    const newest = newestPlaythrough(get().playthroughs)
    if (!newest) return null
    // A folder with no save in it has a registrar or a New Game behind it rather than a game.
    if (newest.applying) return get().resolveApplication(newest)
    if (newest.enrolling) return get().resolveEnrollment(newest)

    // The same read Load Game's second level makes. The listing orders each kind of save
    // on its own and not against the others, so the newest is looked for across all of them.
    await get().open(newest)
    let latest: ResolvedSave | null = null
    for (const entry of get().saves) {
      if (!latest || entry.savedAt > latest.savedAt) latest = entry
    }
    // A refused file cannot be read whole; Load Game explains it on its own card.
    if (!latest?.summary || !latest.record) return null
    return get().readSave(newest.playthroughId, latest.saveId)
  },

  enroll: (draft, playthroughId) => window.api.saves.enroll(draft, playthroughId),

  continueSemester: (playthroughId, semesterId, semester, save) =>
    window.api.saves.continueSemester(playthroughId, semesterId, semester, save),

  createPlaythrough: (record, save, playthroughId) =>
    window.api.saves.create(record, save, playthroughId)
}))
