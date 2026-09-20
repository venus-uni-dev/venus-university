import type { ValidateRecordOptions } from './jsonValidate'
import { defaultModelFor, defaultSecondaryModelFor } from './providers'
import type { RendererSettings, Settings, SettingsPatch } from './types'

/** What the settings file must be, whichever store holds it, and how a patch merges over it. */

/** Schema version this build reads and writes. */
export const SETTINGS_SCHEMA_VERSION = 1

/**
 * What the settings must carry; the key, the three dev switches, the two hand-edited call
 * switches, the secondary model, the group volumes, the NSFW sound switch and the browser
 * build's key-remembering are all optional.
 */
const SETTINGS_REQUIRED: Record<
  keyof Omit<
    Settings,
    | 'apiKey'
    | 'freezeSeeds'
    | 'editPregens'
    | 'forceTime'
    | 'serviceTier'
    | 'streamResponses'
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
    // `serviceTier` and `streamResponses` are deliberately absent: they are hand-edited
    // switches now, and absent is what resolves to priority and to streaming on.
    comfyDeferred: false,
    // Nothing is withheld until the player says so; an unanswered `sfwAsked` raises the question.
    noNsfwImages: false,
    lessNsfwText: false,
    sfwAsked: false,
    removedDefaults: []
  }
}

/** Strips the secret, leaving only whether it is set — the renderer's view. */
export function redactSettings(settings: Settings): RendererSettings {
  const { apiKey, ...rest } = settings
  return { ...rest, apiKeySet: Boolean(apiKey) }
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
    // `serviceTier` and `streamResponses` are not the renderer's to send: `...current`
    // is what carries whatever is stored, so a hand-edited switch survives every save.
    comfyDeferred: patch.comfyDeferred,
    noNsfwImages: patch.noNsfwImages,
    lessNsfwText: patch.lessNsfwText,
    // Absent stays absent, as the volumes below do, and absent is the sound playing.
    noNsfwSound: patch.noNsfwSound,
    sfwAsked: patch.sfwAsked,
    // Absent stays absent, `JSON.stringify` dropping the key, which is full volume.
    volumes: patch.volumes,
    // The browser build's opt-in, which decides whether the key is written beside the rest.
    rememberKey: patch.rememberKey,
    // Absent means keep: the renderer never had the key to send back.
    apiKey: patch.apiKey ?? current.apiKey
  }
}
