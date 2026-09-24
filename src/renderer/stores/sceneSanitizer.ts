import { settleDating, type DatingPassInput, type DatingPassOutcome } from '@shared/dating'
import { isCustomOutfitSlot, parseSpriteRef } from '@shared/outfits'
import type { PlayerStats } from '@shared/playerStats'
import {
  affectionOf,
  crushHintUpdate,
  emptyFlags,
  foldRelationshipEvents,
  isRelationshipEvent,
  MEMORY_CAP,
  memoryStatusLine as memoryLineOf,
  milestoneEmotionOf,
  milestoneSoured,
  milestoneStatusLines as milestoneLinesFor,
  overTextDesc
} from '@shared/relationship'
import { storedMemoryDesc } from '@shared/readerVoice'
import { parseAction, showAction, spriteAction } from '@shared/sceneActions'
import { splitSentences } from '@shared/sentences'
import { giftStatusMarkedLine } from '@shared/shop'
import {
  allBackgrounds,
  charKeyOf,
  roomBgIdOf,
  type CharInfo,
  type CharMemory,
  type Emotion,
  type IntimateAct,
  type LedgerResponse,
  MEMORY_TYPES,
  type MemoryType,
  type RelationshipEvent,
  type SceneGift,
  type SceneLine,
  type SceneResponse,
  type SpriteRef
} from '@shared/types'
import { ACT_KINDS } from '../prompts/scenePrompt'
import { useAssetStore } from './assetStore'
import {
  blankCharInfo,
  PORTRAIT_SLOTS,
  stageContextOf,
  UNKNOWN_NAME,
  useGameStore
} from './gameStore'
import { stageFactsOf, stepStage } from './stageStep'
import { addContact, IGNORED_TEXT_DESC, TURNED_DOWN_DESC, unblockContact } from './textingLoop'

/**
 * The double quotes RITA sometimes wraps a whole line in — never single quotes, which a line can
 * legitimately open on as an elided apostrophe.
 */
const QUOTE_CHARS = ['"', '“', '”'] as const

/** One line with the wrapping quotation marks taken off it, speaker or narrator. */
function unquoteLine(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length < 2) return text
  const isQuote = (at: string): boolean => QUOTE_CHARS.some((quote) => quote === at)
  if (!isQuote(trimmed[0]) || !isQuote(trimmed[trimmed.length - 1])) return text
  const inner = trimmed.slice(1, -1)
  if (QUOTE_CHARS.some((quote) => inner.includes(quote))) return text
  return inner.trim()
}

/** What a call may ask the sanitizer to repair beyond the standing rules. */
export interface SanitizerOptions {
  /** Put a cast member on stage the first time she speaks, when the reply never did. */
  forceShowSpeakers?: boolean
  /**
   * The charKeys on stage where this call's lines will land — {@link stageAsWritten}, captured
   * once at the top of the call and given to both of its passes.
   */
  stage?: readonly string[]
  /**
   * Whether a line fits the dialogue box (`views/boxRows.ts`), deciding where
   * {@link splitOverflow} cuts. **Both of a call's passes get the same one**, or they'd produce
   * different line counts and reconciliation would read it as a divergence.
   */
  fits?: (text: string) => boolean
}

/** The stage {@link stageAsWritten} describes. */
export interface StageAsWritten {
  /** charKeys standing on it, in slot order — what the sanitizer seeds from. */
  onStage: string[]
  /** The sticky sprite reference each character ends on, by charId; a CG among them. */
  emotions: Record<string, SpriteRef>
  /** The background it is set against, or null between scenes. */
  bg: string | null
  /**
   * charIds off it — an absence still running or a departure already settled — with the queued
   * shows and hides counted, so a hide the player has not read yet is already an absence.
   */
  hidden: Set<string>
}

/**
 * The stage as *written*: the played stage, run forward through the actions still queued ahead
 * of this call's first line.
 */
export function stageAsWritten(): StageAsWritten {
  const game = useGameStore.getState()
  // Read once for the walk, as advanceLine reads it once per line.
  const ctx = stageContextOf(game)
  let stage = stageFactsOf(game)
  for (const line of game.pendingLines) stage = stepStage(stage, line, ctx).stage

  const onStage = stage.slots.flatMap((charId) => {
    const character = charId ? game.characters[charId] : undefined
    return character ? [charKeyOf(character.firstName, character.lastName)] : []
  })
  // An absence still running and a departure already settled are both off it.
  const hidden = new Set([...Object.keys(stage.offStage), ...stage.departed])
  return { onStage, emotions: { ...stage.emotions }, bg: stage.bg, hidden }
}

/**
 * Scene JSON parser hardening: drop/default unknown LLM values with warnings.
 * Tracks on-screen count here so a fourth `show:` is rejected before playback.
 */
export function createSceneSanitizer(options: SanitizerOptions = {}): {
  sanitizeLine: (raw: Partial<SceneLine> | undefined) => SceneLine
} {
  const game = useGameStore.getState()
  const knownKeys = new Set(Object.keys(game.charKeyToId))
  // Flat across categories.
  const backgrounds = new Set(allBackgrounds(useAssetStore.getState().backgrounds))
  // Cast members' room bgs are legal exactly when the prompt offered them: both images on disk.
  for (const charId of game.cast) {
    const character = game.characters[charId]
    if (character && game.roomReady[charId]) backgrounds.add(roomBgIdOf(character))
  }
  const charKeyToId = game.charKeyToId
  const cgReady = game.cgReady
  const outfitReady = game.outfitReady

  // Seeded once and predicted forward from show/hide. Never re-read slots after
  // creation: playback mutates the stage under the stream.
  const onScreen = new Set<string>(options.stage ?? stageAsWritten().onStage)

  // Who this scene may put on stage — the cast, not the whole roster in `knownKeys`.
  const castKeys = new Set<string>()
  for (const charId of game.cast) {
    const character = game.characters[charId]
    if (character) castKeys.add(charKeyOf(character.firstName, character.lastName))
  }
  // Anyone the reply has already staged, so a walked-off character is not dragged back on.
  const everOnScreen = new Set<string>(onScreen)

  return {
    sanitizeLine(raw) {
      const line: SceneLine = { speaker: '', text: unquoteLine(raw?.text ?? '') }

      if (raw?.speaker) {
        if (knownKeys.has(raw.speaker)) line.speaker = raw.speaker
        else
          console.warn(`[scene] unknown speaker "${raw.speaker}" — treating the line as narration.`)
      }

      if (raw?.bg !== undefined) {
        if (backgrounds.has(raw.bg)) line.bg = raw.bg
        else console.warn(`[scene] unknown background "${raw.bg}" — keeping the current one.`)
      }

      // Hardened in the order given and kept in it: an earlier `show:` is what
      // makes a `sprite:` or `cg:` behind it legal.
      const kept: string[] = []

      // The forgotten-entrance repair, ahead of the reply's own actions so anything
      // behind it sees her on stage and a later explicit `show:` reads as redundant.
      if (
        options.forceShowSpeakers &&
        line.speaker &&
        castKeys.has(line.speaker) &&
        !onScreen.has(line.speaker) &&
        !everOnScreen.has(line.speaker)
      ) {
        if (onScreen.size >= PORTRAIT_SLOTS) {
          console.warn(
            `[scene] "${line.speaker}" speaks without being shown, but the stage is full — leaving her off.`
          )
        } else {
          console.warn(`[scene] "${line.speaker}" speaks without being shown — showing her.`)
          onScreen.add(line.speaker)
          everOnScreen.add(line.speaker)
          // No paired `sprite:`: the stage falls back to her neutral portrait.
          kept.push(showAction('show', line.speaker))
        }
      }
      for (const rawAction of raw?.actions ?? []) {
        const parsed = typeof rawAction === 'string' ? parseAction(rawAction) : null
        if (!parsed) {
          console.warn(`[scene] unparseable action "${String(rawAction)}" — dropping it.`)
          continue
        }

        // A CG names no character; every other action does.
        if (parsed.kind !== 'cg' && !knownKeys.has(parsed.charKey)) {
          console.warn(`[scene] unknown character "${parsed.charKey}" in ${rawAction} — dropping it.`)
          continue
        }

        if (parsed.kind === 'show') {
          if (onScreen.has(parsed.charKey)) {
            // Already visible; the instruction is redundant rather than wrong.
            continue
          }
          if (onScreen.size >= PORTRAIT_SLOTS) {
            console.warn(`[scene] ${rawAction} would put a fourth character on screen — dropping it.`)
            continue
          }
          onScreen.add(parsed.charKey)
          everOnScreen.add(parsed.charKey)
          kept.push(rawAction)
        } else if (parsed.kind === 'hide') {
          if (!onScreen.has(parsed.charKey)) {
            console.warn(`[scene] ${rawAction} but "${parsed.charKey}" is not on screen — ignoring it.`)
            continue
          }
          onScreen.delete(parsed.charKey)
          kept.push(rawAction)
        } else if (parsed.kind === 'sprite') {
          if (!onScreen.has(parsed.charKey)) {
            console.warn(`[scene] ${rawAction} but "${parsed.charKey}" is not on screen — dropping it.`)
            continue
          }
          // A set not fully rendered for her degrades to the bare emotion, as does a custom
          // wardrobe: the model is never told about one, so it cannot have meant it.
          const outfit = parseSpriteRef(parsed.ref)
          const charId = charKeyToId[parsed.charKey]
          if (
            outfit?.set &&
            (isCustomOutfitSlot(outfit.set) || !outfitReady[charId]?.includes(outfit.set))
          ) {
            console.warn(
              `[scene] "${parsed.ref}" is not rendered for "${parsed.charKey}" — showing her default outfit.`
            )
            kept.push(spriteAction(parsed.charKey, outfit.emotion))
          } else {
            kept.push(rawAction)
          }
        } else {
          // A CG needs the stage down to exactly one girl, with her CG set on disk.
          const [only] = [...onScreen]
          const charId = only ? charKeyToId[only] : undefined
          if (onScreen.size === 1 && charId && cgReady[charId]) {
            kept.push(rawAction)
          } else {
            console.warn(
              `[scene] ${rawAction} needs exactly one character on screen with CGs — dropping it.`
            )
          }
        }
      }
      if (kept.length > 0) line.actions = kept

      return line
    }
  }
}

/**
 * A line too long for the box, cut at its own sentence boundaries into pieces that each fit,
 * sentences packed greedily. Only the first piece keeps `bg` and `actions`.
 */
export function splitOverflow(line: SceneLine, fits?: (text: string) => boolean): SceneLine[] {
  // A status line is the app's own sentence and is laid out with marks against its text; cutting
  // it would strand a mark's offsets on the wrong half.
  if (!fits || line.status || fits(line.text)) return [line]

  const sentences = splitSentences(line.text)
  if (sentences.length < 2) return [line]

  const chunks: string[] = []
  for (const sentence of sentences) {
    const grown = chunks.length > 0 ? `${chunks[chunks.length - 1]} ${sentence}` : sentence
    // A sentence that will not fit by itself still goes on a line of its own: there is nothing
    // shorter to cut it into, and the box grows for it as it always did.
    if (chunks.length > 0 && fits(grown)) chunks[chunks.length - 1] = grown
    else chunks.push(sentence)
  }
  if (chunks.length < 2) return [line]

  return chunks.map((text, index) =>
    index === 0 ? { ...line, text } : { speaker: line.speaker, text }
  )
}

/** Hardens a whole `SceneResponse` — the authoritative pass, run on the resolved reply. */
export function sanitizeScene(
  response: SceneResponse,
  options: SanitizerOptions = {}
): {
  lines: SceneLine[]
  summary: string | null
  end: boolean
} {
  const sanitizer = createSceneSanitizer(options)
  // A blank or missing summary is not a summary: the previous one stands.
  const summary = typeof response.summary === 'string' ? response.summary.trim() : ''
  return {
    lines: (response.lines ?? []).flatMap((raw) =>
      splitOverflow(sanitizer.sanitizeLine(raw), options.fits)
    ),
    summary: summary || null,
    end: response.end_scene === true
  }
}

/** One ledger memory that survived validation, resolved to a roster charId. */
export interface ValidMemory {
  charId: string
  type: MemoryType
  desc: string
}

/** The ledger's memories, minus the rows that cannot be filed, each in the reader's voice. */
export function ledgerMemories(ledger: LedgerResponse, log = true): ValidMemory[] {
  const { charKeyToId } = useGameStore.getState()
  const kept: ValidMemory[] = []

  for (const entry of ledger.memories ?? []) {
    const charId = charKeyToId[entry?.charKey ?? '']
    if (!charId) {
      if (log) console.warn(`[ledger] memory for unknown character "${entry?.charKey}" — dropping it.`)
      continue
    }
    if (!MEMORY_TYPES.includes(entry.type)) {
      if (log) console.warn(`[ledger] memory type "${entry.type}" is not valid — dropping the entry.`)
      continue
    }
    if (!entry.desc?.trim()) {
      if (log) console.warn('[ledger] memory entry has no description — dropping it.')
      continue
    }
    kept.push({ charId, type: entry.type, desc: storedMemoryDesc(entry.desc) })
  }

  return kept
}

/**
 * The ledger's texting memories, validated exactly as {@link ledgerMemories} validates its own
 * rows, and then **capped at one per character**.
 */
function ledgerTextMemories(ledger: LedgerResponse, log = true): ValidMemory[] {
  const { charKeyToId } = useGameStore.getState()
  const kept: ValidMemory[] = []
  const seen = new Set<string>()

  for (const entry of ledger.textMemories ?? []) {
    const charId = charKeyToId[entry?.charKey ?? '']
    if (!charId) {
      if (log)
        console.warn(
          `[ledger] texting memory for unknown character "${entry?.charKey}" — dropping it.`
        )
      continue
    }
    if (!MEMORY_TYPES.includes(entry.type)) {
      if (log)
        console.warn(`[ledger] texting memory type "${entry.type}" is not valid — dropping it.`)
      continue
    }
    if (!entry.desc?.trim()) {
      if (log) console.warn('[ledger] texting memory has no description — dropping it.')
      continue
    }
    if (seen.has(charId)) {
      if (log) console.warn(`[ledger] a second texting memory for "${entry.charKey}" — dropping it.`)
      continue
    }
    seen.add(charId)
    kept.push({ charId, type: entry.type, desc: storedMemoryDesc(entry.desc) })
  }

  return kept
}

/**
 * Every kiss and every night the ledger reported, resolved to charIds: a row naming nobody
 * the save holds is dropped, a pairing reported twice is one row, and public beats private.
 */
export function ledgerActs(ledger: LedgerResponse | null, log = true): IntimateAct[] {
  if (!ledger) return []
  const { charKeyToId } = useGameStore.getState()
  const kinds = new Set<string>(ACT_KINDS.map(([kind]) => kind))
  const byPairing = new Map<string, IntimateAct>()

  for (const entry of ledger.acts ?? []) {
    if (!kinds.has(entry?.kind)) {
      if (log) console.warn(`[ledger] act kind "${String(entry?.kind)}" is not valid — dropping it.`)
      continue
    }
    const charIds: string[] = []
    for (const charKey of entry.chars ?? []) {
      const charId = charKeyToId[charKey ?? '']
      if (!charId) {
        if (log)
          console.warn(`[ledger] act names unknown character "${charKey}" — leaving her out of it.`)
        continue
      }
      if (!charIds.includes(charId)) charIds.push(charId)
    }
    if (charIds.length === 0) {
      if (log) console.warn('[ledger] act with nobody identifiable in it — dropping it.')
      continue
    }
    const pairing = `${entry.kind}|${[...charIds].sort().join('|')}`
    const held = byPairing.get(pairing)
    // Seen once is seen: the same pairing reported twice is one act, public if either row was.
    if (held) {
      if (entry.inPublic === true) held.inPublic = true
      continue
    }
    byPairing.set(pairing, { kind: entry.kind, inPublic: entry.inPublic === true, charIds })
  }

  return [...byPairing.values()]
}

/**
 * The ledger's milestones, minus the rows that cannot be filed, grouped per character, with
 * what the acts imply folded in: each girl in one passed that milestone, and everybody in a
 * group act has agreed to share him.
 */
function ledgerEvents(ledger: LedgerResponse, log = true): Map<string, RelationshipEvent[]> {
  const { charKeyToId } = useGameStore.getState()
  const byChar = new Map<string, RelationshipEvent[]>()

  for (const entry of ledger.events ?? []) {
    const charId = charKeyToId[entry?.charKey ?? '']
    if (!charId) {
      if (log) console.warn(`[ledger] event for unknown character "${entry?.charKey}" — dropping it.`)
      continue
    }
    if (!isRelationshipEvent(entry.event)) {
      if (log) console.warn(`[ledger] event "${String(entry.event)}" is not valid — dropping it.`)
      continue
    }
    if (entry.event === 'kissed' || entry.event === 'sex') {
      if (log)
        console.warn(
          `[ledger] "${entry.event}" reported as an event rather than an act — dropping it.`
        )
      continue
    }
    const existing = byChar.get(charId)
    if (existing) existing.push(entry.event)
    else byChar.set(charId, [entry.event])
  }

  const add = (charId: string, event: RelationshipEvent): void => {
    const existing = byChar.get(charId)
    if (!existing) byChar.set(charId, [event])
    else if (!existing.includes(event)) existing.push(event)
  }

  for (const act of ledgerActs(ledger, false)) {
    for (const charId of act.charIds) add(charId, act.kind === 'sex' ? 'sex' : 'kissed')
    // Nobody in a kiss or a night two girls were both part of can be jealous of the other.
    if (act.charIds.length > 1) {
      for (const charId of act.charIds) add(charId, 'agreed_to_harem')
    }
  }

  return byChar
}

/** How a status line names a character: masked the same way the name box masks a speaker. */
function statusNameOf(charId: string): string {
  const game = useGameStore.getState()
  const character = game.characters[charId]
  if (!character) return UNKNOWN_NAME
  return game.charInfo[charId]?.nameKnown ? character.firstName : UNKNOWN_NAME
}

/**
 * What each girl took away from the slot, as narrator lines after the stat messages: memories,
 * texting, gift landings, then what she's still waiting for. `stats` is post-scene (what the
 * crush roll reads); `ignored`/`turnedDown` are who waited on an invitation and who got a no.
 */
export function memoryStatusLines(
  ledger: LedgerResponse | null,
  stats: PlayerStats,
  gifts: readonly SceneGift[],
  ignored: readonly string[],
  turnedDown: readonly string[]
): SceneLine[] {
  const texted = new Map(
    (ledger ? ledgerTextMemories(ledger, false) : []).map((entry) => [entry.charId, entry])
  )
  const given = [...gifts]
  const lines: SceneLine[] = []

  /** Her presents, in the order he gave them, spent as they are said. */
  const giftLinesFor = (charId: string): SceneLine[] => {
    const hers = given.filter((gift) => gift.charId === charId)
    for (const gift of hers) given.splice(given.indexOf(gift), 1)
    return hers.map((gift) => giftStatusMarkedLine(statusNameOf(gift.charId), gift.reaction))
  }

  const scene = ledger ? ledgerMemories(ledger, false) : []
  scene.forEach((entry, index) => {
    lines.push(memoryStatusLine(entry))
    // After the *last* of hers, so two scene memories are not split by the phone.
    const more = scene.slice(index + 1).some((later) => later.charId === entry.charId)
    if (more) return
    const text = texted.get(entry.charId)
    if (text) {
      texted.delete(entry.charId)
      lines.push(textMemoryStatusLine(text))
    }
    lines.push(...giftLinesFor(entry.charId))
    // Last of all of hers, and only for a girl who was actually in the scene.
    const hint = crushStatusLine(entry.charId, stats)
    // Plain: its stat word is coloured downstream, where the three hues are known.
    if (hint) lines.push({ speaker: '', text: hint })
  })

  for (const entry of texted.values()) lines.push(textMemoryStatusLine(entry))
  // The invitation he spent the slot not answering, said in the same words it was recorded in.
  for (const charId of ignored)
    lines.push(memoryLineOf(statusNameOf(charId), { type: 'disliked', desc: IGNORED_TEXT_DESC }))
  // The invitation he did answer, and said no to.
  for (const charId of turnedDown)
    lines.push(memoryLineOf(statusNameOf(charId), { type: 'disliked', desc: TURNED_DOWN_DESC }))
  // A present to a girl the ledger left nothing about still lands, at the end.
  for (const gift of given)
    lines.push(giftStatusMarkedLine(statusNameOf(gift.charId), gift.reaction))
  return lines
}

/**
 * What she is still waiting for him to be, or that he finally is — one line
 * for a girl with nothing going on with him yet. Records what it said: owed once per tier.
 */
function crushStatusLine(charId: string, stats: PlayerStats): string | null {
  const game = useGameStore.getState()
  const character = game.characters[charId]
  if (!character) return null

  const info = game.charInfo[charId]
  const flags = info?.flags ?? emptyFlags()
  // Nothing to advise somebody already past the roll this is about.
  if (flags.isLover || flags.hasCrush || flags.benefits) return null

  const update = crushHintUpdate(statusNameOf(charId), character, stats, info?.crushHint)
  // Written as the line is queued, for `spendMoney`'s reason.
  if (update.hint !== info?.crushHint) game.setCrushHint(charId, update.hint)
  return update.line
}

/** One memory as the player reads it, and the base its texting sibling extends. */
function memoryStatusLine(entry: ValidMemory): SceneLine {
  return memoryLineOf(statusNameOf(entry.charId), entry)
}

/**
 * What this slot's texting left one girl with, in a scene memory's words plus the one clause
 * that says where it came from.
 */
function textMemoryStatusLine(entry: ValidMemory): SceneLine {
  return memoryLineOf(statusNameOf(entry.charId), {
    type: entry.type,
    desc: overTextDesc(entry.desc)
  })
}

/**
 * Who came out of the scene liking the reader — the cast members whose memories of it are
 * worth more than they cost.
 */
export function bondedCharIds(ledger: LedgerResponse | null): string[] {
  if (!ledger) return []
  const byChar = new Map<string, CharMemory[]>()
  for (const entry of ledgerMemories(ledger, false)) {
    const memory: CharMemory = { date: 0, type: entry.type, desc: entry.desc }
    const kept = byChar.get(entry.charId)
    if (kept) kept.push(memory)
    else byChar.set(entry.charId, [memory])
  }
  return [...byChar.entries()]
    .filter(([, memories]) => affectionOf(memories, 0) > 0)
    .map(([charId]) => charId)
}

/**
 * Every girl the ledger left a `liked` or a `loved` — the gate the crush roll opens on.
 * Not {@link bondedCharIds}, whose net a `hated` cancels; a texting memory reaches neither.
 */
export function likedCharIds(ledger: LedgerResponse | null): string[] {
  if (!ledger) return []
  const kept: string[] = []
  for (const entry of ledgerMemories(ledger, false)) {
    if (entry.type !== 'liked' && entry.type !== 'loved') continue
    if (!kept.includes(entry.charId)) kept.push(entry.charId)
  }
  return kept
}

/** What the scene changed between the reader and one girl — one modal's worth. */
export interface MilestoneReport {
  charId: string
  /** Masked exactly as a speaker is: `???` until he can name her. */
  name: string
  lines: string[]
  /** She friendzoned him, he friendzoned her, or they broke up — broken wins. */
  negative: boolean
  /** The face the screen draws her with, off the same diff as the sentences. */
  emotion: Emotion
}

/**
 * What the scene changed for each girl, in roster order: flags before the scene against after
 * its own folds, before the dating pass runs. Excluded: a lover the pass drops or folds into an
 * open relationship (she finds out, not a scene event), and a girl nothing moved for.
 */
export function milestoneReports(projected: ProjectedLedger): MilestoneReport[] {
  const { chars, charInfo } = useGameStore.getState()
  const reports: MilestoneReport[] = []

  for (const charId of chars) {
    const before = charInfo[charId]?.flags ?? emptyFlags()
    const after = projected.scene[charId]?.flags ?? before
    const lines = milestoneLinesFor(statusNameOf(charId), before, after)
    if (lines.length === 0) continue
    reports.push({
      charId,
      name: statusNameOf(charId),
      lines,
      negative: milestoneSoured(before, after),
      emotion: milestoneEmotionOf(before, after)
    })
  }

  return reports
}

/**
 * What the dating pass folds over, off the store both of its callers share. Re-run at the
 * boundary rather than banked at the ending, since nothing in between moves `isLover`, `harem`
 * or `hasCrush` — texting only writes `blocked`, `gaveContactInfo` and text memories.
 */
function datingInputOf(
  before: Readonly<Record<string, CharInfo>>,
  after: Readonly<Record<string, CharInfo>>,
  date: number
): DatingPassInput {
  const game = useGameStore.getState()
  const firstNames: Record<string, string> = {}
  for (const charId of game.chars) {
    const character = game.characters[charId]
    if (character) firstNames[charId] = character.firstName
  }
  return {
    roster: game.chars,
    before,
    after,
    firstNames,
    npcRelationships: game.npcRelationships,
    date
  }
}

/**
 * Applies a finished scene's ledger — memories, then milestones, then who the campus now
 * takes the reader to be dating.
 */
export function applyLedger(ledger: LedgerResponse): DatingPassOutcome {
  const game = useGameStore.getState()
  // Taken before anything writes: the dating pass is a diff across the whole apply.
  const before = game.charInfo

  // Strictly `true`: never a truthy string a model improvised. Latched, not
  // assigned, so the boundary replay is idempotent.
  if (ledger.expelled === true) {
    console.log('[ledger] expelled: caught at an expellable offense')
    game.setExpelled()
  }

  for (const entry of ledgerMemories(ledger)) {
    game.recordMemory(entry.charId, { date: game.date, type: entry.type, desc: entry.desc })
  }

  // Still the finished slot's date: `advanceSlot` runs later in the boundary.
  // Replaces rather than appends — the phone holds one impression.
  for (const entry of ledgerTextMemories(ledger)) {
    game.setTextMemory(entry.charId, { date: game.date, type: entry.type, desc: entry.desc })
  }

  for (const [charId, events] of ledgerEvents(ledger)) {
    console.log(`[ledger] ${charId}: ${events.join(', ')}`)
    // Ahead of the fold, so `addContact` still sees the flag unset and posts its line, unread.
    if (events.includes('gave_contact_info')) addContact(charId, 1)
    // Its mirror, ahead of the fold so `unblockContact` still sees the block standing.
    if (events.includes('unblocked')) unblockContact(charId, 1)
    useGameStore.getState().applyRelationshipEvents(charId, events)
  }

  // Every kiss and every night counted once per act: the boundary replays from the save before
  // it, so this lands once however often it runs.
  game.recordActs(ledgerActs(ledger, false))

  const dating = settleDating(datingInputOf(before, useGameStore.getState().charInfo, game.date))
  useGameStore.getState().applyDatingSettle(dating)
  return dating
}

/**
 * The projection {@link projectLedger} hands back: the map after the dating pass, the same map
 * before it (what {@link milestoneReports} diffs against), and the lovers the reader left, whose
 * breakup texts the next opening writes.
 */
export interface ProjectedLedger {
  charInfo: Record<string, CharInfo>
  /** The map as the ledger's rows and relationship events leave it, before the dating pass. */
  scene: Record<string, CharInfo>
  breakups: DatingPassOutcome['breakups']
}

/**
 * The `charInfo` map exactly as {@link applyLedger} will leave it — a projection by value, taken
 * at the ending for the slot opening.
 */
export function projectLedger(
  charInfo: Readonly<Record<string, CharInfo>>,
  ledger: LedgerResponse,
  date: number
): ProjectedLedger {
  const projected: Record<string, CharInfo> = { ...charInfo }
  const entryFor = (charId: string): CharInfo => projected[charId] ?? blankCharInfo()

  // `log` is off on all three seams: the boundary's apply already warns about a dropped row.
  for (const entry of ledgerMemories(ledger, false)) {
    const info = entryFor(entry.charId)
    projected[entry.charId] = {
      ...info,
      memories: [...info.memories, { date, type: entry.type, desc: entry.desc }].slice(-MEMORY_CAP)
    }
  }

  for (const entry of ledgerTextMemories(ledger, false)) {
    projected[entry.charId] = {
      ...entryFor(entry.charId),
      textMemory: { date, type: entry.type, desc: entry.desc }
    }
  }

  // Last, like the apply, so the cap evicts in the same order.
  for (const [charId, events] of ledgerEvents(ledger, false)) {
    projected[charId] = foldRelationshipEvents(entryFor(charId), events, date)
  }

  const dating = settleDating(datingInputOf(charInfo, projected, date))
  return {
    charInfo: { ...projected, ...dating.charInfo },
    scene: projected,
    breakups: dating.breakups
  }
}
