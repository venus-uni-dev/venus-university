import { volumesOf } from './audio'
import { endpointProblem, normalizeImageEndpoint, sameEndpointHost } from './endpoint'
import { appError } from './errors'
import { validateRecord, type ValidateRecordOptions } from './jsonValidate'
import {
  DEFAULT_IMAGE_ENDPOINT,
  defaultModelFor,
  defaultSecondaryModelFor,
  IMAGE_MODEL_ID,
  imageApiFor
} from './providers'
import type { MemoryBudgets, RendererSettings, Settings, SettingsPatch } from './types'

/** What the settings file must be, whichever store holds it, and how a patch merges over it. */

/** Schema version this build reads and writes. */
export const SETTINGS_SCHEMA_VERSION = 1

/**
 * What the settings must carry; the three keys, the custom endpoint's URL, model ids, effort,
 * tier and reply cap, its images URL and model, the two dev switches, the service tier, the
 * hand-edited stream switch, the hand-edited ComfyUI build, which ComfyUI draws with its URL
 * and both sources' model picks and LoRA weights, the default tags, Gemini's secondary model,
 * the group volumes, the browser build's key-remembering, the sampling fields, the memory and
 * secret budgets and the custom scene persona are all optional.
 */
const SETTINGS_REQUIRED: Record<
  keyof Omit<
    Settings,
    | 'apiKey'
    | 'endpointApiKey'
    | 'imageApiKey'
    | 'endpointUrl'
    | 'endpointModel'
    | 'endpointSecondaryModel'
    | 'reasoningEffort'
    | 'endpointServiceTier'
    | 'maxOutputTokens'
    | 'imageEndpointUrl'
    | 'imageModel'
    | 'freezeSeeds'
    | 'forceTime'
    | 'serviceTier'
    | 'streamResponses'
    | 'comfyGpu'
    | 'comfySource'
    | 'comfyUrl'
    | 'comfyModels'
    | 'comfyExternalModels'
    | 'comfyLoraWeight'
    | 'comfyExternalLoraWeight'
    | 'comfyTags'
    | 'checkUpdates'
    | 'fullscreen'
    | 'warnEndingInterrupt'
    | 'warnEndingEdit'
    | 'showProfilePictureInScenes'
    | 'askProfilePictureInScenes'
    | 'newGameWelcome'
    | 'updateAsVersion'
    | 'updateFeed'
    | 'secondaryModel'
    | 'secondaryModelFor'
    | 'volumes'
    | 'rememberKey'
    | 'temperature'
    | 'repetitionPenalty'
    | 'topP'
    | 'topK'
    | 'memoryBudgets'
    | 'secretBudget'
    | 'scenePersona'
  >,
  true
> = {
  schemaVersion: true,
  apiProvider: true,
  apiModel: true,
  thinkingLevel: true,
  comfyDeferred: true,
  noNsfwImages: true,
  lessNsfwText: true,
  sfwAsked: true,
  removedDefaults: true
}

/** How the settings are checked once they have been read. */
export const SETTINGS_READ: ValidateRecordOptions<Settings> = {
  label: 'settings.json',
  malformed: {
    code: 'SETTINGS_MALFORMED',
    message: 'settings.json is not valid JSON. Fix or delete the file to continue.'
  },
  schemaVersion: { code: 'SETTINGS_SCHEMA_VERSION' },
  expects: SETTINGS_SCHEMA_VERSION,
  required: SETTINGS_REQUIRED
}

/** The fields the upgrade reads and moves: which model each provider runs on, and the volumes. */
type UpgradeFields = Pick<
  Settings,
  | 'apiProvider'
  | 'apiModel'
  | 'secondaryModel'
  | 'endpointModel'
  | 'endpointSecondaryModel'
  | 'volumes'
>

/**
 * Settings an older build wrote brought up to this one, anything else coming back untouched.
 * The upgrades are applied in turn, and `upgraded` says whether any of them changed the record.
 */
export function upgradeSettings<T extends UpgradeFields>(
  settings: T
): { settings: T; upgraded: boolean } {
  const endpoint = upgradeEndpointModels(settings)
  const sound = upgradeNsfwSound(endpoint)
  const cast = upgradeCastSwitch(sound)
  return { settings: cast, upgraded: cast !== settings }
}

/**
 * A custom endpoint's model ids moved out of Gemini's fields where they name none of the
 * endpoint's own, Gemini's put back to its defaults and a blank Gemini second model moving as no
 * endpoint second model at all. Anything else is returned as it came.
 */
function upgradeEndpointModels<T extends UpgradeFields>(settings: T): T {
  if (settings.apiProvider !== 'openai' || settings.endpointModel !== undefined) return settings
  return {
    ...settings,
    endpointModel: settings.apiModel,
    ...(settings.secondaryModel ? { endpointSecondaryModel: settings.secondaryModel } : {}),
    apiModel: defaultModelFor('gemini').id,
    secondaryModel: defaultSecondaryModelFor('gemini').id
  }
}

/**
 * The retired NSFW sound switch dropped, a switched-on one becoming the NSFW slider at 0 with the
 * other groups where they stood. A record without the switch is returned as it came.
 */
function upgradeNsfwSound<T extends UpgradeFields>(settings: T): T {
  if (!('noNsfwSound' in settings)) return settings
  const { noNsfwSound, ...rest } = settings as T & { noNsfwSound?: unknown }
  if (noNsfwSound !== true) return rest as T
  return { ...rest, volumes: { ...volumesOf(settings.volumes), nsfw: 0 } } as T
}

/**
 * The retired switch that let the shipped cast be written in place dropped, whatever it held:
 * every build edits her now, and what the switch once wrote is the boot's cast check to find.
 */
function upgradeCastSwitch<T extends UpgradeFields>(settings: T): T {
  if (!('editPregens' in settings)) return settings
  const { editPregens: _retired, ...rest } = settings as T & { editPregens?: unknown }
  return rest as T
}

/** Raised when the settings are there but cannot be read. */
export const SETTINGS_UNREADABLE = {
  code: 'SETTINGS_UNREADABLE',
  message: 'Could not read settings.json.'
}

/** Factory defaults used when nothing has been saved yet. */
export function defaultSettings(): Settings {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    apiProvider: 'gemini',
    // From the provider table.
    apiModel: defaultModelFor('gemini').id,
    apiKey: '',
    thinkingLevel: defaultModelFor('gemini').defaultThinkingLevel,
    // The cheaper model the routable kinds run on. `secondaryModelFor` stays
    // absent beside it, which is what routes the default set (`DEFAULT_SECONDARY_KINDS`)
    // until the panel says otherwise.
    secondaryModel: defaultSecondaryModelFor('gemini').id,
    // `streamResponses`, `comfyGpu`, `updateAsVersion` and `updateFeed` are deliberately
    // absent: they are hand-edited switches, and absent is what resolves to streaming on, to
    // whichever GPU vendor the machine reports and to the real build on itch.io. `serviceTier`
    // is absent too, and absent is priority; so is `checkUpdates`, absent being offering,
    // `fullscreen`, absent being fullscreen, and `newGameWelcome`, absent being welcoming.
    comfyDeferred: false,
    // Nothing is withheld until the player says so; an unanswered `sfwAsked` raises the question.
    noNsfwImages: false,
    lessNsfwText: false,
    sfwAsked: false,
    removedDefaults: []
  }
}

/** Strips all three secrets, leaving only whether each is set — the renderer's view. */
export function redactSettings(settings: Settings): RendererSettings {
  const { apiKey, endpointApiKey, imageApiKey, ...rest } = settings
  return {
    ...rest,
    apiKeySet: Boolean(apiKey),
    endpointApiKeySet: Boolean(endpointApiKey),
    imageApiKeySet: Boolean(imageApiKey)
  }
}

/** The model id the writer runs on: a custom endpoint's typed id, or Gemini's pick. */
export function writerModelOf(
  settings: Pick<Settings, 'apiProvider' | 'apiModel' | 'endpointModel'>
): string {
  return settings.apiProvider === 'openai' ? (settings.endpointModel ?? '') : settings.apiModel
}

/** The second model the active provider routes to, empty where there is none. */
export function secondaryModelOf(
  settings: Pick<Settings, 'apiProvider' | 'secondaryModel' | 'endpointSecondaryModel'>
): string {
  return (
    (settings.apiProvider === 'openai'
      ? settings.endpointSecondaryModel
      : settings.secondaryModel) ?? ''
  )
}

/**
 * Whether the writer can be called: Gemini needs its key; a custom endpoint needs a URL that
 * can be sent to and a model id, and may run without a key. `keySet` is `Boolean(apiKey)`
 * where the key is held and `apiKeySet` where it is not.
 */
export function writerReady(
  settings: Pick<Settings, 'apiProvider' | 'apiModel' | 'endpointModel' | 'endpointUrl'>,
  keySet: boolean
): boolean {
  if (settings.apiProvider !== 'openai') return keySet
  return (
    endpointProblem(settings.endpointUrl ?? '') === null && writerModelOf(settings).trim() !== ''
  )
}

/** Whether a custom endpoint's pictures are asked at Google's own host, where the Gemini key belongs. */
function picturesOnGoogle(settings: Pick<Settings, 'imageEndpointUrl'>): boolean {
  return imageApiFor(imageEndpointOf(settings)) === 'gemini'
}

/**
 * The key the cloud pictures are drawn with, empty where there is none: the Gemini key under
 * Gemini; under a custom endpoint its images key, else the Gemini key on Google's own host, else
 * the endpoint's own key wherever the images URL points.
 */
export function pictureKeyOf(settings: Settings): string {
  if (settings.apiProvider !== 'openai') return settings.apiKey
  return (
    settings.imageApiKey ||
    (picturesOnGoogle(settings) ? settings.apiKey : '') ||
    settings.endpointApiKey ||
    ''
  )
}

/** The renderer's answer to the same question, off the presence flags. */
export function pictureKeySet(settings: RendererSettings): boolean {
  if (settings.apiProvider !== 'openai') return settings.apiKeySet
  return (
    settings.imageApiKeySet ||
    (picturesOnGoogle(settings) && settings.apiKeySet) ||
    settings.endpointApiKeySet
  )
}

/** The root a custom endpoint's pictures are asked at: the one stored, or Gemini's own. */
export function imageEndpointOf(settings: Pick<Settings, 'imageEndpointUrl'>): string {
  return normalizeImageEndpoint(settings.imageEndpointUrl ?? '') || DEFAULT_IMAGE_ENDPOINT
}

/** The model a custom endpoint's pictures are drawn on: the one stored, or the room model. */
export function imageModelOf(settings: Pick<Settings, 'imageModel'>): string {
  return settings.imageModel?.trim() || IMAGE_MODEL_ID
}

/** Why a custom endpoint's typed image fields can be neither saved nor tried, or null where they can. */
export function imageFieldsProblem(imageEndpointUrl: string, imageModel: string): string | null {
  const url = endpointProblem(imageEndpointUrl, 'images endpoint URL')
  if (url !== null) return url
  return imageModel.trim() === '' ? 'Enter an images model.' : null
}

/**
 * The typed image fields as a save writes them: a URL naming Gemini's own root and the room model
 * are each stored absent, so a later default reaches a player who never changed either.
 */
export function imageFieldsToStore(
  imageEndpointUrl: string,
  imageModel: string
): Pick<SettingsPatch, 'imageEndpointUrl' | 'imageModel'> {
  const url = normalizeImageEndpoint(imageEndpointUrl)
  const model = imageModel.trim()
  return {
    imageEndpointUrl: url && url !== DEFAULT_IMAGE_ENDPOINT ? url : undefined,
    imageModel: model && model !== IMAGE_MODEL_ID ? model : undefined
  }
}

/** The key the writer runs on: a custom endpoint's own, or the Gemini key. */
export function writerKeyOf(settings: Settings): string {
  return settings.apiProvider === 'openai' ? (settings.endpointApiKey ?? '') : settings.apiKey
}

/**
 * The reply cap as stored whichever provider writes, and undefined where there is none. The file
 * is hand-editable, so anything but a positive whole number reads as absent.
 */
export function storedMaxOutputTokens(
  settings: Pick<Settings, 'maxOutputTokens'>
): number | undefined {
  const cap = settings.maxOutputTokens
  return typeof cap === 'number' && Number.isInteger(cap) && cap > 0 ? cap : undefined
}

/** The reply cap a custom endpoint is sent, and undefined wherever the pinned ceiling stands instead. */
export function maxOutputTokensOf(
  settings: Pick<Settings, 'apiProvider' | 'maxOutputTokens'>
): number | undefined {
  return settings.apiProvider === 'openai' ? storedMaxOutputTokens(settings) : undefined
}

/** The one line naming why the reply cap's typed text is not sendable; blank is never a problem. */
export function maxOutputTokensProblem(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (!/^\d+$/.test(trimmed) || Number(trimmed) === 0) {
    return 'Max output tokens must be a whole number above 0'
  }
  return null
}

/** The reply cap's typed text as the number it sends; blank is not sent at all. */
export function parseMaxOutputTokens(text: string): number | undefined {
  const trimmed = text.trim()
  return trimmed === '' ? undefined : Number(trimmed)
}

/**
 * Whether the stored endpoint key still belongs to the endpoint `endpointUrl` names: it was
 * typed for one origin and never follows the player to another host.
 */
export function endpointKeyStays(
  current: Pick<Settings, 'endpointUrl'>,
  endpointUrl: string | undefined
): boolean {
  return sameEndpointHost(current.endpointUrl ?? '', endpointUrl ?? '')
}

/** The stored endpoint key where a probe of `endpointUrl` may use it, else undefined. */
export function storedEndpointKeyFor(stored: Settings, endpointUrl: string): string | undefined {
  return endpointKeyStays(stored, endpointUrl) ? stored.endpointApiKey || undefined : undefined
}

/**
 * Whether the stored images key still belongs to the images root `imageEndpointUrl` names, an
 * absent one on either side being Gemini's own: it was typed for one origin and never follows
 * the player to another host.
 */
export function imageKeyStays(
  current: Pick<Settings, 'imageEndpointUrl'>,
  imageEndpointUrl: string | undefined
): boolean {
  return sameEndpointHost(imageEndpointOf(current), imageEndpointOf({ imageEndpointUrl }))
}

/** The stored images key where a probe of `imageEndpointUrl` may use it, else undefined. */
export function storedImageKeyFor(stored: Settings, imageEndpointUrl: string): string | undefined {
  return imageKeyStays(stored, imageEndpointUrl) ? stored.imageApiKey || undefined : undefined
}

/**
 * The three secrets a patch leaves behind. An absent field keeps the stored key: the Gemini key
 * whichever provider writes, and the endpoint's and the images key each only while the patch
 * still names the origin it was typed for.
 */
function secretsAfter(
  current: Settings,
  patch: SettingsPatch
): Pick<Settings, 'apiKey' | 'endpointApiKey' | 'imageApiKey'> {
  return {
    apiKey: patch.apiKey ?? current.apiKey,
    endpointApiKey:
      patch.endpointApiKey ??
      (endpointKeyStays(current, patch.endpointUrl) ? current.endpointApiKey : undefined),
    imageApiKey:
      patch.imageApiKey ??
      (imageKeyStays(current, patch.imageEndpointUrl) ? current.imageApiKey : undefined)
  }
}

/** The settings a renderer patch leaves behind, merged over the stored ones. */
export function mergePatch(current: Settings, patch: SettingsPatch): Settings {
  return {
    ...current,
    apiProvider: patch.apiProvider,
    apiModel: patch.apiModel,
    thinkingLevel: patch.thinkingLevel,
    secondaryModel: patch.secondaryModel,
    secondaryModelFor: patch.secondaryModelFor,
    // Every custom-endpoint field rides every patch, so a provider switched away and back finds
    // them as they were. The model id is written even blank, so no file this build writes is
    // taken for one to upgrade.
    endpointUrl: patch.endpointUrl,
    endpointModel: patch.endpointModel ?? '',
    endpointSecondaryModel: patch.endpointSecondaryModel,
    reasoningEffort: patch.reasoningEffort,
    // Absent stays absent, and absent is not sent.
    endpointServiceTier: patch.endpointServiceTier,
    maxOutputTokens: patch.maxOutputTokens,
    imageEndpointUrl: patch.imageEndpointUrl,
    imageModel: patch.imageModel,
    // Absent stays absent, and absent is priority.
    serviceTier: patch.serviceTier,
    // `streamResponses`, `comfyGpu`, `updateAsVersion` and `updateFeed` are not the renderer's
    // to send: `...current` is what carries whatever is stored, so a hand-edited switch survives
    // every save.
    comfyDeferred: patch.comfyDeferred,
    // Absent stays absent, and absent is the app's own ComfyUI, the default URL, the shipped
    // models, the default LoRA weight and the shipped default tags.
    comfySource: patch.comfySource,
    comfyUrl: patch.comfyUrl,
    comfyModels: patch.comfyModels,
    comfyExternalModels: patch.comfyExternalModels,
    comfyLoraWeight: patch.comfyLoraWeight,
    comfyExternalLoraWeight: patch.comfyExternalLoraWeight,
    comfyTags: patch.comfyTags,
    // Absent stays absent, and absent is offering.
    checkUpdates: patch.checkUpdates,
    // Absent stays absent, and absent is fullscreen.
    fullscreen: patch.fullscreen,
    // Absent stays absent, and absent is warning.
    warnEndingInterrupt: patch.warnEndingInterrupt,
    warnEndingEdit: patch.warnEndingEdit,
    // Absent stays absent, and absent is off and asking.
    showProfilePictureInScenes: patch.showProfilePictureInScenes,
    askProfilePictureInScenes: patch.askProfilePictureInScenes,
    // Absent stays absent, and absent is welcoming.
    newGameWelcome: patch.newGameWelcome,
    noNsfwImages: patch.noNsfwImages,
    lessNsfwText: patch.lessNsfwText,
    sfwAsked: patch.sfwAsked,
    // Absent stays absent, `JSON.stringify` dropping the key, which is full volume.
    volumes: patch.volumes,
    // The browser build's opt-in, which decides whether the keys are written beside the rest.
    rememberKey: patch.rememberKey,
    // Absent stays absent, and absent is not sent.
    temperature: patch.temperature,
    repetitionPenalty: patch.repetitionPenalty,
    topP: patch.topP,
    topK: patch.topK,
    // Absent stays absent, and absent is the default budgets.
    memoryBudgets: patch.memoryBudgets,
    secretBudget: patch.secretBudget,
    // Absent stays absent, and absent is the shipped persona.
    scenePersona: patch.scenePersona,
    ...secretsAfter(current, patch)
  }
}

/**
 * The ComfyUI fields, which name a server and files on one machine, and the tags written for the
 * models picked there, and so stay its own.
 */
const COMFY_FIELDS = [
  'comfySource',
  'comfyUrl',
  'comfyModels',
  'comfyExternalModels',
  'comfyLoraWeight',
  'comfyExternalLoraWeight',
  'comfyTags'
] as const

/**
 * The settings a restore leaves behind: the backup's, checked as the stored settings are and
 * brought up to this build, merged over `current` as a renderer patch is — so the keys, the dev
 * switches and the hand-edited switches stay the install's, as do whether the browser keeps
 * keys at all and which ComfyUI draws with what, under which default tags — with the roster's
 * removals the backup's.
 * Refuses with `malformed` before anything is written.
 */
export function settingsFromBackup(
  current: Settings,
  carried: unknown,
  malformed: { code: string; message: string }
): Settings {
  const checked = validateRecord<Settings>(carried, 'settings', {
    ...SETTINGS_READ,
    label: "That backup's settings record",
    malformed,
    schemaVersion: { code: malformed.code }
  })
  if (!Array.isArray(checked.removedDefaults)) {
    throw appError(malformed.code, malformed.message, 'settings.removedDefaults is not a list.')
  }

  const {
    apiKey: _key,
    endpointApiKey: _endpointKey,
    imageApiKey: _imageKey,
    apiKeySet: _flag,
    endpointApiKeySet: _endpointFlag,
    imageApiKeySet: _imageFlag,
    schemaVersion: _version,
    removedDefaults,
    rememberKey: _carriedRemember,
    ...patch
  } = upgradeSettings(checked as Settings & Partial<RendererSettings>).settings
  const { rememberKey: _patchedRemember, ...merged } = mergePatch(current, patch)
  const comfy: Partial<Settings> = {}
  for (const field of COMFY_FIELDS) {
    delete (merged as Partial<Settings>)[field]
    if (current[field] !== undefined) Object.assign(comfy, { [field]: current[field] })
  }
  return {
    ...merged,
    ...(current.rememberKey !== undefined ? { rememberKey: current.rememberKey } : {}),
    ...comfy,
    removedDefaults: removedDefaults.filter((id): id is string => typeof id === 'string')
  }
}

/** One sampling value a custom endpoint's chat-completions body can carry. */
export type SamplingKey = 'temperature' | 'repetitionPenalty' | 'topP' | 'topK'

/** What one sampling field is called on the wire and on screen, and the range it is checked against. */
export interface SamplingField {
  key: SamplingKey
  /** The chat-completions body key. */
  wire: string
  /** What the field is called on screen and in its problem line. */
  label: string
  min: number
  /** True where `min` itself is refused. */
  minExclusive: boolean
  /** Absent where there is no upper bound. */
  max?: number
  whole: boolean
}

/** In the order the modal shows them. */
export const SAMPLING_FIELDS: readonly SamplingField[] = [
  {
    key: 'temperature',
    wire: 'temperature',
    label: 'Temperature',
    min: 0,
    minExclusive: false,
    max: 2,
    whole: false
  },
  {
    key: 'repetitionPenalty',
    wire: 'repetition_penalty',
    label: 'Repetition Penalty',
    min: 0,
    minExclusive: true,
    max: 3,
    whole: false
  },
  { key: 'topP', wire: 'top_p', label: 'Top_p', min: 0, minExclusive: true, max: 1, whole: false },
  { key: 'topK', wire: 'top_k', label: 'Top_k', min: 0, minExclusive: false, whole: true }
]

/** Whether a parsed number satisfies one field's whole/bounds rule. */
function inSamplingBounds(field: SamplingField, value: number): boolean {
  if (field.whole && !Number.isInteger(value)) return false
  if (field.minExclusive ? value <= field.min : value < field.min) return false
  if (field.max !== undefined && value > field.max) return false
  return true
}

/** The one problem line a field's bounds amount to, built from the table so it can't drift. */
function samplingBoundsMessage(field: SamplingField): string {
  const kind = field.whole ? 'whole number' : 'number'
  if (field.max === undefined) return `${field.label} must be a ${kind}`
  const from = field.minExclusive ? `above ${field.min}, up to` : `from ${field.min} to`
  return `${field.label} must be a ${kind} ${from} ${field.max}`
}

/** Whether `text` is a plain decimal number, `.9` and `1.` included; rejects `"1e3"`, `"abc"` and blank. */
export const PLAIN_NUMBER = /^-?(\d+\.?\d*|\.\d+)$/

/** The one line naming why a sampling field's typed text is not sendable; blank is never a problem. */
export function samplingProblem(key: SamplingKey, text: string): string | null {
  const field = SAMPLING_FIELDS.find((f) => f.key === key)
  if (!field) return null
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (!PLAIN_NUMBER.test(trimmed) || !inSamplingBounds(field, Number(trimmed))) {
    return samplingBoundsMessage(field)
  }
  return null
}

/** A sampling field's typed text as the number it sends; blank is not sent at all. */
export function parseSampling(_key: SamplingKey, text: string): number | undefined {
  const trimmed = text.trim()
  return trimmed === '' ? undefined : Number(trimmed)
}

/**
 * The sampling values a custom endpoint's call carries, under their wire keys — `{}` under
 * Gemini, and under an out-of-bounds or non-numeric stored value the file is hand-editable, so
 * junk reads as absent.
 */
export function samplingOf(
  settings: Pick<Settings, 'apiProvider' | SamplingKey>
): Record<string, number> {
  if (settings.apiProvider !== 'openai') return {}
  const out: Record<string, number> = {}
  for (const field of SAMPLING_FIELDS) {
    const value = settings[field.key]
    if (typeof value === 'number' && Number.isFinite(value) && inSamplingBounds(field, value)) {
      out[field.wire] = value
    }
  }
  return out
}

/** Which cast size a memory budget is asked about. */
export type MemoryBudgetKey = 'one' | 'two' | 'three'

/** How many memories per character a cast scene carries when nothing is stored. */
export const DEFAULT_MEMORY_BUDGETS: Required<MemoryBudgets> = { one: 20, two: 10, three: 5 }

/** The one line naming why a memory budget's typed text is not a sendable count; blank is never a problem. */
export function memoryBudgetProblem(label: string, text: string): string | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (!/^\d+$/.test(trimmed) || Number(trimmed) > 999) {
    return `${label} must be a whole number from 0 to 999`
  }
  return null
}

/** A memory budget's typed text as the number it sends; blank is not sent at all. */
export function parseMemoryBudget(text: string): number | undefined {
  const trimmed = text.trim()
  return trimmed === '' ? undefined : Number(trimmed)
}

/** The three memory budgets as stored, each falling back to its default where it is not a valid count. */
export function memoryBudgetsOf(settings: Pick<Settings, 'memoryBudgets'>): Required<MemoryBudgets> {
  const stored = settings.memoryBudgets ?? {}
  const budgets = { ...DEFAULT_MEMORY_BUDGETS }
  for (const key of Object.keys(DEFAULT_MEMORY_BUDGETS) as MemoryBudgetKey[]) {
    const value = stored[key]
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 999) {
      budgets[key] = value
    }
  }
  return budgets
}

/** How many of her told secrets a prompt carries when nothing is stored. */
export const DEFAULT_SECRET_BUDGET = 3

/** The secret budget as stored, falling back to its default where it is not a valid count. */
export function secretBudgetOf(settings: Pick<Settings, 'secretBudget'>): number {
  const value = settings.secretBudget
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 999
    ? value
    : DEFAULT_SECRET_BUDGET
}

/** Which of the three stored budgets a cast of `castSize` spends. */
export function memoryBudgetFor(budgets: Required<MemoryBudgets>, castSize: number): number {
  if (castSize >= 3) return budgets.three
  if (castSize === 2) return budgets.two
  return budgets.one
}
