import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { motion } from 'motion/react'
import { toAppError } from '@shared/errors'
import { writerReady } from '@shared/settingsRules'
import { shuffle } from '@shared/shuffle'
import type { Result } from '@shared/types'
import logoUrl from '../../../assets/vu_logo.png'
import { isWebBuild } from '../platform'
import { formatShortGameDate, formatWeekday } from '../prompts/gameDate'
import { enterGame } from '../stores/gameLoop'
import { spriteUrl } from '../stores/characterStore'
import { beginCrossing, coverSwap, endCrossing, useCrossingStore } from '../stores/crossingStore'
import { entryCrossing } from '../stores/slotCrossing'
import { useAssetStore } from '../stores/assetStore'
import { stageEnrollment } from '../stores/newGame'
import {
  isEnrollment,
  newestPlaythrough,
  useSaveStore,
  type LoadedSave,
  type ResolvedEnrollment
} from '../stores/saveStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useSetupStore } from '../stores/setupStore'
import { useUiStore } from '../stores/uiStore'
import { bgUrl } from './bgAssets'
import { heldScreenTheme } from './clockTheme'
import { preloadImage } from './imagePreload'
import {
  breathe,
  chipLift,
  chipPress,
  CROSSFADE_SECONDS,
  dealt,
  dealtItem,
  dealtItemDead,
  fadeIn,
  gestures,
  kenBurns,
  kenBurnsFrom,
  lift,
  press,
  quietLift,
  quietPress,
  rackIn,
  silhouetteIn
} from './motion'
import { HeartIcon } from './screenIcons'
import '../vu_styles/MainMenu.css'

/** The page the chip points at. */
const LINKS = [
  { id: 'social', label: '@venus_uni_game', url: 'https://x.com/venus_uni_game' }
] as const

/** The marks {@link LinkIcon} draws: the outward page, and the Feedback chip beside it. */
type LinkId = (typeof LINKS)[number]['id'] | 'feedback'

/** One background on screen: the key is its place in the queue, and keeps its layer distinct. */
interface Shot {
  key: number
  url: string
}

/** What the top slot's read answers with: the newest save, or a semester still at the registrar. */
type Resumed = LoadedSave | ResolvedEnrollment

/**
 * The version as the menu prints it. A major of 0 is still early access and says so; from 1.0.0
 * the number stands on its own.
 */
function versionLine(version: string): string {
  const major = version.split('.')[0]
  return major === '0' ? `v${version} · early access` : `v${version}`
}

/** Root menu, with each path gated by the dependencies it needs. */
export function MainMenu(): JSX.Element {
  const status = useSetupStore((s) => s.status)
  const openModal = useUiStore((s) => s.openModal)
  const setView = useUiStore((s) => s.setView)
  const playthroughs = useSaveStore((s) => s.playthroughs)
  const loadPlaythroughs = useSaveStore((s) => s.loadPlaythroughs)
  const continueNewest = useSaveStore((s) => s.continueNewest)

  const comfyInstalled = status?.comfyReady ?? false
  const comfyDeferred = useSettingsStore((s) => s.settings?.comfyDeferred ?? false)
  // The browser has no local renderer to install and no window of its own to close.
  const webBuild = isWebBuild()

  // The writer being callable is the whole gate on playing: Gemini's key, or a custom
  // endpoint with a model named.
  const writerOk = useSettingsStore((s) =>
    s.settings ? writerReady(s.settings, s.settings.apiKeySet) : false
  )

  const crossing = useCrossingStore((s) => s.phase !== 'idle')

  // Drawn once per visit: the view remounts on every return to the menu, so each opening gets
  // its own hour, its own places and its own girl. **A game hands the hour it was left in**
  // and the clock answers for every other way here — a crossing back from a night scene must not
  // reveal a menu in daylight (`uiStore.menuTheme`, dropped on the way off the menu).
  const [theme] = useState(heldScreenTheme)
  const [queue] = useState(() => {
    const { interior, exterior } = useAssetStore.getState().backgrounds
    // A base with no image in this half of the day is dropped rather than shown as nothing. The
    // menu stands outside every playthrough's weather, so it is always the dry picture.
    return shuffle([...interior, ...exterior])
      .map((base) => bgUrl(base, theme, false))
      .filter((url): url is string => url !== null)
  })
  const [charId] = useState(() => shuffle([...useSaveStore.getState().characters.keys()])[0] ?? null)

  // At most two: the one being panned across, and the one fading in over it. Empty until the
  // first is decoded (the effect below), so its fade plays on a picture rather than on a box
  // the picture lands in whole once its bytes arrive.
  const [shots, setShots] = useState<Shot[]>([])

  // Held in state so the effect below is armed by one stable promise, and so the button it
  // came from is dead while it is in flight — which is the whole of what the read shows.
  const [resuming, setResuming] = useState<Promise<Resumed | null> | null>(null)

  // Re-reads the folder on the way back from a game, where the newest save has moved.
  useEffect(() => {
    void loadPlaythroughs()
  }, [loadPlaythroughs])

  /** Brings the next background up over the one that has finished its pan. */
  const advance = useCallback(
    async (from: number): Promise<void> => {
      if (queue.length < 2) return
      const key = from + 1
      const url = queue[key % queue.length]!
      // The element is dropped: what the menu is buying here is the wait, not the picture.
      await preloadImage(url)
      // Guarded rather than trusted: the pan may report finished more than once.
      setShots((cur) =>
        cur[cur.length - 1]?.key === from ? [...cur.slice(-1), { key, url }] : cur
      )
    },
    [queue]
  )

  /** Brings the first background up once it is decoded; the element is dropped, the wait is bought. */
  useEffect(() => {
    const url = queue[0]
    if (url === undefined) return
    let live = true
    void preloadImage(url).then(() => {
      if (live) setShots((cur) => (cur.length === 0 ? [{ key: 0, url }] : cur))
    })
    return () => {
      live = false
    }
  }, [queue])

  /** Opens the save the player left off on, or hands the question to Load Game. */
  function onResumed(result: Result<Resumed | null>): void {
    setResuming(null)
    // A failed listing has already reported itself.
    const resumed = result.ok ? result.data : null

    // A playthrough that never got a timetable reopens the registrar on the semester it holds,
    // under a plain cut: nothing is loading behind this cover, so it holds its quiet second and
    // opens again. A roster it can no longer be played with is explained by its own card.
    if (resumed && isEnrollment(resumed)) {
      if (resumed.unloadable) {
        openModal('loadGame')
        return
      }
      beginCrossing(
        () => {
          stageEnrollment(resumed)
          setView('classSelect')
        },
        { from: theme }
      )
      endCrossing()
      return
    }

    // An unloadable save is explained by its own card too.
    if (!resumed || resumed.unloadable) {
      openModal('loadGame')
      return
    }

    const { save, record, characters } = resumed
    // The read is over, so the game is handed to `coverSwap` separately, with `enterGame`
    // deciding when the curtain may open, wherever the save lands it.
    beginCrossing(undefined, entryCrossing(theme, save, record))
    coverSwap(() => {
      enterGame(save, record, Object.fromEntries(characters.map((c) => [c.charId, c])))
      setView('game')
    })
  }

  /**
   * The read the top slot makes, settled through an effect since a local read is not a wait to
   * announce; the handler rides a ref, being a new function every render.
   */
  const settle = useRef(onResumed)
  settle.current = onResumed
  useEffect(() => {
    if (!resuming) return
    let stale = false
    void resuming.then(
      (data) => {
        if (!stale) settle.current({ ok: true, data })
      },
      (err: unknown) => {
        console.error('[main menu] the resume failed', err)
        if (!stale) settle.current({ ok: false, error: toAppError(err) })
      }
    )
    return () => {
      stale = true
    }
  }, [resuming])

  const newest = newestPlaythrough(playthroughs)
  const playDead = !writerOk

  /* Each button's deadness is named once and read three times: the deal it lands on, the
     gestures it is not handed, and the attribute. A dealt button carries motion's own inline
     `opacity`, which beats the CSS dim, so a dead one is dealt to the dim instead. The writer
     gate reaches New Game and Load Game alone — the top slot answers it with a button of its
     own. */
  const continueDead = resuming !== null
  const loadDead = playDead || !newest

  return (
    // The crossing takes the pointer from its first frame but not the keyboard, and a screen
    // behind a curtain must answer neither.
    <div className="vu-menu" data-theme={theme} inert={crossing}>
      {/* The scene idles: the camera creeps across one place, then the next fades in over it. */}
      <div className="vu-menu-bg">
        {shots.map((shot) => (
          <motion.div
            key={shot.key}
            className="vu-menu-bg-layer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{
              duration: shot.key === 0 ? 0.7 : CROSSFADE_SECONDS,
              ease: 'easeOut'
            }}
            onAnimationComplete={() => setShots((cur) => (cur.length > 1 ? cur.slice(-1) : cur))}
          >
            <motion.img
              className="vu-menu-bg-img"
              src={shot.url}
              alt=""
              initial={kenBurnsFrom}
              animate={kenBurns}
              onAnimationComplete={() => void advance(shot.key)}
            />
          </motion.div>
        ))}
      </div>
      <div className="vu-menu-wash" />
      {/* Her shape filled with a colour role rather than knocked to white: the flood takes
          the sprite's own alpha, and the hard shadow is the same primitive again. The
          two colours are read off `.vu-menu`'s theme, which this sits inside. */}
      {charId && (
        <>
          <svg className="vu-menu-silhouette-defs" aria-hidden="true" focusable="false">
            <filter
              id="vu-silhouette"
              x="-10%"
              y="-10%"
              width="130%"
              height="130%"
              colorInterpolationFilters="sRGB"
            >
              <feFlood className="vu-menu-silhouette-ink" />
              <feComposite in2="SourceAlpha" operator="in" />
              <feDropShadow
                className="vu-menu-silhouette-cast"
                dx="26"
                dy="20"
                stdDeviation="0"
              />
            </filter>
          </svg>
          <motion.img
            className="vu-menu-silhouette"
            src={spriteUrl(charId, 'neutral')}
            alt=""
            variants={silhouetteIn}
            initial="hidden"
            animate="shown"
          />
        </>
      )}

      {/* The rack carries the opening down to everything inside it. */}
      <motion.aside
        className="vu-menu-rack vu-paper"
        variants={rackIn}
        initial="hidden"
        animate="shown"
      >
        <motion.img
          className="vu-menu-logo"
          src={logoUrl}
          alt="Venus University"
          animate={breathe}
        />

        <motion.nav className="vu-menu-actions vu-fan" variants={dealt(0.55)}>
          {/* One slot, three identities: the key first where there is none — nothing below it
              can be played without one — then Continue with a playthrough on disk, Quickstart
              without. */}
          {!writerOk ? (
            <motion.button
              id="menu-api-key"
              className="vu-btn vu-btn--primary vu-paper"
              variants={dealtItem}
              {...gestures(false, lift, press)}
              onClick={() => setView('apiKey')}
            >
              Set up API key
            </motion.button>
          ) : newest ? (
            <motion.button
              id="menu-continue"
              className="vu-btn vu-btn--primary vu-paper"
              variants={continueDead ? dealtItemDead : dealtItem}
              {...gestures(continueDead, lift, press)}
              disabled={continueDead}
              onClick={() => setResuming(continueNewest())}
            >
              Continue
              <span className="vu-btn-sub">
                {newest.enrolling ? 'class registration' : whereYouLeftOff(newest.date)}
              </span>
            </motion.button>
          ) : (
            <motion.button
              id="menu-quickstart"
              className="vu-btn vu-btn--primary vu-paper"
              variants={dealtItem}
              {...gestures(false, lift, press)}
              onClick={() => {
                // The screen is covered first and the view swapped underneath it; the canned
                // semester and the roster it names are read by the view behind the curtain,
                // which owns the crossing's end — the same shape as the other two ways into
                // a game.
                beginCrossing(() => setView('quickstart'))
              }}
            >
              Quickstart
            </motion.button>
          )}
          <motion.button
            id="menu-new-game"
            className="vu-btn vu-btn--outline vu-paper"
            variants={playDead ? dealtItemDead : dealtItem}
            {...gestures(playDead, lift, press)}
            disabled={playDead}
            onClick={() => setView('newGame')}
          >
            New Game
          </motion.button>
          <motion.button
            id="menu-load-game"
            className="vu-btn vu-btn--outline vu-paper"
            variants={loadDead ? dealtItemDead : dealtItem}
            {...gestures(loadDead, lift, press)}
            disabled={loadDead}
            onClick={() => openModal('loadGame')}
          >
            Load Game
          </motion.button>
          <motion.button
            id="menu-manage-characters"
            className="vu-btn vu-btn--outline vu-paper"
            variants={dealtItem}
            {...gestures(false, lift, press)}
            // Ungated: managing existing characters needs no install.
            onClick={() => setView('manageCharacters')}
          >
            Manage Characters
          </motion.button>
        </motion.nav>

        <hr className="vu-menu-rule" />

        <motion.nav className="vu-menu-admin vu-fan" variants={dealt(0.8, 0.045)}>
          <motion.button
            id="menu-settings"
            className="vu-btn vu-btn--quiet"
            variants={dealtItem}
            {...gestures(false, quietLift, quietPress)}
            onClick={() => openModal('settings')}
          >
            Settings
          </motion.button>
          {/* Ungated and last. */}
          <motion.button
            id="menu-credits"
            className="vu-btn vu-btn--quiet"
            variants={dealtItem}
            {...gestures(false, quietLift, quietPress)}
            onClick={() => openModal('credits')}
          >
            Credits
          </motion.button>
          {/* The window is the app: closing the last one quits. */}
          {!webBuild && (
            <motion.button
              id="menu-quit"
              className="vu-btn vu-btn--quiet"
              variants={dealtItem}
              {...gestures(false, quietLift, quietPress)}
              onClick={() => window.close()}
            >
              Quit game
            </motion.button>
          )}
        </motion.nav>

        <motion.div className="vu-menu-footer" variants={fadeIn(0.95)}>
          {!webBuild && (comfyDeferred || !comfyInstalled) && (
            <button className="vu-menu-setup" onClick={() => setView('setup')}>
              Image generation isn&apos;t installed — open Setup
            </button>
          )}
          <span className="vu-menu-version">{versionLine(__APP_VERSION__)}</span>
        </motion.div>
      </motion.aside>

      <motion.nav
        className="vu-menu-links"
        variants={fadeIn(1.05)}
        initial="hidden"
        animate="shown"
      >
        {LINKS.map((link) => (
          <motion.a
            key={link.id}
            className="vu-chip vu-paper"
            href={link.url}
            target="_blank"
            rel="noreferrer"
            {...gestures(false, chipLift, chipPress)}
          >
            <LinkIcon id={link.id} />
            {link.label}
          </motion.a>
        ))}
        {/* The two chips that stay in the app: each opens a modal rather than a page. */}
        <motion.button
          id="menu-support"
          className="vu-chip vu-paper"
          type="button"
          {...gestures(false, chipLift, chipPress)}
          onClick={() => openModal('support')}
        >
          <HeartIcon className="vu-menu-heart" strokeWidth={3} />
          Support Development
        </motion.button>
        <motion.button
          id="menu-feedback"
          className="vu-chip vu-paper"
          type="button"
          {...gestures(false, chipLift, chipPress)}
          onClick={() => openModal('feedback')}
        >
          <LinkIcon id="feedback" />
          Feedback
        </motion.button>
      </motion.nav>
    </div>
  )
}

/** Where the newest playthrough stands, in the bookkeeping voice: `wk2 · tue jan 27`. */
function whereYouLeftOff(date: number): string {
  const week = Math.floor(date / 7) + 1
  return `wk${week} · ${formatWeekday(date).slice(0, 3)} ${formatShortGameDate(date)}`.toLowerCase()
}

/** The two chip marks, drawn in `currentColor` so one rule tints them. */
function LinkIcon({ id }: { id: LinkId }): JSX.Element {
  if (id === 'social') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <path d="M4 4l16 16" />
        <path d="M20 4 4 20" />
      </svg>
    )
  }
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="3" />
      <path d="m2 7 10 7L22 7" />
    </svg>
  )
}
