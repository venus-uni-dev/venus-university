/**
 * The scene view's chrome: what the Game View wears while a scene is on screen. Reads no
 * store — everything it draws is handed to it; the Game View owns the gates, this owns the
 * arrival, the wipe and the way out.
 */
import { useEffect, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'

import type { QuizAnswer, QuizLetter } from '@shared/academics'
import type { TextMark } from '@shared/types'
import type { Weather } from '@shared/weather'
import { formatNumericGameDate, formatWeekday } from '../prompts/gameDate'
import { weekOf } from '../prompts/occasions'
import type { RevealKey } from '../prompts/introScript'
import type { ScreenTheme } from './clockTheme'
import {
  BunnyIcon,
  CalendarIcon,
  EyeIcon,
  HalfMarkIcon,
  halfMarkKindOf,
  LogIcon,
  SlidersIcon
} from './screenIcons'
import { DeadNote } from '../components/DeadNote'
import { MoneyCard } from '../components/MoneyCard'
import { DialogueBox, TurnField } from './Dialogue'
import {
  boxChipLift,
  chipIn,
  gestures,
  helpMark,
  lift,
  markStill,
  moneyIn,
  noteIn,
  press,
  quietLift,
  quietPress,
  sceneDivider,
  sceneFade,
  sceneHide,
  sceneRow,
  seat,
  stampIn,
  stampSpinDay,
  stampSwayNight,
  wellMark
} from './motion'
import '../vu_styles/Scene.css'

export interface SceneChromeProps {
  /** The slot's own half of the day, not the hour the screen is being read at. */
  theme: ScreenTheme
  date: number
  night: boolean
  /** The sky over the slot, which the stamp's mark is drawn as wherever it is not clear. */
  weather: Weather
  /** A crossing is over the screen: everything is held down and the arrival replays on the reveal. */
  covered: boolean
  /** The reader has cleared the chrome off the stage with the eye. */
  hidden: boolean
  /** Which pieces the opening has handed back. */
  shown: ReadonlySet<RevealKey>
  /**
   * The balance either side of the line on screen, where that line is the one reporting a change
   * — null on every other line, which is what sets the card counting.
   */
  money: { from: number; to: number } | null
  speakerName: string
  speakerCharId: string | undefined
  speakerVersion: number
  text: string
  /** Runs of that line drawn in a colour of their own — a status message's. */
  marks?: readonly TextMark[]
  revealed: number
  fullyRevealed: boolean
  /** The box is parked on a line that has not been written yet. */
  boxWaiting: boolean
  /** The player's turn is out and the reply is not back. */
  sending: boolean
  /** A CG is on the stage: the box and the well step back off the picture they are over. */
  cg: boolean
  /** Raised while the box is arriving, so the line does not type behind its own entrance. */
  onTypeHold: (held: boolean) => void
  /** Bumped by a click during that arrival: the box lands at once rather than losing a line. */
  skips: number
  rowShown: boolean
  /**
   * The row is standing over a reply still being read rather than for the player's turn: the
   * divider stands in the well's place, and the well answers a hover — `'open'` — or nothing at
   * all while the scene will not be interrupted — `'locked'`. Null for the turn's own row.
   */
  interject: 'open' | 'locked' | null
  /** The current question's answers while an exam is being sat, which the row stands in for. */
  quiz: readonly QuizAnswer[] | null
  action: string
  onAction: (value: string) => void
  onSubmit: () => void
  /** Sends what the well holds over the lines still to come. */
  onInterject: () => void
  /** Steps back a line, handed in only while one may be stepped back to. */
  onRewind?: () => void
  /** Bumped by every rewind, which the box lands at once on. */
  cuts: number
  onQuiz: (letter: QuizLetter) => void
  submitDead: boolean
  inputDead: boolean
  /** Nothing stands in front of the screen, so the well may hold the caret. */
  inputFocus: boolean
  giftShown: boolean
  giftUnlocked: boolean
  giftDead: boolean
  /** A gift has already gone out this scene — the one dead reason a hover names. */
  giftSpent: boolean
  onGift: () => void
  calendarBadge: number
  bunnyboardBadge: number
  railDead: boolean
  onCalendar: () => void
  onBunnyboard: () => void
  onSettings: () => void
  onHideUi: () => void
  onBackground: () => void
  onCast: () => void
  onChatLog: () => void
  /**
   * What a click on the dialogue box does, where one would do anything at all — handed down to
   * the box, which is the only part of the screen that wears the hand for it.
   */
  onAdvance?: () => void
}

/** The scene's chrome: the stamp, the rail, the box and the row under it. */
export function SceneChrome(props: SceneChromeProps): JSX.Element {
  const { theme, date, night, weather, covered, hidden, shown, rowShown, quiz, interject } = props
  // What the stamp wears where the sun or the crescent would be.
  const markKind = halfMarkKindOf(weather, night)

  /** What the whole layer answers to: the curtain and the eye each take it away entire. */
  const dark = covered || hidden

  /** The row is up and answering: what every hover in it is dropped against. */
  const rowLive = rowShown && !dark

  /**
   * The pointer has moved over the divider's strip, or is on the well's box or Go's seat once the
   * well is out, and the well has the caret — either one holds the well out over the divider while
   * a reply is being read. The row goes inert with the pointer still on it and reports no
   * boundary, so the hover is dropped with the row.
   */
  const [hover, setHover] = useState(false)
  const [pinned, setPinned] = useState(false)
  useEffect(() => {
    if (!rowLive) setHover(false)
  }, [rowLive])

  // A reply starting to be read finds the well put down whatever the pointer is over: the caret a
  // sent turn left in it would otherwise keep Enter from turning the lines, `pinned` can be stale
  // because a focused field the turn disables fires no blur, and a hover the pointer never left
  // must not hold the well out over the reply. Mid-reply the well comes back on a move over the
  // divider and takes the caret only on a click.
  const interjecting = interject !== null
  useLayoutEffect(() => {
    if (!interjecting) return
    setHover(false)
    setPinned(false)
    const active = document.activeElement
    if (active instanceof HTMLElement && active.id === 'game-action') active.blur()
  }, [interjecting])

  // A dead well holds no caret.
  useEffect(() => {
    if (props.inputDead) setPinned(false)
  }, [props.inputDead])

  /** The well is out: always on the turn's own row, and mid-reply only while held open. */
  const wellOut = interject === null || (interject === 'open' && (hover || pinned))

  /** Which word the divider last said, held while it fades so it does not change on the way out. */
  const dividerLocked = useRef(false)
  if (interject !== null) dividerLocked.current = interject === 'locked'

  /**
   * The stamp landing is what lets the box come in — a completion rather than a timer, so the two
   * can never drift. **Lowered again under a cover**, so the reveal replays the stamp's jump and
   * the box waits it out again on the way back.
   */
  const [stampLanded, setStampLanded] = useState(false)
  useEffect(() => {
    if (covered) setStampLanded(false)
  }, [covered])

  /**
   * The balance card, outliving the line that raised it: frozen at the reading before until
   * released, then counts and is taken away by the count landing. **A newer change replaces it
   * where it stands** rather than queueing behind it.
   */
  const [card, setCard] = useState<{ from: number; to: number; released: boolean } | null>(null)
  const reported = props.money
  // The two readings are what the card is raised on rather than the object carrying them, so a
  // line re-rendered with the same pair leaves the card exactly where it is.
  useEffect(() => {
    if (!reported) return
    setCard({ from: reported.from, to: reported.to, released: false })
  }, [reported?.from, reported?.to])

  /**
   * What releases the count: the line moving on, or the curtain, which closes over a card the
   * reader never got to advance rather than leaving one to be found still frozen on the reveal.
   */
  const reporting = reported !== null
  useEffect(() => {
    if (reporting && !covered) return
    setCard((current) => (current && !current.released ? { ...current, released: true } : current))
  }, [reporting, covered])

  /**
   * The answers as the player last saw them standing. A click banks one and puts the next
   * question up while the row is on its way out, so what is drawn under that animation is the
   * paper he answered rather than the one waiting behind it.
   */
  const lastAnswers = useRef<readonly QuizAnswer[] | null>(null)
  if (rowShown && quiz) lastAnswers.current = quiz
  const answers = rowShown ? quiz : lastAnswers.current
  /** The stack is drawn in the row but the row is down: nothing is standing under the box. */
  const stackDown = answers !== null && !(rowShown && !dark)

  /**
   * `--turn-h` (`Scene.css`) is written through a ref, not React state, so a keystroke never
   * re-renders the chrome; a `ResizeObserver` catches the field's growth. Dropped while the
   * answers are down, so the box takes the one-line well's place instead.
   */
  const root = useRef<HTMLDivElement>(null)
  const row = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = row.current
    if (!box || typeof ResizeObserver === 'undefined') return
    const write = (): void => {
      if (stackDown) root.current?.style.removeProperty('--turn-h')
      else root.current?.style.setProperty('--turn-h', `${box.offsetHeight}px`)
    }
    write()
    const observer = new ResizeObserver(write)
    observer.observe(box)
    return () => observer.disconnect()
  }, [stackDown])

  return (
    <motion.div
      ref={root}
      className="vu-scene"
      data-theme={theme}
      variants={sceneHide}
      initial={false}
      animate={hidden ? 'hidden' : 'shown'}
      inert={hidden || undefined}
    >
      <motion.div
        className="vu-scene-wash"
        variants={sceneFade}
        initial="hidden"
        animate={dark ? 'hidden' : 'shown'}
      />

      {/* The stamp jumps in from under the bottom edge, and its landing is what starts the
          rest: a completion rather than a timer, so the two can never drift. */}
      <motion.div
        className="vu-scene-stamp vu-paper"
        variants={stampIn}
        initial="hidden"
        animate={dark ? 'hidden' : 'shown'}
        onAnimationComplete={(label) => {
          if (label === 'shown') setStampLanded(true)
        }}
      >
        <div className="vu-scene-week">
          WK
          <br />
          <span>{String(weekOf(date) + 1).padStart(2, '0')}</span>
        </div>
        <div className="vu-scene-figure">{formatNumericGameDate(date)}</div>
        <div className="vu-scene-weekday">{formatWeekday(date).slice(0, 3).toUpperCase()}</div>
        <div className={night ? 'vu-scene-half vu-scene-half--night' : 'vu-scene-half'}>
          <span>{night ? 'NIGHT' : 'DAY'}</span>
          {/* Two elements because they are two transforms: the stamp carries the jump and the
              mark inside it carries the idle. The sun turns and the crescent rocks; a wet sky's
              mark stands still and steps inside its own drawing, the key dropping a stale lean. */}
          <motion.span
            className="vu-scene-turn"
            key={markKind}
            animate={
              markKind === 'sun' ? stampSpinDay : markKind === 'moon' ? stampSwayNight : markStill
            }
            aria-hidden="true"
          >
            <HalfMarkIcon kind={markKind} className="vu-scene-mark" strokeWidth={2.75} />
          </motion.span>
        </div>
      </motion.div>

      {/* The balance, raised by the line that says it moved: it slides in off its own edge with
          the change already printed on it and stands frozen at the reading before, counts both
          readings to their ends when the reader advances that line, and leaves as the count
          lands. The eye is the one thing that takes it off the stage mid-count. It is the
          landing's card at the corner the landing keeps it near (`MoneyCard.css`). */}
      <AnimatePresence>
        {card && !hidden && (
          <motion.div
            className="vu-scene-money"
            variants={moneyIn}
            initial="hidden"
            animate="shown"
            exit="gone"
          >
            <MoneyCard
              amount={card.to}
              from={card.from}
              held={!card.released}
              onCounted={() => setCard(null)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="vu-scene-rail">
        <RailSeat
          label="Bunnyboard"
          badge={props.bunnyboardBadge}
          state={seatState(!dark && shown.has('bunnyboard'), props.railDead)}
          onClick={props.onBunnyboard}
        >
          <BunnyIcon />
        </RailSeat>
        <RailSeat
          label="Calendar"
          badge={props.calendarBadge}
          state={seatState(!dark && shown.has('calendar'), props.railDead)}
          onClick={props.onCalendar}
        >
          <CalendarIcon />
        </RailSeat>
        {/* Never gated: the way out must be reachable from wherever the reader is stuck. */}
        <RailSeat
          label="Settings"
          state={seatState(!dark && shown.has('settings'), false)}
          onClick={props.onSettings}
        >
          <SlidersIcon />
        </RailSeat>
      </div>

      {/* The box is the landing's box: the same object typing a scene's lines here and a slot's
          opening narration there, so it is a component rather than a shape drawn twice
          (`views/Dialogue.tsx`). What the scene adds is the chips on its shoulder. */}
      <DialogueBox
        ready={stampLanded}
        covered={covered}
        speakerName={props.speakerName}
        speakerCharId={props.speakerCharId}
        speakerVersion={props.speakerVersion}
        text={props.text}
        marks={props.marks}
        revealed={props.revealed}
        fullyRevealed={props.fullyRevealed}
        boxWaiting={props.boxWaiting}
        sending={props.sending}
        cg={props.cg}
        onTypeHold={props.onTypeHold}
        skips={props.skips}
        rowShown={rowShown}
        wellAway={rowShown && !wellOut}
        turnUp={rowShown && interject === null}
        onRewind={props.onRewind}
        cuts={props.cuts}
        onAdvance={props.onAdvance}
        chips={
          <>
            {shown.has('chatlog') && (
              <Chip label="LOG" onClick={props.onChatLog}>
                <LogIcon />
              </Chip>
            )}
            {shown.has('hideui') && (
              <Chip label="HIDE" onClick={props.onHideUi}>
                <EyeIcon size={15} ariaHidden />
              </Chip>
            )}
            {shown.has('cast') && (
              <Chip label="CHAR" onClick={props.onCast}>
                <CastIcon />
              </Chip>
            )}
            {shown.has('background') && (
              <Chip label="BG" onClick={props.onBackground}>
                <SceneryIcon />
              </Chip>
            )}
          </>
        }
      />

      {/* The turn, on the box's own gutters. `.vu-turn` is what a row is and `.vu-scene-row` is
          where this screen puts one; the exam's four answers stand in the same place. What the
          row says of its well is what decides which of its parts hear the pointer. */}
      <motion.div
        ref={row}
        className="vu-turn vu-scene-row"
        data-well={wellOut ? 'out' : interject === 'locked' ? 'locked' : 'away'}
        variants={sceneRow}
        initial="hidden"
        animate={rowShown && !dark ? 'shown' : 'hidden'}
        inert={rowShown && !dark ? undefined : true}
      >
        {answers ? (
          <div className="vu-scene-quiz">
            {answers.map(({ letter, text }) => (
              <motion.button
                key={letter}
                id={`game-quiz-${letter}`}
                className="vu-btn vu-btn--primary vu-btn--panel vu-paper vu-scene-quizbtn"
                disabled={props.inputDead}
                {...gestures(props.inputDead, lift, press)}
                onClick={() => props.onQuiz(letter)}
              >
                <span className="vu-scene-quizletter">{letter}</span>
                {text}
              </motion.button>
            ))}
          </div>
        ) : (
          <>
            <SceneTips live={rowLive} shown={wellOut} />
            <TurnField
              action={props.action}
              onAction={props.onAction}
              onSubmit={interject === null ? props.onSubmit : props.onInterject}
              sending={props.sending}
              cg={props.cg}
              submitDead={props.submitDead}
              inputDead={props.inputDead}
              focus={rowLive && props.inputFocus}
              placeholder="What do you do?"
              multiline
              revealed={wellOut}
              overlay={
                <SceneDivider
                  state={wellOut ? 'hidden' : interject === 'locked' ? 'dim' : 'shown'}
                  locked={dividerLocked.current}
                />
              }
              onHover={setHover}
              onFocus={() => setPinned(true)}
              onBlur={() => setPinned(false)}
            />
            {/* Mid-reply the row offers the well alone: a present is handed over on a turn. */}
            {props.giftShown && interject === null && (
              <motion.div
                className="vu-scene-gift"
                variants={seat}
                initial={false}
                animate={seatState(props.giftUnlocked, props.giftDead)}
              >
                {/* The Gift stays silent, so what a spent one is short of is said beside it. */}
                <DeadNote note={props.giftSpent ? 'Already gave one gift this scene.' : null}>
                  <span className="vu-scene-rule" />
                  <motion.button
                    id="game-gift"
                    className="vu-scene-giftbtn"
                    aria-label="Gift"
                    disabled={props.sending || props.giftDead}
                    {...gestures(props.sending || props.giftDead, quietLift, quietPress)}
                    onClick={props.onGift}
                  >
                    <GiftIcon />
                  </motion.button>
                </DeadNote>
              </motion.div>
            )}
          </>
        )}
      </motion.div>
    </motion.div>
  )
}

/**
 * Which of {@link seat}'s resting states a control is in. **A dead one lands at the dim itself**
 * rather than leaving it to `[data-theme] button:disabled`: motion writes `opacity` inline, and
 * an inline write beats the rule.
 */
function seatState(visible: boolean, dead: boolean): 'shown' | 'dim' | 'gone' {
  if (!visible) return 'gone'
  return dead ? 'dim' : 'shown'
}

/** One control on the rail: icon only, its count riding the corner. */
function RailSeat({
  label,
  badge,
  state,
  onClick,
  children
}: {
  label: string
  badge?: number
  state: 'shown' | 'dim' | 'gone'
  onClick: () => void
  children: ReactNode
}): JSX.Element {
  const dead = state !== 'shown'
  return (
    <motion.button
      className="vu-scene-seat vu-paper"
      aria-label={label}
      disabled={dead}
      variants={seat}
      initial="hidden"
      animate={state}
      inert={state === 'gone' ? true : undefined}
      {...gestures(dead, lift, press)}
      onClick={onClick}
    >
      {children}
      {badge !== undefined && badge > 0 && <span className="vu-scene-badge">{badge}</span>}
    </motion.button>
  )
}

/** What the tips card says about writing a turn, in the order it says it. */
const TIPS = [
  'Avoid short, passive replies or actions. Try asking questions of other people or taking the initiative.',
  'You can mix dialogue and action in one turn, like: "Yeah, I bet," I say, chuckling. I buy her a donut and hand it to her.',
  "If you're getting bored of the scene, mention going home or saying goodbye.",
  'You can click the arrow button to send a "Keep going" prompt if you don\'t know what to do.',
  'If there\'s a problem with the output, you can load the last autosave to retry your action.'
]

/**
 * The mark in the margin the date stamp keeps clear — a question mark over its caption — and the
 * card of tips a hover over it raises across the box. The seat hears the pointer and the mark
 * itself takes none, so the card — which takes none either — cannot end the hover that raised it.
 * The mark stands only with the well: the tips are about writing a turn.
 */
function SceneTips({ live, shown }: { live: boolean; shown: boolean }): JSX.Element {
  const [hover, setHover] = useState(false)
  // The row goes inert with the pointer still on the mark and reports no boundary for it, so the
  // hover is dropped with the row rather than found still standing when the turn comes back; a
  // mark put away with the well drops it the same way.
  useEffect(() => {
    if (!live || !shown) setHover(false)
  }, [live, shown])

  return (
    <motion.div
      className="vu-scene-help"
      variants={wellMark}
      initial={false}
      animate={shown ? 'shown' : 'hidden'}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <motion.span
        className="vu-scene-help-mark"
        variants={helpMark}
        initial={false}
        animate={hover ? 'hover' : 'rest'}
        aria-hidden="true"
      >
        <span className="vu-scene-help-glyph">?</span>
        <span className="vu-scene-help-word">TIPS</span>
      </motion.span>
      <AnimatePresence>
        {hover && (
          <motion.div
            key="tips"
            className="vu-scene-tips vu-paper"
            variants={noteIn}
            initial="hidden"
            animate="shown"
            exit="gone"
          >
            <div className="vu-scene-tips-title">Tips for scene actions</div>
            <ul className="vu-scene-tips-list">
              {TIPS.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/**
 * What stands in the well's place while a reply is being read: a rule either side of a state word
 * saying how to bring the well out, or that the class will not be interrupted yet. It is the row's
 * one hover target while the well is away (`Scene.css`), and the well's box it sits in hears the
 * move that swaps the two as the strip's events bubble up to it.
 */
function SceneDivider({
  state,
  locked
}: {
  state: 'shown' | 'dim' | 'hidden'
  locked: boolean
}): JSX.Element {
  return (
    <motion.div
      className="vu-scene-divider"
      variants={sceneDivider}
      initial={false}
      animate={state}
    >
      <span className="vu-scene-divider-rule" />
      <span className="vu-scene-divider-word">
        {locked ? 'CLASS IN SESSION' : 'HOVER TO SHOW ACTION BOX'}
      </span>
      <span className="vu-scene-divider-rule" />
    </motion.div>
  )
}

/** One of the four screen controls on the box's shoulder. */
function Chip({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <motion.button
      className="vu-box-chip"
      variants={chipIn}
      {...gestures(false, boxChipLift, quietPress)}
      onClick={onClick}
    >
      {children}
      {label}
    </motion.button>
  )
}

/* ---- the marks this screen alone wears ------------------------------------- */
/* The four the landing shares live in `screenIcons.tsx`; these three are the scene's own. */

function SceneryIcon(): JSX.Element {
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
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  )
}

function CastIcon(): JSX.Element {
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
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function GiftIcon(): JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13" />
      <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
      <path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5" />
    </svg>
  )
}
