import { useEffect, useState, type JSX, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { endpointProblem, normalizeEndpoint } from '@shared/endpoint'
import {
  defaultModelFor,
  defaultSecondaryModelFor,
  modelFor,
  providerFor,
  thinkingLevelFor
} from '@shared/providers'
import { writerReady } from '@shared/settingsRules'
import { modelForComponentId } from '@shared/setupManifest'
import type { ProviderApi } from '@shared/providers'
import type { SetupComponent, SettingsPatch } from '@shared/types'
import { CheckField } from '../components/CheckField'
import { ComboField } from '../components/ComboField'
import { SelectField } from '../components/SelectField'
import { TitleTab } from '../components/TitleTab'
import { isWebBuild } from '../platform'
import { useComfyStore } from '../stores/comfyStore'
import { beginCrossing, endCrossing, useCrossingStore } from '../stores/crossingStore'
import { patchOf, useSettingsStore } from '../stores/settingsStore'
import { useSetupStore, type ComponentProgress } from '../stores/setupStore'
import { useUiStore } from '../stores/uiStore'
import { heldScreenTheme } from './clockTheme'
import {
  archResize,
  decorIn,
  dealt,
  dealtItem,
  fadeIn,
  FILL,
  gestures,
  lift,
  linkLift,
  panelUnderTab,
  press,
  pulse,
  quietLift,
  quietPress,
  spin
} from './motion'
import { CloseIcon, DownloadIcon } from './screenIcons'
import { SfwPromptModal } from './SfwPromptModal'
import { useEndpointProbe } from './useEndpointProbe'
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

/**
 * How wide the arch stands on each stage and how far off the left edge it starts: the key stage
 * carries the most copy inside the curve, so it takes the wider of the two.
 */
const ARCH = {
  apiKey: { width: 1000, left: -250 },
  imageGen: { width: 840, left: -230 }
}

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
          sheet, both on the single variant. The outer box carries only the measure the stage it
          frames asks for, tweened because it stands outside the presence the stages cross in and
          would otherwise snap mid-crossfade; `initial={false}` is what keeps the first paint at
          the stage's own width rather than animating to it. It is absent on the bare ground the
          question is asked on. */}
      {stage !== 'content' && (
        <motion.div
          className="vu-setup-decor"
          initial={false}
          animate={ARCH[stage]}
          transition={archResize}
        >
          <motion.div
            className="vu-setup-decor-sheet"
            variants={decorIn}
            initial="hidden"
            animate="shown"
          >
            <div className="vu-setup-decor-shadow" />
            <div className="vu-setup-decor-face" />
          </motion.div>
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
          
        </p>
        <p className="vu-setup-body">
          An NVIDIA GPU (GeForce 20 series or newer) with more than 8GB of VRAM is recommended.
        </p>
        <p className="vu-setup-body">
          AMD support is experimental and only lightly tested: please reach out if you encounter issues.
        </p>
        <p className="vu-setup-body">
          Your GPU is automatically detected when deciding which ComfyUI version to install.
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
 * The key stage — which provider writes, what it needs and the card those fields are typed into.
 * Both providers are staged here and nothing is written until Save; Skip writes nothing at all.
 * It is a screen and not a modal, so it answers no Escape and no click outside.
 */
function ApiKeyStage({ onDone }: { onDone: () => void }): JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const saving = useSettingsStore((s) => s.saving)
  const save = useSettingsStore((s) => s.save)

  // Which page the card is drawn as. Staged like everything else on it: a provider picked here
  // is written by Save and by nothing else.
  const [apiProvider, setApiProvider] = useState<ProviderApi>(
    () => settings?.apiProvider ?? 'gemini'
  )
  // Off the held provider, so the select never opens on another provider's model.
  const [apiModel, setApiModel] = useState(() =>
    settings?.apiProvider === 'gemini'
      ? modelFor('gemini', settings.apiModel).id
      : defaultModelFor('gemini').id
  )
  const [geminiKey, setGeminiKey] = useState('')
  // Only the browser has anywhere to keep a key between visits that the player might not want
  // it kept in; the desktop encrypts its own either way.
  const webBuild = isWebBuild()
  const [remember, setRemember] = useState(settings?.rememberKey === true)
  // The custom endpoint's own fields. The keys are the exception to the seeding: the renderer is
  // never told either one, so both open blank.
  const [endpointUrl, setEndpointUrl] = useState(() => settings?.endpointUrl ?? '')
  const [endpointKey, setEndpointKey] = useState('')
  const [modelIdText, setModelIdText] = useState(() =>
    settings?.apiProvider === 'openai' ? settings.apiModel : ''
  )
  // The layer inside the card a combobox hangs its list on, once it is in the document.
  const [popupHost, setPopupHost] = useState<HTMLElement | null>(null)

  const custom = apiProvider === 'openai'
  const modelId = modelIdText.trim()

  // The two questions the custom page asks its endpoint. A first run sends the lowest effort
  // there is, and the thinking level and the reply cap are whatever is already stored.
  const probe = useEndpointProbe({
    enabled: custom,
    endpointUrl,
    endpointKey,
    modelId,
    reasoningEffort: 'minimal',
    thinkingLevel: settings?.thinkingLevel ?? defaultModelFor('gemini').defaultThinkingLevel,
    maxOutputTokens: settings?.maxOutputTokens
  })

  // A stage opening on a stored endpoint has a URL to ask on already; every later ask is one of
  // the two fields behind the list being left, so the provider is the whole of what re-runs this.
  useEffect(() => {
    void probe.refreshModels()
  }, [apiProvider])

  // Why Save is dead, checked against the staged text alone.
  const saveDead =
    saving ||
    (custom ? endpointProblem(endpointUrl) !== null || modelId === '' : geminiKey.trim() === '')

  /** The provider, and with it the page the card redresses itself as. Nothing is written. */
  function handleProviderChange(value: string): void {
    const next = value as ProviderApi
    setApiProvider(next)
    if (next === 'gemini') setApiModel(defaultModelFor('gemini').id)
    setModelIdText('')
    probe.reset()
  }

  /** Writes the staged provider with everything it runs on, and hands the run on where it lands. */
  async function handleSave(): Promise<void> {
    if (!settings || saveDead) return
    // Every non-secret field rides along, or a save from here would drop the rest; main keeps
    // whatever is stored wherever a key is absent, and stores one given here encrypted.
    const patch: SettingsPatch = custom
      ? {
          ...patchOf(settings),
          apiProvider: 'openai',
          endpointUrl: normalizeEndpoint(endpointUrl),
          apiModel: modelId,
          // The effort a first run sends at, and one model for every call: Settings is where
          // the three of them are tuned, once there is a game to tune them for.
          reasoningEffort: 'minimal',
          secondaryModel: '',
          secondaryModelFor: undefined,
          rememberKey: remember,
          ...(endpointKey.trim() ? { endpointApiKey: endpointKey.trim() } : {})
        }
      : {
          ...patchOf(settings),
          apiProvider: 'gemini',
          apiKey: geminiKey.trim(),
          rememberKey: remember,
          apiModel,
          thinkingLevel: thinkingLevelFor('gemini', apiModel, settings.thinkingLevel),
          // A writer coming back from a custom endpoint takes Gemini's own second model with it;
          // one that was Gemini's already keeps whatever it was pointed at.
          secondaryModel:
            settings.apiProvider === 'gemini'
              ? settings.secondaryModel
              : defaultSecondaryModelFor('gemini').id,
          secondaryModelFor:
            settings.apiProvider === 'gemini' ? settings.secondaryModelFor : undefined
        }
    const ok = await save(patch)
    // A failed write leaves the stage up; the store has already raised the error.
    if (!ok) return
    onDone()
  }

  /** Enter in a typed field is the foot's primary, wherever that primary is live. */
  function handleEnter(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter' && !saveDead) void handleSave()
  }

  return (
    <>
      <motion.div
        className="vu-setup-pitch vu-setup-pitch--wide"
        variants={PITCH_IN}
        initial="hidden"
        animate="shown"
        exit="gone"
      >
        <span className="vu-setup-kicker">AI PROVIDER SETUP</span>
        <h1 className="vu-setup-title">Set up text generation</h1>
        <p className="vu-setup-body">
          Venus University relies on external chat completions API to support emergent gameplay.
          Two options are supported for providers:
        </p>
        <div className="vu-setup-blurb">
          <span className="vu-setup-blurb-head">Google AI Studio</span>
          <p className="vu-setup-body">
            The recommended option. Signing up with a Google Account gives you access to a free
            tier with rate limits. If you add billing on your account, you&apos;ll get access to a
            paid tier with 0 upfront fees, and will be billed as-you-go based on usage.
          </p>
        </div>
        <div className="vu-setup-blurb">
          <span className="vu-setup-blurb-head">Custom</span>
          <p className="vu-setup-body">
            If you would prefer to use something other than Google AI Studio, any API endpoint
            with a chat completions compatible endpoint can be used. I recommend still using
            Gemini Flash 3.x models since that&apos;s what I test on. You can also technically use
            locally hosted models but I strongly discourage this for speed and quality reasons.
          </p>
        </div>
      </motion.div>

      <div className="vu-setup-stand">
        <motion.div
          id="setup-card"
          className="vu-setup-card vu-paper"
          variants={panelUnderTab}
          initial="hidden"
          animate="shown"
          exit="gone"
        >
          <TitleTab>Setup</TitleTab>

          {/* Who writes the scenes: the app's own default, or any endpoint that speaks chat
              completions. Everything under it is drawn off this, and the card keeps its size
              across the swap. */}
          <SelectField
            id="setup-provider"
            label="Provider"
            value={apiProvider}
            onChange={handleProviderChange}
            options={[
              { value: 'gemini', label: 'Google AI Studio (default)' },
              { value: 'openai', label: 'Custom (Compatible with Chat Completions/OpenAI)' }
            ]}
          />

          <div className="vu-scroll-box">
            <div className="vu-setup-card-fields">
              <span className="vu-setup-card-heading">
                {custom ? 'How to set up a custom endpoint' : 'How to get a key'}
              </span>

              {custom ? (
                <ol className="vu-setup-steps">
                  <li className="vu-setup-step">
                    Find your endpoint URL. The URL must be a chat completions endpoint,
                    usually ending in /v1 or /v1/chat/completions.
                  </li>
                  <li className="vu-setup-step">
                    If you're using an online provider, grab an API key. Instructions vary based on the exact provider.
                  </li>
                  <li className="vu-setup-step">
                    Test your connection to make sure your setup is working.
                  </li>
                </ol>
              ) : (
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
                    , sign in with a Google account and accept the Terms of Service. A Cloud
                    project and a key should be made by default for you, but if none appear,
                    click <strong>Create API key</strong>.
                  </li>
                  <li className="vu-setup-step">
                    Optional: To bypass the free-tier rate limits, click{' '}
                    <strong>Set up billing</strong> on that same page, pick or create a Cloud
                    Billing account and add a payment method.
                  </li>
                  <li className="vu-setup-step">
                    Your API key is encrypted and stored on your own machine and only sent to
                    Google. But it&apos;s recommended to set up a{' '}
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
              )}

              {custom ? (
                <>
                  {/* The root every request is sent to. Leaving it asks the endpoint what it
                      serves, so the id field below has something to offer. */}
                  <label className="vu-field" htmlFor="setup-endpoint-url">
                    <span className="vu-field-label">Endpoint URL</span>
                    <input
                      id="setup-endpoint-url"
                      className="vu-input"
                      type="text"
                      value={endpointUrl}
                      onChange={(e) => setEndpointUrl(e.target.value)}
                      onBlur={() => void probe.refreshModels()}
                      onKeyDown={handleEnter}
                    />
                  </label>

                  {/* The endpoint's own key, which never follows the player to another host. */}
                  <label className="vu-field" htmlFor="setup-endpoint-key">
                    <span className="vu-field-label">API key</span>
                    <input
                      id="setup-endpoint-key"
                      className="vu-input"
                      type="password"
                      value={endpointKey}
                      onChange={(e) => setEndpointKey(e.target.value)}
                      onBlur={() => void probe.refreshModels()}
                      onKeyDown={handleEnter}
                    />
                  </label>

                  <ComboField
                    id="setup-model-id"
                    label="Model ID"
                    hint="If you're not seeing any options as you type, you may have the wrong URL. Gemini Flash 3.x models are what the game is tested on and I highly recommend them."
                    value={modelIdText}
                    onChange={setModelIdText}
                    options={probe.modelIds}
                    popupHost={popupHost}
                  />

                  {/* One tiny request on the fields as typed, so the endpoint answers for them
                      before a game does. */}
                  <div className="vu-test-row">
                    <motion.button
                      id="setup-test-connection"
                      className="vu-btn vu-btn--quiet"
                      type="button"
                      disabled={probe.testDead}
                      {...gestures(probe.testDead, quietLift, quietPress)}
                      onClick={() => void probe.runTest()}
                    >
                      Test connection
                    </motion.button>
                    {probe.testWord && <span className="vu-btn-sub">{probe.testWord}</span>}
                    {typeof probe.test === 'object' && (
                      <span className="vu-test-note">{probe.test.error.message}</span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {/* No placeholder: a placeholder is a value the field would submit, and a
                      secret has none. */}
                  <label className="vu-field" htmlFor="setup-api-key">
                    <span className="vu-field-label">API key</span>
                    <input
                      id="setup-api-key"
                      className="vu-input"
                      type="password"
                      value={geminiKey}
                      onChange={(e) => setGeminiKey(e.target.value)}
                      onKeyDown={handleEnter}
                    />
                  </label>

                  <SelectField
                    id="setup-model"
                    label="Model"
                    hint="Gemini Flash 3.5 or 3.6 is recommended for free tier users. Flash 3.8 is the best and fastest model available, but may sometimes drop calls during heavy traffic."
                    value={apiModel}
                    onChange={setApiModel}
                    options={providerFor('gemini').models.map((model) => ({
                      value: model.id,
                      label: model.label
                    }))}
                  />
                </>
              )}

              {webBuild && (
                <CheckField
                  id="setup-remember-key"
                  label="Remember my key on this device"
                  note="By default, your key will be deleted every session. Enabling this setting will save your key in browser storage so you won't have to type it in again next time. Warning: other itch.io games will be able to read your key."
                  checked={remember}
                  onChange={setRemember}
                />
              )}
            </div>
            <div className="vu-scroll-fade" />
          </div>

          <div className="vu-setup-card-foot">
            <span className="vu-setup-hint">
              If you skip for now, you can add a key later in the settings. You&apos;ll still be
              able to manage and generate characters.
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
                {...gestures(saveDead, lift, press)}
                disabled={saveDead}
                onClick={() => void handleSave()}
              >
                {saving ? 'Saving…' : 'Save'}
              </motion.button>
            </div>
          </div>

          {/* The frame a combobox's floating list is placed against: a direct child of the card,
              which is the panel the list is measured inside. */}
          <div className="vu-popups" ref={setPopupHost} />
        </motion.div>
      </div>
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
