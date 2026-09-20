import { useEffect, type JSX } from 'react'
import { motion, type MotionValue } from 'motion/react'
import { formatNumericGameDate, formatWeekday } from '../prompts/gameDate'
import { weekOf } from '../prompts/occasions'
import type { SlotStamp } from '../stores/crossingStore'
import type { ScreenTheme } from '../views/clockTheme'
import { HalfMarkIcon, halfMarkKindOf } from '../views/screenIcons'
import {
  markStill,
  SPLASH_MS,
  SPLASH_OCCASION_MS,
  splashArrive,
  splashMark,
  splashMeta,
  splashMetaItem,
  splashOccasion,
  splashPill,
  splashSpinDay,
  splashSpinNight,
  splashWord
} from '../views/motion'
import '../vu_styles/DayChangeSplash.css'

/**
 * The day-change splash: what the curtain says while it is down. Drawn **inside the curtain
 * sheet**, so the sheet's own edge reveals and takes it away, and held in place by the
 * counter-translate the bunny rides (`Crossing.tsx`). Reads no store: everything is on the stamp.
 */
export function DayChangeSplash({
  stamp,
  theme,
  fade,
  shape,
  x,
  onDone
}: {
  stamp: SlotStamp
  /**
   * The half of the day the curtain is opening onto. It is carried rather than inherited so the
   * splash arrives in the colours it will be read in even while the polarity is still turning
   * over underneath it.
   */
  theme: ScreenTheme
  /** Whether that polarity is still turning under it, which is {@link splashArrive}'s whole job. */
  fade: boolean
  /** Which rest offset the sheet around it is sitting at — the bunny's three, and its reason. */
  shape: 'out' | 'cut' | 'still'
  /**
   * The sheet's own travel, undone, on the **root alone**: every layer inside carries a
   * transform of its own, and a second one on the same element silently replaces the first.
   * Null under reduced motion, where no sheet travels and there is nothing to undo.
   */
  x: MotionValue<number> | null
  onDone: () => void
}): JSX.Element {
  const day = stamp.time === 0
  // What the mark is: the half's own sun or crescent, or the sky over the slot the curtain is
  // opening onto.
  const kind = halfMarkKindOf(stamp.weather, !day)

  // What the curtain is held for is the player reading a date, so it is a duration rather than
  // the last layer's completion — and which layer is last depends on there being an occasion,
  // which is also the one that buys the slot a longer beat.
  const occasion = stamp.occasion
  useEffect(() => {
    const timer = setTimeout(onDone, SPLASH_MS + (occasion ? SPLASH_OCCASION_MS : 0))
    return () => clearTimeout(timer)
  }, [occasion, onDone])

  // The day's own name and the readings that place it, unless the stamp carries words of its
  // own to say instead — a crossing onto a screen the calendar has no date for.
  const weekday = formatWeekday(stamp.date)
  const word = stamp.words?.word ?? weekday

  return (
    <motion.div
      className={`vu-splash vu-splash--${shape}`}
      data-theme={theme}
      style={x ? { x } : undefined}
      variants={splashArrive}
      initial={fade ? 'over' : 'settled'}
      animate="settled"
      aria-hidden="true"
    >
      {/* Two elements because they are two transforms: the slide rides the box and the turn
          rides the mark inside it. A wet sky's mark holds still and steps inside its own
          drawing, and the key puts the wrapper back at nothing when the mark changes under it. */}
      <motion.div className="vu-splash-mark" variants={splashMark} initial="hidden" animate="shown">
        <motion.div
          className="vu-splash-turn"
          key={kind}
          animate={kind === 'sun' ? splashSpinDay : kind === 'moon' ? splashSpinNight : markStill}
        >
          <HalfMarkIcon kind={kind} className="vu-splash-face" strokeWidth={0.7} />
        </motion.div>
      </motion.div>

      <div className="vu-splash-line">
        {/* The word and the surface it is written on, in one box the word's own width sets: the
            surface is a box of its own inside it, anchored to both of that box's edges plus a
            lead, so `Friday` and `Wednesday` are the same statement at two lengths and nothing
            here is measured. The word fades on its own variant rather than the box carrying it,
            or the pill inside would be held at nothing until the word's own delay was up. */}
        <span className="vu-splash-word">
          <span className="vu-splash-pillbox">
            <motion.div
              className="vu-splash-pill vu-paper"
              variants={splashPill}
              initial="hidden"
              animate="shown"
            />
          </span>
          <motion.span
            className="vu-splash-ink"
            variants={splashWord}
            initial="hidden"
            animate="shown"
          >
            {word}
          </motion.span>
        </span>

        {/* Absolute, so the readings under the pill do not push the day off the middle of the
            stage — it is the focal point, and a stack centred as a whole would sit it high. */}
        <div className="vu-splash-below">
          <motion.div
            className="vu-splash-meta"
            variants={splashMeta}
            initial="hidden"
            animate="shown"
          >
            {stamp.words ? (
              <motion.span variants={splashMetaItem}>{stamp.words.meta}</motion.span>
            ) : (
              <>
                <motion.span variants={splashMetaItem}>{day ? 'Morning' : 'Evening'}</motion.span>
                <motion.span variants={splashMetaItem}>Week {weekOf(stamp.date) + 1}</motion.span>
                <motion.span className="vu-splash-figure" variants={splashMetaItem}>
                  {formatNumericGameDate(stamp.date)}
                </motion.span>
              </>
            )}
          </motion.div>

          {stamp.occasion && (
            <motion.div
              className="vu-splash-occasion"
              variants={splashOccasion}
              initial="hidden"
              animate="shown"
            >
              {stamp.occasion}
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  )
}
