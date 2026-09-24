import { create } from 'zustand'
import { profileRel, roomRel, spriteRel } from '@shared/characterFiles'
import { blankSheet, isWritten } from '@shared/characterRules'
import { EMOTIONS } from '@shared/emotions'
import type { PromptEdit } from '@shared/imagePrompt'
import {
  allFollowMain,
  CUSTOM_OUTFIT_SLOTS,
  followsMain,
  outfitLabelOf,
  OUTFIT_SETS,
  parseSpriteRef,
  spriteRef,
  STOCK_OUTFIT_SETS,
  withCustomOutfit,
  withoutCustomOutfit
} from '@shared/outfits'
import { isPosition, POSITIONS } from '@shared/positions'
import type {
  AppError,
  Character,
  CharacterBrief,
  CustomOutfit,
  CustomOutfitSlot,
  Emotion,
  GenerateOptions,
  HandFixResult,
  OutfitSet,
  Position,
  ProfileCrop,
  ProfileCropInfo,
  ReferenceImage,
  Result,
  SeededSet,
  SetTarget,
  SpriteRef,
  WardrobeFixImage,
  WardrobeLayer
} from '@shared/types'
import { randomSeed } from '@shared/types'
import { ROOM_VARIANTS, type RoomVariant } from '@shared/room'
import { sfwWithholds } from '@shared/sfw'
import {
  buildCharacterPrompt,
  draftToCharacter,
  missingRequiredFields,
  type CharacterDraft
} from '../prompts/characterPrompt'
import { SEED_WORD_BAG, SEED_WORDS } from '../prompts/seedWords'
import { poseKeysOf, useAssetStore } from './assetStore'
import { useGrabBagStore } from './grabBagStore'
import { useJobStore } from './jobStore'
import { imageUrl } from './imageUrl'
import { enqueueLlm } from './llmQueue'
import { noNsfwImagesOf, useSettingsStore } from './settingsStore'
import { useUiStore } from './uiStore'

/** Raised wherever a write needs a pose and the manifest has none. */
const NO_POSES = {
  code: 'NO_POSES',
  message: 'No poses are available, so characters cannot be generated.',
  detail: 'Each pose needs an entry in pose.json and a matching skeleton PNG.'
}

/** Phase shown for character generation steps that `jobStore` cannot cover. */
type CharacterPhase = 'queued' | 'writing' | 'rendering' | 'ready' | 'failed'

/** Phases whose work is still outstanding — leaving the view cancels these. */
const IN_FLIGHT_PHASES: readonly CharacterPhase[] = ['queued', 'writing', 'rendering']

/** True while `progress` says this character still has work outstanding. */
export function isInFlight(progress?: CharacterProgress): boolean {
  return progress !== undefined && IN_FLIGHT_PHASES.includes(progress.phase)
}

/** A kind of image work a run can do; each kind is its own progress bucket on the card. */
type RenderTaskKind = 'expressions' | 'cgs' | 'cg' | 'outfit' | 'room' | 'expression'

/** One bucket of a run, counted from THIS run's completions — never from disk. */
export interface RenderTask {
  kind: RenderTaskKind
  /** Which wardrobe an `outfit` bucket is rendering; absent for the other kinds. */
  set?: OutfitSet
  /** Which CG a `cg` bucket is re-rolling; absent for the other kinds. */
  position?: Position
  /** Which sprite an `expression` bucket is re-rolling; absent for the other kinds. */
  emotion?: Emotion
  done: number
  total: number
  /** Set the moment the player cancels this bucket, before the abort round trip resolves. */
  cancelled?: boolean
  /** True while this bucket is waiting for the run to reach it: no jobs yet, counter at 0. */
  queued?: boolean
  /** True when this bucket renders into staging, not the live set — a regenerate. */
  staged?: boolean
  /** Set once the run is past this bucket — committed, failed, or walked over. */
  finished?: boolean
  /** Stable within the run, and the only way a bucket is addressed. */
  id: number
}

/** Ids for {@link RenderTask.id}; a plain counter, unique for the app's lifetime. */
let nextTaskId = 0

export type { SetTarget }

/** Whether a render fills only what is missing or replaces the whole set. */
export type RenderMode = 'fill' | 'regenerate'

/** How an export ended; `'cancelled'` is the dialog dismissed. */
type ExportOutcome = 'exported' | 'cancelled' | 'failed'

/**
 * One CG addressed on its own, as the gallery's per-image control asks for it.
 * Renderer-only; it never crosses the bridge.
 */
type CgTarget = `cg:${Position}`

/**
 * One expression sprite of one wardrobe, addressed on its own — the wardrobe column's
 * per-sprite control. Renderer-only, like {@link CgTarget}.
 */
type ExpressionTarget = `expression:${SpriteRef}`

/** Everything a bucket can be asked for: a whole set, one CG, or one sprite. */
export type RenderTarget = SetTarget | CgTarget | ExpressionTarget

/** The {@link CgTarget} naming one position — the spelling every id here answers to. */
export function cgTargetFor(position: Position): CgTarget {
  return `cg:${position}`
}

/** The {@link ExpressionTarget} naming one sprite of one wardrobe. */
export function expressionTargetFor(emotion: Emotion, set: OutfitSet | null): ExpressionTarget {
  return `expression:${spriteRef(emotion, set)}`
}

/** True for the one-CG form. */
function isCgTarget(target: RenderTarget): target is CgTarget {
  return target.startsWith('cg:')
}

/** True for the one-sprite form. */
function isExpressionTarget(target: RenderTarget): target is ExpressionTarget {
  return target.startsWith('expression:')
}

/** The position a {@link CgTarget} names, or `undefined` for a whole-set target. */
function positionOfTarget(target: RenderTarget): Position | undefined {
  if (!isCgTarget(target)) return undefined
  const position = target.slice(3)
  return isPosition(position) ? position : undefined
}

/** The sprite an {@link ExpressionTarget} names, or `undefined` for any other target. */
function spriteOfTarget(
  target: RenderTarget
): { emotion: Emotion; set: OutfitSet | null } | undefined {
  if (!isExpressionTarget(target)) return undefined
  return parseSpriteRef(target.slice('expression:'.length)) ?? undefined
}

export interface CharacterProgress {
  phase: CharacterPhase
  error?: AppError
  /** The brief this character was submitted with, kept while a failure could be retried. */
  request?: GenerateRequest
  /** The run's buckets in the order they execute; set while `phase` is `rendering`. */
  tasks?: RenderTask[]
  /** The {@link RenderTask.id} of the bucket currently running. */
  current?: number
}

/** The task currently rendering, if this progress entry has one. */
export function currentTask(progress?: CharacterProgress): RenderTask | undefined {
  if (!progress?.tasks || progress.current === undefined) return undefined
  return progress.tasks.find((task) => task.id === progress.current)
}

/** The bucket a run is rendering for one target, if it has one. */
function taskFor(
  progress: CharacterProgress | undefined,
  target: RenderTarget
): RenderTask | undefined {
  if (!isInFlight(progress)) return undefined
  const tasks = progress?.tasks
  if (!tasks) return undefined

  // The last match: a set cancelled and asked for again has a second bucket behind the first.
  for (let i = tasks.length - 1; i >= 0; i--) {
    if (bucketIdOfTask(tasks[i]) === bucketIdFor(target)) return tasks[i]
  }
  return undefined
}

/** The bucket a set's control answers for: the one still going to render. */
export function liveTaskFor(
  progress: CharacterProgress | undefined,
  target: RenderTarget
): RenderTask | undefined {
  const task = taskFor(progress, target)
  return task && !task.cancelled && !task.finished ? task : undefined
}

/** Which CGs are being re-rolled on their own right now. */
export function liveCgTasks(progress: CharacterProgress | undefined): Position[] {
  return POSITIONS.filter((position) => liveTaskFor(progress, cgTargetFor(position)))
}

/** Which of one wardrobe's sprites are being re-rolled on their own right now. */
export function liveExpressionTasks(
  progress: CharacterProgress | undefined,
  set: OutfitSet | null
): Emotion[] {
  return EMOTIONS.filter((emotion) => liveTaskFor(progress, expressionTargetFor(emotion, set)))
}

interface CharacterStoreState {
  characters: Record<string, Character>
  /**
   * Every charId the roster holds: the shipped root first, then `/data/characters` as the
   * directory lists it, with arrivals appended. Not a display order — a grid sorts it
   * ({@link manageOrderOf}) or filters it ({@link visibleOrderOf}).
   */
  order: string[]
  /** Which sprites exist on disk, per charId. */
  expressions: Record<string, Record<Emotion, boolean>>
  /** Which CGs exist on disk, per charId. */
  cgs: Record<string, Record<Position, boolean>>
  /** Which alternate-outfit sprites exist on disk, per charId then set. */
  outfits: Record<string, Record<OutfitSet, Record<Emotion, boolean>>>
  /** Which room backgrounds exist on disk, per charId. */
  rooms: Record<string, Record<RoomVariant, boolean>>
  /** Which of a regenerating set's images this run has staged, per charId, bucket id, key. */
  staged: Record<string, Record<string, Record<string, boolean>>>
  /** Bumped when a sprite is rewritten, to bust the `charimg://` image cache. */
  spriteVersion: Record<string, number>
  progress: Record<string, CharacterProgress>
  loading: boolean
  /** The charIds of the cast the game ships with. Read once, never changes. */
  pregenIds: string[]
  /** Which of them the player has taken off the roster; they stay in `characters`. */
  removedDefaults: string[]

  load: () => Promise<void>
  /** Reads the shipped cast and what the player has removed from it. */
  loadDefaults: () => Promise<void>
  /** Fetches every image of hers again — what a build serving them asynchronously calls. */
  refreshImages: (charId: string) => void
  /** Puts every removed shipped character back on the roster. */
  restoreDefaults: () => Promise<void>
  /**
   * Writes what a height lineup answered, skipping locked characters and unchanged heights;
   * returns the records as written.
   */
  saveHeights: (roster: Character[], heights: Record<string, number>) => Promise<Character[]>
  /** Runs the whole Generate modal pipeline for a new character. */
  generate: (
    firstName: string,
    lastName: string,
    prompt: string,
    namesAreSuggestions?: boolean,
    options?: GenerateOptions,
    reference?: ReferenceImage
  ) => Promise<void>
  /**
   * Creates a character straight from the New Character modal's fields, with no LLM call:
   * her sheet is the player's own words, ready to fill in by hand.
   */
  createBlank: (firstName: string, lastName: string, personality: string) => Promise<void>
  /**
   * Re-runs a character write that failed or was interrupted, from the brief this session
   * still holds or, failing that, the one on her record.
   */
  retryGeneration: (charId: string) => Promise<void>
  /**
   * Renders one set: `fill` queues only the images missing from disk; `regenerate` renders the
   * set whole into staging and commits it at the end, under the regenerate modal's edit where
   * it came from one.
   */
  generateSet: (
    charId: string,
    target: RenderTarget,
    mode: RenderMode,
    edit?: RenderEdit
  ) => Promise<void>
  /** Aborts one set's outstanding jobs, leaving the rest of the run alone. */
  cancelSet: (charId: string, target: RenderTarget) => Promise<void>
  /** Persists edits made in the EditCharacterModal. */
  save: (character: Character) => Promise<boolean>
  /** Writes one player-authored wardrobe's tags and name onto her record. */
  writeCustomOutfit: (
    charId: string,
    slot: CustomOutfitSlot,
    entry: CustomOutfit
  ) => Promise<boolean>
  /**
   * Deletes one player-authored wardrobe, its images and its record entry; refused outright
   * while anything of that set is still rendering.
   */
  deleteCustomOutfit: (charId: string, slot: CustomOutfitSlot) => Promise<boolean>
  /** Writes one character out as a zip through the native save dialog. */
  exportCharacter: (charId: string) => Promise<ExportOutcome>
  /** Adopts a character zip picked through the native open dialog into the roster. */
  importCharacter: () => Promise<boolean>
  /** Copies one character under a fresh id and splices the copy into the roster. */
  duplicateCharacter: (charId: string) => Promise<boolean>
  /** Opens one character's folder in the OS file manager. */
  openFolder: (charId: string) => Promise<void>
  /** Queues a fill for every incomplete optional set of every character; returns how many. */
  generateAllMissing: (gates: MissingContentGates) => number
  /**
   * Writes one wardrobe's repaired sprites over the set, plus the paint layer they were made
   * with, kept as the file `kind` names. `paintLayer` is `null` where the repair keeps
   * none — the hand fix — and the write removes that file instead.
   */
  applyWardrobeFix: (
    charId: string,
    set: OutfitSet | null,
    images: WardrobeFixImage[],
    paintLayer: string | null,
    kind: WardrobeLayer
  ) => Promise<boolean>
  /** Throws away one repair's kept paint layer, where there is one to throw away. */
  discardWardrobeLayer: (
    charId: string,
    set: OutfitSet | null,
    kind: WardrobeLayer
  ) => Promise<void>
  /** Whether one set has the base frame the hand fix repaints — the repair's own gate. */
  hasBaseImage: (charId: string, target: SetTarget) => Promise<boolean>
  /**
   * Redraws the hand painted on in `paintLayer`, answering with the cutout and the region it
   * changed, or `null` where the job failed or was cancelled.
   */
  fixHands: (
    charId: string,
    set: OutfitSet | null,
    paintLayer: string
  ) => Promise<HandFixResult | null>
  /** Stops a hand fix in flight, leaving the character's other work alone. */
  cancelHandFix: (charId: string, set: OutfitSet | null) => Promise<void>
  /** What the portrait modal opens on, or `null` where her sprite could not be read. */
  readProfileCrop: (charId: string) => Promise<ProfileCropInfo | null>
  /** Which of one character's room backgrounds are rendered, or `null` where that is unknown. */
  loadRoomStatus: (charId: string) => Promise<Record<RoomVariant, boolean> | null>
  /** Frames her portrait, re-cutting the PNG every avatar in the app shows. */
  setProfileCrop: (charId: string, crop: ProfileCrop) => Promise<boolean>
  /** Cancels outstanding work, then deletes the folder. */
  remove: (charId: string) => Promise<void>
  /**
   * Cancels every character's outstanding work and keeps them all: what leaving Manage
   * Characters does.
   */
  cancelAllGeneration: () => Promise<void>
}

/** Everything the New Character modal submitted — all a retry needs to run again. */
interface GenerateRequest {
  firstName: string
  lastName: string
  prompt: string
  namesAreSuggestions: boolean
  options: GenerateOptions
  /** The reference image the modal attached, if any; read back off her folder on a resume. */
  reference?: ReferenceImage
}

/**
 * The request a resume runs from: the brief on an unwritten record, with her stored names.
 * `undefined` for a written character or one whose brief is gone. The reference picture is
 * read separately, so nothing here carries bytes.
 */
export function briefRequestOf(character: Character): GenerateRequest | undefined {
  if (isWritten(character) || !character.brief) return undefined
  const { prompt, namesAreSuggestions, options } = character.brief
  return {
    firstName: character.firstName,
    lastName: character.lastName,
    prompt,
    namesAreSuggestions,
    options
  }
}

/** True while `charId`'s **run** has not been cancelled; checked after every await. */
function isLive(get: () => CharacterStoreState, charId: string): boolean {
  return Boolean(get().progress[charId])
}

/** All `chars:*`, `llm:*` and `comfy:*` IPC lives here, never in components. */
export const useCharacterStore = create<CharacterStoreState>((set, get) => ({
  characters: {},
  order: [],
  expressions: {},
  cgs: {},
  outfits: {},
  rooms: {},
  staged: {},
  spriteVersion: {},
  progress: {},
  loading: false,
  pregenIds: [],
  removedDefaults: [],

  loadDefaults: async () => {
    const result = await window.api.chars.defaults()
    // Non-fatal: with no answer every character reads as the player's own.
    if (!result.ok) {
      console.warn('[characters] could not read the shipped cast:', result.error)
      return
    }
    set({ pregenIds: result.data.ids, removedDefaults: result.data.removed })
  },

  refreshImages: (charId) => set((state) => bumpSpriteVersion(state, charId)),

  saveHeights: async (roster, heights) => {
    const written: Character[] = []
    for (const character of roster) {
      const height = heights[character.charId]
      // Main refuses a write to a locked character; an unchanged height is not an edit.
      if (height === undefined || height === character.height) continue
      if (isLockedOf(get(), character.charId)) continue
      const next = { ...character, height }
      if (await get().save(next)) written.push(next)
    }
    return written
  },

  restoreDefaults: async () => {
    const result = await window.api.chars.restoreDefaults()
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      return
    }
    // No `load()`: it would reset a run mid-render.
    set({ removedDefaults: [] })
  },

  load: async () => {
    set({ loading: true })
    await get().loadDefaults()
    const result = await window.api.chars.list()
    set({ loading: false })
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      return
    }

    const characters: Record<string, Character> = {}
    const expressions: Record<string, Record<Emotion, boolean>> = {}
    const cgs: Record<string, Record<Position, boolean>> = {}
    const outfits: Record<string, Record<OutfitSet, Record<Emotion, boolean>>> = {}
    const rooms: Record<string, Record<RoomVariant, boolean>> = {}
    await Promise.all(
      result.data.map(async (character) => {
        characters[character.charId] = character
        const [status, cgStatus, outfitStatus, roomStatus] = await Promise.all([
          window.api.chars.expressions(character.charId),
          window.api.chars.cgs(character.charId),
          window.api.chars.outfits(character.charId),
          window.api.chars.room(character.charId)
        ])
        if (status.ok) expressions[character.charId] = status.data
        if (cgStatus.ok) cgs[character.charId] = cgStatus.data
        if (outfitStatus.ok) outfits[character.charId] = outfitStatus.data
        if (roomStatus.ok) rooms[character.charId] = roomStatus.data
      })
    )

    // Reset, not merged: any surviving `progress`/`staged` entry is stale. `spriteVersion`
    // is kept — it only ever moves a URL forward, and zeroing it re-serves the cached image a
    // repair or a reframe has already replaced.
    set({
      characters,
      expressions,
      cgs,
      outfits,
      rooms,
      order: result.data.map((c) => c.charId),
      progress: {},
      staged: {}
    })
  },

  generate: async (
    firstName,
    lastName,
    prompt,
    namesAreSuggestions = false,
    options = {},
    reference
  ) => {
    // The folder is created before the LLM call, carrying the brief and the picture it was
    // submitted with: a write cut short is resumed from her folder alone.
    const brief: CharacterBrief = {
      prompt,
      namesAreSuggestions,
      options,
      reference: reference !== undefined
    }
    const created = await window.api.chars.create(
      firstName.trim(),
      lastName.trim(),
      brief,
      reference
    )
    if (!created.ok) {
      useUiStore.getState().showError(created.error)
      return
    }

    const character = created.data
    const charId = character.charId
    const request: GenerateRequest = {
      firstName,
      lastName,
      prompt,
      namesAreSuggestions,
      options,
      reference
    }
    set((state) => ({
      characters: { ...state.characters, [charId]: character },
      order: [...state.order, charId],
      progress: { ...state.progress, [charId]: { phase: 'queued', request } }
    }))

    await runWritePipeline(charId, request, set, get)
  },

  createBlank: async (firstName, lastName, personality) => {
    const pose = poseKeysOf(useAssetStore.getState().poses)[0]
    if (pose === undefined) {
      useUiStore.getState().showError(NO_POSES)
      return
    }

    // No brief, no reference: a blank has nothing an interrupted run could resume from.
    const created = await window.api.chars.create(firstName.trim(), lastName.trim())
    if (!created.ok) {
      useUiStore.getState().showError(created.error)
      return
    }

    const saved = await window.api.chars.update(blankSheet(created.data, personality, pose))
    if (!saved.ok) {
      useUiStore.getState().showError(saved.error)
      // Nothing was ever written to her folder that a player could open, so it does not stay.
      await window.api.chars.delete(created.data.charId)
      return
    }

    const charId = saved.data.charId
    set((state) => ({
      characters: { ...state.characters, [charId]: saved.data },
      order: [...state.order, charId]
    }))
  },

  retryGeneration: async (charId) => {
    const character = get().characters[charId]
    if (!character) return
    // The in-session brief where the run failed in front of the player, her record's where
    // the app was closed or the screen left with the write outstanding.
    const held = get().progress[charId]?.request
    const request = held ?? briefRequestOf(character)
    // A retry resumes the same card, under the same cancellation group.
    if (!request) return

    // The picture is only on disk, so a resume off the record fetches it before the call.
    if (!held && character.brief?.reference) {
      const read = await window.api.chars.reference(charId)
      if (!read.ok) useUiStore.getState().showError(read.error)
      else if (read.data) request.reference = read.data
    }

    set((state) => ({ progress: { ...state.progress, [charId]: { phase: 'queued', request } } }))
    await runWritePipeline(charId, request, set, get)
  },

  generateSet: async (charId, target, mode, edit) => {
    if (!get().characters[charId]) return

    // A run already holding this character takes the set.
    const run = activeRuns.get(charId)
    if (run) {
      queueOnRun(charId, run, target, mode, edit, set, get)
      return
    }

    // Registered before the await.
    const started: ActiveRun = { pending: [] }
    activeRuns.set(charId, started)

    const spec = await prepareSpec(charId, target, mode, edit, set, get)
    const specs = spec && specKeys(spec).length > 0 ? [spec] : []
    const character = get().characters[charId]
    if (!character || (specs.length === 0 && started.pending.length === 0)) {
      // Nothing to walk: unregister, but only if the registration is still ours.
      if (activeRuns.get(charId) === started) activeRuns.delete(charId)
      return
    }
    // An empty `specs` with pending clicks is a real run: the loop plans them on its first pass.
    await renderImages(character, specs, set, get, started)
  },

  cancelSet: async (charId, target) => {
    const bucketId = bucketIdFor(target)
    // Flagged before the round trip.
    const marked = cancelledBuckets.get(charId) ?? new Set<string>()
    marked.add(bucketId)
    cancelledBuckets.set(charId, marked)

    set((state) => {
      const entry = state.progress[charId]
      if (!entry?.tasks) return {}
      const tasks = entry.tasks.map((task) =>
        bucketIdOfTask(task) === bucketId ? { ...task, cancelled: true } : task
      )
      return { progress: { ...state.progress, [charId]: { ...entry, tasks } } }
    })

    // Only the running bucket has jobs in main: one still waiting its turn has submitted
    // nothing, and its keys may be the very ones a running single of the same set occupies.
    const current = currentTask(get().progress[charId])
    if (current && bucketIdOfTask(current) === bucketId) {
      await window.api.jobs.cancelKeys(charId, jobKeysFor(target))
    }
  },

  save: (character) =>
    patchCharacter(
      character.charId,
      (current) => {
        // The run owns the seeds and the custom wardrobes, so a Save landing mid-render keeps
        // what a bucket has just written.
        const { customOutfits: _stale, ...edited } = character
        return {
          ...edited,
          setSeeds: current.setSeeds,
          seedFollowsMain: current.seedFollowsMain,
          ...(current.customOutfits ? { customOutfits: current.customOutfits } : {})
        }
      },
      set,
      get
    ),

  writeCustomOutfit: (charId, slot, entry) =>
    patchCharacter(charId, (current) => withCustomOutfit(current, slot, entry), set, get),

  deleteCustomOutfit: async (charId, slot) => {
    // Its folder is being written into: there is nothing to say to that but no.
    const progress = get().progress[charId]
    if (liveTaskFor(progress, slot) || liveExpressionTasks(progress, slot).length > 0) return false

    const removed = await window.api.chars.deleteSet(charId, slot)
    if (!removed.ok) {
      useUiStore.getState().showError(removed.error)
      return false
    }

    const written = await patchCharacter(
      charId,
      (current) => withoutCustomOutfit(current, slot),
      set,
      get
    )

    const outfits = await window.api.chars.outfits(charId)
    set((state) => ({
      ...(outfits.ok ? { outfits: { ...state.outfits, [charId]: outfits.data } } : {}),
      ...bumpSpriteVersion(state, charId)
    }))
    return written
  },

  exportCharacter: async (charId) => {
    const result = await window.api.chars.export(charId)
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      return 'failed'
    }
    return result.data === null ? 'cancelled' : 'exported'
  },

  importCharacter: async () => {
    const result = await window.api.chars.import()
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      return false
    }
    // A dismissed dialog: nothing was added.
    if (result.data === null) return false

    await adoptCharacter(result.data, set)
    return true
  },

  duplicateCharacter: async (charId) => {
    const result = await window.api.chars.duplicate(charId)
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      return false
    }

    await adoptCharacter(result.data, set)
    return true
  },

  openFolder: async (charId) => {
    const result = await window.api.chars.openFolder(charId)
    if (!result.ok) useUiStore.getState().showError(result.error)
  },

  generateAllMissing: (gates) => {
    // Recomputed, not taken from the caller: a bucket may have landed since the confirm opened.
    const plan = missingContentPlan(get(), gates)
    // Never awaited: a `generateSet` resolves only once its whole run drains.
    for (const entry of plan) void get().generateSet(entry.charId, entry.target, 'fill')
    return plan.length
  },

  applyWardrobeFix: async (charId, outfitSet, images, paintLayer, kind) => {
    const result = await window.api.chars.applyWardrobeFix(
      charId,
      outfitSet ?? 'default',
      images,
      paintLayer,
      kind
    )
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      return false
    }

    // No recount: a repair rewrites existing sprites; the paint layer is never counted.
    // The repair rewrites `profile.png` too, which the bump is what shows.
    set((state) => bumpSpriteVersion(state, charId))
    return true
  },

  discardWardrobeLayer: async (charId, outfitSet, kind) => {
    const result = await window.api.chars.discardWardrobeLayer(charId, outfitSet ?? 'default', kind)
    if (!result.ok) useUiStore.getState().showError(result.error)
  },

  hasBaseImage: async (charId, target) => {
    const result = await window.api.chars.hasBase(charId, target)
    // A failed check reads as "there is one", as `withBase`'s does: the job says so for certain.
    return !result.ok || result.data
  },

  fixHands: async (charId, outfitSet, paintLayer) => {
    const character = get().characters[charId]
    if (!character) return null

    // A fresh seed every press, recorded nowhere: the same strokes re-rolled is the second
    // lever the player has, and one cutout over seven sprites is consistent by construction.
    const result = await window.api.comfy.fixHands(
      character,
      outfitSet ?? 'default',
      paintLayer,
      rerollSeed(character)
    )
    if (!result.ok) {
      // A cancel is the player's own answer, not a failure to report.
      if (result.error.code !== 'CANCELLED') useUiStore.getState().showError(result.error)
      return null
    }
    return result.data
  },

  cancelHandFix: async (charId, outfitSet) => {
    await window.api.jobs.cancelKeys(charId, [`hands:${outfitSet ?? 'default'}`])
  },

  readProfileCrop: async (charId) => {
    const result = await window.api.chars.profileCrop(charId)
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      return null
    }
    return result.data
  },

  loadRoomStatus: async (charId) => {
    const result = await window.api.chars.room(charId)
    return result.ok ? result.data : null
  },

  setProfileCrop: async (charId, crop) => {
    const result = await window.api.chars.setProfileCrop(charId, crop)
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      return false
    }

    // The record carries the frame main settled on; the bump is what re-serves the new PNG.
    set((state) => ({
      characters: { ...state.characters, [charId]: result.data },
      ...bumpSpriteVersion(state, charId)
    }))
    return true
  },

  remove: async (charId) => {
    // Hidden, not deleted: main makes the same call, so this branch must be the same test.
    if (isPregenOf(get(), charId)) {
      set((state) => ({
        removedDefaults: state.removedDefaults.includes(charId)
          ? state.removedDefaults
          : [...state.removedDefaults, charId]
      }))
      const hidden = await window.api.chars.delete(charId)
      if (!hidden.ok) useUiStore.getState().showError(hidden.error)
      return
    }

    // Dropped before the awaits.
    set((state) => {
      const { [charId]: _c, ...characters } = state.characters
      const { [charId]: _e, ...expressions } = state.expressions
      const { [charId]: _g, ...cgs } = state.cgs
      const { [charId]: _o, ...outfits } = state.outfits
      const { [charId]: _r, ...rooms } = state.rooms
      const { [charId]: _p, ...progress } = state.progress
      const { [charId]: _s, ...staged } = state.staged
      const { [charId]: _v, ...spriteVersion } = state.spriteVersion
      return {
        characters,
        expressions,
        cgs,
        outfits,
        rooms,
        progress,
        staged,
        spriteVersion,
        order: state.order.filter((id) => id !== charId)
      }
    })
    activeRuns.delete(charId)

    // Cancel before deleting.
    await window.api.jobs.cancelGroup(charId)
    // After the cancel: cancelling emits a progress event per job, which would repopulate the group.
    useJobStore.getState().clearGroup(charId)
    cancelledBuckets.delete(charId)

    const result = await window.api.chars.delete(charId)
    if (!result.ok) useUiStore.getState().showError(result.error)
  },

  cancelAllGeneration: async () => {
    const inFlight = Object.keys(get().progress).filter((charId) => isInFlight(get().progress[charId]))

    await Promise.all(
      inFlight.map(async (charId) => {
        // `progress` goes first, as in `remove`.
        set((state) => {
          const { [charId]: _p, ...progress } = state.progress
          const { [charId]: _s, ...staged } = state.staged
          return { progress, staged }
        })
        activeRuns.delete(charId)
        await window.api.jobs.cancelGroup(charId)
        useJobStore.getState().clearGroup(charId)
        cancelledBuckets.delete(charId)
        // An interrupted regeneration is discarded, never half-applied.
        await window.api.chars.discardStaged(charId)
      })
    )
  }
}))

/** The cache-busting version of a character's sprites, 0 until one is rendered or for nobody. */
export function useSpriteVersion(charId: string | null | undefined): number {
  return useCharacterStore((s) => (charId ? (s.spriteVersion[charId] ?? 0) : 0))
}

/** One store update, as `set` takes it. */
type SetPatch = Partial<CharacterStoreState>

type SetState = (partial: SetPatch | ((state: CharacterStoreState) => SetPatch)) => void

/** Puts a character main has just written into the roster, with what she has on disk. */
async function adoptCharacter(character: Character, set: SetState): Promise<void> {
  const charId = character.charId
  const [status, cgStatus, outfitStatus, roomStatus] = await Promise.all([
    window.api.chars.expressions(charId),
    window.api.chars.cgs(charId),
    window.api.chars.outfits(charId),
    window.api.chars.room(charId)
  ])

  set((state) => ({
    characters: { ...state.characters, [charId]: character },
    order: state.order.includes(charId) ? state.order : [...state.order, charId],
    expressions: status.ok ? { ...state.expressions, [charId]: status.data } : state.expressions,
    cgs: cgStatus.ok ? { ...state.cgs, [charId]: cgStatus.data } : state.cgs,
    outfits: outfitStatus.ok ? { ...state.outfits, [charId]: outfitStatus.data } : state.outfits,
    rooms: roomStatus.ok ? { ...state.rooms, [charId]: roomStatus.data } : state.rooms
  }))
}

/**
 * What a run was asked to render; one entry per {@link RenderTask} bucket. The key list is the
 * subset being rendered; completeness is still judged over the whole set, off disk.
 */
type RenderTaskSpec =
  | ({ kind: 'expressions'; emotions: Emotion[] } & Staging & Edited)
  | ({ kind: 'cgs'; positions: Position[] } & SetPlan & Staging & Edited)
  // No SetPlan: a CG re-roll's seed is never recorded.
  | ({ kind: 'cg'; position: Position; seed: number } & Staging & Edited)
  // No SetPlan: one sprite's seed is never recorded either.
  | ({ kind: 'expression'; set: OutfitSet | null; emotion: Emotion; seed: number } & Staging &
      Edited)
  | ({ kind: 'outfit'; set: OutfitSet; emotions: Emotion[] } & SetPlan & Staging & Edited)
  // No SetPlan: the room is a cloud render with no seed to record.
  | ({ kind: 'room'; variants: RoomVariant[] } & Staging)

/** Whether a bucket renders into the staging tree instead of over the live set. */
interface Staging {
  staged: boolean
}

/**
 * What the regenerate modal hands a render: the tags as it left them, and the seed it
 * settled — `null` asks for a fresh random one.
 */
export interface RenderEdit {
  prompt: PromptEdit
  seed: number | null
}

/** The tag groups a bucket renders under instead of the character's own. */
interface Edited {
  edit?: PromptEdit
}

/** How one optional set's render resolves against the seed rules. */
interface SetPlan {
  seed: number
  /** Whether the whole set is being replaced — true for a regenerate, never for a fill. */
  replace: boolean
  /** Whether finishing this set spends its follow-the-main-seed arming. */
  spendArming: boolean
}

/** The dev switch that pins every render to `generationSeed` and writes no seeds. */
function seedsFrozen(): boolean {
  return useSettingsStore.getState().settings?.freezeSeeds === true
}

/** The dev switch that lets the shipped cast be written and rendered in place. */
function pregensEditable(): boolean {
  return useSettingsStore.getState().settings?.editPregens === true
}

/** `'cgs'` is the CG set's UI name; `'cg'` is its key in the seed records. */
function seededKeyOf(target: Exclude<SetTarget, 'default' | 'room'>): SeededSet {
  return target === 'cgs' ? 'cg' : target
}

/**
 * The seed one optional set renders under, and what that means for clearing and arming. A
 * chosen seed is the regenerate modal's, and the arming is spent only where the render really
 * used the main seed.
 */
export function resolveSetPlan(
  character: Character,
  key: SeededSet,
  mode: RenderMode,
  chosen?: number
): SetPlan {
  if (seedsFrozen()) {
    return {
      seed: character.generationSeed,
      replace: mode === 'regenerate',
      spendArming: false
    }
  }

  const armed = followsMain(character, key)
  const recorded = character.setSeeds[key]

  if (mode === 'fill' && recorded !== undefined) {
    // A stale recorded seed (main rerolled since) leaves the arming unspent for the next regenerate.
    return {
      seed: recorded,
      replace: false,
      spendArming: armed && recorded === character.generationSeed
    }
  }
  if (mode === 'fill' && armed) {
    return { seed: character.generationSeed, replace: false, spendArming: true }
  }
  const seed = chosen ?? (armed ? character.generationSeed : randomSeed())
  return { seed, replace: true, spendArming: armed && seed === character.generationSeed }
}

/** The seed of a character's set, which is her own seed for the default wardrobe. */
function setSeedOf(character: Character, set: OutfitSet | null): number {
  if (set === null) return character.generationSeed
  return character.setSeeds[set] ?? character.generationSeed
}

/**
 * What the regenerate modal's seed row opens on: the seed the render would use, and whether
 * the box starts on a fresh random one. An armed set opens on the main seed, unchecked, so it
 * still follows a freshly rerolled face unless the player says otherwise — the same rule
 * {@link resolveSetPlan} applies.
 */
export function seedPrefillFor(
  character: Character,
  target: Exclude<RenderTarget, 'room'>
): { seed: number; random: boolean } {
  if (seedsFrozen()) return { seed: character.generationSeed, random: false }

  if (isExpressionTarget(target)) {
    const sprite = spriteOfTarget(target)
    return { seed: setSeedOf(character, sprite?.set ?? null), random: true }
  }
  if (isCgTarget(target)) {
    return { seed: character.setSeeds.cg ?? character.generationSeed, random: true }
  }
  if (target === 'default') return { seed: character.generationSeed, random: true }

  const key = seededKeyOf(target)
  if (followsMain(character, key)) return { seed: character.generationSeed, random: false }
  return { seed: character.setSeeds[key] ?? character.generationSeed, random: true }
}

/**
 * The seed a render nobody records runs under — one sprite or one CG re-rolled, one hand fix:
 * the modal's where it settled one, a fresh one otherwise, the frozen one under the dev switch.
 */
function rerollSeed(character: Character, chosen?: number): number {
  return seedsFrozen() ? character.generationSeed : (chosen ?? randomSeed())
}

/** The optional buckets a New Character run adds, in the order they render. */
function optionalSpecs(
  character: Character,
  options: GenerateOptions,
  noNsfwImages: boolean
): RenderTaskSpec[] {
  const specs: RenderTaskSpec[] = []
  // Nothing is on disk yet, so every set renders as a regenerate.
  const plan = (target: Exclude<SetTarget, 'default' | 'room'>): SetPlan =>
    resolveSetPlan(character, seededKeyOf(target), 'regenerate')

  // Staged even on a first run.
  const outfit = (set: OutfitSet): RenderTaskSpec => ({
    kind: 'outfit',
    set,
    emotions: [...EMOTIONS],
    staged: true,
    ...plan(set)
  })

  if (options.pe) specs.push(outfit('pe'))
  if (options.swim) specs.push(outfit('swim'))
  if (options.nude && !sfwWithholds('nude', noNsfwImages)) specs.push(outfit('nude'))
  if (options.cgs && !sfwWithholds('cgs', noNsfwImages)) {
    specs.push({ kind: 'cgs', positions: [...POSITIONS], staged: true, ...plan('cgs') })
  }
  if (options.room) specs.push({ kind: 'room', variants: [...ROOM_VARIANTS], staged: true })
  return specs
}

/** Buckets the player has cancelled, by charId then bucket id. */
const cancelledBuckets = new Map<string, Set<string>>()

/** The runs in flight, by charId; each is open at the end for clicks landing mid-run. */
const activeRuns = new Map<string, ActiveRun>()

/** One set a control asked for while a run was already walking its list. */
interface PendingSet {
  target: RenderTarget
  mode: RenderMode
  /** The {@link RenderTask.id} of the placeholder standing in for it on the card. */
  taskId: number
  /** What the regenerate modal settled, held until the run reaches this set and plans it. */
  edit?: RenderEdit
}

interface ActiveRun {
  pending: PendingSet[]
}

/** The card entry a queued bucket shows until the run reaches it and plans the real one. */
function placeholderTask(pending: PendingSet, total: number): RenderTask {
  return {
    ...taskShapeOf(pending.target),
    id: pending.taskId,
    done: 0,
    total,
    queued: true,
    staged: pending.mode === 'regenerate'
  }
}

/** Adds a set to a run already in flight, with its placeholder on the card. */
function queueOnRun(
  charId: string,
  run: ActiveRun,
  target: RenderTarget,
  mode: RenderMode,
  edit: RenderEdit | undefined,
  set: SetState,
  get: () => CharacterStoreState
): void {
  // A set this run is already rendering or already has waiting is not added again.
  if (liveTaskFor(get().progress[charId], target)) return

  const total = plannedTotal(charId, target, mode, get)
  if (total === 0) return

  cancelledBuckets.get(charId)?.delete(bucketIdFor(target))
  const pending: PendingSet = { target, mode, taskId: nextTaskId++, ...(edit ? { edit } : {}) }
  run.pending.push(pending)
  set((state) => {
    const entry = state.progress[charId]
    // No `tasks` yet: the run is still being planned, and `runBuckets` paints the placeholder itself.
    if (!entry?.tasks) return {}
    return {
      progress: {
        ...state.progress,
        [charId]: { ...entry, tasks: [...entry.tasks, placeholderTask(pending, total)] }
      }
    }
  })
}

/** The id a bucket is cancelled under — one per set, matching {@link bucketIdFor}. */
function bucketIdOfTask(task: RenderTask): string {
  if (task.kind === 'expression') {
    return task.emotion ? expressionTargetFor(task.emotion, task.set ?? null) : 'expression:'
  }
  if (task.kind === 'outfit') return `outfit:${task.set}`
  if (task.kind === 'cg') return `cg:${task.position}`
  return task.kind
}

/** The same id, addressed the way the Edit modal's controls name a set. */
function bucketIdFor(target: RenderTarget): string {
  // A single sprite is its own bucket, named by the target itself, as a single CG is.
  if (isExpressionTarget(target)) return target
  if (target === 'default') return 'expressions'
  if (target === 'cgs') return 'cgs'
  if (target === 'room') return 'room'
  // A single CG is its own bucket, and its id is the job key it occupies.
  if (isCgTarget(target)) return target
  return `outfit:${target}`
}

/** The set a bucket belongs to, named as the Edit modal's controls name it. */
function targetOfSpec(spec: RenderTaskSpec): RenderTarget {
  if (spec.kind === 'expression') return expressionTargetFor(spec.emotion, spec.set)
  if (spec.kind === 'expressions') return 'default'
  if (spec.kind === 'cgs') return 'cgs'
  if (spec.kind === 'cg') return cgTargetFor(spec.position)
  if (spec.kind === 'room') return 'room'
  return spec.set
}

/** The identifying half of a task — `kind` plus whatever of `set`/`position`/`emotion` names it. */
export function taskShapeOf(
  target: RenderTarget
): Pick<RenderTask, 'kind' | 'set' | 'position' | 'emotion'> {
  if (isExpressionTarget(target)) {
    const sprite = spriteOfTarget(target)
    return { kind: 'expression', set: sprite?.set ?? undefined, emotion: sprite?.emotion }
  }
  if (isCgTarget(target)) return { kind: 'cg', position: positionOfTarget(target) }
  if (target === 'default') return { kind: 'expressions' }
  if (target === 'cgs') return { kind: 'cgs' }
  if (target === 'room') return { kind: 'room' }
  return { kind: 'outfit', set: target }
}

/** The keys one spec renders, whichever kind it is. */
function specKeys(spec: RenderTaskSpec): readonly string[] {
  if (spec.kind === 'expression') return [spec.emotion]
  if (spec.kind === 'cg') return [spec.position]
  if (spec.kind === 'cgs') return spec.positions
  if (spec.kind === 'room') return spec.variants
  return spec.emotions
}

/** How many images a set would render if it started now — a queued bucket's denominator. */
function plannedTotal(
  charId: string,
  target: RenderTarget,
  mode: RenderMode,
  get: () => CharacterStoreState
): number {
  // One image whichever mode asked: a re-roll replaces exactly the clicked sprite or CG.
  if (isExpressionTarget(target)) return 1
  if (isCgTarget(target)) return 1
  if (mode === 'regenerate') {
    return target === 'cgs' ? POSITIONS.length : target === 'room' ? ROOM_VARIANTS.length : EMOTIONS.length
  }
  const state = get()
  if (target === 'cgs') return POSITIONS.filter((p) => !state.cgs[charId]?.[p]).length
  if (target === 'room') return ROOM_VARIANTS.filter((v) => !state.rooms[charId]?.[v]).length
  if (target === 'default') return EMOTIONS.filter((e) => !state.expressions[charId]?.[e]).length
  return EMOTIONS.filter((e) => !state.outfits[charId]?.[target]?.[e]).length
}

/**
 * One set the Manage Characters sweep would fill: whose it is, which set, and how much it lacks.
 */
interface MissingSet {
  charId: string
  target: SetTarget
  /** Images on the floor right now — what the confirm counts, not a promise. */
  missing: number
}

/** What the sweep cannot read off the character herself: the Edit modal's per-set gates. */
interface MissingContentGates {
  comfyReady: boolean
  pictureKeySet: boolean
  noNsfwImages: boolean
}

/** The store slices the sweep reads — everything it needs is already loaded. */
type MissingContentState = Pick<
  CharacterStoreState,
  | 'characters'
  | 'order'
  | 'expressions'
  | 'cgs'
  | 'outfits'
  | 'rooms'
  | 'progress'
  | 'pregenIds'
>

/**
 * Every incomplete optional set across the whole roster, in roster order — what "Generate
 * Missing Content" queues.
 */
export function missingContentPlan(
  state: MissingContentState,
  gates: MissingContentGates
): MissingSet[] {
  const plan: MissingSet[] = []

  for (const charId of state.order) {
    const character = state.characters[charId]
    if (!character) continue
    // A locked character renders nothing — main refuses the job.
    if (isLockedOf(state, charId)) continue

    const progress = state.progress[charId]
    // A character still being written is skipped; a rendering run is appended to.
    if (progress?.phase === 'queued' || progress?.phase === 'writing') continue

    /** Counts one set, unless a bucket is already going to render it. */
    const consider = (target: SetTarget, missing: number): void => {
      if (missing > 0 && !liveTaskFor(progress, target)) plan.push({ charId, target, missing })
    }

    const defaultsPresent = doneCountOf(state.expressions, charId) === EMOTIONS.length
    if (gates.comfyReady && defaultsPresent) {
      for (const set of STOCK_OUTFIT_SETS) {
        if (sfwWithholds(set, gates.noNsfwImages)) continue
        consider(set, EMOTIONS.filter((emotion) => !state.outfits[charId]?.[set]?.[emotion]).length)
      }
      // Only a slot her record carries tags for: nothing else has anything to render from.
      for (const slot of CUSTOM_OUTFIT_SLOTS) {
        if (!character.customOutfits?.[slot]) continue
        consider(
          slot,
          EMOTIONS.filter((emotion) => !state.outfits[charId]?.[slot]?.[emotion]).length
        )
      }
      if (!sfwWithholds('cgs', gates.noNsfwImages)) {
        consider('cgs', POSITIONS.filter((position) => !state.cgs[charId]?.[position]).length)
      }
    }

    if (gates.pictureKeySet && character.roomPrompt.trim()) {
      consider('room', ROOM_VARIANTS.filter((variant) => !state.rooms[charId]?.[variant]).length)
    }
  }

  return plan
}

/** What rendering one set now means: which images, which seed, whether staged. */
async function prepareSpec(
  charId: string,
  target: RenderTarget,
  mode: RenderMode,
  edit: RenderEdit | undefined,
  set: SetState,
  get: () => CharacterStoreState
): Promise<RenderTaskSpec | null> {
  const character = get().characters[charId]
  if (!character) return null

  // The seed the modal settled, a fresh one where it asked for one, and nothing without a modal.
  const chosen = edit === undefined ? undefined : (edit.seed ?? randomSeed())

  if (isExpressionTarget(target)) {
    const sprite = spriteOfTarget(target)
    if (!sprite) return null
    const { emotion, set: outfitSet } = sprite
    const present =
      outfitSet === null
        ? get().expressions[charId]?.[emotion]
        : get().outfits[charId]?.[outfitSet]?.[emotion]
    // Only a sprite still on disk is re-rolled: a queued bucket is planned long after the click.
    if (!present) return null
    // Live, not staged: one sprite is written in place, and a staged commit would replace
    // the whole wardrobe's directory.
    return {
      kind: 'expression',
      set: outfitSet,
      emotion,
      seed: rerollSeed(character, chosen),
      staged: false,
      edit: edit?.prompt
    }
  }

  if (isCgTarget(target)) {
    const position = positionOfTarget(target)
    // Only a CG still on disk is re-rolled: a queued bucket is planned long after the click.
    if (!position || !get().cgs[charId]?.[position]) return null
    // Live, not staged: a staged commit would replace the whole `cg/` directory.
    return {
      kind: 'cg',
      position,
      seed: rerollSeed(character, chosen),
      staged: false,
      edit: edit?.prompt
    }
  }

  if (target === 'default') {
    if (mode === 'fill') {
      // Under the character's own seed, as the images beside them were.
      const missing = EMOTIONS.filter((emotion) => !get().expressions[charId]?.[emotion])
      return { kind: 'expressions', emotions: await withBase(charId, 'default', missing), staged: false }
    }

    // A defaults regenerate rerolls the seed and re-arms the optional sets in one write.
    if (seedsFrozen()) {
      return { kind: 'expressions', emotions: [...EMOTIONS], staged: true, edit: edit?.prompt }
    }

    // Through the record's one writer, so a seed a bucket records meanwhile is not lost. The
    // fresh flags carry no custom slot, which is what arms one to follow the new face.
    const wasLive = isLive(get, charId)
    const written = await patchCharacter(
      charId,
      (fresh) => ({
        ...fresh,
        generationSeed: chosen ?? randomSeed(),
        seedFollowsMain: allFollowMain()
      }),
      set,
      get
    )
    if (!written || !get().characters[charId]) return null
    if (wasLive && !isLive(get, charId)) return null
    return { kind: 'expressions', emotions: [...EMOTIONS], staged: true, edit: edit?.prompt }
  }

  if (target === 'room') {
    // No seed plan: the room is a cloud render.
    if (!character.roomPrompt.trim()) return null
    const variants =
      mode === 'regenerate'
        ? [...ROOM_VARIANTS]
        : ROOM_VARIANTS.filter((variant) => !get().rooms[charId]?.[variant])
    return { kind: 'room', variants, staged: mode === 'regenerate' }
  }

  const plan = resolveSetPlan(character, seededKeyOf(target), mode, chosen)

  if (target === 'cgs') {
    const positions = plan.replace
      ? [...POSITIONS]
      : POSITIONS.filter((position) => !get().cgs[charId]?.[position])
    return { kind: 'cgs', positions, staged: plan.replace, ...plan, edit: edit?.prompt }
  }

  const emotions = plan.replace
    ? [...EMOTIONS]
    : await withBase(
        charId,
        target,
        EMOTIONS.filter((emotion) => !get().outfits[charId]?.[target]?.[emotion])
      )
  return {
    kind: 'outfit',
    set: target,
    emotions,
    staged: plan.replace,
    ...plan,
    edit: edit?.prompt
  }
}

/**
 * A fill's emotion list, with `neutral` prepended when the set has no base frame to face-pass
 * the others from.
 */
async function withBase(
  charId: string,
  target: SetTarget,
  emotions: Emotion[]
): Promise<Emotion[]> {
  if (emotions.length === 0) return emotions
  if (emotions.includes('neutral')) return emotions

  const base = await window.api.chars.hasBase(charId, target)
  // A failed check reads as "there is one": the job fails with `EXPRESSION_SOURCE_MISSING` if wrong.
  if (!base.ok || base.data) return emotions
  return ['neutral', ...emotions]
}

/** The job keys one set occupies — what `jobs:cancelKeys` matches on. */
function jobKeysFor(target: RenderTarget): string[] {
  // One sprite occupies the key its own set's bucket would render it under.
  if (isExpressionTarget(target)) {
    const sprite = spriteOfTarget(target)
    if (!sprite) return []
    return [sprite.set ? `outfit:${sprite.set}:${sprite.emotion}` : sprite.emotion]
  }
  // For a single CG the bucket id is the job key.
  if (isCgTarget(target)) return [target]
  if (target === 'default') return [...EMOTIONS]
  if (target === 'cgs') return POSITIONS.map((position) => `cg:${position}`)
  if (target === 'room') return ROOM_VARIANTS.map((variant) => `room:${variant}`)
  return EMOTIONS.map((emotion) => `outfit:${target}:${emotion}`)
}

/** True once the player has cancelled this bucket of this character's run. */
function isBucketCancelled(charId: string, bucketId: string): boolean {
  return cancelledBuckets.get(charId)?.has(bucketId) ?? false
}

/** The turn each character's record writes are queued behind, so two never interleave. */
const recordWrites = new Map<string, Promise<unknown>>()

/**
 * The one writer of a character's record: at the head of its turn it reads her as the store
 * holds her then, hands that to `patch`, and puts back what main wrote.
 */
function patchCharacter(
  charId: string,
  patch: (current: Character) => Character,
  set: SetState,
  get: () => CharacterStoreState
): Promise<boolean> {
  const turn = (recordWrites.get(charId) ?? Promise.resolve()).then(async () => {
    const current = get().characters[charId]
    if (!current) return false

    const saved = await window.api.chars.update(patch(current))
    if (!saved.ok) {
      useUiStore.getState().showError(saved.error)
      return false
    }
    // Only while she is still on the roster: a character deleted mid-write is not put back.
    if (get().characters[charId]) {
      set((state) => ({ characters: { ...state.characters, [charId]: saved.data } }))
    }
    return true
  })
  recordWrites.set(charId, turn.catch(() => undefined))
  return turn
}

/** Records the seed a set rendered under, so a later fill can match it. */
async function recordSetSeed(
  charId: string,
  key: SeededSet,
  seed: number,
  set: SetState,
  get: () => CharacterStoreState
): Promise<void> {
  const current = get().characters[charId]
  if (!current || seedsFrozen() || current.setSeeds[key] === seed) return

  await patchCharacter(
    charId,
    (fresh) => ({ ...fresh, setSeeds: { ...fresh.setSeeds, [key]: seed } }),
    set,
    get
  )
}

/** Records that `sets` have used their follow-the-main-seed turn, in one write per run. */
async function consumeArming(
  charId: string,
  sets: SeededSet[],
  set: SetState,
  get: () => CharacterStoreState
): Promise<void> {
  const current = get().characters[charId]
  if (!current || !sets.some((s) => followsMain(current, s))) return

  await patchCharacter(
    charId,
    (fresh) => {
      const seedFollowsMain = { ...fresh.seedFollowsMain }
      for (const s of sets) seedFollowsMain[s] = false
      return { ...fresh, seedFollowsMain }
    },
    set,
    get
  )
}

/**
 * Everything from the LLM write to the terminal phase, for a character whose folder already
 * exists; shared by first submission and Retry.
 */
async function runWritePipeline(
  charId: string,
  request: GenerateRequest,
  set: SetState,
  get: () => CharacterStoreState
): Promise<void> {
  // The brief rides on every pre-render failure and is dropped once rendering starts.
  const fail = (error: AppError): void => {
    if (!isLive(get, charId)) return
    set((state) => ({
      progress: { ...state.progress, [charId]: { phase: 'failed', error, request } }
    }))
  }

  const poses = useAssetStore.getState().poses
  if (Object.keys(poses).length === 0) {
    fail(NO_POSES)
    return
  }

  const prompt = buildCharacterPrompt(
    request.firstName,
    request.lastName,
    request.prompt,
    poses,
    useGrabBagStore.getState().draw(SEED_WORD_BAG, SEED_WORDS),
    request.namesAreSuggestions,
    request.reference
  )
  // charId doubles as the cancellation group: `jobs:cancelGroup` aborts this request too.
  const drafted = await enqueueLlm(async () => {
    // Checked before spending the call: deletion while queued in the lane is common.
    if (!isLive(get, charId)) return null
    set((state) => ({
      progress: { ...state.progress, [charId]: { phase: 'writing', request } }
    }))
    return window.api.llm.generateCharacter<CharacterDraft>(prompt, charId)
  })
  if (drafted === null || !isLive(get, charId)) return
  if (!drafted.ok) {
    fail(drafted.error)
    return
  }

  // Read back, not captured: a retry fills in the same folder's character.json.
  const character = get().characters[charId]
  if (!character) return

  const filled = draftToCharacter(character, drafted.data, poses)
  const missing = missingRequiredFields(filled)
  if (missing.length > 0) {
    // An empty required field is a job failure.
    fail({
      code: 'CHARACTER_INCOMPLETE',
      message: 'The generated character was missing required fields.',
      detail: `Missing: ${missing.join(', ')}`
    })
    return
  }

  const saved = await window.api.chars.update(filled)
  // `writeCharacter` mkdirs its parent, so a write landing after deletion resurrects the folder.
  if (!isLive(get, charId)) {
    if (saved.ok) await window.api.chars.delete(charId)
    return
  }
  if (!saved.ok) {
    fail(saved.error)
    return
  }

  set((state) => ({ characters: { ...state.characters, [charId]: saved.data } }))
  // Expressions lead: a display order, not a correctness one — no bucket depends on another.
  await renderImages(
    saved.data,
    [
      // The one bucket that is never staged.
      { kind: 'expressions', emotions: [...EMOTIONS], staged: false },
      ...optionalSpecs(saved.data, request.options, noNsfwImagesOf(useSettingsStore.getState()))
    ],
    set,
    get
  )
}

/** Images one spec renders — the denominator of its bucket, and a fill renders fewer. */
function taskTotal(spec: RenderTaskSpec): number {
  if (spec.kind === 'expression') return 1
  if (spec.kind === 'cg') return 1
  if (spec.kind === 'cgs') return spec.positions.length
  if (spec.kind === 'room') return spec.variants.length
  return spec.emotions.length
}

/** One bucket's render pass: render each key, recount off disk, say whether the set is complete. */
async function runBranch<K extends string, S>(opts: {
  charId: string
  /** The bucket's {@link RenderTask.id}, for the counter. */
  taskId: number
  keys: readonly K[]
  /** A key the rest depend on, rendered alone first; the others are skipped if it fails. */
  first?: K
  generate: (key: K) => Promise<{ ok: boolean }>
  /** Writes one landed image into the store, sprite version included. */
  markDone: (key: K) => void
  /** Re-reads the folder, the authority on what actually exists. */
  recount: () => Promise<Result<S>>
  applyRecount: (data: S) => void
  complete: (data: S) => boolean
  countOne: (taskId: number) => void
  /** True once this bucket is cancelled — checked per key, so nothing new starts. */
  cancelled: () => boolean
  get: () => CharacterStoreState
}): Promise<boolean | null> {
  const { charId, get } = opts

  const runOne = async (key: K): Promise<boolean> => {
    // Keys run serially in main, so refusing to submit stops those still waiting their turn.
    if (opts.cancelled()) return false

    const result = await opts.generate(key)
    if (!result.ok || !isLive(get, charId)) return false

    opts.countOne(opts.taskId)
    opts.markDone(key)
    return true
  }

  // The `first` key is awaited alone: the rest are rendered from what it produces.
  let keys = opts.keys
  if (opts.first !== undefined && keys.includes(opts.first)) {
    const landed = await runOne(opts.first)
    if (!isLive(get, charId)) return null
    if (!landed) {
      keys = []
    } else {
      keys = keys.filter((key) => key !== opts.first)
    }
  }

  await Promise.allSettled(keys.map(runOne))

  if (!isLive(get, charId)) return null

  const status = await opts.recount()
  if (!isLive(get, charId)) return null
  if (!status.ok) return false
  opts.applyRecount(status.data)
  return opts.complete(status.data)
}

/** Runs a character's buckets in order, then sets the run's terminal phase. */
async function renderImages(
  character: Character,
  specs: RenderTaskSpec[],
  set: SetState,
  get: () => CharacterStoreState,
  started?: ActiveRun
): Promise<void> {
  const charId = character.charId
  // A run starts with nothing cancelled: the flags belonged to the run that was stopped.
  cancelledBuckets.delete(charId)

  // `started` is a run the caller registered before planning, holding what was clicked meanwhile.
  const run = started ?? { pending: [] }
  activeRuns.set(charId, run)
  try {
    await runBuckets(character, specs, run, set, get)
  } finally {
    // Unregistered only if still ours: a cancel or delete may have replaced it.
    if (activeRuns.get(charId) === run) activeRuns.delete(charId)
  }
}

/** Everything one kind of bucket contributes to {@link runBuckets}' generic pass. */
interface BucketPlan<K extends string, S> {
  /** Every key the finished set holds; completeness is judged over all of them. */
  all: readonly K[]
  /** The keys this bucket actually renders — a fill renders fewer. */
  keys: readonly K[]
  /** A key the rest depend on, rendered alone and first; sprite buckets only. */
  first?: K
  generate: (key: K) => Promise<{ ok: boolean }>
  /** The live status maps: the folder as the store mirrors it. */
  disk: {
    recount: () => Promise<Result<S>>
    applyRecount: (data: S) => void
    complete: (data: S) => boolean
  }
  /** Writes one landed image into the live maps, sprite version included. */
  markDone: (key: K) => void
  /** The seed record this set owes, or `null` where it has none. */
  recordSeed: (() => Promise<void>) | null
  /** Files the bucket's outcome against the run's terminal error. */
  settle: (complete: boolean) => void
}

/** Identity, for the sake of inferring `K` and `S` off one object literal. */
function bucketPlan<K extends string, S>(plan: BucketPlan<K, S>): BucketPlan<string, unknown> {
  return plan as unknown as BucketPlan<string, unknown>
}

/** The run itself, wrapped by {@link renderImages} so its registration cannot leak. */
async function runBuckets(
  character: Character,
  specs: RenderTaskSpec[],
  run: ActiveRun,
  set: SetState,
  get: () => CharacterStoreState
): Promise<void> {
  const charId = character.charId

  const tasks: RenderTask[] = specs.map((spec) => ({
    ...taskShapeOf(targetOfSpec(spec)),
    id: nextTaskId++,
    done: 0,
    total: taskTotal(spec),
    staged: spec.staged
  }))
  /** `specs[i]`'s task id — the one alignment the run depends on. */
  const taskIds: number[] = tasks.map((task) => task.id)
  // Clicks that landed during planning are in `pending` with no placeholder yet; painted here.
  for (const next of run.pending) {
    tasks.push(placeholderTask(next, plannedTotal(charId, next.target, next.mode, get)))
  }
  set((state) => ({
    progress: { ...state.progress, [charId]: { phase: 'rendering', tasks, current: 0 } }
  }))

  /** Counts one of this run's own completions into its bucket, never a file on disk. */
  const countOne = (taskId: number): void =>
    patchTask(taskId, (task) => ({ done: task.done + 1 }))

  /** Rewrites one bucket's entry on the card, leaving the rest of the run alone. */
  const patchTask = (
    taskId: number,
    patch: Partial<RenderTask> | ((task: RenderTask) => Partial<RenderTask>)
  ): void =>
    set((state) => {
      const entry = state.progress[charId]
      if (!entry?.tasks?.some((task) => task.id === taskId)) return {}
      const updated = entry.tasks.map((task) =>
        task.id === taskId ? { ...task, ...(typeof patch === 'function' ? patch(task) : patch) } : task
      )
      return { progress: { ...state.progress, [charId]: { ...entry, tasks: updated } } }
    })

  /** Takes a queued bucket's placeholder off the card when it turns out to have no work. */
  const dropTask = (taskId: number): void =>
    set((state) => {
      const entry = state.progress[charId]
      if (!entry?.tasks) return {}
      const tasks = entry.tasks.filter((task) => task.id !== taskId)
      if (tasks.length === entry.tasks.length) return {}
      return { progress: { ...state.progress, [charId]: { ...entry, tasks } } }
    })

  /** Plans the next queued set once the run has caught up with its planned list. */
  const planNext = async (planned: number): Promise<void> => {
    while (run.pending.length > 0 && specs.length === planned) {
      const next = run.pending.shift()
      if (!next) return
      const spec = isBucketCancelled(charId, bucketIdFor(next.target))
        ? null
        : await prepareSpec(charId, next.target, next.mode, next.edit, set, get)
      if (!spec || specKeys(spec).length === 0) {
        dropTask(next.taskId)
        continue
      }
      specs.push(spec)
      taskIds.push(next.taskId)
      patchTask(next.taskId, { total: taskTotal(spec), staged: spec.staged })
    }
  }

  /** One landed image of a staged bucket, kept out of the live status maps. */
  const markStaged =
    (bucketId: string) =>
    (key: string): void =>
      set((state) => ({
        staged: {
          ...state.staged,
          [charId]: {
            ...state.staged[charId],
            [bucketId]: { ...state.staged[charId]?.[bucketId], [key]: true }
          }
        },
        ...bumpSpriteVersion(state, charId)
      }))

  const forgetStaged = (bucketId: string): void =>
    set((state) => {
      const forChar = state.staged[charId]
      if (!forChar?.[bucketId]) return {}
      const { [bucketId]: _done, ...rest } = forChar
      return { staged: { ...state.staged, [charId]: rest }, ...bumpSpriteVersion(state, charId) }
    })

  /** What a staged bucket answers `runBranch`'s disk questions with. */
  const stagedBranch = (bucketId: string, all: readonly string[]) => ({
    markDone: markStaged(bucketId),
    recount: async (): Promise<Result<Record<string, boolean>>> => ({
      ok: true as const,
      data: get().staged[charId]?.[bucketId] ?? {}
    }),
    applyRecount: () => {},
    complete: (data: Record<string, boolean>) => all.every((key) => data[key])
  })

  /** Throws a staged bucket away: what a cancel leaves behind is the old set. */
  const discard = async (target: SetTarget, bucketId: string): Promise<void> => {
    forgetStaged(bucketId)
    await window.api.chars.discardStaged(charId, target)
  }

  /** Makes a finished staged bucket the live set, and says whether it landed. */
  const commit = async (
    target: SetTarget,
    bucketId: string,
    taskId: number
  ): Promise<'committed' | 'nothing' | 'failed'> => {
    const result = await window.api.chars.commitStaged(charId, target)
    set((state) => {
      const forChar = state.staged[charId]
      const entry = state.progress[charId]
      const { [bucketId]: _done, ...rest } = forChar ?? {}
      return {
        ...(forChar?.[bucketId] ? { staged: { ...state.staged, [charId]: rest } } : {}),
        ...(entry?.tasks?.some((task) => task.id === taskId)
          ? {
              progress: {
                ...state.progress,
                [charId]: {
                  ...entry,
                  tasks: entry.tasks.map((task) =>
                    task.id === taskId ? { ...task, finished: true } : task
                  )
                }
              }
            }
          : {}),
        ...bumpSpriteVersion(state, charId)
      }
    })
    if (!isLive(get, charId)) return 'failed'
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      return 'failed'
    }
    return result.data === 'committed' ? 'committed' : 'nothing'
  }

  /** Re-reads one set off disk into the store — run after a commit changed it. */
  const refresh = async <S,>(disk: {
    recount: () => Promise<Result<S>>
    applyRecount: (data: S) => void
  }): Promise<void> => {
    const status = await disk.recount()
    if (!isLive(get, charId) || !status.ok) return
    disk.applyRecount(status.data)
  }

  /**
   * The live half of a plan over a flat `charId -> key -> boolean` map — `expressions`, `cgs` or
   * `rooms`; `outfits` has a set between the two and builds its own.
   */
  const flatMap = <K extends string>(
    slice: 'expressions' | 'cgs' | 'rooms',
    recount: () => Promise<Result<Record<K, boolean>>>,
    all: readonly K[]
  ): Pick<BucketPlan<K, Record<K, boolean>>, 'disk' | 'markDone'> => ({
    disk: {
      recount,
      applyRecount: (data) =>
        set((state) => ({ [slice]: { ...state[slice], [charId]: data } }) as SetPatch),
      complete: (data) => all.every((key) => data[key])
    },
    markDone: (key) =>
      set(
        (state) =>
          ({
            [slice]: { ...state[slice], [charId]: { ...state[slice][charId], [key]: true } },
            ...bumpSpriteVersion(state, charId)
          }) as SetPatch
      )
  })

  /**
   * One bucket, start to finish: record its seed, render every key, and — for a staged bucket
   * — commit what landed over the live set.
   */
  const runBucket = async (
    plan: BucketPlan<string, unknown>,
    staged: boolean,
    taskId: number,
    target: RenderTarget,
    bucketId: string,
    cancelled: () => boolean
  ): Promise<'stop' | 'skip' | 'done'> => {
    // A fill records its seed up front; a regenerate only once it has committed.
    if (plan.recordSeed && !staged) {
      await plan.recordSeed()
      if (!isLive(get, charId)) return 'stop'
    }

    const common = {
      charId,
      taskId,
      get,
      countOne,
      cancelled,
      keys: plan.keys,
      ...(plan.first !== undefined ? { first: plan.first } : {}),
      generate: plan.generate
    }
    // Staged and live buckets answer "what exists" from different places.
    const complete = staged
      ? await runBranch({ ...common, ...stagedBranch(bucketId, plan.all) })
      : await runBranch({ ...common, ...plan.disk, markDone: plan.markDone })
    if (complete === null) return 'stop'

    // Only whole sets stage, so `target` is the `SetTarget` the folder channels take.
    if (staged && !isCgTarget(target) && !isExpressionTarget(target)) {
      if (cancelled()) {
        await discard(target, bucketId)
        return 'skip'
      }
      if ((await commit(target, bucketId, taskId)) === 'committed') {
        if (plan.recordSeed) {
          await plan.recordSeed()
          if (!isLive(get, charId)) return 'stop'
        }
        await refresh(plan.disk)
      }
      if (!isLive(get, charId)) return 'stop'
    }
    if (cancelled()) return 'skip'
    plan.settle(complete)
    return 'done'
  }

  let expressionsAsked = false
  let expressionsDone = true
  let cgsDone = true
  let roomDone = true
  /** Sets this run asked for and did not finish; named in the terminal error. */
  const outfitsFailed: OutfitSet[] = []
  /** Optional sets this run rendered off the main seed and finished. */
  const consumed: SeededSet[] = []

  for (let index = 0; ; index++) {
    if (index >= specs.length) {
      // The list is walked out: settle the arming, then look once more for a queued set. No await
      // between that check and the terminal write, so no click can be accepted and lost.
      if (consumed.length > 0) {
        await consumeArming(charId, consumed, set, get)
        consumed.length = 0
      }
      if (!isLive(get, charId)) return
      await planNext(specs.length)
      if (index >= specs.length) {
        // Unregistered here, not in the caller's `finally`: a later click must start its own run.
        if (activeRuns.get(charId) === run) activeRuns.delete(charId)
        break
      }
    }

    const spec = specs[index]
    const taskId = taskIds[index]
    const target = targetOfSpec(spec)
    const bucketId = bucketIdFor(target)
    /** Read fresh on every check — a cancel can land at any point in a bucket. */
    const cancelled = (): boolean => isBucketCancelled(charId, bucketId)
    // The character as the store holds it now, not as the run captured it.
    const current = get().characters[charId] ?? character

    // Cancelled before it started: no jobs to abort, and the run carries on to the next set.
    if (cancelled()) {
      patchTask(taskId, { cancelled: true, queued: false, finished: true })
      continue
    }

    patchTask(taskId, { queued: false })
    set((state) => {
      const entry = state.progress[charId]
      if (!entry) return {}
      return { progress: { ...state.progress, [charId]: { ...entry, current: taskId } } }
    })

    // Everything the pass below needs that is particular to this kind of set.
    let plan: BucketPlan<string, unknown>
    if (spec.kind === 'expressions') {
      expressionsAsked = true
      plan = bucketPlan({
        all: EMOTIONS,
        keys: spec.emotions,
        first: 'neutral' as Emotion,
        generate: (emotion) =>
          window.api.comfy.generateExpression(current, emotion, undefined, spec.staged, spec.edit),
        ...flatMap('expressions', () => window.api.chars.expressions(charId), EMOTIONS),
        recordSeed: null,
        settle: (complete) => {
          expressionsDone = complete
        }
      })
    } else if (spec.kind === 'outfit') {
      const outfitSet = spec.set
      plan = bucketPlan({
        all: EMOTIONS,
        keys: spec.emotions,
        first: 'neutral' as Emotion,
        generate: (emotion) =>
          window.api.comfy.generateOutfit(
            current,
            outfitSet,
            emotion,
            spec.seed,
            spec.staged,
            spec.edit
          ),
        disk: {
          recount: () => window.api.chars.outfits(charId),
          applyRecount: (data) =>
            set((state) => ({ outfits: { ...state.outfits, [charId]: data } })),
          complete: (data) => EMOTIONS.every((emotion) => data[outfitSet][emotion])
        },
        markDone: (emotion) =>
          set((state) => ({
            outfits: {
              ...state.outfits,
              [charId]: {
                ...state.outfits[charId],
                [outfitSet]: { ...state.outfits[charId]?.[outfitSet], [emotion]: true }
              } as Record<OutfitSet, Record<Emotion, boolean>>
            },
            ...bumpSpriteVersion(state, charId)
          })),
        recordSeed: () => recordSetSeed(charId, outfitSet, spec.seed, set, get),
        settle: (complete) => {
          if (!complete) outfitsFailed.push(outfitSet)
          else if (spec.spendArming) consumed.push(outfitSet)
        }
      })
    } else if (spec.kind === 'room') {
      plan = bucketPlan({
        all: ROOM_VARIANTS,
        // `ROOM_VARIANTS` order is load-bearing: night re-lights the day image.
        keys: spec.variants,
        generate: (variant) => window.api.chars.generateRoom(current, variant, spec.staged),
        ...flatMap('rooms', () => window.api.chars.room(charId), ROOM_VARIANTS),
        // The room is a cloud render off no seed of its own.
        recordSeed: null,
        settle: (complete) => {
          roomDone = complete
        }
      })
    } else if (spec.kind === 'cg') {
      const position = spec.position
      // Judged on this render landing, not on disk.
      let landed = false
      plan = bucketPlan({
        all: [position],
        keys: [position],
        generate: () => window.api.comfy.generateCg(current, position, spec.seed, false, spec.edit),
        disk: {
          // Recounted anyway, to keep the store's map honest about the folder.
          recount: () => window.api.chars.cgs(charId),
          applyRecount: (data) => set((state) => ({ cgs: { ...state.cgs, [charId]: data } })),
          complete: () => landed
        },
        markDone: () => {
          landed = true
          set((state) => ({
            cgs: { ...state.cgs, [charId]: { ...state.cgs[charId], [position]: true } },
            ...bumpSpriteVersion(state, charId)
          }))
        },
        // A re-roll's seed is nobody's record.
        recordSeed: null,
        settle: (complete) => {
          if (!complete) cgsDone = false
        }
      })
    } else if (spec.kind === 'expression') {
      const emotion = spec.emotion
      const outfitSet = spec.set
      // Judged on this render landing, not on the sprites already on disk.
      let landed = false
      if (outfitSet === null) {
        // One of the seven the run's terminal error speaks for: without this, the tail would
        // recompute `expressionsDone` off disk, where the sprite this re-roll failed to
        // replace is still sitting, and the failure would go unsaid.
        expressionsAsked = true
        plan = bucketPlan({
          all: [emotion],
          keys: [emotion],
          generate: () =>
            window.api.comfy.generateExpression(current, emotion, spec.seed, false, spec.edit),
          disk: {
            recount: () => window.api.chars.expressions(charId),
            applyRecount: (data) =>
              set((state) => ({ expressions: { ...state.expressions, [charId]: data } })),
            complete: () => landed
          },
          markDone: () => {
            landed = true
            set((state) => ({
              expressions: {
                ...state.expressions,
                [charId]: { ...state.expressions[charId], [emotion]: true }
              },
              ...bumpSpriteVersion(state, charId)
            }))
          },
          // A re-roll's seed is nobody's record.
          recordSeed: null,
          settle: (complete) => {
            if (!complete) expressionsDone = false
          }
        })
      } else {
        plan = bucketPlan({
          all: [emotion],
          keys: [emotion],
          generate: () =>
            window.api.comfy.generateOutfit(
              current,
              outfitSet,
              emotion,
              spec.seed,
              false,
              spec.edit
            ),
          disk: {
            recount: () => window.api.chars.outfits(charId),
            applyRecount: (data) =>
              set((state) => ({ outfits: { ...state.outfits, [charId]: data } })),
            complete: () => landed
          },
          markDone: () => {
            landed = true
            set((state) => ({
              outfits: {
                ...state.outfits,
                [charId]: {
                  ...state.outfits[charId],
                  [outfitSet]: { ...state.outfits[charId]?.[outfitSet], [emotion]: true }
                } as Record<OutfitSet, Record<Emotion, boolean>>
              },
              ...bumpSpriteVersion(state, charId)
            }))
          },
          recordSeed: null,
          settle: (complete) => {
            if (!complete) outfitsFailed.push(outfitSet)
          }
        })
      }
    } else {
      plan = bucketPlan({
        all: POSITIONS,
        keys: spec.positions,
        generate: (position) =>
          window.api.comfy.generateCg(current, position, spec.seed, spec.staged, spec.edit),
        ...flatMap('cgs', () => window.api.chars.cgs(charId), POSITIONS),
        recordSeed: () => recordSetSeed(charId, 'cg', spec.seed, set, get),
        settle: (complete) => {
          cgsDone = complete
          if (complete && spec.spendArming) consumed.push('cg')
        }
      })
    }

    const outcome = await runBucket(plan, spec.staged, taskId, target, bucketId, cancelled)
    // Deleted or replaced while the jobs ran.
    if (outcome === 'stop') return
    // Cancelled: the run walks on without settling this bucket.
    if (outcome === 'skip') continue

    // Past this bucket, finished or failed — idempotent over the mark a commit already made.
    patchTask(taskId, { finished: true })
  }

  cancelledBuckets.delete(charId)

  // A run that rendered no sprites still judges the set off the store's last recount.
  if (!expressionsAsked) {
    expressionsDone = EMOTIONS.every((emotion) => get().expressions[charId]?.[emotion])
  }

  const error: AppError | undefined = !expressionsDone
    ? {
        code: 'EXPRESSIONS_INCOMPLETE',
        message: 'Some expressions could not be generated. Open the character to generate them again.'
      }
    : !cgsDone
      ? {
          code: 'CGS_INCOMPLETE',
          message: 'Some NSFW scenes could not be generated. Generate them again.'
        }
      : outfitsFailed.length > 0
        ? {
            code: 'OUTFITS_INCOMPLETE',
            message: `Some ${outfitsFailed
              .map((s) => outfitLabelOf(get().characters[charId] ?? character, s))
              .join(' and ')} sprites could not be generated. Generate them again.`
          }
        : !roomDone
          ? {
              code: 'ROOM_INCOMPLETE',
              message: 'The room background could not be generated. Generate it again.'
            }
          : undefined

  set((state) => ({
    progress: {
      ...state.progress,
      [charId]: error ? { phase: 'failed', error } : { phase: 'ready' }
    }
  }))
}

/** The sprite-version bump every landed image carries, as a slice for one `set` call. */
function bumpSpriteVersion(
  state: CharacterStoreState,
  charId: string
): Pick<CharacterStoreState, 'spriteVersion'> {
  return {
    spriteVersion: { ...state.spriteVersion, [charId]: (state.spriteVersion[charId] ?? 0) + 1 }
  }
}

/** How many of a character's seven default expressions are on disk — the card's "3/7". */
export function doneCountOf(
  expressions: Record<string, Record<Emotion, boolean>>,
  charId: string
): number {
  return EMOTIONS.filter((emotion) => expressions[charId]?.[emotion]).length
}

/** A character missing a default sprite, with nothing running to supply it. */
export function isUnfinished(
  expressions: Record<string, Record<Emotion, boolean>>,
  progress: Record<string, CharacterProgress>,
  charId: string
): boolean {
  return !isInFlight(progress[charId]) && doneCountOf(expressions, charId) < EMOTIONS.length
}

/** The store slices the two shipped-cast reads need. */
type DefaultsState = Pick<CharacterStoreState, 'order' | 'pregenIds' | 'removedDefaults'>

/** True for a character shipped with the game, dev switch or not; see {@link isLockedOf}. */
export function isPregenOf(state: Pick<DefaultsState, 'pregenIds'>, charId: string): boolean {
  return state.pregenIds.includes(charId)
}

/** True for a character this build will not write to — not editable, not rendered. */
export function isLockedOf(state: Pick<DefaultsState, 'pregenIds'>, charId: string): boolean {
  return isPregenOf(state, charId) && !pregensEditable()
}

/** {@link isLockedOf} as the list the height lineup's `lockedIds` takes. */
export function lockedIdsOf(state: Pick<DefaultsState, 'pregenIds'>): string[] {
  return pregensEditable() ? [] : state.pregenIds
}

/** The roster as the player has it: every character except the shipped ones he removed. */
export function visibleOrderOf(state: Omit<DefaultsState, 'pregenIds'>): string[] {
  if (state.removedDefaults.length === 0) return state.order
  return state.order.filter((charId) => !state.removedDefaults.includes(charId))
}

/** The store slices the Manage grid's order is computed from. */
type ManageOrderState = Pick<
  CharacterStoreState,
  'characters' | 'order' | 'removedDefaults' | 'pregenIds' | 'progress'
>

/**
 * The Manage grid's order: in-flight run first, newest-write-first own characters, then shipped
 * last. **Both keys turn over only on a run start/end or a file write, never a progress tick**,
 * so nothing shuffles under the cursor mid-render.
 */
export function manageOrderOf(state: ManageOrderState): string[] {
  const running: string[] = []
  const own: string[] = []
  const shipped: string[] = []

  for (const charId of visibleOrderOf(state)) {
    if (isInFlight(state.progress[charId])) running.push(charId)
    // `isPregenOf`, not `isLockedOf`: the dev switch makes the shipped cast editable, not new.
    else if (isPregenOf(state, charId)) shipped.push(charId)
    else own.push(charId)
  }

  // Stable, so equal stamps keep roster order; a file written before `updatedAt` is oldest.
  own.sort((a, b) => (state.characters[b]?.updatedAt ?? 0) - (state.characters[a]?.updatedAt ?? 0))
  return [...running, ...own, ...shipped]
}

/** True when every one of a set's seven sprites is on disk — a partial set is none. */
function outfitSetReady(
  status: Record<OutfitSet, Record<Emotion, boolean>> | undefined,
  set: OutfitSet
): boolean {
  return EMOTIONS.every((emotion) => status?.[set]?.[emotion])
}

/** Which of a character's outfit sets are fully rendered — what the scene prompt offers RITA. */
export function readyOutfitSets(
  status: Record<OutfitSet, Record<Emotion, boolean>> | undefined
): OutfitSet[] {
  return OUTFIT_SETS.filter((set) => outfitSetReady(status, set))
}

/** URL for a character image, with a cache-buster for regenerations. */
export function spriteUrl(charId: string, value: SpriteRef, version = 0, staged = false): string {
  return imageUrl(charId, spriteRel(value), version, staged)
}

/** One wardrobe image decoded from its bytes, or `null` where there is no such file. */
export async function loadWardrobeImage(
  charId: string,
  set: OutfitSet | null,
  image: string
): Promise<ImageBitmap | null> {
  const result = await window.api.chars.readWardrobeImage(charId, set ?? 'default', image)
  if (!result.ok) throw result.error
  if (!result.data) return null
  return createImageBitmap(new Blob([result.data]))
}

/** URL for a room background, on the same terms as {@link spriteUrl}. */
export function roomUrl(charId: string, variant: RoomVariant, version = 0, staged = false): string {
  return imageUrl(charId, roomRel(variant), version, staged)
}

/** URL for the square face crop, on the same terms as {@link spriteUrl}. */
export function profileUrl(charId: string, version = 0, staged = false): string {
  return imageUrl(charId, profileRel(), version, staged)
}

/** Which images of one set a run has staged, or `undefined` when it is not regenerating. */
export function stagedOf(
  staged: Record<string, Record<string, Record<string, boolean>>>,
  charId: string,
  target: SetTarget
): Record<string, boolean> | undefined {
  return staged[charId]?.[bucketIdFor(target)]
}
