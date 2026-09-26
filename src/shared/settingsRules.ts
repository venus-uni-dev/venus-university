import { endpointProblem, sameEndpointHost } from './endpoint'
import type { ValidateRecordOptions } from './jsonValidate'
import { defaultModelFor, defaultSecondaryModelFor } from './providers'
import type { RendererSettings, Settings, SettingsPatch } from './types'

/** What the settings file must be, whichever store holds it, and how a patch merges over it. */

/** Schema version this build reads and writes. */
export const SETTINGS_SCHEMA_VERSION = 1

/**
 * What the settings must carry; the two keys, the custom endpoint's URL, model ids, effort and
 * reply cap, the three dev switches, the two hand-edited call switches, the hand-edited ComfyUI
 * build, Gemini's secondary model, the group volumes, the NSFW sound switch and the browser
 * build's key-remembering are all optional.
 */
const SETTINGS_REQUIRED: Record<
  keyof Omit<
    Settings,
    | 'apiKey'
    | 'endpointApiKey'
    | 'endpointUrl'
    | 'endpointModel'
    | 'endpointSecondaryModel'
    | 'reasoningEffort'
    | 'maxOutputTokens'
    | 'freezeSeeds'
    | 'editPregens'
    | 'forceTime'
    | 'serviceTier'
    | 'streamResponses'
    | 'comfyGpu'
    | 'checkUpdates'
    | 'warnEndingInterrupt'
    | 'warnEndingEdit'
    | 'updateAsVersion'
    | 'updateFeed'
    | 'secondaryModel'
    | 'secondaryModelFor'
    | 'volumes'
    | 'noNsfwSound'
    | 'rememberKey'
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

/** The fields that say which model each provider runs on. */
type ModelFields = Pick<
  Settings,
  'apiProvider' | 'apiModel' | 'secondaryModel' | 'endpointModel' | 'endpointSecondaryModel'
>

/**
 * A custom endpoint's settings that name none of the endpoint's own model ids, their ids moved
 * out of Gemini's fields into the endpoint's and Gemini's put back to its defaults; anything else
 * comes back untouched. A blank Gemini second model moves as no endpoint second model at all.
 */
export function upgradeSettings<T extends ModelFields>(
  settings: T
): { settings: T; upgraded: boolean } {
  if (settings.apiProvider !== 'openai' || settings.endpointModel !== undefined) {
    return { settings, upgraded: false }
  }

  return {
    settings: {
      ...settings,
      endpointModel: settings.apiModel,
      ...(settings.secondaryModel ? { endpointSecondaryModel: settings.secondaryModel } : {}),
      apiModel: defaultModelFor('gemini').id,
      secondaryModel: defaultSecondaryModelFor('gemini').id
    },
    upgraded: true
  }
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
    // `serviceTier`, `streamResponses`, `comfyGpu`, `updateAsVersion` and `updateFeed` are
    // deliberately absent: they are hand-edited switches, and absent is what resolves to
    // priority, to streaming on, to whichever GPU vendor the machine reports and to the real
    // build on itch.io. `checkUpdates` is absent too, and absent is offering.
    comfyDeferred: false,
    // Nothing is withheld until the player says so; an unanswered `sfwAsked` raises the question.
    noNsfwImages: false,
    lessNsfwText: false,
    sfwAsked: false,
    removedDefaults: []
  }
}

/** Strips both secrets, leaving only whether each is set — the renderer's view. */
export function redactSettings(settings: Settings): RendererSettings {
  const { apiKey, endpointApiKey, ...rest } = settings
  return { ...rest, apiKeySet: Boolean(apiKey), endpointApiKeySet: Boolean(endpointApiKey) }
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

/** The Gemini key the cloud pictures are drawn with, empty where there is none. */
export function pictureKeyOf(settings: Settings): string {
  return settings.apiKey
}

/** The renderer's answer to the same question, off the presence flag. */
export function pictureKeySet(settings: RendererSettings): boolean {
  return settings.apiKeySet
}

/** The key the writer runs on: a custom endpoint's own, or the Gemini key. */
export function writerKeyOf(settings: Settings): string {
  return settings.apiProvider === 'openai' ? (settings.endpointApiKey ?? '') : settings.apiKey
}

/**
 * The reply cap a custom endpoint is sent, and undefined wherever the pinned ceiling stands
 * instead. The file is hand-editable, so anything but a positive whole number reads as absent.
 */
export function maxOutputTokensOf(
  settings: Pick<Settings, 'apiProvider' | 'maxOutputTokens'>
): number | undefined {
  if (settings.apiProvider !== 'openai') return undefined
  const cap = settings.maxOutputTokens
  return typeof cap === 'number' && Number.isInteger(cap) && cap > 0 ? cap : undefined
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
 * The two secrets a patch leaves behind. An absent field keeps the stored key: the Gemini key
 * whichever provider writes, and the endpoint's only while the patch still names the origin it
 * was typed for.
 */
function secretsAfter(
  current: Settings,
  patch: SettingsPatch
): Pick<Settings, 'apiKey' | 'endpointApiKey'> {
  return {
    apiKey: patch.apiKey ?? current.apiKey,
    endpointApiKey:
      patch.endpointApiKey ??
      (endpointKeyStays(current, patch.endpointUrl) ? current.endpointApiKey : undefined)
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
    maxOutputTokens: patch.maxOutputTokens,
    // `serviceTier`, `streamResponses`, `comfyGpu`, `updateAsVersion` and `updateFeed` are not
    // the renderer's to send: `...current` is what carries whatever is stored, so a hand-edited
    // switch survives every save.
    comfyDeferred: patch.comfyDeferred,
    // Absent stays absent, and absent is offering.
    checkUpdates: patch.checkUpdates,
    // Absent stays absent, and absent is warning.
    warnEndingInterrupt: patch.warnEndingInterrupt,
    warnEndingEdit: patch.warnEndingEdit,
    noNsfwImages: patch.noNsfwImages,
    lessNsfwText: patch.lessNsfwText,
    // Absent stays absent, as the volumes below do, and absent is the sound playing.
    noNsfwSound: patch.noNsfwSound,
    sfwAsked: patch.sfwAsked,
    // Absent stays absent, `JSON.stringify` dropping the key, which is full volume.
    volumes: patch.volumes,
    // The browser build's opt-in, which decides whether the keys are written beside the rest.
    rememberKey: patch.rememberKey,
    ...secretsAfter(current, patch)
  }
}
