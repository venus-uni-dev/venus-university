import { useEffect, useState, type JSX } from 'react'
import { AnimatePresence } from 'motion/react'
import { writerReady } from '@shared/settingsRules'
import { Crossing } from './components/Crossing'
import { Cursor } from './components/Cursor'
import { ModalHost } from './components/ModalHost'
import { ErrorModal } from './components/ErrorModal'
import { FatalErrorScreen } from './components/FatalErrorScreen'
import { ManageCharactersView } from './views/ManageCharactersView'
import { GameView } from './views/GameView'
import { MainMenu } from './views/MainMenu'
import { NewGameView } from './views/NewGameView'
import { SetupView } from './views/SetupView'
import { AppSettingsModal } from './views/AppSettingsModal'
import { CreditsModal } from './views/CreditsModal'
import { DownloadModal } from './views/DownloadModal'
import { FeedbackModal } from './views/FeedbackModal'
import { LoadGameModal } from './views/LoadGameModal'
import { SupportModal } from './views/SupportModal'
import { heldScreenTheme } from './views/clockTheme'
import { useAssetStore } from './stores/assetStore'
import { useAudioStore } from './stores/audioStore'
import { useCharacterStore } from './stores/characterStore'
import { useComfyStore } from './stores/comfyStore'
import { cancelCrossing, endCrossing } from './stores/crossingStore'
import { useGameStore } from './stores/gameStore'
import { useGrabBagStore } from './stores/grabBagStore'
import { useSaveStore } from './stores/saveStore'
import { useSettingsStore } from './stores/settingsStore'
import { useSetupStore } from './stores/setupStore'
import { useUiStore, type ViewName } from './stores/uiStore'
import { isWebBuild } from './platform'

/**
 * Which screen a finished boot opens on: the first run where one is still owed, then whatever
 * this build can still be short of before the menu is worth showing.
 */
function bootView(firstRun: boolean, comfySettled: boolean, writerOk: boolean): ViewName {
  if (firstRun) return 'firstRun'
  // The browser build installs nothing, so the writer is the only thing it can still owe.
  if (isWebBuild()) return writerOk ? 'mainMenu' : 'apiKey'
  return comfySettled ? 'mainMenu' : 'setup'
}

/**
 * Bootstraps stores in dependency order, then opens the cover `main.tsx` raised onto whichever
 * screen the run is up to. Store-raised fatal errors stop the sequence early and drop the
 * cover with it, the screen those swaps were written for having been replaced.
 */
async function boot(): Promise<void> {
  const ui = useUiStore.getState()

  await useSettingsStore.getState().load()
  if (useUiStore.getState().fatalError) {
    cancelCrossing()
    return
  }

  // Non-fatal: a failed read leaves the grab bags running in memory for the session.
  await useGrabBagStore.getState().load()

  // The graph opens as soon as the sliders it mixes against are in.
  useAudioStore.getState().start()

  // A deferred ComfyUI install skips the verify pass outright, and the browser build, which
  // has no local image generation at all, never asks.
  const deferred = Boolean(useSettingsStore.getState().settings?.comfyDeferred)
  if (!isWebBuild() && !deferred) {
    await useSetupStore.getState().refresh()
    if (useUiStore.getState().fatalError) {
      cancelCrossing()
      return
    }
  }

  // Non-fatal: a broken pose manifest only blocks character creation.
  await useAssetStore.getState().load()

  // The shipped cast, non-fatal; the in-game height lineup reads it too.
  await useCharacterStore.getState().loadDefaults()

  // Whether any playthrough exists, non-fatal: asked before the menu's first paint
  // so its top button does not change under the player.
  await useSaveStore.getState().loadPlaythroughs()

  const comfyInstalled = Boolean(useSetupStore.getState().status?.comfyReady)
  // The content question is the first run's last step, so an unanswered one is the whole of
  // how a boot knows the run never finished; the screen it opens picks up at whichever stage
  // is still unsettled.
  const firstRun = useSettingsStore.getState().settings?.sfwAsked === false
  const stored = useSettingsStore.getState().settings
  const writerOk = stored ? writerReady(stored, stored.apiKeySet) : false

  // The boot's own cover, raised before the first frame (`main.tsx`), opens here.
  endCrossing(() => ui.setView(bootView(firstRun, deferred || comfyInstalled, writerOk)))

  // Not awaited: nothing on the menu needs it.
  if (comfyInstalled) void useComfyStore.getState().ensureStarted()
}

function App(): JSX.Element {
  const view = useUiStore((s) => s.view)
  const modals = useUiStore((s) => s.modals)
  const error = useUiStore((s) => s.error)
  const fatalError = useUiStore((s) => s.fatalError)
  const download = useUiStore((s) => s.download)
  // The Game View's own key: a save switched over a running game replaces
  // this store's state under the curtain, and its React state — crossfade pairs, `sending`,
  // `uiHidden` — is a fact about the save on screen and must not outlive it.
  const gameLoads = useGameStore((s) => s.loads)

  useEffect(() => {
    void boot()
  }, [])

  if (fatalError) return <FatalErrorScreen error={fatalError} />

  return (
    <>
      {/* `boot` draws nothing: the curtain is the boot screen, and it is up from the first
          frame. One screen, three ways in — the whole first run, the key stage alone, the
          install checklist alone. */}
      {(view === 'setup' || view === 'apiKey' || view === 'firstRun') && (
        <SetupView key={view} mode={view} />
      )}
      {view === 'mainMenu' && <MainMenu />}
      {view === 'manageCharacters' && <ManageCharactersView />}
      {/* `quickstart` and `classSelect` both render from inside `NewGameView`. */}
      {(view === 'newGame' || view === 'quickstart' || view === 'classSelect') && <NewGameView />}
      {view === 'game' && <GameView key={gameLoads} />}

      {/* Written before the portal host, so a modal opened during a crossing — the reader's
          name, a failed start — still opens over the curtain rather than under it. Load Game
          is the one that steps under it, and says so itself. */}
      <Crossing />
      <ModalHost />
      {/* The gate itself is what a closing modal has to outlive, so it is the presence's
          child: the exits run inside it, and it unmounts once they finish. */}
      <AnimatePresence>
        {(modals.length > 0 || error || download) && <AppModals key="app-modals" />}
      </AnimatePresence>

      {/* It draws nothing here — it publishes what the pointer is doing onto the document and
          the OS draws the mark. Outside the fatal branch above on purpose: a screen the
          app has fallen over onto hands the system's own cursor back. */}
      <Cursor />
    </>
  )
}

/**
 * The modals no single view owns — the menu's five and the tier-2 error — portalled out with a
 * theme read once via `heldScreenTheme()`, remounted fresh each time one of them opens.
 */
function AppModals(): JSX.Element {
  const modals = useUiStore((s) => s.modals)
  const error = useUiStore((s) => s.error)
  const download = useUiStore((s) => s.download)
  const dismissError = useUiStore((s) => s.dismissError)

  const [theme] = useState(heldScreenTheme)

  return (
    <>
      {/* `propagate`, so the last modal to close still leaves: this component is itself
          being removed by then, and its children only know that through the parent. */}
      <AnimatePresence propagate>
        {modals.includes('settings') && <AppSettingsModal key="settings" theme={theme} />}
        {modals.includes('credits') && <CreditsModal key="credits" theme={theme} />}
        {modals.includes('feedback') && <FeedbackModal key="feedback" theme={theme} />}
        {modals.includes('support') && <SupportModal key="support" theme={theme} />}
        {modals.includes('loadGame') && <LoadGameModal key="load-game" theme={theme} />}
        {download && (
          <DownloadModal key="download" theme={theme} name={download.name} url={download.url} />
        )}
        {error && (
          <ErrorModal
            key="app-error"
            id="app-error"
            theme={theme}
            error={error}
            onClose={dismissError}
          />
        )}
      </AnimatePresence>
    </>
  )
}

export default App
