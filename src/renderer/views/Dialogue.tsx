/**
 * The dialogue box and the turn under it, shared by a scene and the decision landing: the same
 * respawn, typewriter hold and way out on both screens, with only what surrounds it differing.
 * Neither reads a store; both are handed everything, exactly as `SceneChrome` is.
 */
import { useEffect, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { motion, type MotionProps } from 'motion/react'

import type { TextMark } from '@shared/types'
import { profileUrl } from '../stores/characterStore'
import { Burst } from '../components/Burst'
import { ChevronIcon } from './screenIcons'
import {
  boxRewind,
  boxWipe,
  chipRow,
  cursorOff,
  cursorOn,
  gestures,
  goBreath,
  hintNudge,
  lift,
  press,
  quietLift,
  quietPress,
  sceneBox,
  sceneBoxState,
  sceneHint,
  sceneText,
  speakerFace,
  speakerInk,
  speakerPill,
  spin,
  turnWell
} from './motion'
import '../vu_styles/Dialogue.css'

/** The box wearing nothing: a stage direction alone, or the gap between two scenes. */
const EMPTY = ''

/**
 * How far the box's arrival chain has got — each step cued by the one before it landing, the
 * exit being a single state instead. The label is two of those steps: face first, then name.
 */
type Arrival = 'held' | 'speaker' | 'name' | 'box' | 'chips' | 'shown' | 'leaving' | 'empty'

export interface DialogueBoxProps {
  /**
   * The screen is ready for the box to arrive. A scene waits for its date stamp to land — a
   * completion rather than a timer, so the two can never drift — and the landing's narration has
   * nothing to wait for and says so.
   */
  ready: boolean
  /** A crossing is over the screen: the box is held down and its arrival replays on the reveal. */
  covered: boolean
  speakerName?: string
  speakerCharId?: string | undefined
  speakerVersion?: number
  text: string
  /** Runs of this line drawn in a colour of their own — a stat's, or the money's. */
  marks?: readonly TextMark[]
  revealed: number
  fullyRevealed: boolean
  /** The box is parked on a line that has not been written yet. */
  boxWaiting: boolean
  /** The player's turn is out and the reply is not back. */
  sending: boolean
  /**
   * A CG is standing behind the box, so the box sits over the picture rather than over a
   * background. Narration boxes and endings never set it — they get the default background.
   */
  cg?: boolean
  /** Raised while the box is arriving, so the line does not type behind its own entrance. */
  onTypeHold: (held: boolean) => void
  /** Bumped by a click during that arrival: the box lands at once rather than losing a line. */
  skips: number
  /** There is a row under the box; without one the box drops into its place. */
  rowShown: boolean
  /**
   * The row under the box is up but its well is put away for the divider, so the box drops onto
   * the divider's strip. Defaults to false.
   */
  wellAway?: boolean
  /**
   * The row under the box is the player's own turn, which puts the forward mark away. Defaults to
   * `rowShown`; a row standing up over a reply still being read leaves the mark where it is.
   */
  turnUp?: boolean
  /** Steps back a line. The back mark is on screen exactly while this is handed in. */
  onRewind?: () => void
  /**
   * Bumped by every rewind. The render it changes in is a cut: a new dress is put up whole, every
   * layer at its settled state, rather than wiped in behind the old one leaving.
   */
  cuts?: number
  /** The screen controls on the box's shoulder, if the screen offers any. */
  chips?: ReactNode
  /**
   * What a click on the box does, when a click on it does anything. Presence vs. absence is what
   * makes the box clickable at all — the stage underneath still advances on a click regardless,
   * so this is the only prop that opts the box itself in.
   */
  onAdvance?: () => void
}

export function DialogueBox(props: DialogueBoxProps): JSX.Element {
  const {
    ready,
    covered,
    speakerName = '',
    speakerCharId,
    speakerVersion = 0,
    text,
    marks,
    revealed,
    fullyRevealed,
    boxWaiting,
    sending,
    cg = false,
    onTypeHold,
    skips,
    rowShown,
    wellAway = false,
    turnUp = rowShown,
    onRewind,
    cuts = 0,
    chips,
    onAdvance
  } = props

  /**
   * What the box is wearing. Changing `dress` respawns the box — it exits and re-enters rather
   * than swapping contents — for a new speaker, a narration block, or a reply. `reply` increments
   * on each reply so the same speaker answering again still changes `dress` and respawns.
   */
  const full = Boolean(text) || boxWaiting || sending
  const [wasSending, setWasSending] = useState(sending)
  const [reply, setReply] = useState(0)
  if (wasSending !== sending) {
    setWasSending(sending)
    if (!sending) setReply((n) => n + 1)
  }
  const dress = full ? `${reply}:${speakerCharId ?? ''}` : EMPTY

  const [shownDress, setShownDress] = useState(dress)
  const [arrival, setArrival] = useState<Arrival>('held')

  /** Where the chain goes once the box is free to arrive: her name first, or straight to it. */
  const opensAt = (worn: string): Arrival =>
    worn === EMPTY ? 'empty' : speakerCharId ? 'speaker' : 'box'

  /**
   * Whether the face has finished wiping in. **The arrival alone does not answer that**: a skip
   * lands the chain at once while the wipe keeps running, so this is the box's own report and
   * the one thing the typewriter waits on.
   */
  const [landed, setLanded] = useState(false)

  /**
   * The dress on screen was put up by a cut, so each keyed layer of it mounted at its settled
   * state; `cutMount` is what remounts them when the cut lands the dress already worn.
   */
  const [cutIn, setCutIn] = useState(false)
  const [cutMount, setCutMount] = useState(0)

  /** Takes the new dress and starts its arrival. */
  const enter = (worn: string): void => {
    setShownDress(worn)
    setArrival(opensAt(worn))
    setLanded(false)
    setCutIn(false)
  }

  /**
   * The render a rewind lands in, and only that one. The count it is read against catches up
   * after the commit, so a render-phase update that runs this body again still sees the cut.
   */
  const cutsSeen = useRef(cuts)
  const cutting = cutsSeen.current !== cuts
  useLayoutEffect(() => {
    cutsSeen.current = cuts
  })

  // A rewind lands the box on the line it stepped back to at once: the dress is taken whole, with
  // no exit before it and no chain after it. A box already standing in that dress keeps standing.
  const settled = shownDress === EMPTY ? arrival === 'empty' : arrival === 'shown' && landed
  if (cutting && arrival !== 'held' && (dress !== shownDress || !settled)) {
    setShownDress(dress)
    setArrival(dress === EMPTY ? 'empty' : 'shown')
    setLanded(dress !== EMPTY)
    setCutIn(true)
    setCutMount((n) => n + 1)
  }

  /**
   * What the box is showing, held for the exit to take away. Written during render rather than
   * in an effect, and only while the dress on screen is still the one being drawn — so the
   * render that brings the new line leaves the old line's words here to fade out.
   */
  const frozen = useRef('')
  if (dress === shownDress && arrival === 'shown') frozen.current = text.slice(0, revealed)
  const worn = useRef<{ charId: string | undefined; name: string }>({
    charId: speakerCharId,
    name: speakerName
  })
  if (dress === shownDress) worn.current = { charId: speakerCharId, name: speakerName }

  // A click during the arrival lands every layer at once. Without it the player out-clicks the
  // respawn and advances past a line he never saw, which is the one way this can eat one.
  const [seenSkips, setSeenSkips] = useState(skips)
  if (seenSkips !== skips) {
    setSeenSkips(skips)
    if (arrival === 'leaving') enter(dress)
    else if (arrival !== 'held' && arrival !== 'empty') setArrival('shown')
  }

  // A screen under the curtain is not arriving: everything is held at `hidden`, and the reveal
  // replays the whole entrance, which is what a save loaded mid-scene opens on.
  useEffect(() => {
    if (covered) setArrival('held')
  }, [covered])

  // The screen says the box may come in. **It is an edge on `ready` *and* on the arrival**: a
  // cover puts the chain back to `held` with the screen still saying it is ready, so the reveal
  // has to start it again — and the screen lowers `ready` under the cover for the same reason,
  // or the box would arrive before the layer that cues it has landed.
  useEffect(() => {
    if (ready && arrival === 'held') enter(dress)
  })

  // The box is dressed as something else now, so it leaves — or, where it is already away, it
  // simply comes back in the new dress.
  useEffect(() => {
    if (covered || dress === shownDress) return
    if (arrival === 'shown') setArrival('leaving')
    else if (arrival === 'empty') enter(dress)
  })

  /** The box is a box and a line may be written in it: the chain is over and the wipe has run. */
  const writable = arrival === 'shown' && landed

  // The line waits for the box that is going to hold it. The cleanup is load-bearing: this
  // unmounts at the slot boundary with the hold up, and the box it hands back to would never type.
  useEffect(() => {
    onTypeHold(!writable)
    return () => onTypeHold(false)
  }, [writable, onTypeHold])

  const leaving = arrival === 'leaving'
  /**
   * The box is still wearing the dress that is on its way out. **The render that brings the new
   * line paints before the effect that starts the exit**, and by then `revealed` has reset to
   * nothing — so `frozen` supplies the exit's text, showing it from the frame `dress` changes
   * rather than from the frame the exit starts.
   */
  const holding = leaving || (arrival === 'shown' && dress !== shownDress)
  const dressed = arrival === 'box' || arrival === 'chips' || arrival === 'shown'
  const named = arrival === 'name' || dressed
  const faced = arrival === 'speaker' || named
  const chipped = arrival === 'chips' || arrival === 'shown'

  /**
   * The box's own hit target: the face and label take `pointer-events: auto` back rather than
   * `.vu-box`, tracking the face's real `left`/`right` layout instead of the box's whole strip.
   */
  const answers = onAdvance
    ? { onClick: onAdvance, 'data-cursor': 'hand' }
    : undefined

  /** Where each keyed layer of the dress on screen starts: its settled state if a cut put it up. */
  const layerStart = cutIn ? false : 'hidden'

  /** The forward mark is up: the line is done, the box is not arriving, and the turn is not up. */
  const hintOn = !holding && fullyRevealed && !turnUp && !boxWaiting && !sending && Boolean(text)

  /** The back mark is up: a line may be stepped back to, and the box is standing to carry it. */
  const rewindOn = Boolean(onRewind) && dressed && !holding

  return (
    <motion.div
      className="vu-box"
      variants={sceneBox}
      initial={false}
      animate={sceneBoxState(sending, rowShown, cg, wellAway)}
    >
      {/* The face and its shadow, keyed on what the box is wearing: two labels are enough
          because the remount between them is what puts the collapsed box back on its round
          cap. Its completions are both ends of the chain. */}
      <motion.div
        key={`face:${shownDress}:${cutMount}`}
        className="vu-box-face vu-paper"
        {...answers}
        variants={boxWipe}
        initial={layerStart}
        animate={leaving ? 'out' : dressed ? 'in' : 'hidden'}
        onAnimationComplete={(label) => {
          if (label === 'in') setLanded(true)
          // Straight past the chips where the screen offers none: a variant tree with no
          // children reports nothing, and the chain would stop one step short of writable.
          if (label === 'in' && arrival === 'box') setArrival(chips ? 'chips' : 'shown')
          if (label === 'out' && arrival === 'leaving') enter(dress)
        }}
      />

      {/* The face and this are siblings, so their keys have to differ as well as change: two
          siblings sharing one key left React holding both nodes, and the stale face — still
          wearing the end of its own exit — was the one `querySelector` found. */}
      {worn.current.charId && (
        <div className="vu-box-label" key={`label:${shownDress}:${cutMount}`} {...answers}>
          <motion.div
            className="vu-box-portrait vu-arch vu-paper"
            variants={speakerFace}
            initial={layerStart}
            animate={leaving ? 'gone' : faced ? 'shown' : 'hidden'}
            onAnimationComplete={(label) => {
              if (label === 'shown' && arrival === 'speaker') setArrival('name')
            }}
          >
            <span className="vu-crop">
              <img
                className="vu-crop-img"
                src={profileUrl(worn.current.charId, speakerVersion)}
                alt=""
                /* A cut puts the face up at once with nothing under it, so it is decoded in step
                   rather than painted blank until a deferred decode lands. */
                decoding={cutIn ? 'sync' : 'async'}
              />
            </span>
          </motion.div>
          {/* Her name, arriving on the face's own landing, and the surface under it anchored
              to both ends of the word: the wipe front is the pill's own flat edge, so no number
              here knows how long a name is. */}
          <span className="vu-box-name">
            <span className="vu-box-namebox">
              <motion.span
                className="vu-box-namepill vu-paper"
                variants={speakerPill}
                initial={layerStart}
                animate={leaving ? 'gone' : named ? 'shown' : 'hidden'}
                onAnimationComplete={(label) => {
                  if (label === 'shown' && arrival === 'name') setArrival('box')
                }}
              />
            </span>
            <motion.span
              className="vu-box-nameink"
              variants={speakerInk}
              initial={layerStart}
              animate={leaving ? 'gone' : named ? 'shown' : 'hidden'}
            >
              {worn.current.name}
            </motion.span>
          </span>
        </div>
      )}

      <motion.div
        className="vu-box-text"
        variants={sceneText}
        initial={false}
        animate={leaving ? 'gone' : 'shown'}
      >
        {holding ? (
          <p className="vu-box-line">{frozen.current}</p>
        ) : boxWaiting && !sending ? (
          <motion.span className="vu-ring vu-box-ring" animate={spin} />
        ) : (
          /* **The count is gated here as well as held in the Game View**: the hold is reported
             through an effect, so a tick can land in the pass before it is raised, and a
             character drawn then is a character drawn behind a box that has not wiped in yet.
             Local state answers on the frame it changes. */
          <TypeLine
            text={text}
            marks={marks}
            revealed={writable ? revealed : 0}
            done={fullyRevealed}
            writing={writable}
          />
        )}
      </motion.div>

      {/* The forward chevron, shown once the line is fully done, not arriving and not turn-held;
          a cut stands it up at once. Two elements: the nudge and the fade are one property
          apiece, each its own `animate`. */}
      <motion.span
        className="vu-box-hint"
        variants={sceneHint}
        initial="hidden"
        animate={hintOn ? (cutting ? 'shownCut' : 'shown') : 'hidden'}
        aria-hidden="true"
      >
        <motion.span className="vu-box-nudge" animate={hintNudge}>
          <ChevronIcon />
        </motion.span>
      </motion.span>

      {/* The back mark on the round cap, the forward mark's mirror: a control where that one is
          a reading, so it takes its own pointer back from the layer and wears the hand. */}
      <motion.button
        className="vu-box-rewind"
        type="button"
        aria-label="Rewind"
        data-cursor="hand"
        disabled={!rewindOn}
        variants={boxRewind}
        initial="hidden"
        animate={rewindOn ? 'shown' : 'hidden'}
        {...gestures(!rewindOn, quietLift, quietPress)}
        onClick={onRewind}
      >
        <ChevronIcon back />
      </motion.button>

      {chips && (
        <motion.div
          className="vu-box-chips"
          variants={chipRow}
          initial="hidden"
          animate={leaving ? 'gone' : chipped ? (cg ? 'shownCg' : 'shown') : 'hidden'}
          onAnimationComplete={(label) => {
            // Either label is the row landing: which of the two it wore depends on the picture
            // behind it, and the chain is waiting on the deal rather than on the weight.
            if ((label === 'shown' || label === 'shownCg') && arrival === 'chips') {
              setArrival('shown')
            }
          }}
        >
          {chips}
        </motion.div>
      )}
    </motion.div>
  )
}

export interface TurnFieldProps {
  action: string
  onAction: (value: string) => void
  onSubmit: () => void
  /** The player's turn is out: Go reports the wait in the chevron's place. */
  sending: boolean
  /** A CG is behind the row: the well steps back with the box above it. */
  cg?: boolean
  submitDead: boolean
  inputDead: boolean
  /**
   * The well takes the focus while this is true and the input is live — **the row's own `inert`
   * condition**, since a field under `inert` cannot take it and would leave the caret nowhere.
   */
  focus: boolean
  placeholder: string
  /**
   * Whether the well takes more than one line. **The scene's does and the landing's does not** —
   * an action is a composed sentence, the landing's is a quick pick beside answers already
   * written. Shape only; `maxLength` is the same on both.
   */
  multiline?: boolean
  /**
   * What a screen's own arrival gives the well and the answer beside it, where it gives them
   * anything. **Two layers rather than one**, because a clip that's safe over the well would cut
   * Go's paper shadow off. The scene hands in neither — its row arrives whole, on one fade.
   */
  wellMotion?: MotionProps
  goMotion?: MotionProps
  /**
   * The well and Go are on show. False puts both away and out of the pointer's reach, for
   * whatever the screen stands in the well's place; absent is true.
   */
  revealed?: boolean
  /** What the screen stands in the well's place, drawn inside the well's own box. */
  overlay?: ReactNode
  /**
   * The pointer moved over the well's box or Go's seat, or left both. A move rather than an
   * entry, so a well put away under a resting pointer comes back only when the mouse moves.
   */
  onHover?: (over: boolean) => void
  /** The well took the caret, or gave it up. */
  onFocus?: () => void
  onBlur?: () => void
}

/**
 * The well the player answers in, and the Go beside it. **The same control on both screens** —
 * what changes is where the row it sits in is anchored, which is the screen's own class.
 */
export function TurnField(props: TurnFieldProps): JSX.Element {
  const dead = props.sending || props.submitDead
  const revealed = props.revealed ?? true
  /** The well's state: glassed while the turn is out, else in hand or put away. */
  const wellState = props.sending
    ? props.cg
      ? 'waitingCg'
      : 'waiting'
    : revealed
      ? 'ready'
      : 'hidden'
  /** Go's state: the wait's breath, put away with the well, or breathing once there are words. */
  const goState = props.sending
    ? 'sending'
    : !revealed
      ? 'hidden'
      : props.action.trim()
        ? 'armed'
        : 'rest'
  /** The pointer handlers both halves wear, where the screen listens for them at all. */
  const hover = props.onHover
    ? {
        onPointerMove: () => props.onHover?.(true),
        onPointerLeave: () => props.onHover?.(false)
      }
    : undefined

  /**
   * The field, one ref per shape because only one of the two is ever drawn. **The screen puts
   * the caret in it the moment the turn is his**, so the blinking mark is the browser's own and
   * the player answers without reaching for the box first.
   */
  const area = useRef<HTMLTextAreaElement>(null)
  const line = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (props.focus && !props.inputDead) (area.current ?? line.current)?.focus()
  }, [props.focus, props.inputDead])

  return (
    <>
      <motion.div className="vu-turn-inputbox" {...props.wellMotion} {...hover}>
        {props.multiline ? (
          /* Grows upward with the box above it moving out of the way (`field-sizing: content`,
             `Dialogue.css`). Enter must not write a newline too; Shift+Enter still breaks one. */
          <motion.textarea
            ref={area}
            id="game-action"
            className="vu-input vu-turn-input vu-turn-input--multiline"
            variants={turnWell}
            initial={false}
            animate={wellState}
            rows={1}
            value={props.action}
            maxLength={500}
            placeholder={props.placeholder}
            disabled={props.inputDead}
            onChange={(event) => props.onAction(event.target.value)}
            onFocus={props.onFocus}
            onBlur={props.onBlur}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              if (event.shiftKey) event.stopPropagation()
              else event.preventDefault()
            }}
          />
        ) : (
          <motion.input
            ref={line}
            id="game-action"
            className="vu-input vu-turn-input"
            variants={turnWell}
            initial={false}
            animate={wellState}
            value={props.action}
            maxLength={500}
            placeholder={props.placeholder}
            disabled={props.inputDead}
            onChange={(event) => props.onAction(event.target.value)}
            onFocus={props.onFocus}
            onBlur={props.onBlur}
          />
        )}
        {props.overlay}
      </motion.div>
      <motion.div className="vu-turn-goslot" {...props.goMotion} {...hover}>
        {/* Go rides a wrapper: the breath and the gesture are both a transform, and on one
            element the last writer wins. **The breath is the field's own state read back** —
            the button breathes the moment there are words, which is the answer arming itself
            rather than a second thing to notice. */}
        <motion.div
          className="vu-turn-go"
          variants={goBreath}
          initial={false}
          animate={goState}
        >
          <motion.button
            id="game-submit"
            className="vu-btn vu-btn--primary vu-btn--panel vu-paper vu-turn-gobtn"
            aria-label="Send"
            disabled={dead}
            {...gestures(dead, lift, press)}
            onClick={props.onSubmit}
          >
            {props.sending ? (
              <motion.span className="vu-ring vu-box-ring" animate={spin} />
            ) : (
              <ChevronIcon />
            )}
          </motion.button>
        </motion.div>
      </motion.div>
    </>
  )
}

/**
 * The reveal moved off the inside of a surrogate pair: `revealed` counts UTF-16 units, and half
 * an astral character is two stand-in glyphs of a different width, which is a line reflowing for
 * one tick.
 */
function wholeChars(text: string, revealed: number): number {
  const before = text.charCodeAt(revealed - 1)
  return before >= 0xd800 && before <= 0xdbff ? revealed - 1 : revealed
}

/**
 * A line being written, at its **final size from the first character**: the unsaid half is
 * drawn and hidden rather than omitted, so the paragraph's wrap and the box's centring never
 * change as the words arrive.
 */
function TypeLine({
  text,
  marks,
  revealed,
  done,
  writing
}: {
  text: string
  marks?: readonly TextMark[]
  revealed: number
  done: boolean
  /** The box has landed and the typewriter is free to run: what the cursor is a report on. */
  writing: boolean
}): JSX.Element {
  const cut = wholeChars(text, revealed)
  return (
    <p className="vu-box-line">
      <Marked text={text} marks={marks} from={0} to={cut} splash />
      {/* Where the next character lands. **It is an empty inline standing in the line, not a box
          taken out of it**: it takes no width, and the mark is a shadow thrown off it (`Dialogue.css`).
          Anything more — a glyph, an out-of-flow box, even a zero-size text node — splits the
          line's shaping where it sits, and a kerned pair that meets there loses its kern, so the
          words wrap one way as it passes and another once it has gone by. It is on screen exactly
          while the line is being written: not through the box's own arrival, and not once the last
          character has landed or the reveal has been skipped past. */}
      <motion.span
        className="vu-box-cursor"
        aria-hidden="true"
        animate={writing && !done ? cursorOn : cursorOff}
      />
      {/* The half not yet said keeps its own marks, so a word does not change colour as it is
          typed — it is hidden by `visibility` rather than by ink, which a mark cannot undo. */}
      <span className="vu-box-unsaid">
        <Marked text={text} marks={marks} from={cut} to={text.length} />
      </span>
    </p>
  )
}

/**
 * One slice of a line, cut at every mark that falls inside it. **One pass over both
 * halves of the reveal**, so a marked run split by the typewriter is two spans of one colour
 * rather than a run that appears whole the moment its first character lands.
 */
function Marked({
  text,
  marks,
  from,
  to,
  splash
}: {
  text: string
  marks?: readonly TextMark[]
  from: number
  to: number
  /** A splash off each mark as it lands — the said half only. */
  splash?: boolean
}): JSX.Element {
  if (from >= to) return <></>
  if (!marks || marks.length === 0) return <>{text.slice(from, to)}</>

  const runs: JSX.Element[] = []
  let at = from
  // The marks arrive sorted and never overlap (`markStatusLine`), so one walk is the whole cut.
  for (const mark of marks) {
    const start = Math.max(mark.start, from)
    const end = Math.min(mark.end, to)
    if (end <= start) continue
    if (start > at) runs.push(<span key={at}>{text.slice(at, start)}</span>)
    runs.push(
      <span key={start} className="vu-box-mark" data-tone={mark.tone}>
        {text.slice(start, end)}
        {/* The splash's seat, standing in whichever half holds the run's end from the line's
            first frame — the seat is out of flow, and one that arrived with the burst would
            split the line's shaping the tick the word landed. `revealed` resets to 0 on every
            new line and only climbs (or jumps to the end on a skip), so the burst inside it
            mounts once per mark per line — on the frame the word lands, typed or skipped — and
            stands invisible until the line goes; no callback catches it. */}
        {end === mark.end && (
          <span className="vu-box-splash">{splash && <Burst kind="splash" />}</span>
        )}
      </span>
    )
    at = end
  }
  if (at < to) runs.push(<span key={at}>{text.slice(at, to)}</span>)
  return <>{runs}</>
}
