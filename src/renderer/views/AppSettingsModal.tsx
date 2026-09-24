import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { VOLUME_MAX, VOLUME_MIN, volumesOf, type AudioGroup, type Volumes } from '@shared/audio'
import { endpointProblem, normalizeEndpoint } from '@shared/endpoint'
import { MAX_OUTPUT_TOKENS } from '@shared/llm/adapter'
import {
  THINKING_LEVELS,
  THINKING_LEVEL_LABELS,
  defaultModelFor,
  defaultSecondaryModelFor,
  modelFor,
  providerFor,
  thinkingLevelFor
} from '@shared/providers'
import { endpointKeyStays, maxOutputTokensOf } from '@shared/settingsRules'

import type { ProviderApi, ThinkingLevel } from '@shared/providers'
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
import { useSettingsStore } from '../stores/settingsStore'
import { useAudioStore } from '../stores/audioStore'
import { useUiStore } from '../stores/uiStore'
import { gestures, lift, panelUnderTab, press, quietLift, quietPress, veilIn } from './motion'
import { useEndpointProbe } from './useEndpointProbe'
import { sfwValuesOf, type SfwKey } from './sfwFields'
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

/**
 * Why Save cannot take a custom endpoint's typed fields, in the order the fields are met, or
 * null where it can. An endpoint that listed nothing checks no id, so a save made before its
 * list arrives is simply unchecked, and a blank reply cap is the default rather than a fault.
 */
function saveProblemOf(
  endpointUrl: string,
  modelId: string,
  secondaryId: string,
  maxOutputText: string,
  modelIds: readonly string[]
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
  if (maxOutputText !== '' && (!/^\d+$/.test(maxOutputText) || Number(maxOutputText) === 0)) {
    return 'Enter a whole number of tokens, or leave it blank.'
  }
  return null
}

/**
 * Settings as opened from the Main Menu and the Game View's gear icon. A select, a checkbox or
 * a slider is written the moment it changes; the typed fields — the endpoint URL, the model ids,
 * the reply cap and the two keys — are staged here behind Save, and the way out is gated on
 * those alone.
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
  // `modelFor` resolves through the provider table, so the select opens on one of its own
  // options; under a custom endpoint it hands back whatever id is stored.
  const [apiModel, setApiModel] = useState(() =>
    settings ? modelFor(settings.apiProvider, settings.apiModel).id : ''
  )
  const [thinkingLevel, setThinkingLevel] = useState(() =>
    settings
      ? thinkingLevelFor(settings.apiProvider, settings.apiModel, settings.thinkingLevel)
      : defaultModelFor('gemini').defaultThinkingLevel
  )
  const [secondaryModel, setSecondaryModel] = useState(() => settings?.secondaryModel ?? '')
  // A custom endpoint always names an effort: an absent one reads as minimal.
  const [reasoningEffort, setReasoningEffort] = useState<ThinkingLevel>(() =>
    thinkingLevelFor('openai', '', settings?.reasoningEffort ?? '')
  )
  // Held as one record, absent on the record meaning all four.
  const [secondaryFor, setSecondaryFor] = useState<Record<PromptKind, boolean>>(() =>
    promptKindValuesOf(settings)
  )
  // Held as one record, rendered from `SFW_FIELDS`.
  const [sfw, setSfw] = useState<Record<SfwKey, boolean>>(() =>
    settings
      ? sfwValuesOf(settings)
      : { noNsfwImages: false, lessNsfwText: false, noNsfwSound: false }
  )
  // Heard on every tick and written once the hand has been still, so a drag is one write.
  const [volumes, setVolumes] = useState<Volumes>(() => volumesOf(settings?.volumes))
  // Only the browser keeps a key anywhere the player might not want it kept.
  const [remember, setRemember] = useState(settings?.rememberKey === true)
  // Absent on the record means the desktop does check, so only an explicit false is off.
  const [checkUpdates, setCheckUpdates] = useState(settings?.checkUpdates !== false)
  // Likewise absent means a scene warns before an ending is interrupted.
  const [warnEndingInterrupt, setWarnEndingInterrupt] = useState(
    settings?.warnEndingInterrupt !== false
  )

  // The typed fields, staged until Save. The URL and the two keys outlive a provider switch,
  // so a panel switched away and back finds them as they were; the ids are the endpoint's own.
  const [endpointUrl, setEndpointUrl] = useState(() => settings?.endpointUrl ?? '')
  const [modelIdText, setModelIdText] = useState(() =>
    settings?.apiProvider === 'openai' ? settings.apiModel : ''
  )
  const [secondaryIdText, setSecondaryIdText] = useState(() =>
    settings?.apiProvider === 'openai' ? (settings.secondaryModel ?? '') : ''
  )
  // The reply cap, seeded like the URL and outliving a provider switch with it; a stored cap
  // the resolver will not take opens the field blank, which is the ceiling it already sends.
  const [maxOutputText, setMaxOutputText] = useState(() =>
    settings ? String(maxOutputTokensOf(settings) ?? '') : ''
  )
  // The keys are the exception to the seeding: the renderer is never told either, so both
  // fields open blank and a blank one at Save means "keep what is stored".
  const [geminiKey, setGeminiKey] = useState('')
  const [endpointKey, setEndpointKey] = useState('')

  // What a backup is doing, so the two buttons are dead while one of them is working.
  const [backingUp, setBackingUp] = useState(false)
  const [restoring, setRestoring] = useState(false)
  // Whether the gate in front of a restore is up: it writes over everything already here.
  const [confirmRestore, setConfirmRestore] = useState(false)
  // Whether the gate in front of leaving unsaved text behind is up.
  const [closing, setClosing] = useState(false)
  // Whether Save's own write is in flight, which is the button's label and nothing else.
  const [busy, setBusy] = useState(false)
  // The layer inside the panel a combobox hangs its list on, once it is in the document.
  const [popupHost, setPopupHost] = useState<HTMLElement | null>(null)

  // Which page the column is drawn as, and what a typed field is checked against.
  const custom = apiProvider === 'openai'
  // The custom endpoint's typed model id, as it would be saved.
  const modelId = modelIdText.trim()
  // The typed reply cap, and the number it stands for — undefined where the field is blank or
  // holds what Save would refuse, so a probe never sends anything but a cap or nothing.
  const maxOutputCap = maxOutputText.trim()
  const parsedCap = /^\d+$/.test(maxOutputCap) ? Number(maxOutputCap) : NaN
  const maxOutputTokens = parsedCap > 0 ? parsedCap : undefined

  // What the endpoint has answered — the rows under the two id fields and the last verdict —
  // asked on the staged fields as they stand.
  const probe = useEndpointProbe({
    enabled: custom,
    endpointUrl,
    endpointKey,
    modelId,
    reasoningEffort,
    thinkingLevel,
    maxOutputTokens
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

  // The rows a panel entering the custom endpoint with a sendable URL already has, asked for
  // once. Every later ask is one of the two fields behind them being left, so the provider is
  // the whole of what re-runs this.
  useEffect(() => {
    void probe.refreshModels()
  }, [apiProvider])

  // Whether anything staged differs from what is stored. A key counts the moment there is
  // something in it, the renderer never being told what is held.
  const dirty =
    settings !== null &&
    (custom
      ? normalizeEndpoint(endpointUrl) !== (settings.endpointUrl ?? '') ||
        modelIdText.trim() !== settings.apiModel ||
        secondaryIdText.trim() !== (settings.secondaryModel ?? '') ||
        maxOutputText.trim() !== String(maxOutputTokensOf(settings) ?? '') ||
        endpointKey.trim() !== '' ||
        geminiKey.trim() !== ''
      : geminiKey.trim() !== '')

  /** The gate in front of leaving, asked on Cancel, on Escape and on an outside click alike. */
  const requestClose = (): void => {
    if (dirty) setClosing(true)
    else close()
  }

  const { host, overlayProps } = useModalShell(requestClose)
  if (!host || !settings) return null

  // Where the key and the whole of the player's data live in the browser's own storage.
  const webBuild = isWebBuild()

  // Off the held provider, so a select never holds another provider's model; a custom
  // endpoint's table is empty, which is why its ids are typed rather than picked.
  const models = providerFor(apiProvider).models
  // Likewise off the held model: which levels are accepted is a per-model fact.
  const thinkingLevels = modelFor(apiProvider, apiModel).thinkingLevels

  // The custom endpoint's second typed id, as it would be saved.
  const secondaryId = secondaryIdText.trim()
  // Whether a second model is named at all, which is what the list of its calls hangs on.
  const secondaryPicked = custom ? secondaryId !== '' : secondaryModel !== ''

  // Why Save is dead, checked against the staged text alone. Gemini stages nothing that can
  // be wrong.
  const saveProblem = custom
    ? saveProblemOf(endpointUrl, modelId, secondaryId, maxOutputCap, probe.modelIds)
    : null
  // The one line over the answers: the reason Save cannot take the form, else that there is
  // something for it to take, else nothing.
  const status = saveProblem ?? (dirty ? 'Unsaved changes' : null)

  // Whether the endpoint's own saved key would be kept: only while the URL still names the
  // origin it was typed for.
  const endpointKeyStored = settings.endpointApiKeySet && endpointKeyStays(settings, endpointUrl)

  // Both key fields open blank — the renderer holds only the two presence flags — so the
  // placeholder is what carries the state.
  const endpointKeyPlaceholder = endpointKeyStored
    ? 'Leave blank to keep your saved key'
    : 'Optional: only if the endpoint needs one'

  // The pictures run on the Gemini key whoever writes, so a key already saved is what they
  // would go on drawing with.
  const geminiKeyPlaceholder = settings.apiKeySet
    ? 'Leave blank to keep your saved key'
    : undefined

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

  /** The provider, and with it the defaults the page under it opens on. */
  function handleProviderChange(value: string): void {
    const next = value as ProviderApi
    const fallback = defaultModelFor('gemini')
    const fields: Partial<SettingsPatch> =
      next === 'openai'
        ? { apiProvider: next, apiModel: '', secondaryModel: '', reasoningEffort: 'minimal' }
        : {
            apiProvider: next,
            apiModel: fallback.id,
            thinkingLevel: fallback.defaultThinkingLevel,
            secondaryModel: defaultSecondaryModelFor('gemini').id
          }
    setApiProvider(next)
    if (next === 'openai') {
      setApiModel('')
      setSecondaryModel('')
      setReasoningEffort('minimal')
    } else {
      setApiModel(fallback.id)
      setThinkingLevel(fallback.defaultThinkingLevel)
      setSecondaryModel(defaultSecondaryModelFor('gemini').id)
    }
    // The ids, the rows behind them and the probe all belong to the endpoint left behind.
    setModelIdText('')
    setSecondaryIdText('')
    probe.reset()
    void write(fields).then(
      reseed((stored) => {
        setApiProvider(stored.apiProvider)
        setApiModel(modelFor(stored.apiProvider, stored.apiModel).id)
        setThinkingLevel(
          thinkingLevelFor(stored.apiProvider, stored.apiModel, stored.thinkingLevel)
        )
        setSecondaryModel(stored.secondaryModel ?? '')
        setReasoningEffort(thinkingLevelFor('openai', '', stored.reasoningEffort ?? ''))
      })
    )
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

  /** Whether the browser keeps the key between visits. */
  function handleRememberChange(checked: boolean): void {
    setRemember(checked)
    void write({ rememberKey: checked }).then(
      reseed((stored) => setRemember(stored.rememberKey === true))
    )
  }

  /** Whether the desktop asks itch.io for a newer build at every launch. */
  function handleCheckUpdatesChange(checked: boolean): void {
    setCheckUpdates(checked)
    void write({ checkUpdates: checked }).then(
      reseed((stored) => setCheckUpdates(stored.checkUpdates !== false))
    )
  }

  /** Whether interjecting over a scene that has started its ending asks first. */
  function handleWarnEndingInterruptChange(checked: boolean): void {
    setWarnEndingInterrupt(checked)
    void write({ warnEndingInterrupt: checked }).then(
      reseed((stored) => setWarnEndingInterrupt(stored.warnEndingInterrupt !== false))
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
    if (busy) return
    setBusy(true)
    const ok = await write({
      ...(custom
        ? {
            endpointUrl: normalizeEndpoint(endpointUrl) || undefined,
            apiModel: modelId,
            secondaryModel: secondaryId,
            maxOutputTokens
          }
        : {}),
      ...(geminiKey.trim() ? { apiKey: geminiKey.trim() } : {}),
      ...(custom && endpointKey.trim() ? { endpointApiKey: endpointKey.trim() } : {})
    })
    setBusy(false)
    if (ok) close()
  }

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
          className="vu-settings vu-paper"
          role="dialog"
          aria-modal="true"
          aria-label="Settings"
          variants={panelUnderTab}
        >
          <TitleTab>Settings</TitleTab>

          <div className="vu-settings-writer">
            <span className="vu-settings-heading">Generation</span>

            <div className="vu-scroll-box">
              <div className="vu-settings-fields">
                {/* Who writes the scenes: the app's own default, or any endpoint that speaks
                    chat completions. Everything under it is read off this. */}
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

                {custom && (
                  <>
                    {/* The root every request is sent to. Leaving it asks the endpoint what it
                        serves, so the two id fields below have something to offer. */}
                    <TextField
                      id="settings-endpoint-url"
                      label="Endpoint URL"
                      hint="https, or http for a server on this machine. Make sure the URL is a chat completions endpoint (usually contains /v1 or /v1/chat/completions)"
                      value={endpointUrl}
                      onChange={setEndpointUrl}
                      onBlur={() => void probe.refreshModels()}
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
                        onBlur={() => void probe.refreshModels()}
                        placeholder={endpointKeyPlaceholder}
                      />
                    </label>

                    <ComboField
                      id="settings-model-id"
                      label="Model ID"
                      hint="As the endpoint names it, for example a provider/model id"
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

                    <TextField
                      id="settings-max-output-tokens"
                      label="Max output tokens"
                      hint="A minimum of 12000 is recommended, though the game won't immediately break under this number."
                      placeholder={String(MAX_OUTPUT_TOKENS)}
                      value={maxOutputText}
                      onChange={setMaxOutputText}
                      maxLength={7}
                    />

                    <ComboField
                      id="settings-secondary-model-id"
                      label="Secondary model ID"
                      hint="Leave this blank to run every call on the model above."
                      value={secondaryIdText}
                      onChange={setSecondaryIdText}
                      options={probe.modelIds}
                      emptyOption="None (Use one model for everything)"
                      popupHost={popupHost}
                    />
                  </>
                )}

                {!custom && (
                  <>
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

                    {/* A cheaper model for the calls that can take one. The list of what it
                        writes is absent until there is a model to write anything, rather
                        than dead. */}
                    <SelectField
                      id="settings-secondary-model"
                      label="Secondary model"
                      hint="Use a low-power model for less important calls. Set this to None for max quality if cost is not a concern."
                      value={secondaryModel}
                      onChange={handleSecondaryChange}
                      options={[
                        { value: '', label: 'None (Use one model for everything)' },
                        ...models.map((model) => ({ value: model.id, label: model.label }))
                      ]}
                    />
                  </>
                )}

                {secondaryPicked && (
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
                )}

                {custom ? (
                  <>
                    {/* One tiny request on the fields as typed, so the endpoint answers for them
                        before a game does. */}
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

                    {/* The pictures are Gemini's whoever writes, so a custom endpoint asks for
                        the Gemini key beside its own. */}
                    <label className="vu-field vu-settings-key" htmlFor="settings-image-api-key">
                      <span className="vu-field-label">Gemini key for images</span>
                      <span className="vu-field-hint">
                        Room backgrounds and the final game CG are generated by Gemini&apos;s image
                        model, which a chat-completions endpoint cannot do. Without a key, these
                        features will be disabled. It is the same key the Google AI Studio provider
                        uses.
                      </span>
                      <input
                        id="settings-image-api-key"
                        className="vu-input"
                        type="password"
                        value={geminiKey}
                        onChange={(e) => setGeminiKey(e.target.value)}
                        placeholder={geminiKeyPlaceholder}
                      />
                    </label>
                  </>
                ) : (
                  /* The key Gemini writes on, and the one the pictures are drawn with. */
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
                )}

                {webBuild && (
                  <CheckField
                    id="settings-remember-key"
                    label="Remember my key on this device"
                    note="By default, your key will be deleted every session. Enabling this setting will save your key in browser storage so you won't have to type it in again next time. Warning: other itch.io games will be able to read your key."
                    checked={remember}
                    onChange={handleRememberChange}
                  />
                )}
              </div>
              <div className="vu-scroll-fade" />
            </div>
          </div>

          <div className="vu-settings-content">
            <span className="vu-settings-heading">Content</span>

            {/* Each toggle carries what turning it on costs; the note is the whole of what the
                app promises about either setting. */}
            <SfwCheckList sfw={sfw} onChange={handleSfwChange} />

            <CheckField
              id="settings-warn-ending-interrupt"
              label="Warn when interrupting an ending scene"
              note="Toggles the confirmation modal when interjecting at the end of a scene."
              checked={warnEndingInterrupt}
              onChange={handleWarnEndingInterruptChange}
            />

            <span className="vu-settings-heading vu-settings-sound-heading">Sound</span>

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

            {/* One zip of everything this build keeps, and one read back over it. Both builds
                write the same format, so a semester started in one goes on in the other. */}
            <span className="vu-settings-heading vu-settings-data-heading">Game data</span>
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

            {/* Only the desktop has a build of itself to replace, and only it asks. */}
            {!webBuild && (
              <CheckField
                id="settings-check-updates"
                label="Check for updates on launch"
                checked={checkUpdates}
                onChange={handleCheckUpdatesChange}
              />
            )}

            <div className="vu-foot-stack">
              {/* Why Save is dead, or that there is something left for it to take. */}
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
                  {busy ? 'Saving…' : 'Save settings'}
                </motion.button>
              </div>
            </div>
          </div>

          {/* The frame a combobox's floating list is placed against, over both columns and
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
              void importBackup().finally(() => setRestoring(false))
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
              close()
            }}
            onCancel={() => setClosing(false)}
          />
        )}
      </AnimatePresence>
    </>,
    host
  )
}
