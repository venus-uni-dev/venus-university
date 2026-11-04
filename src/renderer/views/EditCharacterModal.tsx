import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { CheckField } from '../components/CheckField'
import { ChipField, useCopyMark } from '../components/ChipField'
import { ComfyModelRow } from '../components/ComfyModelPicker'
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
  VOICE_PITCH_MIN,
  volumesOf
} from '@shared/audio'
import {
  customCgLabelOf,
  customCgLoraOf,
  customCgSfxOf,
  customCgVoiceOf,
  DEFAULT_CG_SFX,
  DEFAULT_CG_VOICE,
  isCgSfx,
  isCgVoice
} from '@shared/customCgs'
import {
  characterLoraOf,
  DEFAULT_LORA_WEIGHT,
  loraOf,
  loraToStore,
  loraWeightText,
  parseLoraWeight,
  type DrawnLora
} from '@shared/comfyModels'
import { EMOTIONS } from '@shared/emotions'
import {
  cgDraft,
  cgSetDraft,
  expressionDraft,
  spriteDraft,
  type PromptEdit
} from '@shared/imagePrompt'
import { defaultTagsOf, type DefaultTags } from '@shared/defaultTags'
import {
  CUSTOM_OUTFIT_INSTRUCTIONS_MAX,
  CUSTOM_OUTFIT_NAME_MAX,
  customOutfitInstructions,
  customOutfitName,
  customOutfitSlotAt,
  customOutfitSlotsIn,
  customSlotNumber,
  isCustomOutfitSlot,
  outfitLabelOf
} from '@shared/outfits'
import { isStatKey, type StatKey } from '@shared/playerStats'
import {
  afterOf,
  customCgSlotAt,
  customCgSlotNumber,
  customCgSlotOf,
  isCustomCgSlot,
  STOCK_POSITIONS
} from '@shared/positions'
import { ROOM_PROMPT_LEAD, ROOM_VARIANTS } from '@shared/room'
import { withRegenTags, type PromptGroup } from '@shared/regenTags'
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
  CustomCgSlot,
  CustomOutfitSlot,
  Emotion,
  OutfitSet,
  RegenTarget,
  SetTarget
} from '@shared/types'
import { poseKeysOf, useAssetStore } from '../stores/assetStore'
import { useAudioStore } from '../stores/audioStore'
import {
  cgTargetFor,
  doneCountOf,
  expressionTargetFor,
  isInFlight,
  isPregenOf,
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
import { comfyAvailable, useSetupStore } from '../stores/setupStore'
import {
  APPEARANCE_COLOR_HINT,
  BEHAVIOR_FIELDS,
  CG_INSTRUCTIONS_HINT,
  CG_NAME_HINT,
  GIFT_CATEGORY_OPTIONS,
  listText,
  loraMissingCopy,
  outfitInstructionsHint,
  OUTFIT_NAME_HINT,
  positionLoraMissingCopy,
  PREFERRED_STAT_OPTIONS,
  sheetPlaceholders,
  TAG_FIELDS,
  textList,
  TRAIT_OPTIONS,
  WARDROBES
} from './characterFields'
import { CardIcon, DuplicateIcon, FolderIcon, ResetIcon, SpritesIcon } from './characterIcons'
import { CustomCgEditModal } from './CustomCgEditModal'
import { CustomCgsModal } from './CustomCgsModal'
import { CustomOutfitsModal } from './CustomOutfitsModal'
import { ImageGalleryModal } from './ImageGalleryModal'
import { OutfitInstructionsModal } from './OutfitInstructionsModal'
import { ProfilePictureModal } from './ProfilePictureModal'
import {
  RegenerateModal,
  type CgSounds,
  type LoraAnswer,
  type PastedSet,
  type SeedPrefill
} from './RegenerateModal'
import { SetHeightModal } from './SetHeightModal'
import { EraseArtifactsModal } from './EraseArtifactsModal'
import { FingerFixModal } from './FingerFixModal'
import { committedWeightText, useCharacterLora, weightTextAfterPick } from './useCharacterLora'
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
import { DownloadIcon, PencilIcon } from './screenIcons'
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
  target: RegenTarget
  title: string
  edit: PromptEdit
  /** The groups the render would send unedited, which Reset puts back. */
  defaults: PromptEdit
  /** The default tags both were drawn under, kept beside what the render sends. */
  tags: DefaultTags
  seed: SeedPrefill
  /** Asks for a name too, where the set is being made rather than replaced. */
  name?: { value: string; placeholder: string; maxLength: number; hint: string }
  /** And for when the writer should use it, on the same terms. */
  instructions?: { value: string; maxLength: number; hint: (name: string) => string }
  /** And for the loops a CG plays, on the same terms. */
  sounds?: CgSounds
  /** And for the position LoRA a custom CG draws, opening on this one, wherever it renders one. */
  lora?: { value: DrawnLora | null }
  /** A group the render cannot be sent without. */
  requireGroup?: PromptGroup
  /** Fills the form from the last set of its kind copied, where the set is being made. */
  paste?: { label: string; group: PromptGroup; from: PastedSet | null }
  /** The primary's words, where the render is not a replacement. */
  submitLabel?: string
  /** Whether the player answered to render it without her missing LoRA. */
  withoutLora?: boolean
}

/** What a caller builds a request from: the draft in place of the two tag states derived from it. */
type RegenerateOpening = Omit<RegenerateRequest, 'defaults' | 'edit' | 'tags'> & {
  draft: PromptEdit
}

/** True for a whole-set target: the single-image forms name what they are in front of the key. */
function isSetTarget(target: RenderTarget): target is SetTarget {
  return !target.startsWith('cg:') && !target.startsWith('expression:')
}

/** The custom CG pair a render belongs to — the pair itself, or either of its images alone. */
function customCgOfTarget(target: RenderTarget): CustomCgSlot | null {
  return customCgSlotOf(target.startsWith('cg:') ? target.slice('cg:'.length) : target)
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
  /** The pose every sprite render stands in. */
  pose: string
  /** Her own LoRA, '' for None, and its weight as typed. */
  loraName: string
  loraWeight: string
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
    voicePitch: character.voicePitch ?? VOICE_PITCH_DEFAULT,
    pose: character.pose,
    loraName: characterLoraOf(character)?.name ?? '',
    loraWeight: loraWeightText(characterLoraOf(character)?.weight ?? DEFAULT_LORA_WEIGHT)
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
  // Which player-authored wardrobe's instructions are being written.
  const [instructing, setInstructing] = useState<CustomOutfitSlot | null>(null)
  const [customCgs, setCustomCgs] = useState(false)
  // Which player-authored CG pair the delete confirm is standing in front of.
  const [deletingCg, setDeletingCg] = useState<CustomCgSlot | null>(null)
  // Which player-authored CG pair's instructions and loops are being written.
  const [editingCg, setEditingCg] = useState<CustomCgSlot | null>(null)
  // Which wardrobe repair is open, over which set.
  const [fixing, setFixing] = useState<{
    set: OutfitSet | null
    title: string
    kind: 'fix' | 'hands' | 'erase'
  } | null>(null)
  const [framing, setFraming] = useState(false)
  // Whether the portrait is being pointed at, which is what raises the mark over it.
  const [overPortrait, setOverPortrait] = useState(false)
  const [confirmSet, setConfirmSet] = useState<{
    target: SetTarget
    mode: RenderMode
    withoutLora: boolean
  } | null>(null)
  const [regen, setRegen] = useState<RegenerateRequest | null>(null)
  // Which tag well's copy mark wears the check.
  const copyMark = useCopyMark()
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [working, setWorking] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportingCard, setExportingCard] = useState(false)
  const [exportingSprites, setExportingSprites] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [closing, setClosing] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [resetting, setResetting] = useState(false)
  // A render whose LoRA ComfyUI does not list, waiting on the player's answer.
  const [loraMissing, setLoraMissing] = useState<{ file: string; run: () => void } | null>(null)
  // And a custom CG fill whose position LoRA it does not list, on the same terms.
  const [cgLoraMissing, setCgLoraMissing] = useState<{ file: string; run: () => void } | null>(
    null
  )

  const setField =
    <K extends keyof Form>(key: K) =>
    (value: Form[K]): void =>
      setForm((prev) => ({ ...prev, [key]: value }))

  const setBehaviorField = (key: keyof CharacterBehavior) => (value: string) =>
    setForm((prev) => ({ ...prev, behavior: { ...prev.behavior, [key]: value } }))

  // What each prose field shows while it is empty, told about her by name.
  const placeholders = sheetPlaceholders(form.firstName.trim() || 'She')

  // The voice the last preview played, seeded with the one she has: a release that left the
  // slider where it was — tabbing onto it, closing the modal off it — plays nothing.
  const previewedVoice = useRef(form.voicePitch)

  /** Reads a voice out when the slider is let go of, at the pitch it has been left at. */
  const previewVoice = (value: number): void => {
    const pitch = clampVoicePitch(value)
    if (previewedVoice.current === pitch) return
    previewedVoice.current = pitch
    // A muted NSFW slider skips the breath rather than leaving a silent gap before the blips.
    const breath = volumesOf(useSettingsStore.getState().settings?.volumes).nsfw > 0
    useAudioStore.getState().previewVoice(pitch, breath)
  }

  const poses = useAssetStore((s) => s.poses)
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
  const writeRegenTags = useCharacterStore((s) => s.writeRegenTags)
  const deleteCustomOutfit = useCharacterStore((s) => s.deleteCustomOutfit)
  const writeCustomCg = useCharacterStore((s) => s.writeCustomCg)
  const deleteCustomCg = useCharacterStore((s) => s.deleteCustomCg)
  const copyCustomOutfit = useCharacterStore((s) => s.copyCustomOutfit)
  const copyCustomCg = useCharacterStore((s) => s.copyCustomCg)
  const exportCharacter = useCharacterStore((s) => s.exportCharacter)
  const exportCard = useCharacterStore((s) => s.exportCard)
  const exportSpritePack = useCharacterStore((s) => s.exportSpritePack)
  const duplicateCharacter = useCharacterStore((s) => s.duplicateCharacter)
  const openFolder = useCharacterStore((s) => s.openFolder)
  const resetDefault = useCharacterStore((s) => s.resetDefault)
  const loadDefaults = useCharacterStore((s) => s.loadDefaults)
  const shipped = useCharacterStore((s) => isPregenOf(s, charId))
  const edited = useCharacterStore((s) => s.editedDefaults.includes(charId))
  const defaultsInPlace = useCharacterStore((s) => s.defaultsInPlace)
  // The same gate the new-character slot uses: rendering needs a ComfyUI, the app's own or the
  // player's.
  const setupStatus = useSetupStore((s) => s.status)
  const renderable = useSettingsStore((s) => comfyAvailable(s.settings, setupStatus))
  // The room renders in the cloud, so its gate is whichever key draws the pictures.
  const picturesReady = useSettingsStore((s) => (s.settings ? pictureKeySet(s.settings) : false))
  // Under a custom endpoint that key is the images one, asked for by a name of its own.
  const customWriter = useSettingsStore((s) => s.settings?.apiProvider === 'openai')
  // Withholds the nude wardrobe and the CGs outright: neither viewable nor renderable under it.
  const noNsfwImages = useSettingsStore(noNsfwImagesOf)

  // The browser ships no local renderer, so nothing it drives can ever be reached from here.
  const webBuild = isWebBuild()

  /** Whether the local renderer is out of reach, which every ComfyUI job in here waits on. */
  const comfyMissing = !renderable

  // The LoRAs her own may be picked from, asked for only where there is a ComfyUI to ask.
  const loras = useCharacterLora(!webBuild && !comfyMissing)

  /* What a hover raises over a control these are holding dead: the one thing the player would
     have to go and get, and nothing the moment he has it. A control dead for anything else —
     the default sprites, an empty room prompt, a repair with nothing to paint over, a render
     already going — stays silent, as every dead control does. */
  const comfyNote = webBuild ? DESKTOP_ONLY_NOTE : comfyMissing ? 'Requires ComfyUI' : null

  /* The generation disclosure holds the booru tags a local render reads and the cloud room's
     own prompt. Where there is no local renderer it holds the prompt alone, and a prompt the
     cloud reads is not waiting on an install, so there it opens like any other panel. */
  const advancedShut = comfyMissing && !webBuild
  const keyNote = picturesReady ? null : customWriter ? 'Requires Image API key' : 'Requires API key'

  // Her own pose first, if this install's manifest carries no skeleton for it — otherwise the
  // select would show blank for a record saved somewhere that had one.
  const poseKeys = poseKeysOf(poses)
  const poseOptions = [
    ...(form.pose && !poseKeys.includes(form.pose) ? [{ value: form.pose, label: form.pose }] : []),
    ...poseKeys.map((key) => ({ value: key, label: key }))
  ]

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
      voicePitch: form.voicePitch,
      pose: form.pose
    }
    // Absent and empty mean the same thing, so an empty list is left out of character.json.
    if (next.negativeTags?.length === 0) delete next.negativeTags
    // Likewise absent and centre, so a voice nobody moved is left out too.
    if (next.voicePitch === 0) delete next.voicePitch
    // Her LoRA as the record holds it where the form left it alone, so a hand-written one never
    // reads as an edit; text that is not a weight keeps the one she has.
    const held = characterLoraOf(character)
    const weight = parseLoraWeight(form.loraWeight) ?? held?.weight ?? DEFAULT_LORA_WEIGHT
    if (form.loraName === '') delete next.lora
    else if (held?.name !== form.loraName || held.weight !== weight) {
      next.lora = loraToStore(form.loraName, weight)
    }
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

  /** Composes her SillyTavern card and saves it through the export dialog. */
  const runCard = (): void => {
    setExportingCard(true)
    void exportCard(charId).finally(() => setExportingCard(false))
  }

  /** Composes her SillyTavern sprite pack and saves it through the export dialog. */
  const runSprites = (): void => {
    setExportingSprites(true)
    void exportSpritePack(charId).finally(() => setExportingSprites(false))
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

  /**
   * Throws her edited copy away and shows her as shipped. The form is re-seeded from the
   * shipped record, and everything open on a slot, a set or a staged render of the copy
   * goes with it, since the copy may have held a wardrobe or CG pair the shipped one lacks.
   */
  const runReset = (): void => {
    setResetting(true)
    void resetDefault(charId).then((reset) => {
      setResetting(false)
      setConfirmingReset(false)
      if (!reset) return
      const seeded = formOf(reset)
      previewedVoice.current = seeded.voicePitch
      setForm(seeded)
      setSaved(false)
      setEditingName(false)
      setDeleting(null)
      setInstructing(null)
      setDeletingCg(null)
      setEditingCg(null)
      setFixing(null)
      setRegen(null)
      setConfirmSet(null)
      setPending(null)
      setLoraMissing(null)
      setCgLoraMissing(null)
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

  /** Throws one player-authored CG pair away, both its images and its record entry alike. */
  const runDeleteCg = (): void => {
    const slot = deletingCg
    if (slot === null) return
    setWorking(true)
    void deleteCustomCg(charId, slot).finally(() => {
      setWorking(false)
      setDeletingCg(null)
    })
  }

  /** Stock CGs being re-rolled one at a time right now. */
  const singleCgs = liveCgTasks(progress)

  /** The four sprite wardrobes by target, for the two things that address one by name. */
  const wardrobeOf = (target: SetTarget): (typeof WARDROBES)[number] | undefined =>
    WARDROBES.find((entry) => entry.target === target)

  /** Which wardrobe a target addresses; the default one and the landscape sets have none. */
  const setOfTarget = (target: SetTarget): OutfitSet | null =>
    target === 'default' || target === 'cgs' || target === 'room' || isCustomCgSlot(target)
      ? null
      : target

  /** What a confirm calls the set it is about to replace. */
  const setLabel = (target: SetTarget): string =>
    isCustomOutfitSlot(target)
      ? outfitLabelOf(character, target)
      : isCustomCgSlot(target)
        ? customCgLabelOf(character, target)
        : (wardrobeOf(target)?.title ?? (target === 'cgs' ? 'NSFW CG' : 'Room BG'))

  /** Every image inside one set that is being re-rolled on its own right now. */
  const liveSinglesOf = (target: SetTarget): RenderTarget[] => {
    if (target === 'cgs') return singleCgs.map(cgTargetFor)
    if (isCustomCgSlot(target)) {
      return liveCgTasks(progress, [target, afterOf(target)]).map(cgTargetFor)
    }
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

  /**
   * Opens the tag modal on the tags the button last sent, or the draft where it sent none,
   * built from the character as the store holds her now.
   */
  const openRegenerate = (
    build: (
      character: Character,
      poseTags: readonly string[],
      tags: DefaultTags
    ) => RegenerateOpening,
    withoutLora = false
  ): void => {
    // Read fresh out of the store, never off `character`: the dirty gate may have just saved,
    // and the closure this runs from still holds the character as she was typed over.
    const current = useCharacterStore.getState().characters[charId]
    if (!current) return
    const poseTags = useAssetStore.getState().poses[current.pose]?.tags ?? []
    const tags = defaultTagsOf(useSettingsStore.getState().settings)
    const { draft, ...request } = build(current, poseTags, tags)
    const kept = withRegenTags(draft, current.regenTags?.[request.target], tags)
    // A custom slot's Outfit group, and a custom CG pair's Position group for either of its
    // images, are her record, whatever the button last sent.
    const edit =
      isCustomOutfitSlot(request.target) && kept.kind === 'sprite' && draft.kind === 'sprite'
        ? { ...kept, outfit: draft.outfit }
        : customCgOfTarget(request.target) && kept.kind === 'cg' && draft.kind === 'cg'
          ? { ...kept, position: draft.position }
          : kept
    setRegen({ ...request, defaults: draft, edit, tags, withoutLora })
  }

  /**
   * Runs one of her renders past the LoRA check: straight on where the render is the cloud
   * room, she has no LoRA or ComfyUI lists hers; behind the confirm where it does not, whose
   * answer runs it without. Read fresh, as the dirty gate in front of it may have just saved.
   */
  const guardLora = (target: RenderTarget, run: (withoutLora: boolean) => void): void => {
    const current = useCharacterStore.getState().characters[charId]
    const lora = target === 'room' || !current ? null : characterLoraOf(current)
    if (!lora) {
      run(false)
      return
    }
    void loras.isListed(lora.name).then((listed) => {
      if (listed === false) setLoraMissing({ file: lora.name, run: () => run(true) })
      else run(false)
    })
  }

  /**
   * Runs a custom CG pair's fill past the check on its position LoRA, as {@link guardLora} runs
   * a render past hers: behind the confirm where ComfyUI does not list it, whose answer runs it
   * without.
   */
  const guardCgLora = (slot: CustomCgSlot, run: (withoutCgLora: boolean) => void): void => {
    const current = useCharacterStore.getState().characters[charId]
    const lora = current ? customCgLoraOf(current, slot) : null
    if (!lora) {
      run(false)
      return
    }
    void loras.isListed(lora.name).then((listed) => {
      if (listed === false) setCgLoraMissing({ file: lora.name, run: () => run(true) })
      else run(false)
    })
  }

  /** The wardrobe last copied, its words as the form that makes a new one opens on them. */
  const pastedOutfit = (): PastedSet | null => {
    const clip = useCharacterStore.getState().copiedOutfit
    if (!clip) return null
    return {
      tags: clip.tags,
      name: customOutfitName(clip.name),
      instructions: customOutfitInstructions(clip.instructions)
    }
  }

  /** The CG pair last copied on the same terms, its loops read as a slot's are. */
  const pastedCg = (): PastedSet | null => {
    const clip = useCharacterStore.getState().copiedCg
    if (!clip) return null
    return {
      tags: clip.tags,
      name: customOutfitName(clip.name),
      instructions: customOutfitInstructions(clip.instructions),
      sounds: {
        voice: isCgVoice(clip.voice) ? clip.voice : DEFAULT_CG_VOICE,
        sfx: isCgSfx(clip.sfx) ? clip.sfx : DEFAULT_CG_SFX
      },
      lora: loraOf(clip.lora)
    }
  }

  /** What a set's control runs: a fill goes straight out, a regenerate opens on its tags first. */
  const runSet = (target: SetTarget, mode: RenderMode, withoutLora = false): void => {
    /* A player-authored wardrobe or CG pair with nothing in it is written before it is
       rendered: there are no stored tags for a fill to draw from, so its first run opens the
       modal too. */
    const fresh =
      (isCustomOutfitSlot(target) && wardrobeDone(target) === 0) ||
      (isCustomCgSlot(target) && !cgs?.[target] && !cgs?.[afterOf(target)])
    // A fill replaces nothing, and the room's prompt is prose rather than booru tags, so
    // neither has a set of groups for the modal to open on.
    if (!fresh && (mode === 'fill' || target === 'room')) {
      const fill = (withoutCgLora: boolean): void => {
        cancelSingles(target)
        void generateSet(charId, target, mode, undefined, {
          withoutLora,
          ...(withoutCgLora ? { cgLora: null } : {})
        })
      }
      // A pair's fill draws the position LoRA its record holds, so that is asked about here.
      if (isCustomCgSlot(target) && mode === 'fill') guardCgLora(target, fill)
      else fill(false)
      return
    }
    if (isCustomOutfitSlot(target)) {
      const slot = target
      openRegenerate(
        (current, poseTags, tags) => ({
          target: slot,
          title: fresh ? 'Generate custom outfit' : `Regenerate ${outfitLabelOf(current, slot)}`,
          draft: spriteDraft(current, poseTags, slot, tags),
          seed: seedPrefillFor(current, slot),
          // A wardrobe with no clothes in it is the one render the tags are the whole point of.
          requireGroup: 'outfit',
          ...(fresh
            ? {
                name: {
                  value: customOutfitName(current.customOutfits?.[slot]?.name),
                  placeholder: `Custom outfit ${customSlotNumber(slot)}`,
                  maxLength: CUSTOM_OUTFIT_NAME_MAX,
                  hint: OUTFIT_NAME_HINT
                },
                instructions: {
                  value: customOutfitInstructions(current.customOutfits?.[slot]?.instructions),
                  maxLength: CUSTOM_OUTFIT_INSTRUCTIONS_MAX,
                  // Named as the writer will read it: a blank name is offered under the slot id.
                  hint: (typed: string) => outfitInstructionsHint(customOutfitName(typed) || slot)
                },
                paste: { label: 'Paste outfit', group: 'outfit', from: pastedOutfit() },
                submitLabel: 'Generate'
              }
            : {})
        }),
        withoutLora
      )
      return
    }
    if (isCustomCgSlot(target)) {
      const slot = target
      openRegenerate(
        (current, _poseTags, tags) => ({
          target: slot,
          title: fresh ? 'Generate custom CG' : `Regenerate ${customCgLabelOf(current, slot)}`,
          draft: cgDraft(current, slot, tags),
          seed: seedPrefillFor(current, slot),
          lora: { value: customCgLoraOf(current, slot) },
          // A CG with no position in it is the one render the tags are the whole point of.
          requireGroup: 'position',
          ...(fresh
            ? {
                name: {
                  value: customOutfitName(current.customCgs?.[slot]?.name),
                  placeholder: `Custom CG ${customCgSlotNumber(slot)}`,
                  maxLength: CUSTOM_OUTFIT_NAME_MAX,
                  hint: CG_NAME_HINT
                },
                instructions: {
                  value: customOutfitInstructions(current.customCgs?.[slot]?.instructions),
                  maxLength: CUSTOM_OUTFIT_INSTRUCTIONS_MAX,
                  hint: () => CG_INSTRUCTIONS_HINT
                },
                sounds: {
                  voice: customCgVoiceOf(current, slot),
                  sfx: customCgSfxOf(current, slot)
                },
                paste: { label: 'Paste CG', group: 'position', from: pastedCg() },
                submitLabel: 'Generate'
              }
            : {})
        }),
        withoutLora
      )
      return
    }
    if (target === 'cgs') {
      openRegenerate(
        (current, _poseTags, tags) => ({
          target: 'cgs',
          title: 'Regenerate NSFW CG',
          draft: cgSetDraft(current, tags),
          seed: seedPrefillFor(current, 'cgs')
        }),
        withoutLora
      )
      return
    }
    const wardrobe = wardrobeOf(target)
    if (!wardrobe) return
    const spriteTarget = target
    openRegenerate(
      (current, poseTags, tags) => ({
        target: spriteTarget,
        title: `Regenerate ${wardrobe.title}`,
        draft: spriteDraft(current, poseTags, wardrobe.set, tags),
        seed: seedPrefillFor(current, spriteTarget)
      }),
      withoutLora
    )
  }

  /** Starts a set's render, behind the confirm where it would cancel single re-rolls inside it. */
  const startSet = (target: SetTarget, mode: RenderMode, withoutLora = false): void => {
    if (liveSinglesOf(target).length > 0) {
      setConfirmSet({ target, mode, withoutLora })
      return
    }
    runSet(target, mode, withoutLora)
  }

  /** A set's render behind every gate in front of it: the dirty gate, then the LoRA check. */
  const requestSet = (verb: PendingVerb, target: SetTarget, mode: RenderMode): void =>
    guardDirty(verb, () => guardLora(target, (withoutLora) => startSet(target, mode, withoutLora)))

  /** A single re-roll's tag modal behind the same two gates. */
  const requestSingle = (
    target: RenderTarget,
    build: (
      character: Character,
      poseTags: readonly string[],
      tags: DefaultTags
    ) => RegenerateOpening
  ): void =>
    guardDirty('regenerate', () =>
      guardLora(target, (withoutLora) => openRegenerate(build, withoutLora))
    )

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
        requestSet(complete ? 'regenerate' : 'generate', target, complete ? 'regenerate' : 'fill'),
      // Cancelling consumes nothing the player has written, so it skips the dirty gate.
      onCancel: () => void cancelSet(charId, target)
    }
  }

  /**
   * Sends one render the tag modal answered. A player-authored wardrobe's Outfit group, or a CG
   * pair's Position group and position LoRA, is written onto her record first, so a later fill
   * draws from what it holds; a write that does not land queues nothing. What the modal
   * answered is kept as that button's tags either way. One image of a pair re-rolled alone
   * draws the LoRA its form left for that render, and writes none.
   */
  const sendRender = async (
    request: RegenerateRequest,
    edit: PromptEdit,
    seed: number | null,
    name?: string,
    instructions?: string,
    sounds?: CgSounds,
    lora?: LoraAnswer
  ): Promise<void> => {
    const target = request.target
    if (isCustomOutfitSlot(target) && edit.kind === 'sprite') {
      // A box left out or a name left blank keeps what the slot already holds.
      const ok = await writeCustomOutfit(charId, target, { tags: edit.outfit, name, instructions })
      if (!ok) return
    }
    if (isCustomCgSlot(target) && edit.kind === 'cg') {
      // The same, the loops and the LoRA included.
      const ok = await writeCustomCg(charId, target, {
        tags: edit.position,
        name,
        instructions,
        ...(sounds ?? {}),
        ...(lora ? { lora: lora.pick } : {})
      })
      if (!ok) return
    }
    // Kept whether or not it lands: a failed write is reported, and the render goes out regardless.
    void writeRegenTags(charId, target, edit, request.tags)
    if (isSetTarget(target)) cancelSingles(target)
    // The LoRA the form left, or none where the player answered to render without it.
    await generateSet(
      charId,
      target,
      'regenerate',
      { prompt: edit, seed },
      {
        withoutLora: request.withoutLora,
        ...(lora ? { cgLora: lora.drawn ? lora.pick : null } : {})
      }
    )
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
                    requestSingle(expressionTargetFor(emotion, set), (current) => ({
                      target: expressionTargetFor(emotion, set),
                      title: 'Regenerate expression',
                      draft: expressionDraft(current, emotion),
                      seed: seedPrefillFor(current, expressionTargetFor(emotion, set))
                    })),
            onCancelExpression: (emotion: Emotion) =>
              void cancelSet(charId, expressionTargetFor(emotion, set)),
            liveExpressions: new Set(singleExpressions(set)),
            onFixTransparency: () => setFixing({ set, title, kind: 'fix' }),
            fixDisabled: fixBlocked(target, set),
            onFixFingers: () => setFixing({ set, title, kind: 'hands' }),
            fingersDisabled: fingersBlocked(target, set),
            fingersNote: comfyNote,
            onEraseArtifacts: () => setFixing({ set, title, kind: 'erase' })
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
          value: customOutfitName(entry.name),
          placeholder: `Custom outfit ${customSlotNumber(slot)}`,
          max: CUSTOM_OUTFIT_NAME_MAX,
          onCommit: (name) => void writeCustomOutfit(charId, slot, { name })
        }
        authored.onInstructions = () => setInstructing(slot)
        authored.onDelete = () => setDeleting(slot)
        authored.deleteDisabled = Boolean(taskOf(slot)) || singleExpressions(slot).length > 0
        // Copied for a new one's form, which only a build with a renderer offers.
        if (!webBuild) authored.onCopy = () => copyCustomOutfit(charId, slot)
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

  const cgsOnDisk = STOCK_POSITIONS.filter((position) => cgs?.[position]).length

  // The CGs' control is withheld on the wardrobe's terms: gone under the setting, kept while
  // a render of them is still going.
  const cgsWithheld = sfwWithholds('cgs', noNsfwImages) && !taskOf('cgs')

  const rendering = isInFlight(progress)

  // Her first edit makes the copy that Reset throws away; main answers which shipped
  // characters have one, so it is asked again whenever she is written or her images change.
  const updatedAt = character.updatedAt
  useEffect(() => {
    if (shipped) void loadDefaults()
  }, [shipped, updatedAt, version, rendering, loadDefaults])

  /** How many of her custom slots hold a whole wardrobe. */
  const customsOnDisk = customOutfitSlotsIn(Object.keys(outfits ?? {})).filter(
    (slot) => wardrobeDone(slot) === EMOTIONS.length
  ).length

  // Her custom slots holding a record or any sprite: what the panel's pages are counted off.
  const customsTaken = customOutfitSlotsIn([
    ...Object.keys(character.customOutfits ?? {}),
    ...Object.keys(outfits ?? {})
  ]).filter((slot) => character.customOutfits?.[slot] || wardrobeDone(slot) > 0)

  // Whether a custom CG pair can be rendered now: the set gate and the setting, which every
  // slot answers to alike, so the first stands for them all.
  const firstCg = customCgSlotAt(1)
  const cgPairsRenderable = !setBlocked(firstCg) && !sfwWithholds(firstCg, noNsfwImages)

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
                total={STOCK_POSITIONS.length}
                control={
                  cgsWithheld ? undefined : control('cgs', cgsOnDisk, STOCK_POSITIONS.length)
                }
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
              {/* Disabled mid-run for Export's reason. */}
              <DeadNote note="Export SillyTavern card" align="center" below>
                <motion.button
                  id="edit-card"
                  className="vu-edit-icon"
                  type="button"
                  aria-label="Export SillyTavern card"
                  disabled={exportingCard || rendering}
                  {...gestures(exportingCard || rendering, quietLift, quietPress)}
                  onClick={() => guardDirty('export', runCard)}
                >
                  <CardIcon />
                </motion.button>
              </DeadNote>
              {/* Disabled mid-run for Export's reason. */}
              <DeadNote note="Export SillyTavern sprites" align="center" below>
                <motion.button
                  id="edit-sprites"
                  className="vu-edit-icon"
                  type="button"
                  aria-label="Export SillyTavern sprites"
                  disabled={exportingSprites || rendering}
                  {...gestures(exportingSprites || rendering, quietLift, quietPress)}
                  onClick={() => guardDirty('export', runSprites)}
                >
                  <SpritesIcon />
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
              {/* A shipped character's way back to the one the game ships: held dead until she
                  has been edited, and while a render is writing to her copy. Run in place,
                  an edit is the shipped folder itself, so there is nothing to go back to. */}
              {shipped && !defaultsInPlace && (
                <DeadNote note="Reset to default" align="center" below>
                  <motion.button
                    id="edit-reset"
                    className="vu-edit-icon"
                    type="button"
                    aria-label="Reset to default"
                    disabled={rendering || resetting || !edited}
                    {...gestures(rendering || resetting || !edited, quietLift, quietPress)}
                    onClick={() => setConfirmingReset(true)}
                  >
                    <ResetIcon />
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
                placeholder={placeholders.personality}
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
                    placeholder={placeholders.backstory}
                    multiline
                    rows={3}
                    autoGrow
                  />
                  <TextField
                    id="edit-dating-history"
                    label="Dating history"
                    value={form.datingHistory}
                    onChange={setField('datingHistory')}
                    placeholder={placeholders.datingHistory}
                    multiline
                    rows={2}
                    autoGrow
                  />
                  <TextField
                    id="edit-dating-preference"
                    label="Dating preference"
                    value={form.datingPreference}
                    onChange={setField('datingPreference')}
                    placeholder={placeholders.datingPreference}
                    multiline
                    rows={2}
                    autoGrow
                  />
                  <TextField
                    id="edit-kinks"
                    label="Sexual Preferences"
                    value={form.kinks}
                    onChange={setField('kinks')}
                    placeholder={placeholders.kinks}
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
                    placeholder={placeholders.likes}
                    multiline
                    rows={4}
                    autoGrow
                  />
                  <TextField
                    id="edit-dislikes"
                    label="Dislikes (one per line)"
                    value={form.dislikes}
                    onChange={setField('dislikes')}
                    placeholder={placeholders.dislikes}
                    multiline
                    rows={4}
                    autoGrow
                  />

                  {BEHAVIOR_FIELDS.map(({ key, label, around }) => (
                    <TextField
                      key={key}
                      id={`edit-${key}`}
                      label={label}
                      value={form.behavior[key]}
                      onChange={setBehaviorField(key)}
                      placeholder={placeholders.behavior(around)}
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
                        {/* The pose every render of her stands in, the description under it
                            drawn from the manifest. A change here reaches the next render
                            after Save, the same as the tags beside it. */}
                        <SelectField
                          id="edit-pose"
                          label="Pose"
                          value={form.pose}
                          onChange={setField('pose')}
                          options={poseOptions}
                          hint={poses[form.pose]?.description}
                        />

                        {/* Her own LoRA, drawn through every render of her after the style
                            LoRA; its trigger word is one of her appearance tags below. */}
                        <ComfyModelRow
                          id="edit-lora"
                          label="Character LoRA"
                          value={form.loraName}
                          options={loras.optionsFor(form.loraName)}
                          onPick={(value) =>
                            setForm((prev) => ({
                              ...prev,
                              loraName: value,
                              loraWeight: weightTextAfterPick(prev.loraName, value, prev.loraWeight)
                            }))
                          }
                          weight={{
                            text: form.loraWeight,
                            onText: setField('loraWeight'),
                            onBlur: () =>
                              setForm((prev) => ({
                                ...prev,
                                loraWeight: committedWeightText(
                                  prev.loraWeight,
                                  characterLoraOf(character)?.weight ?? DEFAULT_LORA_WEIGHT
                                )
                              }))
                          }}
                          onOpenFolder={loras.onOpenFolder}
                        />

                        {TAG_FIELDS.map(({ key, id, label }) => (
                          <ChipField
                            key={key}
                            id={id}
                            label={label}
                            hint={key === 'baseAppearance' ? APPEARANCE_COLOR_HINT : undefined}
                            values={form[key]}
                            onChange={setField(key)}
                            placeholder="Enter or comma to add a tag"
                            mark={copyMark}
                          />
                        ))}

                        <ChipField
                          id="edit-negative-tags"
                          label="Additional Negative Prompts"
                          values={form.negativeTags}
                          onChange={setField('negativeTags')}
                          placeholder="Discourages generation of certain elements"
                          mark={copyMark}
                        />
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
              requestSingle(cgTargetFor(position), (current, _poseTags, tags) => ({
                target: cgTargetFor(position),
                title: 'Regenerate CG',
                draft: cgDraft(current, position, tags),
                seed: seedPrefillFor(current, cgTargetFor(position))
              }))
            }
            onCustomCgs={() => setCustomCgs(true)}
            onClose={() => setGallery(false)}
          />
        )}
        {roomGallery && (
          <ImageGalleryModal
            key="room"
            charId={charId}
            kind="room"
            theme={theme}
            uploadEnabled
            onClose={() => setRoomGallery(false)}
          />
        )}
        {customs && (
          <CustomOutfitsModal
            key="customs"
            theme={theme}
            columnOf={(slot) => columnFor(slot, slot, outfitLabelOf(character, slot))}
            taken={customsTaken}
            addDead={setBlocked(customOutfitSlotAt(1))}
            onClose={() => setCustoms(false)}
          />
        )}
        {/* Every render it starts goes through the dirty gate as a set's does. */}
        {customCgs && (
          <CustomCgsModal
            key="custom-cgs"
            charId={charId}
            theme={theme}
            renderable={cgPairsRenderable}
            onCreate={(slot) => requestSet('generate', slot, 'fill')}
            onFill={(slot) => requestSet('generate', slot, 'fill')}
            onRegeneratePair={(slot) => requestSet('regenerate', slot, 'regenerate')}
            onRegenerateAfter={(slot) =>
              requestSingle(cgTargetFor(afterOf(slot)), (current, _poseTags, tags) => ({
                target: cgTargetFor(afterOf(slot)),
                title: 'Regenerate CG',
                draft: cgDraft(current, afterOf(slot), tags),
                seed: seedPrefillFor(current, cgTargetFor(afterOf(slot))),
                lora: { value: customCgLoraOf(current, slot) }
              }))
            }
            onEdit={setEditingCg}
            onDelete={setDeletingCg}
            onCopy={webBuild ? undefined : (slot) => copyCustomCg(charId, slot)}
            onClose={() => setCustomCgs(false)}
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
        {fixing?.kind === 'erase' && (
          <EraseArtifactsModal
            key="erase-artifacts"
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

        {instructing !== null && (
          <OutfitInstructionsModal
            key="outfit-instructions"
            theme={theme}
            charId={charId}
            slot={instructing}
            onClose={() => setInstructing(null)}
          />
        )}

        {deletingCg !== null && (
          <ConfirmModal
            key="delete-cg"
            id="delete-cg"
            theme={theme}
            title={`Delete ${customCgLabelOf(character, deletingCg)}?`}
            message="Both of its CGs will be deleted."
            confirmText="Delete"
            busy={working}
            onConfirm={runDeleteCg}
            onCancel={() => setDeletingCg(null)}
          />
        )}

        {editingCg !== null && (
          <CustomCgEditModal
            key="custom-cg-edit"
            theme={theme}
            charId={charId}
            slot={editingCg}
            onClose={() => setEditingCg(null)}
          />
        )}

        {confirmingReset && (
          <ConfirmModal
            key="reset-default"
            id="edit-reset-confirm"
            theme={theme}
            title="Reset to default?"
            message={`${fullNameOf(character) || 'This character'}'s edits and all generated sprites will be permanently deleted.`}
            confirmText="Reset"
            busy={resetting}
            busyText="Resetting…"
            onConfirm={runReset}
            onCancel={() => setConfirmingReset(false)}
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
            // Taken down before the panel goes, so the two do not leave as one exiting child
            // rendered twice under the same key.
            onConfirm={() => {
              setClosing(false)
              onClose()
            }}
            onCancel={() => setClosing(false)}
          />
        )}
      </AnimatePresence>

      {/* One presence in wait mode, so the tag modal never arrives over the confirm that
          hands it the run, still fading. It stands beside the other presence rather than
          inside it, because a presence that is always rendered inside another is rendered
          twice when the parent leaves, and the parent then never finishes leaving. */}
      <AnimatePresence propagate mode="wait">
        {loraMissing !== null && (
          <ConfirmModal
            key="lora-missing"
            id="lora-missing"
            theme={theme}
            {...loraMissingCopy(fullNameOf(character), loraMissing.file)}
            onConfirm={() => {
              const answered = loraMissing
              setLoraMissing(null)
              answered.run()
            }}
            onCancel={() => setLoraMissing(null)}
          />
        )}

        {cgLoraMissing !== null && (
          <ConfirmModal
            key="cg-lora-missing"
            id="cg-lora-missing"
            theme={theme}
            {...positionLoraMissingCopy(cgLoraMissing.file)}
            onConfirm={() => {
              const answered = cgLoraMissing
              setCgLoraMissing(null)
              answered.run()
            }}
            onCancel={() => setCgLoraMissing(null)}
          />
        )}

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
              runSet(request.target, request.mode, request.withoutLora)
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
            defaults={regen.defaults}
            seed={regen.seed}
            name={regen.name}
            instructions={regen.instructions}
            sounds={regen.sounds}
            lora={regen.lora}
            requireGroup={regen.requireGroup}
            paste={regen.paste}
            submitLabel={regen.submitLabel}
            onConfirm={(edit, seed, name, instructions, sounds, lora) => {
              const request = regen
              setRegen(null)
              if (request === null) return
              void sendRender(request, edit, seed, name, instructions, sounds, lora)
            }}
            onCancel={() => setRegen(null)}
          />
        )}
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
