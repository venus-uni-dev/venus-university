import {
  useCallback,
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode
} from 'react'
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  type MotionValue,
  type Transition
} from 'motion/react'
import { screenTheme, type ScreenTheme } from '../views/clockTheme'
import { BunnyMark } from '../views/screenIcons'
import {
  bunnyHop,
  bunnyLeap,
  crossChase,
  crossingReason,
  crossLead,
  CURTAIN_HOLD_MS,
  THEME_FADE
} from '../views/motion'
import {
  curtainCovered,
  holdDone,
  revealed,
  useCrossingStore,
  type CrossingPhase,
  type SlotStamp
} from '../stores/crossingStore'
import { useSettingsStore } from '../stores/settingsStore'
import { DayChangeSplash } from './DayChangeSplash'
import '../vu_styles/Crossing.css'

/**
 * The crossing: a translucent sheet wipes the stage behind an archway and an opaque one chases
 * it; under the second the screen changes, waits and speaks (the hold, the theme handoff, the
 * splash). Every decision is the store's; this draws them.
 */

/**
 * One sheet, driven through a motion value rather than the `animate` prop: unlike the prop's
 * `onAnimationComplete`, which re-fires on any render finding its target already met, a value's
 * `onComplete` fires once, on an actual finish, and never on a `stop()`.
 */
function Sheet({
  kind,
  cut,
  still,
  travel,
  transition,
  run,
  x,
  onCovered,
  children
}: {
  kind: 'scrim' | 'curtain'
  cut: boolean
  still: boolean
  travel: number
  transition: Transition
  /** Whether this sheet is moving in this phase, or standing where the last run left it. */
  run: boolean
  x: MotionValue<number>
  onCovered?: () => void
  children?: ReactNode
}): JSX.Element {
  const opacity = useMotionValue(1)

  useLayoutEffect(() => {
    // Both shapes rest at 0 and travel from there; the offset itself is CSS's.
    x.set(0)
    opacity.set(cut ? 1 : 0)
    if (!run) return

    const controls = still
      ? animate(opacity, cut ? 0 : 1, { ...transition, onComplete: onCovered })
      : animate(x, travel, { ...transition, onComplete: onCovered })
    return () => controls.stop()
  }, [run, cut, still, travel, transition, onCovered, x, opacity])

  return (
    <motion.div
      className={`vu-crossing-sheet vu-crossing-sheet--${kind}${cut ? ' vu-crossing-sheet--cut' : ''}${still ? ' vu-crossing-sheet--still' : ''}`}
      style={still ? { opacity } : { x }}
    >
      {children}
    </motion.div>
  )
}

/**
 * One crossing. Mounted fresh for each, so it draws the hour on the way in exactly as a screen
 * does — it sits outside every screen and inherits nothing — and measures the stage once.
 */
function CrossingLayer({
  phase,
  waited,
  ready,
  from,
  to,
  fade,
  splash,
  reason,
  asking
}: {
  phase: CrossingPhase
  waited: boolean
  ready: boolean
  from: ScreenTheme | null
  to: ScreenTheme | null
  fade: boolean
  splash: SlotStamp | null
  reason: string | null
  asking: boolean
}): JSX.Element {
  // The theme the cover goes up in: the screen's own where the caller named it, so the wipe
  // cannot disagree with what it is wiping over, and the clock everywhere else.
  const [opening] = useState(
    () => from ?? screenTheme(useSettingsStore.getState().settings?.forceTime, new Date())
  )
  const still = useReducedMotion() ?? false

  // The three things the curtain owes before it may open, the last two starting already done
  // where there is nothing to do. The performance begins at full cover and nowhere else.
  const [rested, setRested] = useState(false)
  const [crossed, setCrossed] = useState(!fade)
  const [said, setSaid] = useState(splash === null)
  // A cover raised on a question performs nothing until it is answered.
  const performing = phase === 'holding' && !asking

  // **The quiet hold, which every crossing owes**: a beat of flat colour before anything
  // happens on the curtain, so a cover that has nothing to say still reads as a curtain rather
  // than as a flicker — and so a handoff has somewhere to start from that is not the wipe.
  useEffect(() => {
    if (!performing) return
    const timer = setTimeout(() => setRested(true), CURTAIN_HOLD_MS)
    return () => clearTimeout(timer)
  }, [performing])

  useEffect(() => {
    if (performing && rested && crossed && said) holdDone()
  }, [performing, rested, crossed, said])

  // **The splash is raised once and never taken down**: the curtain leaving is what ends it, via
  // the flag marking it finished speaking. It arrives *over* the polarity turning rather than
  // after, wearing the destination's theme from its first frame so the two read as one movement.
  // `useCallback`, since a fresh handler on every re-render would restart the splash's own clock.
  const [saying, setSaying] = useState(false)
  useEffect(() => {
    if (performing && rested && splash) setSaying(true)
  }, [performing, rested, splash])
  const finishSaying = useCallback(() => setSaid(true), [])

  const root = useRef<HTMLDivElement>(null)
  // How far a sheet travels: the stage plus its own cap. Measured rather than written, since
  // the stage reflows between 4:3 and 16:9; under the page zoom it measures the stage.
  const [travel, setTravel] = useState(0)
  useLayoutEffect(() => {
    const node = root.current
    if (node) setTravel(node.clientWidth + node.clientHeight / 2)
  }, [])

  const scrimX = useMotionValue(0)
  const curtainX = useMotionValue(0)
  const bunnyY = useMotionValue(0)
  // The sheet's own travel, undone by subscribing to its `x` rather than `useTransform`, so
  // whatever rides the curtain holds its place on the stage while the sheet slides past it.
  const heldX = useMotionValue(0)
  useLayoutEffect(() => {
    heldX.set(-curtainX.get())
    return curtainX.on('change', (v) => heldX.set(-v))
  }, [curtainX, heldX])

  const cut = phase !== 'closing'
  // Closing, both sheets run. Holding, neither does. Opening, both run again — in the other
  // order, since the curtain is on top and has to leave before the scrim can be seen at all.
  const run = (phase === 'closing' || phase === 'opening') && travel > 0

  // The hop while there is something to load, and the leap the moment there is not. **It is
  // `ready` and not the reveal that ends it**: the curtain goes on saying its piece after the
  // wait is over, and a bunny still hopping there would be reporting a wait that has ended.
  useEffect(() => {
    if (still || !waited) return
    if (!ready) {
      const controls = animate(bunnyY, [0, -26, 0], bunnyHop)
      return () => controls.stop()
    }
    const controls = animate(bunnyY, [null, -60, 320], bunnyLeap)
    return () => controls.stop()
  }, [ready, waited, still, bunnyY])

  const shape = still ? 'still' : cut ? 'cut' : 'out'

  return (
    <div className="vu-crossing" ref={root} data-theme={crossed && to ? to : opening}>
      <Sheet
        kind="scrim"
        cut={cut}
        still={still}
        travel={travel}
        transition={cut ? crossChase : crossLead}
        run={run}
        x={scrimX}
        onCovered={cut ? revealed : undefined}
      />
      <Sheet
        kind="curtain"
        cut={cut}
        still={still}
        travel={travel}
        transition={cut ? crossLead : crossChase}
        run={run}
        x={curtainX}
        onCovered={cut ? undefined : curtainCovered}
      >
        {/* The mark and, where the caller named one, what the wait is for. **They stand on one
            element** so that the counter-translate holding them on the stage is written once:
            the bunny keeps the hop and the leap, which are its own, and the words beside it
            neither hop nor leap — a caption that bounced would be reporting the wait twice. */}
        {waited && (
          <motion.div
            className={`vu-crossing-stand ${still ? 'vu-crossing-stand--still' : cut ? 'vu-crossing-stand--cut' : 'vu-crossing-stand--out'}`}
            style={still ? undefined : { x: heldX }}
          >
            {reason && (
              <motion.span
                className="vu-crossing-reason"
                variants={crossingReason}
                initial="gone"
                animate={ready ? 'gone' : 'shown'}
              >
                {reason}
              </motion.span>
            )}
            <motion.div className="vu-crossing-bunny" style={{ y: bunnyY }}>
              <BunnyMark />
            </motion.div>
          </motion.div>
        )}

        {/* The polarity crossed under an opaque sheet: the destination's own curtain fades in
            over the origin's, and the layer's `data-theme` flips in the same commit this
            unmounts — so the sheet under it is already the colour the overlay had reached and
            nothing flashes. It covers the bunny while the polarity turns over, and the splash
            below is written after it, being what the turn is happening *for*. */}
        {performing && rested && !crossed && (
          <motion.div
            className="vu-crossing-cross"
            data-theme={to ?? opening}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={THEME_FADE}
            onAnimationComplete={() => setCrossed(true)}
          />
        )}

        {saying && splash && (
          <DayChangeSplash
            stamp={splash}
            theme={to ?? opening}
            fade={fade}
            shape={shape}
            x={still ? null : heldX}
            onDone={finishSaying}
          />
        )}
      </Sheet>
    </div>
  )
}

/** The layer itself: nothing at all between crossings. */
export function Crossing(): JSX.Element | null {
  const phase = useCrossingStore((s) => s.phase)
  const waited = useCrossingStore((s) => s.waited)
  const ready = useCrossingStore((s) => s.ready)
  const from = useCrossingStore((s) => s.from)
  const to = useCrossingStore((s) => s.to)
  const fade = useCrossingStore((s) => s.fade)
  const splash = useCrossingStore((s) => s.splash)
  const reason = useCrossingStore((s) => s.reason)
  const asking = useCrossingStore((s) => s.asking)
  if (phase === 'idle') return null
  return (
    <CrossingLayer
      phase={phase}
      waited={waited}
      ready={ready}
      from={from}
      to={to}
      fade={fade}
      splash={splash}
      reason={reason}
      asking={asking}
    />
  )
}
