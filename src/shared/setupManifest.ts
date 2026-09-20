/**
 * Pinned install/verify manifest shared across processes: the authoritative pins for the ComfyUI
 * runtime release, the commit archives its custom nodes are cut from, the model weights, and the
 * exact versions the nodes' Python dependencies are constrained to.
 */

/** A model weight file downloaded into the ComfyUI tree. */
export interface PinnedModel {
  /** Stable identifier used as a setup component id. */
  id: 'upscaler' | 'handDetector' | 'faceSegDetector' | 'checkpoint' | 'lora' | 'controlnet'
  label: string
  /** ComfyUI models subfolder, possibly nested (e.g. `ultralytics/bbox`). */
  destDir: string
  /** Our own filename, hardcoded in the runtime workflows and never free to change. */
  destFile: string
  /** The upstream basename, which a hand-placed file arrives under. */
  sourceFile: string
  /** Anonymous direct download; no account, no token, no query string. */
  url: string
  /** Exact size in bytes; the startup verify check. */
  bytes: number
  /** Full SHA256, verified after download and on demand. */
  sha256: string
}

/** Every model weight the runtime workflows need, in install order: smallest first. */
export const PINNED_MODELS: readonly PinnedModel[] = [
  {
    id: 'upscaler',
    label: 'RealESRGAN x4plus anime 6B (upscaler)',
    destDir: 'upscale_models',
    destFile: 'RealESRGAN_x4plus_anime_6B.pth',
    sourceFile: 'RealESRGAN_x4plus_anime_6B.pth',
    url: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth',
    bytes: 17938799,
    sha256: 'F872D837D3C90ED2E05227BED711AF5671A6FD1C9F7D7E91C911A61F155E99DA'
  },
  {
    id: 'handDetector',
    label: 'Hand detector (hand_yolov9c)',
    destDir: 'ultralytics/bbox',
    destFile: 'hand_yolov9c.pt',
    sourceFile: 'hand_yolov9c.pt',
    url: 'https://huggingface.co/Bingsu/adetailer/resolve/main/hand_yolov9c.pt',
    bytes: 51633747,
    sha256: '6F116F686EF5942FA0C1D08DB481B3D7622047A97847ECCFB2A264F9CE9777F2'
  },
  {
    id: 'faceSegDetector',
    label: 'Face segmentation detector (Anzhc Face seg 640 v2 y8n)',
    destDir: 'ultralytics/segm',
    // The `%20` is literal: ComfyUI's node combo names this exact string; never decode it.
    destFile: 'Anzhc%20Face%20seg%20640%20v2%20y8n.pt',
    sourceFile: 'Anzhc%20Face%20seg%20640%20v2%20y8n.pt',
    url: 'https://huggingface.co/Anzhc/Anzhcs_YOLOs/resolve/main/Anzhc%20Face%20seg%20640%20v2%20y8n.pt',
    bytes: 6878186,
    sha256: 'D473E8BCCC4C833D8EB36C95E566CE6460FFDC8B2899C859910E380C85DEF276'
  },
  {
    id: 'checkpoint',
    label: 'Nova Anime XL (IL v19.0)',
    destDir: 'checkpoints',
    destFile: 'novaAnimeXL_ilV190.safetensors',
    sourceFile: 'novaAnimeXL_ilV190.safetensors',
    url: 'https://huggingface.co/LarryAIDraw/novaAnimeXL_ilV190/resolve/main/novaAnimeXL_ilV190.safetensors',
    bytes: 6939105596,
    sha256: 'FA486CAAFC330F133605D3C18B418D183812F14946631C6544BFB28730DB6D6F'
  },
  {
    id: 'lora',
    label: 'USNR Style LoRA',
    destDir: 'loras',
    destFile: 'usnrStyle.safetensors',
    sourceFile: 'USNR_STYLE_ILL_V1_lokr3-000024.safetensors',
    url: 'https://huggingface.co/LyliaEngine/USNR_STYLE_ILL_V1/resolve/main/USNR_STYLE_ILL_V1_lokr3-000024.safetensors',
    bytes: 916175032,
    sha256: '374B9E35641CF591E0AD30FAE49B1295C2EDC5E8D4E9DCAF1F704C30502E473C'
  },
  {
    id: 'controlnet',
    label: 'Illustrious XL ControlNet OpenPose',
    destDir: 'controlnet',
    destFile: 'illustriousOpenpose.safetensors',
    sourceFile: 'openpose_s6000.safetensors',
    url: 'https://huggingface.co/windsingai/Illustrious-XL-openpose-test/resolve/main/openpose_s6000.safetensors',
    bytes: 2502140008,
    sha256: '0D8BACF24534DC6F2716F5D0FFA6085571928776F8687565EF290A17D9F3615C'
  }
] as const

/** The pin behind a `model:{id}` setup component id, or undefined for another row. */
export function modelForComponentId(componentId: string): PinnedModel | undefined {
  const id = componentId.startsWith('model:') ? componentId.slice('model:'.length) : undefined
  return PINNED_MODELS.find((model) => model.id === id)
}

/** A ComfyUI custom node installed from a GitHub commit archive. */
export interface PinnedNode {
  id: 'impactPack' | 'impactSubpack' | 'inspyrenetRembg'
  label: string
  owner: string
  repo: string
  /** Folder name created under `ComfyUI/custom_nodes`. */
  dirName: string
  /** The full 40-character commit the archive is cut from; never a branch. */
  sha: string
  /** Exact archive size in bytes. */
  bytes: number
  /** Full SHA256 of the archive, verified before anything is extracted. */
  sha256: string
  /**
   * Top-level import names its pip dependencies provide; looked up at verify time and
   * after an install.
   */
  modules: readonly string[]
}

/** Custom nodes required by the runtime workflows, verified against them. */
export const PINNED_NODES: readonly PinnedNode[] = [
  {
    id: 'impactPack',
    label: 'ComfyUI Impact Pack (FaceDetailer / HandDetailer)',
    owner: 'ltdrdata',
    repo: 'ComfyUI-Impact-Pack',
    dirName: 'ComfyUI-Impact-Pack',
    sha: '429d0159ad429e64d2b3916e6e7be9c22d025c3c',
    bytes: 2672533,
    sha256: '017BD1DDB7D17C923A1309FF1251379EAF65B71A9AC8FA91D384BB275BF000CE',
    modules: ['cv2', 'skimage', 'piexif', 'segment_anything']
  },
  {
    id: 'impactSubpack',
    label: 'ComfyUI Impact Subpack (Ultralytics detectors)',
    owner: 'ltdrdata',
    repo: 'ComfyUI-Impact-Subpack',
    dirName: 'ComfyUI-Impact-Subpack',
    sha: '50c7b71a6a224734cc9b21963c6d1926816a97f1',
    bytes: 27328,
    sha256: '08E73CFE3304F25EE0A8C9E35C281B14D9CF1838682D92A071D8A18692674CDE',
    modules: ['ultralytics']
  },
  {
    id: 'inspyrenetRembg',
    label: 'ComfyUI Inspyrenet Rembg (background removal)',
    owner: 'john-mnz',
    repo: 'ComfyUI-Inspyrenet-Rembg',
    dirName: 'ComfyUI-Inspyrenet-Rembg',
    sha: '87ac452ef1182e8f35f59b04010158d74dcefd06',
    bytes: 6894,
    sha256: '9C4881A826562435F77F311A550AC0188721259220B0CE8319AAD1B0C4CCC545',
    modules: ['transparent_background']
  }
] as const

/** Builds the GitHub commit archive URL for a custom node. */
export function nodeZipUrl(node: PinnedNode): string {
  return `https://github.com/${node.owner}/${node.repo}/archive/${node.sha}.zip`
}

/** Returns the wrapper folder GitHub creates inside a commit archive. */
export function nodeZipWrapperDir(node: PinnedNode): string {
  return `${node.repo}-${node.sha}`
}

/**
 * Every package the custom nodes' `requirements.txt` files can reach, at the version this
 * install was tested against: pip is handed these as a constraints file, so a resolved
 * dependency is either one of these versions or nothing.
 */
export const PINNED_PIP: Readonly<Record<string, string>> = {
  albucore: '0.0.24',
  albumentations: '2.0.8',
  beautifulsoup4: '4.15.0',
  cloudpickle: '3.1.2',
  contourpy: '1.3.3',
  cycler: '0.12.1',
  dill: '0.4.1',
  easydict: '1.13',
  fonttools: '4.64.0',
  gdown: '6.2.0',
  imageio: '2.37.4',
  kiwisolver: '1.5.1',
  'lazy-loader': '0.5',
  llvmlite: '0.49.0',
  matplotlib: '3.11.1',
  numba: '0.67.0',
  numpy: '2.5.2',
  'nvidia-ml-py': '13.610.43',
  'opencv-python': '5.0.0.93',
  'opencv-python-headless': '5.0.0.93',
  piexif: '1.1.3',
  polars: '1.44.1',
  'polars-runtime-32': '1.44.1',
  pymatting: '1.1.16',
  pyparsing: '3.3.2',
  PySocks: '1.7.1',
  'python-dateutil': '2.9.0.post0',
  'scikit-image': '0.26.0',
  scipy: '1.18.1',
  'segment-anything': '1.0',
  simsimd: '6.5.16',
  six: '1.17.0',
  soupsieve: '2.9.2',
  stringzilla: '5.1.2',
  tifffile: '2026.9.9',
  timm: '1.0.29',
  transformers: '5.15.1',
  'transparent-background': '1.3.4',
  ultralytics: '8.4.144',
  'ultralytics-platform': '0.1.32',
  'ultralytics-thop': '2.1.6',
  wget: '3.2'
}

/** The one index pip may resolve a dependency from. */
export const PYPI_INDEX_URL = 'https://pypi.org/simple'

/** Release asset pin; `tag` and `assetName` both name one exact file. */
export interface PinnedRuntime {
  owner: string
  repo: string
  /** The release the asset is taken from; never `latest`. */
  tag: string
  assetName: string
  /** Exact size in bytes. */
  bytes: number
  /** Full SHA256, verified after download. */
  sha256: string
}

/** ComfyUI portable build release asset. */
export const COMFY_RUNTIME: PinnedRuntime = {
  owner: 'Comfy-Org',
  repo: 'ComfyUI',
  tag: 'v0.34.0',
  assetName: 'ComfyUI_windows_portable_nvidia.7z',
  bytes: 2146721943,
  sha256: 'ED57CC6B19AE3D83ADD1ECEBFDD56B25E04E0008CF0FE9AF43A4AD8797E2A24C'
}

/** Builds the download URL for a pinned release asset. */
export function runtimeAssetUrl(runtime: PinnedRuntime): string {
  return `https://github.com/${runtime.owner}/${runtime.repo}/releases/download/${runtime.tag}/${runtime.assetName}`
}

/** Folder the ComfyUI `.7z` nests its payload under; stripped on extract. */
export const COMFY_ARCHIVE_WRAPPER_DIR = 'ComfyUI_windows_portable'

/** Local HTTP endpoint for the managed ComfyUI server. */
export const COMFY_HOST = '127.0.0.1:8188'
