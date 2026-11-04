import { useEffect, useRef, useState, type CSSProperties, type JSX, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { VOLUME_MAX, VOLUME_MIN, volumesOf, type AudioGroup, type Volumes } from '@shared/audio'
import { endpointProblem, normalizeEndpoint, normalizeImageEndpoint } from '@shared/endpoint'
import {
  ENDPOINT_SERVICE_TIERS,
  ENDPOINT_SERVICE_TIER_LABELS,
  SERVICE_TIER_LABELS,
  THINKING_LEVELS,
  THINKING_LEVEL_LABELS,
  defaultModelFor,
  endpointServiceTierFor,
  imageApiFor,
  modelFor,
  providerFor,
  serviceTierFor,
  thinkingLevelFor
} from '@shared/providers'
import {
  endpointKeyStays,
  imageEndpointOf,
  imageFieldsProblem,
  imageFieldsToStore,
  imageKeyStays,
  imageModelOf
} from '@shared/settingsRules'

import type {
  EndpointServiceTier,
  ProviderApi,
  ServiceTier,
  ThinkingLevel
} from '@shared/providers'
import type { PromptKind } from '@shared/promptKinds'
import type { RendererSettings, SettingsPatch } from '@shared/types'
import { ConfirmModal } from '../components/ConfirmModal'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { ComboField } from '../components/ComboField'
import { SelectField } from '../components/SelectField'
import { TextField } from '../components/TextField'
import { CheckField } from '../components/CheckField'
import { SfwCheckList } from '../components/SfwCheckList'
import { isWebBuild } from '../platform'
import {
  comfySourceOf,
  comfyUrlOf,
  comfyUrlProblem,
  DEFAULT_COMFY_URL,
  normalizeComfyUrl
} from '@shared/comfyModels'
import { CustomBackgroundsModal } from './CustomBackgroundsModal'
import { SettingsAdvancedTab } from './SettingsAdvancedTab'
import { SettingsComfyTab } from './SettingsComfyTab'
import { SystemPromptModal } from './SystemPromptModal'
import { GamepadIcon, ImageIcon, SlidersIcon, SparklesIcon } from './screenIcons'
import { useSettingsStore } from '../stores/settingsStore'
import { useAudioStore } from '../stores/audioStore'
import { applicationSettled } from '../stores/applicationStore'
import { lorebookSettled } from '../stores/lorebookStore'
import { usePhotoStore } from '../stores/photoStore'
import { useUiStore } from '../stores/uiStore'
import {
  fadeIn,
  gestures,
  lift,
  panelUnderTab,
  press,
  quietLift,
  quietPress,
  toggleLift,
  veilIn
} from './motion'
import { useEndpointProbe, useImageProbe } from './useEndpointProbe'
import { SFW_FIELDS, sfwValuesOf, type SfwKey } from './sfwFields'
import { VOLUME_FIELDS } from './volumeFields'
import { PROMPT_KIND_FIELDS, promptKindValuesOf, promptKindsFrom } from './promptKindFields'
import '../vu_styles/Settings.css'

export interface AppSettingsModalProps {
  /** Drawn by whatever opened this — a portal inherits neither palette nor state rules. */
  theme: 'day' | 'night'
  /**
   * How this closes, for the one caller that does not open it through the modal stack: the Game
   * View holds it as an arm of its own `OpenPanel`, so that `blocked` covers it and Enter cannot
   * reach the line behind it. Absent is the menu's own route, which closes the stack.
   */
  onClose?: () => void
}

/** How long a slider stands still before what it reads is written. */
const VOLUME_SETTLE_MS = 250

/** One page of the panel. */
type SettingsTab = 'game' | 'generation' | 'comfy' | 'advanced'

/** The tabs in the order they stand, each its mark over its word. */
const TABS: readonly { id: SettingsTab; word: string; Mark: () => JSX.Element }[] = [
  { id: 'game', word: 'Game', Mark: GamepadIcon },
  { id: 'generation', word: 'Generation', Mark: SparklesIcon },
  { id: 'comfy', word: 'ComfyUI', Mark: ImageIcon },
  { id: 'advanced', word: 'Advanced', Mark: SlidersIcon }
]

/** A page arriving as its tab is picked; leaving, it is simply hidden. */
const PAGE_IN = fadeIn(0, 0.25)

/**
 * Why Save cannot take a custom endpoint's typed fields, in the order the fields are met, or
 * null where it can. An endpoint or images URL that listed nothing checks no id, so a save made
 * before its list arrives is simply unchecked.
 */
function saveProblemOf(
  endpointUrl: string,
  modelId: string,
  secondaryId: string,
  modelIds: readonly string[],
  imageEndpointUrl: string,
  imageModel: string,
  imageModelIds: readonly string[]
): string | null {
  const url = endpointProblem(endpointUrl)
  if (url !== null) return url
  if (modelId === '') return 'Enter a model ID.'
  if (modelIds.length > 0 && !modelIds.includes(modelId)) {
    return `The endpoint does not list ${modelId}.`
  }
  if (secondaryId !== '' && modelIds.length > 0 && !modelIds.includes(secondaryId)) {
    return `The endpoint does not list ${secondaryId} for the secondary model.`
  }
  const images = imageFieldsProblem(imageEndpointUrl, imageModel)
  if (images !== null) return images
  const imageId = imageModel.trim()
  if (imageModelIds.length > 0 && !imageModelIds.includes(imageId)) {
    return `The images endpoint does not list ${imageId}.`
  }
  return null
}

/**
 * Settings as opened from the Main Menu and the Game View's gear icon, one tab at a time. A
 * select, a checkbox or a slider is written the moment it changes, and so is an Advanced field
 * as it is left; the typed fields — the endpoint, images and ComfyUI URLs, the model ids and the
 * keys — are staged here behind Save, and the way out is gated on those alone.
 */
export function AppSettingsModal({ theme, onClose }: AppSettingsModalProps): JSX.Element | null {
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const exportBackup = useSettingsStore((s) => s.exportBackup)
  const importBackup = useSettingsStore((s) => s.importBackup)
  const closeModal = useUiStore((s) => s.closeModal)
  const close = onClose ?? ((): void => closeModal('settings'))

  // Every picker below is held here and seeded from the store, so the column redresses itself
  // on the frame it is changed; the write follows.
  const [apiProvider, setApiProvider] = useState<ProviderApi>(
    () => settings?.apiProvider ?? 'gemini'
  )
  // Gemini's page, seeded from Gemini's own fields whichever provider is stored. `modelFor`
  // resolves through the provider table, so the select opens on one of its own options.
  const [apiModel, setApiModel] = useState(() =>
    settings ? modelFor('gemini', settings.apiModel).id : ''
  )
  const [thinkingLevel, setThinkingLevel] = useState(() =>
    settings
      ? thinkingLevelFor('gemini', settings.apiModel, settings.thinkingLevel)
      : defaultModelFor('gemini').defaultThinkingLevel
  )
  const [secondaryModel, setSecondaryModel] = useState(() => settings?.secondaryModel ?? '')
  // Resolved through Gemini's table, so an absent one opens on priority.
  const [serviceTier, setServiceTier] = useState<ServiceTier>(() =>
    serviceTierFor('gemini', settings?.serviceTier)
  )
  // A custom endpoint always names an effort: an absent one reads as minimal.
  const [reasoningEffort, setReasoningEffort] = useState<ThinkingLevel>(() =>
    thinkingLevelFor('openai', '', settings?.reasoningEffort ?? '')
  )
  // Its own tier, held blank for None: absent sends none.
  const [endpointTier, setEndpointTier] = useState<EndpointServiceTier | ''>(
    () => endpointServiceTierFor(settings?.endpointServiceTier) ?? ''
  )
  // Held as one record, absent on the record meaning all four.
  const [secondaryFor, setSecondaryFor] = useState<Record<PromptKind, boolean>>(() =>
    promptKindValuesOf(settings)
  )
  // Held as one record, rendered from `SFW_FIELDS`.
  const [sfw, setSfw] = useState<Record<SfwKey, boolean>>(() =>
    settings
      ? sfwValuesOf(settings)
      : { noNsfwImages: false, lessNsfwText: false }
  )
  // Heard on every tick and written once the hand has been still, so a drag is one write.
  const [volumes, setVolumes] = useState<Volumes>(() => volumesOf(settings?.volumes))
  // Only the browser keeps a key anywhere the player might not want it kept.
  const [remember, setRemember] = useState(settings?.rememberKey === true)
  // Absent on the record means the desktop does ask, so only an explicit false is off.
  const [checkUpdates, setCheckUpdates] = useState(settings?.checkUpdates !== false)
  // Likewise absent means the window opens fullscreen.
  const [fullscreen, setFullscreen] = useState(settings?.fullscreen !== false)
  // Likewise absent means a scene warns before an ending is interrupted.
  const [warnEndingInterrupt, setWarnEndingInterrupt] = useState(
    settings?.warnEndingInterrupt !== false
  )
  // And before a line is rewritten while an ending is under way.
  const [warnEndingEdit, setWarnEndingEdit] = useState(settings?.warnEndingEdit !== false)
  // And absent means the reader's picture stays out of scenes.
  const [showPicture, setShowPicture] = useState(settings?.showProfilePictureInScenes === true)

  // The typed fields, staged until Save. Each is the endpoint's own, seeded whichever provider
  // is stored, so a panel switched away and back finds them as they were.
  const [endpointUrl, setEndpointUrl] = useState(() => settings?.endpointUrl ?? '')
  const [modelIdText, setModelIdText] = useState(() => settings?.endpointModel ?? '')
  const [secondaryIdText, setSecondaryIdText] = useState(
    () => settings?.endpointSecondaryModel ?? ''
  )
  // Where the custom endpoint's pictures are drawn, seeded as they would be drawn now: Gemini's
  // own root and the room model wherever nothing else is stored.
  const [imageUrl, setImageUrl] = useState(() => (settings ? imageEndpointOf(settings) : ''))
  const [imageModelText, setImageModelText] = useState(() =>
    settings ? imageModelOf(settings) : ''
  )
  // The keys are the exception to the seeding: the renderer is never told any, so every key
  // field opens blank and a blank one at Save means "keep what is stored".
  const [geminiKey, setGeminiKey] = useState('')
  const [endpointKey, setEndpointKey] = useState('')
  const [imageKey, setImageKey] = useState('')

  // What a backup is doing, so the two buttons are dead while one of them is working.
  const [backingUp, setBackingUp] = useState(false)
  const [restoring, setRestoring] = useState(false)
  // Whether the gate in front of a restore is up: it writes over everything already here.
  const [confirmRestore, setConfirmRestore] = useState(false)
  // Whether the gate in front of putting every default tag back is up.
  const [confirmResetTags, setConfirmResetTags] = useState(false)
  // Whether the gate in front of leaving unsaved text behind is up.
  const [closing, setClosing] = useState(false)
  // Which tab is on screen.
  const [tab, setTab] = useState<SettingsTab>('game')
  // Where the player's own ComfyUI answers, staged like the endpoint's URL.
  const [comfyUrlText, setComfyUrlText] = useState(() => (settings ? comfyUrlOf(settings) : ''))
  // The first Advanced field holding a value it cannot take, said on the foot's line.
  const [advancedProblem, setAdvancedProblem] = useState<string | null>(null)
  // What commits every Advanced field still holding text it has not sent.
  const commitAdvanced = useRef<(() => Promise<void>) | null>(null)
  // What commits the LoRA weight and the tag wells while they hold text they have not sent.
  const commitComfy = useRef<(() => Promise<void>) | null>(null)
  // What puts every default tag back to the build's, once its gate is answered.
  const resetComfyTags = useRef<(() => void) | null>(null)
  // Whether the system prompt editor or the player's own backgrounds stand over this panel.
  const [editing, setEditing] = useState(false)
  const [backgrounds, setBackgrounds] = useState(false)
  // Holds off a second click while Save's write is in flight.
  const saving = useRef(false)
  // The layer inside the panel a combobox hangs its list on, once it is in the document.
  const [popupHost, setPopupHost] = useState<HTMLElement | null>(null)

  // Which page the column is drawn as, and what a typed field is checked against.
  const custom = apiProvider === 'openai'
  // The custom endpoint's typed model id, as it would be saved.
  const modelId = modelIdText.trim()

  // What the endpoint has answered — the rows under the two id fields and the last verdict —
  // asked on the staged fields as they stand.
  const probe = useEndpointProbe({
    enabled: custom,
    endpointUrl,
    endpointKey,
    modelId,
    reasoningEffort,
    endpointServiceTier: endpointTier || undefined
  })

  // Which image models the images URL serves and whether it draws at all, asked on the staged
  // image fields and the staged endpoint beside them, whose key a blank images key may draw on.
  const imageProbe = useImageProbe({
    enabled: custom,
    imageEndpointUrl: imageUrl,
    imageModel: imageModelText,
    imageKey,
    endpointUrl,
    endpointKey
  })

  // Where the sliders stand right now, read by every write and by the flush on the way out.
  const volumesRef = useRef(volumes)
  // The write a still-moving slider owes, and null once there is none.
  const volumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // A drag that was still settling when the panel went pays its write on the way out, enqueued
  // rather than awaited: the lane outlives this component.
  useEffect(
    () => () => {
      if (volumeTimer.current === null) return
      clearTimeout(volumeTimer.current)
      volumeTimer.current = null
      void useSettingsStore.getState().update({ volumes: volumesRef.current })
    },
    []
  )

  // The rows a panel entering the custom endpoint with sendable URLs already has, asked for
  // once. Every later ask is a field behind them being left, so the provider is the whole of
  // what re-runs this.
  useEffect(() => {
    void probe.refreshModels()
    void imageProbe.refreshModels()
  }, [apiProvider])

  // Whether the player's own ComfyUI draws, which is what puts its URL among the staged fields.
  const ownComfy = settings !== null && comfySourceOf(settings) === 'external'

  // Whether anything staged differs from what is stored. A key counts the moment there is
  // something in it, the renderer never being told what is held.
  const dirty =
    settings !== null &&
    ((ownComfy && normalizeComfyUrl(comfyUrlText) !== comfyUrlOf(settings)) ||
      (custom
        ? normalizeEndpoint(endpointUrl) !== (settings.endpointUrl ?? '') ||
          modelIdText.trim() !== (settings.endpointModel ?? '') ||
          secondaryIdText.trim() !== (settings.endpointSecondaryModel ?? '') ||
          normalizeImageEndpoint(imageUrl) !== imageEndpointOf(settings) ||
          imageModelText.trim() !== imageModelOf(settings) ||
          endpointKey.trim() !== '' ||
          imageKey.trim() !== '' ||
          geminiKey.trim() !== ''
        : geminiKey.trim() !== ''))

  /**
   * Leaves, the LoRA weight and every Advanced field still holding text it has not sent
   * committed on the way.
   */
  async function leave(): Promise<void> {
    await commitComfy.current?.()
    await commitAdvanced.current?.()
    close()
  }

  /** The gate in front of leaving, asked on Cancel, on Escape and on an outside click alike. */
  const requestClose = (): void => {
    if (dirty) setClosing(true)
    else void leave()
  }

  const { host, overlayProps } = useModalShell(requestClose)
  if (!host || !settings) return null

  // Where the key and the whole of the player's data live in the browser's own storage.
  const webBuild = isWebBuild()

  // Gemini's table, which only Gemini's page picks from; a custom endpoint's ids are typed.
  const models = providerFor('gemini').models
  // Off the held Gemini model: which levels are accepted is a per-model fact.
  const thinkingLevels = modelFor('gemini', apiModel).thinkingLevels
  // Gemini's queues, which are a provider fact rather than a model's.
  const serviceTiers = providerFor('gemini').serviceTiers
  // The browser has no ComfyUI, so it has no tab for one.
  const tabs = webBuild ? TABS.filter((entry) => entry.id !== 'comfy') : TABS

  // The custom endpoint's second typed id, as it would be saved.
  const secondaryId = secondaryIdText.trim()
  // Whether a second model is named at all, which is what the list of its calls hangs on.
  const secondaryPicked = custom ? secondaryId !== '' : secondaryModel !== ''

  // Why Save is dead, checked against the staged text alone. Gemini stages nothing that can
  // be wrong.
  const saveProblem =
    (custom
      ? saveProblemOf(
          endpointUrl,
          modelId,
          secondaryId,
          probe.modelIds,
          imageUrl,
          imageModelText,
          imageProbe.modelIds
        )
      : null) ?? (ownComfy ? comfyUrlProblem(comfyUrlText) : null)
  // The one line over the answers: the reason Save cannot take the form, else an Advanced field
  // whose value goes nowhere, else that there is something for Save to take, else nothing.
  const status = saveProblem ?? advancedProblem ?? (dirty ? 'Unsaved changes' : null)

  // Whether the endpoint's own saved key would be kept: only while the URL still names the
  // origin it was typed for.
  const endpointKeyStored = settings.endpointApiKeySet && endpointKeyStays(settings, endpointUrl)

  // Every key field opens blank — the renderer holds only the presence flags — so the
  // placeholder is what carries the state.
  const endpointKeyPlaceholder = endpointKeyStored
    ? 'Leave blank to keep your saved key'
    : 'Optional: only if the endpoint needs one'

  // A blank images key keeps the one saved while the staged URL is still its origin, else draws
  // on the Gemini key on Google's own host where one is saved, and otherwise on the endpoint's
  // key above.
  const imageKeyPlaceholder =
    settings.imageApiKeySet && imageKeyStays(settings, imageUrl)
      ? 'Leave blank to keep your saved key'
      : imageApiFor(imageUrl) === 'gemini' && settings.apiKeySet
        ? 'Leave blank to use your Google AI Studio key'
        : 'Leave blank to use the API key above'

  /**
   * The writer's rows, asked again as one of its fields is left, and the images rows with them
   * while a blank images key may draw on the endpoint's key.
   */
  function refreshEndpointModels(): void {
    void probe.refreshModels()
    if (imageKey.trim() === '') void imageProbe.refreshModels()
  }

  /**
   * Writes the fields a control has just changed. The mix is put back where the sliders stand
   * afterwards, a settings change otherwise re-asserting the stored levels over a live drag.
   */
  async function write(fields: Partial<SettingsPatch>): Promise<boolean> {
    const ok = await update(fields)
    useAudioStore.getState().setLiveVolumes(volumesRef.current)
    return ok
  }

  /** Puts a control back where the store stands, for a write that did not land. */
  function reseed(apply: (stored: RendererSettings) => void): (ok: boolean) => void {
    return (ok) => {
      const stored = useSettingsStore.getState().settings
      if (!ok && stored) apply(stored)
    }
  }

  /**
   * Which provider writes, and nothing else: each page opens on its own provider's picks as
   * they were left, so a provider switched away and back finds them unchanged.
   */
  function handleProviderChange(value: string): void {
    const next = value as ProviderApi
    setApiProvider(next)
    // The rows and the last verdicts belong to the page left behind.
    probe.reset()
    imageProbe.reset()
    void write({ apiProvider: next }).then(reseed((stored) => setApiProvider(stored.apiProvider)))
  }

  /** Gemini's model, with the level re-resolved against what the new model accepts. */
  function handleModelChange(value: string): void {
    const level = thinkingLevelFor('gemini', value, thinkingLevel)
    setApiModel(value)
    setThinkingLevel(level)
    void write({ apiModel: value, thinkingLevel: level }).then(
      reseed((stored) => {
        setApiModel(modelFor('gemini', stored.apiModel).id)
        setThinkingLevel(thinkingLevelFor('gemini', stored.apiModel, stored.thinkingLevel))
      })
    )
  }

  /** How hard Gemini thinks, on the levels the model above accepts. */
  function handleThinkingChange(value: string): void {
    const level = value as ThinkingLevel
    setThinkingLevel(level)
    void write({ thinkingLevel: level }).then(
      reseed((stored) =>
        setThinkingLevel(thinkingLevelFor('gemini', stored.apiModel, stored.thinkingLevel))
      )
    )
  }

  /** Which queue Gemini's text calls wait in. */
  function handleServiceTierChange(value: string): void {
    const tier = value as ServiceTier
    setServiceTier(tier)
    void write({ serviceTier: tier }).then(
      reseed((stored) => setServiceTier(serviceTierFor('gemini', stored.serviceTier)))
    )
  }

  /** Gemini's cheaper model, or none at all. */
  function handleSecondaryChange(value: string): void {
    setSecondaryModel(value)
    void write({ secondaryModel: value }).then(
      reseed((stored) => setSecondaryModel(stored.secondaryModel ?? ''))
    )
  }

  /** The effort a custom endpoint is asked for on every call. */
  function handleReasoningChange(value: string): void {
    const level = value as ThinkingLevel
    setReasoningEffort(level)
    void write({ reasoningEffort: level }).then(
      reseed((stored) =>
        setReasoningEffort(thinkingLevelFor('openai', '', stored.reasoningEffort ?? ''))
      )
    )
  }

  /** The queue a custom endpoint is asked for on every call, or none at all. */
  function handleEndpointTierChange(value: string): void {
    const tier = endpointServiceTierFor(value)
    setEndpointTier(tier ?? '')
    void write({ endpointServiceTier: tier }).then(
      reseed((stored) => setEndpointTier(endpointServiceTierFor(stored.endpointServiceTier) ?? ''))
    )
  }

  /** One of the calls the second model may take. */
  function handleSecondaryForChange(key: PromptKind, checked: boolean): void {
    const next = { ...secondaryFor, [key]: checked }
    setSecondaryFor(next)
    void write({ secondaryModelFor: promptKindsFrom(next) }).then(
      reseed((stored) => setSecondaryFor(promptKindValuesOf(stored)))
    )
  }

  /** A content toggle: the box that moved is the whole of what is written. */
  function handleSfwChange(next: Record<SfwKey, boolean>): void {
    const fields: Partial<SettingsPatch> = {}
    for (const key of Object.keys(next) as SfwKey[]) {
      if (next[key] !== sfw[key]) fields[key] = next[key]
    }
    setSfw(next)
    void write(fields).then(reseed((stored) => setSfw(sfwValuesOf(stored))))
  }

  /** Whether the browser keeps the keys between visits. */
  function handleRememberChange(checked: boolean): void {
    setRemember(checked)
    void write({ rememberKey: checked }).then(
      reseed((stored) => setRemember(stored.rememberKey === true))
    )
  }

  /** Whether a newer build the launch check finds is offered before the first screen. */
  function handleCheckUpdatesChange(checked: boolean): void {
    setCheckUpdates(checked)
    void write({ checkUpdates: checked }).then(
      reseed((stored) => setCheckUpdates(stored.checkUpdates !== false))
    )
  }

  /** Whether the window opens fullscreen; main switches the window to it as the write lands. */
  function handleFullscreenChange(checked: boolean): void {
    setFullscreen(checked)
    void write({ fullscreen: checked }).then(
      reseed((stored) => setFullscreen(stored.fullscreen !== false))
    )
  }

  /** Whether interjecting over a scene that has started its ending asks first. */
  function handleWarnEndingInterruptChange(checked: boolean): void {
    setWarnEndingInterrupt(checked)
    void write({ warnEndingInterrupt: checked }).then(
      reseed((stored) => setWarnEndingInterrupt(stored.warnEndingInterrupt !== false))
    )
  }

  /** Whether rewriting a chat-log line in a scene that has started its ending asks first. */
  function handleWarnEndingEditChange(checked: boolean): void {
    setWarnEndingEdit(checked)
    void write({ warnEndingEdit: checked }).then(
      reseed((stored) => setWarnEndingEdit(stored.warnEndingEdit !== false))
    )
  }

  /** Whether the reader's picture stands beside the box on a scene's narrated lines. */
  function handleShowPictureChange(checked: boolean): void {
    setShowPicture(checked)
    void write({ showProfilePictureInScenes: checked }).then(
      reseed((stored) => setShowPicture(stored.showProfilePictureInScenes === true))
    )
  }

  /** A group's slider: heard at once, and written once it has stood still for a moment. */
  function handleVolumeChange(key: AudioGroup, value: number): void {
    const next: Volumes = { ...volumesRef.current, [key]: value }
    volumesRef.current = next
    setVolumes(next)
    useAudioStore.getState().setLiveVolumes(next)
    if (volumeTimer.current !== null) clearTimeout(volumeTimer.current)
    volumeTimer.current = setTimeout(() => {
      volumeTimer.current = null
      void write({ volumes: volumesRef.current })
    }, VOLUME_SETTLE_MS)
  }

  /** Writes the staged text and leaves; a key field left blank keeps the key it stands for. */
  async function handleSave(): Promise<void> {
    if (saving.current) return
    saving.current = true
    const ok = await write({
      ...(custom
        ? {
            endpointUrl: normalizeEndpoint(endpointUrl) || undefined,
            endpointModel: modelId,
            endpointSecondaryModel: secondaryId,
            ...imageFieldsToStore(imageUrl, imageModelText)
          }
        : {}),
      ...(geminiKey.trim() ? { apiKey: geminiKey.trim() } : {}),
      ...(custom && endpointKey.trim() ? { endpointApiKey: endpointKey.trim() } : {}),
      ...(custom && imageKey.trim() ? { imageApiKey: imageKey.trim() } : {}),
      // The default address is stored absent, so a later default reaches a player who kept it.
      ...(ownComfy
        ? {
            comfyUrl:
              normalizeComfyUrl(comfyUrlText) === DEFAULT_COMFY_URL
                ? undefined
                : normalizeComfyUrl(comfyUrlText)
          }
        : {})
    })
    saving.current = false
    if (ok) await leave()
  }

  // Who writes the scenes: the app's own default, or any endpoint that speaks chat completions.
  // Everything else on the tab is read off this.
  const providerField = (
    <SelectField
      id="settings-provider"
      label="Provider"
      value={apiProvider}
      onChange={handleProviderChange}
      options={[
        { value: 'gemini', label: 'Google AI Studio (default)' },
        { value: 'openai', label: 'Custom (Compatible with Chat Completions/OpenAI)' }
      ]}
      hint={
        custom
          ? 'Please understand that I only test on Gemini API with Gemini Flash 3.6+ models and can\'t provide technical support for other APIs and models. If you are experiencing bad model output or long generation times, consider using Gemini Flash.'
          : undefined
      }
    />
  )

  // What a model picker of either provider shows: the cheaper model's calls, where one is named.
  const secondaryKinds = secondaryPicked && (
    <div className="vu-settings-kinds">
      <span className="vu-settings-kinds-head">Use it for</span>
      {PROMPT_KIND_FIELDS.map((field) => (
        <CheckField
          key={field.key}
          id={field.id}
          label={field.label}
          meta={field.note}
          checked={secondaryFor[field.key]}
          onChange={(checked) => handleSecondaryForChange(field.key, checked)}
        />
      ))}
    </div>
  )

  // Only the browser keeps a key anywhere the player might not want it kept; it covers every
  // key the tab takes, so it closes whichever column holds the last of them.
  const rememberField = webBuild && (
    <CheckField
      id="settings-remember-key"
      label="Remember my keys on this device"
      note="By default, your keys will be deleted every session. Enabling this setting will save your keys in browser storage so you won't have to type them in again next time. Warning: other itch.io games will be able to read your keys."
      checked={remember}
      onChange={handleRememberChange}
    />
  )

  /** One column of a tab: its fields scroll inside it, under a fade at its foot. */
  const column = (children: ReactNode): JSX.Element => (
    <div className="vu-settings-col">
      <div className="vu-scroll-box">
        <div className="vu-settings-fields">{children}</div>
        <div className="vu-scroll-fade" />
      </div>
    </div>
  )

  /** A tab's page, kept mounted so its typed text and its lists outlive a visit elsewhere. */
  const page = (id: SettingsTab, children: ReactNode): JSX.Element => (
    <motion.div
      id={`settings-page-${id}`}
      className="vu-settings-columns"
      role="tabpanel"
      aria-labelledby={`settings-tab-${id}`}
      hidden={tab !== id}
      variants={PAGE_IN}
      initial={false}
      animate={tab === id ? 'shown' : 'hidden'}
    >
      {children}
    </motion.div>
  )

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
          id="settings-modal"
          className="vu-settings vu-settings--split vu-paper"
          role="dialog"
          aria-modal="true"
          aria-label="Settings"
          variants={panelUnderTab}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.stopPropagation()
          }}
        >
          <TitleTab>Settings</TitleTab>

          {/* The tabs stand in the panel's round end: one control in as many states. */}
          <div className="vu-palette vu-palette--column vu-settings-tabs" role="tablist" aria-label="Settings">
            {tabs.map((entry) => {
              const on = tab === entry.id
              return (
                <motion.button
                  key={entry.id}
                  id={`settings-tab-${entry.id}`}
                  className={`vu-palette-btn${on ? ' vu-palette-btn--on' : ''}`}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-controls={`settings-page-${entry.id}`}
                  {...gestures(false, toggleLift, quietPress)}
                  onClick={() => setTab(entry.id)}
                >
                  <entry.Mark />
                  {entry.word}
                </motion.button>
              )
            })}
          </div>

          <div className="vu-settings-pages">
            {page(
              'game',
              <>
                {column(
                  <>
                    <span className="vu-settings-heading">Gameplay</span>
                    {/* Only the desktop has a build of itself to replace, and only it asks. */}
                    {!webBuild && (
                      <CheckField
                        id="settings-check-updates"
                        label="Ask to update on launch"
                        checked={checkUpdates}
                        onChange={handleCheckUpdatesChange}
                      />
                    )}
                    {/* Only the desktop has a window of its own to put fullscreen. */}
                    {!webBuild && (
                      <CheckField
                        id="settings-fullscreen"
                        label="Fullscreen"
                        checked={fullscreen}
                        onChange={handleFullscreenChange}
                      />
                    )}

                    <CheckField
                      id="settings-warn-ending-edit"
                      label="Warn when editing an ending scene"
                      checked={warnEndingEdit}
                      onChange={handleWarnEndingEditChange}
                    />

                    <CheckField
                      id="settings-warn-ending-interrupt"
                      label="Warn when interrupting an ending scene"
                      checked={warnEndingInterrupt}
                      onChange={handleWarnEndingInterruptChange}
                    />

                    <CheckField
                      id="settings-show-profile-picture"
                      label="Show profile picture in scenes"
                      checked={showPicture}
                      onChange={handleShowPictureChange}
                    />

                    <span className="vu-settings-heading vu-settings-group-heading">Content</span>

                    {/* Each toggle carries what turning it on costs; the note is the whole of
                        what the app promises about either setting. */}
                    <SfwCheckList fields={SFW_FIELDS} sfw={sfw} onChange={handleSfwChange} />

                    {/* One zip of everything this build keeps, and one read back over it. Both
                        builds write the same format, so a semester started in one goes on in
                        the other. */}
                    <span className="vu-settings-heading vu-settings-group-heading">Game data</span>
                    <div className="vu-settings-data">
                      <div className="vu-settings-data-actions">
                        <motion.button
                          id="settings-backup-export"
                          className="vu-pill"
                          type="button"
                          disabled={backingUp || restoring}
                          {...gestures(backingUp || restoring, quietLift, quietPress)}
                          onClick={() => {
                            setBackingUp(true)
                            void exportBackup().finally(() => setBackingUp(false))
                          }}
                        >
                          {backingUp ? 'Backing up…' : 'Back up game data'}
                        </motion.button>
                        <motion.button
                          id="settings-backup-import"
                          className="vu-pill"
                          type="button"
                          disabled={backingUp || restoring}
                          {...gestures(backingUp || restoring, quietLift, quietPress)}
                          onClick={() => setConfirmRestore(true)}
                        >
                          {restoring ? 'Restoring…' : 'Restore from backup'}
                        </motion.button>
                      </div>
                      <span className="vu-check-note">
                        {webBuild
                          ? "Web saves live in browser storage and can be accidentally wiped. It's highly recommended to regularly back up your saves."
                          : 'Saves are stored on disk in the data folder. "Back up game data" exports them as a portable zip file for transfer.'}
                      </span>
                    </div>
                  </>
                )}
                {column(
                  <>
                    <span className="vu-settings-heading">Sound</span>

                    {/* Each slider is heard as it moves and written once it stops. */}
                    <div className="vu-settings-sound">
                      {VOLUME_FIELDS.map((field) => (
                        <div className="vu-range-row" key={field.key}>
                          <span className="vu-range-label">{field.label}</span>
                          <input
                            id={field.id}
                            className="vu-range"
                            type="range"
                            min={VOLUME_MIN}
                            max={VOLUME_MAX}
                            step={1}
                            value={volumes[field.key]}
                            aria-label={field.label}
                            aria-valuetext={`${volumes[field.key]} percent`}
                            style={{ '--range-fill': `${volumes[field.key]}%` } as CSSProperties}
                            onChange={(e) => handleVolumeChange(field.key, Number(e.target.value))}
                          />
                          <span className="vu-range-reading">{volumes[field.key]}%</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}

            {page(
              'generation',
              custom ? (
                <>
                  {column(
                    <>
                      {providerField}

                      {/* The root every request is sent to. Leaving it asks the endpoint what it
                          serves, so the two id fields below have something to offer. */}
                      <TextField
                        id="settings-endpoint-url"
                        label="Endpoint URL"
                        hint="The base URL of a chat completions endpoint (usually ends in /v1)"
                        value={endpointUrl}
                        onChange={setEndpointUrl}
                        onBlur={refreshEndpointModels}
                      />

                      {/* The endpoint's own key, which never follows the player to another host. */}
                      <label className="vu-field vu-settings-key" htmlFor="settings-api-key">
                        <span className="vu-field-label">API key</span>
                        <input
                          id="settings-api-key"
                          className="vu-input"
                          type="password"
                          value={endpointKey}
                          onChange={(e) => setEndpointKey(e.target.value)}
                          onBlur={refreshEndpointModels}
                          placeholder={endpointKeyPlaceholder}
                        />
                      </label>

                      <ComboField
                        id="settings-model-id"
                        label="Model ID"
                        hint="If dropdown options are not appearing on click, please ensure the endpoint URL is correct."
                        value={modelIdText}
                        onChange={setModelIdText}
                        options={probe.modelIds}
                        popupHost={popupHost}
                      />

                      <SelectField
                        id="settings-reasoning-effort"
                        label="Reasoning effort"
                        hint="Sent with every call. Some servers reject the field outright, and only some models accept Minimal."
                        value={reasoningEffort}
                        onChange={handleReasoningChange}
                        options={THINKING_LEVELS.map((level) => ({
                          value: level,
                          label: THINKING_LEVEL_LABELS[level]
                        }))}
                      />

                      <SelectField
                        id="settings-endpoint-service-tier"
                        label="Service tier"
                        hint="Leave at None unless your provider offers service tiers. The regular tier is called Default on OpenAI and Standard on Google. Some servers reject tiers they don't recognize."
                        value={endpointTier}
                        onChange={handleEndpointTierChange}
                        options={[
                          { value: '', label: 'None (default)' },
                          ...ENDPOINT_SERVICE_TIERS.map((tier) => ({
                            value: tier,
                            label: ENDPOINT_SERVICE_TIER_LABELS[tier]
                          }))
                        ]}
                      />

                      <ComboField
                        id="settings-secondary-model-id"
                        label="Secondary model ID"
                        hint="Use a low-power model for less important calls. Set this to None for max quality if cost is not a concern. Recommended only for Solo scenes and exams."
                        value={secondaryIdText}
                        onChange={setSecondaryIdText}
                        options={probe.modelIds}
                        emptyOption="None (Use one model for everything)"
                        popupHost={popupHost}
                      />

                      {secondaryKinds}

                      {/* One tiny request on the fields as typed, so the endpoint answers for
                          them before a game does. */}
                      <div className="vu-test-row">
                        <motion.button
                          id="settings-test-connection"
                          className="vu-btn vu-btn--quiet"
                          type="button"
                          disabled={probe.testDead}
                          {...gestures(probe.testDead, quietLift, quietPress)}
                          onClick={() => void probe.runTest()}
                        >
                          Test connection
                        </motion.button>
                        {probe.testWord && <span className="vu-btn-sub">{probe.testWord}</span>}
                        {typeof probe.test === 'object' && (
                          <span className="vu-test-note">{probe.test.error.message}</span>
                        )}
                      </div>
                    </>
                  )}
                  {column(
                    <>
                      {/* Where the pictures are drawn: Gemini's own root speaks its native call,
                          anywhere else the Images API. Leaving it asks which image models it
                          serves, so the model field below has something to offer. */}
                      <TextField
                        id="settings-image-endpoint"
                        label="Images endpoint"
                        hint="This endpoint will be used for non-explicit image generations such as room BG and Bunnyboard photos."
                        value={imageUrl}
                        onChange={setImageUrl}
                        onBlur={() => void imageProbe.refreshModels()}
                      />

                      {/* Its own key, which never follows the player to another host; blank
                          draws on the Gemini key at Google's own host, else the endpoint's. */}
                      <label className="vu-field vu-settings-key" htmlFor="settings-image-api-key">
                        <span className="vu-field-label">Images API key</span>
                        <input
                          id="settings-image-api-key"
                          className="vu-input"
                          type="password"
                          value={imageKey}
                          onChange={(e) => setImageKey(e.target.value)}
                          onBlur={() => void imageProbe.refreshModels()}
                          placeholder={imageKeyPlaceholder}
                        />
                      </label>

                      <ComboField
                        id="settings-image-model"
                        label="Images API model"
                        value={imageModelText}
                        onChange={setImageModelText}
                        options={imageProbe.modelIds}
                        popupHost={popupHost}
                      />

                      {/* One real picture on the fields as typed, which the endpoint may bill. */}
                      <div className="vu-test-row">
                        <motion.button
                          id="settings-test-images"
                          className="vu-btn vu-btn--quiet"
                          type="button"
                          disabled={imageProbe.testDead}
                          {...gestures(imageProbe.testDead, quietLift, quietPress)}
                          onClick={() => void imageProbe.runTest()}
                        >
                          Test connection
                        </motion.button>
                        {imageProbe.testWord && (
                          <span className="vu-btn-sub">{imageProbe.testWord}</span>
                        )}
                        <span className="vu-check-note">On clicking "Test Connection", One test render will be sent.</span>
                        {typeof imageProbe.test === 'object' && (
                          <span className="vu-test-note">{imageProbe.test.error.message}</span>
                        )}
                      </div>

                      {rememberField}
                    </>
                  )}
                </>
              ) : (
                <>
                  {column(
                    <>
                      {providerField}
                      {/* The key Gemini writes on, and the one the pictures are drawn with. */}
                      <label className="vu-field vu-settings-key" htmlFor="settings-api-key">
                        <span className="vu-field-label">API key</span>
                        <input
                          id="settings-api-key"
                          className="vu-input"
                          type="password"
                          value={geminiKey}
                          onChange={(e) => setGeminiKey(e.target.value)}
                          placeholder={
                            settings.apiKeySet
                              ? 'Leave blank to keep your saved key'
                              : 'Required. Please generate one if you don\'t have one already.'
                          }
                        />
                      </label>
                      <SelectField
                        id="settings-model"
                        label="Model"
                        hint="The default model (Gemini 3.6) is recommended for free-tier keys. The latest model is recommended for paid keys. Downgrade the model version if you are running into connection errors. Using Flash Lite for the primary model is highly discouraged."
                        value={apiModel}
                        onChange={handleModelChange}
                        options={models.map((model) => ({ value: model.id, label: model.label }))}
                      />

                      <SelectField
                        id="settings-thinking-level"
                        label="Thinking"
                        hint="Recommended to be left at Low. Only 3.6 and older models support Minimal effort. Certain calls run with High thinking level no matter what is set here."
                        value={thinkingLevel}
                        onChange={handleThinkingChange}
                        options={thinkingLevels.map((level) => ({
                          value: level,
                          label: THINKING_LEVEL_LABELS[level]
                        }))}
                      />

                      <SelectField
                        id="settings-service-tier"
                        label="Service tier"
                        hint="Priority offers the highest quality at double the price of Standard. Flex is half the price of standard but you may experience long wait times."
                        value={serviceTier}
                        onChange={handleServiceTierChange}
                        options={serviceTiers.map((tier) => ({
                          value: tier,
                          label: SERVICE_TIER_LABELS[tier]
                        }))}
                      />
                    </>
                  )}
                  {column(
                    <>
                      {/* A cheaper model for the calls that can take one. The list of what it
                          writes is absent until there is a model to write anything, rather
                          than dead. */}
                      <SelectField
                        id="settings-secondary-model"
                        label="Secondary model"
                        hint="Use a low-power model for less important calls. Set this to None for max quality if cost is not a concern. Recommended only for Solo scenes and exams."
                        value={secondaryModel}
                        onChange={handleSecondaryChange}
                        options={[
                          { value: '', label: 'None (Use one model for everything)' },
                          ...models.map((model) => ({ value: model.id, label: model.label }))
                        ]}
                      />

                      {secondaryKinds}
                      {rememberField}
                    </>
                  )}
                </>
              )
            )}

            {/* The browser has no ComfyUI at all, so it has no tab for one. */}
            {!webBuild &&
              page(
                'comfy',
                <SettingsComfyTab
                  active={tab === 'comfy'}
                  url={comfyUrlText}
                  onUrlChange={setComfyUrlText}
                  commitRef={commitComfy}
                  resetTagsRef={resetComfyTags}
                  onResetTags={() => setConfirmResetTags(true)}
                />
              )}

            {page(
              'advanced',
              <SettingsAdvancedTab
                onProblemChange={setAdvancedProblem}
                commitRef={commitAdvanced}
                onEditPrompt={() => setEditing(true)}
                onBackgrounds={() => setBackgrounds(true)}
              />
            )}
          </div>

          <div className="vu-foot-stack">
            {/* Why Save is dead, an Advanced field's value going nowhere, or that there is
                something left for Save to take. */}
            <span className="vu-form-status">
              {status !== null && (
                <>
                  <span className="vu-form-dot vu-form-dot--warn" />
                  {status}
                </>
              )}
            </span>
            <div className="vu-foot">
              <motion.button
                id="settings-cancel"
                className="vu-btn vu-btn--quiet"
                type="button"
                {...gestures(false, quietLift, quietPress)}
                onClick={requestClose}
              >
                Cancel
              </motion.button>
              <motion.button
                id="settings-save"
                className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
                type="button"
                disabled={saveProblem !== null}
                {...gestures(saveProblem !== null, lift, press)}
                onClick={() => void handleSave()}
              >
                Save settings
              </motion.button>
            </div>
          </div>

          {/* The frame a combobox's floating list is placed against, over every column and
              taking no pointer of its own. */}
          <div className="vu-popups" ref={setPopupHost} />
        </motion.div>
      </motion.div>

      {/* Siblings of the veil, not children: a click inside one does not reach the veil's
          own handler through the React tree. */}
      <AnimatePresence propagate>
        {confirmRestore && (
          <ConfirmModal
            key="restore"
            id="settings-restore-confirm"
            theme={theme}
            title="Restore from backup?"
            message="All saves, settings, and characters will be overwritten. You may want to create a backup beforehand, just in case."
            confirmText="Restore"
            cancelText="Cancel"
            onCancel={() => setConfirmRestore(false)}
            onConfirm={() => {
              setConfirmRestore(false)
              setRestoring(true)
              // A restore swaps every save underneath a photo, a lorebook or a New Game still
              // being written.
              void usePhotoStore
                .getState()
                .cancelAll()
                .then(() => applicationSettled())
                .then(() => lorebookSettled())
                .then(() => importBackup())
                .finally(() => setRestoring(false))
            }}
          />
        )}

        {confirmResetTags && (
          <ConfirmModal
            key="reset-tags"
            id="settings-reset-tags-confirm"
            theme={theme}
            title="Reset default tags?"
            message="Every field under Default tags will go back to the tags the game ships with."
            confirmText="Reset"
            cancelText="Cancel"
            onCancel={() => setConfirmResetTags(false)}
            onConfirm={() => {
              setConfirmResetTags(false)
              resetComfyTags.current?.()
            }}
          />
        )}

        {closing && (
          <ConfirmModal
            key="discard"
            id="settings-discard"
            theme={theme}
            title="Discard changes?"
            message="Some settings have not been saved."
            confirmText="Discard changes"
            cancelText="Keep editing"
            // Taken down before the panel goes, so the two do not leave as one exiting child
            // rendered twice under the same key.
            onConfirm={() => {
              setClosing(false)
              void leave()
            }}
            onCancel={() => setClosing(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence propagate>
        {editing && (
          <SystemPromptModal key="system-prompt" theme={theme} onClose={() => setEditing(false)} />
        )}
      </AnimatePresence>
      <AnimatePresence propagate>
        {backgrounds && (
          <CustomBackgroundsModal
            key="custom-backgrounds"
            theme={theme}
            onClose={() => setBackgrounds(false)}
          />
        )}
      </AnimatePresence>
    </>,
    host
  )
}
