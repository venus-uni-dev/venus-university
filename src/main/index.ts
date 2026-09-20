import { app, BrowserWindow, dialog, Menu, screen, shell } from 'electron'
import type { BaseWindow } from 'electron'
import { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { handleCharImageProtocol, registerCharImageScheme } from './charImageProtocol'
import { registerIpcHandlers } from './ipc'
import { installConsoleLog } from './logFile'
import { redact } from './redact'
import { sweepStaging } from './services/characterService'
import { killStray as killStrayComfy, stop as stopComfy } from './services/comfyService'
import { ensureDataDir } from './services/settingsService'
import { APP_ID } from '@shared/appId'
import { toAppError } from '@shared/errors'
import { zoomFor } from '@shared/stageZoom'

/** The sizes every screen is checked at. */
const DEV_SIZES = [
  [1280, 720],
  [1920, 1080],
  [2560, 1440],
  [1440, 1080]
] as const

/** Fits the page to the window, so the renderer lays out on the stage and never on the window. */
function applyStageZoom(win: BrowserWindow): void {
  const [width, height] = win.getContentSize()
  win.webContents.setZoomFactor(zoomFor(width, height))
}

/**
 * Puts the window at one of {@link DEV_SIZES}. Leaving fullscreen has to finish first: Windows
 * restores the pre-fullscreen bounds *after* this handler returns, so sizing here synchronously
 * would be undone a moment later.
 */
function sizeTo(win: BaseWindow, width: number, height: number): void {
  const apply = (): void => {
    win.unmaximize()
    win.setContentSize(width, height)
    win.center()
  }

  if (!win.isFullScreen()) {
    apply()
    return
  }
  win.once('leave-full-screen', () => setImmediate(apply))
  win.setFullScreen(false)
}

/**
 * The accelerators the app keeps, bound to the window rather than hung on a menu: F11
 * always, and in dev reload, devtools and the four {@link DEV_SIZES} presets. Every key handled
 * here is also taken, so nothing reaches the renderer that the window has already answered.
 */
function bindShortcuts(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return

    if (input.code === 'F11') {
      win.setFullScreen(!win.isFullScreen())
      event.preventDefault()
      return
    }

    if (!is.dev) return

    if (input.control && input.shift && input.code === 'KeyI') {
      win.webContents.toggleDevTools()
      event.preventDefault()
      return
    }
    if (input.control && !input.shift && input.code === 'KeyR') {
      win.webContents.reload()
      event.preventDefault()
      return
    }

    // Read off the physical key, so a preset answers on a layout that puts its digit elsewhere.
    const preset =
      input.control && input.alt
        ? DEV_SIZES.findIndex((_size, i) => input.code === `Digit${i + 1}`)
        : -1
    if (preset >= 0) {
      const [width, height] = DEV_SIZES[preset]
      sizeTo(win, width, height)
      event.preventDefault()
    }
  })
}

/** The two schemes a link may leave the app for: a web page and an email address. */
const OPENABLE_SCHEMES = new Set(['https:', 'mailto:'])

/** True for an address the app will hand to the desktop; anything unparseable is not one. */
function isOpenableExternally(url: string): boolean {
  try {
    return OPENABLE_SCHEMES.has(new URL(url).protocol)
  } catch {
    return false
  }
}

/** Creates and shows the single main application window. */
function createWindow(): void {
  const display = screen.getPrimaryDisplay().size

  const mainWindow = new BrowserWindow({
    // Content rather than frame: the stage is what has to fit.
    width: 1920,
    height: 1080,
    useContentSize: true,
    minWidth: 1280,
    minHeight: 720,
    fullscreen: true,
    // The letterbox, so a resize never flashes white behind the stage.
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: is.dev,
      // Right on the first paint; setZoomFactor alone would show one frame at 1.
      zoomFactor: zoomFor(display.width, display.height)
    }
  })

  bindShortcuts(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Main owns the zoom, at every size and from every source — including the player's Ctrl+wheel.
  mainWindow.webContents.on('did-finish-load', () => applyStageZoom(mainWindow))
  mainWindow.webContents.on('zoom-changed', () => applyStageZoom(mainWindow))
  mainWindow.on('resize', () => applyStageZoom(mainWindow))

  // What the renderer cannot report about itself: a page that would not load, a preload that
  // threw, and a crash. -3 (ERR_ABORTED) is an ordinary in-app navigation.
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    if (code !== -3) console.error(`[renderer] load failed (${code} ${description}): ${url}`)
  })
  mainWindow.webContents.on('preload-error', (_event, path, error) => {
    console.error(`[renderer] preload failed at ${path}:`, error)
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[renderer] gone: ${details.reason} (exit ${details.exitCode})`)
  })

  // A 1920x1080 *content* window does not fit a 1080p desktop, so leaving fullscreen fills it.
  mainWindow.on('leave-full-screen', () => {
    const { workAreaSize } = screen.getPrimaryDisplay()
    const { width, height } = mainWindow.getBounds()
    if (width > workAreaSize.width || height > workAreaSize.height) mainWindow.maximize()
  })

  // The window shows the app and never becomes another page; the one exception is the page
  // re-becoming itself, which the dev server's full reload does.
  const refuseNavigation = (details: { url: string; preventDefault: () => void }): void => {
    if (details.url === mainWindow.webContents.getURL()) return
    details.preventDefault()
    console.warn(`[window] refused navigation to ${details.url}`)
  }
  mainWindow.webContents.on('will-navigate', refuseNavigation)
  mainWindow.webContents.on('will-frame-navigate', refuseNavigation)

  // Every link in the app leaves through here, and nothing opens a window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isOpenableExternally(url)) {
      console.warn(`[window] refused to open ${url}`)
      return { action: 'deny' }
    }
    shell.openExternal(url).catch((err) => console.warn(`[window] could not open ${url}:`, err))
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Before anything can print: the app log wraps the console for the whole run.
installConsoleLog()

// Custom schemes must be declared before the app is ready.
registerCharImageScheme()

app
  .whenReady()
  .then(async () => {
    electronApp.setAppUserModelId(APP_ID)

    handleCharImageProtocol()

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Services expect /data to exist; create it here once before they run.
    await ensureDataDir()

    // Clear an orphaned managed server before this run can adopt an unowned port.
    killStrayComfy()

    // Drops the staging trees a quit mid-render left behind.
    await sweepStaging()

    // No menu at all: one draws a bar the moment the window is not fullscreen, and hiding
    // the bar does not survive that — what the menu carried is `bindShortcuts`' now.
    Menu.setApplicationMenu(null)

    registerIpcHandlers()

    createWindow()
  })
  .catch((err: unknown) => {
    // No window exists yet to report into, so a startup failure gets a native dialog, and
    // what it says is the failure's own sentence with its detail under it.
    console.error('[startup] failed:', err)
    const error = toAppError(err, 'STARTUP_FAILED')
    const body = error.detail ? `${error.message}\n\n${error.detail}` : error.message
    dialog.showErrorBox('Venus University could not start', redact(body))
    app.quit()
  })

// Windows-only app: closing the last window ends the run.
app.on('window-all-closed', () => {
  app.quit()
})

// Clean up service processes this run spawned.
app.on('will-quit', () => {
  stopComfy()
})

// Covers dev rebuild/Ctrl-C exits that skip Electron's quit sequence.
process.on('exit', () => {
  stopComfy()
})
