import { useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { kindSentenceOf } from '@shared/academics'
import { FINAL_DATE, TIME_SLOTS } from '@shared/classes'
import { jobDefOf, shiftSlotOf, WEEK_COLUMNS, WEEK_DAY_HEADERS } from '@shared/jobs'
import type { GameReplays } from '@shared/replays'
import {
  semesterCalendarOf,
  semesterName,
  type SemesterCalendar,
  type SemesterView
} from '@shared/semesters'
import type { CalendarEvent, ClassEntry, GameHistory, Occasion, TimeSlot } from '@shared/types'
import { weatherAt, type Weather } from '@shared/weather'
import { ConfirmModal } from '../components/ConfirmModal'
import { DeadNote } from '../components/DeadNote'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import {
  formatDatePart,
  formatShortGameDate,
  formatTimeSlot,
  formatWeekday,
  shiftWeekdayOf,
  slotHalf
} from '../prompts/gameDate'
import { knownClassmatesOf } from '../prompts/classProgress'
import { classSlotOf, jobClosedOn, occasionsOn } from '../prompts/occasions'
import { profileUrl, useSpriteVersion } from '../stores/characterStore'
import { useGameStore } from '../stores/gameStore'
import { earlierSemesters, keptReplayIds } from '../stores/loop/replay'
import type { ReplayOffer } from '../stores/loop/saves'
import { offerNoteOf } from '../stores/gameLoop'
import { dayOfMonth, gridCellsOf, monthIndexOf, monthName, monthsOf } from './calendarMonths'
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

/** The legend, in this reading order. */
const KINDS: ReadonlyArray<{ kind: Kind; label: string }> = [
  { kind: 'class', label: 'Class' },
  { kind: 'work', label: 'Work' },
  { kind: 'plans', label: 'Plans' },
  { kind: 'occasion', label: 'Occasion' }
]

/** The day's cards, dealt under their heads every time another day is picked. */
const DAY_DEAL = dealt(0, 0.05)

/**
 * One semester the calendar pages through: its own dates, sky and catalog, and what the reader
 * did in it. Every day of an earlier one is past.
 */
interface SemesterPage {
  /** Which semester of the playthrough, from 0. */
  index: number
  /** The semester being played, whose days run on and whose replays may be deleted. */
  current: boolean
  calendar: SemesterCalendar
  weather: readonly Weather[]
  classes: Readonly<Record<string, ClassEntry>>
  playerSchedule: Readonly<Record<number, string>>
  history: GameHistory
  replays: GameReplays
  events: readonly CalendarEvent[]
  /** The classmates the reader knows sat in one of its classes. */
  rosterOf: (entry: ClassEntry) => string[]
}

/** A month of one semester, as the arrows step through them. */
interface MonthAt {
  page: number
  month: number
}

/** A day of one semester, as the pane reads it. */
interface DayAt {
  page: number
  date: number
}

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
  /** Whether a past half's replay may be played now, has to wait for the loop, or never can. */
  replayOffer: ReplayOffer
  /** Plays one past half's replay, of this semester or the earlier one `semesterIndex` names. */
  onReplay: (date: number, time: TimeSlot, semesterIndex?: number) => void
  /** Deletes one past half's replay; false where the delete was refused. */
  onDeleteReplay: (date: number, time: TimeSlot) => Promise<boolean>
  onClose: () => void
}

/**
 * The in-game calendar: a month of the semester on the left, the day being read
 * on the right — its classes ahead of the clock, what happened behind it. The arrows step back
 * through every semester before this one, each month in its own semester's dates. It reads
 * Sunday-first off `WEEK_COLUMNS`.
 */
export function CalendarModal({
  theme,
  replayOffer,
  onReplay,
  onDeleteReplay,
  onClose
}: CalendarModalProps): JSX.Element | null {
  const today = useGameStore((s) => s.date)
  const semesterIndex = useGameStore((s) => s.semesterIndex)
  const playerSchedule = useGameStore((s) => s.playerSchedule)
  const classes = useGameStore((s) => s.classes)
  const classRecords = useGameStore((s) => s.classRecords)
  const chars = useGameStore((s) => s.chars)
  const charInfo = useGameStore((s) => s.charInfo)
  const history = useGameStore((s) => s.history)
  const replays = useGameStore((s) => s.replays)
  const characters = useGameStore((s) => s.characters)
  const events = useGameStore((s) => s.events)
  // The season and the generated half only; `occasionsOn` merges the fixed calendar in.
  const calendar = useGameStore((s) => s.calendar)
  const weather = useGameStore((s) => s.weather)
  const job = useGameStore((s) => s.job)
  const jobDef = job ? jobDefOf(job.jobId) : undefined
  const jobTitle = jobDef ? `${jobDef.title} — ${jobDef.employer}` : 'Shift'

  // The semesters before this one, read once: the record does not change under an open
  // calendar, and each keeps one calendar object, which the meeting dates are worked out on.
  const [earlier] = useState(() =>
    earlierSemesters().map(({ view, log }) => ({
      view,
      log,
      calendar: semesterCalendarOf(view)
    }))
  )

  /**
   * The classmates the reader knows sat in one of an earlier semester's classes, off that
   * semester's own timetables: the girls still loaded whose names he knows.
   */
  function earlierRosterOf(entry: ClassEntry, view: SemesterView): string[] {
    return view.chars.filter(
      (charId) =>
        characters[charId] !== undefined &&
        charInfo[charId]?.nameKnown === true &&
        Object.values(view.profiles[charId]?.schedule ?? {}).includes(entry.code)
    )
  }

  const pages: SemesterPage[] = [
    ...earlier.map(({ view, log, calendar: past }) => ({
      index: view.index,
      current: false,
      calendar: past,
      weather: view.weather,
      classes: view.classes,
      playerSchedule: log?.playerSchedule ?? {},
      history: log?.history ?? {},
      replays: log?.replays ?? {},
      events: log?.events ?? [],
      rosterOf: (entry: ClassEntry) => earlierRosterOf(entry, view)
    })),
    {
      index: semesterIndex,
      current: true,
      calendar,
      weather,
      classes,
      playerSchedule,
      history,
      replays,
      events,
      rosterOf: (entry: ClassEntry) =>
        knownClassmatesOf(entry, chars, charInfo, classRecords[entry.code])
    }
  ]
  const currentPage = pages.length - 1

  const [at, setAt] = useState<MonthAt>(() => ({
    page: currentPage,
    month: monthIndexOf(today, calendar.season)
  }))
  const [picked, setPicked] = useState<DayAt>(() => ({ page: currentPage, date: today }))

  // Which plans were new when the modal opened, read before the effect below
  // clears the flag.
  const [fresh] = useState(
    () => new Set(useGameStore.getState().events.filter((e) => !e.seen).map((e) => e.id))
  )
  // Opening the calendar is seeing what the badge was about.
  useEffect(() => useGameStore.getState().markEventsSeen(), [])

  /** The replays kept on disk for this playthrough; none is offered until they are known. */
  const [kept, setKept] = useState<ReadonlySet<string> | null>(null)
  /** The past half whose replay is waiting on the player's yes to its delete. */
  const [deleting, setDeleting] = useState<{ date: number; time: TimeSlot } | null>(null)

  /** Reads which replays are kept, for as long as the calendar is open to show them. */
  const live = useRef(true)
  function readKept(): void {
    void keptReplayIds().then((ids) => {
      if (live.current) setKept(ids)
    })
  }
  useEffect(() => {
    live.current = true
    readKept()
    return () => {
      live.current = false
    }
  }, [])

  const { host, overlayProps } = useModalShell(onClose)

  /** The month on the grid, of its own semester. */
  const page = pages[at.page]
  const months = monthsOf(page.calendar.season)
  const { first, last } = months[at.month]
  const firstMonth = at.page === 0 && at.month === 0
  const lastMonth = at.page === currentPage && at.month === months.length - 1
  /** The day the pane reads, of its own semester. */
  const day = pages[picked.page]
  const selected = picked.date

  /** Turns the grid one month, from a semester's first month into the last of the one before. */
  function step(by: 1 | -1): void {
    setAt(({ page: at, month }) => {
      const next = month + by
      if (next < 0) {
        return { page: at - 1, month: monthsOf(pages[at - 1].calendar.season).length - 1 }
      }
      if (next >= monthsOf(pages[at].calendar.season).length) return { page: at + 1, month: 0 }
      return { page: at, month: next }
    })
  }

  /** The day the clock stands on, in a semester's own dates: past every day of an earlier one. */
  function todayOn(of: SemesterPage): number {
    return of.current ? today : Number.POSITIVE_INFINITY
  }

  /** The classes meeting on `date`, each with the half it meets in, Day then Night. */
  function classesOn(date: number, of: SemesterPage): Array<{ time: TimeSlot; entry: ClassEntry }> {
    return TIME_SLOTS.flatMap((time) => {
      const slot = classSlotOf(date, time, of.calendar)
      const entry = slot === null ? undefined : of.classes[of.playerSchedule[slot] ?? '']
      return entry ? [{ time, entry }] : []
    })
  }

  /**
   * The sky over one half of the day being read: the table's own reading as far ahead as the
   * grid forecasts, a day already played included, and clear past that — beyond the week the
   * reader is told nothing, so the pane says what the half is rather than what the sky did.
   */
  function paneWeather(time: TimeSlot): Weather {
    return selected <= todayOn(day) + FORECAST_DAYS
      ? weatherAt(day.weather, selected, time)
      : 'clear'
  }

  /** What is happening on `date` whoever the reader is — holidays included. */
  function occasionsFor(date: number, of: SemesterPage): Occasion[] {
    return occasionsOn(date, of.calendar)
  }

  /** The plans made for `date`, Day then Night. */
  function plansOn(date: number, of: SemesterPage): CalendarEvent[] {
    return of.events.filter((event) => event.date === date).sort((a, b) => a.time - b.time)
  }

  /**
   * The halves of `date` the reader is rostered to work, Day then Night; none in an earlier
   * semester, whose job the record does not keep.
   */
  function shiftsOn(date: number, of: SemesterPage): TimeSlot[] {
    if (!job || !of.current) return []
    // A day the employer is closed has no shift to show.
    if (jobClosedOn(job.jobId, date, calendar)) return []
    return TIME_SLOTS.filter((time) => job.shifts.includes(shiftSlotOf(shiftWeekdayOf(date), time)))
  }

  /**
   * Only the people the reader has been introduced to, and who are still in the game — an earlier
   * semester's plan can name a graduate whose character is gone; every charId list on this
   * screen goes through here first.
   */
  function known(charIds: readonly string[]): string[] {
    return charIds.filter((charId) => charInfo[charId]?.nameKnown && characters[charId])
  }

  /** A classmate's first name. No mask: `known` has already dropped strangers. */
  function nameOf(charId: string): string {
    return characters[charId]?.firstName ?? charId
  }

  /** The people a card captions, off a list `known` has already filtered. */
  function peopleOf(charIds: readonly string[]): Person[] {
    return charIds.map((id) => ({ id, name: nameOf(id) }))
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
    const timed = occasionsFor(selected, day).filter((occasion) => occasion.time === time)

    // A day already played reads back what happened in that slot, and offers it again where a
    // replay of it is kept.
    if (selected < todayOn(day)) {
      return (
        <>
          {timed.map(occasionCard)}
          <Quiet>{day.history[selected]?.[time] ?? 'Nothing recorded.'}</Quiet>
          {replayRow(time)}
        </>
      )
    }

    const slot = classSlotOf(selected, time, day.calendar)
    const entry = slot === null ? undefined : day.classes[day.playerSchedule[slot] ?? '']
    const plans = plansOn(selected, day).filter((plan) => plan.time === time)
    const onShift = shiftsOn(selected, day).includes(time)
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
            people={peopleOf(day.rosterOf(entry))}
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

  /**
   * A past half's replay under its summary: Replay where the game can be left for it, dead through
   * a scene and while a call it would cancel is out, and Delete beside it in the semester being
   * played — an earlier one's replays are its record's, kept for the playthrough's life. Nothing
   * where no replay of it is kept.
   */
  function replayRow(time: TimeSlot): JSX.Element | null {
    const id = day.replays[selected]?.[time]
    if (!id || !kept?.has(id)) return null
    const note = offerNoteOf(replayOffer)
    const dead = note !== null
    return (
      <motion.div className="vu-cal-replay" variants={slideInQuick}>
        {replayOffer !== 'none' && (
          <DeadNote note={note}>
            <motion.button
              id={`calendar-replay-${time}`}
              className="vu-pill"
              type="button"
              disabled={dead}
              {...gestures(dead, quietLift, quietPress)}
              onClick={() => onReplay(selected, time, day.current ? undefined : day.index)}
            >
              Replay
            </motion.button>
          </DeadNote>
        )}
        {day.current && (
          <motion.button
            id={`calendar-delete-replay-${time}`}
            className="vu-pill vu-cal-replay-delete"
            type="button"
            {...gestures(false, quietLift, quietPress)}
            onClick={() => setDeleting({ date: selected, time })}
          >
            Delete replay
          </motion.button>
        )}
      </motion.div>
    )
  }

  const cells = gridCellsOf(months[at.month])
  const season = page.calendar.season

  const dayOccasions = occasionsFor(selected, day).filter((occasion) => occasion.time === null)

  if (!host) return null

  return createPortal(
    <>
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
                onClick={() => step(-1)}
              >
                <ChevronIcon />
              </motion.button>
              {/* Which semester the month is of, under it, once there is more than one to page
                  through. */}
              <span className="vu-cal-name">
                {monthName(first, season)}
                {pages.length > 1 && (
                  <span className="vu-cal-semester">{semesterName(page.index)}</span>
                )}
              </span>
              <motion.button
                id="calendar-next"
                className="vu-square vu-square--step"
                type="button"
                aria-label="Next month"
                disabled={lastMonth}
                {...gestures(lastMonth, quietLift, quietPress)}
                onClick={() => step(1)}
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
                      <span className="vu-cal-num">{dayOfMonth(date, season)}</span>
                    </div>
                  )
                }

                const isToday = page.current && date === today
                const isPicked = picked.page === at.page && date === selected
                // Today and the pick are two marks shown apart; on the one day they
                // agree, today is the one that is said.
                const onPick = isPicked && !isToday
                const state =
                  (isToday ? ' vu-cal-cell--today' : '') +
                  (onPick ? ' vu-cal-cell--on' : '') +
                  (date < todayOn(page) ? ' vu-cal-cell--past' : '')

                return (
                  <motion.button
                    className={`vu-cal-cell${state}`}
                    key={date}
                    type="button"
                    aria-pressed={isPicked}
                    aria-label={formatDatePart(date, season)}
                    {...gestures(false, rowLift, rowPress)}
                    onClick={() => setPicked({ page: at.page, date })}
                  >
                    <span className="vu-cal-num">
                      {dayOfMonth(date, season)}
                      {isToday && <span className="vu-cal-mark vu-cal-mark--today">Today</span>}
                      {onPick && <span className="vu-cal-mark vu-cal-mark--on">Selected</span>}
                      {page.current && date >= today && date <= today + FORECAST_DAYS && (
                        <Forecast date={date} weather={weather} />
                      )}
                    </span>
                    <span className="vu-cal-chips">
                      {occasionsFor(date, page).map((occasion) => (
                        <Chip
                          key={occasion.id}
                          kind="occasion"
                          label={occasion.title}
                          time={occasion.time}
                        />
                      ))}
                      {classesOn(date, page).map(({ time, entry }) => (
                        <Chip
                          key={`${entry.code}-${time}`}
                          kind="class"
                          label={entry.code}
                          time={time}
                          faces={page.rosterOf(entry)}
                        />
                      ))}
                      {shiftsOn(date, page).map((time) => (
                        <Chip key={`shift-${time}`} kind="work" label="Shift" time={time} />
                      ))}
                      {plansOn(date, page).map((plan) => (
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
              {formatWeekday(selected)}, {formatShortGameDate(selected, day.calendar.season)}
            </h3>

            {/* Each list is keyed on the day, so a pick deals its cards in under heads — and the
                idle on them — that stay where they are. */}
            <div className="vu-cal-daybody">
              {/* An occasion that is the whole day's sits above the two halves. */}
              {dayOccasions.length > 0 && (
                <motion.div
                  className="vu-cal-cards"
                  key={`occasions-${picked.page}-${selected}`}
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
                    key={`${picked.page}-${selected}`}
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
      </motion.div>

      {/* A sibling of the veil, not a child: a click inside it does not reach the veil's own
          handler through the React tree. */}
      <AnimatePresence propagate>
        {deleting && (
          <ConfirmModal
            key="delete-replay"
            id="delete-replay"
            theme={theme}
            title="Delete replay?"
            message="This replay will be permanently deleted from every save."
            confirmText="Delete replay"
            onCancel={() => setDeleting(null)}
            onConfirm={() => {
              const { date, time } = deleting
              setDeleting(null)
              void onDeleteReplay(date, time).then((done) => {
                if (done) readKept()
              })
            }}
          />
        )}
      </AnimatePresence>
    </>,
    host
  )
}
