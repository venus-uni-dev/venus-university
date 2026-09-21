import { useEffect, useState, type JSX } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { defaultModelFor, defaultSecondaryModelFor } from '@shared/providers'
import { writerReady } from '@shared/settingsRules'
import { modelForComponentId } from '@shared/setupManifest'
import type { SetupComponent, SettingsPatch } from '@shared/types'
import { CheckField } from '../components/CheckField'
import { isWebBuild } from '../platform'
import { useComfyStore } from '../stores/comfyStore'
import { beginCrossing, endCrossing, useCrossingStore } from '../stores/crossingStore'
import { patchOf, useSettingsStore } from '../stores/settingsStore'
import { useSetupStore, type ComponentProgress } from '../stores/setupStore'
import { useUiStore } from '../stores/uiStore'
import { heldScreenTheme } from './clockTheme'
import {
  decorIn,
  dealt,
  dealtItem,
  fadeIn,
  FILL,
  gestures,
  lift,
  linkLift,
  press,
  pulse,
  quietLift,
  quietPress,
  spin
} from './motion'
import { CloseIcon, DownloadIcon } from './screenIcons'
import { SfwPromptModal } from './SfwPromptModal'
import '../vu_styles/Setup.css'

/** One thing the screen asks for, in the order a run asks for them. */
type SetupStage = 'apiKey' | 'imageGen' | 'content'

/** Which of them a visit is here for. */
export type SetupMode = 'setup' | 'apiKey' | 'firstRun'

/**
 * The stages a first run still owes: a stage already settled is skipped — a writer that can be
 * called, an install finished or deferred — and the content question is always last, because
 * answering it is what says the first run is over.
 */
function firstRunStages(
  writerOk: boolean,
  comfySettled: boolean
): [SetupStage, ...SetupStage[]] {
  if (!writerOk && !comfySettled) return ['apiKey', 'imageGen', 'content']
  if (!writerOk) return ['apiKey', 'content']
  if (!comfySettled) return ['imageGen', 'content']
  return ['content']
}

/** What a mode is here for: one stage on its own, or the whole run. */
function stagesOf(mode: SetupMode): [SetupStage, ...SetupStage[]] {
  if (mode === 'apiKey') return ['apiKey']
  if (mode === 'setup') return ['imageGen']
  const settings = useSettingsStore.getState().settings
  return firstRunStages(
    settings ? writerReady(settings, settings.apiKeySet) : false,
    // The browser has no install to settle, so that stage is settled before it is asked for.
    isWebBuild() ||
      Boolean(useSetupStore.getState().status?.comfyReady) ||
      Boolean(settings?.comfyDeferred)
  )
}

/** A stage arrives as two layers, the pitch and the panel a beat behind it. */
const PITCH_IN = fadeIn(0.1)
const PANEL_IN = fadeIn(0.18)

/** What a row is: the four faces one component wears, from its run or from the snapshot. */
type RowKind = 'ok' | 'busy' | 'failed' | 'waiting'

/** Formats a byte count for a row's own reading. */
function formatBytes(bytes: number): string {
  const gib = bytes / 1024 ** 3
  if (gib >= 1) return `${gib.toFixed(1)} GB`
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`
}

/**
 * Which face a row wears: `progress` is authoritative once it exists, finished included, so a
 * row that lands early doesn't revert to its pre-install reading until the run ends.
 */
function kindOf(component: SetupComponent, progress?: ComponentProgress): RowKind {
  if (progress?.error) return 'failed'
  if (progress) return progress.done ? 'ok' : 'busy'
  if (component.state === 'ok') return 'ok'
  if (component.state === 'invalid') return 'failed'
  return 'waiting'
}

/**
 * One checklist row: the disc, the label over its reading, and either the word for
 * its state or — where a model download has failed — the rescue kit that replaces it.
 * It is a surface on the screen's own ground, so it carries the paper layer.
 */
function SetupRow({
  component,
  progress,
  installing
}: {
  component: SetupComponent
  progress?: ComponentProgress
  installing: boolean
}): JSX.Element {
  const openModelFolder = useSetupStore((s) => s.openModelFolder)
  const verifyModel = useSetupStore((s) => s.verifyModel)

  const kind = kindOf(component, progress)
  const percent = kind === 'busy' ? progress?.percent : undefined
  // The manifest knows what a weight weighs, so a model row prints its size where the
  // runtime and the custom nodes have none to print.
  const model = modelForComponentId(component.id)
  const size = model ? formatBytes(model.bytes) : null

  // The kit is the retry, so it stands only where there is a file to place by hand and
  // nothing is currently running over it.
  const rescue = kind === 'failed' && !installing && model

  // A run that failed says so in its own step; a file that is simply wrong at rest is
  // damaged, which is what it was called before anything ran.
  const wrong = progress?.step ?? (component.state === 'invalid' ? 'damaged' : 'failed')

  const sub = ((): string => {
    if (kind === 'failed') {
      const why = progress?.error?.message ?? component.detail
      return why ? `${wrong.toLowerCase()} — ${why}` : wrong.toLowerCase()
    }
    if (kind === 'busy') {
      if (progress?.bytesTotal) {
        return `downloading — ${formatBytes(progress.bytesDone ?? 0)} / ${formatBytes(progress.bytesTotal)}`
      }
      return (progress?.step ?? 'working').toLowerCase()
    }
    if (kind === 'ok') return size ? `verified · ${size}` : 'verified'
    const waiting = installing ? 'queued' : 'not installed'
    return size ? `${waiting} · ${size}` : waiting
  })()

  // The word is a reading and not a sentence: the step a run is on is already the subline,
  // so a bar with no count says only that it is working.
  const word = ((): string => {
    if (kind === 'failed') return wrong.toUpperCase()
    if (kind === 'busy') return percent === undefined ? 'WORKING' : `${Math.round(percent)}%`
    if (kind === 'ok') return 'OK'
    return installing ? 'WAITING' : 'MISSING'
  })()

  return (
    <motion.li className={`vu-setup-row vu-paper vu-setup-row--${kind}`} variants={dealtItem}>
      {/* A disc with no count to show for it pulses; one that is measuring itself does not,
          the bar under the words being the report. */}
      <motion.span
        className="vu-setup-row-disc"
        animate={kind === 'busy' && percent === undefined ? pulse : { opacity: 1 }}
      >
        {kind === 'ok' && <CheckMark />}
        {kind === 'busy' && <DownloadIcon size={19} ariaHidden />}
        {kind === 'failed' && <CloseIcon />}
      </motion.span>

      <span className="vu-setup-row-body">
        <span className="vu-setup-row-title">{component.label}</span>
        {sub && <span className="vu-setup-row-sub">{sub}</span>}
        {percent !== undefined && (
          <span className="vu-track vu-setup-row-track" aria-hidden="true">
            <motion.span
              className="vu-bar"
              initial={{ width: '0%' }}
              animate={{ width: `${Math.round(percent)}%` }}
              transition={FILL}
            />
          </span>
        )}
      </span>

      {rescue ? (
        <span className="vu-setup-rescue">
          <motion.a
            className="vu-pill"
            href={model.url}
            target="_blank"
            rel="noreferrer"
            {...gestures(false, quietLift, quietPress)}
          >
            <LinkMark />
            pinned link
          </motion.a>
          <motion.button
            id={`setup-open-folder-${model.id}`}
            className="vu-pill"
            {...gestures(false, quietLift, quietPress)}
            onClick={() => void openModelFolder(component.id)}
          >
            Open folder
          </motion.button>
          {/* Never disabled: a double-press is caught by the store's `installing` guard. */}
          <motion.button
            id={`setup-verify-${model.id}`}
            className="vu-btn vu-btn--primary vu-btn--panel vu-paper"
            {...gestures(false, lift, press)}
            onClick={() => void verifyModel(component.id)}
          >
            Verify
          </motion.button>
        </span>
      ) : (
        <span className="vu-setup-row-state">{word}</span>
      )}
    </motion.li>
  )
}

/**
 * The setup screen and everything a run has to settle on it, one stage at a time on one ground.
 * The mode says which stages those are, and the last of them hands the player to the menu.
 */
export function SetupView({ mode }: { mode: SetupMode }): JSX.Element {
  const setView = useUiStore((s) => s.setView)
  const crossing = useCrossingStore((s) => s.phase !== 'idle')

  // Drawn once per visit, from the dev switch or the machine clock.
  const [theme] = useState(heldScreenTheme)

  // Settled on arrival, so a stage cannot appear or vanish under the player: an install that
  // finishes here does not retract the question the flow was going to ask next.
  const [stages] = useState(() => stagesOf(mode))
  const [stage, setStage] = useState<SetupStage>(stages[0])

  // The content question: asked on the curtain that clears the last stage for it, and never
  // again once answered. A run with nothing before `content` is already under the app's own
  // cover when it mounts, so it asks at once rather than waiting for a crossing of its own.
  const [ask, setAsk] = useState<'before' | 'open' | 'done'>(() =>
    stages[0] === 'content' ? 'open' : 'before'
  )

  /** Moves to the stage the run still owes, or off the screen where it owes none. */
  function advance(): void {
    const next: SetupStage | undefined = stages[stages.indexOf(stage) + 1]
    // Every route that is not the first run ends here, on the plain cut every other screen
    // returns to the menu with.
    if (!next) {
      setView('mainMenu')
      return
    }
    if (next === 'content') {
      // The swap and the question go up together under one cover: the curtain holds there,
      // unopened, with the modal painted on its face, until the answer comes in.
      beginCrossing(() => {
        setStage(next)
        setAsk('open')
      }, { from: theme })
      return
    }
    setStage(next)
  }

  /** The way off the bare ground, once the question that was asked on it has been answered. */
  function toMenu(): void {
    if (ask !== 'done') return
    const swap = () => setView('mainMenu')
    // `beginCrossing` returns false while a crossing is already running — the curtain the
    // question was asked on — and there the answer simply ends that crossing onto the menu.
    // Where it is idle (a content-only run, revealed from boot with the question already
    // answered), a fresh cover is raised for the plain cut every other route takes.
    if (beginCrossing(swap, { from: theme })) {
      endCrossing()
      return
    }
    endCrossing(swap)
  }

  return (
    // `inert` while a crossing runs, as the Main Menu does, so nothing behind a curtain answers.
    <div className="vu-setup" data-theme={theme} inert={crossing}>
      {/* The screen's idle: the arch and its shadow arrive together and then breathe as one
          sheet, both on the single variant. It is absent on the bare ground the question is
          asked on. */}
      {stage !== 'content' && (
        <motion.div
          className="vu-setup-decor"
          variants={decorIn}
          initial="hidden"
          animate="shown"
        >
          <div className="vu-setup-decor-shadow" />
          <div className="vu-setup-decor-face" />
        </motion.div>
      )}

      {/* One presence in wait mode, so the stage leaving is gone before the next arrives. */}
      <AnimatePresence mode="wait">
        {stage === 'apiKey' && <ApiKeyStage key="api-key" onDone={advance} />}
        {stage === 'imageGen' && (
          <ImageGenStage
            key="image-gen"
            last={stages[stages.length - 1] === 'imageGen'}
            onDone={advance}
          />
        )}
      </AnimatePresence>

      {/* The modal appears on the curtain that cleared the last stage for it, its own presence
          separate from the crossing's: the cover to the menu waits out its fade, since the
          curtain paints under the portal host and a modal still leaving would ride over it. */}
      <AnimatePresence onExitComplete={toMenu}>
        {ask === 'open' && (
          <SfwPromptModal key="sfw" theme={theme} onClose={() => setAsk('done')} />
        )}
      </AnimatePresence>
    </div>
  )
}

/** The install checklist with per-item progress and retry state. */
function ImageGenStage({ onDone, last }: { onDone: () => void; last: boolean }): JSX.Element {
  const status = useSetupStore((s) => s.status)
  const checking = useSetupStore((s) => s.checking)
  const installing = useSetupStore((s) => s.installing)
  const progress = useSetupStore((s) => s.progress)
  const refresh = useSetupStore((s) => s.refresh)
  const install = useSetupStore((s) => s.install)
  const setComfyDeferred = useSettingsStore((s) => s.setComfyDeferred)
  const ensureComfyStarted = useComfyStore((s) => s.ensureStarted)

  const complete = Boolean(status?.comfyReady)

  // A deferred boot skips `setup:getStatus`, so this stage asks for it.
  useEffect(() => {
    if (!status && !checking) void refresh()
  }, [status, checking, refresh])

  // Two headings, off the component ids the status already carries: the runtime
  // and its custom nodes are one thing to install, the weights another. Same rows, same order.
  const components = status?.components ?? []
  const runtime = components.filter((c) => !c.id.startsWith('model:'))
  const weights = components.filter((c) => c.id.startsWith('model:'))

  return (
    <>
      <motion.div
        className="vu-setup-pitch"
        variants={PITCH_IN}
        initial="hidden"
        animate="shown"
        exit="gone"
      >
        <span className="vu-setup-kicker">COMFYUI AUTO-INSTALLER</span>
        <h1 className="vu-setup-title">Set up image generation</h1>
        <span className="vu-setup-total">≈14 GB TOTAL</span>
        <p className="vu-setup-body">
          Image generation runs on your own machine and is only needed if you want to{' '}
          <strong>create new characters</strong>. You can still play with pre-genned characters.
          An NVIDIA GPU with greater than 8GB of VRAM is recommended for image generation.
        </p>
      </motion.div>

      <motion.div
        className="vu-setup-panel"
        variants={PANEL_IN}
        initial="hidden"
        animate="shown"
        exit="gone"
      >
        <header className="vu-setup-head">
          <div className="vu-title">
            <h2 className="vu-title-text">Install checklist</h2>
          </div>
          <motion.button
            id="setup-recheck"
            className="vu-pill"
            {...gestures(checking || installing, quietLift, quietPress)}
            disabled={checking || installing}
            onClick={() => void refresh()}
          >
            <RefreshMark />
            Re-check
          </motion.button>
        </header>

        {checking && !status ? (
          <div className="vu-setup-wait">
            <motion.span className="vu-ring vu-setup-ring" animate={spin} />
            <span className="vu-setup-wait-label">CHECKING INSTALLED COMPONENTS…</span>
          </div>
        ) : (
          <div className="vu-setup-list-box">
            <motion.ul
              className="vu-setup-list"
              variants={dealt(0.25, 0.05)}
              initial="hidden"
              animate="shown"
            >
              <motion.li className="vu-setup-group" variants={dealtItem}>
                COMFYUI DEPENDENCIES
              </motion.li>
              {runtime.map((c) => (
                <SetupRow
                  key={c.id}
                  component={c}
                  progress={progress[c.id]}
                  installing={installing}
                />
              ))}

              <motion.li className="vu-setup-group" variants={dealtItem}>
                MODELS
              </motion.li>
              {weights.map((c) => (
                <SetupRow
                  key={c.id}
                  component={c}
                  progress={progress[c.id]}
                  installing={installing}
                />
              ))}
            </motion.ul>
            <div className="vu-setup-fade" />
          </div>
        )}

        <div className="vu-setup-foot">
          <span className="vu-setup-hint">
            You can return to this setup from the main menu if you skip for now.
          </span>
          {/* Two direct children, so `.vu-foot > button` reaches both and an answer swells
              in place rather than lunging at the one beside it. */}
          <div className="vu-foot">
            {/* Leaving an unfinished install is the decision to defer it. */}
            <motion.button
              id="setup-back"
              className="vu-btn vu-btn--quiet"
              {...gestures(installing, quietLift, quietPress)}
              disabled={installing}
              onClick={() => {
                if (!complete) void setComfyDeferred(true)
                onDone()
              }}
            >
              {complete ? (last ? 'Main Menu' : 'Continue') : 'Skip for now'}
            </motion.button>
            <motion.button
              id="setup-install"
              className="vu-btn vu-btn--primary vu-btn--panel vu-paper"
              {...gestures(installing || checking || complete, lift, press)}
              disabled={installing || checking || complete}
              onClick={() => {
                void install().then(() => {
                  // A run that finishes the job un-defers and warms the server it installed.
                  if (!useSetupStore.getState().status?.comfyReady) return
                  void setComfyDeferred(false)
                  void ensureComfyStarted()
                })
              }}
            >
              {installing ? 'Installing…' : 'Install missing'}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </>
  )
}

/**
 * The key stage — what a Gemini key is for, how to make one, and the field it is pasted into.
 * It is a screen and not a modal, so it answers no Escape and no click outside.
 */
function ApiKeyStage({ onDone }: { onDone: () => void }): JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const saving = useSettingsStore((s) => s.saving)
  const save = useSettingsStore((s) => s.save)

  const [key, setKey] = useState('')
  const blank = key.trim().length === 0
  // Only the browser has anywhere to keep a key between visits that the player might not want
  // it kept in; the desktop encrypts its own either way.
  const webBuild = isWebBuild()
  const [remember, setRemember] = useState(settings?.rememberKey === true)

  async function handleSave(): Promise<void> {
    if (!settings || blank) return
    // Every non-secret field rides along, or a save from here would drop the rest; main keeps
    // whatever is stored wherever a key is absent, and stores this one encrypted.
    const patch: SettingsPatch = {
      ...patchOf(settings),
      apiProvider: 'gemini',
      apiKey: key.trim(),
      rememberKey: remember
    }
    // The key pasted here is Gemini's, so a writer pointed at a custom endpoint comes back to
    // Gemini's own defaults with it rather than taking the key as that endpoint's.
    if (settings.apiProvider !== 'gemini') {
      patch.apiModel = defaultModelFor('gemini').id
      patch.thinkingLevel = defaultModelFor('gemini').defaultThinkingLevel
      patch.secondaryModel = defaultSecondaryModelFor('gemini').id
      patch.secondaryModelFor = undefined
    }
    const ok = await save(patch)
    // A failed write leaves the stage up; the store has already raised the error.
    if (!ok) return
    onDone()
  }

  return (
    <>
      <motion.div
        className="vu-setup-pitch"
        variants={PITCH_IN}
        initial="hidden"
        animate="shown"
        exit="gone"
      >
        <span className="vu-setup-kicker">GOOGLE GEMINI API</span>
        <h1 className="vu-setup-title">Set up your API key</h1>
        <p className="vu-setup-body">
          Venus University is and always will be free, but it relies on the Gemini API to support emergent gameplay. 
          You can create a Gemini API key for free, but the free tier comes with rate and usage limits.
          Setting up billing upgrades you to a paid tier and costs about $0.30 USD per hour of game time, and is highly recommended for a smooth experience.
        </p>
      </motion.div>

      <motion.div
        className="vu-setup-panel"
        variants={PANEL_IN}
        initial="hidden"
        animate="shown"
        exit="gone"
      >
        <header className="vu-setup-head">
          <div className="vu-title">
            <h2 className="vu-title-text">How to get a key</h2>
          </div>
          <motion.a
            className="vu-pill"
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
            {...gestures(false, quietLift, quietPress)}
          >
            <LinkMark />
            Google AI Studio
          </motion.a>
        </header>

        <ol className="vu-setup-steps">
          <li className="vu-setup-step">
            Open Google AI Studio&apos;s API keys page{' '}
            <motion.a
              className="vu-link"
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noreferrer"
              whileHover={linkLift}
              whileFocus={linkLift}
            >
              here
            </motion.a>
            , sign in with a Google account and accept
            the Terms of Service. A Cloud project and a key should be made by default for you, but if none appear,
            click <strong>Create API key</strong>.
          </li>
          <li className="vu-setup-step">
            Optional: To bypass the free-tier rate limits, click <strong>Set up billing</strong> on
            that same page, pick or create a Cloud Billing account, add a payment method, and
            prepay at least $5.
          </li>
          <li className="vu-setup-step">
            Your API key is encrypted and stored on your own machine and only sent to Google. But
            it's recommended to set up a{' '}
            <motion.a
              className="vu-link"
              href="https://ai.google.dev/gemini-api/docs/billing#spend-caps"
              target="_blank"
              rel="noreferrer"
              whileHover={linkLift}
              whileFocus={linkLift}
            >
              spending cap
            </motion.a>{' '}
            on your key just in case.
          </li>
          <li className="vu-setup-step">Copy the key and paste it below.</li>
        </ol>

        {/* No placeholder: a placeholder is a value the field would submit, and a secret has
            none. */}
        <label className="vu-field vu-setup-key" htmlFor="setup-api-key">
          <span className="vu-field-label">API key</span>
          <input
            id="setup-api-key"
            className="vu-input"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !blank) void handleSave()
            }}
          />
        </label>

        {webBuild && (
          <div className="vu-setup-remember">
            <CheckField
              id="setup-remember-key"
              label="Remember my key on this device"
              note="By default, your key will be deleted every session. Enabling this setting will save your key in browser storage so you won't have to type it in again next time. Warning: other itch.io games will be able to read your key."
              checked={remember}
              onChange={setRemember}
            />
          </div>
        )}

        <div className="vu-setup-foot">
          <span className="vu-setup-hint">
            You can add a key later in Settings if you skip for now. You'll still be able to manage and generate characters.
            Using OpenAI, OpenRouter or a local model instead? Skip this, then pick Custom under Provider in Settings.
          </span>
          {/* Two direct children, so `.vu-foot > button` reaches both and an answer swells
              in place rather than lunging at the one beside it. */}
          <div className="vu-foot">
            <motion.button
              id="setup-key-skip"
              className="vu-btn vu-btn--quiet"
              {...gestures(saving, quietLift, quietPress)}
              disabled={saving}
              onClick={onDone}
            >
              Skip for now
            </motion.button>
            <motion.button
              id="setup-key-save"
              className="vu-btn vu-btn--primary vu-btn--panel vu-paper"
              {...gestures(blank || saving, lift, press)}
              disabled={blank || saving}
              onClick={() => void handleSave()}
            >
              {saving ? 'Saving…' : 'Save key'}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </>
  )
}

/** A component that verified, drawn in `currentColor` so the disc it rides tints it. */
function CheckMark(): JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

/** The mark on the one link that leaves the app — an icon, never a typographic ↗. */
function LinkMark(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </svg>
  )
}

/** The mark on Re-check: one turn, the way a verify pass runs again. */
function RefreshMark(): JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  )
}
