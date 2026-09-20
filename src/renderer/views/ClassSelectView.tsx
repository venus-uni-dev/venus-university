import { useEffect, useMemo, useState, type JSX } from 'react'
import { AnimatePresence, animate, motion, useReducedMotion } from 'motion/react'
import { MAX_PLAYER_CLASSES, MIN_PLAYER_COURSES, scheduleComplaint } from '@shared/classes'
import type { ClassSlot } from '@shared/types'
import markUrl from '../../../assets/vu_letters.png'
import { ConfirmModal } from '../components/ConfirmModal'
import { useWindowKeydown } from '../components/useWindowKeydown'
import type { ScheduleResult } from '../stores/classScheduler'
import { useCrossingStore } from '../stores/crossingStore'
import { formatDatePart } from '../prompts/gameDate'
import { ADD_DROP_DATE } from '../prompts/occasions'
import { heldScreenTheme } from './clockTheme'
import { CoursePickerModal } from './CoursePickerModal'
import { CourseWeek } from './CourseWeek'
import { chromeIn, fadeIn, gestures, lift, press, quietLift, quietPress, spin, TYPE_URL } from './motion'
import { ChevronIcon } from './screenIcons'
import '../vu_styles/CourseSchedule.css'

/**
 * The registrar's enrollment page: the player's own timetable, picked between class
 * generation and the first save write. It is drawn as a web page inside a browser, which is
 * the whole of how the university speaks to the reader in writing.
 */

/**
 * Whether this is the mid-semester add/drop rather than a first enrollment. **Not wired to
 * anything yet**; always false until the Game View hands it in. Decides the title, whether the
 * deadline shows, what Cancel means, and the address.
 */
const ADD_DROP: boolean = false

/** The address that is typed in, in two halves so the domain can be read apart from the page. */
const URL_DOMAIN = 'registrar.venus.edu'

/** How long the page is blank between the address landing and the timetable arriving. */
const LOAD_MS = 380

/** The page arriving, built once: a `Variants` made during render restarts the tree under it. */
const PAGE_IN = fadeIn(0, 0.3)

/** How far the opening has got. The address is typed into a bar that has already landed. */
type Opening = 'chrome' | 'typing' | 'loading' | 'shown'

export interface ClassSelectViewProps {
  /** The freshly generated catalog and per-character enrollment. */
  schedules: ScheduleResult
  /** Hands the chosen `ClassSlot` → code map back; the caller writes the save. */
  onFinalize: (playerSchedule: Record<number, string>) => void
  /** Whose page this is, shown signed in at the top right. */
  playerName: { first: string; last: string }
  /** Whether this semester is already on disk, so backing out of it loses nothing. */
  saved: boolean
  /**
   * The way out of this screen: the Main Menu on a first enrollment, behind the question the
   * screen asks where there is anything to lose, and back to the game on an add/drop.
   */
  onCancel: () => void
}

export function ClassSelectView({
  schedules,
  onFinalize,
  playerName,
  saved,
  onCancel
}: ClassSelectViewProps): JSX.Element {
  const [schedule, setSchedule] = useState<Record<number, string>>({})
  const [picking, setPicking] = useState<ClassSlot | null>(null)
  const [leaving, setLeaving] = useState(false)

  const { classes } = schedules
  const catalog = useMemo(() => Object.values(classes), [classes])
  const count = Object.keys(schedule).length

  // Drawn once on mount and worn on this screen's own root, as every screen does;
  // the picker is written inside the screen, so it inherits this rather than taking a prop.
  const [theme] = useState(heldScreenTheme)

  // The screen arrives under a crossing, so its own opening waits that out: nothing
  // animates behind a curtain, and a screen under one answers neither pointer nor key.
  const covered = useCrossingStore((s) => s.phase !== 'idle')
  const still = useReducedMotion()

  const [opening, setOpening] = useState<Opening>('chrome')
  const [typed, setTyped] = useState(0)

  const path = ADD_DROP ? '/add-drop' : '/enroll'
  const address = URL_DOMAIN + path

  /** The address types itself in once the bar it goes in has landed. */
  useEffect(() => {
    if (opening !== 'typing') return
    if (still) {
      setTyped(address.length)
      setOpening('shown')
      return
    }
    const run = animate(0, address.length, {
      ...TYPE_URL,
      onUpdate: (value) => setTyped(Math.round(value)),
      onComplete: () => setOpening('loading')
    })
    return () => run.stop()
  }, [opening, still, address])

  /** And the page it asked for arrives a beat later. */
  useEffect(() => {
    if (opening !== 'loading') return
    const timer = setTimeout(() => setOpening('shown'), LOAD_MS)
    return () => clearTimeout(timer)
  }, [opening])

  /**
   * Backing out, however it is asked for. It asks first only where leaving costs the player
   * something: a semester still on this screen alone. A saved one is waiting on disk to be
   * come back to, and an add/drop has a game to drop back into.
   */
  function cancel(): void {
    if (ADD_DROP || saved) onCancel()
    else setLeaving(true)
  }

  /** **Escape is the Cancel button** — the same answer, live exactly where that button is. */
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    // A screen under the curtain answers neither pointer nor key, and the root's `inert`
    // does not reach a window listener; a page still arriving has no Cancel on it yet.
    if (covered || opening !== 'shown') return
    cancel()
  }

  // **It stays on the bubble phase**: `useModalShell` captures Escape and stops it, which is
  // why the picker and the confirm each take their own.
  useWindowKeydown(onKeyDown)

  // The one gate between here and a timetable written into the save, checked at every keystroke
  // rather than at Finalize. This screen is a form, so it is one of four approved disable
  // notices: a form that refuses without naming the field is worse than a dead button.
  const complaint = scheduleComplaint(schedule, classes)

  /** Who is signed in, as the registrar files him. */
  const user = [playerName.first, playerName.last]
    .map((part) => part.trim())
    .filter(Boolean)
    .join('_')
    .toLowerCase()

  const shownAddress = address.slice(0, typed)

  return (
    <div className="vu-courses" data-theme={theme} inert={covered}>
      {/* The frame the page is read inside, and the first thing on screen. */}
      <motion.div
        className="vu-courses-chrome"
        variants={chromeIn}
        initial="hidden"
        animate={covered ? 'hidden' : 'shown'}
        onAnimationComplete={(label) => {
          if (label === 'shown' && opening === 'chrome') setOpening('typing')
        }}
      >
        <div className="vu-courses-dots">
          <span className="vu-courses-dot" />
          <span className="vu-courses-dot" />
          <span className="vu-courses-dot" />
        </div>

        {/* Neither arrow goes anywhere: there is no page behind this one and none in front. */}
        <div className="vu-courses-nav" aria-hidden="true">
          <ChevronIcon back />
          <ChevronIcon />
        </div>

        <div className="vu-courses-url">
          <LockIcon />
          <span>
            <span className="vu-courses-domain">
              {shownAddress.slice(0, URL_DOMAIN.length)}
            </span>
            {shownAddress.slice(URL_DOMAIN.length)}
          </span>
          {opening === 'typing' && <span className="vu-courses-caret" />}
        </div>
      </motion.div>

      {opening === 'loading' && (
        <div className="vu-courses-wait">
          <motion.span className="vu-ring" animate={spin} />
        </div>
      )}

      {opening === 'shown' && (
        <>
          <motion.div
            className="vu-courses-band"
            variants={PAGE_IN}
            initial="hidden"
            animate="shown"
          >
            <img className="vu-courses-mark" src={markUrl} alt="Venus University" />
            <span className="vu-courses-rule" />
            <span className="vu-courses-office">Office of the Registrar</span>
            <span className="vu-courses-user">{user}</span>
          </motion.div>

          <motion.div
            className="vu-courses-page"
            variants={PAGE_IN}
            initial="hidden"
            animate="shown"
          >
            <div className="vu-courses-head">
              <div className="vu-title">
                <h1 className="vu-title-text">{ADD_DROP ? 'Add / Drop' : 'Schedule Courses'}</h1>
              </div>
              {/* Only the revision has a deadline; a first enrollment is the deadline. */}
              {ADD_DROP && (
                <span className="vu-courses-deadline">
                  Closes {formatDatePart(ADD_DROP_DATE)}
                </span>
              )}
              <span
                className={`vu-courses-count vu-courses-count--${complaint ? 'short' : 'ok'}`}
              >
                {count} enrolled
              </span>
            </div>

            {/* Seven columns over a day and a night row, the same week the add/drop editor
                edits from inside a modal (`views/CourseWeek.tsx`). */}
            <CourseWeek
              classes={classes}
              schedule={schedule}
              onPick={(slot) => setPicking(slot)}
              onDrop={(slot) =>
                setSchedule((prev) => {
                  const next = { ...prev }
                  delete next[slot]
                  return next
                })
              }
            />

            <footer className="vu-courses-foot">
              {/* The rules at rest, in full: the screen states them rather than waiting to
                  be broken and then complaining — the rule is to say it live, never only
                  afterwards. */}
              <div className="vu-courses-rules">
                <span className="vu-courses-rules-label">ENROLLMENT GUIDELINES</span>
                <ul className="vu-courses-rules-list">
                  <li>You must enroll in at least {MIN_PLAYER_COURSES} non-PE courses.</li>
                  <li>You must enroll in at least one PE course.</li>
                  <li>You cannot enroll in more than {MAX_PLAYER_CLASSES} courses.</li>
                  {/* Not a rule the screen enforces but the one thing the groups above mean,
                      said once here instead of once at the end of every course's blurb. */}
                  <li>
                    Lecture courses are assessed by exams. Project courses are assessed by
                    showcases.
                  </li>
                </ul>
              </div>

              <div className="vu-courses-answers">
                {complaint && <span className="vu-courses-complaint">{complaint}</span>}
                <div className="vu-foot">
                  <motion.button
                    id="class-select-cancel"
                    className="vu-btn vu-btn--quiet"
                    type="button"
                    {...gestures(false, quietLift, quietPress)}
                    onClick={cancel}
                  >
                    Cancel
                  </motion.button>
                  <motion.button
                    id="class-select-finalize"
                    className="vu-btn vu-btn--primary vu-btn--panel vu-paper"
                    type="button"
                    disabled={complaint !== null}
                    {...gestures(complaint !== null, lift, press)}
                    onClick={() => onFinalize(schedule)}
                  >
                    Finalize
                  </motion.button>
                </div>
              </div>
            </footer>
          </motion.div>
        </>
      )}

      {/* The screen's own layer rather than a portalled modal: the chrome above it stays lit. */}
      <AnimatePresence>
        {picking !== null && (
          <CoursePickerModal
            key={picking}
            slot={picking}
            options={catalog.filter((entry) => entry.slot === picking)}
            onPick={(code) => {
              setSchedule((prev) => ({ ...prev, [picking]: code }))
              setPicking(null)
            }}
            onClose={() => setPicking(null)}
          />
        )}
      </AnimatePresence>

      {/* Portalled out of the screen, unlike the picker, so it is handed the theme this root
          already wears rather than drawing the clock a second time. */}
      <AnimatePresence>
        {leaving && (
          <ConfirmModal
            key="leave-enrollment"
            id="leave-enrollment"
            theme={theme}
            title="Return to main menu?"
            message="All progress will be lost."
            confirmText="Return to main menu"
            onCancel={() => setLeaving(false)}
            onConfirm={onCancel}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

/* The browser's own marks. Screen-local: nothing else in the app draws a window. */

function LockIcon(): JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

