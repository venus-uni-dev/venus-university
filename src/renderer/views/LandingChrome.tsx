/**
 * The decision landing: the hour between two scenes. It owns both halves of a slot's opening —
 * the narration box and the landing that follows it — so the same component times the swap
 * between them. It reads no store: the Game View owns every gate.
 */
import { useEffect, useRef, useState, type CSSProperties, type JSX, type ReactNode } from 'react'
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react'

import { STAT_KEYS, STAT_LABELS, type PlayerStats } from '@shared/playerStats'
import { formatNumericGameDate, formatWeekday } from '../prompts/gameDate'
import type { RevealKey } from '../prompts/introScript'
import { weekOf } from '../prompts/occasions'
import type { TextMark } from '@shared/types'
import type { Weather } from '@shared/weather'
import type { SlotAction, SlotActionTone } from '../stores/slotActions'
import type { ScreenTheme } from './clockTheme'
import { useAudioStore } from '../stores/audioStore'
import { MoneyCard } from '../components/MoneyCard'
import { StatRadar } from '../components/StatRadar'
import { DialogueBox, TurnField } from './Dialogue'
import {
  BunnyIcon,
  CalendarIcon,
  ChevronIcon,
  HalfMarkIcon,
  halfMarkKindOf,
  LogIcon,
  MapIcon,
  ShopIcon,
  SlidersIcon
} from './screenIcons'
import {
  badgeBounce,
  BOARD_RING_AFTER_MS,
  BOARD_SHAKE,
  BOARD_SHAKE_TURNS,
  gestures,
  landingAccent,
  landingAccentLate,
  landingApp,
  landingApps,
  landingBadges,
  landingBanner,
  landingBannerInk,
  landingBlob,
  landingGo,
  landingGrow,
  landingHead,
  landingLayer,
  landingRow,
  landingRows,
  landingTitle,
  landingWell,
  LANDING_AFTER_BOX_MS,
  lift,
  markStill,
  press,
  quietLift,
  quietPress,
  rowBounceFor,
  rowStill,
  sceneRow,
  spin,
  statBadgeIn,
  stampSpinDay,
  stampSwayNight
} from './motion'
import '../vu_styles/Landing.css'

/**
 * The question the landing asks, drawn as its own title rather than typed out character by
 * character — a question the screen is already asking by existing needs no reveal.
 */
const ASK = 'What would you like to do?'

/* ---- what a suggestion is -------------------------------------------------- */

/**
 * Which claim on the hour a button is offering, and the word for it. **Five tones and three
 * words**: a project's work is coursework, so it takes the class colour and says which kind of
 * coursework it is; an idle suggestion is no claim at all and is drawn quiet instead.
 */
const CATEGORY: Record<SlotActionTone, { word: string; mod: string } | null> = {
  plan: { word: 'PLANS', mod: 'plans' },
  class: { word: 'CLASS', mod: 'class' },
  shift: { word: 'WORK', mod: 'work' },
  project: { word: 'PROJECT', mod: 'class' },
  idle: null
}

/**
 * One row in the question column: a slot action plus the goodbye menu's own needs — the face
 * of the girl the row says goodbye to, a chip word for when the tone's own word is wrong, and
 * whether the row is set off from the ones above it by a gap: the way out, after the goodbyes.
 */
export type LandingRow = SlotAction & { faceUrl?: string; word?: string; apart?: boolean }

/**
 * How long a column has to be before it stops growing upward and starts scrolling. The goodbye
 * menu can be thirteen rows; an ordinary slot is never more than six.
 */
const LONG_ASK = 8

export interface LandingChromeProps {
  /** The slot's own half of the day, not the hour the screen is being read at. */
  theme: ScreenTheme
  date: number
  night: boolean
  /** The sky over the slot, which the banner's mark is drawn as wherever it is not clear. */
  weather: Weather
  /** The goodbye menu: the banner says no date and the column takes no turn. */
  epilogue: boolean
  /** A crossing is over the screen: nothing arrives, and the whole opening replays on the reveal. */
  covered: boolean
  /** The reader has cleared the chrome off the stage. */
  hidden: boolean
  /** The turn is the player's: the narration box goes, and the landing arrives in its place. */
  held: boolean
  /** The turn is out and the reply is not back: the landing stands, and Go reports the wait. */
  sending: boolean

  /* The opening narration, while the turn is not yet his. */
  text: string
  /** Runs of that line drawn in a colour of their own — a status message's. */
  marks?: readonly TextMark[]
  revealed: number
  fullyRevealed: boolean
  boxWaiting: boolean
  onTypeHold: (held: boolean) => void
  skips: number

  /* What he has. */
  money: number
  stats: PlayerStats

  /* What he may do about it. */
  actions: readonly LandingRow[]
  onSlotAction: (index: number) => void
  /**
   * Which row's call is out, if any. Its chevron turns into a ring for as long as it is —
   * the wait's only report on a screen that draws no Go.
   */
  busyKey?: string
  action: string
  onAction: (value: string) => void
  onSubmit: () => void
  submitDead: boolean
  inputDead: boolean
  /** Nothing stands in front of the screen, so the well may hold the caret. */
  inputFocus: boolean
  /**
   * The turn is on screen. **The whole row and not a dead one**: the epilogue answers its menu
   * and nothing else, and a box the screen will not honour is a control it is offering in bad
   * faith.
   */
  turnShown: boolean

  /* The apps, and the two controls in the corner. */
  /**
   * Which of the screen's own controls this kind of screen hands over. The two tiles
   * and the log are drawn only where their key is in it; the gear never is, the way out having to
   * be reachable from wherever the reader is stuck.
   */
  shown: ReadonlySet<RevealKey>
  calendarBadge: number
  bunnyboardBadge: number
  /** Some of that count arrived since the phone was last rung for, rather than merely being unread. */
  boardAlert: boolean
  /** The ring has been given: the caller marks the count as one the landing has already told him about. */
  onBoardAlerted: () => void
  bunnymapUnlocked: boolean
  bunnyshopUnlocked: boolean
  onCalendar: () => void
  onBunnyboard: () => void
  onShop: () => void
  onMap: () => void
  onChatLog: () => void
  onSettings: () => void
  /**
   * What a click on the dialogue box does, where one would do anything at all — handed down to
   * the box, which is the only part of the screen that wears the hand for it.
   */
  onAdvance?: () => void
}

export function LandingChrome(props: LandingChromeProps): JSX.Element {
  const { theme, date, night, weather, covered, hidden, held, sending, stats, actions, shown } =
    props
  // What the banner wears where the sun or the crescent would be.
  const markKind = halfMarkKindOf(weather, night)

  /**
   * The landing is what the screen is for now: the turn is his, or it is out and the reply has not
   * come back. **The send window keeps it up** rather than handing the box back for a wait that
   * has nothing to say — the scene's own chrome arrives on the scene's first line.
   */
  const wants = held || sending

  /**
   * Whether a narration box was on screen when the turn was handed over. Read in render while the
   * box is still the thing being drawn, so the frame the turn lands on already knows whether
   * anything has to leave first — a save resumed at its decision point has nothing to wait for.
   */
  const hadBox = useRef(false)
  if (!wants) hadBox.current = Boolean(props.text) || props.boxWaiting

  /**
   * The landing has arrived. **A duration and not a completion**: what it waits out is a sibling
   * leaving, and the box reports its exit to nobody. Under a cover it is put back, so the reveal
   * plays the whole arrival exactly as a slot's first frame does.
   */
  const [arrived, setArrived] = useState(false)

  /**
   * The reader is reaching for one of the answers, which stands the wave down ({@link rowStill}).
   * **Raised by the rows themselves and by nothing else** — it's about the button under his hand,
   * not the screen being touched, so the apps, the log and the gear move nothing he is aiming at.
   */
  const [reaching, setReaching] = useState(false)

  useEffect(() => {
    if (covered) {
      setArrived(false)
      // Nothing under a curtain is being reached for, and no boundary is reported for a pointer
      // the cover arrived under — a hover held in React outlives what it named otherwise.
      setReaching(false)
      // A box that left under the curtain is a box the reveal has nothing to wait out. A cover
      // lifting onto a landing already wanted — the goodbye menu is raised under its own — would
      // otherwise sit through the wait for a sibling that is long gone.
      hadBox.current = false
      return
    }
    if (!wants || arrived) return
    if (!hadBox.current) {
      setArrived(true)
      return
    }
    const timer = setTimeout(() => setArrived(true), LANDING_AFTER_BOX_MS)
    return () => clearTimeout(timer)
  }, [wants, covered, arrived])

  /** How many times the phone has been rung, which is what the tile's own shake is bumped by. */
  const [shake, setShake] = useState(0)
  // Held in refs and re-pointed every render, so a caller handing down a fresh handler each
  // render never re-runs an effect that fires on the arrival edge alone.
  const alertRef = useRef(props.boardAlert)
  alertRef.current = props.boardAlert
  const onAlertedRef = useRef(props.onBoardAlerted)
  onAlertedRef.current = props.onBoardAlerted

  // A landing arriving with news on the phone rings it once, decided on the arrival edge and
  // given when the tile has been dealt — a duration rather than a completion, the deck reporting
  // its deal to nobody. A cover coming back before then takes the ring with it.
  useEffect(() => {
    if (!arrived || !alertRef.current) return
    const timer = setTimeout(() => {
      useAudioStore.getState().play('text_in')
      setShake((n) => n + 1)
    }, BOARD_RING_AFTER_MS)
    return () => clearTimeout(timer)
  }, [arrived])

  // Whatever the count comes to while the landing stands has been shown, so the next arrival
  // rings only for what lands after it: a text landing mid-landing rings on its own and shakes
  // nothing. Runs after the ring above has read the alert, so it cannot un-decide it.
  useEffect(() => {
    if (arrived) onAlertedRef.current()
  }, [arrived, props.bunnyboardBadge])

  const label = arrived ? 'shown' : 'hidden'
  const weekday = formatWeekday(date)

  return (
    <motion.div
      className="vu-landing"
      data-theme={theme}
      variants={landingLayer}
      initial={false}
      animate={hidden ? 'hidden' : 'shown'}
      inert={hidden || undefined}
    >
      {/* The two archways, breathing against each other. The box carries both the fade and the
          breath, on their own clocks, which is what one element gets one `animate` allows. */}
      <motion.div
        className="vu-landing-accent vu-landing-accent--left"
        variants={landingAccent}
        initial="hidden"
        animate={label}
      >
        <span className="vu-landing-arch" />
      </motion.div>
      <motion.div
        className="vu-landing-accent vu-landing-accent--right"
        variants={landingAccentLate}
        initial="hidden"
        animate={label}
      >
        <span className="vu-landing-arch" />
      </motion.div>

      {/* The hour: the surface wipes in, and what is written on it is read once it has. */}
      <div className="vu-landing-banner">
        <motion.span
          className="vu-landing-bannerface vu-paper"
          variants={landingBanner}
          initial="hidden"
          animate={label}
        />
        <motion.div
          className="vu-landing-bannerink"
          variants={landingBannerInk}
          initial="hidden"
          animate={label}
        >
          <span className="vu-landing-mark">
            {/* Two elements because they are two transforms: the badge holds its place and the
                mark inside it carries the idle — the scene stamp's own arrangement, a wet sky's
                mark standing still and stepping inside its own drawing. */}
            <motion.span
              className="vu-landing-turn"
              key={markKind}
              animate={
                markKind === 'sun' ? stampSpinDay : markKind === 'moon' ? stampSwayNight : markStill
              }
              aria-hidden="true"
            >
              <HalfMarkIcon kind={markKind} strokeWidth={2.4} />
            </motion.span>
          </span>
          <div>
            <div className="vu-landing-date">
              {props.epilogue ? (
                'Someday, sometime...'
              ) : (
                <>
                  {weekday} {formatNumericGameDate(date)} · {night ? 'Evening' : 'Morning'}
                </>
              )}
            </div>
            {/* The calendar is anchored in January and ends at graduation in May, so the term it
                names is a fact about the shipped semester rather than a label invented here. The
                goodbyes stand in the week after graduation's, which is the summer. */}
            <div className="vu-landing-meta">
              {props.epilogue
                ? `WEEK ${weekOf(date) + 2} · SUMMER VACATION`
                : `WEEK ${weekOf(date) + 1} · SPRING SEMESTER`}
            </div>
          </div>
        </motion.div>
      </div>

      {/* What he has: the three readings as one shape, and the balance on a card tucked against
          the sheet's left edge. Both arrive together — it is one glance. */}
      <motion.div
        className="vu-landing-stats vu-paper"
        variants={landingHead}
        initial="hidden"
        animate={label}
      >
        {/* The card is `components/MoneyCard.tsx`'s; this screen says only where it hangs. It
            reports an hour rather than a change, so it counts nothing. */}
        <MoneyCard amount={props.money} className="vu-landing-money" />

        {/* The shape and its badges (`components/StatRadar.tsx`). It names no variant label of
            its own: it takes this panel's, which is what lets the same chart arrive inside a
            landing's opening and inside a modal's. The landing reports an hour rather than a
            change, so it hands in one reading and the shape simply grows into it. */}
        <StatRadar
          className="vu-landing-radar"
          stats={stats}
          arrival={{
            grow: landingGrow,
            badges: landingBadges,
            badge: statBadgeIn,
            badgeRaised: statBadgeIn
          }}
        />
      </motion.div>

      {/* The apps. **Bunnyboard and Calendar are the bottom row** because they are there from the
          first slot; the two BunnyBot hands over are absent until he has, so the pair below them
          never moves. Each names its own seat on the grid rather than taking the next cell going,
          which is what holds that promise when only one of the two has been handed over. */}
      <motion.div
        className="vu-landing-apps"
        variants={landingApps}
        initial="hidden"
        animate={label}
      >
        {props.bunnyshopUnlocked && (
          <AppButton seat="shop" label="BunnyShop" onClick={props.onShop}>
            <ShopIcon />
          </AppButton>
        )}
        {props.bunnymapUnlocked && (
          <AppButton seat="map" label="BunnyMap" onClick={props.onMap}>
            <MapIcon />
          </AppButton>
        )}
        {shown.has('bunnyboard') && (
          <AppButton
            seat="board"
            label="Bunnyboard"
            badge={props.bunnyboardBadge}
            shake={shake}
            onClick={props.onBunnyboard}
          >
            <BunnyIcon />
          </AppButton>
        )}
        {shown.has('calendar') && (
          <AppButton
            seat="calendar"
            label="Calendar"
            badge={props.calendarBadge}
            onClick={props.onCalendar}
          >
            <CalendarIcon />
          </AppButton>
        )}
      </motion.div>

      {/* The question, and what the hour already has in it. A column too long to grow upward off
          the turn — the epilogue's thirteen goodbyes — takes a definite height and scrolls. */}
      <div
        className={
          actions.length >= LONG_ASK ? 'vu-landing-ask vu-landing-ask--long' : 'vu-landing-ask'
        }
      >
        <motion.h1 className="vu-landing-title" variants={landingTitle} initial="hidden" animate={label}>
          <motion.span
            className="vu-landing-blob"
            variants={landingBlob}
            initial="hidden"
            animate={label}
            aria-hidden="true"
          />
          {ASK}
        </motion.h1>

        <motion.div
          className="vu-landing-list"
          variants={landingRows}
          initial="hidden"
          animate={label}
        >
          {actions.map((slotAction, index) => (
            <motion.div
              key={slotAction.key}
              className={
                slotAction.apart ? 'vu-landing-slot vu-landing-slot--apart' : 'vu-landing-slot'
              }
              variants={landingRow}
            >
              {/* The wave: one bounce per row, each a beat behind the one above it, and still
                  for as long as the reader is reaching for one of them. It rides a wrapper of
                  its own because the deal above it and the gesture below it are both
                  transforms, and one element gets one writer. */}
              <motion.div
                className="vu-landing-bounce"
                animate={arrived ? (reaching ? rowStill : rowBounceFor(index)) : undefined}
              >
                <SlotButton
                  action={slotAction}
                  dead={!held}
                  busy={props.busyKey === slotAction.key}
                  onReach={setReaching}
                  onClick={() => props.onSlotAction(index)}
                />
              </motion.div>
            </motion.div>
          ))}
        </motion.div>
      </div>

      {/* The turn, two thirds of the stage and anchored where the question was asked. Absent
          where the screen takes no sentence — the epilogue answers its own menu. */}
      {props.turnShown && (
        <motion.div
          className="vu-turn vu-landing-row"
          variants={sceneRow}
          initial="hidden"
          animate={arrived && !covered ? 'shown' : 'hidden'}
          inert={arrived && !covered ? undefined : true}
        >
          <TurnField
            action={props.action}
            onAction={props.onAction}
            onSubmit={props.onSubmit}
            sending={props.sending}
            submitDead={props.submitDead}
            inputDead={props.inputDead}
            focus={arrived && !covered && props.inputFocus}
            placeholder="Something else?"
            wellMotion={{ variants: landingWell, initial: 'hidden', animate: label }}
            goMotion={{ variants: landingGo, initial: 'hidden', animate: label }}
          />
        </motion.div>
      )}

      {/* The way back and the way out, in the corner the row leaves empty. */}
      <motion.div
        className="vu-landing-tools"
        variants={landingApps}
        initial="hidden"
        animate={label}
      >
        {shown.has('chatlog') && (
          <motion.button
            className="vu-landing-tool"
            variants={landingApp}
            aria-label="Chat log"
            {...gestures(false, quietLift, quietPress)}
            onClick={props.onChatLog}
          >
            <LogIcon />
            LOG
          </motion.button>
        )}
        {/* Never gated: the way out must be reachable from wherever the reader is stuck. */}
        <motion.button
          className="vu-landing-tool"
          variants={landingApp}
          aria-label="Settings"
          {...gestures(false, quietLift, quietPress)}
          onClick={props.onSettings}
        >
          <SlidersIcon />
        </motion.button>
      </motion.div>

      {/* The slot's opening, in the box a scene speaks through. It is the only thing on screen
          while it plays — the landing arrives once it has wiped off, which is what the hold above
          waits out. */}
      <DialogueBox
        ready={!covered}
        covered={covered}
        text={wants ? '' : props.text}
        marks={props.marks}
        revealed={props.revealed}
        fullyRevealed={props.fullyRevealed}
        boxWaiting={wants ? false : props.boxWaiting}
        sending={false}
        onTypeHold={props.onTypeHold}
        skips={props.skips}
        rowShown={false}
        onAdvance={props.onAdvance}
      />
    </motion.div>
  )
}

/** One app: its mark over its word, its count on the corner, and the corner's own bounce. */
function AppButton({
  seat,
  label,
  badge,
  shake,
  onClick,
  children
}: {
  /** Which cell of the cluster is this app's, whatever else is on screen beside it. */
  seat: 'shop' | 'map' | 'board' | 'calendar'
  label: string
  badge?: number
  /** Bumped to turn the tile once for news. Absent on an app with nothing to announce. */
  shake?: number
  onClick: () => void
  children: ReactNode
}): JSX.Element {
  /**
   * The turn rides the tile itself rather than a wrapper of its own: nothing else on the tile
   * writes `rotate`, the deal and the gesture both being a `transform`, and the CSS lean the tile
   * is drawn at is the independent property underneath both.
   */
  const turn = useMotionValue(0)
  const still = useReducedMotion()

  // Imperative, so `MotionConfig`'s reduced motion cannot reach it — that reaches animated props
  // alone — which is why the branch is written here, `MoneyCard`'s arrangement.
  useEffect(() => {
    if (!shake || still) return
    const run = animate(turn, BOARD_SHAKE_TURNS, BOARD_SHAKE)
    return () => run.stop()
  }, [shake, still, turn])

  return (
    <motion.button
      className={`vu-tile vu-landing-app vu-landing-app--${seat} vu-paper`}
      variants={landingApp}
      style={{ rotate: turn }}
      aria-label={label}
      {...gestures(false, lift, press)}
      onClick={onClick}
    >
      {children}
      {label}
      {badge !== undefined && badge > 0 && (
        <motion.span className="vu-tile-badge" animate={badgeBounce}>
          {badge}
        </motion.span>
      )}
    </motion.button>
  )
}

/**
 * One thing the hour already has in it, or one place he could go instead. **The button's words
 * are the action it submits** — the row may trim them on screen but must never rewrite them,
 * which is why a suggestion's stat is styled in place rather than pulled into its own label.
 */
function SlotButton({
  action,
  dead,
  busy,
  onReach,
  onClick
}: {
  action: LandingRow
  /** The turn is not the player's — it is out on a call, or a line is still playing. */
  dead: boolean
  /** This row's own call is the one that is out. */
  busy: boolean
  /** The pointer is on this row, which stands the whole wave down ({@link rowStill}). */
  onReach: (reaching: boolean) => void
  onClick: () => void
}): JSX.Element {
  const category = CATEGORY[action.tone]

  /**
   * **DOM boundary events rather than motion's own hover.** Chrome fires `pointerenter` on a
   * disabled button and withholds only `click`, but motion's `whileHover` won't register there —
   * so a row that goes dead under the pointer would leave the wave stuck down for good.
   */
  const reach = {
    onPointerEnter: () => onReach(true),
    onPointerLeave: () => onReach(false)
  }

  if (!category) {
    return (
      <motion.button
        className="vu-landing-idle"
        disabled={dead}
        {...gestures(dead, quietLift, quietPress)}
        {...reach}
        onClick={onClick}
      >
        <IdleWords text={action.text} />
      </motion.button>
    )
  }

  return (
    <motion.button
      className={`vu-landing-do vu-landing-do--${category.mod} vu-paper`}
      disabled={dead}
      {...gestures(dead, lift, press)}
      {...reach}
      onClick={onClick}
    >
      {/* Whoever the row is about, where it is about somebody: a face in a list is quiet and is
          drawn before the chip that names the kind of row it is. */}
      {action.faceUrl && (
        <span className="vu-arch vu-landing-face">
          <span className="vu-crop">
            <img className="vu-crop-img" src={action.faceUrl} alt="" />
          </span>
        </span>
      )}
      <span className="vu-landing-kind">{action.word ?? category.word}</span>
      <span className="vu-landing-doword">{action.text}</span>
      {/* The row's own wait, in the mark's place. On a screen with no Go this is the only report
          there is that the call went out, and the word beside it is the row's own. */}
      {busy ? <motion.span className="vu-ring" animate={spin} /> : <ChevronIcon />}
    </motion.button>
  )
}

/** A suggestion with the stat it exercises drawn in that stat's own hue. */
function IdleWords({ text }: { text: string }): JSX.Element {
  const key = STAT_KEYS.find((stat) => text.includes(STAT_LABELS[stat]))
  if (!key) return <>{text}</>
  const at = text.indexOf(STAT_LABELS[key])
  return (
    <>
      {text.slice(0, at)}
      <b style={{ '--stat': `var(--vu-stat-${key})` } as CSSProperties}>{STAT_LABELS[key]}</b>
      {text.slice(at + STAT_LABELS[key].length)}
    </>
  )
}
