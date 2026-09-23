import { useRef, useState, type CSSProperties, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { CheckField } from '../components/CheckField'
import { ChipListInput } from '../components/ChipListInput'
import { ConfirmModal } from '../components/ConfirmModal'
import { DeadNote } from '../components/DeadNote'
import { LandscapeTile } from '../components/LandscapeTile'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { SelectField } from '../components/SelectField'
import { TagSelect } from '../components/TagSelect'
import { TextField } from '../components/TextField'
import { WardrobeColumn, type WardrobeColumnProps } from '../components/WardrobeColumn'
import type { SetControlProps } from '../components/SetControl'
import { DESKTOP_ONLY_NOTE, isWebBuild } from '../platform'
import {
  clampVoicePitch,
  VOICE_PITCH_DEFAULT,
  VOICE_PITCH_MAX,
  VOICE_PITCH_MIN
} from '@shared/audio'
import { EMOTIONS } from '@shared/emotions'
import {
  cgDraft,
  cgSetDraft,
  expressionDraft,
  spriteDraft,
  type PromptEdit
} from '@shared/imagePrompt'
import {
  CUSTOM_OUTFIT_NAME_MAX,
  CUSTOM_OUTFIT_SLOTS,
  customSlotNumber,
  isCustomOutfitSlot,
  outfitLabelOf
} from '@shared/outfits'
import { isStatKey, type StatKey } from '@shared/playerStats'
import { POSITIONS } from '@shared/positions'
import { ROOM_PROMPT_LEAD, ROOM_VARIANTS } from '@shared/room'
import { pictureKeySet } from '@shared/settingsRules'
import { sfwWithholds } from '@shared/sfw'
import { isGiftCategory } from '@shared/shop'
import type { GiftCategory } from '@shared/shop'
import { isCharacterTrait } from '@shared/traits'
import type { CharacterTrait } from '@shared/traits'
import { fullNameOf } from '@shared/types'
import type {
  Character,
  CharacterBehavior,
  CustomOutfitSlot,
  Emotion,
  OutfitSet,
  SetTarget,
  WardrobeLayer
} from '@shared/types'
import { useAssetStore } from '../stores/assetStore'
import { useAudioStore } from '../stores/audioStore'
import {
  cgTargetFor,
  doneCountOf,
  expressionTargetFor,
  isInFlight,
  liveCgTasks,
  liveExpressionTasks,
  liveTaskFor,
  profileUrl,
  roomUrl,
  seedPrefillFor,
  stagedOf,
  useCharacterStore,
  useSpriteVersion,
  type RenderMode,
  type RenderTarget,
  type RenderTask
} from '../stores/characterStore'
import { renameMentions } from '../stores/renameMentions'
import { noNsfwImagesOf, useSettingsStore } from '../stores/settingsStore'
import { useSetupStore } from '../stores/setupStore'
import {
  BEHAVIOR_FIELDS,
  GIFT_CATEGORY_OPTIONS,
  listText,
  PREFERRED_STAT_OPTIONS,
  TAG_FIELDS,
  textList,
  TRAIT_OPTIONS,
  WARDROBES
} from './characterFields'
import { DuplicateIcon, FolderIcon } from './characterIcons'
import { CustomOutfitsModal } from './CustomOutfitsModal'
import { ImageGalleryModal } from './ImageGalleryModal'
import { ProfilePictureModal } from './ProfilePictureModal'
import { RegenerateModal, type GroupKey, type SeedPrefill } from './RegenerateModal'
import { SetHeightModal } from './SetHeightModal'
import { FingerFixModal } from './FingerFixModal'
import { TransparencyFixModal } from './TransparencyFixModal'
import {
  chipPress,
  gestures,
  lift,
  panelUnderTab,
  peek,
  portraitLift,
  press,
  quietLift,
  quietPress,
  rowLift,
  rowPress,
  tuck,
  veilIn
} from './motion'
import { DownloadIcon } from './screenIcons'
import '../vu_styles/EditCharacter.css'

export interface EditCharacterModalProps {
  character: Character
  /** Day or night, drawn by the screen that opened this — a portal inherits neither. */
  theme: 'day' | 'night'
  onClose: () => void
}

/**
 * What a gated control was about to do, in the words the confirm completes: "Save changes and
 * {verb}?".
 */
type PendingVerb = 'generate' | 'regenerate' | 'export' | 'duplicate'

/** Why each gated control needs the character saved first, in its own words. */
const PENDING_MESSAGE: Record<PendingVerb, string> = {
  generate:
    'This character has unsaved changes. Save them first before generation.',
  regenerate:
    'This character has unsaved changes. Save them first before generation.',
  export:
    'This character has unsaved changes. Save them first before exporting.',
  duplicate:
    'This character has unsaved changes. Save them first before duplicating.'
}

/** A control the dirty gate is holding, and what to run once the save lands. */
interface PendingAction {
  verb: PendingVerb
  run: () => void
}

/** One render the tag modal is open on, and everything that modal draws itself from. */
interface RegenerateRequest {
  target: RenderTarget
  title: string
  edit: PromptEdit
  seed: SeedPrefill
  /** Asks for a name too, where the set is being made rather than replaced. */
  name?: { value: string; placeholder: string; maxLength: number }
  /** A group the render cannot be sent without. */
  requireGroup?: GroupKey
  /** The primary's words, where the render is not a replacement. */
  submitLabel?: string
}

/** True for a whole-set target: the single-image forms name what they are in front of the key. */
function isSetTarget(target: RenderTarget): target is SetTarget {
  return !target.startsWith('cg:') && !target.startsWith('expression:')
}

/**
 * Every editable field, in one object. One state rather than twenty, because a save has to
 * **re-seed the whole form** from what was written — a field left out of that reset would read
 * as dirty forever.
 */
interface Form {
  firstName: string
  lastName: string
  personality: string
  backstory: string
  datingHistory: string
  datingPreference: string
  kinks: string
  isVirgin: boolean
  /** Likes and dislikes are edited one per line, so they are text until Save. */
  likes: string
  dislikes: string
  behavior: CharacterBehavior
  traits: CharacterTrait[]
  preferredStat: StatKey
  giftLiked: GiftCategory[]
  giftDisliked: GiftCategory[]
  baseAppearance: string[]
  outfit: string[]
  peOutfit: string[]
  swimOutfit: string[]
  negativeTags: string[]
  roomPrompt: string
  height: number
  voicePitch: number
}

function formOf(character: Character): Form {
  return {
    firstName: character.firstName,
    lastName: character.lastName,
    personality: character.personality,
    backstory: character.backstory,
    datingHistory: character.datingHistory,
    datingPreference: character.datingPreference,
    kinks: character.kinks,
    isVirgin: character.isVirgin,
    likes: listText(character.likes),
    dislikes: listText(character.dislikes),
    behavior: character.behavior,
    traits: [...character.traits],
    preferredStat: character.preferredStat,
    giftLiked: [...character.giftPreferences.liked],
    giftDisliked: [...character.giftPreferences.disliked],
    baseAppearance: [...character.baseAppearance],
    outfit: [...character.outfit],
    peOutfit: [...character.peOutfit],
    swimOutfit: [...character.swimOutfit],
    negativeTags: [...(character.negativeTags ?? [])],
    roomPrompt: character.roomPrompt,
    height: character.height,
    voicePitch: character.voicePitch ?? VOICE_PITCH_DEFAULT
  }
}

/** Which side of centre a voice sits on, for a control that never shows its own figure. */
function voiceReading(pitch: number): string {
  if (pitch < 0) return 'lower'
  if (pitch > 0) return 'higher'
  return 'centre'
}

/** A character's images on the left, everything written about her on the right. */
export function EditCharacterModal({
  character,
  theme,
  onClose
}: EditCharacterModalProps): JSX.Element | null {
  const charId = character.charId
  const [form, setForm] = useState(() => formOf(character))
  const [editingName, setEditingName] = useState(false)
  const [sizing, setSizing] = useState(false)
  const [gallery, setGallery] = useState(false)
  const [roomGallery, setRoomGallery] = useState(false)
  const [customs, setCustoms] = useState(false)
  // Which player-authored wardrobe the delete confirm is standing in front of.
  const [deleting, setDeleting] = useState<CustomOutfitSlot | null>(null)
  const [fixing, setFixing] = useState<{
    set: OutfitSet | null
    title: string
    kind: WardrobeLayer
  } | null>(null)
  const [framing, setFraming] = useState(false)
  // Whether the portrait is being pointed at, which is what raises the mark over it.
  const [overPortrait, setOverPortrait] = useState(false)
  const [confirmSet, setConfirmSet] = useState<{ target: SetTarget; mode: RenderMode } | null>(null)
  const [regen, setRegen] = useState<RegenerateRequest | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [working, setWorking] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [closing, setClosing] = useState(false)

  const setField =
    <K extends keyof Form>(key: K) =>
    (value: Form[K]): void =>
      setForm((prev) => ({ ...prev, [key]: value }))

  const setBehaviorField = (key: keyof CharacterBehavior) => (value: string) =>
    setForm((prev) => ({ ...prev, behavior: { ...prev.behavior, [key]: value } }))

  // The voice the last preview played, seeded with the one she has: a release that left the
  // slider where it was — tabbing onto it, closing the modal off it — plays nothing.
  const previewedVoice = useRef(form.voicePitch)

  /** Reads a voice out when the slider is let go of, at the pitch it has been left at. */
  const previewVoice = (value: number): void => {
    const pitch = clampVoicePitch(value)
    if (previewedVoice.current === pitch) return
    previewedVoice.current = pitch
    const breath = useSettingsStore.getState().settings?.noNsfwSound !== true
    useAudioStore.getState().previewVoice(pitch, breath)
  }

  const expressions = useCharacterStore((s) => s.expressions)
  const cgs = useCharacterStore((s) => s.cgs[charId])
  const rooms = useCharacterStore((s) => s.rooms[charId])
  const outfits = useCharacterStore((s) => s.outfits[charId])
  const staged = useCharacterStore((s) => s.staged)
  const version = useSpriteVersion(charId)
  const progress = useCharacterStore((s) => s.progress[charId])
  const save = useCharacterStore((s) => s.save)
  const generateSet = useCharacterStore((s) => s.generateSet)
  const cancelSet = useCharacterStore((s) => s.cancelSet)
  const writeCustomOutfit = useCharacterStore((s) => s.writeCustomOutfit)
  const deleteCustomOutfit = useCharacterStore((s) => s.deleteCustomOutfit)
  const exportCharacter = useCharacterStore((s) => s.exportCharacter)
  const duplicateCharacter = useCharacterStore((s) => s.duplicateCharacter)
  const openFolder = useCharacterStore((s) => s.openFolder)
  // The same gate the new-character slot uses: rendering needs the optional install.
  const comfyInstalled = useSetupStore((s) => s.status?.comfyReady ?? false)
  const comfyDeferred = useSettingsStore((s) => s.settings?.comfyDeferred ?? false)
  // The room renders in the cloud, so its gate is whichever key draws the pictures.
  const picturesReady = useSettingsStore((s) => (s.settings ? pictureKeySet(s.settings) : false))
  // Under a custom endpoint that key is a second one, asked for by a name of its own.
  const customWriter = useSettingsStore((s) => s.settings?.apiProvider === 'openai')
  // Withholds the nude wardrobe and the CGs outright: neither viewable nor renderable under it.
  const noNsfwImages = useSettingsStore(noNsfwImagesOf)

  // The browser ships no local renderer, so nothing it drives can ever be reached from here.
  const webBuild = isWebBuild()

  /** Whether the local renderer is out of reach, which every ComfyUI job in here waits on. */
  const comfyMissing = webBuild || !comfyInstalled || comfyDeferred

  /* What a hover raises over a control these are holding dead: the one thing the player would
     have to go and get, and nothing the moment he has it. A control dead for anything else —
     the default sprites, an empty room prompt, a repair with nothing to paint over, a render
     already going — stays silent, as every dead control does. */
  const comfyNote = webBuild ? DESKTOP_ONLY_NOTE : comfyMissing ? 'Requires ComfyUI' : null

  /* The generation disclosure holds the booru tags a local render reads and the cloud room's
     own prompt. Where there is no local renderer it holds the prompt alone, and a prompt the
     cloud reads is not waiting on an install, so there it opens like any other panel. */
  const advancedShut = comfyMissing && !webBuild
  const keyNote = picturesReady ? null : customWriter ? 'Requires Gemini key' : 'Requires API key'

  const defaultsPresent = doneCountOf(expressions, charId) === EMOTIONS.length
  const roomOnDisk = ROOM_VARIANTS.filter((variant) => rooms?.[variant]).length

  /** How many of one wardrobe's seven sprites are on disk. */
  const wardrobeDone = (set: OutfitSet | null): number =>
    set === null
      ? doneCountOf(expressions, charId)
      : EMOTIONS.filter((emotion) => outfits?.[set]?.[emotion]).length

  /** This set's bucket in the run, if it has one — running or waiting its turn. */
  const taskOf = (target: SetTarget): RenderTask | undefined => liveTaskFor(progress, target)

  /** True while this set is being replaced rather than filled or left alone. */
  const regenerating = (target: SetTarget): boolean => Boolean(taskOf(target)?.staged)

  /** The count beside a set's title. */
  const shownDone = (target: SetTarget, onDisk: number): number =>
    regenerating(target) ? (taskOf(target)?.done ?? 0) : onDisk

  /** Which of a set's images to show: the staged ones during a regenerate, else what is on disk. */
  const presentOf = (
    target: SetTarget,
    onDisk: Record<string, boolean> | undefined
  ): Record<string, boolean> | undefined =>
    regenerating(target) ? stagedOf(staged, charId, target) : onDisk

  /** One wardrobe's sprites being re-rolled one at a time right now. */
  const singleExpressions = (set: OutfitSet | null): Emotion[] => liveExpressionTasks(progress, set)

  /** Whether a set cannot be rendered right now. Where the install or the key is what it is
      short of, the control raises that beside it; a set waiting on the default sprites says
      nothing. */
  const setBlocked = (target: SetTarget): boolean => {
    // The room is a cloud render, gated on the picture key alone.
    if (target === 'room') return !picturesReady || !character.roomPrompt.trim()
    if (comfyMissing) return true
    return target !== 'default' && !defaultsPresent
  }

  /** Whether a wardrobe cannot be repaired right now — the link says nothing about it. */
  const fixBlocked = (target: SetTarget, set: OutfitSet | null): boolean => {
    if (taskOf(target)) return true
    // A repair paints over sprites a single re-roll is about to rewrite.
    if (singleExpressions(set).length > 0) return true
    const neutral = set === null ? expressions[charId]?.neutral : outfits?.[set]?.neutral
    return !neutral
  }

  /* The hand repair is the transparency repair plus a render, so it owes the render's gate
     as well as the repair's: the fix itself is a ComfyUI job. */
  const fingersBlocked = (target: SetTarget, set: OutfitSet | null): boolean =>
    comfyMissing || fixBlocked(target, set)

  // The portrait is a slice of the default neutral, so it is gated on the same things the
  // repair is, and it says nothing about any of them: none is a prerequisite the player can
  // go and get.
  const portraitBlocked =
    Boolean(taskOf('default')) ||
    singleExpressions(null).length > 0 ||
    !expressions[charId]?.neutral

  /** The character as the form has her — what Save writes and what `dirty` compares against. */
  const buildNext = (): Character => {
    const next: Character = {
      ...character,
      firstName: form.firstName,
      lastName: form.lastName,
      personality: form.personality,
      backstory: form.backstory,
      datingHistory: form.datingHistory,
      datingPreference: form.datingPreference,
      kinks: form.kinks,
      isVirgin: form.isVirgin,
      likes: textList(form.likes),
      dislikes: textList(form.dislikes),
      behavior: form.behavior,
      traits: form.traits,
      preferredStat: form.preferredStat,
      giftPreferences: { liked: form.giftLiked, disliked: form.giftDisliked },
      baseAppearance: form.baseAppearance,
      outfit: form.outfit,
      peOutfit: form.peOutfit,
      swimOutfit: form.swimOutfit,
      height: form.height,
      negativeTags: form.negativeTags,
      roomPrompt: form.roomPrompt,
      voicePitch: form.voicePitch
    }
    // Absent and empty mean the same thing, so an empty list is left out of character.json.
    if (next.negativeTags?.length === 0) delete next.negativeTags
    // Likewise absent and centre, so a voice nobody moved is left out too.
    if (next.voicePitch === 0) delete next.voicePitch
    return next
  }

  /** Whether the form holds anything the saved character does not. */
  const dirty = JSON.stringify(buildNext()) !== JSON.stringify(character)

  /** Writes the form. Answers whether it landed, since callers act on that. */
  const persist = async (): Promise<boolean> => {
    // A rename is carried through her own prose in the same write.
    const next = renameMentions(buildNext(), character)
    const ok = await save(next)
    if (ok) {
      setSaved(true)
      // Re-seeded from what was written, not from the form: the rename may have rewritten
      // fields nobody typed in, and `dirty` compares the form against the character as saved.
      setForm(formOf(next))
      setEditingName(false)
    }
    return ok
  }

  /** The gate in front of leaving, asked on Cancel, on Escape and on an outside click alike. */
  const requestClose = (): void => {
    if (dirty) setClosing(true)
    else onClose()
  }

  /** The one gate in front of everything that consumes the character *as saved*. */
  const guardDirty = (verb: PendingVerb, run: () => void): void => {
    if (!dirty) {
      run()
      return
    }
    setPending({ verb, run })
  }

  /** Writes the character out as a zip; the dialog and the zip both live in main. */
  const runExport = (): void => {
    setExporting(true)
    void exportCharacter(charId).finally(() => setExporting(false))
  }

  /**
   * Copies her folder under a fresh id; the copy joins the grid behind this modal, which
   * stays on the original.
   */
  const runDuplicate = (): void => {
    setDuplicating(true)
    void duplicateCharacter(charId).finally(() => setDuplicating(false))
  }

  /** Saves, then does the thing that was asked for; a failed save does neither. */
  const confirmPending = (): void => {
    const action = pending
    if (action === null) return
    setWorking(true)
    void persist().then((ok) => {
      setWorking(false)
      setPending(null)
      if (ok) action.run()
    })
  }

  /** Throws one player-authored wardrobe away, its sprites and its record entry alike. */
  const runDelete = (): void => {
    const slot = deleting
    if (slot === null) return
    setWorking(true)
    void deleteCustomOutfit(charId, slot).finally(() => {
      setWorking(false)
      setDeleting(null)
    })
  }

  /** CGs being re-rolled one at a time right now. */
  const singleCgs = liveCgTasks(progress)

  /** The four sprite wardrobes by target, for the two things that address one by name. */
  const wardrobeOf = (target: SetTarget): (typeof WARDROBES)[number] | undefined =>
    WARDROBES.find((entry) => entry.target === target)

  /** Which wardrobe a target addresses; the default one and the landscape sets have none. */
  const setOfTarget = (target: SetTarget): OutfitSet | null =>
    target === 'default' || target === 'cgs' || target === 'room' ? null : target

  /** What a confirm calls the set it is about to replace. */
  const setLabel = (target: SetTarget): string =>
    isCustomOutfitSlot(target)
      ? outfitLabelOf(character, target)
      : (wardrobeOf(target)?.title ?? (target === 'cgs' ? 'NSFW CG' : 'Room BG'))

  /** Every image inside one set that is being re-rolled on its own right now. */
  const liveSinglesOf = (target: SetTarget): RenderTarget[] => {
    if (target === 'cgs') return singleCgs.map(cgTargetFor)
    if (target === 'room') return []
    const set = setOfTarget(target)
    return singleExpressions(set).map((emotion) => expressionTargetFor(emotion, set))
  }

  /** Stops every single re-roll inside one set, so a render of the whole set lands over them. */
  const cancelSingles = (target: SetTarget): void => {
    // No await between the two: `cancelSet` flags the bucket before its round
    // trip, so the set queued here is already behind a cancelled one.
    for (const single of liveSinglesOf(target)) void cancelSet(charId, single)
  }

  /** Opens the tag modal on one render, built from the character as the store holds her now. */
  const openRegenerate = (
    build: (character: Character, poseTags: readonly string[]) => RegenerateRequest
  ): void => {
    // Read fresh out of the store, never off `character`: the dirty gate may have just saved,
    // and the closure this runs from still holds the character as she was typed over.
    const current = useCharacterStore.getState().characters[charId]
    if (!current) return
    const poseTags = useAssetStore.getState().poses[current.pose]?.tags ?? []
    setRegen(build(current, poseTags))
  }

  /** What a set's control runs: a fill goes straight out, a regenerate opens on its tags first. */
  const runSet = (target: SetTarget, mode: RenderMode): void => {
    /* A player-authored wardrobe with nothing in it is written before it is rendered: there
       are no stored tags for a fill to dress her in, so its first run opens the modal too. */
    const fresh = isCustomOutfitSlot(target) && wardrobeDone(target) === 0
    // A fill replaces nothing, and the room's prompt is prose rather than booru tags, so
    // neither has a set of groups for the modal to open on.
    if (!fresh && (mode === 'fill' || target === 'room')) {
      cancelSingles(target)
      void generateSet(charId, target, mode)
      return
    }
    if (isCustomOutfitSlot(target)) {
      const slot = target
      openRegenerate((current, poseTags) => ({
        target: slot,
        title: fresh ? 'Generate custom outfit' : `Regenerate ${outfitLabelOf(current, slot)}`,
        edit: spriteDraft(current, poseTags, slot),
        seed: seedPrefillFor(current, slot),
        // A wardrobe with no clothes in it is the one render the tags are the whole point of.
        requireGroup: 'outfit',
        ...(fresh
          ? {
              name: {
                value: current.customOutfits?.[slot]?.name ?? '',
                placeholder: `Custom outfit ${customSlotNumber(slot)}`,
                maxLength: CUSTOM_OUTFIT_NAME_MAX
              },
              submitLabel: 'Generate'
            }
          : {})
      }))
      return
    }
    if (target === 'cgs') {
      openRegenerate((current) => ({
        target: 'cgs',
        title: 'Regenerate NSFW CG',
        edit: cgSetDraft(current),
        seed: seedPrefillFor(current, 'cgs')
      }))
      return
    }
    const wardrobe = wardrobeOf(target)
    if (!wardrobe) return
    const spriteTarget = target
    openRegenerate((current, poseTags) => ({
      target: spriteTarget,
      title: `Regenerate ${wardrobe.title}`,
      edit: spriteDraft(current, poseTags, wardrobe.set),
      seed: seedPrefillFor(current, spriteTarget)
    }))
  }

  const control = (target: SetTarget, onDisk: number, total: number): SetControlProps => {
    const blocked = setBlocked(target)
    const complete = onDisk === total
    return {
      id: `edit-generate-${target}`,
      onDisk,
      total,
      // Only a bucket still going to render reads as generating.
      task: taskOf(target),
      disabled: blocked,
      // Only the room's gate is the key; every other set is the install's.
      note: target === 'room' ? keyNote : comfyNote,
      // Generate fills the gaps, Regenerate replaces the set. Behind the
      // dirty gate, with the confirm over the single re-rolls inside it.
      onGenerate: () =>
        guardDirty(complete ? 'regenerate' : 'generate', () => {
          const mode: RenderMode = complete ? 'regenerate' : 'fill'
          if (liveSinglesOf(target).length > 0) {
            setConfirmSet({ target, mode })
            return
          }
          runSet(target, mode)
        }),
      // Cancelling consumes nothing the player has written, so it skips the dirty gate.
      onCancel: () => void cancelSet(charId, target)
    }
  }

  /**
   * Sends one render the tag modal answered. A player-authored wardrobe's Outfit group is
   * written onto her record first, so a later fill dresses her in the clothes it holds; a
   * write that does not land queues nothing.
   */
  const sendRender = async (
    request: RegenerateRequest,
    edit: PromptEdit,
    seed: number | null,
    name?: string
  ): Promise<void> => {
    const target = request.target
    if (isCustomOutfitSlot(target) && edit.kind === 'sprite') {
      const entry = useCharacterStore.getState().characters[charId]?.customOutfits?.[target]
      const ok = await writeCustomOutfit(charId, target, {
        tags: edit.outfit,
        name: name ?? entry?.name
      })
      if (!ok) return
    }
    if (isSetTarget(target)) cancelSingles(target)
    await generateSet(charId, target, 'regenerate', { prompt: edit, seed })
  }

  /** Everything one wardrobe column is handed, stock or player-authored. */
  const columnFor = (
    target: SetTarget,
    set: OutfitSet | null,
    title: string
  ): WardrobeColumnProps => {
    const onDisk = wardrobeDone(set)
    const setControl = control(target, onDisk, EMOTIONS.length)
    // A set the setting withholds is offered no control and no repair — unless a
    // render of it is still going, whose Cancel stays reachable.
    const offered =
      sfwWithholds(target, noNsfwImages) && !taskOf(target)
        ? {}
        : {
            control: setControl,
            // No per-sprite re-roll while the whole set runs — its control is
            // where it stops — and none at all with no renderer to run it.
            onRegenerateExpression:
              comfyMissing || taskOf(target)
                ? undefined
                : (emotion: Emotion) =>
                    guardDirty('regenerate', () =>
                      openRegenerate((current) => ({
                        target: expressionTargetFor(emotion, set),
                        title: 'Regenerate expression',
                        edit: expressionDraft(current, emotion),
                        seed: seedPrefillFor(current, expressionTargetFor(emotion, set))
                      }))
                    ),
            onCancelExpression: (emotion: Emotion) =>
              void cancelSet(charId, expressionTargetFor(emotion, set)),
            liveExpressions: new Set(singleExpressions(set)),
            onFixTransparency: () => setFixing({ set, title, kind: 'fix' }),
            fixDisabled: fixBlocked(target, set),
            onFixFingers: () => setFixing({ set, title, kind: 'hands' }),
            fingersDisabled: fingersBlocked(target, set),
            fingersNote: comfyNote
          }

    /* What only a player-authored wardrobe offers: the plus that writes an empty slot, and —
       once the record holds one — the name it is called by and the way to throw it away. */
    const authored: Partial<WardrobeColumnProps> = {}
    if (isCustomOutfitSlot(target)) {
      const slot = target
      const entry = character.customOutfits?.[slot]
      if (onDisk === 0) {
        authored.onAdd = setControl.onGenerate
        // Dead on the render's own terms, and while a first run of it is already going.
        authored.addDisabled = setBlocked(slot) || Boolean(taskOf(slot))
      }
      if (entry) {
        authored.rename = {
          value: entry.name ?? '',
          placeholder: `Custom outfit ${customSlotNumber(slot)}`,
          max: CUSTOM_OUTFIT_NAME_MAX,
          onCommit: (name) => void writeCustomOutfit(charId, slot, { ...entry, name })
        }
        authored.onDelete = () => setDeleting(slot)
        authored.deleteDisabled = Boolean(taskOf(slot)) || singleExpressions(slot).length > 0
      }
    }

    return {
      charId,
      set,
      title,
      shownDone: shownDone(target, onDisk),
      total: EMOTIONS.length,
      present: presentOf(target, set === null ? expressions[charId] : outfits?.[set]),
      staged: regenerating(target),
      version,
      spoiler: set === 'nude',
      locked: set === 'nude' && noNsfwImages,
      lockedReason: 'Hidden by SFW setting',
      ...offered,
      ...authored
    }
  }

  const cgsOnDisk = POSITIONS.filter((position) => cgs?.[position]).length

  // The CGs' control is withheld on the wardrobe's terms: gone under the setting, kept while
  // a render of them is still going.
  const cgsWithheld = sfwWithholds('cgs', noNsfwImages) && !taskOf('cgs')

  const rendering = isInFlight(progress)

  /** How many of the five slots hold a whole wardrobe. */
  const customsOnDisk = CUSTOM_OUTFIT_SLOTS.filter(
    (slot) => wardrobeDone(slot) === EMOTIONS.length
  ).length

  const { host, overlayProps } = useModalShell(requestClose)
  if (!host) return null

  const name = fullNameOf({ firstName: form.firstName, lastName: form.lastName })

  return createPortal(
    <>
      <motion.div
        className="vu-veil"
        data-theme={theme}
        variants={veilIn}
        initial="hidden"
        animate="shown"
        exit="gone"
        {...overlayProps}
      >
        <motion.div
          id="edit-character"
          className="vu-sheet--wide vu-edit vu-paper"
          role="dialog"
          aria-modal="true"
          aria-label={`Edit ${name || 'character'}`}
          variants={panelUnderTab}
        >
          <TitleTab>Edit character</TitleTab>

          <div className="vu-edit-images">
            <div className="vu-edit-wardrobes">
              {WARDROBES.map(({ target, set, title }) => (
                <WardrobeColumn key={target} {...columnFor(target, set, title)} />
              ))}
            </div>

            {/* The landscape-image row: the custom wardrobes' own panel, then the room and
                the CGs, each opened behind its own circle. */}
            <div className="vu-edit-tiles">
              <LandscapeTile
                title="CUSTOM OUTFITS"
                what="custom outfits"
                mark="plus"
                label="Open custom outfits"
                auto
                shownDone={customsOnDisk}
                total={CUSTOM_OUTFIT_SLOTS.length}
                onShow={() => setCustoms(true)}
              />
              <LandscapeTile
                title="ROOM BG"
                what="the room"
                shownDone={shownDone('room', roomOnDisk)}
                total={ROOM_VARIANTS.length}
                thumbs={ROOM_VARIANTS.map((variant) =>
                  (regenerating('room') ? stagedOf(staged, charId, 'room') : rooms)?.[variant]
                    ? roomUrl(charId, variant, version, regenerating('room'))
                    : null
                )}
                control={control('room', roomOnDisk, ROOM_VARIANTS.length)}
                onShow={() => setRoomGallery(true)}
              />
              <LandscapeTile
                title="NSFW CG"
                what="the CGs"
                shownDone={shownDone('cgs', cgsOnDisk)}
                total={POSITIONS.length}
                control={cgsWithheld ? undefined : control('cgs', cgsOnDisk, POSITIONS.length)}
                onShow={() => setGallery(true)}
                showLocked={noNsfwImages}
                showLockedReason="Hidden by SFW setting"
                hug
              />
            </div>
          </div>

          <div className="vu-edit-rail">
            {/* Her portrait, her name and the pencil that renames her: the pencil sits against
                the name so it reads as the names' and not the row below's. */}
            <div className="vu-edit-name">
              <DeadNote note="Edit profile picture" align="center" below>
                <motion.button
                  id="edit-portrait"
                  className="vu-edit-portrait vu-arch vu-paper"
                  type="button"
                  aria-label="Edit profile picture"
                  disabled={portraitBlocked}
                  {...gestures(portraitBlocked, portraitLift, chipPress)}
                  onHoverStart={() => setOverPortrait(true)}
                  onHoverEnd={() => setOverPortrait(false)}
                  onFocus={() => setOverPortrait(true)}
                  onBlur={() => setOverPortrait(false)}
                  onClick={() => setFraming(true)}
                >
                  <span className="vu-crop">
                    <img className="vu-crop-img" src={profileUrl(charId, version)} alt="" />
                    {/* What the click does, said on the thing it does it to. A span rather than a
                        button: the portrait is already the control, and a button inside one is
                        invalid — this only marks it. */}
                    <motion.span
                      className="vu-circle vu-edit-portrait-mark"
                      aria-hidden="true"
                      initial={false}
                      animate={overPortrait && !portraitBlocked ? peek : tuck}
                    >
                      <CropIcon />
                    </motion.span>
                  </span>
                </motion.button>
              </DeadNote>

              {editingName ? (
                <div className="vu-edit-name-fields">
                  <TextField
                    id="edit-first-name"
                    label="First name"
                    value={form.firstName}
                    onChange={setField('firstName')}
                  />
                  <TextField
                    id="edit-last-name"
                    label="Last name"
                    value={form.lastName}
                    onChange={setField('lastName')}
                  />
                </div>
              ) : (
                <h2 className="vu-edit-title">
                  <span className="vu-edit-given">{form.firstName.trim() || 'Unnamed'}</span>
                  {form.lastName.trim() && (
                    <span className="vu-edit-surname">{form.lastName}</span>
                  )}
                </h2>
              )}

              {/* A rename is a form field like any other: it is written by Save changes,
                  and it takes her prose with it. */}
              <DeadNote note="Edit name" align="center" below>
                <motion.button
                  className="vu-edit-icon"
                  type="button"
                  aria-label="Edit name"
                  aria-pressed={editingName}
                  {...gestures(false, quietLift, quietPress)}
                  onClick={() => setEditingName((open) => !open)}
                >
                  <PencilIcon />
                </motion.button>
              </DeadNote>
            </div>

            {/* What she costs to spend, on their own row: three squares under the name rather
                than four beside it, which left the name 176px to say a full name in. */}
            <div className="vu-edit-name-actions">
              {/* Export is disabled mid-run: a zip taken while sprites are landing catches
                  half of one set and half of another. */}
              <DeadNote note="Download character ZIP" align="center" below>
                <motion.button
                  id="edit-export"
                  className="vu-edit-icon"
                  type="button"
                  aria-label="Download character ZIP"
                  disabled={exporting || rendering}
                  {...gestures(exporting || rendering, quietLift, quietPress)}
                  onClick={() => guardDirty('export', runExport)}
                >
                  <DownloadIcon size={17} strokeWidth={2.5} />
                </motion.button>
              </DeadNote>
              {/* Disabled mid-run for Export's reason. */}
              <DeadNote note="Duplicate character" align="center" below>
                <motion.button
                  id="edit-duplicate"
                  className="vu-edit-icon"
                  type="button"
                  aria-label="Duplicate character"
                  disabled={duplicating || rendering}
                  {...gestures(duplicating || rendering, quietLift, quietPress)}
                  onClick={() => guardDirty('duplicate', runDuplicate)}
                >
                  <DuplicateIcon />
                </motion.button>
              </DeadNote>
              {/* Opening the folder spends nothing, so it is gated on nothing — and there is
                  no folder to open in the browser, where her files are the browser's. */}
              {!webBuild && (
                <DeadNote note="Open folder" align="center" below>
                  <motion.button
                    className="vu-edit-icon"
                    type="button"
                    aria-label="Open folder"
                    {...gestures(false, quietLift, quietPress)}
                    onClick={() => void openFolder(charId)}
                  >
                    <FolderIcon />
                  </motion.button>
                </DeadNote>
              )}
            </div>

            <div className="vu-edit-scroll">
            <div className="vu-edit-form">
              <TextField
                id="edit-personality"
                label="Personality"
                value={form.personality}
                onChange={setField('personality')}
                multiline
                rows={5}
                autoGrow
              />

              {/* How her loops are pitched. The ends are the whole of the reading: there is no
                  unit under a voice, and a number for one would say nothing. Letting go of the
                  slider plays the voice it has been left at. */}
              <div className="vu-range-row vu-edit-voice">
                <span className="vu-range-label">Voice</span>
                <span className="vu-range-end">Lower</span>
                <input
                  className="vu-range"
                  type="range"
                  min={VOICE_PITCH_MIN}
                  max={VOICE_PITCH_MAX}
                  step={0.01}
                  value={form.voicePitch}
                  aria-label="Voice pitch"
                  aria-valuetext={voiceReading(form.voicePitch)}
                  style={
                    {
                      '--range-fill': `${((form.voicePitch - VOICE_PITCH_MIN) / (VOICE_PITCH_MAX - VOICE_PITCH_MIN)) * 100}%`
                    } as CSSProperties
                  }
                  onChange={(e) => setField('voicePitch')(clampVoicePitch(Number(e.target.value)))}
                  onPointerUp={(e) => previewVoice(Number(e.currentTarget.value))}
                  onKeyUp={(e) => previewVoice(Number(e.currentTarget.value))}
                />
                <span className="vu-range-end">Higher</span>
              </div>

              {/* Her height as the lineup last set it; the button opens the lineup, and Save
                  writes the height with everything else. */}
              <div className="vu-range-row vu-edit-height">
                <span className="vu-range-label">Height</span>
                <span className="vu-range-reading">{Math.round(form.height * 100)}%</span>
                <motion.button
                  id="edit-set-height"
                  className="vu-btn vu-btn--outline vu-btn--panel vu-paper"
                  type="button"
                  {...gestures(false, lift, press)}
                  onClick={() => setSizing(true)}
                >
                  Set height
                </motion.button>
              </div>

              {/* The spoiler fields, behind a disclosure. */}
              <details className="vu-disc">
                <motion.summary
                  className="vu-disc-summary"
                  {...gestures(false, rowLift, rowPress)}
                >
                  More settings <span className="vu-disc-note">(Spoilers)</span>
                </motion.summary>
                <div className="vu-disc-body">
                  <TextField
                    id="edit-backstory"
                    label="Backstory"
                    value={form.backstory}
                    onChange={setField('backstory')}
                    multiline
                    rows={3}
                    autoGrow
                  />
                  <TextField
                    id="edit-dating-history"
                    label="Dating history"
                    value={form.datingHistory}
                    onChange={setField('datingHistory')}
                    multiline
                    rows={2}
                    autoGrow
                  />
                  <TextField
                    id="edit-dating-preference"
                    label="Dating preference"
                    value={form.datingPreference}
                    onChange={setField('datingPreference')}
                    multiline
                    rows={2}
                    autoGrow
                  />
                  <TextField
                    id="edit-kinks"
                    label="Sexual Preferences"
                    value={form.kinks}
                    onChange={setField('kinks')}
                    multiline
                    rows={2}
                    autoGrow
                  />

                  {/* Whether she was a virgin before the reader; a save never writes this back. */}
                  <CheckField
                    id="edit-is-virgin"
                    label="Virgin"
                    checked={form.isVirgin}
                    onChange={setField('isVirgin')}
                  />

                  <TextField
                    id="edit-likes"
                    label="Likes (one per line)"
                    value={form.likes}
                    onChange={setField('likes')}
                    multiline
                    rows={3}
                    autoGrow
                  />
                  <TextField
                    id="edit-dislikes"
                    label="Dislikes (one per line)"
                    value={form.dislikes}
                    onChange={setField('dislikes')}
                    multiline
                    rows={3}
                    autoGrow
                  />

                  {BEHAVIOR_FIELDS.map(({ key, label }) => (
                    <TextField
                      key={key}
                      id={`edit-${key}`}
                      label={label}
                      value={form.behavior[key]}
                      onChange={setBehaviorField(key)}
                      multiline
                      rows={2}
                      autoGrow
                    />
                  ))}

                  {/* A closed picker over `shared/traits.ts`'s vocabulary. */}
                  <label className="vu-field" htmlFor="edit-traits">
                    <span className="vu-field-label">Traits</span>
                    <TagSelect
                      id="edit-traits"
                      values={form.traits}
                      options={TRAIT_OPTIONS}
                      onChange={(values) => setField('traits')(values.filter(isCharacterTrait))}
                      placeholder="Add a trait…"
                    />
                  </label>

                  {/* The traits' single-valued sibling. */}
                  <SelectField
                    id="edit-preferred-stat"
                    label="Preferred stat"
                    value={form.preferredStat}
                    onChange={(value) => isStatKey(value) && setField('preferredStat')(value)}
                    options={PREFERRED_STAT_OPTIONS}
                  />

                  {/* Closed pickers. Each list offers only what the other has not
                      taken, so a category never sits on both. */}
                  <label className="vu-field" htmlFor="edit-gift-liked">
                    <span className="vu-field-label">Liked gifts</span>
                    <TagSelect
                      id="edit-gift-liked"
                      values={form.giftLiked}
                      options={GIFT_CATEGORY_OPTIONS.filter(
                        (option) => !form.giftDisliked.includes(option.value)
                      )}
                      onChange={(values) => setField('giftLiked')(values.filter(isGiftCategory))}
                      placeholder="Add a liked category…"
                    />
                  </label>

                  <label className="vu-field" htmlFor="edit-gift-disliked">
                    <span className="vu-field-label">Disliked gifts</span>
                    <TagSelect
                      id="edit-gift-disliked"
                      values={form.giftDisliked}
                      options={GIFT_CATEGORY_OPTIONS.filter(
                        (option) => !form.giftLiked.includes(option.value)
                      )}
                      onChange={(values) => setField('giftDisliked')(values.filter(isGiftCategory))}
                      placeholder="Add a disliked category…"
                    />
                  </label>
                </div>
              </details>

              {/* The tags the images were generated from, an edit showing only once that set is
                  regenerated, and the room's own prompt beside them. The tags feed a ComfyUI
                  render, the prompt the cloud room, so the disclosure is held shut without the
                  install: a summary cannot be disabled, and refusing the click is what stops it
                  opening, for the mouse and for Enter/Space alike. */}
              <DeadNote note={advancedShut ? comfyNote : null} align="center">
                <details className="vu-disc">
                  <motion.summary
                    className="vu-disc-summary"
                    aria-disabled={advancedShut || undefined}
                    {...gestures(advancedShut, rowLift, rowPress)}
                    onClick={(e) => {
                      if (advancedShut) e.preventDefault()
                    }}
                  >
                    Generation settings <span className="vu-disc-note">(Advanced)</span>
                  </motion.summary>
                  <div className="vu-disc-body">
                    {!webBuild && (
                      <>
                        {TAG_FIELDS.map(({ key, id, label }) => (
                          <label key={key} className="vu-field" htmlFor={id}>
                            <span className="vu-field-label">{label}</span>
                            <ChipListInput
                              id={id}
                              values={form[key]}
                              onChange={setField(key)}
                              placeholder="Enter or comma to add a tag"
                            />
                          </label>
                        ))}

                        <label className="vu-field" htmlFor="edit-negative-tags">
                          <span className="vu-field-label">Additional Negative Prompts</span>
                          <ChipListInput
                            id="edit-negative-tags"
                            values={form.negativeTags}
                            onChange={setField('negativeTags')}
                            placeholder="Discourages generation of certain elements"
                          />
                        </label>
                      </>
                    )}

                    {/* The dorm room's own prompt, the continuation the cloud image model is
                        sent — the one field in here that is not the local renderer's. */}
                    <TextField
                      id="edit-room-prompt"
                      label="Room BG prompt"
                      value={form.roomPrompt}
                      onChange={setField('roomPrompt')}
                      hint={`${ROOM_PROMPT_LEAD}...`}
                      multiline
                      rows={3}
                      autoGrow
                    />
                  </div>
                </details>
              </DeadNote>
            </div>
            <div className="vu-scroll-fade" />
            </div>

            {/* Outside the scroller, so the answers stay in reach. */}
            <div className="vu-foot-stack">
              {/* "Saved" gives way the moment the form differs again. */}
              <span className="vu-form-status">
                {dirty ? (
                  <>
                    <span className="vu-form-dot vu-form-dot--warn" />
                    Unsaved changes
                  </>
                ) : saved ? (
                  <>
                    <span className="vu-form-dot vu-form-dot--good" />
                    Saved
                  </>
                ) : null}
              </span>
              <div className="vu-foot">
                {/* The way out, through the same dirty gate Escape and the dimming ask. */}
                <motion.button
                  id="edit-cancel"
                  className="vu-btn vu-btn--quiet"
                  type="button"
                  {...gestures(false, quietLift, quietPress)}
                  onClick={requestClose}
                >
                  Cancel
                </motion.button>
                <motion.button
                  id="edit-save"
                  className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
                  type="button"
                  {...gestures(false, lift, press)}
                  onClick={() => void persist()}
                >
                  Save changes
                </motion.button>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>

      {/* Siblings of the veil rather than children of it: each carries its own theme and
          its own shell, and a click inside one must not reach this veil's handler through
          the React tree. */}

      {/* Handed the form's character, so the lineup shows the height being edited. */}
      <AnimatePresence propagate>
        {sizing && (
          <SetHeightModal
            key="heights"
            character={buildNext()}
            theme={theme}
            onConfirm={setField('height')}
            onClose={() => setSizing(false)}
          />
        )}

        {gallery && (
          <ImageGalleryModal
            key="cgs"
            charId={charId}
            kind="cgs"
            theme={theme}
            // The same gate the set's control reads.
            regenEnabled={!setBlocked('cgs') && !sfwWithholds('cgs', noNsfwImages)}
            // A single CG re-roll goes through the dirty gate as a set does.
            onRegenerate={(position) =>
              guardDirty('regenerate', () =>
                openRegenerate((current) => ({
                  target: cgTargetFor(position),
                  title: 'Regenerate CG',
                  edit: cgDraft(current, position),
                  seed: seedPrefillFor(current, cgTargetFor(position))
                }))
              )
            }
            onClose={() => setGallery(false)}
          />
        )}
        {roomGallery && (
          <ImageGalleryModal
            key="room"
            charId={charId}
            kind="room"
            theme={theme}
            onClose={() => setRoomGallery(false)}
          />
        )}
        {customs && (
          <CustomOutfitsModal
            key="customs"
            theme={theme}
            slots={CUSTOM_OUTFIT_SLOTS.map((slot) => ({
              slot,
              column: columnFor(slot, slot, outfitLabelOf(character, slot))
            }))}
            onClose={() => setCustoms(false)}
          />
        )}
        {framing && (
          <ProfilePictureModal
            key="profile"
            charId={charId}
            name={name}
            theme={theme}
            onClose={() => setFraming(false)}
          />
        )}
        {fixing?.kind === 'fix' && (
          <TransparencyFixModal
            key="fix-transparency"
            charId={charId}
            set={fixing.set}
            title={fixing.title}
            theme={theme}
            onClose={() => setFixing(null)}
          />
        )}
        {fixing?.kind === 'hands' && (
          <FingerFixModal
            key="fix-fingers"
            charId={charId}
            set={fixing.set}
            title={fixing.title}
            theme={theme}
            onClose={() => setFixing(null)}
          />
        )}
        {pending !== null && (
          <ConfirmModal
            key="save-first"
            id="edit-save-first"
            theme={theme}
            title={`Save changes and ${pending.verb}?`}
            message={PENDING_MESSAGE[pending.verb]}
            confirmText={`Save and ${pending.verb}`}
            busy={working}
            busyText="Saving…"
            onConfirm={confirmPending}
            onCancel={() => setPending(null)}
          />
        )}

        {deleting !== null && (
          <ConfirmModal
            key="delete-outfit"
            id="delete-outfit"
            theme={theme}
            title={`Delete ${outfitLabelOf(character, deleting)}?`}
            message="Its sprites will be deleted."
            confirmText="Delete"
            busy={working}
            onConfirm={runDelete}
            onCancel={() => setDeleting(null)}
          />
        )}

        {closing && (
          <ConfirmModal
            key="discard"
            id="edit-discard"
            theme={theme}
            title="Discard changes?"
            message="This character has unsaved changes."
            confirmText="Discard changes"
            cancelText="Keep editing"
            onConfirm={onClose}
            onCancel={() => setClosing(false)}
          />
        )}

        {/* One presence in wait mode, so the tag modal never arrives over the confirm that
            hands it the run, still fading. */}
        <AnimatePresence propagate mode="wait">
          {confirmSet !== null && (
            <ConfirmModal
              key="confirm-set"
              id="regenerate-set"
              theme={theme}
              title={`Regenerate ${setLabel(confirmSet.target)}?`}
              message={'Generations in progress will be cancelled.'}
              confirmText="Regenerate all"
              onConfirm={() => {
                const request = confirmSet
                setConfirmSet(null)
                runSet(request.target, request.mode)
              }}
              onCancel={() => setConfirmSet(null)}
            />
          )}

          {regen !== null && (
            <RegenerateModal
              key="regenerate"
              id="regenerate"
              theme={theme}
              title={regen.title}
              edit={regen.edit}
              seed={regen.seed}
              name={regen.name}
              requireGroup={regen.requireGroup}
              submitLabel={regen.submitLabel}
              onConfirm={(edit, seed, name) => {
                const request = regen
                setRegen(null)
                if (request === null) return
                void sendRender(request, edit, seed, name)
              }}
              onCancel={() => setRegen(null)}
            />
          )}
        </AnimatePresence>
      </AnimatePresence>
    </>,
    host
  )
}

/** What the portrait offers: a frame, not a rename — the pencil beside it is the name's. */
function CropIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 2v14a2 2 0 0 0 2 2h14" />
      <path d="M18 22V8a2 2 0 0 0-2-2H2" />
    </svg>
  )
}

/** The one mark only the editor has: the rest of the row is `characterIcons`. */
function PencilIcon(): JSX.Element {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

