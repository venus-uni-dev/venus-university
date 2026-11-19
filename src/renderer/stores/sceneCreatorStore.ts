import { create } from 'zustand'
import { asReaderPronouns, readerPronounsOf } from '@shared/gender'
import { pairKeyOf } from '@shared/npcRelationships'
import { STARTING_TIER, STAT_KEYS, tierOf, type StatKey, type StatTier } from '@shared/playerStats'
import {
  DEFAULT_SCENE_DATE,
  defaultMilestones,
  pairsWithin,
  type SavedScene,
  type SavedSceneSummary,
  type SceneCastEntry,
  type SceneReader,
  type SceneRelation,
  type SceneSetup
} from '@shared/sceneCreator'
import {
  DEFAULT_PLAYER_FIRST_NAMES,
  DEFAULT_PLAYER_LAST_NAME,
  roomBgIdOf,
  type Character,
  type TimeSlot
} from '@shared/types'
import type { Weather } from '@shared/weather'
import { useCharacterStore } from './characterStore'
import { newestPlaythrough, useSaveStore } from './saveStore'
import { useUiStore } from './uiStore'

/**
 * The Scene Creator screen's state: the setup being drafted, which outlives a visit for the rest
 * of the session, the reader read once off the newest save, and the saved scenes on disk.
 */

/** How many girls a created scene can hold, one per row. */
const SCENE_ROWS = 3

/** The setup as the screen drafts it: the cast by row, a row being empty or holding a girl. */
export interface SceneDraft extends Omit<SceneSetup, 'cast'> {
  rows: (SceneCastEntry | null)[]
}

/** The setup a draft plays: its filled rows in order, and only the pairs between them. */
export function setupOfDraft(draft: SceneDraft): SceneSetup {
  const cast = draft.rows.filter((row): row is SceneCastEntry => row !== null)
  const { rows: _rows, ...rest } = draft
  return { ...rest, cast, pairs: pairsWithin(cast.map((entry) => entry.charId), draft.pairs) }
}

/** A row as it is first filled: her main outfit, neutral, met, nothing else set. */
function freshEntry(charId: string): SceneCastEntry {
  return {
    charId,
    outfit: 'default',
    disposition: 'neutral',
    milestones: defaultMilestones(),
    notes: ''
  }
}

/** The reader New Game opens on, for a machine with no save to read one off. */
function defaultReader(): SceneReader {
  const tiers = {} as Record<StatKey, StatTier>
  for (const key of STAT_KEYS) tiers[key] = STARTING_TIER
  return {
    firstName: DEFAULT_PLAYER_FIRST_NAMES.he,
    lastName: DEFAULT_PLAYER_LAST_NAME,
    pronouns: 'he',
    tiers,
    bio: ''
  }
}

/** A setup with nobody in it, on the default day, half, sky and reader. */
function blankDraft(reader: SceneReader): SceneDraft {
  return {
    reader,
    rows: Array<SceneCastEntry | null>(SCENE_ROWS).fill(null),
    pairs: {},
    date: DEFAULT_SCENE_DATE,
    time: 0,
    weather: 'clear',
    prompt: ''
  }
}

/**
 * The reader as the newest save has him — the playthrough Continue would open, its newest file,
 * its enrollment or its New Game once he is named — or null where there is none or it could not
 * be read. Reads only: the Load Game list is left as it was.
 */
async function newestReader(): Promise<SceneReader | null> {
  const saves = useSaveStore.getState()
  if (!saves.loaded) await saves.loadPlaythroughs()
  const newest = newestPlaythrough(useSaveStore.getState().playthroughs)
  if (!newest) return null
  const tiersOf = (stats: Record<StatKey, number>): Record<StatKey, StatTier> => {
    const tiers = {} as Record<StatKey, StatTier>
    for (const key of STAT_KEYS) tiers[key] = tierOf(stats[key])
    return tiers
  }
  if (newest.applying) {
    const reader = (await useSaveStore.getState().resolveApplication(newest))?.application.reader
    if (!reader) return null
    return {
      firstName: reader.firstName,
      lastName: reader.lastName,
      pronouns: asReaderPronouns(reader.pronouns),
      tiers: tiersOf(reader.stats),
      bio: reader.bio ?? ''
    }
  }
  if (newest.enrolling) {
    const enrolled = await useSaveStore.getState().resolveEnrollment(newest)
    if (!enrolled) return null
    const { enrollment } = enrolled
    return {
      firstName: enrollment.playerFirstName,
      lastName: enrollment.playerLastName,
      pronouns: readerPronounsOf(enrollment),
      tiers: tiersOf(enrollment.stats),
      bio: enrollment.bio ?? ''
    }
  }
  const listed = await useSaveStore.getState().listSavesOf(newest.playthroughId)
  let latest: (typeof listed)[number] | null = null
  for (const entry of listed) if (!latest || entry.savedAt > latest.savedAt) latest = entry
  if (!latest?.summary || !latest.record) return null
  const loaded = await useSaveStore.getState().readSave(newest.playthroughId, latest.saveId)
  if (!loaded) return null
  return {
    firstName: loaded.record.playerFirstName,
    lastName: loaded.record.playerLastName,
    pronouns: readerPronounsOf(loaded.record),
    tiers: tiersOf(loaded.save.stats),
    bio: loaded.save.bio ?? ''
  }
}

interface SceneCreatorState {
  /** The setup being drafted; null until the screen first opens this session. */
  draft: SceneDraft | null
  /** The saved scenes, newest first; null until listed. */
  saved: SavedSceneSummary[] | null

  /** Opens the draft the first time the screen is visited, the reader read off the newest save. */
  start: () => Promise<void>
  /** Fills a row with a girl, or empties it; emptying drops her pairs and a background of hers. */
  setRow: (row: number, character: Character | null) => void
  /** Changes what is set about the girl in one row. */
  patchRow: (row: number, patch: Partial<SceneCastEntry>) => void
  /** Sets how two girls in the scene stand with each other. */
  setRelation: (a: string, b: string, relation: SceneRelation) => void
  patchReader: (patch: Partial<SceneReader>) => void
  setDate: (date: number) => void
  setTime: (time: TimeSlot) => void
  setWeather: (weather: Weather) => void
  /** Picks the background the scene opens on, or hands the choice back to the writer. */
  setBg: (bg: string | undefined) => void
  setPrompt: (prompt: string) => void

  /** Lists the saved scenes. */
  loadSaved: () => Promise<void>
  /** Reads one saved scene whole; null when the read was refused, which reports itself. */
  readSaved: (id: string) => Promise<SavedScene | null>
  /** Deletes one saved scene; a refusal reports itself and keeps it listed. */
  deleteSaved: (id: string) => Promise<void>
}

/** The draft with one change made, a no-op before the draft exists. */
function patched(
  draft: SceneDraft | null,
  change: (draft: SceneDraft) => Partial<SceneDraft>
): { draft: SceneDraft } | Record<string, never> {
  return draft ? { draft: { ...draft, ...change(draft) } } : {}
}

export const useSceneCreatorStore = create<SceneCreatorState>((set, get) => ({
  draft: null,
  saved: null,

  start: async () => {
    if (get().draft) return
    // Drawn at once on New Game's reader, then put right once the newest save has been read.
    set({ draft: blankDraft(defaultReader()) })
    const reader = await newestReader()
    if (reader) set((state) => patched(state.draft, () => ({ reader })))
  },

  setRow: (row, character) =>
    set((state) =>
      patched(state.draft, (draft) => {
        const leaving = draft.rows[row]
        const rows = draft.rows.map((entry, i) =>
          i === row ? (character ? freshEntry(character.charId) : null) : entry
        )
        const cast = rows.flatMap((entry) => (entry ? [entry.charId] : []))
        const left = leaving ? useCharacterStore.getState().characters[leaving.charId] : undefined
        const leavingRoom = left !== undefined && draft.bg === roomBgIdOf(left)
        return {
          rows,
          pairs: pairsWithin(cast, draft.pairs),
          ...(leavingRoom ? { bg: undefined } : {})
        }
      })
    ),

  patchRow: (row, patch) =>
    set((state) =>
      patched(state.draft, (draft) => ({
        rows: draft.rows.map((entry, i) => (i === row && entry ? { ...entry, ...patch } : entry))
      }))
    ),

  setRelation: (a, b, relation) =>
    set((state) =>
      patched(state.draft, (draft) => ({ pairs: { ...draft.pairs, [pairKeyOf(a, b)]: relation } }))
    ),

  patchReader: (patch) =>
    set((state) => patched(state.draft, (draft) => ({ reader: { ...draft.reader, ...patch } }))),

  setDate: (date) => set((state) => patched(state.draft, () => ({ date }))),
  setTime: (time) => set((state) => patched(state.draft, () => ({ time }))),
  setWeather: (weather) => set((state) => patched(state.draft, () => ({ weather }))),
  setBg: (bg) => set((state) => patched(state.draft, () => ({ bg }))),
  setPrompt: (prompt) => set((state) => patched(state.draft, () => ({ prompt }))),

  loadSaved: async () => {
    const result = await window.api.scenes.list()
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      set({ saved: [] })
      return
    }
    set({ saved: result.data })
  },

  readSaved: async (id) => {
    const result = await window.api.scenes.read(id)
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      return null
    }
    return result.data
  },

  deleteSaved: async (id) => {
    const result = await window.api.scenes.delete(id)
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      return
    }
    set((state) => ({ saved: (state.saved ?? []).filter((scene) => scene.id !== id) }))
  }
}))
