import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { closeSync, openSync } from 'fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, join, relative } from 'path'
import {
  buildBasePrompt,
  buildCgPrompt,
  buildImagePrompt,
  buildOutfitBasePrompt,
  type PromptEdit
} from '@shared/imagePrompt'
import { defaultTagsOf, type DefaultTags } from '@shared/defaultTags'
import { COMFY_HOST } from '@shared/setupManifest'
import {
  characterLoraOf,
  COMFY_MODEL_SLOTS,
  comfyPicksOf,
  emptyModelLists,
  comfySourceOf,
  comfyUrlOf,
  comfyUrlProblem,
  groupMissingNodes,
  isLoopbackUrl,
  loraWeightOf,
  modelListsOf,
  nodeOptions,
  resolveModelPick,
  storedPickOf,
  type ComfyModelLists,
  type ComfyModelPicks,
  type ComfyModelRole,
  type ComfyModelSlot,
  type ComfyProbe,
  type ComfySource,
  type DrawnLora
} from '@shared/comfyModels'
import { customCgLoraOf } from '@shared/customCgs'
import { appError, isAppError, messageOf, tailOf, toAppError, truncate } from '@shared/errors'
import { isEmotion } from '@shared/emotions'
import { baseRel, cgRel, expressionRel, faceRel, outfitRel } from '@shared/characterFiles'
import { isOutfitSet } from '@shared/outfits'
import { isPosition } from '@shared/positions'
import type {
  AppError,
  Character,
  ComfyRuntimeState,
  ComfyStatus,
  Emotion,
  OutfitSet,
  Position
} from '@shared/types'
import {
  getCharacterCgPath,
  getCharacterExpressionPath,
  getCharacterFacePath,
  getCharacterOutfitPath,
  getComfyAppPath,
  getComfyLogPath,
  getComfyModelDirPath,
  getComfyOutputFilePath,
  getComfyPythonPath,
  getComfyUiPath,
  getExpressionBasePath,
  getOutfitBasePath,
  getPoseSkeletonPath,
  getStagedPath,
  getTempPath,
  getWorkflowPath,
  getWorkflowsPath
} from '../paths'
import { getPoseTags } from './assetService'
import { redactUrl } from './downloadService'
import { getSettings } from './settingsService'
import { assertSafeCharId } from './characterService'
import { dropImageTwins, findImage, openImage, writeImageFile } from './imageFiles'
import { imageTypeOf, isRgbaPng } from '@shared/imageBytes'
import { killStrayProcesses, killTree, listProcessIds } from './processTree'
import { tryCutProfile } from './profileService'
import { sleep } from '@shared/retry'

/** Where the app's own server answers. */
const MANAGED_URL = `http://${COMFY_HOST}`
const PORT = COMFY_HOST.split(':')[1]

/** The input subfolder every picture a render reads is handed over into, apart from the player's. */
const INPUT_SUBFOLDER = 'venus-university'

/** How long a liveness check, an upload, a submit and a download may each take. */
const STATS_TIMEOUT_MS = 5_000
const UPLOAD_TIMEOUT_MS = 60_000
const SUBMIT_TIMEOUT_MS = 30_000
const VIEW_TIMEOUT_MS = 120_000
const OBJECT_INFO_TIMEOUT_MS = 30_000

/** Which ComfyUI one job draws on, read off the settings once, when the job is queued. */
export interface ComfyTarget {
  source: ComfySource
  baseUrl: string
  picks: ComfyModelPicks | undefined
  /** The weight its LoRA is drawn at, where the picks keep one. */
  loraWeight: number
  /** The default tags every prompt of the job opens with. */
  tags: DefaultTags
}

/** The ComfyUI the settings name right now, with the models and the default tags it draws with. */
export async function resolveTarget(): Promise<ComfyTarget> {
  const settings = await getSettings()
  const source = comfySourceOf(settings)
  return {
    source,
    baseUrl: source === 'external' ? comfyUrlOf(settings) : MANAGED_URL,
    picks: comfyPicksOf(settings, source),
    loraWeight: loraWeightOf(settings, source),
    tags: defaultTagsOf(settings)
  }
}

/** One server's identity for what has been verified on it: which source, at which address. */
function keyOf(target: Pick<ComfyTarget, 'source' | 'baseUrl'>): string {
  return `${target.source} ${target.baseUrl}`
}

/** The managed server's key, the one a spawn or a kill clears. */
const MANAGED_KEY = keyOf({ source: 'managed', baseUrl: MANAGED_URL })

/** The loader every sampling graph draws her own LoRA through, chained after the style LoRA. */
const CHARACTER_LORA_NODE = '100'

/** The loader the CG graph draws a custom pair's position LoRA through, chained after hers. */
const POSITION_LORA_NODE = '101'

/** Node ids overwritten in `assets/workflows/characterBase.json`. */
const BASE_NODE = {
  seed: '14',
  characterLora: CHARACTER_LORA_NODE,
  positivePrompt: '4',
  negativePrompt: '5',
  poseImage: '39',
  saveImage: '41'
} as const

/**
 * Node ids overwritten in `assets/workflows/characterCutout.json`; a base frame rendered
 * before the base graph cut its own background is cut here once.
 */
const CUTOUT_NODE = {
  sourceImage: '10',
  saveImage: '41'
} as const

/**
 * Node ids overwritten in `assets/workflows/characterExpression.json`; `seed` is the
 * Face Detailer's, since the graph has no KSampler.
 */
const EXPRESSION_NODE = {
  seed: '14',
  characterLora: CHARACTER_LORA_NODE,
  positivePrompt: '4',
  negativePrompt: '5',
  sourceImage: '10',
  poseImage: '39',
  saveImage: '9',
  faceSaveImage: '79',
  faceNodes: ['70', '79']
} as const

/** Node ids overwritten in `assets/workflows/characterCg.json`. */
const CG_NODE = {
  seed: '14',
  characterLora: CHARACTER_LORA_NODE,
  positionLora: POSITION_LORA_NODE,
  positivePrompt: '4',
  detailerPositivePrompt: '50',
  negativePrompt: '5',
  poseImage: '39',
  saveImage: '9'
} as const

/**
 * Node ids overwritten in `assets/workflows/characterHands.json`; `sourceImage` is the
 * set's base frame and `paintImage` the strokes composited over it, and the graph has two sinks.
 */
const HANDS_NODE = {
  seed: '14',
  characterLora: CHARACTER_LORA_NODE,
  positivePrompt: '4',
  negativePrompt: '5',
  sourceImage: '10',
  paintImage: '80',
  poseImage: '39',
  saveImage: '9',
  regionSaveImage: '79'
} as const

/** Minimal API-format graph used to pull the checkpoint into VRAM. */
const WARM_WORKFLOW = {
  '1': {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: 'novaAnimeXL_ilV190.safetensors' }
  },
  '2': {
    class_type: 'LoraLoader',
    inputs: {
      model: ['1', 0],
      clip: ['1', 1],
      lora_name: 'usnrStyle.safetensors',
      strength_model: 1,
      strength_clip: 1
    }
  },
  '3': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 1], text: 'warmup' } },
  '4': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 1], text: '' } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: 64, height: 64, batch_size: 1 } },
  '6': {
    class_type: 'KSampler',
    inputs: {
      model: ['2', 0],
      positive: ['3', 0],
      negative: ['4', 0],
      latent_image: ['5', 0],
      seed: 1,
      steps: 1,
      cfg: 4,
      sampler_name: 'dpmpp_2m_sde',
      scheduler: 'sgm_uniform',
      denoise: 1
    }
  },
  '7': { class_type: 'VAEDecode', inputs: { samples: ['6', 0], vae: ['1', 2] } },
  // PreviewImage writes into ComfyUI's temp folder, which it cleans up itself.
  '8': { class_type: 'PreviewImage', inputs: { images: ['7', 0] } }
} as const

/** Rejects an identifier that is not in its closed vocabulary. */
function assertVocab(
  value: string,
  isMember: (value: string) => boolean,
  code: string,
  noun: string
): void {
  if (!isMember(value)) {
    throw appError(code, `"${String(value)}" is not ${noun}.`, String(value))
  }
}

/** Throws the cancellation error before irreversible sprite writes. */
function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw appError('CANCELLED', 'Generation was cancelled.')
}

/** The server we spawned, if any. ComfyUI is a singleton — one port, one process. */
let serverProcess: ChildProcess | null = null

/** The in-flight `start()`, shared by every concurrent caller so there is one boot. */
let starting: Promise<void> | null = null

/** How many times `stop()` has run, so a boot can tell being killed from failing. */
let stopEpoch = 0

/** Where runtime state events go; wired to the renderer once, in `ipc.ts`. */
let stateSink: ((status: ComfyStatus) => void) | null = null

/** Registers the runtime state sink. Called once at startup. */
export function setStateSink(fn: (status: ComfyStatus) => void): void {
  stateSink = fn
}

/** Emits one runtime state, if a sink is registered. */
function emit(state: ComfyRuntimeState, error?: AppError): void {
  stateSink?.({ state, error })
}

/**
 * Each server that has answered for every class the workflows name, keyed by source and address,
 * with the `/object_info` listing it answered: the check costs one request per server rather than
 * one per job, and the listing is what a job's models are checked against. The managed entry is
 * cleared whenever a process is spawned or killed; a player's own is forgotten when it fails.
 */
const verified = new Map<string, Record<string, unknown>>()

/** Forgets every verification of a player's own server. */
function forgetExternal(): void {
  for (const key of [...verified.keys()]) if (key.startsWith('external ')) verified.delete(key)
}

/** True when ComfyUI answers `/system_stats` at `baseUrl`. */
async function isRunning(baseUrl: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/system_stats`, {
      signal: AbortSignal.timeout(timeoutMs)
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Refuses whatever is answering on the port unless a process is running from the app's own
 * interpreter: an adopted server is sent prompts and trusted with the files it names back.
 */
function assertOwnServer(): void {
  const python = getComfyPythonPath()
  const pids = listProcessIds([python])
  if (pids !== null && pids.length > 0) return

  const own = 'If it is your own ComfyUI, pick Use my own on the ComfyUI tab of Settings.'
  throw appError(
    'COMFY_PORT_TAKEN',
    `ComfyUI could not start: another program is using port ${PORT}.`,
    pids === null
      ? `Something answered on ${COMFY_HOST} and Windows would not say what is running. ${own}`
      : `Something answered on ${COMFY_HOST}, but nothing is running from ${python}. ${own}`
  )
}

/**
 * Makes the ComfyUI the target names ready for jobs: the app's own is started headless, waited
 * through its cold torch and custom-node imports and warmed; a player's own is only checked.
 * The target is resolved here where the caller has none.
 */
export function start(target?: ComfyTarget, onProgress?: (step: string) => void): Promise<void> {
  if (starting) return starting
  // A boot the player killed mid-way reports nothing: `stop()` has already said idle.
  const epoch = stopEpoch
  starting = (async () => startOnce(target ?? (await resolveTarget()), epoch, onProgress))()
    .catch((err) => {
      if (stopEpoch === epoch) emit('error', toAppError(err))
      throw err
    })
    .finally(() => {
      starting = null
    })
  return starting
}

/** The actual boot; only ever one of these is live — see `starting`. */
async function startOnce(
  target: ComfyTarget,
  epoch: number,
  onProgress?: (step: string) => void
): Promise<void> {
  if (target.source === 'external') {
    await connectExternal(target, epoch)
    return
  }

  if (await isRunning(MANAGED_URL)) {
    // A server we did not spawn is adopted only once it has been shown to be ours; the
    // verification holds that verdict too, so the listing costs one call per server rather
    // than one per job.
    if (!verified.has(MANAGED_KEY) && serverProcess === null) assertOwnServer()
    await listingFor(target)
    emit('ready')
    return
  }

  onProgress?.('Starting ComfyUI')
  emit('starting')
  const python = getComfyPythonPath()

  // Both streams go to the log file through one descriptor: a file has no pipe to fill, and
  // the tail is the detail when a boot dies. A log that will not open does not stop the boot.
  let logFd: number | null = null
  try {
    logFd = openSync(getComfyLogPath(), 'w')
  } catch (err) {
    console.warn('[comfy] could not open the log file:', messageOf(err))
  }

  verified.delete(MANAGED_KEY)
  const child = spawn(
    python,
    [
      '-s',
      join(getComfyAppPath(), 'main.py'),
      '--windows-standalone-build',
      '--port',
      PORT,
      '--disable-auto-launch'
    ],
    {
      cwd: getComfyUiPath(),
      windowsHide: true,
      stdio: ['ignore', logFd ?? 'ignore', logFd ?? 'ignore']
    }
  )
  if (logFd !== null) closeSync(logFd)

  // What a process that never started reports; the log has nothing in that case.
  let spawnError = ''
  let exitCode: number | null = null

  child.on('error', (err) => {
    // Without a listener Node treats a spawn failure as an unhandled error event.
    spawnError = err.message
  })
  child.on('exit', (code) => {
    // A dead server's verdict must not cover whatever answers on the port next.
    if (serverProcess === child) {
      serverProcess = null
      verified.delete(MANAGED_KEY)
      // A crash with no boot in flight is the only exit nothing else already reports.
      if (starting === null) emit('idle')
    }
    exitCode = code
  })
  serverProcess = child

  const deadline = Date.now() + 180_000
  let ready = false
  while (Date.now() < deadline) {
    await sleep(1000)
    if (await isRunning(MANAGED_URL)) {
      ready = true
      break
    }
    // The exit handler cleared it: the process is already gone.
    if (serverProcess !== child) {
      throw appError(
        'COMFY_START_FAILED',
        'ComfyUI stopped while it was starting up.',
        await bootDetail(`${python} exited with code ${String(exitCode)}.`, spawnError)
      )
    }
  }

  if (!ready) {
    killServer()
    throw appError(
      'COMFY_START_TIMEOUT',
      'ComfyUI did not become ready within three minutes.',
      await bootDetail(`Tried to start ${python} on ${COMFY_HOST}.`, spawnError)
    )
  }

  await listingFor(target)

  onProgress?.('Loading checkpoint')
  await warm(target)
  emit('ready')
}

/**
 * Checks that the player's own ComfyUI answers and carries every class the workflows name; it is
 * never spawned, adopted or warmed. Connecting is reported only where it has not been verified.
 */
async function connectExternal(target: ComfyTarget, epoch: number): Promise<void> {
  if (!verified.has(keyOf(target))) emit('starting')
  if (!(await isRunning(target.baseUrl, STATS_TIMEOUT_MS))) {
    throw appError(
      'COMFY_UNREACHABLE',
      `ComfyUI isn't answering at ${redactUrl(target.baseUrl)}.`,
      'Start it, or check the URL on the ComfyUI tab of Settings.'
    )
  }
  await listingFor(target)
  // A disconnect while this was in flight has already said idle.
  if (stopEpoch === epoch) emit('ready')
}

/** The end of ComfyUI's log, or nothing when the boot never wrote one. */
async function logTail(): Promise<string> {
  try {
    return tailOf(await readFile(getComfyLogPath(), 'utf-8'), 2000)
  } catch {
    return ''
  }
}

/** What a dead boot says for itself: the line that names it, the spawn failure, then the log. */
async function bootDetail(summary: string, spawnError: string): Promise<string> {
  return [summary, spawnError, await logTail()].filter(Boolean).join('\n')
}

/** Every class the shipped workflows name, read off the workflow files themselves. */
async function workflowClasses(): Promise<Set<string>> {
  const dir = getWorkflowsPath()
  const files = (await readdir(dir)).filter((name) => name.endsWith('.json'))
  const wanted = new Set<string>()
  for (const file of files) {
    const graph = JSON.parse(await readFile(join(dir, file), 'utf-8')) as ComfyWorkflow
    for (const node of Object.values(graph)) wanted.add(node.class_type)
  }
  return wanted
}

/** The server's whole `/object_info` listing: every class it loaded, with each input's options. */
async function fetchObjectInfo(baseUrl: string): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(`${baseUrl}/object_info`, {
      signal: AbortSignal.timeout(OBJECT_INFO_TIMEOUT_MS)
    })
    if (!response.ok) throw new Error(`HTTP ${response.status} from /object_info`)
    return (await response.json()) as Record<string, unknown>
  } catch (err) {
    throw appError(
      'COMFY_UNREACHABLE',
      'Could not ask ComfyUI which nodes it loaded.',
      messageOf(err)
    )
  }
}

/** The classes the workflows name that a listing lacks, sorted. */
async function missingClasses(objectInfo: Record<string, unknown>): Promise<string[]> {
  return [...(await workflowClasses())].filter((name) => !(name in objectInfo)).sort()
}

/** The lines naming what a server lacks, each pack's classes under it and ComfyUI's own last. */
function missingNodeLines(classes: readonly string[]): string {
  return groupMissingNodes(classes)
    .map((group) =>
      group.pack === null
        ? `Missing core nodes (update ComfyUI, tested on v0.34): ${group.classes.join(', ')}.`
        : `Missing nodes from ${group.pack}: ${group.classes.join(', ')}.`
    )
    .join('\n')
}

/**
 * The listing a target's jobs are checked against, asked for once per server: a server that came
 * up without a class one of the workflows names is refused, since a custom node whose imports
 * failed is skipped silently at boot and the first job would fail halfway through a render.
 */
async function listingFor(target: ComfyTarget): Promise<Record<string, unknown>> {
  const key = keyOf(target)
  const kept = verified.get(key)
  if (kept) return kept

  const objectInfo = await fetchObjectInfo(target.baseUrl)
  const missing = await missingClasses(objectInfo)
  if (missing.length > 0) {
    throw appError(
      'COMFY_NODES_MISSING',
      target.source === 'external'
        ? 'ComfyUI is missing nodes the workflows need.'
        : 'ComfyUI started without nodes the workflows need.',
      target.source === 'external'
        ? `${missingNodeLines(missing)}\nInstall what is missing in your ComfyUI and restart it.`
        : `Missing: ${missing.join(', ')}. Open Setup and run Install missing. ` +
            `ComfyUI's log: ${getComfyLogPath()}`
    )
  }

  verified.set(key, objectInfo)
  console.log(`[comfy] every node class the workflows name is loaded (${target.source})`)
  return objectInfo
}

/** Each slot's model as one of the target's jobs draws it, resolved against the server's lists. */
function resolvedPicks(
  target: ComfyTarget,
  objectInfo: Record<string, unknown>
): Record<ComfyModelRole, string> {
  const lists = modelListsOf(objectInfo)
  const resolved = {} as Record<ComfyModelRole, string>
  for (const slot of COMFY_MODEL_SLOTS) {
    resolved[slot.role] = resolveModelPick(
      storedPickOf(target.picks, slot.role),
      slot,
      lists[slot.role],
      target.source
    )
  }
  return resolved
}

/**
 * Writes the resolved models into a graph: every loader input still naming its slot's shipped
 * file takes the pick, a LoRA kept is drawn at the given weight, and a LoRA left empty takes its
 * loader out, every link to its outputs rewired to what it was fed.
 */
export function applyModelPicks(
  workflow: ComfyWorkflow,
  resolved: Record<ComfyModelRole, string>,
  loraWeight: number
): void {
  for (const [id, node] of Object.entries(workflow)) {
    for (const slot of COMFY_MODEL_SLOTS) {
      if (node.class_type !== slot.nodeClass || node.inputs[slot.input] !== slot.shipped) continue
      const pick = resolved[slot.role]
      if (pick === '' && slot.optional) {
        bypassLoraLoader(workflow, id)
        break
      }
      node.inputs[slot.input] = pick
      if (slot.role === 'lora') {
        node.inputs.strength_model = loraWeight
        node.inputs.strength_clip = loraWeight
      }
    }
  }
}

/** Takes a `LoraLoader` out of a graph, its model and clip outputs fed straight from its inputs. */
function bypassLoraLoader(workflow: ComfyWorkflow, id: string): void {
  const node = workflow[id]
  if (!node) return
  const through = [node.inputs.model, node.inputs.clip]
  delete workflow[id]
  for (const other of Object.values(workflow)) {
    for (const [key, value] of Object.entries(other.inputs)) {
      if (!Array.isArray(value) || value[0] !== id || typeof value[1] !== 'number') continue
      const fed = through[value[1]]
      if (fed !== undefined) other.inputs[key] = fed
    }
  }
}

/** The first model a graph names that the listing does not offer, and the slot and node it is. */
function missingModel(
  workflow: ComfyWorkflow,
  objectInfo: Record<string, unknown>
): { label: string; value: string; node: string } | null {
  for (const [id, node] of Object.entries(workflow)) {
    const slots = COMFY_MODEL_SLOTS.filter((slot) => slot.nodeClass === node.class_type)
    if (slots.length === 0) continue
    const value = node.inputs[slots[0].input]
    if (typeof value !== 'string') continue
    // The detector loader fills two slots; its value carries the prefix of the one it is.
    const slot = slots.find((s) => s.prefix !== '' && value.startsWith(s.prefix)) ?? slots[0]
    if (!nodeOptions(objectInfo, slot.nodeClass, slot.input).includes(value)) {
      return { label: slot.label, value, node: id }
    }
  }
  return null
}

/**
 * Refuses a graph naming a model the server does not list, asking the server again once first,
 * since the player may have added the file since the listing was kept. Her own LoRA's loader,
 * where the graph keeps one, is named as hers, and a custom pair's as the CG's.
 */
async function assertGraphModels(
  target: ComfyTarget,
  workflow: ComfyWorkflow,
  { characterLora: characterLoraNode, positionLora: positionLoraNode }: GenerationNodes
): Promise<void> {
  let missing = missingModel(workflow, await listingFor(target))
  if (missing) {
    const fresh = await fetchObjectInfo(target.baseUrl)
    verified.set(keyOf(target), fresh)
    missing = missingModel(workflow, fresh)
  }
  if (missing && missing.node === characterLoraNode) {
    throw appError(
      'COMFY_MODEL_MISSING',
      `ComfyUI does not have her LoRA, ${missing.value}.`,
      "Add it to ComfyUI's LoRA folder, or pick another under her Generation settings."
    )
  }
  if (missing && missing.node === positionLoraNode) {
    throw appError(
      'COMFY_MODEL_MISSING',
      `ComfyUI does not have the CG's position LoRA, ${missing.value}.`,
      "Add it to ComfyUI's LoRA folder, or pick another when you regenerate the CG."
    )
  }
  if (missing) {
    throw appError(
      'COMFY_MODEL_MISSING',
      `ComfyUI does not have the ${missing.label.toLowerCase()} ${missing.value}.`,
      'Pick another on the ComfyUI tab of Settings.'
    )
  }
}

/** Runs a 1-step warm-up job; failures are logged because the first real job can recover. */
async function warm(target: ComfyTarget): Promise<void> {
  try {
    // A copy: the module's graph is shared, and the picks are written into what is sent.
    const workflow = structuredClone(WARM_WORKFLOW) as unknown as ComfyWorkflow
    applyModelPicks(workflow, resolvedPicks(target, await listingFor(target)), target.loraWeight)
    const promptId = await submitWorkflow(target, workflow)
    await waitForPrompt(target, promptId)
  } catch (err) {
    console.warn('[comfy] checkpoint warm-up failed:', err)
  }
}

/**
 * Kills the server we spawned, and any worker it spawned in turn. A server we
 * did not start is left alone.
 */
export function stop(): void {
  stopEpoch += 1
  killServer()
  emit('idle')
}

/** The kill itself, without the verdict: a boot that gave up reports its own failure. */
function killServer(): void {
  verified.delete(MANAGED_KEY)
  if (!serverProcess) return
  killTree(serverProcess.pid)
  serverProcess = null
}

/**
 * The player's stop. The boot in flight is left to unwind before the next `start()` begins,
 * and an adopted server — the one thing `stop()` cannot reach — is killed after it. A player's
 * own ComfyUI is never touched: it is only forgotten, to be checked again by the next job.
 */
export async function stopByHand(): Promise<void> {
  const boot = starting
  if ((await resolveTarget()).source === 'external') {
    stopEpoch += 1
    forgetExternal()
    emit('idle')
    if (boot) await boot.catch(() => {})
    return
  }
  stop()
  if (boot) await boot.catch(() => {})
  killStray()
}

/**
 * What a change of source or address leaves behind: every verification of a player's own server
 * is forgotten and the state goes back to idle, and a managed server left behind is stopped —
 * only where one is running, booting or adopted, since finding a stray costs a process listing.
 */
export async function comfySourceChanged(): Promise<void> {
  forgetExternal()
  const target = await resolveTarget()
  const managedUp = serverProcess !== null || starting !== null || verified.has(MANAGED_KEY)
  if (target.source === 'external' && managedUp) {
    const boot = starting
    stop()
    if (boot) await boot.catch(() => {})
    killStray()
    return
  }
  stopEpoch += 1
  emit('idle')
}

/** Kills a ComfyUI left over from a previous run, before this one claims the port. */
export function killStray(): void {
  killStrayProcesses([getComfyPythonPath()])
}

/** API-format workflow: node id to class + inputs. */
type ComfyWorkflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>

/** One image entry in a `/history` output. */
interface ComfyImage {
  filename: string
  subfolder: string
  type: string
}

/** Queues a workflow and returns its prompt id. */
async function submitWorkflow(target: ComfyTarget, workflow: ComfyWorkflow): Promise<string> {
  let response: Response
  try {
    response = await fetch(`${target.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: 'venus-university' }),
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS)
    })
  } catch (err) {
    throw appError(
      'COMFY_UNREACHABLE',
      'Could not reach ComfyUI to submit the job.',
      messageOf(err)
    )
  }

  const body = await response.text()
  if (!response.ok) {
    // A rejected workflow — a wrong model filename or a missing node; not retryable.
    throw appError(
      'COMFY_PROMPT_REJECTED',
      'ComfyUI rejected the generation workflow.',
      `HTTP ${response.status}: ${truncate(body, 2000)}`
    )
  }

  const parsed = JSON.parse(body) as { prompt_id?: string }
  if (!parsed.prompt_id) {
    throw appError('COMFY_PROMPT_REJECTED', 'ComfyUI did not return a prompt id.', truncate(body, 2000))
  }
  return parsed.prompt_id
}

/**
 * Drops a prompt from the queue and interrupts it if it is already running — that prompt alone,
 * so a job of the player's own on the same server goes on.
 */
async function cancelPrompt(target: ComfyTarget, promptId: string): Promise<void> {
  try {
    await fetch(`${target.baseUrl}/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete: [promptId] }),
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS)
    })
    await fetch(`${target.baseUrl}/interrupt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt_id: promptId }),
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS)
    })
  } catch {
    // Best-effort: a failed cancel must not mask the reason the wait ended.
  }
}

/**
 * The three bounds on a wait: one poll's timeout, how many failed polls in a row end it, and
 * the wall clock the whole wait runs against.
 */
const POLL_TIMEOUT_MS = 10_000
const POLL_FAILURES_ALLOWED = 3
/** Longer than any render; only a prompt that will never finish reaches it. */
const WAIT_DEADLINE_MS = 30 * 60_000

/** Shape of the `/history/{id}` entry we care about. */
interface PromptHistory {
  status?: { status_str?: string; completed?: boolean; messages?: unknown }
  outputs?: Record<string, { images?: ComfyImage[] }>
}

/**
 * A finished prompt and the failure it ended in, if any; a graph can fail after writing
 * the image it was asked for.
 */
interface PromptResult {
  history: PromptHistory
  executionError?: ReturnType<typeof appError>
}

/** Polls prompt history/queue until completion, reporting queued vs rendering. */
async function waitForPrompt(
  target: ComfyTarget,
  promptId: string,
  signal?: AbortSignal,
  onProgress?: (step: string) => void
): Promise<PromptResult> {
  let lastStep = ''
  const report = (step: string): void => {
    if (step !== lastStep) {
      lastStep = step
      onProgress?.(step)
    }
  }

  let consecutiveFailures = 0
  const deadline = Date.now() + WAIT_DEADLINE_MS

  for (;;) {
    if (signal?.aborted) {
      await cancelPrompt(target, promptId)
      throw appError('CANCELLED', 'Generation was cancelled.')
    }

    // The wall clock: the one bound on a prompt `/history` never lists.
    if (Date.now() > deadline) {
      await cancelPrompt(target, promptId)
      throw appError(
        'COMFY_WAIT_TIMEOUT',
        'ComfyUI never finished the image.',
        `prompt ${promptId} was still unfinished after ${Math.round(WAIT_DEADLINE_MS / 60_000)} minutes.`
      )
    }

    // Not the job's `signal`: an abort here would skip the `cancelPrompt` at the top.
    try {
      const response = await fetch(`${target.baseUrl}/history/${promptId}`, {
        signal: AbortSignal.timeout(POLL_TIMEOUT_MS)
      })
      // A non-OK answer counts as a failed poll, the same as a refused connection.
      if (!response.ok) throw new Error(`HTTP ${response.status} from /history/${promptId}`)

      const history = (await response.json()) as Record<string, PromptHistory>
      const entry = history[promptId]
      if (entry?.status?.completed !== undefined) {
        return entry.status.status_str === 'error'
          ? {
              history: entry,
              executionError: appError(
                'COMFY_EXECUTION_FAILED',
                'ComfyUI failed while generating the image.',
                executionDetail(target, entry.status.messages)
              )
            }
          : { history: entry }
      }
      consecutiveFailures = 0
    } catch (err) {
      // A failed render is the server answering, not a failed poll.
      if (isAppError(err)) throw err
      consecutiveFailures++
      if (consecutiveFailures >= POLL_FAILURES_ALLOWED) {
        throw appError(
          'COMFY_UNREACHABLE',
          'ComfyUI stopped answering while the image was rendering.',
          messageOf(err)
        )
      }
    }

    report((await isQueuedAhead(target, promptId)) ? 'Queued in ComfyUI' : 'Rendering')
    await sleep(1500, signal)
  }
}

/**
 * What a failed graph's status messages say, for the error's detail. A player's own server's
 * paths are no paths the log knows to hide, so its messages keep each failure's exception type,
 * message and node, and drop the traceback.
 */
function executionDetail(target: ComfyTarget, messages: unknown): string {
  if (target.source === 'external' && Array.isArray(messages)) {
    const kept = messages.map((message) => {
      if (!Array.isArray(message) || !message[1] || typeof message[1] !== 'object') return message
      const { traceback: _traceback, current_inputs: _inputs, current_outputs: _outputs, ...rest } =
        message[1] as Record<string, unknown>
      return [message[0], rest]
    })
    return truncate(JSON.stringify(kept), 2000)
  }
  return truncate(JSON.stringify(messages), 2000)
}

/** True when the prompt is still waiting rather than executing. */
async function isQueuedAhead(target: ComfyTarget, promptId: string): Promise<boolean> {
  try {
    const response = await fetch(`${target.baseUrl}/queue`, {
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS)
    })
    if (!response.ok) return false
    const queue = (await response.json()) as {
      queue_running?: unknown[][]
      queue_pending?: unknown[][]
    }
    return (queue.queue_pending ?? []).some((item) => item[1] === promptId)
  } catch {
    return false
  }
}

/** Downloads one generated image from ComfyUI's `/view` endpoint. */
async function fetchImage(target: ComfyTarget, image: ComfyImage): Promise<Buffer> {
  const query = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder ?? '',
    type: image.type ?? 'output'
  })
  let response: Response
  try {
    response = await fetch(`${target.baseUrl}/view?${query}`, {
      signal: AbortSignal.timeout(VIEW_TIMEOUT_MS)
    })
  } catch (err) {
    throw appError(
      'COMFY_UNREACHABLE',
      'Could not download the generated image from ComfyUI.',
      messageOf(err)
    )
  }
  if (!response.ok) {
    throw appError(
      'COMFY_VIEW_FAILED',
      'Could not download the generated image from ComfyUI.',
      `HTTP ${response.status} for ${image.subfolder}/${image.filename}`
    )
  }
  const bytes = Buffer.from(await response.arrayBuffer())

  // The one gate on bytes from the server, and what every sprite file is written from.
  if (!imageTypeOf(bytes)) {
    throw appError(
      'COMFY_VIEW_NOT_IMAGE',
      'ComfyUI answered with something that is not an image.',
      `${image.subfolder}/${image.filename}, ${bytes.length} bytes`
    )
  }
  return bytes
}

/**
 * How one sink's picture is kept: WebP at the shared profile, WebP losslessly for the editor's
 * working files, or the PNG ComfyUI wrote, byte for byte, for scratch read back at once.
 */
type SaveFormat = 'lossy' | 'lossless' | 'raw'

/** One sink of a finished graph: which `PreviewImage` node, where its picture goes, and how. */
interface SaveTarget {
  node: string
  destPath: string
  format: SaveFormat
}

/** What a sink's write raises where the disk refuses it. */
const RESULT_UNWRITABLE = {
  code: 'SPRITE_UNWRITABLE',
  message: 'Could not save the generated image.'
}

/** What one sink of a finished graph produced, if it ran at all. */
function imageOf(history: PromptHistory, node: string): ComfyImage | undefined {
  return history.outputs?.[node]?.images?.[0]
}

/**
 * Removes a cancelled-but-finished render from the app's own server's folders; a player's own
 * ComfyUI is left to sweep its temp folder itself, the app touching nothing on its disk.
 */
async function discardOutput(
  target: ComfyTarget,
  history: PromptHistory,
  save: SaveTarget
): Promise<void> {
  const image = imageOf(history, save.node)
  if (!image || target.source === 'external') return

  let outputPath: string
  try {
    outputPath = getComfyOutputFilePath(image)
  } catch (err) {
    // Every caller of this is already carrying a failure, which a path error must not replace.
    console.warn(`[comfy] left ComfyUI's own copy in place: ${toAppError(err).message}`)
    return
  }
  await rm(outputPath, { force: true })
}

/**
 * Fetches one finished sink and writes it to its destination, then removes the app's own
 * server's copy — the tail every generation job shares.
 */
async function saveResult(
  target: ComfyTarget,
  history: PromptHistory,
  promptId: string,
  save: SaveTarget,
  signal?: AbortSignal,
  onProgress?: (step: string) => void
): Promise<string> {
  // Catches an abort that arrived in the same tick the prompt completed.
  if (signal?.aborted) {
    await discardOutput(target, history, save)
    throw appError('CANCELLED', 'Generation was cancelled.')
  }

  const image = imageOf(history, save.node)
  if (!image) {
    throw appError(
      'COMFY_NO_OUTPUT',
      'ComfyUI finished but produced no image.',
      `prompt ${promptId}, node ${save.node}`
    )
  }

  // The app's own server's name for the file is refused here, before anything is downloaded or
  // written; a player's own server's files are never touched, so nothing is resolved for it.
  const outputPath = target.source === 'managed' ? getComfyOutputFilePath(image) : null

  onProgress?.('Saving')

  const bytes = await fetchImage(target, image)

  // Last gate before the write: the `mkdir` below would recreate a folder that
  // `chars:delete` just removed.
  if (signal?.aborted) {
    await discardOutput(target, history, save)
    throw appError('CANCELLED', 'Generation was cancelled.')
  }

  await mkdir(dirname(save.destPath), { recursive: true })
  let written = save.destPath
  if (save.format === 'raw') {
    // Write-then-rename replaces the old file in one step.
    const partialPath = `${save.destPath}.partial`
    await writeFile(partialPath, bytes)
    await rename(partialPath, save.destPath)
    await dropImageTwins(save.destPath)
  } else {
    written = await writeImageFile(save.destPath, bytes, {
      lossless: save.format === 'lossless',
      error: RESULT_UNWRITABLE
    })
  }

  if (outputPath) await rm(outputPath, { force: true })

  return written
}

/** How one queued job is run, as `jobQueue` supplies it, and the ComfyUI it was queued for. */
type JobOptions = {
  signal?: AbortSignal
  onProgress?: (step: string) => void
  target?: ComfyTarget
}

/** A job's options once its target is settled, as every graph it runs takes them. */
type RunOptions = JobOptions & { target: ComfyTarget }

/** A job's options with its target settled: the one it was queued for, else the settings' now. */
async function runOptionsOf(options: JobOptions): Promise<RunOptions> {
  return { ...options, target: options.target ?? (await resolveTarget()) }
}

/** Which node ids one graph exposes, and what each is for. */
interface GenerationNodes {
  /** The seed and the two prompt encodes; the cutout graph samples nothing and has none. */
  seed?: string
  positivePrompt?: string
  negativePrompt?: string
  saveImage: string
  /** The Face Detailer's own positive encode; the CG graph only. */
  detailerPositivePrompt?: string
  /** ControlNet skeleton `LoadImage`; every graph has one. */
  poseImage?: string
  /** Source `LoadImage`; the expression, cutout and hands graphs. */
  sourceImage?: string
  /** The painted-strokes `LoadImage`; the hands graph only. */
  paintImage?: string
  /** Her own LoRA's loader; every graph that samples. */
  characterLora?: string
  /** A custom CG pair's position LoRA's loader; the CG graph only. */
  positionLora?: string
  /** The face mask's sink; the expression graph only. */
  faceSaveImage?: string
  /** The changed region's sink; the hands graph only, and required where it is named. */
  regionSaveImage?: string
  /** Every node of the face-mask branch, deleted from the graph when no mask is wanted. */
  faceNodes?: readonly string[]
}

/** One render, fully resolved: which graph, what to write into it, where its pictures go. */
interface GenerationSpec {
  /** Filename under `assets/workflows`. */
  workflowFile: string
  nodes: GenerationNodes
  /** Text for `nodes.positivePrompt` and `nodes.negativePrompt`, where the graph names them. */
  prompts?: { positive: string; negative: string }
  /** Text for `nodes.detailerPositivePrompt`, if the graph has one. */
  detailerPositive?: string
  /** What `nodes.seed` is set to, where the graph names one. */
  seed?: number
  /** Her own LoRA for `nodes.characterLora`, or null to take that loader out of the graph. */
  lora?: DrawnLora | null
  /** The pair's position LoRA for `nodes.positionLora`, or null to take that loader out. */
  positionLora?: DrawnLora | null
  /** Staged filename for `nodes.poseImage`, if the graph has one. */
  poseImageName?: string
  /** Staged filename for `nodes.sourceImage`, if the graph has one. */
  sourceImageName?: string
  /** Staged filename for `nodes.paintImage`, if the graph has one. */
  paintImageName?: string
  /** Where the finished image lands. */
  destPath: string
  /** How the finished image and the hand fix's region are kept; the face mask is lossless. */
  format: SaveFormat
  /** Where the face mask lands; absent, the mask branch is stripped from the graph. */
  faceDestPath?: string
  /**
   * Where the hand fix's changed region lands — a **required** second sink, unlike the face
   * mask above: the cutout says nothing about what to clear without it.
   */
  regionDestPath?: string
  /** What this job is, for the log: `{charId} / {emotion}`. */
  label: string
  /** The parenthesised log suffix: `pose=…, seed=…`. */
  logContext: string
}

/** The node a `*_NODE` map names, or a permanent (unretried) failure. */
export function assertNode(
  workflow: ComfyWorkflow,
  id: string,
  workflowFile: string
): { inputs: Record<string, unknown> } {
  const node = workflow[id]
  if (!node) {
    throw appError(
      'COMFY_PROMPT_REJECTED',
      'The generation workflow does not match this build.',
      `${workflowFile} has no node ${id}; the node map in comfyService.ts is out of date.`
    )
  }
  return node
}

/** One log line per job, in the one format, whichever graph ran. */
function logJob(spec: GenerationSpec): void {
  if (!spec.prompts) {
    console.log(`[comfy] → ${spec.label} (${spec.logContext})`)
    return
  }
  console.log(
    `[comfy] → ${spec.label} (${spec.logContext})\n${spec.prompts.positive.replace(/\n\n/g, ' | ')}`
  )
  console.log('[comfy] → negative:', spec.prompts.negative)
  if (spec.detailerPositive) {
    console.log('[comfy] → detailer:', spec.detailerPositive.replace(/\n\n/g, ' | '))
  }
}

/**
 * The submit-wait-save pipeline every render shares; callers stage their own input
 * files first.
 */
async function runGenerationJob(spec: GenerationSpec, options: RunOptions): Promise<string> {
  try {
    return await runGraph(spec, options)
  } catch (err) {
    // A player's own server that stopped answering, or turned a graph down, is checked afresh
    // by the next job, which then names what is missing; one that is gone says so on the chip.
    if (options.target.source === 'external' && isAppError(err)) {
      if (err.code === 'COMFY_UNREACHABLE' || err.code === 'COMFY_PROMPT_REJECTED') forgetExternal()
      if (err.code === 'COMFY_UNREACHABLE') emit('error', err)
    }
    throw err
  }
}

/** One graph run through submit, wait and save, its models written in and checked first. */
async function runGraph(spec: GenerationSpec, options: RunOptions): Promise<string> {
  const { signal, onProgress, target } = options
  const { nodes, prompts } = spec

  const workflow = JSON.parse(
    await readFile(getWorkflowPath(spec.workflowFile), 'utf-8')
  ) as ComfyWorkflow

  const node = (id: string): { inputs: Record<string, unknown> } =>
    assertNode(workflow, id, spec.workflowFile)

  if (prompts) {
    if (nodes.positivePrompt) node(nodes.positivePrompt).inputs.text = prompts.positive
    if (nodes.negativePrompt) node(nodes.negativePrompt).inputs.text = prompts.negative
  }
  if (nodes.seed && spec.seed !== undefined) node(nodes.seed).inputs.seed = spec.seed
  if (nodes.detailerPositivePrompt && spec.detailerPositive) {
    node(nodes.detailerPositivePrompt).inputs.text = spec.detailerPositive
  }
  if (nodes.poseImage && spec.poseImageName) {
    node(nodes.poseImage).inputs.image = spec.poseImageName
  }
  if (nodes.sourceImage && spec.sourceImageName) {
    node(nodes.sourceImage).inputs.image = spec.sourceImageName
  }
  if (nodes.paintImage && spec.paintImageName) {
    node(nodes.paintImage).inputs.image = spec.paintImageName
  }

  // Only a job that wants the face mask keeps its branch.
  const faceSave: SaveTarget | null =
    spec.faceDestPath && nodes.faceSaveImage
      ? { node: nodes.faceSaveImage, destPath: spec.faceDestPath, format: 'lossless' }
      : null
  /** The hand fix's second sink. Required where the graph names it: half a fix is not one. */
  const regionSave: SaveTarget | null =
    spec.regionDestPath && nodes.regionSaveImage
      ? { node: nodes.regionSaveImage, destPath: spec.regionDestPath, format: spec.format }
      : null
  if (nodes.faceNodes && !faceSave) {
    for (const id of nodes.faceNodes) {
      assertNode(workflow, id, spec.workflowFile)
      delete workflow[id]
    }
  }

  // The models go in once the graph is final, and what it then names is checked against the
  // server's own lists, so a missing file is named rather than turned down as a whole graph.
  applyModelPicks(workflow, resolvedPicks(target, await listingFor(target)), target.loraWeight)
  // Hers and the pair's after the picks, so a file named as the style LoRA ships is never taken
  // for it.
  if (nodes.characterLora) drawLora(workflow, spec.workflowFile, nodes.characterLora, spec.lora)
  if (nodes.positionLora) {
    drawLora(workflow, spec.workflowFile, nodes.positionLora, spec.positionLora)
  }
  await assertGraphModels(target, workflow, nodes)

  throwIfCancelled(signal)
  logJob(spec)

  const save: SaveTarget = { node: nodes.saveImage, destPath: spec.destPath, format: spec.format }

  const promptId = await submitWorkflow(target, workflow)
  const { history, executionError } = await waitForPrompt(target, promptId, signal, onProgress)

  // The required sinks say whether the job succeeded, not the graph's status.
  const landed = (sink: SaveTarget | null): boolean =>
    sink === null || imageOf(history, sink.node) !== undefined
  if (executionError && !(landed(save) && landed(regionSave))) throw executionError
  if (executionError) {
    console.warn(`[comfy] ${spec.label}: ${executionError.message} ${executionError.detail ?? ''}`)
  }

  let destPath: string
  try {
    destPath = await saveResult(target, history, promptId, save, signal, onProgress)
    // Inside the same try: a region that failed to save leaves a cutout nothing can place.
    if (regionSave) await saveResult(target, history, promptId, regionSave, signal, onProgress)
  } catch (err) {
    // The sprite is what the job is; its failure takes the other sinks' output with it.
    if (faceSave) await discardOutput(target, history, faceSave)
    if (regionSave) await discardOutput(target, history, regionSave)
    throw err
  }

  if (faceSave) {
    try {
      await saveResult(target, history, promptId, faceSave, signal, onProgress)
    } catch (err) {
      // A cancel propagates; any other failure leaves the portrait to be framed off a median
      // face rather than her own (`defaultProfileCrop`), and is logged.
      if (isAppError(err) && err.code === 'CANCELLED') throw err
      await discardOutput(target, history, faceSave)
      console.warn(`[comfy] ${spec.label}: no face mask — ${messageOf(err)}`)
    }
  }

  return destPath
}

/** Writes one LoRA into its loader, or takes the loader out of the graph where there is none. */
function drawLora(
  workflow: ComfyWorkflow,
  workflowFile: string,
  id: string,
  lora: DrawnLora | null | undefined
): void {
  const loader = assertNode(workflow, id, workflowFile)
  if (!lora) {
    bypassLoraLoader(workflow, id)
    return
  }
  loader.inputs.lora_name = lora.name
  loader.inputs.strength_model = lora.weight
  loader.inputs.strength_clip = lora.weight
}

/** Her own LoRA as a job draws it, and the log suffix naming it; nothing where she has none. */
function loraOfJob(character: Character): {
  lora: DrawnLora | null
  logged: string
} {
  const lora = characterLoraOf(character)
  return { lora, logged: lora ? `, lora=${lora.name}@${lora.weight}` : '' }
}

/** The pose's tags, or a permanent failure if the pose is not installed. */
async function resolvePoseTags(character: Character): Promise<readonly string[]> {
  const poseTags = await getPoseTags(character.pose)
  if (!poseTags) {
    throw appError(
      'POSE_UNAVAILABLE',
      `This character's pose ("${character.pose}") is not available.`,
      'The pose must have both an entry in pose.json and a matching skeleton PNG.'
    )
  }
  return poseTags
}

/**
 * Hands one picture a graph reads to the server, into the input subfolder kept apart from the
 * player's own files, and returns the name its `LoadImage` reads it under. It goes over HTTP
 * whichever server it is, so a player's own ComfyUI on another machine reads the same picture.
 */
async function uploadInput(target: ComfyTarget, name: string, bytes: Buffer): Promise<string> {
  const form = new FormData()
  form.append('image', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), name)
  form.append('type', 'input')
  form.append('subfolder', INPUT_SUBFOLDER)
  form.append('overwrite', 'true')

  let response: Response
  try {
    response = await fetch(`${target.baseUrl}/upload/image`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS)
    })
  } catch (err) {
    throw appError(
      'COMFY_UNREACHABLE',
      'Could not reach ComfyUI to hand it a picture the render reads.',
      messageOf(err)
    )
  }

  const body = await response.text()
  let answer: { name?: unknown; subfolder?: unknown } = {}
  try {
    answer = JSON.parse(body) as typeof answer
  } catch {
    // Read as no answer below.
  }
  if (!response.ok || typeof answer.name !== 'string' || answer.name === '') {
    throw appError(
      'COMFY_UPLOAD_FAILED',
      'ComfyUI would not take a picture the render reads.',
      `HTTP ${response.status}: ${truncate(body, 500)}`
    )
  }
  const subfolder = typeof answer.subfolder === 'string' ? answer.subfolder : ''
  return subfolder ? `${subfolder}/${answer.name}` : answer.name
}

/** Hands the character's skeleton to the server for the graphs' pose `LoadImage`. */
async function stagePose(
  character: Character,
  target: ComfyTarget
): Promise<{ poseTags: readonly string[]; skeletonName: string }> {
  const poseTags = await resolvePoseTags(character)
  const bytes = await readFile(getPoseSkeletonPath(character.pose))
  const skeletonName = await uploadInput(target, `pose_${character.pose}.png`, bytes)
  return { poseTags, skeletonName }
}

/**
 * Hands a set's base frame — the staged one on a staged run — to the server and returns the
 * name `LoadImage` reads it under, with whether the frame already carries its cutout. A frame
 * kept as WebP is handed over as a PNG, cut where it has an alpha channel.
 */
async function stageBase(
  charId: string,
  livePath: string,
  stagedPath: string,
  staged: boolean,
  scope: string,
  target: ComfyTarget
): Promise<{ sourceName: string; cut: boolean }> {
  const named = staged ? stagedPath : livePath
  const sourcePath = await findImage(named)
  if (sourcePath === null) {
    // Permanent: only the neutral job renders the base frame.
    throw appError(
      'EXPRESSION_SOURCE_MISSING',
      'The neutral expression has to be rendered before the other expressions can be.',
      named
    )
  }

  // Namespaced by character and set so an aborted job's file is never another's source.
  const fileName = `expr_src_${charId}_${scope}.png`
  // The graph's `LoadImage` is handed a PNG whatever the frame is stored as.
  if (sourcePath.toLowerCase().endsWith('.png')) {
    const bytes = await readFile(sourcePath)
    return { sourceName: await uploadInput(target, fileName, bytes), cut: isRgbaPng(bytes) }
  }

  let png: Buffer
  let cut: boolean
  try {
    const image = await openImage(await readFile(sourcePath))
    cut = (await image.metadata()).hasAlpha
    png = await image.png({ compressionLevel: 1 }).toBuffer()
  } catch (err) {
    throw appError(
      'EXPRESSION_SOURCE_MISSING',
      'The neutral expression has to be rendered before the other expressions can be.',
      `${sourcePath} could not be read as an image: ${messageOf(err)}`
    )
  }
  return { sourceName: await uploadInput(target, fileName, png), cut }
}

/**
 * The staged name of a base frame that carries its cutout. A frame rendered before the base
 * graph cut its own background is opaque, so it is cut once here, in place, and staged again:
 * every sprite of the set then takes its alpha from the frame instead of cutting its own.
 */
async function ensureCutBase(
  charId: string,
  livePath: string,
  stagedPath: string,
  staged: boolean,
  scope: string,
  suffix: string,
  options: RunOptions
): Promise<string> {
  const { target } = options
  const { sourceName, cut } = await stageBase(charId, livePath, stagedPath, staged, scope, target)
  if (cut) return sourceName

  await runGenerationJob(
    {
      workflowFile: 'characterCutout.json',
      nodes: CUTOUT_NODE,
      sourceImageName: sourceName,
      destPath: staged ? stagedPath : livePath,
      format: 'lossless',
      label: `${charId} / cut${suffix}`,
      logContext: 'base cutout'
    },
    options
  )
  throwIfCancelled(options.signal)

  return (await stageBase(charId, livePath, stagedPath, staged, scope, target)).sourceName
}

/**
 * Hands the player's strokes to the server for the hands graph's `LoadImage`, under
 * {@link stageBase}'s scoped-name rule. **The alpha channel is the whole input** — node `80`'s
 * MASK is `1 − alpha`, so a PNG saved without one hands the graph an all-painted mask.
 */
async function stagePaint(
  charId: string,
  scope: string,
  paint: Buffer,
  target: ComfyTarget
): Promise<string> {
  if (!isRgbaPng(paint)) {
    throw appError(
      'FIX_NOT_PNG',
      'The painted layer was not readable.',
      `the paint layer is not an RGBA PNG (colour type ${paint[25]}).`
    )
  }

  return uploadInput(target, `hands_paint_${charId}_${scope}.png`, paint)
}

/**
 * Renders one sprite — an expression of the default look when `set` is `null`, or of that
 * wardrobe set — then removes the app's own server's copy.
 */
export async function generateSprite(
  character: Character,
  set: OutfitSet | null,
  emotion: Emotion,
  seedOverride?: number,
  staged = false,
  edit?: PromptEdit,
  jobOptions: JobOptions = {}
): Promise<string> {
  assertSafeCharId(character.charId)
  if (set !== null) assertVocab(set, isOutfitSet, 'OUTFIT_SET_UNKNOWN', 'an outfit set')
  assertVocab(emotion, isEmotion, 'EMOTION_UNKNOWN', 'an expression')
  throwIfCancelled(jobOptions.signal)
  jobOptions.onProgress?.('Preparing')
  const options = await runOptionsOf(jobOptions)

  const { charId } = character
  const seed = seedOverride ?? character.generationSeed
  const suffix = set ? `_${set}` : ''
  const destPath = set
    ? staged
      ? getStagedPath(charId, outfitRel(set, emotion))
      : getCharacterOutfitPath(charId, set, emotion)
    : staged
      ? getStagedPath(charId, expressionRel(emotion))
      : getCharacterExpressionPath(charId, emotion)
  const livePath = set ? getOutfitBasePath(charId, set) : getExpressionBasePath(charId)
  const stagedPath = getStagedPath(charId, baseRel(set))

  // Staged once: the base pass and the face pass read the same skeleton.
  const { poseTags, skeletonName } = await stagePose(character, options.target)

  const { lora, logged } = loraOfJob(character)

  // The portrait is cut from the default wardrobe's `neutral` and nothing else.
  const cutsProfile = emotion === 'neutral' && set === null

  // A single sprite is a face pass over the frame the set already has; only a set with none
  // renders one.
  const faceOnly = edit?.kind === 'expression'

  if (
    emotion === 'neutral' &&
    (!faceOnly || (await findImage(staged ? stagedPath : livePath)) === null)
  ) {
    await runGenerationJob(
      {
        // No expression group: every sprite cut from this frame repaints its face.
        workflowFile: 'characterBase.json',
        nodes: BASE_NODE,
        prompts: set
          ? buildOutfitBasePrompt(character, poseTags, set, options.target.tags, edit)
          : buildBasePrompt(character, poseTags, options.target.tags, edit),
        seed,
        lora,
        poseImageName: skeletonName,
        destPath: staged ? stagedPath : livePath,
        format: 'lossless',
        label: `${charId} / base${suffix}`,
        logContext:
          `pose=${character.pose}, seed=${seed}${logged}` + (edit !== undefined ? ', edited' : '')
      },
      options
    )
    throwIfCancelled(options.signal)
  }

  const sourceName = await ensureCutBase(
    charId,
    livePath,
    stagedPath,
    staged,
    set ?? 'default',
    suffix,
    options
  )

  const written = await runGenerationJob(
    {
      // The main-outfit prompt whichever the set: a face pass prompts for the face.
      workflowFile: 'characterExpression.json',
      nodes: EXPRESSION_NODE,
      prompts: buildImagePrompt(character, poseTags, emotion, options.target.tags, edit),
      seed,
      lora,
      sourceImageName: sourceName,
      poseImageName: skeletonName,
      destPath,
      format: 'lossy',
      // The one face mask: the default wardrobe's `neutral` and nothing else.
      faceDestPath: cutsProfile
        ? staged
          ? getStagedPath(charId, faceRel())
          : getCharacterFacePath(charId)
        : undefined,
      label: `${charId} / ${emotion}${suffix}`,
      logContext: `face-pass, seed=${seed}${logged}${edit !== undefined ? ', edited' : ''}`
    },
    options
  )

  // A face-only pass repaints the face on the same frame, so her stored crop still fits and is
  // kept; every other render is framed under the seed it actually rendered under, so a one-off
  // render on a borrowed seed gets the default frame rather than the last one's.
  if (cutsProfile)
    await tryCutProfile(
      charId,
      faceOnly ? character : { ...character, generationSeed: seed },
      staged
    )

  return written
}

/**
 * Renders one landscape CG into the character's folder — `cg/`, or a custom pair's own — then
 * removes ComfyUI's own output copy.
 */
export async function generateCg(
  character: Character,
  position: Position,
  seedOverride?: number,
  staged = false,
  edit?: PromptEdit,
  jobOptions: JobOptions = {}
): Promise<string> {
  assertSafeCharId(character.charId)
  assertVocab(position, isPosition, 'POSITION_UNKNOWN', 'a CG position')
  throwIfCancelled(jobOptions.signal)
  jobOptions.onProgress?.('Preparing')
  const options = await runOptionsOf(jobOptions)

  const seed = seedOverride ?? character.generationSeed
  const { lora, logged } = loraOfJob(character)
  // A stock CG never draws one, and a pair with none takes its loader out.
  const positionLora = customCgLoraOf(character, position)
  const { poseTags, skeletonName } = await stagePose(character, options.target)
  const { positive, negative, detailerPositive } = buildCgPrompt(
    character,
    position,
    poseTags,
    options.target.tags,
    edit
  )

  return runGenerationJob(
    {
      workflowFile: 'characterCg.json',
      nodes: CG_NODE,
      prompts: { positive, negative },
      detailerPositive,
      seed,
      lora,
      positionLora,
      poseImageName: skeletonName,
      destPath: staged
        ? getStagedPath(character.charId, cgRel(position))
        : getCharacterCgPath(character.charId, position),
      format: 'lossy',
      label: `${character.charId} / cg:${position}`,
      logContext:
        `seed=${seed}${logged}` +
        (positionLora ? `, positionLora=${positionLora.name}@${positionLora.weight}` : '') +
        (edit !== undefined ? ', edited' : '')
    },
    options
  )
}

/**
 * Redraws the hand the player painted on: the cutout and the region changed, for the renderer
 * to place. **Strokes are read against the set's base frame, never a sprite**: every sprite is
 * a face pass over that frame, so one fix there covers all seven, and the frame itself is only
 * ever read, so a bad fix costs nothing on disk.
 */
export async function fixHands(
  character: Character,
  set: OutfitSet | null,
  paint: Buffer,
  seed: number,
  jobOptions: JobOptions = {}
): Promise<{ cutout: Buffer; region: Buffer }> {
  assertSafeCharId(character.charId)
  if (set !== null) assertVocab(set, isOutfitSet, 'OUTFIT_SET_UNKNOWN', 'an outfit set')
  throwIfCancelled(jobOptions.signal)
  jobOptions.onProgress?.('Preparing')
  const options = await runOptionsOf(jobOptions)
  const { target } = options

  const { charId } = character
  const scope = set ?? 'default'
  const suffix = set ? `_${set}` : ''
  const basePath = set ? getOutfitBasePath(charId, set) : getExpressionBasePath(charId)

  const { lora, logged } = loraOfJob(character)
  const { poseTags, skeletonName } = await stagePose(character, target)
  // Live only: a fix repairs the set on disk, and a staged run is a different set of images.
  const { sourceName } = await stageBase(charId, basePath, basePath, false, scope, target)
  const paintName = await stagePaint(charId, scope, paint, target)

  // Both frames land in scratch and are read back: neither belongs in her folder, since what
  // is kept is the strokes and the sprites they repaired.
  const scratch = join(getTempPath(), `hands-${randomUUID()}`)
  try {
    await mkdir(scratch, { recursive: true })
    await runGenerationJob(
      {
        // The set's base prompt, no expression group: the frame this repaints is the base's.
        workflowFile: 'characterHands.json',
        nodes: HANDS_NODE,
        prompts: set
          ? buildOutfitBasePrompt(character, poseTags, set, target.tags)
          : buildBasePrompt(character, poseTags, target.tags),
        seed,
        lora,
        poseImageName: skeletonName,
        sourceImageName: sourceName,
        paintImageName: paintName,
        destPath: join(scratch, 'cutout.png'),
        regionDestPath: join(scratch, 'region.png'),
        format: 'raw',
        label: `${charId} / hands${suffix}`,
        logContext: `pose=${character.pose}, seed=${seed}${logged}`
      },
      options
    )

    return {
      cutout: await readFile(join(scratch, 'cutout.png')),
      region: await readFile(join(scratch, 'region.png'))
    }
  } finally {
    // A cancel between the two sinks leaves one PNG behind; nothing else sweeps this folder.
    await rm(scratch, { recursive: true, force: true })
  }
}

/** The extensions ComfyUI lists a model file under, as its `supported_pt_extensions` names them. */
const MODEL_EXTENSIONS = new Set(['.ckpt', '.pt', '.pt2', '.bin', '.pth', '.safetensors', '.pkl', '.sft'])

/** The folders under the app's own install's `models/` each slot's loader lists. */
const MANAGED_MODEL_DIRS: Readonly<Record<ComfyModelRole, readonly string[]>> = {
  checkpoint: ['checkpoints'],
  lora: ['loras'],
  controlnet: ['controlnet', 't2i_adapter'],
  upscaler: ['upscale_models'],
  handDetector: [join('ultralytics', 'bbox')],
  faceSegDetector: [join('ultralytics', 'segm')]
}

/**
 * Every model file under one folder as ComfyUI names it: recursive, following links and skipping
 * `.git`, relative to the folder with this platform's separators, by extension. A folder that is
 * not there lists nothing.
 */
async function listModelFolder(root: string): Promise<string[]> {
  const found: string[] = []
  async function walk(dir: string): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const path = join(dir, name)
      let info
      try {
        info = await stat(path)
      } catch {
        continue
      }
      if (info.isDirectory()) {
        if (name !== '.git') await walk(path)
      } else if (MODEL_EXTENSIONS.has(extname(name).toLowerCase())) {
        found.push(relative(root, path))
      }
    }
  }
  await walk(root)
  return found
}

/**
 * Each slot's models in the app's own install, read off its folders rather than asked of the
 * server, so the lists are there whether or not it is running.
 */
export async function listLocalModels(): Promise<ComfyModelLists> {
  const lists = emptyModelLists()
  for (const slot of COMFY_MODEL_SLOTS) {
    const names: string[] = []
    for (const dir of MANAGED_MODEL_DIRS[slot.role]) {
      names.push(...(await listModelFolder(getComfyModelDirPath(dir))))
    }
    lists[slot.role] = [...new Set(names)].sort().map((name) => slot.prefix + name)
  }
  return lists
}

/** Refuses a URL from the renderer that no ComfyUI could be asked at. */
function assertComfyUrl(url: string): void {
  const problem = typeof url === 'string' ? comfyUrlProblem(url) : 'No URL was given.'
  if (problem !== null) throw appError('COMFY_URL_INVALID', problem)
}

/**
 * Whether a folder a player's own server names is one the app may stat and open: on this
 * machine's own drives only. A `\\host\share` path would have Windows open a network connection
 * and hand it the player's credentials just to look.
 */
function isLocalDrivePath(path: unknown): path is string {
  return typeof path === 'string' && /^[A-Za-z]:[\\/]/.test(path)
}

/** Whether a path is a directory, read without following it anywhere but this machine. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * The folders on this machine a player's own server keeps each slot's models in, in the server's
 * order, none where it keeps none here: asked of `/internal/folder_paths`, and only where the
 * server is this machine. The paths themselves never leave main: they are neither logged nor
 * answered to the renderer.
 */
async function externalModelFolders(baseUrl: string): Promise<Record<ComfyModelRole, string[]>> {
  const folders = {} as Record<ComfyModelRole, string[]>
  for (const slot of COMFY_MODEL_SLOTS) folders[slot.role] = []
  if (!isLoopbackUrl(baseUrl)) return folders

  let listed: Record<string, unknown>
  try {
    const response = await fetch(`${baseUrl}/internal/folder_paths`, {
      signal: AbortSignal.timeout(STATS_TIMEOUT_MS)
    })
    if (!response.ok) return folders
    listed = (await response.json()) as Record<string, unknown>
  } catch {
    return folders
  }

  for (const slot of COMFY_MODEL_SLOTS) {
    const paths = listed[slot.folderKey]
    if (!Array.isArray(paths)) continue
    for (const path of paths) {
      if (isLocalDrivePath(path) && (await isDirectory(path))) folders[slot.role].push(path)
    }
  }
  return folders
}

/**
 * Which of a slot's folders on a player's own server to open: the first holding the file the
 * player sees picked, else the first holding any model, else the first named as the slot's own
 * folder is, else the first. The pick is only compared against what the folders hold.
 */
async function folderHoldingModels(
  slot: ComfyModelSlot,
  folders: readonly string[],
  pick: string | undefined
): Promise<string> {
  const slash = (path: string): string => path.replace(/\\/g, '/')
  const wanted =
    pick !== undefined && pick.startsWith(slot.prefix) && pick.length > slot.prefix.length
      ? slash(pick.slice(slot.prefix.length))
      : null
  const listings: string[][] = []
  for (const folder of folders) {
    const names = (await listModelFolder(folder)).map(slash)
    if (wanted !== null && names.includes(wanted)) return folder
    listings.push(names)
  }
  const stocked = folders.find((_, i) => listings[i].length > 0)
  if (stocked !== undefined) return stocked
  const own = basename(MANAGED_MODEL_DIRS[slot.role][0]).toLowerCase()
  return folders.find((folder) => basename(folder).toLowerCase() === own) ?? folders[0]
}

/**
 * What a player's own ComfyUI at `url` has: its version, the workflow classes it lacks grouped
 * by pack, each slot's models, and which slots' folders the app can open on this machine. A
 * server that does not answer is refused; one that cannot say where its folders are has none.
 */
export async function probe(url: string): Promise<ComfyProbe> {
  assertComfyUrl(url)
  let version = ''
  try {
    const response = await fetch(`${url}/system_stats`, {
      signal: AbortSignal.timeout(STATS_TIMEOUT_MS)
    })
    if (!response.ok) throw new Error(`HTTP ${response.status} from /system_stats`)
    const stats = (await response.json()) as { system?: { comfyui_version?: unknown } }
    if (typeof stats.system?.comfyui_version === 'string') version = stats.system.comfyui_version
  } catch (err) {
    throw appError(
      'COMFY_UNREACHABLE',
      `Could not reach ComfyUI at ${redactUrl(url)}.`,
      messageOf(err)
    )
  }

  const objectInfo = await fetchObjectInfo(url)
  const located = await externalModelFolders(url)
  const folders = {} as Record<ComfyModelRole, boolean>
  for (const slot of COMFY_MODEL_SLOTS) folders[slot.role] = located[slot.role].length > 0
  return {
    version,
    missingNodes: groupMissingNodes(await missingClasses(objectInfo)),
    models: modelListsOf(objectInfo),
    folders
  }
}

/**
 * The folder one slot's models are dropped into: the app's own install's, created where the
 * portable build ships without it, or the one of a player's own server at `url` that holds the
 * slot's models, `pick` among them first — asked again here, never taken from the renderer.
 */
export async function modelFolderOf(
  role: ComfyModelRole,
  url: string | null,
  pick?: string
): Promise<string> {
  const slot = COMFY_MODEL_SLOTS.find((s) => s.role === role)
  if (!slot) {
    throw appError('MODEL_UNKNOWN', 'That is not one of the model slots.', String(role))
  }
  if (url === null) {
    const dir = getComfyModelDirPath(MANAGED_MODEL_DIRS[role][0])
    await mkdir(dir, { recursive: true })
    return dir
  }
  assertComfyUrl(url)
  const folders = (await externalModelFolders(url))[role]
  if (folders.length === 0) {
    throw appError(
      'OPEN_FOLDER_FAILED',
      'Could not find that model folder on this computer.',
      `ComfyUI at ${redactUrl(url)} named no folder here for ${role}.`
    )
  }
  return folderHoldingModels(slot, folders, pick)
}
