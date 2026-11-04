import { endpointProblem } from './endpoint'
import { PLAIN_NUMBER } from './settingsRules'
import { PINNED_MODELS, PINNED_NODES, type PinnedModel } from './setupManifest'
import type { Character, CharacterLora, Settings } from './types'

/**
 * The models a render is drawn with, as slots the player fills: which loader input each one is,
 * what the workflows name in it as shipped, and where a server keeps its files. Read by main,
 * which writes the picks into every graph, and by the renderer, which offers them.
 */

/** One model slot, named by the pin that fills it as shipped. */
export type ComfyModelRole = PinnedModel['id']

/** Where the pictures are drawn: the app's own install, or a ComfyUI the player runs. */
export type ComfySource = 'managed' | 'external'

/** One source's picks, a slot absent where it draws with whatever the slot resolves to. */
export type ComfyModelPicks = Partial<Record<ComfyModelRole, string>>

export interface ComfyModelSlot {
  role: ComfyModelRole
  /** What the slot is called on screen and in a missing-model line. */
  label: string
  /** The loader class and its input that hold the slot's filename in the workflows. */
  nodeClass: string
  input: string
  /** The server's folder key, as `/internal/folder_paths` and `/models/{folder}` name it. */
  folderKey: string
  /** What the loader's list puts before every file of this slot's folder. */
  prefix: string
  /** Whether the slot may be left empty, its loader taken out of the graph. */
  optional: boolean
  /** The pin that fills it as shipped. */
  pin: PinnedModel
  /** The exact value the workflows name as shipped: the prefix and the pin's own filename. */
  shipped: string
}

/** The pin behind a slot; every role is one of the manifest's models. */
function pinOf(role: ComfyModelRole): PinnedModel {
  const pin = PINNED_MODELS.find((model) => model.id === role)
  if (!pin) throw new Error(`No pinned model for ${role}`)
  return pin
}

/** One slot, its pin and shipped value read off the manifest. */
function slot(
  role: ComfyModelRole,
  label: string,
  nodeClass: string,
  input: string,
  folderKey: string,
  prefix = '',
  optional = false
): ComfyModelSlot {
  const pin = pinOf(role)
  return { role, label, nodeClass, input, folderKey, prefix, optional, pin, shipped: prefix + pin.destFile }
}

/** Every slot, in the order the pickers stand. */
export const COMFY_MODEL_SLOTS: readonly ComfyModelSlot[] = [
  slot('checkpoint', 'Checkpoint', 'CheckpointLoaderSimple', 'ckpt_name', 'checkpoints'),
  slot('lora', 'LoRA', 'LoraLoader', 'lora_name', 'loras', '', true),
  slot('controlnet', 'ControlNet', 'ControlNetLoader', 'control_net_name', 'controlnet'),
  slot('upscaler', 'Upscaler', 'UpscaleModelLoader', 'model_name', 'upscale_models'),
  slot(
    'handDetector',
    'Hand detector',
    'UltralyticsDetectorProvider',
    'model_name',
    'ultralytics_bbox',
    'bbox/'
  ),
  slot(
    'faceSegDetector',
    'Face detector',
    'UltralyticsDetectorProvider',
    'model_name',
    'ultralytics_segm',
    'segm/'
  )
]

/** A slot's model lists, one per role, as a server or a folder answers them. */
export type ComfyModelLists = Record<ComfyModelRole, string[]>

/** One pack the server lacks classes from; `pack` is null for ComfyUI's own classes. */
export interface ComfyMissingNodes {
  pack: string | null
  classes: string[]
}

/** What a probe of a player's ComfyUI comes back with. */
export interface ComfyProbe {
  version: string
  missingNodes: ComfyMissingNodes[]
  models: ComfyModelLists
  /** Whether each slot's folder is a folder on this machine the app can open. */
  folders: Record<ComfyModelRole, boolean>
}

/** An empty list per slot. */
export function emptyModelLists(): ComfyModelLists {
  return {
    checkpoint: [],
    lora: [],
    controlnet: [],
    upscaler: [],
    handDetector: [],
    faceSegDetector: []
  }
}

/** The pick a source has stored for a slot, or undefined where none is; `''` is the LoRA's None. */
export function storedPickOf(
  picks: ComfyModelPicks | undefined,
  role: ComfyModelRole
): string | undefined {
  const value = (picks as Record<string, unknown> | undefined)?.[role]
  if (typeof value !== 'string') return undefined
  if (value === '' && !COMFY_MODEL_SLOTS.some((s) => s.role === role && s.optional)) {
    return undefined
  }
  return value
}

/**
 * What a slot left unpicked draws with on a source, where that is one value: the LoRA on the
 * player's own ComfyUI is None, which few of them have the shipped one for; every other slot
 * is the shipped file, found under whichever name the server lists it.
 */
function unpickedOf(s: ComfyModelSlot, source: ComfySource): string {
  return source === 'external' && s.optional ? '' : s.shipped
}

/**
 * The picks as a save writes them: a slot left at what it draws unpicked is stored absent, so a
 * later default reaches a player who never changed it; nothing left is no record at all.
 */
export function picksToStore(
  picks: ComfyModelPicks,
  source: ComfySource
): ComfyModelPicks | undefined {
  const out: ComfyModelPicks = {}
  for (const s of COMFY_MODEL_SLOTS) {
    const value = storedPickOf(picks, s.role)
    if (value !== undefined && value !== unpickedOf(s, source)) out[s.role] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** The last segment of a listed path, whichever separator the server's platform writes. */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** The names a shipped file may arrive under: ours, the upstream one, and either decoded. */
function namesOf(s: ComfyModelSlot): string[] {
  const names = [s.pin.destFile, s.pin.sourceFile]
  for (const name of [...names]) {
    try {
      names.push(decodeURIComponent(name))
    } catch {
      // A name that does not decode has no other spelling.
    }
  }
  return [...new Set(names)]
}

/**
 * The file a slot draws with: the stored pick as it is; else None for the LoRA on the player's
 * own ComfyUI; else, against the server's list, the shipped name, the pin's upstream name, either
 * one URL-decoded, or an entry anywhere in the folder whose own name is one of those; else the
 * shipped name. One rule for the job and the picker, so the picker shows the file the job will
 * send.
 */
export function resolveModelPick(
  stored: string | undefined,
  s: ComfyModelSlot,
  list: readonly string[],
  source: ComfySource
): string {
  if (stored !== undefined) return stored
  if (unpickedOf(s, source) === '') return ''
  if (list.includes(s.shipped)) return s.shipped
  const names = namesOf(s)
  for (const name of names) {
    if (list.includes(s.prefix + name)) return s.prefix + name
  }
  const nested = list.find((entry) => names.includes(baseName(entry.slice(s.prefix.length))))
  return nested ?? s.shipped
}

/**
 * A combo input's options as `/object_info` lists them: `[[...options], {...}]` for a V1 node,
 * `["COMBO", {options: [...]}]` for a V3 one. Anything else is no options.
 */
export function comboOptions(spec: unknown): string[] {
  if (!Array.isArray(spec)) return []
  const [head, extra] = spec as [unknown, unknown]
  const options = Array.isArray(head)
    ? head
    : head === 'COMBO' && extra && typeof extra === 'object'
      ? (extra as { options?: unknown }).options
      : undefined
  return Array.isArray(options)
    ? options.filter((option): option is string => typeof option === 'string')
    : []
}

/** One node class's options for one input, out of an `/object_info` listing. */
export function nodeOptions(objectInfo: unknown, nodeClass: string, input: string): string[] {
  const node = (objectInfo as Record<string, { input?: Record<string, Record<string, unknown>> }>)?.[
    nodeClass
  ]
  const spec = node?.input?.required?.[input] ?? node?.input?.optional?.[input]
  return comboOptions(spec)
}

/** Every slot's list out of an `/object_info` listing, each detector slot keeping its own prefix. */
export function modelListsOf(objectInfo: unknown): ComfyModelLists {
  const lists = emptyModelLists()
  for (const s of COMFY_MODEL_SLOTS) {
    lists[s.role] = nodeOptions(objectInfo, s.nodeClass, s.input).filter((name) =>
      name.startsWith(s.prefix)
    )
  }
  return lists
}

/** The classes a server lacks, grouped under the pack that provides each, ComfyUI's own last. */
export function groupMissingNodes(classes: readonly string[]): ComfyMissingNodes[] {
  const groups: ComfyMissingNodes[] = []
  const left = new Set(classes)
  for (const node of PINNED_NODES) {
    const missing = node.classes.filter((name) => left.has(name))
    if (missing.length === 0) continue
    for (const name of missing) left.delete(name)
    groups.push({ pack: node.repo, classes: missing })
  }
  if (left.size > 0) groups.push({ pack: null, classes: [...left].sort() })
  return groups
}

/** The managed install's address, which is also where a player's own ComfyUI usually answers. */
export const DEFAULT_COMFY_URL = 'http://127.0.0.1:8188'

/** A typed ComfyUI URL as it is sent: trimmed, with no trailing slash. */
export function normalizeComfyUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

/** Where the player's own ComfyUI is: the stored URL, or the default. */
export function comfyUrlOf(settings: Pick<Settings, 'comfyUrl'>): string {
  const stored = settings.comfyUrl
  return (typeof stored === 'string' && normalizeComfyUrl(stored)) || DEFAULT_COMFY_URL
}

/** Which ComfyUI draws: the player's own only where the settings say exactly that. */
export function comfySourceOf(settings: Pick<Settings, 'comfySource'>): ComfySource {
  return settings.comfySource === 'external' ? 'external' : 'managed'
}

/** The picks the given source draws with. */
export function comfyPicksOf(
  settings: Pick<Settings, 'comfyModels' | 'comfyExternalModels'>,
  source: ComfySource
): ComfyModelPicks | undefined {
  const picks = source === 'external' ? settings.comfyExternalModels : settings.comfyModels
  return picks && typeof picks === 'object' ? picks : undefined
}

/** The weight a LoRA is drawn at where the player has given none. */
export const DEFAULT_LORA_WEIGHT = 1

/** The bounds `LoraLoader` holds its two strengths to. */
const LORA_WEIGHT_MIN = -100
const LORA_WEIGHT_MAX = 100

/** Whether a number is a weight `LoraLoader` takes. */
export function isLoraWeight(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= LORA_WEIGHT_MIN &&
    value <= LORA_WEIGHT_MAX
  )
}

/**
 * The weight the given source draws its LoRA at: the stored one, or the default where none is
 * stored or the file, being hand-editable, holds one the loader would refuse.
 */
export function loraWeightOf(
  settings: Pick<Settings, 'comfyLoraWeight' | 'comfyExternalLoraWeight'>,
  source: ComfySource
): number {
  const stored = source === 'external' ? settings.comfyExternalLoraWeight : settings.comfyLoraWeight
  return isLoraWeight(stored) ? stored : DEFAULT_LORA_WEIGHT
}

/** A typed weight as the number it is, or null where it is blank or not one the loader takes. */
export function parseLoraWeight(text: string): number | null {
  const trimmed = text.trim()
  if (!PLAIN_NUMBER.test(trimmed)) return null
  const value = Number(trimmed)
  return isLoraWeight(value) ? value : null
}

/** A weight as its field shows it, a whole one with a decimal place: `1.0`, `0.75`. */
export function loraWeightText(weight: number): string {
  return Number.isInteger(weight) ? weight.toFixed(1) : String(weight)
}

/** A weight as a save writes it: the default stored absent, so a later default reaches it. */
export function loraWeightToStore(weight: number): number | undefined {
  return weight === DEFAULT_LORA_WEIGHT ? undefined : weight
}

/** A LoRA as a render draws it: the file as the server lists it, and the weight. */
export interface DrawnLora {
  name: string
  weight: number
}

/** A LoRA as a record carries it, hers or a custom CG's, the weight left out at the default. */
export function loraToStore(name: string, weight: number): CharacterLora {
  const stored = loraWeightToStore(weight)
  return stored === undefined ? { name } : { name, weight: stored }
}

/**
 * A LoRA read off a hand-editable record, or null where it names none: a name that is not one
 * is none, and a weight the loader would refuse is the default.
 */
export function loraOf(value: unknown): DrawnLora | null {
  const lora = value as Partial<CharacterLora> | undefined
  if (!lora || typeof lora !== 'object') return null
  if (typeof lora.name !== 'string' || lora.name.trim() === '') return null
  return { name: lora.name, weight: isLoraWeight(lora.weight) ? lora.weight : DEFAULT_LORA_WEIGHT }
}

/** The LoRA a character is drawn through and its weight, or null where she has none. */
export function characterLoraOf(character: Pick<Character, 'lora'>): DrawnLora | null {
  return loraOf(character.lora)
}

/**
 * Why a typed ComfyUI URL cannot be sent to, or null where it can: a plain http or https address,
 * with no credentials, query or fragment for an error line to print.
 */
export function comfyUrlProblem(raw: string): string | null {
  const problem = endpointProblem(normalizeComfyUrl(raw), 'ComfyUI URL')
  if (problem !== null) return problem
  const url = new URL(normalizeComfyUrl(raw))
  if (url.username || url.password || url.search || url.hash) {
    return 'The ComfyUI URL must be a plain address, like http://127.0.0.1:8188.'
  }
  return null
}

/** Whether a URL names this machine, the only host whose folders the app may open. */
export function isLoopbackUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase()
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1'
  } catch {
    return false
  }
}
