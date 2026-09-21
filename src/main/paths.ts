import { app } from 'electron'
import { readdirSync } from 'fs'
import { dirname, join, resolve, sep } from 'path'
import {
  baseRel,
  CHARACTER_FILE_NAME,
  cgRel,
  expressionRel,
  faceRel,
  outfitRel,
  OUTFITS_DIR,
  profileRel,
  roomRel,
  setDirRel,
  stagedRel,
  STAGING_DIR
} from '@shared/characterFiles'
import { appError } from '@shared/errors'
import type { RoomVariant } from '@shared/room'
import type { OutfitSet } from '@shared/types'

/**
 * Returns the runtime data root for settings, saves, characters and managed
 * services; all data paths derive from here.
 */
export function getDataPath(): string {
  if (app.isPackaged) {
    return join(resolve(app.getPath('exe'), '..'), 'data')
  }
  return resolve(app.getAppPath(), 'data')
}

/** The folder the app runs from: the exe, its runtime files and `data` beside them. */
export function getInstallPath(): string {
  return dirname(app.getPath('exe'))
}

/** `/data/update` — where an update stages its download, its unpacked tree and its plan. */
export function getUpdatePath(): string {
  return join(getDataPath(), 'update')
}

/** The shipped, read-only asset root — kept outside asar so ComfyUI gets real paths. */
function getAssetsPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'assets')
  }
  return resolve(app.getAppPath(), 'assets')
}

/** `/assets/characters` — the cast the game ships with. */
export function getPregenCharactersPath(): string {
  return join(getAssetsPath(), 'characters')
}

/** The shipped charIds, read from disk once. */
let pregenIds: Set<string> | null = null

function loadedPregenIds(): Set<string> {
  if (pregenIds === null) {
    try {
      pregenIds = new Set(readdirSync(getPregenCharactersPath()))
    } catch {
      pregenIds = new Set()
    }
  }
  return pregenIds
}

/** True for a character that ships with the game and lives under `/assets`. */
export function isPregenChar(charId: string): boolean {
  return loadedPregenIds().has(charId)
}

/** Every shipped charId, in `readdir` order. */
export function listPregenCharIds(): string[] {
  return [...loadedPregenIds()]
}

/** Drops the memoized listing; the tests re-root the app between cases. */
export function clearPregenCache(): void {
  pregenIds = null
}

/** `/assets/quickstart.json` — the canned semester Quickstart starts from. */
export function getQuickstartPath(): string {
  return join(getAssetsPath(), 'quickstart.json')
}

/** `/assets/pose/pose.json` — the pose manifest. */
export function getPoseManifestPath(): string {
  return join(getAssetsPath(), 'pose', 'pose.json')
}

/** `/assets/pose/skeletons` — openpose skeleton PNGs, one per pose key. */
export function getPoseSkeletonsPath(): string {
  return join(getAssetsPath(), 'pose', 'skeletons')
}

/** `/assets/pose/skeletons/{key}.png` */
export function getPoseSkeletonPath(key: string): string {
  return join(getPoseSkeletonsPath(), `${key}.png`)
}

/** `/assets/sound` — the shipped audio, split into `music`, `ambient`, `ambient_music`, `nsfw` and `sfx`. */
export function getSoundPath(): string {
  return join(getAssetsPath(), 'sound')
}

/** `/assets/workflows` — every ComfyUI API-format graph the app runs. */
export function getWorkflowsPath(): string {
  return join(getAssetsPath(), 'workflows')
}

/** `/assets/workflows/{name}` — ComfyUI API-format workflow JSON. */
export function getWorkflowPath(name: string): string {
  return join(getWorkflowsPath(), name)
}

/** `.../ComfyUI/input` — the only folder ComfyUI's `LoadImage` node reads from. */
export function getComfyInputPath(): string {
  return join(getComfyAppPath(), 'input')
}

/** `.../ComfyUI/output` — `SaveImage` writes here; ComfyUI never prunes it. */
export function getComfyOutputPath(): string {
  return join(getComfyAppPath(), 'output')
}

/**
 * `.../ComfyUI/output/{subfolder}/{filename}` — the PNG one `SaveImage` output names. Both
 * halves are the server's own words, so a name that does not land inside the output folder is
 * refused rather than returned.
 */
export function getComfyOutputFilePath(image: { filename: string; subfolder?: string }): string {
  const root = resolve(getComfyOutputPath())
  const path = resolve(root, image.subfolder ?? '', image.filename)
  const prefix = root.endsWith(sep) ? root : root + sep
  if (!path.toLowerCase().startsWith(prefix.toLowerCase())) {
    throw appError(
      'COMFY_OUTPUT_PATH_INVALID',
      'ComfyUI named an image outside its own output folder.',
      `${image.subfolder ?? ''}/${image.filename} resolves to ${path}`
    )
  }
  return path
}

/** `/data/settings.json` */
export function getSettingsPath(): string {
  return join(getDataPath(), 'settings.json')
}

/** `/data/app.log` — every console line of both processes. */
export function getAppLogPath(): string {
  return join(getDataPath(), 'app.log')
}

/** `/data/grabbags.json` */
export function getGrabBagsPath(): string {
  return join(getDataPath(), 'grabbags.json')
}

/** `/data/saves` — one folder per playthrough. */
export function getSavesPath(): string {
  return join(getDataPath(), 'saves')
}

/** `/data/saves/{playthroughId}` */
export function getPlaythroughPath(playthroughId: string): string {
  return join(getSavesPath(), playthroughId)
}

/** `/data/saves/{playthroughId}/{saveId}.json` */
export function getSaveFilePath(playthroughId: string, saveId: string): string {
  return join(getPlaythroughPath(playthroughId), `${saveId}.json`)
}

/** `/data/saves/{playthroughId}/playthrough.json` — what New Game settled, written once. */
export function getPlaythroughRecordPath(playthroughId: string): string {
  return join(getPlaythroughPath(playthroughId), 'playthrough.json')
}

/**
 * `/data/saves/{playthroughId}/enrollment.json` — the semester waiting on its timetable,
 * removed once the record replaces it.
 */
export function getEnrollmentPath(playthroughId: string): string {
  return join(getPlaythroughPath(playthroughId), 'enrollment.json')
}

/** `/data/saves/{playthroughId}/ending.png` — the graduation picture. */
export function getEndingArtPath(playthroughId: string): string {
  return join(getPlaythroughPath(playthroughId), 'ending.png')
}

/** `/data/characters` */
export function getCharactersPath(): string {
  return join(getDataPath(), 'characters')
}

/**
 * `/data/characters/{charId}`, or `/assets/characters/{charId}` for one of the shipped cast.
 */
export function getCharacterPath(charId: string): string {
  return join(isPregenChar(charId) ? getPregenCharactersPath() : getCharactersPath(), charId)
}

/** `/data/characters/{charId}/character.json` */
export function getCharacterFilePath(charId: string): string {
  return join(getCharacterPath(charId), CHARACTER_FILE_NAME)
}

/** One of a character's images, by the relative path `shared/characterFiles.ts` names it. */
export function getCharacterImagePath(charId: string, rel: string): string {
  return join(getCharacterPath(charId), rel)
}

/** `/data/characters/{charId}/expressions` */
export function getCharacterExpressionsPath(charId: string): string {
  return getCharacterImagePath(charId, setDirRel('default'))
}

/** `/data/characters/{charId}/expressions/{emotion}.png` */
export function getCharacterExpressionPath(charId: string, emotion: string): string {
  return getCharacterImagePath(charId, expressionRel(emotion))
}

/** `/data/characters/{charId}/expressions/neutral.base.png` */
export function getExpressionBasePath(charId: string): string {
  return getCharacterImagePath(charId, baseRel(null))
}

/** `/data/characters/{charId}/outfits/{set}/neutral.base.png` */
export function getOutfitBasePath(charId: string, set: OutfitSet): string {
  return getCharacterImagePath(charId, baseRel(set))
}

/** `/data/characters/{charId}/expressions/profile.png` */
export function getCharacterProfilePath(charId: string): string {
  return getCharacterImagePath(charId, profileRel())
}

/** `/data/characters/{charId}/expressions/face.png` */
export function getCharacterFacePath(charId: string): string {
  return getCharacterImagePath(charId, faceRel())
}

/** `/data/characters/{charId}/cg` */
export function getCharacterCgsPath(charId: string): string {
  return getCharacterImagePath(charId, setDirRel('cgs'))
}

/** `/data/characters/{charId}/cg/{position}.png` */
export function getCharacterCgPath(charId: string, position: string): string {
  return getCharacterImagePath(charId, cgRel(position))
}

/** `/data/characters/{charId}[/staging]/room_{day|night}.png`. */
export function getCharacterRoomPath(
  charId: string,
  variant: RoomVariant,
  staged = false
): string {
  const rel = roomRel(variant)
  return getCharacterImagePath(charId, staged ? stagedRel(rel) : rel)
}

/** `/data/characters/{charId}/outfits/{set}` */
export function getCharacterOutfitSetPath(charId: string, set: OutfitSet): string {
  return getCharacterImagePath(charId, setDirRel(set))
}

/** `/data/characters/{charId}/outfits/{set}/{emotion}.png` */
export function getCharacterOutfitPath(charId: string, set: string, emotion: string): string {
  return getCharacterImagePath(charId, outfitRel(set, emotion))
}

/**
 * `/data/characters/{charId}/staging` — where a regenerate's images land until they
 * are committed over the live set.
 */
export function getCharacterStagingPath(charId: string): string {
  return getCharacterImagePath(charId, STAGING_DIR)
}

/** The staged twin of a live image path. */
export function getStagedPath(charId: string, rel: string): string {
  return getCharacterImagePath(charId, stagedRel(rel))
}

/** `/data/characters/{charId}/staging/expressions` */
export function getStagedExpressionsPath(charId: string): string {
  return getStagedPath(charId, setDirRel('default'))
}

/** `/data/characters/{charId}/staging/cg` */
export function getStagedCgsPath(charId: string): string {
  return getStagedPath(charId, setDirRel('cgs'))
}

/** `/data/characters/{charId}/staging/outfits` */
export function getStagedOutfitsPath(charId: string): string {
  return getStagedPath(charId, OUTFITS_DIR)
}

/** `/data/characters/{charId}/staging/outfits/{set}` */
export function getStagedOutfitSetPath(charId: string, set: OutfitSet): string {
  return getStagedPath(charId, setDirRel(set))
}

/** `/data/services` */
function getServicesPath(): string {
  return join(getDataPath(), 'services')
}

/** `/data/tmp` — scratch space on the data volume, so a download's final rename is atomic. */
export function getTempPath(): string {
  return join(getDataPath(), 'tmp')
}

/** `/data/services/comfyui` — flattened portable build root. */
export function getComfyUiPath(): string {
  return join(getServicesPath(), 'comfyui')
}

/** The portable build's embedded interpreter — also the ComfyUI install marker. */
export function getComfyPythonPath(): string {
  return join(getComfyUiPath(), 'python_embeded', 'python.exe')
}

/** Torch's own version file, which names the CUDA and ROCm builds apart. */
export function getComfyTorchVersionPath(): string {
  return join(getComfyUiPath(), 'python_embeded', 'Lib', 'site-packages', 'torch', 'version.py')
}

/** `/data/services/comfyui/comfyui.log` — the server's output, rewritten each boot. */
export function getComfyLogPath(): string {
  return join(getComfyUiPath(), 'comfyui.log')
}

/** `/data/services/comfyui/ComfyUI` — the application itself. */
export function getComfyAppPath(): string {
  return join(getComfyUiPath(), 'ComfyUI')
}

/** `.../ComfyUI/custom_nodes` */
export function getComfyCustomNodesPath(): string {
  return join(getComfyAppPath(), 'custom_nodes')
}

/** `.../ComfyUI/custom_nodes/{dirName}` */
export function getComfyCustomNodePath(dirName: string): string {
  return join(getComfyCustomNodesPath(), dirName)
}

/** `.../ComfyUI/models/{subdir}` — e.g. `checkpoints`, `loras`, `controlnet`. */
export function getComfyModelDirPath(subdir: string): string {
  return join(getComfyAppPath(), 'models', subdir)
}

/** `.../ComfyUI/models/{subdir}/{fileName}` */
export function getComfyModelFilePath(subdir: string, fileName: string): string {
  return join(getComfyModelDirPath(subdir), fileName)
}
