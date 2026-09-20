import { Fragment, useState, type JSX } from 'react'
import { motion } from 'motion/react'
import { slotFullLabel, slotOf, TIME_SLOT_ROWS } from '@shared/classes'
import { FIRST_WEEKEND_DAY, WEEK_COLUMNS, WEEK_DAY_HEADERS } from '@shared/jobs'
import type { ClassEntry, ClassSlot, TimeSlot } from '@shared/types'
import { slotHalf } from '../prompts/gameDate'
import { CourseCode, CourseFaces, teacherOf } from './CoursePickerModal'
import {
  gestures,
  halfMarkDay,
  halfMarkNight,
  peek,
  quietPress,
  rowLift,
  rowPress,
  tuck
} from './motion'
import { CloseIcon, MoonIcon, SunIcon } from './screenIcons'
import '../vu_styles/CourseSchedule.css'

/**
 * The reader's week: seven columns over a day and a night row, read Sunday-first off
 * `WEEK_COLUMNS` while the slot indices stay Monday-zero. Shared by the registrar's page and
 * the mid-semester add/drop editor over one stylesheet.
 */

export interface CourseWeekProps {
  /** The save's catalog, keyed by course code. */
  classes: Record<string, ClassEntry>
  /** Sparse `ClassSlot` → course code. */
  schedule: Record<number, string>
  /** Omit both handlers and the week is a reading rather than a form. */
  onPick?: (slot: ClassSlot) => void
  onDrop?: (slot: ClassSlot) => void
  /** Hours something else already holds, mapped to what holds them — his shifts. */
  blocked?: Partial<Record<ClassSlot, string>>
  /** Which classmates ride an enrolled tile. Omit and the week shows nobody at all. */
  facesOf?: (entry: ClassEntry) => readonly string[]
  /** The shorter row a modal has the height for, rather than the page's. */
  compact?: boolean
}

export function CourseWeek({
  classes,
  schedule,
  onPick,
  onDrop,
  blocked,
  facesOf,
  compact = false
}: CourseWeekProps): JSX.Element {
  return (
    /* The cells are written flat, in reading order, so the grid places them itself; the word
       behind each row is the one thing placed by hand, and it is `absolute` so it takes no
       cell. */
    <div className={`vu-courses-grid${compact ? ' vu-courses-grid--compact' : ''}`}>
      {WEEK_COLUMNS.map((weekday) => (
        <div
          key={weekday}
          className={`vu-courses-day${weekday >= FIRST_WEEKEND_DAY ? ' vu-courses-day--off' : ''}`}
        >
          {WEEK_DAY_HEADERS[weekday]}
        </div>
      ))}

      {TIME_SLOT_ROWS.map(({ time }) => (
        <Fragment key={time}>
          <DayHalfMark time={time} />
          {WEEK_COLUMNS.map((weekday, column) => {
            // No weekend `ClassSlot` exists: the campus rests, and the grid says so before
            // day one. The two of them are the ends of the row, which is what rounds
            // it into one pill.
            if (weekday >= FIRST_WEEKEND_DAY) {
              const end = column === 0 ? 'start' : 'end'
              return (
                <div className={`vu-courses-off vu-courses-off--${end}`} key={weekday}>
                  {/* Half the row's height in the theme's own surface tone, so it lifts out
                      of the weekend hatching without competing with a tile; the stroke is
                      thin because 2.75 is a hairline at its own 14px and a slab
                      at 126. */}
                  {end === 'start' &&
                    (time === 0 ? (
                      <SunIcon className="vu-courses-half-mark" strokeWidth={1} />
                    ) : (
                      <MoonIcon className="vu-courses-half-mark" strokeWidth={1} />
                    ))}
                </div>
              )
            }

            const slot = slotOf(weekday, time)
            const entry = classes[schedule[slot] ?? '']
            if (!entry) {
              // Somebody else has the hour and the tile names him, which is the whole of what
              // it owes: it opens nothing, so it is a `div` and wears no gesture.
              const owner = blocked?.[slot]
              if (owner) {
                return (
                  <div className="vu-courses-blocked" key={weekday}>
                    {owner}
                  </div>
                )
              }
              if (!onPick) {
                return <div className="vu-courses-empty" key={weekday} />
              }
              return (
                <motion.button
                  key={weekday}
                  className="vu-courses-empty"
                  type="button"
                  aria-label={`Enroll in a course on ${slotFullLabel(slot)}`}
                  {...gestures(false, rowLift, rowPress)}
                  onClick={() => onPick(slot)}
                >
                  +
                </motion.button>
              )
            }

            return (
              <EnrolledTile
                key={weekday}
                entry={entry}
                faces={facesOf ? facesOf(entry) : null}
                onDrop={onDrop ? () => onDrop(slot) : undefined}
              />
            )
          })}
        </Fragment>
      ))}
    </div>
  )
}

/**
 * One hour the reader has filled. A `div`, not a button — nothing here opens. The ✕ that drops
 * the course is a **sibling** of the tile content rather than nested in it, and shows on the
 * cell's hover or on tabbing to it; a week with no drop handler draws the tile without it.
 */
function EnrolledTile({
  entry,
  faces,
  onDrop
}: {
  entry: ClassEntry
  faces: readonly string[] | null
  onDrop?: () => void
}): JSX.Element {
  // Held on the tile rather than in the view: a course dropped under the cursor takes its
  // hover with it, and motion reports no hover ending for an element that unmounts.
  const [hovered, setHovered] = useState(false)

  return (
    <motion.div
      className="vu-courses-cell"
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
    >
      <div className="vu-courses-tile vu-paper">
        {/* The code's own row clears the ✕ riding the tile's corner. Who teaches it reads
            on its own line underneath, and the title underneath both. */}
        <div className="vu-courses-tags">
          <CourseCode entry={entry} />
        </div>
        <div className="vu-courses-teacher">{teacherOf(entry)}</div>
        <div className="vu-courses-name">{entry.name}</div>
        {/* Who else is in the room, at the foot of the tile: a face in a list is quiet, and
            these open nothing. A room he can name nobody in yet keeps the row and says so. */}
        <CourseFaces faces={faces} />
      </div>

      {onDrop && (
        <motion.button
          className="vu-x vu-courses-x"
          type="button"
          aria-label={`Drop ${entry.name}`}
          initial={false}
          animate={hovered ? peek : tuck}
          whileFocus={peek}
          whileTap={quietPress}
          onClick={onDrop}
        >
          <CloseIcon />
        </motion.button>
      )}
    </motion.div>
  )
}

/**
 * Which half of the day a row of the week is, text fit to the block's width
 * (`vu_styles/CourseSchedule.css`) and breathing as the week's idle, opposite day and night.
 */
function DayHalfMark({ time }: { time: TimeSlot }): JSX.Element {
  return (
    <motion.svg
      className={`vu-courses-half vu-courses-half--${slotHalf(time)}`}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      animate={time === 0 ? halfMarkDay : halfMarkNight}
    >
      <text
        x="50"
        y="50"
        textLength="95"
        lengthAdjust="spacingAndGlyphs"
        textAnchor="middle"
        dominantBaseline="central"
      >
        {time === 0 ? 'DAYTIME' : 'NIGHTTIME'}
      </text>
    </motion.svg>
  )
}
