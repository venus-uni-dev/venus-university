import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { closeSync, openSync } from 'fs'
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { nativeImage } from 'electron'
import {
  buildBasePrompt,
  buildCgPrompt,
  buildImagePrompt,
  buildOutfitBasePrompt
} from '@shared/imagePrompt'
import { COMFY_HOST } from '@shared/setupManifest'
import { appError, isAppError, messageOf, tailOf, toAppError, truncate } from '@shared/errors'
import { isEmotion } from '@shared/emotions'
import { baseRel, cgRel, expressionRel, faceRel, outfitRel } from '@shared/characterFiles'
import { isOutfitSet } from '@shared/outfits'
import { isPosition } from '@shared/positions'
import type { Character, Emotion, OutfitSet, Position } from '@shared/types'
import {
  getCharacterCgPath,
  getCharacterExpressionPath,
  getCharacterFacePath,
  getCharacterOutfitPath,
  getComfyAppPath,
  getComfyInputPath,
  getComfyLogPath,
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
import { assertSafeCharId } from './characterService'
import { dropImageTwins, findImage } from './imageFiles'
import { imageTypeOf } from '@shared/imageBytes'
import { killStrayProcesses, killTree, listProcessIds } from './processTree'
import { tryCutProfile } from './profileService'
import { sleep } from '@shared/retry'

const BASE_URL = `http://${COMFY_HOST}`
const PORT = COMFY_HOST.split(':')[1]

/** Node ids overwritten in `assets/workflows/characterBase.json`. */
const BASE_NODE = {
  seed: '14',
  positivePrompt: '4',
  negativePrompt: '5',
  poseImage: '39',
  saveImage: '41'
} as const

/**
 * Node ids overwritten in `assets/workflows/characterExpression.json`; `seed` is the
 * Face Detailer's, since the graph has no KSampler.
 */
const EXPRESSION_NODE = {
  seed: '14',
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

/**
 * True once the running server has answered for every class the workflows name. Cleared
 * whenever a process is spawned or killed, so the check costs one request per server, not
 * one per job.
 */
let nodesVerified = false

/** True when ComfyUI answers `/system_stats`. */
async function isRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/system_stats`, { signal: AbortSignal.timeout(2000) })
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

  throw appError(
    'COMFY_PORT_TAKEN',
    `ComfyUI could not start: another program is using port ${PORT}.`,
    pids === null
      ? `Something answered on ${COMFY_HOST} and Windows would not say what is running.`
      : `Something answered on ${COMFY_HOST}, but nothing is running from ${python}.`
  )
}

/**
 * Starts ComfyUI headless, waits through cold torch/custom-node imports, then
 * warms the checkpoint.
 */
export function start(onProgress?: (step: string) => void): Promise<void> {
  if (starting) return starting
  starting = startOnce(onProgress).finally(() => {
    starting = null
  })
  return starting
}

/** The actual boot; only ever one of these is live — see `starting`. */
async function startOnce(onProgress?: (step: string) => void): Promise<void> {
  if (await isRunning()) {
    // A server we did not spawn is adopted only once it has been shown to be ours;
    // `nodesVerified` holds that verdict too, so the listing costs one call per server
    // rather than one per job.
    if (!nodesVerified && serverProcess === null) assertOwnServer()
    await assertWorkflowNodes()
    return
  }

  onProgress?.('Starting ComfyUI')
  const python = getComfyPythonPath()

  // Both streams go to the log file through one descriptor: a file has no pipe to fill, and
  // the tail is the detail when a boot dies. A log that will not open does not stop the boot.
  let logFd: number | null = null
  try {
    logFd = openSync(getComfyLogPath(), 'w')
  } catch (err) {
    console.warn('[comfy] could not open the log file:', messageOf(err))
  }

  nodesVerified = false
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
      nodesVerified = false
    }
    exitCode = code
  })
  serverProcess = child

  const deadline = Date.now() + 180_000
  let ready = false
  while (Date.now() < deadline) {
    await sleep(1000)
    if (await isRunning()) {
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
    stop()
    throw appError(
      'COMFY_START_TIMEOUT',
      'ComfyUI did not become ready within three minutes.',
      await bootDetail(`Tried to start ${python} on ${COMFY_HOST}.`, spawnError)
    )
  }

  await assertWorkflowNodes()

  onProgress?.('Loading checkpoint')
  await warm()
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

/**
 * Refuses a server that came up without a class one of the workflows names: a custom node
 * whose imports failed is skipped silently at boot, and the first job would fail as an
 * unexplained rejection halfway through a render.
 */
async function assertWorkflowNodes(): Promise<void> {
  if (nodesVerified) return

  const dir = getWorkflowsPath()
  const files = (await readdir(dir)).filter((name) => name.endsWith('.json'))
  const wanted = new Set<string>()
  for (const file of files) {
    const graph = JSON.parse(await readFile(join(dir, file), 'utf-8')) as ComfyWorkflow
    for (const node of Object.values(graph)) wanted.add(node.class_type)
  }

  let registered: Set<string>
  try {
    const response = await fetch(`${BASE_URL}/object_info`, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status} from /object_info`)
    registered = new Set(Object.keys((await response.json()) as Record<string, unknown>))
  } catch (err) {
    throw appError(
      'COMFY_UNREACHABLE',
      'Could not ask ComfyUI which nodes it loaded.',
      messageOf(err)
    )
  }

  const missing = [...wanted].filter((name) => !registered.has(name)).sort()
  if (missing.length > 0) {
    throw appError(
      'COMFY_NODES_MISSING',
      'ComfyUI started without nodes the workflows need.',
      `Missing: ${missing.join(', ')}. Open Setup and run Install missing. ` +
        `ComfyUI's log: ${getComfyLogPath()}`
    )
  }

  nodesVerified = true
  console.log(`[comfy] ${wanted.size} node classes the workflows name are loaded`)
}

/** Runs a 1-step warm-up job; failures are logged because the first real job can recover. */
async function warm(): Promise<void> {
  try {
    const promptId = await submitWorkflow(WARM_WORKFLOW as unknown as ComfyWorkflow)
    await waitForPrompt(promptId)
  } catch (err) {
    console.warn('[comfy] checkpoint warm-up failed:', err)
  }
}

/**
 * Kills the server we spawned, and any worker it spawned in turn. A server we
 * did not start is left alone.
 */
export function stop(): void {
  nodesVerified = false
  if (!serverProcess) return
  killTree(serverProcess.pid)
  serverProcess = null
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
async function submitWorkflow(workflow: ComfyWorkflow): Promise<string> {
  let response: Response
  try {
    response = await fetch(`${BASE_URL}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: 'venus-university' })
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

/** Drops a prompt from the queue and interrupts it if it is already running. */
async function cancelPrompt(promptId: string): Promise<void> {
  try {
    await fetch(`${BASE_URL}/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete: [promptId] }),
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS)
    })
    await fetch(`${BASE_URL}/interrupt`, {
      method: 'POST',
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
      await cancelPrompt(promptId)
      throw appError('CANCELLED', 'Generation was cancelled.')
    }

    // The wall clock: the one bound on a prompt `/history` never lists.
    if (Date.now() > deadline) {
      await cancelPrompt(promptId)
      throw appError(
        'COMFY_WAIT_TIMEOUT',
        'ComfyUI never finished the image.',
        `prompt ${promptId} was still unfinished after ${Math.round(WAIT_DEADLINE_MS / 60_000)} minutes.`
      )
    }

    // Not the job's `signal`: an abort here would skip the `cancelPrompt` at the top.
    try {
      const response = await fetch(`${BASE_URL}/history/${promptId}`, {
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
                truncate(JSON.stringify(entry.status.messages), 2000)
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

    report((await isQueuedAhead(promptId)) ? 'Queued in ComfyUI' : 'Rendering')
    await sleep(1500, signal)
  }
}

/** True when the prompt is still waiting rather than executing. */
async function isQueuedAhead(promptId: string): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/queue`, {
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
async function fetchImage(image: ComfyImage): Promise<Buffer> {
  const query = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder ?? '',
    type: image.type ?? 'output'
  })
  const response = await fetch(`${BASE_URL}/view?${query}`)
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

/** One sink of a finished graph: which `SaveImage` node, and where its PNG goes. */
interface SaveTarget {
  node: string
  destPath: string
}

/** What one sink of a finished graph produced, if it ran at all. */
function imageOf(history: PromptHistory, node: string): ComfyImage | undefined {
  return history.outputs?.[node]?.images?.[0]
}

/** Removes a cancelled-but-finished render from ComfyUI's unpruned `output/`. */
async function discardOutput(history: PromptHistory, save: SaveTarget): Promise<void> {
  const image = imageOf(history, save.node)
  if (!image) return

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
 * Fetches one finished sink and writes it to its destination, then removes ComfyUI's own
 * output copy — the tail every generation job shares.
 */
async function saveResult(
  history: PromptHistory,
  promptId: string,
  save: SaveTarget,
  signal?: AbortSignal,
  onProgress?: (step: string) => void
): Promise<string> {
  // Catches an abort that arrived in the same tick the prompt completed.
  if (signal?.aborted) {
    await discardOutput(history, save)
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

  // ComfyUI's name for the file is refused here, before anything is downloaded or written.
  const outputPath = getComfyOutputFilePath(image)

  onProgress?.('Saving')

  const bytes = await fetchImage(image)

  // Last gate before the write: the `mkdir` below would recreate a folder that
  // `chars:delete` just removed.
  if (signal?.aborted) {
    await discardOutput(history, save)
    throw appError('CANCELLED', 'Generation was cancelled.')
  }

  await mkdir(dirname(save.destPath), { recursive: true })
  // Write-then-rename replaces the old sprite in one step.
  const partialPath = `${save.destPath}.partial`
  await writeFile(partialPath, bytes)
  await rename(partialPath, save.destPath)
  await dropImageTwins(save.destPath)

  await rm(outputPath, { force: true })

  return save.destPath
}

/** How one queued job is run, as `jobQueue` supplies it. */
type JobOptions = { signal?: AbortSignal; onProgress?: (step: string) => void }

/** Which node ids one graph exposes, and what each is for. */
interface GenerationNodes {
  seed: string
  positivePrompt: string
  negativePrompt: string
  saveImage: string
  /** The Face Detailer's own positive encode; the CG graph only. */
  detailerPositivePrompt?: string
  /** ControlNet skeleton `LoadImage`; every graph has one. */
  poseImage?: string
  /** Source `LoadImage`; the expression and hands graphs. */
  sourceImage?: string
  /** The painted-strokes `LoadImage`; the hands graph only. */
  paintImage?: string
  /** The face mask's `SaveImage`; the expression graph only. */
  faceSaveImage?: string
  /** The changed region's `SaveImage`; the hands graph only, and required where it is named. */
  regionSaveImage?: string
  /** Every node of the face-mask branch, deleted from the graph when no mask is wanted. */
  faceNodes?: readonly string[]
}

/** One render, fully resolved: which graph, what to write into it, where the PNGs go. */
interface GenerationSpec {
  /** Filename under `assets/workflows`. */
  workflowFile: string
  nodes: GenerationNodes
  prompts: { positive: string; negative: string }
  /** Text for `nodes.detailerPositivePrompt`, if the graph has one. */
  detailerPositive?: string
  seed: number
  /** Staged filename for `nodes.poseImage`, if the graph has one. */
  poseImageName?: string
  /** Staged filename for `nodes.sourceImage`, if the graph has one. */
  sourceImageName?: string
  /** Staged filename for `nodes.paintImage`, if the graph has one. */
  paintImageName?: string
  /** Where the finished PNG lands. */
  destPath: string
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
async function runGenerationJob(
  spec: GenerationSpec,
  options: { signal?: AbortSignal; onProgress?: (step: string) => void }
): Promise<string> {
  const { signal, onProgress } = options
  const { nodes, prompts } = spec

  const workflow = JSON.parse(
    await readFile(getWorkflowPath(spec.workflowFile), 'utf-8')
  ) as ComfyWorkflow

  const node = (id: string): { inputs: Record<string, unknown> } =>
    assertNode(workflow, id, spec.workflowFile)

  node(nodes.positivePrompt).inputs.text = prompts.positive
  node(nodes.negativePrompt).inputs.text = prompts.negative
  node(nodes.seed).inputs.seed = spec.seed
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
      ? { node: nodes.faceSaveImage, destPath: spec.faceDestPath }
      : null
  /** The hand fix's second sink. Required where the graph names it: half a fix is not one. */
  const regionSave: SaveTarget | null =
    spec.regionDestPath && nodes.regionSaveImage
      ? { node: nodes.regionSaveImage, destPath: spec.regionDestPath }
      : null
  if (nodes.faceNodes && !faceSave) {
    for (const id of nodes.faceNodes) {
      assertNode(workflow, id, spec.workflowFile)
      delete workflow[id]
    }
  }

  throwIfCancelled(signal)
  logJob(spec)

  const save: SaveTarget = { node: nodes.saveImage, destPath: spec.destPath }

  const promptId = await submitWorkflow(workflow)
  const { history, executionError } = await waitForPrompt(promptId, signal, onProgress)

  // The required sinks say whether the job succeeded, not the graph's status.
  const landed = (target: SaveTarget | null): boolean =>
    target === null || imageOf(history, target.node) !== undefined
  if (executionError && !(landed(save) && landed(regionSave))) throw executionError
  if (executionError) {
    console.warn(`[comfy] ${spec.label}: ${executionError.message} ${executionError.detail ?? ''}`)
  }

  let destPath: string
  try {
    destPath = await saveResult(history, promptId, save, signal, onProgress)
    // Inside the same try: a region that failed to save leaves a cutout nothing can place.
    if (regionSave) await saveResult(history, promptId, regionSave, signal, onProgress)
  } catch (err) {
    // The sprite is what the job is; its failure takes the other sinks' output with it.
    if (faceSave) await discardOutput(history, faceSave)
    if (regionSave) await discardOutput(history, regionSave)
    throw err
  }

  if (faceSave) {
    try {
      await saveResult(history, promptId, faceSave, signal, onProgress)
    } catch (err) {
      // A cancel propagates; any other failure leaves the portrait to be framed off a median
      // face rather than her own (`defaultProfileCrop`), and is logged.
      if (isAppError(err) && err.code === 'CANCELLED') throw err
      await discardOutput(history, faceSave)
      console.warn(`[comfy] ${spec.label}: no face mask — ${messageOf(err)}`)
    }
  }

  return destPath
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

/** Copies the character's skeleton into ComfyUI's input folder for `LoadImage`. */
async function stagePose(
  character: Character
): Promise<{ poseTags: readonly string[]; skeletonName: string }> {
  const poseTags = await resolvePoseTags(character)

  const skeletonName = `${character.pose}.png`
  await mkdir(getComfyInputPath(), { recursive: true })
  await copyFile(getPoseSkeletonPath(character.pose), join(getComfyInputPath(), skeletonName))
  return { poseTags, skeletonName }
}

/**
 * Copies a set's base frame — the staged one on a staged run — into ComfyUI's input
 * folder and returns the name `LoadImage` reads it under.
 */
async function stageBase(
  charId: string,
  livePath: string,
  stagedPath: string,
  staged: boolean,
  scope: string
): Promise<string> {
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
  const sourceName = `venus-university_expr_src_${charId}_${scope}.png`
  const destPath = join(getComfyInputPath(), sourceName)
  await mkdir(getComfyInputPath(), { recursive: true })
  // The graph's `LoadImage` is handed a PNG whatever the shipped cast is stored as.
  if (sourcePath.toLowerCase().endsWith('.png')) {
    await copyFile(sourcePath, destPath)
  } else {
    const decoded = nativeImage.createFromBuffer(await readFile(sourcePath))
    if (decoded.isEmpty()) {
      throw appError(
        'EXPRESSION_SOURCE_MISSING',
        'The neutral expression has to be rendered before the other expressions can be.',
        `${sourcePath} could not be read as an image.`
      )
    }
    await writeFile(destPath, decoded.toPNG())
  }
  return sourceName
}

/** Byte 25 of a PNG is its IHDR colour type; 6 is the RGBA the hand fix's mask is read from. */
const PNG_COLOUR_TYPE_RGBA = 6

/**
 * Writes the player's strokes where the hands graph's `LoadImage` reads them, under
 * {@link stageBase}'s scoped-name rule. **The alpha channel is the whole input** — node `80`'s
 * MASK is `1 − alpha`, so a PNG saved without one hands the graph an all-painted mask.
 */
async function stagePaint(charId: string, scope: string, paint: Buffer): Promise<string> {
  if (paint[25] !== PNG_COLOUR_TYPE_RGBA) {
    throw appError(
      'FIX_NOT_PNG',
      'The painted layer was not readable.',
      `the paint layer is PNG colour type ${paint[25]}, not RGBA (${PNG_COLOUR_TYPE_RGBA}).`
    )
  }

  const paintName = `venus-university_hands_paint_${charId}_${scope}.png`
  await mkdir(getComfyInputPath(), { recursive: true })
  await writeFile(join(getComfyInputPath(), paintName), paint)
  return paintName
}

/**
 * Renders one sprite — an expression of the default look when `set` is `null`, or of that
 * wardrobe set — then removes ComfyUI's own output copy.
 */
export async function generateSprite(
  character: Character,
  set: OutfitSet | null,
  emotion: Emotion,
  seedOverride?: number,
  staged = false,
  options: JobOptions = {}
): Promise<string> {
  assertSafeCharId(character.charId)
  if (set !== null) assertVocab(set, isOutfitSet, 'OUTFIT_SET_UNKNOWN', 'an outfit set')
  assertVocab(emotion, isEmotion, 'EMOTION_UNKNOWN', 'an expression')
  throwIfCancelled(options.signal)
  options.onProgress?.('Preparing')

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
  const { poseTags, skeletonName } = await stagePose(character)

  // The portrait is cut from the default wardrobe's `neutral` and nothing else.
  const cutsProfile = emotion === 'neutral' && set === null

  if (emotion === 'neutral') {
    await runGenerationJob(
      {
        // No expression group: every sprite cut from this frame repaints its face.
        workflowFile: 'characterBase.json',
        nodes: BASE_NODE,
        prompts: set
          ? buildOutfitBasePrompt(character, poseTags, set)
          : buildBasePrompt(character, poseTags),
        seed,
        poseImageName: skeletonName,
        destPath: staged ? stagedPath : livePath,
        label: `${charId} / base${suffix}`,
        logContext: `pose=${character.pose}, seed=${seed}`
      },
      options
    )
    throwIfCancelled(options.signal)
  }

  const sourceName = await stageBase(charId, livePath, stagedPath, staged, set ?? 'default')

  const written = await runGenerationJob(
    {
      // The main-outfit prompt whichever the set: a face pass prompts for the face.
      workflowFile: 'characterExpression.json',
      nodes: EXPRESSION_NODE,
      prompts: buildImagePrompt(character, poseTags, emotion),
      seed,
      sourceImageName: sourceName,
      poseImageName: skeletonName,
      destPath,
      // The one face mask: the default wardrobe's `neutral` and nothing else.
      faceDestPath: cutsProfile
        ? staged
          ? getStagedPath(charId, faceRel())
          : getCharacterFacePath(charId)
        : undefined,
      label: `${charId} / ${emotion}${suffix}`,
      logContext: `face-pass, seed=${seed}`
    },
    options
  )

  // Framed off the mask the job just saved, under the seed it actually rendered under — so a
  // one-off render on a borrowed seed gets the default frame rather than the last one's.
  if (cutsProfile) await tryCutProfile(charId, { ...character, generationSeed: seed }, staged)

  return written
}

/**
 * Renders one landscape CG into the character's `cg/` folder, then removes ComfyUI's own
 * output copy.
 */
export async function generateCg(
  character: Character,
  position: Position,
  seedOverride?: number,
  staged = false,
  options: JobOptions = {}
): Promise<string> {
  assertSafeCharId(character.charId)
  assertVocab(position, isPosition, 'POSITION_UNKNOWN', 'a CG position')
  throwIfCancelled(options.signal)
  options.onProgress?.('Preparing')

  const seed = seedOverride ?? character.generationSeed
  const { poseTags, skeletonName } = await stagePose(character)
  const { positive, negative, detailerPositive } = buildCgPrompt(character, position, poseTags)

  return runGenerationJob(
    {
      workflowFile: 'characterCg.json',
      nodes: CG_NODE,
      prompts: { positive, negative },
      detailerPositive,
      seed,
      poseImageName: skeletonName,
      destPath: staged
        ? getStagedPath(character.charId, cgRel(position))
        : getCharacterCgPath(character.charId, position),
      label: `${character.charId} / cg:${position}`,
      logContext: `seed=${seed}`
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
  options: JobOptions = {}
): Promise<{ cutout: Buffer; region: Buffer }> {
  assertSafeCharId(character.charId)
  if (set !== null) assertVocab(set, isOutfitSet, 'OUTFIT_SET_UNKNOWN', 'an outfit set')
  throwIfCancelled(options.signal)
  options.onProgress?.('Preparing')

  const { charId } = character
  const scope = set ?? 'default'
  const suffix = set ? `_${set}` : ''
  const basePath = set ? getOutfitBasePath(charId, set) : getExpressionBasePath(charId)

  const { poseTags, skeletonName } = await stagePose(character)
  // Live only: a fix repairs the set on disk, and a staged run is a different set of images.
  const sourceName = await stageBase(charId, basePath, basePath, false, scope)
  const paintName = await stagePaint(charId, scope, paint)

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
          ? buildOutfitBasePrompt(character, poseTags, set)
          : buildBasePrompt(character, poseTags),
        seed,
        poseImageName: skeletonName,
        sourceImageName: sourceName,
        paintImageName: paintName,
        destPath: join(scratch, 'cutout.png'),
        regionDestPath: join(scratch, 'region.png'),
        label: `${charId} / hands${suffix}`,
        logContext: `pose=${character.pose}, seed=${seed}`
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
