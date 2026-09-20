/**
 * The motion vocabulary every screen shares, as data the components hand to motion. The paper
 * knobs exist because a hover must reach `.vu-paper`'s shadow, a pseudo-element motion cannot
 * address directly (`vu_styles/base.css`).
 */
import {
  animate,
  stagger,
  type AnimationPlaybackControls,
  type TargetAndTransition,
  type Transition,
  type Variants
} from 'motion/react'
import { CROSS_CHASE, CROSS_SECONDS } from '../stores/crossingStore'

/**
 * A hover's spring, thrown in proportion to how far it travels: motion's `velocity` applies to
 * every property in the target, so the kick is scaled to the rise it is paired with.
 */
const kicked = (scale: number): Transition => ({
  type: 'spring',
  stiffness: 600,
  damping: 40,
  velocity: 40 * (scale - 1)
})

const LIFT: Transition = kicked(1.1)

/**
 * The same spring with no kick: a press lowers scale, and the lift's `velocity` would throw it
 * the wrong way, so it is left out and motion falls back to whatever velocity is already there.
 */
const PRESS: Transition = { type: 'spring', stiffness: 600, damping: 40 }

/** Hover on a paper control: it lifts off the table and its shadow swings out from under it. */
export const lift: TargetAndTransition = {
  scale: 1.1,
  '--paper-tilt': '1deg',
  '--paper-offset': '12px 10px',
  transition: LIFT
}

/** Press: the control slides down its own offset until it sits flat on its shadow. */
export const press: TargetAndTransition = {
  scale: 1,
  x: 8,
  y: 7,
  '--paper-offset': '0px 0px',
  transition: PRESS
}

/** The same pair on a chip, whose paper layer is smaller to begin with. */
export const chipLift: TargetAndTransition = {
  scale: 1.1,
  '--paper-tilt': '1deg',
  '--paper-offset': '9px 8px',
  transition: LIFT
}

export const chipPress: TargetAndTransition = {
  scale: 1,
  x: 6,
  y: 5,
  '--paper-offset': '0px 0px',
  transition: PRESS
}

/**
 * Quiet controls carry no paper layer, so there is no shadow to swing: they tint one step
 * toward attention instead, and press with the scale alone.
 */
export const quietLift: TargetAndTransition = {
  scale: 1.1,
  backgroundColor: 'var(--vu-tint)',
  transition: LIFT
}

export const quietPress: TargetAndTransition = { scale: 0.9, transition: PRESS }

/**
 * A control that already spans its column — a disclosure row, a full-width pill — has nowhere
 * to grow into, and a neighbour a few pixels away. It tints where {@link quietLift} would also
 * swell, and presses by a fraction rather than by a tenth.
 */
export const rowLift: TargetAndTransition = {
  backgroundColor: 'var(--vu-tint)',
  transition: LIFT
}

export const rowPress: TargetAndTransition = { scale: 0.98, transition: PRESS }

/**
 * A quiet card that **expands** under the cursor as well as tinting — the Bunnyboard's contacts.
 * Reduced motion drops a transform outright, so scale alone would show nothing under it.
 */
export const cardSwell: TargetAndTransition = {
  scale: 1.03,
  backgroundColor: 'var(--vu-tint)',
  transition: kicked(1.03)
}

/**
 * A text link that is underlined at rest, so its colour is all that is left to answer
 * the cursor. Presses with {@link rowPress}.
 */
export const linkLift: TargetAndTransition = {
  color: 'var(--vu-accent)',
  transition: LIFT
}

/**
 * The same row, filled with the accent: it lightens one step, because tinting an accent
 * fill toward `--vu-tint` washes out the one colour that makes it the loud control.
 */
export const accentLift: TargetAndTransition = {
  filter: 'brightness(1.12)',
  transition: LIFT
}

/**
 * A control whose fill is a state — a tool in force, a zoom held. Hover lifts by scale alone:
 * motion restores a tinted fill to its *first*-hover value, not to what a state class set since.
 */
export const toggleLift: TargetAndTransition = { scale: 1.05, transition: kicked(1.05) }

/**
 * A card lifts less than a button does. A button is small and alone in its row; a card is
 * 300px of archway with a neighbour 26px away, and a button's 1.1 would put the two in
 * each other's space.
 */
export const cardLift: TargetAndTransition = {
  scale: 1.04,
  '--paper-tilt': '1deg',
  '--paper-offset': '12px 10px',
  transition: kicked(1.04)
}

/**
 * The portrait at the head of a rail: an archway 60px wide with the rest of its row 12px away,
 * so it takes a card's swell rather than a button's tenth, and its shadow moves half of what
 * {@link lift} throws — the full 6px put the shadow's foot into the row underneath.
 */
export const portraitLift: TargetAndTransition = {
  scale: 1.04,
  '--paper-offset': '9px 8px',
  transition: kicked(1.04)
}

/**
 * A control that rides a card and shows itself only when the card is under the cursor —
 * the cancel ✕. A control the player needs *now* (a running job's cancel) is animated to
 * {@link peek} and stays there instead.
 */
const REVEAL: Transition = { duration: 0.15, ease: 'easeOut' }
export const peek: TargetAndTransition = {
  opacity: 1,
  scale: 1,
  pointerEvents: 'auto',
  transition: REVEAL
}

/** Hidden, and out of the way: a transparent control still takes the clicks under it. */
export const tuck: TargetAndTransition = {
  opacity: 0,
  scale: 0.7,
  pointerEvents: 'none',
  transition: REVEAL
}

/**
 * What a dead control wears in place of a gesture: a target that moves nothing. Motion only
 * records a hover ending while the prop is present, so a control handed nothing at all comes
 * back from `disabled` still believing it is hovered.
 */
const idle: TargetAndTransition = {}

/**
 * The hover a control wears, and the mark that says it grows: an element whose hover scales
 * carries `data-lift`, which is what the document's hover listener plays the tick for. A dead
 * control wears {@link idle} and no mark.
 */
export function hovered(
  dead: boolean,
  hover: TargetAndTransition
): {
  whileHover: TargetAndTransition
  whileFocus: TargetAndTransition
  'data-lift'?: ''
} {
  if (dead) return { whileHover: idle, whileFocus: idle }
  return {
    whileHover: hover,
    whileFocus: hover,
    ...(typeof hover.scale === 'number' && hover.scale > 1 ? { 'data-lift': '' as const } : {})
  }
}

/**
 * The gestures a control wears. Motion's hover and press listen on pointer events, which the
 * browser delivers to a *disabled* button too — only click is withheld — so a dead control is
 * handed {@link idle} rather than the lift, and never relies on the DOM to refuse.
 */
export function gestures(
  dead: boolean,
  hover: TargetAndTransition,
  tap: TargetAndTransition
): {
  whileHover: TargetAndTransition
  whileTap: TargetAndTransition
  whileFocus: TargetAndTransition
  'data-lift'?: ''
} {
  return { ...hovered(dead, hover), whileTap: dead ? idle : tap }
}

/* ---- the opening, and the leaving ----------------------------------------- */

/**
 * The one clock every layer of a leaving modal runs on. A tween rather than the arrival's
 * spring: the veil's fade hides the panel long before a spring would settle, and a modal held
 * invisible for that tail is a modal still mounted over the screen.
 */
const LEAVE: Transition = { duration: 0.18, ease: 'easeIn' }

/**
 * A layer that only arrives: the background wash, the footer, the chips. It goes out the way it
 * came in, on the shared leaving tween, for a layer that is one of a sequence.
 */
export const fadeIn = (delay: number, duration = 0.4): Variants => ({
  hidden: { opacity: 0, y: 8 },
  shown: { opacity: 1, y: 0, transition: { duration, delay, ease: 'easeOut' } },
  gone: { opacity: 0, y: 8, transition: LEAVE }
})

/** She walks in from the left as she resolves. */
export const silhouetteIn: Variants = {
  hidden: { opacity: 0, x: -80 },
  shown: { opacity: 1, x: 0, transition: { duration: 0.5, delay: 0.15, ease: 'easeOut' } }
}

/**
 * The rack is a sheet of paper dealt onto the screen: it slides in from the left, and its
 * shadow spreads out from under it once it lands rather than travelling at full width.
 */
export const rackIn: Variants = {
  hidden: { x: -880, '--paper-tilt': '0deg', '--paper-offset': '6px 5px' },
  shown: {
    x: 0,
    '--paper-tilt': '-2deg',
    '--paper-offset': '16px 14px',
    transition: {
      x: { type: 'spring', stiffness: 210, damping: 26, delay: 0.25 },
      default: { duration: 0.3, delay: 0.65 }
    }
  }
}

/**
 * A page's own chrome dropping in from off the top — the registrar's address bar. It is
 * the whole of the screen for the first beat, so it is a spring rather than a fade: what
 * arrives is a thing with an edge, and the rest of the page is typed into it afterwards.
 */
export const chromeIn: Variants = {
  hidden: { y: -64 },
  shown: { y: 0, transition: { type: 'spring', stiffness: 320, damping: 32 } }
}

/**
 * A URL being typed into that bar, one character at a time. Linear, because a hand typing
 * does not ease — and short, because the address is not the thing the player came for; the
 * whole opening is under a second and a half.
 */
export const TYPE_URL: Transition = { duration: 0.55, ease: 'linear' }

/** A stack of buttons deals itself out, one after another. */
export const dealt = (startDelay: number, each = 0.065): Variants => ({
  hidden: {},
  shown: { transition: { delayChildren: stagger(each, { startDelay }) } }
})

/** The spring a dealt button lands on, and the shrunk it is dealt from. */
const DEAL: Transition = { type: 'spring', stiffness: 520, damping: 24 }
const DEALT_HIDDEN: TargetAndTransition = { opacity: 0, scale: 0.6 }

/** Each button pops from shrunk, pivoting on the flat edge it is dealt from. */
export const dealtItem: Variants = {
  hidden: DEALT_HIDDEN,
  shown: { opacity: 1, scale: 1, transition: DEAL }
}

/** What a dead control wears, which is CSS's everywhere but here. */
const DEAD_OPACITY = 0.45

/**
 * The same deal, landing dead: motion's inline `opacity` beats `[data-theme] button:disabled`,
 * so a control dead on arrival lands at the dim itself and springs to full once it wakes.
 */
export const dealtItemDead: Variants = {
  hidden: DEALT_HIDDEN,
  shown: { opacity: DEAD_OPACITY, scale: 1, transition: DEAL }
}

/**
 * A map bubble's three beats: the grow it stands up in, the budget the whole name is typed in
 * however long it is, and the pop Go takes before the faces begin dealing.
 */
const BUBBLE_GROW = 0.14
const BUBBLE_TYPE = 0.18
const BUBBLE_GO = 0.04

/**
 * A bubble standing up off its foot — it grows from nothing about the point the layout marked,
 * and its ink is there well before the spring has settled, so what the eye follows is the shape
 * arriving. Everything printed inside it waits out the growth.
 */
export const bubbleIn: Variants = {
  hidden: { opacity: 0, scale: 0 },
  shown: {
    opacity: 1,
    scale: 1,
    transition: {
      type: 'spring',
      stiffness: 520,
      damping: 30,
      opacity: { duration: 0.1 },
      delayChildren: BUBBLE_GROW
    }
  }
}

/**
 * The place arrives, then the name types later, riding this wrapper's `delayChildren`. **A child
 * that states its own `delay` replaces it**, restarting everything beneath from the top.
 */
export const bubbleHead: Variants = {
  hidden: {},
  shown: { transition: { delayChildren: (i: number) => (i === 0 ? 0 : BUBBLE_TYPE) } }
}

/**
 * A place name typed one character at a time inside one fixed budget, so a long name reads no
 * slower than a short one. The name is laid out whole from the first frame and only its ink
 * arrives, keeping the bubble at the width layout measured.
 */
export const typed: Variants = {
  hidden: {},
  shown: {
    transition: { delayChildren: (i: number, total: number) => (i / total) * BUBBLE_TYPE }
  }
}

/** One character of it, which appears rather than arrives. */
export const typedChar: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: 0 } }
}

/** The faces, dealt once the head has finished saying where they are. */
export const bubbleFaces: Variants = dealt(BUBBLE_TYPE + BUBBLE_GO, 0.05)

/**
 * A size that is a *state*: New Game's Start doubles when there is a roster to start with and
 * folds back when the last name leaves it — a spring, since the player caused it. It sits on a
 * **wrapper**, since `scale` is what {@link lift} and {@link press} also animate on the button.
 */
const DOUBLE: Transition = { type: 'spring', stiffness: 260, damping: 22 }

export const doubled: Variants = {
  single: { scale: 1, rotate: 0, transition: DOUBLE },
  double: { scale: 2, rotate: -4, transition: DOUBLE }
}

/**
 * The doorway opening: a stiff spring with a kick, so it clears the spot the ripple starts from
 * well ahead of it. The `velocity` is safe here for {@link LIFT}'s reason and not {@link PRESS}'s:
 * the only property is a `scale` that rises, so the kick throws it where it is already going.
 */
const DOORWAY_OPEN: Transition = {
  type: 'spring',
  stiffness: 400,
  damping: 42,
  velocity: 1
}

/**
 * And closing. A spring, because it inherits whatever velocity the tween had when the pointer
 * left — the doorway is caught rather than restarted. No `restDelta`/`restSpeed` here: those
 * are pixel thresholds, and what this animates is a unit scalar.
 */
const DOORWAY_CLOSE: Transition = { type: 'spring', stiffness: 400, damping: 32 }

/**
 * How far the archway swells: its bottom is anchored (`transform-origin` in `NewGame.css`), so it
 * grows upward past the stage's top edge. The value is set above what the crown's own height
 * needs to fully clear it, so it reads as off screen rather than merely large.
 */
const DOORWAY_SCALE = 1.75

export const doorway: Variants = {
  rest: { scale: 1, transition: DOORWAY_CLOSE },
  open: { scale: DOORWAY_SCALE, transition: DOORWAY_OPEN }
}

/**
 * How far the ripple has to grow to cover the stage, spreading from the Start button rather
 * than the doorway's own foot (`NewGame.css`). The corner behind the button is never reached,
 * but the doorway stands there at rest and covers more of it once open.
 */
const RIPPLE_SCALE = 5.5

/** The wave's own clock, and how far behind it the ground that swallows it starts. */
const RIPPLE_SECONDS = 0.4
const RIPPLE_CHASE = 0.1

/**
 * The ripple a doorway leaves: a duplicate archway spreading from where it stood, chased by a
 * ground-colour duplicate that starts later and runs shorter, so the two land together. Two
 * constants rather than a factory, so their identity survives re-renders.
 */
export const rippleLead: Variants = {
  rest: { scale: 1 },
  spread: {
    scale: RIPPLE_SCALE,
    transition: { duration: RIPPLE_SECONDS, ease: 'easeOut' }
  }
}

export const rippleChase: Variants = {
  rest: { scale: 1 },
  spread: {
    scale: RIPPLE_SCALE,
    transition: { duration: RIPPLE_SECONDS - RIPPLE_CHASE, delay: RIPPLE_CHASE, ease: 'easeOut' }
  }
}

/**
 * The crossing's two clocks: one sheet leads and the other chases it, the same lead/chase
 * arrangement as the ripple above, so the band between them thins to nothing. Read by
 * `stores/crossingStore.ts`, which owns the rule that reads them.
 */
export const crossLead: Transition = { duration: CROSS_SECONDS, ease: 'easeOut' }

export const crossChase: Transition = {
  duration: CROSS_SECONDS - 0.02,
  delay: CROSS_CHASE,
  ease: 'easeOut'
}

/**
 * How long the curtain rests at full cover before anything happens, in milliseconds. Every
 * crossing owes it: without the hold the cover reads as a flicker and a turn as the wrong colour.
 */
export const CURTAIN_HOLD_MS = 1000

/**
 * The curtain crossing from one polarity to the other while opaque: a fade between two flat
 * sheets, so it runs the same either way. **A full second**, since the stage changing value is
 * the app's largest move — anything quicker reads as a flash rather than a turn.
 */
export const THEME_FADE: Transition = { duration: 1, ease: 'easeInOut' }

/* ---- the day-change splash ------------------------------------------------ */

/**
 * The splash arriving over a polarity that is still turning, on {@link THEME_FADE}'s own clock
 * so its ink is never shown over the wrong colour mid-crossing. A crossing whose polarity does
 * not change starts `settled`, with nothing for the splash to wait out.
 */
export const splashArrive: Variants = {
  over: { opacity: 0 },
  settled: { opacity: 1, transition: THEME_FADE }
}

/**
 * How far off the left edge the mark starts. It is a translate rather than a position, so the
 * number only has to clear the widest the stage gets minus where the mark rests — the layout
 * itself is `DayChangeSplash.css`'s.
 */
const SPLASH_MARK_TRAVEL = -1100

/** The mark arriving: one long throw that lands rather than settles, so no spring. */
export const splashMark: Variants = {
  hidden: { x: SPLASH_MARK_TRAVEL, opacity: 0 },
  shown: { x: 0, opacity: 1, transition: { duration: 0.7, ease: 'easeOut' } }
}

/**
 * The mark turning where it stands while the curtain is down: clockwise through the day and
 * counter-clockwise through the night, the one wordless signal for which half it is. Slow, since
 * the mark is most of the stage tall — at the ring's five seconds it would read as a wheel.
 */
const SPLASH_TURN: Transition = { duration: 22, ease: 'linear', repeat: Infinity }

export const splashSpinDay: TargetAndTransition = { rotate: 360, transition: SPLASH_TURN }

export const splashSpinNight: TargetAndTransition = { rotate: -360, transition: SPLASH_TURN }

/**
 * The surface wiping in under the day: it animates the box's right edge, whose left edge is
 * already in place, so the flat edge is the wipe front and the round cap stays put. The box is
 * anchored to the word at both ends, so no width is measured, and nothing here is clipped.
 */
export const splashPill: Variants = {
  hidden: { right: '100%' },
  shown: { right: '0%', transition: { duration: 0.55, delay: 0.12, ease: 'easeOut' } }
}

/** The day itself, arriving over the surface that is still wiping in under it. */
export const splashWord: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: 0.4, delay: 0.3, ease: 'easeOut' } }
}

/**
 * The row under the pill, dealt one reading after another once the word has finished arriving:
 * the half, the week, the date. `dealt`'s stagger over a fade rather than a pop — these are
 * three small readings and not three controls.
 */
export const splashMeta: Variants = dealt(0.78, 0.16)

export const splashMetaItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } }
}

/** And the occasion, on its own line under them, last of everything the curtain says. */
export const splashOccasion: Variants = {
  hidden: { opacity: 0, y: 8 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.35, delay: 1.45, ease: 'easeOut' } }
}

/**
 * How long the curtain is held for the splash, in milliseconds: everything above lands by 1.8s,
 * and the rest is reading time.
 */
export const SPLASH_MS = 3500

/**
 * Extra hold for a splash that carries an occasion, on top of {@link SPLASH_MS}. It is the one
 * line on the curtain that is prose rather than a reading — a sentence takes longer to read than
 * a date takes to recognise — so only the slot that has one pays for it.
 */
export const SPLASH_OCCASION_MS = 500

/** The bunny waiting on the curtain: a hop it never lands out of. */
export const bunnyHop: Transition = { duration: 0.6, ease: 'easeInOut', repeat: Infinity }

/**
 * The bunny leaving as the screen opens: up a little, then off the bottom edge. Its keyframes
 * begin with `null` — the value it is *already* at, since the hop is stopped wherever it was
 * standing, and a literal `0` would drop it to the floor before the leap.
 */
export const bunnyLeap: Transition = {
  duration: 0.45,
  times: [0, 0.33, 1],
  ease: ['easeOut', 'easeIn']
}

/**
 * The line beside the bunny saying what the wait is for. It arrives with the mark and leaves on
 * the same flag the leap does, so a caption never outlasts a bunny that has already jumped off
 * the screen. An opacity, so a player who asked for less motion is still owed the sentence.
 */
export const crossingReason: Variants = {
  shown: { opacity: 1, transition: { duration: 0.3, ease: 'easeOut' } },
  gone: { opacity: 0, transition: { duration: 0.2, ease: 'easeIn' } }
}

/**
 * A modal arrives as two layers: the veil fades the
 * screen down, and the panel fades in over it and rises the last 12px. Neither carries a delay —
 * a modal is the answer to something the player just clicked.
 */
export const veilIn: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: 0.15, ease: 'easeOut' } },
  gone: { opacity: 0, transition: LEAVE }
}

export const panelIn: Variants = {
  hidden: { opacity: 0, y: 12 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.18, ease: 'easeOut' } },
  gone: { opacity: 0, y: 12, transition: LEAVE }
}

/**
 * A modal that wears a title tab arrives as three: the veil, the title growing to size on its own
 * corner, and the panel rising further than {@link panelIn}'s under it. The tab never travels.
 */
export const TAB_ARRIVAL: Transition = { type: 'spring', stiffness: 380, damping: 34 }

/** How small the title starts, and the size it shrinks back to on its way out. */
export const TAB_ARRIVAL_SCALE = 0.5

/** How far under its tab the panel starts. */
const PANEL_RISE = 64

export const panelUnderTab: Variants = {
  hidden: { opacity: 0, y: PANEL_RISE },
  shown: { opacity: 1, y: 0, transition: TAB_ARRIVAL },
  // A short sink back the way it rose: the veil's fade is already taking it down, so the
  // panel only has to move enough to read as leaving.
  gone: { opacity: 0, y: 24, transition: LEAVE }
}

/**
 * The tab going back to where it started. An explicit target rather than a label, for the
 * reason its arrival is one: the element carries no variants of its own to look it up in.
 */
export const tabGone: TargetAndTransition = { scale: TAB_ARRIVAL_SCALE, transition: LEAVE }

/** One row of a list arriving from the left; the list it sits in deals them out (`dealt`). */
export const slideIn: Variants = {
  hidden: { opacity: 0, x: -28 },
  shown: { opacity: 1, x: 0, transition: { duration: 0.28, ease: 'easeOut' } }
}

/**
 * The same row, dealt into a panel that arrives *with* it rather than resizing under it, unlike
 * {@link slideIn} — a picker's rows must be ready while the player is still reaching for one.
 */
export const slideInQuick: Variants = {
  hidden: { opacity: 0, x: -20 },
  shown: { opacity: 1, x: 0, transition: { duration: 0.16, ease: 'easeOut' } }
}

/**
 * A label that appears over a control while the pointer is on it and leaves with it — the one
 * hover-revealed label in the app, raised by the wrapper around a dead control. A fade with a
 * short rise, so it reads as said rather than as a control arriving.
 */
export const noteIn: Variants = {
  hidden: { opacity: 0, y: 6 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.14, ease: 'easeOut' } },
  gone: { opacity: 0, y: 6, transition: LEAVE }
}

/**
 * The two weights of a mark that offers a reading: lighter where it is only sitting there, full
 * while the pointer is on it and the card it raises ({@link noteIn}) is out.
 */
export const helpMark: Variants = {
  rest: { opacity: 0.6, transition: { duration: 0.14, ease: 'easeOut' } },
  hover: { opacity: 1, transition: { duration: 0.14, ease: 'easeOut' } }
}

/** Text swapped for other text in the same place: out, then in, with the resize between. */
export const FADE: Transition = { duration: 0.12, ease: 'easeOut' }

/**
 * A box growing or shrinking to fit what is now inside it, landed once `restDelta`/`restSpeed`
 * call it settled. Motion's own defaults are tuned for opacities and unit scalars, not pixels,
 * and hold `onComplete` well past a box's last visible frame.
 */
const RESIZE: Transition = {
  type: 'spring',
  stiffness: 260,
  damping: 30,
  restDelta: 2,
  restSpeed: 60
}

/**
 * Tweens a box's own measurement from what was measured to what is measured now, then releases
 * it so the box answers to its content again. The release rides `onComplete` rather than the
 * returned promise, which motion resolves via `finally` even when the tween is interrupted.
 */
export function tweenSize(
  write: (value: string) => void,
  from: number,
  to: number,
  onDone?: () => void
): AnimationPlaybackControls {
  write(`${from}px`)
  return animate(from, to, {
    ...RESIZE,
    onUpdate: (value) => write(`${value}px`),
    onComplete: () => {
      write('')
      onDone?.()
    }
  })
}

/* ---- the breaths every screen's idle is paid with ------------------------- */

/**
 * A breath's two tempos: a mark near the wordmark's own pace, decoration half again as slow.
 * `MotionConfig reducedMotion="user"` applies a transform target instantly — the last of a
 * keyframe list — so every breath declared on them has to end where it began.
 */
const BREATH: Transition = { duration: 4, repeat: Infinity, ease: 'easeInOut' }
const BREATH_SLOW: Transition = { duration: 6, repeat: Infinity, ease: 'easeInOut' }

/** How far a corner archway swells, shared so that no two screens breathe differently. */
const BREATH_SWELL = [1, 1.03, 1]

/* ---- the scene ------------------------------------------------------------ */

/**
 * The scene's chrome arrives in a chain, each layer cued by the one before it landing so nothing
 * drifts against the typewriter it hands off to, and leaves as one state with three delays off
 * one clock: the chips first, then her name, then the line, then the box that held it.
 */
const SCENE_OUT_LABEL = 0.06
const SCENE_OUT_TEXT = 0.1
const SCENE_OUT_BOX = 0.16

/** The stamp's own height: it starts entirely off the bottom edge and jumps into frame. */
const STAMP_TRAVEL = 330

export const stampIn: Variants = {
  hidden: { y: STAMP_TRAVEL },
  shown: { y: 0, transition: { type: 'spring', stiffness: 300, damping: 30 } }
}

/** The wash and the rail, which arrive with the stamp and then stay for the whole scene. */
export const sceneFade: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: 0.3, ease: 'easeOut' } }
}

/**
 * A control on the rail, and the Gift button beside Go: four states rather than `disabled` alone,
 * for {@link dealtItemDead}'s reason.
 */
export const seat: Variants = {
  hidden: { opacity: 0, scale: 0.6 },
  shown: { opacity: 1, scale: 1, transition: DEAL },
  dim: { opacity: DEAD_OPACITY, scale: 1, transition: DEAL },
  gone: { opacity: 0, scale: 1, transition: REVEAL }
}

/**
 * The label's own spring: {@link TAB_ARRIVAL}'s curve at twice the speed — stiffness times four
 * and damping times two, since a spring's time scales with the root of its stiffness, and the
 * damping has to move with it or the shape of the curve changes.
 */
const SPEAKER_ARRIVAL: Transition = { type: 'spring', stiffness: 1520, damping: 68 }

/**
 * Her face, growing from half its size where it stands — the title tab's arrival at a label's
 * scale, on the label's own clock, and it never travels. Its landing cues the name beside it a
 * step later; `scale` is named in `gone` too, so leaving does not snap her back to half size.
 */
export const speakerFace: Variants = {
  hidden: { opacity: 0, scale: TAB_ARRIVAL_SCALE },
  shown: {
    opacity: 1,
    scale: 1,
    transition: { scale: SPEAKER_ARRIVAL, opacity: { duration: 0.1, ease: 'easeOut' } }
  },
  gone: { opacity: 0, scale: 1, transition: { duration: 0.1, delay: SCENE_OUT_LABEL } }
}

/**
 * Her name wiping in under the face once it has landed, the splash's own surface at label scale.
 * **The right edge of a box whose left edge is already in place** is what animates, so the flat
 * edge is the wipe front and nothing has to be measured for names of any length.
 */
export const speakerPill: Variants = {
  hidden: { right: '100%' },
  shown: { right: '0%', transition: { duration: 0.1, ease: 'easeOut' } },
  // `right` is pinned rather than left out: a variant that does not name a property motion is
  // already animating hands it back to `initial`, so a bare fade here wiped the pill shut on the
  // way out as well. She leaves on the box's own wipe, not on a second one of her own.
  gone: { right: '0%', opacity: 0, transition: { duration: 0.1, delay: SCENE_OUT_LABEL } }
}

export const speakerInk: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: 0.08, delay: 0.04, ease: 'easeOut' } },
  gone: { opacity: 0, transition: { duration: 0.1, delay: SCENE_OUT_LABEL } }
}

/**
 * The box itself, on the same wipe at panel scale, in from the left and out the same way. **The
 * element is keyed on what it is wearing**, so each label need only name the edge it moves.
 */
export const boxWipe: Variants = {
  hidden: { left: '0%', right: '100%' },
  in: { left: '0%', right: '0%', transition: { duration: 0.24, ease: 'easeOut' } },
  // **Both edges are named in both labels**, and that is what makes the wipe a wipe. A variant
  // that leaves a property out hands it back to `initial`, so an `out` naming `left` alone sent
  // `right` home to 100% at the same time and the box shut from both ends at once — a box
  // closing rather than one wiped off the stage the way it was wiped onto it.
  out: {
    left: '100%',
    right: '0%',
    transition: { duration: 0.2, delay: SCENE_OUT_BOX, ease: 'easeIn' }
  }
}

/** How long the box's glass takes to arrive at a new state, and the chips ride the same clock. */
const GLASS: Transition = { duration: 0.25, ease: 'easeOut' }

/** The four chips hung off the box's right edge, dealt out once it has landed. */
export const chipRow: Variants = {
  hidden: {},
  shown: { transition: { delayChildren: stagger(0.03) } },
  shownCg: { transition: { delayChildren: stagger(0.03) } },
  gone: {}
}

/**
 * One chip arriving and resting where the box has stepped back to: under full over a background,
 * half that over a CG, each chip's own dim so a hover can return it to full ({@link boxChipLift}).
 * `shownCg` is a second label rather than a value, since an unlabeled child never animates.
 */
export const chipIn: Variants = {
  hidden: { opacity: 0, y: 6 },
  shown: { opacity: 0.85, y: 0, transition: { duration: 0.14, ease: 'easeOut' } },
  shownCg: { opacity: 0.425, y: 0, transition: GLASS },
  gone: { opacity: 0, transition: { duration: 0.1 } }
}

/**
 * A chip under the pointer: {@link quietLift}'s swell and tint, forced to full ink regardless of
 * the box's own dim. Leaving hover hands it back to whatever the live dim target is at that moment.
 */
export const boxChipLift: TargetAndTransition = { ...quietLift, opacity: 1 }

/** How far the box drops when there is no row under it to make room for: the row's own height. */
const SCENE_BOX_DROP = 62

const BOX_SLIDE: Transition = { type: 'spring', stiffness: 300, damping: 34 }

/**
 * The box's resting states: six variants for the row's position crossed with whether a CG shows
 * through it. The two glass values are percentages substituted by `Dialogue.css` into a
 * `color-mix()`; motion reads an undeclared custom property as `0`, so both are declared there too.
 */
export const sceneBox: Variants = {
  up: { y: 0, '--glass': '75%', '--glass-shadow': '47%', transition: BOX_SLIDE },
  waiting: { y: 0, '--glass': '37.5%', '--glass-shadow': '17%', transition: GLASS },
  down: { y: SCENE_BOX_DROP, '--glass': '75%', '--glass-shadow': '47%', transition: BOX_SLIDE },
  upCg: { y: 0, '--glass': '33%', '--glass-shadow': '21%', transition: GLASS },
  waitingCg: { y: 0, '--glass': '10%', '--glass-shadow': '5%', transition: GLASS },
  downCg: { y: SCENE_BOX_DROP, '--glass': '33%', '--glass-shadow': '21%', transition: GLASS }
}

/**
 * Which of {@link sceneBox}'s six the box is standing in. The vocabulary is named here rather
 * than spelled out in the view, so the screen picks a state and never a label.
 */
export function sceneBoxState(sending: boolean, rowShown: boolean, cg: boolean): string {
  const state = sending ? 'waiting' : rowShown ? 'up' : 'down'
  return cg ? `${state}Cg` : state
}

/**
 * The well the player answers in, glassy as the box above it while his turn is out
 * ({@link sceneBox}'s `waiting` states, same numbers and clock). `ready` is the field he types
 * into, and only the waiting half follows the box.
 */
export const turnWell: Variants = {
  ready: { '--well-glass': '92%', transition: GLASS },
  waiting: { '--well-glass': '33%', transition: GLASS },
  waitingCg: { '--well-glass': '10%', transition: GLASS }
}

/**
 * The balance card arriving at the top-right of a scene, for the one line that reports a change.
 * It comes in off its own edge rather than fading: what the reader is being shown is that
 * a reading has *turned up*, and a fade would read as chrome that had been there all along.
 */
export const moneyIn: Variants = {
  hidden: { x: '150%', opacity: 0 },
  shown: {
    x: 0,
    opacity: 1,
    transition: { type: 'spring', stiffness: 260, damping: 30 }
  },
  gone: { x: '150%', opacity: 0, transition: { duration: 0.24, ease: 'easeIn' } }
}

const MONEY_PER_DOLLAR = 0.004
const MONEY_COUNT_MIN = 0.15
const MONEY_COUNT_MAX = 0.35

/**
 * The count itself: linear, and paced by the size of the change — a dollar or two ticks over
 * and a hundred rattles down. A function because the duration belongs to this reading, not the
 * screen, and it is called inside an effect so nothing here is rebuilt during a render.
 */
export function moneyCount(delta: number): Transition {
  const run = Math.abs(delta) * MONEY_PER_DOLLAR
  return {
    duration: Math.min(MONEY_COUNT_MAX, Math.max(MONEY_COUNT_MIN, run)),
    ease: 'linear'
  }
}

/** The beat a landed total stands for before the card is taken away. */
export const MONEY_REST = 0.45

/**
 * The change printed under the figure while a card is reporting one, sized by its own `height`
 * in normal flow rather than a `layout` prop, which would scale the paper element and distort it.
 * `height` is one of motion's `positionalKeys`, so reduced motion applies it instantly too.
 */
export const moneyDelta: Variants = {
  shut: { height: 0, opacity: 0 },
  open: { height: 'auto', opacity: 1, transition: { duration: 0.072, ease: 'easeOut' } },
  closing: {
    height: 0,
    opacity: 0,
    transition: { opacity: { duration: 0 }, height: { duration: 0.14, ease: 'easeIn' } }
  }
}

export const sceneText: Variants = {
  shown: { opacity: 1, transition: { duration: 0.12 } },
  gone: { opacity: 0, transition: { duration: 0.1, delay: SCENE_OUT_TEXT } }
}

export const sceneHint: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: 0.2, ease: 'easeOut' } }
}

export const sceneRow: Variants = {
  hidden: { opacity: 0, transition: { duration: 0.16, ease: 'easeIn' } },
  shown: { opacity: 1, transition: { duration: 0.22, ease: 'easeOut' } }
}

/**
 * The line's cursor: **solid while the line is being written and gone the moment it is not** — on
 * the last character, a skipped reveal, or the box's own arrival. Both instant: it reports whether
 * the line is still arriving, and a fading report is a report that lags.
 */
export const cursorOn: TargetAndTransition = { opacity: 1, transition: { duration: 0 } }

export const cursorOff: TargetAndTransition = { opacity: 0, transition: { duration: 0 } }

/**
 * Go's three resting states, on a wrapper for {@link doubled}'s reason: the breath and the
 * gesture are both transforms, and one element can only carry one. `armed` breathes on the
 * app's own clock ({@link BREATH}); `sending` runs faster, `rest` settles on {@link PRESS}.
 */
export const goBreath: Variants = {
  rest: { scale: 1, transition: PRESS },
  armed: { scale: [1, 1.03, 1], transition: BREATH },
  sending: {
    scale: [1, 1.04, 1],
    transition: { duration: 1.6, repeat: Infinity, ease: 'easeInOut' }
  }
}

/**
 * The stamp's day mark, and the screen's idle. **The two halves move differently because the two
 * marks are different shapes**: the sun turns where it stands, clockwise as the splash's mark
 * does, paced between the ring's wait and the splash's own much slower turn.
 */
const STAMP_TURN: Transition = { duration: 12, ease: 'linear', repeat: Infinity }

export const stampSpinDay: TargetAndTransition = { rotate: 360, transition: STAMP_TURN }

/**
 * The crescent swings instead: two keyframes and one ease around upright, so it is quickest
 * through the middle and stillest at the two ends of the arc. It ends where it began, as every
 * idle must.
 */
export const stampSwayNight: TargetAndTransition = {
  rotate: [25, -25, 25],
  transition: { duration: 4.5, ease: 'easeInOut', repeat: Infinity }
}

/**
 * The clock a wet sky's mark steps on: two frames, each held half a second, so the crossing is a
 * cut rather than a slide — a repeated keyframe time is a zero-width range and the later value
 * wins it. It rests on frame two, the one reduced motion holds and a still mark is drawn at.
 */
const MARK_STEP: Transition = {
  duration: 1,
  times: [0, 0.5, 0.5, 1],
  ease: 'linear',
  repeat: Infinity
}

/** The rain's drops, dropped a couple of units and flicked back up to where they are drawn. */
export const rainDrops: TargetAndTransition = { y: [2, 2, 0, 0], transition: MARK_STEP }

/** How far either way the bolt leans, which is also the lean a still bolt is drawn at. */
export const BOLT_TILT = 8

/** The storm's bolt, snapping between a clockwise lean and the counter-clockwise one it rests at. */
export const stormBolt: TargetAndTransition = {
  rotate: [BOLT_TILT, BOLT_TILT, -BOLT_TILT, -BOLT_TILT],
  transition: MARK_STEP
}

/** For the wrapper the sun turns on: a wet sky's mark stands still on it instead. */
export const markStill: TargetAndTransition = { rotate: 0, transition: { duration: 0 } }

/**
 * The mark that says a line is finished and the next is a click away: it nudges the way it
 * points, on the box's own corner. Small and slow — it is the one thing on a screen the player
 * has stopped reading, so it has to be findable without being what he watches.
 */
export const hintNudge: TargetAndTransition = {
  x: [0, 6, 0],
  transition: { duration: 1.1, ease: 'easeInOut', repeat: Infinity }
}

/**
 * The chrome leaving on the eye and coming back on the next input. A fade, since motion
 * owns the hide: no CSS class holds a rule for it.
 */
export const sceneHide: Variants = {
  shown: { opacity: 1, transition: { duration: 0.22, ease: 'easeOut' } },
  hidden: { opacity: 0, transition: { duration: 0.18, ease: 'easeIn' } }
}

/* ---- the decision landing ------------------------------------------------- */

/**
 * The landing arrives in one order, read outward from the corner the eye starts in: the hour,
 * then what the reader has, then what he may do, and last the box he answers in. It settles
 * inside a second and a half.
 */
const LANDING_ACCENT_L = 0
const LANDING_BANNER = 0.08
const LANDING_ACCENT_R = 0.24
const LANDING_BANNER_INK = 0.3
const LANDING_HEAD = 0.38
const LANDING_PLOT = 0.52
const LANDING_BADGES = 0.64
const LANDING_APPS = 0.76
const LANDING_TITLE = 0.88
const LANDING_ROWS = 0.96
const LANDING_INPUT = 1.16

/**
 * What the landing waits for a narration box wiping off the stage in front of it, in milliseconds:
 * {@link SCENE_OUT_BOX}'s delay plus its own run. **A duration, not a completion**: the box is a
 * sibling the landing cannot wait on. With none in front, it waits none of it.
 */
export const LANDING_AFTER_BOX_MS = 380

/**
 * The two corner archways, breathing on one clock in opposite phase — a `delay` of half the
 * period, since an inverted keyframe array would rest one archway swollen under reduced motion.
 * The fade and the breath ride one variant rather than a wrapper ({@link decorIn}'s arrangement).
 */
export const landingAccent: Variants = {
  hidden: { opacity: 0 },
  shown: {
    opacity: 1,
    scale: BREATH_SWELL,
    transition: {
      opacity: { duration: 0.5, delay: LANDING_ACCENT_L, ease: 'easeOut' },
      scale: BREATH_SLOW
    }
  }
}

export const landingAccentLate: Variants = {
  hidden: { opacity: 0 },
  shown: {
    opacity: 1,
    scale: BREATH_SWELL,
    transition: {
      opacity: { duration: 0.5, delay: LANDING_ACCENT_R, ease: 'easeOut' },
      scale: { ...BREATH_SLOW, delay: 3 }
    }
  }
}

/**
 * The date banner wiping in, the splash's own surface: it animates the **right edge of a box
 * whose left edge is already in place**, so the flat edge is the wipe front and the round cap the
 * sun sits in stays put. Its words fade in after, on {@link landingBannerInk}.
 */
export const landingBanner: Variants = {
  hidden: { right: '100%' },
  shown: {
    right: '0%',
    transition: { duration: 0.34, delay: LANDING_BANNER, ease: 'easeOut' }
  }
}

export const landingBannerInk: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: 0.28, delay: LANDING_BANNER_INK, ease: 'easeOut' } }
}

/** The money and the chart's own surface, which arrive together: what he has, in one glance. */
export const landingHead: Variants = {
  hidden: { opacity: 0, y: 10 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.36, delay: LANDING_HEAD, ease: 'easeOut' } }
}

/**
 * The three readings drawn as one shape, grown from the point they are measured from — the
 * plotted values themselves move from nothing to the reading (`StatRadar`'s `reach`), not a
 * `scale` on the finished triangle. A spring that settles rather than bounces.
 */
export const landingGrow: Transition = {
  type: 'spring',
  stiffness: 150,
  damping: 24,
  delay: LANDING_PLOT
}

/** The stat badges, dealt round the points of the chart once the shape is out. */
export const landingBadges: Variants = dealt(LANDING_BADGES, 0.07)

/**
 * One stat badge growing in place from half its size — the title tab's arrival at badge scale.
 * **It belongs to the badge rather than to either screen** (`components/StatRadar.tsx`), each of
 * which names its own delay on the row above rather than on the badges.
 */
export const statBadgeIn: Variants = {
  hidden: { opacity: 0, scale: 0.5 },
  shown: { opacity: 1, scale: 1, transition: DEAL }
}

/** The apps, and the suggestion rows: two decks, each dealt from its own delay. */
export const landingApps: Variants = dealt(LANDING_APPS, 0.07)
export const landingRows: Variants = dealt(LANDING_ROWS, 0.06)

/**
 * One app button arriving. **`hidden` takes the pointer away as well as the ink**: an opacity of
 * zero is still a hit target, and a landing whose controls answer a click before they are on
 * screen is a screen that has not arrived yet ({@link tuck}'s argument).
 */
export const landingApp: Variants = {
  hidden: { opacity: 0, scale: 0.6, pointerEvents: 'none' },
  shown: { opacity: 1, scale: 1, pointerEvents: 'auto', transition: DEAL }
}

/** One suggestion sliding in from the left, under {@link landingRows}. */
export const landingRow: Variants = {
  hidden: { opacity: 0, x: -24, pointerEvents: 'none' },
  shown: {
    opacity: 1,
    x: 0,
    pointerEvents: 'auto',
    transition: { duration: 0.24, ease: 'easeOut' }
  }
}

/** The question, sliding in over the blob that grows to size under it. */
export const landingTitle: Variants = {
  hidden: { opacity: 0, x: -28 },
  shown: { opacity: 1, x: 0, transition: { duration: 0.3, delay: LANDING_TITLE, ease: 'easeOut' } }
}

/**
 * The tint blob behind it. **It is an element rather than `.vu-title`'s pseudo**, because motion
 * cannot address a pseudo-element — the primitive draws its blob with `::before`, and a blob that
 * has to grow has to be something a variant can reach.
 */
export const landingBlob: Variants = {
  hidden: { opacity: 0, scale: 0.6 },
  shown: {
    opacity: 1,
    scale: 1,
    transition: { ...DEAL, delay: LANDING_TITLE }
  }
}

/**
 * The well wiping in last, and **it is a clip rather than a scale**: scaling from nothing would
 * squash the placeholder text, where a clip reveals it already at size. Safe only because the
 * well carries no paper layer — a shadow must never be cut — so Go sits in its own layer.
 */
export const landingWell: Variants = {
  hidden: { clipPath: 'inset(0 100% 0 0)' },
  shown: {
    clipPath: 'inset(0 0% 0 0)',
    transition: { duration: 0.34, delay: LANDING_INPUT, ease: 'easeOut' }
  }
}

export const landingGo: Variants = {
  hidden: { opacity: 0, scale: 0.6, pointerEvents: 'none' },
  shown: {
    opacity: 1,
    scale: 1,
    pointerEvents: 'auto',
    transition: { ...DEAL, delay: LANDING_INPUT + 0.12 }
  }
}

/**
 * The whole layer, on the eye — the scene chrome's own two states at the landing's size. There is
 * no third label for leaving: `initial={false}` on an `AnimatePresence` silences mount animations
 * for its whole subtree, so a keyed remount inside it would report no completion (`GameView.tsx`).
 */
export const landingLayer: Variants = {
  shown: { opacity: 1, transition: { duration: 0.22, ease: 'easeOut' } },
  hidden: { opacity: 0, transition: { duration: 0.18, ease: 'easeIn' } }
}

/**
 * How often anything on this screen that bounces, bounces. **A `repeatDelay` rather than a
 * timer**: the spawn is the first run and every five seconds after is the repeat, which is one
 * number and nothing to clean up.
 */
const BOUNCE_EVERY = 5

/**
 * A count catching the eye again: it hops where it sits, on spawn and every five seconds after.
 * It is delayed past the deal that brings its button in, so the first hop is one the player can
 * actually see. Ends where it began, as every idle must.
 */
export const badgeBounce: TargetAndTransition = {
  y: [0, -7, 0],
  transition: {
    duration: 0.5,
    delay: LANDING_APPS + 0.3,
    ease: 'easeOut',
    repeat: Infinity,
    repeatDelay: BOUNCE_EVERY
  }
}

/**
 * The phone tile shaking on news: three turns in half a second, ending where it began. The
 * keyframes are degrees, driven on a motion value of the tile's own, so the CSS lean it is
 * drawn at stays underneath them.
 */
export const BOARD_SHAKE_TURNS = [0, -8, 8, -8, 8, -8, 8, 0]

export const BOARD_SHAKE: Transition = { duration: 0.5, ease: 'easeInOut' }

/**
 * When the phone tile has landed after the arrival, in milliseconds: the apps' deal, the two
 * seats that can be dealt before it, and its own spring settling. A duration rather than a
 * completion, the tile being one of a deck whose deal reports to nobody.
 */
export const BOARD_RING_AFTER_MS = Math.round((LANDING_APPS + 2 * 0.07 + 0.25) * 1000)

/**
 * The suggestions bouncing in a wave: one clock per row, each a beat behind the one above it, so
 * what travels down the stack reads as a single ripple. Eight clocks in a table rather than a
 * factory, since a slot can carry more than three; past the table, a row takes the last clock.
 */
const ROW_WAVE_AFTER = 4
const ROW_WAVE_STEP = 0.09

const rowBounceAt = (delay: number): TargetAndTransition => ({
  x: [0, 10, 0],
  transition: {
    duration: 0.45,
    delay,
    ease: 'easeOut',
    repeat: Infinity,
    repeatDelay: BOUNCE_EVERY
  }
})

const rowBounce: readonly TargetAndTransition[] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
  rowBounceAt(ROW_WAVE_AFTER + i * ROW_WAVE_STEP)
)

/** Which of the wave's clocks a row takes; past the table's end, the last one. */
export function rowBounceFor(index: number): TargetAndTransition {
  return rowBounce[Math.min(index, rowBounce.length - 1)]
}

/**
 * The wave standing down: every row springs home and stays there while the pointer is on one of
 * them, since a row still sliding under a reaching hand is a moving target. {@link PRESS}, not
 * {@link LIFT} — coming home is a descent, and a kick would throw the row further out first.
 */
export const rowStill: TargetAndTransition = { x: 0, transition: PRESS }

/* ---- the scene's own endings ---------------------------------------------- */

/**
 * The self-improvement screen arrives in the order the eye reads it, then tells the crossing
 * itself: the accent rises, the title grows in, the sheet arrives with the chart, the shape
 * walks to its new reading, and the stat that moved swells, swaps tier, and hops until answered.
 */
const RANK_TITLE = 0.22
const RANK_SHEET = 0.14
const RANK_SWELL = 1
const RANK_SWAP = RANK_SWELL + 0.25
const RANK_HOP = RANK_SWAP + 0.4

/**
 * How long a rise takes, and how far below the stage one starts. **They arrive quickly**: the two
 * layers are the screen turning up, not the screen's news, and the news is the pill below.
 */
const RANK_RISE: Transition = { duration: 0.3, ease: 'easeOut' }
const RANK_BELOW = '108%'

/**
 * The accent rising out of the bottom of the stage, and the sheet arriving over it a beat later
 * — the crossing's own timing, run once instead of chased. Both name `y` in `gone` as well as in
 * `hidden`, or leaving the stage would drop them instantly instead of over the veil's fade.
 */
export const rankLead: Variants = {
  hidden: { y: RANK_BELOW },
  shown: { y: 0, transition: RANK_RISE },
  gone: { y: RANK_BELOW, transition: { duration: 0.26, ease: 'easeIn' } }
}

export const rankChase: Variants = {
  hidden: { y: RANK_BELOW },
  shown: { y: 0, transition: { ...RANK_RISE, delay: RANK_SHEET } },
  gone: { y: RANK_BELOW, transition: { duration: 0.26, ease: 'easeIn' } }
}

/**
 * The title growing in place over the crown of the sheet — the tab's arrival on a screen title
 * rather than on a tab hung off one. **It does not travel**, so the eye stays on what it names.
 * `scale` is named again in `gone`, for {@link rankLead}'s reason, or the word would snap to leave.
 */
export const rankTitle: Variants = {
  hidden: { opacity: 0, scale: TAB_ARRIVAL_SCALE },
  shown: { opacity: 1, scale: 1, transition: { ...TAB_ARRIVAL, delay: RANK_TITLE } },
  gone: { opacity: 0, scale: 1, transition: LEAVE }
}

/**
 * The one answer, arriving in the stage's own corner as the sheet lands under it. It rises the
 * way a foot does rather than travelling with the sheets: it is not printed on either of them.
 */
export const rankFoot: Variants = {
  hidden: { opacity: 0, y: 16 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.3, delay: RANK_SHEET, ease: 'easeOut' } },
  gone: { opacity: 0, y: 16, transition: LEAVE }
}

/**
 * How the reading walks from the stats the reader came in with to the ones he leaves with
 * (`components/StatRadar.tsx`), delayed to start under the sheet's arrival so the triangle grows
 * *into* its new size in one movement. A spring, since a stat crossing a tier is a thing landing.
 */
export const PLOT_WALK: Transition = {
  type: 'spring',
  stiffness: 110,
  damping: 20,
  delay: RANK_SHEET + 0.4
}

/** How much bigger a pill gets for having crossed something: half again, which is a claim. */
const RAISED_SCALE = 1.5

/**
 * The badge of a stat that just crossed a tier: it **swells and stays swollen**, the loudest thing
 * on the sheet as its words change, while the pill inside it goes on beating ({@link badgePulse}).
 * It **rests where reduced motion would drop it** — a transform target lands instantly there, so
 * the swell reads as a resting state rather than a stuck frame.
 */
export const statBadgeRaised: Variants = {
  hidden: { scale: 1 },
  shown: {
    scale: RAISED_SCALE,
    transition: { type: 'spring', stiffness: 380, damping: 18, delay: RANK_SWELL }
  }
}

/**
 * The beat it keeps once swollen — this screen's idle. It swells a little further and comes
 * back rather than hopping, since the pill has already claimed its size. It rides a wrapper,
 * because the swell above already owns `scale` on the seat.
 */
export const badgePulse: Variants = {
  hidden: { scale: 1 },
  shown: {
    scale: [1, 1.08, 1],
    transition: {
      duration: 0.55,
      delay: RANK_HOP,
      ease: 'easeOut',
      repeat: Infinity,
      repeatDelay: 0.7
    }
  }
}

/**
 * The tier the reader was, and the tier he is, swapping on the swollen pill as opacities, so the
 * crossing is still told under reduced motion. The new reading starts a beat after the old one
 * leaves; they share one grid cell (`StatRadar.css`).
 */
const TIER_SWAP: Transition = { duration: 0.22, ease: 'easeOut' }

export const tierOld: Variants = {
  hidden: { opacity: 1 },
  shown: { opacity: 0, transition: { ...TIER_SWAP, delay: RANK_SWAP } }
}

export const tierNew: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { ...TIER_SWAP, delay: RANK_SWAP + 0.14 } }
}

/**
 * The heart behind the milestone panel: it arrives with the panel, then breathes on the landing
 * archways' slow clock. **Held back a beat** since it is drawn under a panel that is itself
 * arriving, or it would read as the subject rather than the ground it sits on.
 */
export const milestoneHeart: Variants = {
  hidden: { opacity: 0, scale: 0.94 },
  shown: {
    opacity: 1,
    scale: BREATH_SWELL,
    transition: {
      opacity: { duration: 0.6, delay: 0.18, ease: 'easeOut' },
      scale: { ...BREATH_SLOW, delay: 0.18 }
    }
  },
  gone: { opacity: 0, scale: 0.94, transition: LEAVE }
}

/** What she has to say for herself, dealt under the tab; each line takes {@link slideInQuick}. */
export const milestoneLines: Variants = dealt(0.24, 0.07)

/**
 * Her sprite standing over the milestone panel: she walks in from the left on the tab's own
 * spring, a beat behind the panel, and fades out with it. `x` is motion's; the zoom about her
 * feet is the sheet's own CSS `scale`, and the two compose. `gone` names `x` too, or leaving
 * reverts to `hidden`.
 */
export const milestoneSprite: Variants = {
  hidden: { opacity: 0, x: -48 },
  shown: {
    opacity: 1,
    x: 0,
    transition: { ...TAB_ARRIVAL, delay: 0.1, opacity: { duration: 0.25, delay: 0.1 } }
  },
  gone: { opacity: 0, x: 0, transition: LEAVE }
}

/* ---- the Bunnyboard ------------------------------------------------------- */

/**
 * The hover on the answer that backs out of what the phone's own card is asking: {@link quietLift}
 * with one colour changed — a quiet control's `--vu-tint` is the tint well that card already is.
 */
export const cancelLift: TargetAndTransition = {
  scale: 1.1,
  backgroundColor: 'var(--vu-highlight)',
  transition: LIFT
}

/**
 * The two ears over the phone's own top edge, breathing on one clock in opposite phase, the
 * landing archways' arrangement at a mark's size. They take 3% rather than {@link breatheMark}'s
 * 6%: a hard edge crossing the pixel grid every frame reads as a crawl rather than a breath.
 */
export const earBreath: TargetAndTransition = { scale: BREATH_SWELL, transition: BREATH }

export const earBreathLate: TargetAndTransition = {
  scale: BREATH_SWELL,
  transition: { ...BREATH, delay: 2 }
}

/**
 * The `···` bubble, which means a reply is queued and never that a call is running: three dots
 * on one clock, each a beat behind the one above. A table rather than a factory, so their
 * identity survives re-renders; an opacity, so the dots keep moving under reduced motion.
 */
const TYPING_DOT: Transition = { duration: 1.2, repeat: Infinity, ease: 'easeInOut' }

export const typingDot: readonly TargetAndTransition[] = [0, 1, 2].map((i) => ({
  opacity: [0.3, 1, 0.3],
  transition: { ...TYPING_DOT, delay: i * 0.2 }
}))

/* ---- the map -------------------------------------------------------------- */

/**
 * A face on a pin, breathing — the map's idle, on the archways' slow clock; the pins themselves
 * stand still. Built per face rather than named ({@link spriteBreath}): the phase is a negative
 * delay so no two faces on the map rise together, and the caller holds the result for its life.
 */
const FACE_SWELL = [1, 1.04, 1]

export function faceBreath(phase: number): TargetAndTransition {
  return {
    scale: FACE_SWELL,
    transition: { ...BREATH_SLOW, delay: -phase * (BREATH_SLOW.duration ?? 0) }
  }
}

/* ---- the shop ------------------------------------------------------------- */

/**
 * A card's foot swapping between its price-and-Buy face and its confirm one: one preset under
 * `AnimatePresence mode="wait"`, sharing a grid cell so the card never changes height between
 * them. Its labels are its own rather than `hidden`/`shown`, so the deal above cannot reach it.
 */
export const shopConfirm: Variants = {
  from: { opacity: 0, y: 8 },
  at: { opacity: 1, y: 0, transition: { duration: 0.048, ease: 'easeOut' } },
  out: { opacity: 0, y: -8, transition: { duration: 0.04, ease: 'easeIn' } }
}

/**
 * `No` on a shelf: the app's quiet tint in the **merchant's** own tone. {@link quietLift} reaches
 * for `--vu-tint`, an app role, and a role may not appear inside a merchant's pane; the fallback
 * is what lets the identical card stand in the inventory panel, which declares no shop key.
 */
export const shopQuietLift: TargetAndTransition = {
  scale: 1.1,
  backgroundColor: 'var(--shop-quiet-lift, var(--vu-tint))',
  transition: LIFT
}

/**
 * LUXURYNOW's idle, and the one shelf that has no decoration to breathe: its masthead rule fades
 * instead. **An opacity rather than a scale**, so it goes on running under reduced motion — and
 * because the shop's whole argument is that nothing on it moves.
 */
export const shopRule: TargetAndTransition = {
  opacity: [1, 0.55, 1],
  transition: BREATH_SLOW
}

/**
 * A shop tab under the cursor. **It rises, and it neither scales nor tints**: a scale would open
 * the seam where the tab joins the pane's bottom edge, and the fill in force is the merchant's own
 * field — a *state* a hover may never animate ({@link toggleLift}'s rule). `Shop.css` keeps every
 * tab's foot behind the pane's edge by more than this rise, so it can't show daylight underneath.
 */
export const tabRaise: TargetAndTransition = { y: -4, transition: LIFT }

/** And back down onto the pane. {@link PRESS}, which carries no kick — the tab is descending. */
export const tabPress: TargetAndTransition = { y: 0, transition: PRESS }

/**
 * The shop's own clock, read outward from the corner the eye starts in: the way out and name,
 * then the shelf, the tabs, and last the balance — the loudest reading, read when Buy is pressed.
 */
const SHOP_PANE = 0.06
const SHOP_DECOR_LATE = 0.18
const SHOP_TABS = 0.14
const SHOP_MONEY = 0.24

export const shopHead: Variants = {
  hidden: { opacity: 0, y: -12 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } },
  gone: { opacity: 0, y: -12, transition: LEAVE }
}

/** The merchant's field arriving under the tabs, which is the whole page turning up. */
export const shopPane: Variants = {
  hidden: { opacity: 0, y: 24 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.3, delay: SHOP_PANE, ease: 'easeOut' } },
  gone: { opacity: 0, y: 24, transition: LEAVE }
}

/** One tab rising out of the pane it opens; the row deals them. */
export const shopTab: Variants = {
  hidden: { opacity: 0, y: 18 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' } },
  gone: { opacity: 0, transition: LEAVE }
}

/**
 * The balance, arriving last. **Opacity and `y`, and deliberately no `scale`**: the debit row
 * inside it resolves `height: 'auto'` by measuring, which a scaling ancestor would report wrong.
 */
export const shopMoney: Variants = {
  hidden: { opacity: 0, y: -14 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.34, delay: SHOP_MONEY, ease: 'easeOut' } },
  gone: { opacity: 0, y: -14, transition: LEAVE }
}

/** What the tab row's own deal is timed by, so the strip reads left to right as it lands. */
export const SHOP_TABS_DEAL: Variants = {
  hidden: {},
  shown: { transition: { delayChildren: stagger(0.04, { startDelay: SHOP_TABS }) } }
}

/**
 * The pane's two corner archways, fading in and then breathing on one clock in opposite phase —
 * a `delay` of half the period so reduced motion never leaves one permanently swollen. Drawn in
 * `--shop-decor`, the one idle in the app coloured by a custom property rather than the palette.
 */
export const shopDecor: Variants = {
  hidden: { opacity: 0 },
  shown: {
    opacity: 1,
    scale: BREATH_SWELL,
    transition: {
      opacity: { duration: 0.5, delay: SHOP_PANE, ease: 'easeOut' },
      scale: BREATH_SLOW
    }
  },
  gone: { opacity: 0, transition: LEAVE }
}

export const shopDecorLate: Variants = {
  hidden: { opacity: 0 },
  shown: {
    opacity: 1,
    scale: BREATH_SWELL,
    transition: {
      opacity: { duration: 0.5, delay: SHOP_DECOR_LATE, ease: 'easeOut' },
      scale: { ...BREATH_SLOW, delay: 3 }
    }
  },
  gone: { opacity: 0, transition: LEAVE }
}

/* ---- the idle scene ------------------------------------------------------- */

/** Seconds one background is held: a slow pan across it, then the next fades in over it. */
const PAN_SECONDS = 40
export const CROSSFADE_SECONDS = 1.6

/**
 * The camera creeping right across a background that is zoomed just past the frame. The
 * translate is a share of the element's own width, and stays inside the overhang the scale
 * buys — at 1.08 that is 4% a side, so 3% never shows an edge.
 */
export const kenBurns: TargetAndTransition = {
  scale: 1.14,
  x: '-3%',
  transition: { duration: PAN_SECONDS, ease: 'linear' }
}

export const kenBurnsFrom = { scale: 1.08, x: '3%' }

/** The wordmark breathing, barely. */
export const breathe: TargetAndTransition = {
  scale: [1, 1.018, 1],
  transition: { duration: 4.5, delay: 1.4, repeat: Infinity, ease: 'easeInOut' }
}

/**
 * A small mark breathing — the roster's "+". It moves further than the wordmark does because it
 * is smaller: 1.8% of a 64px circle is a pixel, not a breath. That much motion over a small glyph
 * is why `.vu-manage-plus` asks for `will-change`, or the mark re-rasterizes and snaps to the
 * pixel grid on every frame of the swell.
 */
export const breatheMark: TargetAndTransition = { scale: [1, 1.06, 1], transition: BREATH }

/** A screen's corner archway, breathing where it stands. */
export const breatheDecor: TargetAndTransition = { scale: BREATH_SWELL, transition: BREATH_SLOW }

/**
 * A CG on the stage, breathing a third of what an archway does, being the whole picture rather
 * than a mark in a corner. Named rather than built per caller ({@link spriteBreath}): only one
 * CG is on the stage at a time, so there is no row for it to be out of step with.
 */
export const breatheCg: TargetAndTransition = {
  scale: [1, 1.008, 1],
  transition: BREATH_SLOW
}

/**
 * A sprite standing on the stage, breathing: she rises more than she widens, a chest filling
 * upward. Built per caller rather than named, since the duration is the character's own pace and
 * the delay is negative, starting her part-way through the cycle.
 */
export function spriteBreath(period: number, delay: number): TargetAndTransition {
  return {
    scaleY: [1, 1.003, 1],
    scaleX: [1, 1.003, 1],
    transition: { duration: period, delay, repeat: Infinity, ease: 'easeInOut' }
  }
}

/**
 * The stage lights: whoever is speaking stands at full brightness and everyone else falls back
 * a little — brightness rather than opacity, since portraits overlap and a translucent one would
 * show through. A duration and not a spring: it is a light coming up, not something he started.
 */
const SPRITE_LIGHT: Transition = { duration: 0.2, ease: 'easeInOut' }

export const spriteLit: TargetAndTransition = {
  filter: 'brightness(1)',
  transition: SPRITE_LIGHT
}

export const spriteDim: TargetAndTransition = {
  filter: 'brightness(0.7)',
  transition: SPRITE_LIGHT
}

/**
 * The same breath under an arrival, for decoration that fades in and then never stops. One
 * variant carries both, since one element gets one `animate`, and it is written out rather than
 * composed from {@link fadeIn} so it stays a stable module-scope constant across renders.
 */
export const decorIn: Variants = {
  hidden: { opacity: 0, y: 8 },
  shown: {
    opacity: 1,
    y: 0,
    scale: BREATH_SWELL,
    transition: { default: { duration: 0.5, ease: 'easeOut' }, scale: BREATH_SLOW }
  }
}

/**
 * The two halves of a day breathing in opposite phase, in the faint opacity the word is drawn at
 * so a `+` still reads through it. No `ease` is named: an accelerated opacity animates over
 * WAAPI, whose default is `easeOut` rather than the rest of this file's `easeInOut`.
 */
const HALF_MARK_LIT = 0.1
const HALF_MARK_DIM = HALF_MARK_LIT / 2
const HALF_MARK_BREATH: Transition = { duration: 3, repeat: Infinity }

export const halfMarkDay: TargetAndTransition = {
  opacity: [HALF_MARK_DIM, HALF_MARK_LIT, HALF_MARK_DIM],
  transition: HALF_MARK_BREATH
}

export const halfMarkNight: TargetAndTransition = {
  opacity: [HALF_MARK_LIT, HALF_MARK_DIM, HALF_MARK_LIT],
  transition: HALF_MARK_BREATH
}

/** Something waiting its turn in a queue: one slow turn, forever. */
export const spin: TargetAndTransition = {
  rotate: 360,
  transition: { duration: 5, ease: 'linear', repeat: Infinity }
}

/** Something working right now, with no count to show for it yet. */
export const pulse: TargetAndTransition = {
  opacity: [1, 0.45, 1],
  transition: { duration: 1.4, ease: 'easeInOut', repeat: Infinity }
}

/** A progress bar growing to the share it has reached — eased, and never overshooting it. */
export const FILL: Transition = { duration: 0.45, ease: 'easeOut' }

/* ---- bursts --------------------------------------------------------------- */

/**
 * The one one-shot in the vocabulary: particles that leave a thing the moment it lands and are
 * gone within a second or two, ending at nothing so reduced motion's snap to that end still
 * reads as the fade having said something. `components/Burst.tsx` is the one thing that reads them.
 */
const SPLASH_COUNT = 8
const SPLASH: Transition = { duration: 0.55, ease: 'easeOut' }

/** A splash off a word: dots thrown outward on evenly spread bearings, every other one further. */
export const splashDots: readonly TargetAndTransition[] = Array.from(
  { length: SPLASH_COUNT },
  (_, i) => {
    const bearing = (i / SPLASH_COUNT) * Math.PI * 2 + Math.PI / 8
    const reach = i % 2 === 0 ? 36 : 24
    return {
      x: [0, Math.cos(bearing) * reach],
      y: [0, Math.sin(bearing) * reach - 6],
      opacity: [1, 1, 0],
      scale: [0.4, 1, 0.3],
      transition: { ...SPLASH, delay: (i % 3) * 0.03 }
    }
  }
)

const FLOAT_COUNT = 7
const FLOAT: Transition = { duration: 1.7, ease: 'easeOut' }

/**
 * Glyphs rising off a girl: each starts a beat after the last, sways as it climbs, and fades
 * out near the top of its rise. The sway alternates sides so the column reads as drifting rather
 * than as one shape lifting.
 */
export const floatGlyphs: readonly TargetAndTransition[] = Array.from(
  { length: FLOAT_COUNT },
  (_, i) => {
    const sway = (i % 2 === 0 ? 1 : -1) * (14 + (i % 3) * 6)
    return {
      y: [0, -80, -180, -260],
      x: [0, sway, -sway * 0.6, sway * 0.3],
      opacity: [0, 1, 1, 0],
      scale: [0.5, 1.15, 1, 0.9],
      transition: { ...FLOAT, delay: i * 0.11 }
    }
  }
)

/**
 * The white the stage flares at a climax: up in a blink and gone over the length of the sound it
 * rides. Opacity and nothing else, so a reader who asked for less motion is still told; the layer
 * that carries it goes with the count that raised it.
 */
export const flareStart: TargetAndTransition = { opacity: 0 }

export const climaxFlare: TargetAndTransition = {
  opacity: [0, 1, 0],
  transition: { duration: 2.8, times: [0, 0.05, 1], ease: ['easeOut', 'easeIn'] }
}
