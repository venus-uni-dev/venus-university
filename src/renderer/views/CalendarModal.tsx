import { useEffect, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { kindSentenceOf } from '@shared/academics'
import { FINAL_DATE, studentsOf, TIME_SLOTS } from '@shared/classes'
import { jobDefOf, shiftSlotOf, WEEK_COLUMNS, WEEK_DAY_HEADERS } from '@shared/jobs'
import type { CalendarEvent, ClassEntry, Occasion, TimeSlot } from '@shared/types'
import { weatherAt, type Weather } from '@shared/weather'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import {
  formatDatePart,
  formatGameDate,
  formatShortGameDate,
  formatTimeSlot,
  formatWeekday,
  shiftWeekdayOf,
  slotHalf,
  weekdayOf
} from '../prompts/gameDate'
import { everAttended } from '../prompts/classProgress'
import { classSlotOf, jobClosedOn, occasionsOn } from '../prompts/occasions'
import { profileUrl, useSpriteVersion } from '../stores/characterStore'
import { useGameStore } from '../stores/gameStore'
import type { ScreenTheme } from './clockTheme'
import {
  dealt,
  gestures,
  lift,
  markStill,
  panelUnderTab,
  press,
  quietLift,
  quietPress,
  rowLift,
  rowPress,
  slideInQuick,
  stampSpinDay,
  stampSwayNight,
  veilIn
} from './motion'
import { ChevronIcon, HalfMarkIcon, halfMarkKindOf, MoonIcon, SunIcon } from './screenIcons'
import '../vu_styles/Calendar.css'

/** The four kinds of thing a day can hold, which is what a chip's colour says. */
type Kind = 'class' | 'work' | 'plans' | 'occasion'

/** Somebody on a card: her id for the picture, her first name for the caption. */
interface Person {
  id: string
  name: string
}

/** The day-of-month for a date index, read off the shared formatter. */
function dayOfMonth(date: number): number {
  return Number(formatGameDate(date).split(' ')[1])
}

/** `"May"` — the month name alone, for the navigation header. */
function monthName(date: number): string {
  return formatGameDate(date).split(' ')[0]
}

/** One calendar month the semester touches, in full: its first and last `date` index. */
interface Month {
  first: number
  last: number
}

/**
 * The months the semester touches, each drawn whole: the first one's days before
 * the 19th and the last one's after graduation are on the grid, dimmed, so a month is always
 * a month and the arrows never change the shape of what they page.
 */
const MONTHS: readonly Month[] = ((): Month[] => {
  const months: Month[] = []
  let first = 1 - dayOfMonth(0)
  while (first <= FINAL_DATE) {
    let next = first + 28
    while (dayOfMonth(next) !== 1) next++
    months.push({ first, last: next - 1 })
    first = next
  }
  return months
})()

/** Which of {@link MONTHS} a date falls in. */
function monthIndexOf(date: number): number {
  return Math.max(
    0,
    MONTHS.findIndex((month) => date >= month.first && date <= month.last)
  )
}

/** How many days one row of the grid holds, and how many rows it always draws. */
const WEEK_LENGTH = WEEK_DAY_HEADERS.length
const GRID_ROWS = 6

/** The legend, in this reading order. */
const KINDS: ReadonlyArray<{ kind: Kind; label: string }> = [
  { kind: 'class', label: 'Class' },
  { kind: 'work', label: 'Work' },
  { kind: 'plans', label: 'Plans' },
  { kind: 'occasion', label: 'Occasion' }
]

/** The day's cards, dealt under their heads every time another day is picked. */
const DAY_DEAL = dealt(0, 0.05)

/** Her `profile.png` in an archway: a person is one at every size. */
function Face({ charId }: { charId: string }): JSX.Element {
  const version = useSpriteVersion(charId)
  return (
    <span className="vu-arch vu-cal-face">
      <span className="vu-crop">
        <img className="vu-crop-img" src={profileUrl(charId, version)} alt="" />
      </span>
    </span>
  )
}

/** The half a thing falls in, as the stamp's own mark rather than a glyph in the label. */
function HalfGlyph({ time }: { time: TimeSlot }): JSX.Element {
  return time === 0 ? <SunIcon strokeWidth={3} /> : <MoonIcon strokeWidth={3} />
}

/**
 * The sky over the half beside its word, turning as the scene's stamp does — the pane's idle:
 * the sun spins where it stands, the crescent swings, and a wet sky's mark holds its place and
 * steps inside its own drawing. Its colour is the half's whatever the sky is doing.
 */
function HalfMark({ time, weather }: { time: TimeSlot; weather: Weather }): JSX.Element {
  const kind = halfMarkKindOf(weather, time === 1)
  return (
    <motion.span
      className={`vu-cal-half-mark vu-cal-half-mark--${slotHalf(time)}`}
      key={kind}
      animate={kind === 'sun' ? stampSpinDay : kind === 'moon' ? stampSwayNight : markStill}
    >
      <HalfMarkIcon kind={kind} strokeWidth={2.75} />
    </motion.span>
  )
}

/** How far ahead the grid says what the sky will be doing: today and the week after it. */
const FORECAST_DAYS = 7

/**
 * The week's sky on a day of the grid: the day's own mark then the night's, still, since eight
 * cells of weather stepping at once is a reading nobody can hold still enough to take.
 */
function Forecast({ date, weather }: { date: number; weather: readonly Weather[] }): JSX.Element {
  return (
    <span className="vu-cal-forecast">
      {TIME_SLOTS.map((time) => (
        <HalfMarkIcon
          key={time}
          kind={halfMarkKindOf(weatherAt(weather, date, time), time === 1)}
          className={`vu-cal-forecast-mark vu-cal-forecast-mark--${slotHalf(time)}`}
          strokeWidth={3}
          still
        />
      ))}
    </span>
  )
}

/** One thing on a day of the grid: its kind's colour, the half it falls in, and who is at it. */
function Chip({
  kind,
  label,
  time,
  faces = [],
  fresh = false
}: {
  kind: Kind
  label: string
  /** `null` for the whole day — an occasion is nobody's hour. */
  time: TimeSlot | null
  faces?: readonly string[]
  /** Filed since the last visit: dashed, and marked NEW for this one. */
  fresh?: boolean
}): JSX.Element {
  return (
    <span className={`vu-cal-chip${fresh ? ' vu-cal-chip--new' : ''}`} data-cat={kind}>
      {fresh && <span className="vu-cal-new">New</span>}
      {/* The mark leads the label, as the pane's own half heads do: which half it is is read
          before what it is. */}
      {time !== null && <HalfGlyph time={time} />}
      <span className="vu-cal-chip-label">{label}</span>
      {faces.length > 0 && (
        <span className="vu-cal-chip-faces">
          {faces.map((charId) => (
            <Face key={charId} charId={charId} />
          ))}
        </span>
      )}
    </span>
  )
}

/** One entry in the day being read: what it is, the words about it, and who is there. */
function Card({
  kind,
  title,
  code,
  text,
  note,
  people = [],
  fresh = false
}: {
  kind: Kind
  title: string
  /** A course's code, after its name. */
  code?: string
  text: string
  /** The one line an occasion adds when it closes the university. */
  note?: string
  people?: readonly Person[]
  fresh?: boolean
}): JSX.Element {
  return (
    <motion.section className="vu-cal-card" data-cat={kind} variants={slideInQuick}>
      <div className="vu-cal-card-title">
        {fresh && <span className="vu-cal-new">New</span>}
        <span className="vu-cal-card-name">{title}</span>
        {code && <span className="vu-cal-card-code">{code}</span>}
      </div>
      {text && <p className="vu-cal-card-text">{text}</p>}
      {note && <p className="vu-cal-card-note">{note}</p>}
      {people.length > 0 && (
        <div className="vu-cal-roster">
          {people.map(({ id, name }) => (
            <span className="vu-cal-who" key={id}>
              <Face charId={id} />
              {name}
            </span>
          ))}
        </div>
      )}
    </motion.section>
  )
}

/** A half with nothing in it, or a day already played reading back what happened. */
function Quiet({ children, empty = false }: { children: string; empty?: boolean }): JSX.Element {
  return (
    <motion.div
      className={`vu-cal-card vu-cal-card--quiet${empty ? ' vu-cal-card--empty' : ''}`}
      variants={slideInQuick}
    >
      {children}
    </motion.div>
  )
}

export interface CalendarModalProps {
  /** Drawn by the screen that opened this — a portal inherits no palette. */
  theme: ScreenTheme
  onClose: () => void
}

/**
 * The in-game calendar: a month of the semester on the left, the day being read
 * on the right — its classes ahead of the clock, what happened behind it. It reads
 * Sunday-first off `WEEK_COLUMNS`.
 */
export function CalendarModal({ theme, onClose }: CalendarModalProps): JSX.Element | null {
  const today = useGameStore((s) => s.date)
  const playerSchedule = useGameStore((s) => s.playerSchedule)
  const classes = useGameStore((s) => s.classes)
  const classRecords = useGameStore((s) => s.classRecords)
  const chars = useGameStore((s) => s.chars)
  const charInfo = useGameStore((s) => s.charInfo)
  const history = useGameStore((s) => s.history)
  const characters = useGameStore((s) => s.characters)
  const events = useGameStore((s) => s.events)
  // The generated half only; `occasionsOn` merges the fixed calendar in.
  const occasions = useGameStore((s) => s.occasions)
  const weather = useGameStore((s) => s.weather)
  const job = useGameStore((s) => s.job)
  const jobDef = job ? jobDefOf(job.jobId) : undefined
  const jobTitle = jobDef ? `${jobDef.title} — ${jobDef.employer}` : 'Shift'

  const [month, setMonth] = useState(() => monthIndexOf(today))
  const [selected, setSelected] = useState(today)

  // Which plans were new when the modal opened, read before the effect below
  // clears the flag.
  const [fresh] = useState(
    () => new Set(useGameStore.getState().events.filter((e) => !e.seen).map((e) => e.id))
  )
  // Opening the calendar is seeing what the badge was about.
  useEffect(() => useGameStore.getState().markEventsSeen(), [])

  const { host, overlayProps } = useModalShell(onClose)

  const { first, last } = MONTHS[month]
  const firstMonth = month === 0
  const lastMonth = month === MONTHS.length - 1

  /** The classes meeting on `date`, each with the half it meets in, Day then Night. */
  function classesOn(date: number): Array<{ time: TimeSlot; entry: ClassEntry }> {
    return TIME_SLOTS.flatMap((time) => {
      const slot = classSlotOf(date, time, occasions)
      const entry = slot === null ? undefined : classes[playerSchedule[slot] ?? '']
      return entry ? [{ time, entry }] : []
    })
  }

  /**
   * The sky over one half of the day being read: the table's own reading as far ahead as the
   * grid forecasts, a day already played included, and clear past that — beyond the week the
   * reader is told nothing, so the pane says what the half is rather than what the sky did.
   */
  function paneWeather(time: TimeSlot): Weather {
    return selected <= today + FORECAST_DAYS ? weatherAt(weather, selected, time) : 'clear'
  }

  /** What is happening on `date` whoever the reader is — holidays included. */
  function occasionsFor(date: number): Occasion[] {
    return occasionsOn(date, occasions)
  }

  /** The plans made for `date`, Day then Night. */
  function plansOn(date: number): CalendarEvent[] {
    return events.filter((event) => event.date === date).sort((a, b) => a.time - b.time)
  }

  /** The halves of `date` the reader is rostered to work, Day then Night. */
  function shiftsOn(date: number): TimeSlot[] {
    if (!job) return []
    // A day the employer is closed has no shift to show.
    if (jobClosedOn(job.jobId, date, occasions)) return []
    return TIME_SLOTS.filter((time) => job.shifts.includes(shiftSlotOf(shiftWeekdayOf(date), time)))
  }

  /**
   * Only the people the reader has been introduced to; every charId list on this screen
   * goes through here first.
   */
  function known(charIds: readonly string[]): string[] {
    return charIds.filter((charId) => charInfo[charId]?.nameKnown)
  }

  /** A classmate's first name. No mask: `known` has already dropped strangers. */
  function nameOf(charId: string): string {
    return characters[charId]?.firstName ?? charId
  }

  /** The people a card captions, off a list `known` has already filtered. */
  function peopleOf(charIds: readonly string[]): Person[] {
    return charIds.map((id) => ({ id, name: nameOf(id) }))
  }

  /**
   * The classmates the reader knows sit in that room: he has attended it, or her Bunnyboard
   * profile told him.
   */
  function rosterOf(entry: ClassEntry): string[] {
    const attended = everAttended(classRecords[entry.code])
    return known(studentsOf(entry, chars, charInfo)).filter(
      (charId) => attended || charInfo[charId]?.flags?.gaveContactInfo === true
    )
  }

  /** An occasion on a card, wherever on the day it is read: above both halves, or inside one. */
  function occasionCard(occasion: Occasion): JSX.Element {
    return (
      <Card
        key={occasion.id}
        kind="occasion"
        title={occasion.title}
        text={occasion.description}
        note={occasion.cancelsClasses ? 'No classes today.' : undefined}
      />
    )
  }

  /**
   * What the pane says about one half of the day being read. An occasion timed to this half
   * opens it, and stands beside the history line on a day already played.
   */
  function halfOf(time: TimeSlot): JSX.Element {
    const timed = occasionsFor(selected).filter((occasion) => occasion.time === time)

    // A day already played reads back what happened in that slot.
    if (selected < today) {
      return (
        <>
          {timed.map(occasionCard)}
          <Quiet>{history[selected]?.[time] ?? 'Nothing recorded.'}</Quiet>
        </>
      )
    }

    const slot = classSlotOf(selected, time, occasions)
    const entry = slot === null ? undefined : classes[playerSchedule[slot] ?? '']
    const plans = plansOn(selected).filter((plan) => plan.time === time)
    const onShift = shiftsOn(selected).includes(time)
    if (!entry && plans.length === 0 && !onShift && timed.length === 0) {
      return <Quiet empty>Nothing scheduled.</Quiet>
    }

    return (
      <>
        {timed.map(occasionCard)}
        {onShift && (
          <Card kind="work" title={jobTitle} text="You have a shift to work." />
        )}
        {entry && (
          <Card
            kind="class"
            title={entry.name}
            code={entry.code}
            text={[entry.description, kindSentenceOf(entry)].filter(Boolean).join(' ')}
            people={peopleOf(rosterOf(entry))}
          />
        )}
        {plans.map((plan) => (
          <Card
            key={plan.id}
            kind="plans"
            title={plan.title}
            text={plan.description}
            people={peopleOf(known(plan.charIds))}
            fresh={fresh.has(plan.id)}
          />
        ))}
      </>
    )
  }

  // Six rows always, the months either side filling the first and the last out, so a
  // cell is the same cell in every month. `weekdayOf` is Sunday-based, the order the grid reads in.
  const lead = weekdayOf(first)
  const cells = Array.from({ length: WEEK_LENGTH * GRID_ROWS }, (_, i) => first - lead + i)

  const dayOccasions = occasionsFor(selected).filter((occasion) => occasion.time === null)

  if (!host) return null

  return createPortal(
    <motion.div
      className="vu-veil"
      data-theme={theme}
      variants={veilIn}
      initial="hidden"
      animate="shown"
      exit="gone"
      {...overlayProps}
    >
      <motion.div
        id="calendar"
        className="vu-cal vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label="Calendar"
        variants={panelUnderTab}
      >
        <TitleTab>Calendar</TitleTab>

        <div className="vu-cal-month">
          <div className="vu-cal-head">
            {/* The semester's ends are end-stops: dead, rendered, and saying nothing. */}
            <motion.button
              id="calendar-prev"
              className="vu-square vu-square--step vu-cal-step--back"
              type="button"
              aria-label="Previous month"
              disabled={firstMonth}
              {...gestures(firstMonth, quietLift, quietPress)}
              onClick={() => setMonth((m) => m - 1)}
            >
              <ChevronIcon />
            </motion.button>
            <span className="vu-cal-name">{monthName(first)}</span>
            <motion.button
              id="calendar-next"
              className="vu-square vu-square--step"
              type="button"
              aria-label="Next month"
              disabled={lastMonth}
              {...gestures(lastMonth, quietLift, quietPress)}
              onClick={() => setMonth((m) => m + 1)}
            >
              <ChevronIcon />
            </motion.button>

            <div className="vu-cal-legend">
              {KINDS.map(({ kind, label }) => (
                <span className="vu-cal-key" data-cat={kind} key={kind}>
                  {label}
                </span>
              ))}
            </div>
          </div>

          <div className="vu-cal-days">
            {WEEK_COLUMNS.map((weekday) => (
              <span className="vu-cal-dayname" key={weekday}>
                {WEEK_DAY_HEADERS[weekday]}
              </span>
            ))}
          </div>

          <div className="vu-cal-grid">
            {cells.map((date) => {
              // Another month's day, or one of this month's the semester does not reach: a
              // number and nothing else, and not a control.
              if (date < first || date > last || date < 0 || date > FINAL_DATE) {
                return (
                  <div className="vu-cal-cell vu-cal-cell--out" key={date}>
                    <span className="vu-cal-num">{dayOfMonth(date)}</span>
                  </div>
                )
              }

              const isToday = date === today
              // Today and the pick are two marks shown apart; on the one day they
              // agree, today is the one that is said.
              const picked = date === selected && !isToday
              const state =
                (isToday ? ' vu-cal-cell--today' : '') +
                (picked ? ' vu-cal-cell--on' : '') +
                (date < today ? ' vu-cal-cell--past' : '')

              return (
                <motion.button
                  className={`vu-cal-cell${state}`}
                  key={date}
                  type="button"
                  aria-pressed={date === selected}
                  aria-label={formatDatePart(date)}
                  {...gestures(false, rowLift, rowPress)}
                  onClick={() => setSelected(date)}
                >
                  <span className="vu-cal-num">
                    {dayOfMonth(date)}
                    {isToday && <span className="vu-cal-mark vu-cal-mark--today">Today</span>}
                    {picked && <span className="vu-cal-mark vu-cal-mark--on">Selected</span>}
                    {date >= today && date <= today + FORECAST_DAYS && (
                      <Forecast date={date} weather={weather} />
                    )}
                  </span>
                  <span className="vu-cal-chips">
                    {occasionsFor(date).map((occasion) => (
                      <Chip
                        key={occasion.id}
                        kind="occasion"
                        label={occasion.title}
                        time={occasion.time}
                      />
                    ))}
                    {classesOn(date).map(({ time, entry }) => (
                      <Chip
                        key={`${entry.code}-${time}`}
                        kind="class"
                        label={entry.code}
                        time={time}
                        faces={rosterOf(entry)}
                      />
                    ))}
                    {shiftsOn(date).map((time) => (
                      <Chip key={`shift-${time}`} kind="work" label="Shift" time={time} />
                    ))}
                    {plansOn(date).map((plan) => (
                      <Chip
                        key={plan.id}
                        kind="plans"
                        label={plan.title}
                        time={plan.time}
                        faces={known(plan.charIds)}
                        fresh={fresh.has(plan.id)}
                      />
                    ))}
                  </span>
                </motion.button>
              )
            })}
          </div>
        </div>

        <div className="vu-cal-day">
          <h3 className="vu-cal-daytitle">
            {formatWeekday(selected)}, {formatShortGameDate(selected)}
          </h3>

          {/* Each list is keyed on the day, so a pick deals its cards in under heads — and the
              idle on them — that stay where they are. */}
          <div className="vu-cal-daybody">
            {/* An occasion that is the whole day's sits above the two halves. */}
            {dayOccasions.length > 0 && (
              <motion.div
                className="vu-cal-cards"
                key={`occasions-${selected}`}
                variants={DAY_DEAL}
                initial="hidden"
                animate="shown"
              >
                {dayOccasions.map(occasionCard)}
              </motion.div>
            )}

            {TIME_SLOTS.map((time) => (
              <section className="vu-cal-half" key={time}>
                <div className="vu-cal-half-head">
                  <HalfMark time={time} weather={paneWeather(time)} />
                  {formatTimeSlot(time)}
                </div>
                <motion.div
                  className="vu-cal-cards"
                  key={selected}
                  variants={DAY_DEAL}
                  initial="hidden"
                  animate="shown"
                >
                  {halfOf(time)}
                </motion.div>
              </section>
            ))}
          </div>

          {/* One answer: a panel with nothing to spend has nothing to cancel. */}
          <div className="vu-foot">
            <motion.button
              id="calendar-close"
              className="vu-btn vu-btn--primary vu-btn--panel vu-paper"
              type="button"
              {...gestures(false, lift, press)}
              onClick={onClose}
            >
              Close
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>,
    host
  )
}
