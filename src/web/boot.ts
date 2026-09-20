import { setProgressSink } from '@shared/jobQueue'
import { useSettingsSource } from '@shared/llm/settingsPort'
import { STAGE_HEIGHT, STAGE_MIN_WIDTH, zoomFor } from '@shared/stageZoom'
import { setImageResolver } from '../renderer/stores/imageUrl'
import { buildApi, jobProgress } from './bridge'
import { resolveImage, setImagesLoadedSink } from './images'
import { openLog } from './log'
import { currentSettings } from './settings'

/**
 * The browser build's entry point: it puts the bridge where the renderer expects one, wires
 * every port a process owns, fits the stage to the window, and only then hands over.
 */

/** The stage's design width, which the 4:3 floor never reaches. */
const STAGE_MAX_WIDTH = 1920

/** A byte count in whole megabytes, for the one line the storage claim prints. */
function mb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024))
}

/**
 * Fits the 1080-tall stage to the window. This build owns the zoom the way main owns it on
 * the desktop: one line, and no screen measures anything.
 */
function fitStage(root: HTMLElement): void {
  const zoom = zoomFor(window.innerWidth, window.innerHeight)
  root.style.zoom = String(zoom)
  // In stage units, which is what the zoom above has made of the window: the two caps are
  // what leaves the letterbox its bars.
  root.style.width = `${Math.min(window.innerWidth / zoom, STAGE_MAX_WIDTH)}px`
  root.style.height = `${Math.min(window.innerHeight / zoom, STAGE_HEIGHT)}px`
}

/**
 * Whether something under the pointer can still scroll by this wheel, mirroring how the
 * browser itself chains a wheel outward (under the root's CSS `zoom` the three scroll metrics
 * share one unit, so nothing here is converted).
 */
function canScrollBy(target: EventTarget | null, deltaX: number, deltaY: number): boolean {
  if (!(target instanceof Element)) return false
  for (
    let el: Element | null = target;
    el && el !== document.documentElement;
    el = el.parentElement
  ) {
    const style = getComputedStyle(el)
    if (
      deltaY !== 0 &&
      (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
      el.scrollHeight > el.clientHeight &&
      (deltaY < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1)
    ) {
      return true
    }
    if (
      deltaX !== 0 &&
      (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
      el.scrollWidth > el.clientWidth &&
      (deltaX < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
    ) {
      return true
    }
  }
  return false
}

/** Puts the stage on the window and keeps it there. */
function holdStage(root: HTMLElement): void {
  if (!CSS.supports('zoom', '2')) {
    console.warn(
      `[web] this browser cannot zoom the page; the stage is drawn at 1:1 and needs ` +
        `${STAGE_MIN_WIDTH}×${STAGE_HEIGHT} to fit.`
    )
    return
  }
  fitStage(root)
  window.addEventListener('resize', () => fitStage(root))
}

/** Asks the browser to keep this game's storage, and says how much room it has. */
async function claimStorage(): Promise<void> {
  try {
    const persisted = (await navigator.storage?.persist?.()) ?? false
    const { usage = 0, quota = 0 } = (await navigator.storage?.estimate?.()) ?? {}
    console.log(
      `[web] storage is ${persisted ? 'persistent' : 'best-effort'}; ` +
        `${mb(usage)} MB of ${mb(quota)} MB used.`
    )
  } catch (err) {
    console.warn('[web] the browser would not say what storage it has:', err)
  }
}

/** Wires every port, then hands the page to the renderer. */
async function boot(): Promise<void> {
  window.api = buildApi()
  // The key the cloud calls need is held by `settings.ts`; the transport reads it through here.
  useSettingsSource(currentSettings)
  // Fixed channel: a job can outlive the call that started it, so progress is broadcast.
  setProgressSink((progress) => jobProgress.emit(progress))
  setImageResolver(resolveImage)

  // Before anything can print: the log picks up what the last visit left behind.
  await openLog()
  void claimStorage()

  const root = document.getElementById('root')
  if (root) holdStage(root)

  // Imported here rather than at the top: the stores read the bridge as they come up, and it
  // has only just been put there.
  const { useCharacterStore } = await import('../renderer/stores/characterStore')
  setImagesLoadedSink((charId) => useCharacterStore.getState().refreshImages(charId))

  const { writesPending } = await import('../renderer/stores/loop/saves')
  // A tab closed mid-write loses the save; the browser asks on the app's behalf.
  window.addEventListener('beforeunload', (event) => {
    if (writesPending()) event.preventDefault()
  })

  // A wheel over the stage that nothing inside can take would scroll the page itch embeds the
  // game in; a pinch-zoom (ctrl + wheel) is the browser's own and is left alone.
  window.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey) return
      if (!canScrollBy(event.target, event.deltaX, event.deltaY)) event.preventDefault()
    },
    { passive: false }
  )

  await import('../renderer/main')
}

void boot()
