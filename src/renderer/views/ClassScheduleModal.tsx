import { useMemo, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import {
  MAX_PLAYER_CLASSES,
  MIN_PLAYER_COURSES,
  scheduleComplaint,
  studentsOf
} from '@shared/classes'
import { classSlotForShift, jobDefOf } from '@shared/jobs'
import type { ClassEntry, ClassSlot } from '@shared/types'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { useBunnyboardStore } from '../stores/bunnyboardStore'
import { useGameStore } from '../stores/gameStore'
import { replyFromVenus } from '../stores/textingLoop'
import { venusScheduleConfirmation, VENUS_CHAT_ID } from '../prompts/venus'
import type { ScreenTheme } from './clockTheme'
import { CoursePickerModal } from './CoursePickerModal'
import { CourseWeek } from './CourseWeek'
import { gestures, lift, panelUnderTab, press, quietLift, quietPress, veilIn } from './motion'
import '../vu_styles/CourseSchedule.css'
import '../vu_styles/ClassSchedule.css'

export interface ClassScheduleModalProps {
  /** Drawn by the screen that opened this — a portal inherits no palette. */
  theme: ScreenTheme
  onClose: () => void
}

/**
 * The add/drop schedule editor — the registrar's page mid-semester and in a modal,
 * reached only through VenusBot and only while add/drop is open. It is the registrar's
 * own week, its own rules and its own complaint on a panel: the same form, so the same words.
 */
export function ClassScheduleModal({ theme, onClose }: ClassScheduleModalProps): JSX.Element | null {
  const classes = useGameStore((s) => s.classes)
  const chars = useGameStore((s) => s.chars)
  const charInfo = useGameStore((s) => s.charInfo)
  const job = useGameStore((s) => s.job)
  const droppedClasses = useGameStore((s) => s.droppedClasses)
  const current = useGameStore((s) => s.playerSchedule)

  const [schedule, setSchedule] = useState<Record<number, string>>({ ...current })
  const [picking, setPicking] = useState<ClassSlot | null>(null)

  const catalog = useMemo(() => Object.values(classes), [classes])
  const count = Object.keys(schedule).length
  const droppedCodes = useMemo(() => new Set(Object.keys(droppedClasses)), [droppedClasses])

  // Current and pending shifts both block, since a pending change lands on Sunday.
  const blocked = useMemo(() => {
    const owner = job ? (jobDefOf(job.jobId)?.employer ?? 'Shift') : ''
    const map: Partial<Record<ClassSlot, string>> = {}
    if (!job) return map
    for (const shift of [...job.shifts, ...(job.pendingShifts ?? [])]) {
      const slot = classSlotForShift(shift)
      if (slot !== null) map[slot] = owner
    }
    return map
  }, [job])

  const { host, overlayProps } = useModalShell(onClose)

  /** The classmates worth showing: enrolled, and already reachable. */
  function contactsIn(entry: ClassEntry): string[] {
    return studentsOf(entry, chars, charInfo).filter(
      (charId) => charInfo[charId]?.flags?.gaveContactInfo
    )
  }

  // The one gate between here and a timetable written into the save, read every render rather
  // than on the click, as the registrar reads it: this is a form, and a form that refuses
  // without naming the field is worse than a dead button (an approved disable notice).
  const complaint = scheduleComplaint(schedule, classes)

  /** Commits the add/drop, and files the receipt in the thread it was asked for in. */
  function finalize(): void {
    if (complaint) return

    const before = new Set(Object.values(current))
    const after = new Set(Object.values(schedule))
    const dropped = [...before].filter((code) => !after.has(code))
    const added = [...after].filter((code) => !before.has(code))

    // Nothing moved: no write, no receipt, no reopened thread.
    if (dropped.length === 0 && added.length === 0) {
      onClose()
      return
    }

    const game = useGameStore.getState()
    game.setPlayerSchedule(schedule)
    game.recordDroppedClasses(dropped)
    // Each add owes the room one entrance, spent at his first meeting of it.
    game.recordAddedClasses(added)

    const nameOf = (code: string): string => classes[code]?.name ?? code
    onClose()
    // Back to the thread the change was asked for in, where the receipt waits.
    const ui = useBunnyboardStore.getState()
    ui.openApp()
    ui.viewChar(VENUS_CHAT_ID)
    replyFromVenus(venusScheduleConfirmation(dropped.map(nameOf), added.map(nameOf)))
  }

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
          id="class-schedule"
          className="vu-classes vu-paper"
          role="dialog"
          aria-modal="true"
          variants={panelUnderTab}
        >
          <TitleTab>Your courses</TitleTab>

          <div className="vu-classes-head">
            {/* The rules at rest, in full, in the registrar's own words: a form that only
                complains afterwards has made the player guess. */}
            <div className="vu-courses-rules">
              <span className="vu-courses-rules-label">ENROLLMENT GUIDELINES</span>
              <ul className="vu-courses-rules-list">
                <li>You must enroll in at least {MIN_PLAYER_COURSES} non-PE courses.</li>
                <li>You must enroll in at least one PE course.</li>
                <li>You cannot enroll in more than {MAX_PLAYER_CLASSES} courses.</li>
                {/* The two the mid-semester page owes that a first enrollment does not: what
                    a drop costs, and why an hour he works is not his to fill. */}
                <li>You cannot re-enroll in a dropped class.</li>
                <li>You cannot enroll in a class that overlaps with a work shift. Request a shift change first.</li>
              </ul>
            </div>

            <span className={`vu-courses-count vu-courses-count--${complaint ? 'short' : 'ok'}`}>
              {count} enrolled
            </span>
          </div>

          <CourseWeek
            compact
            classes={classes}
            schedule={schedule}
            blocked={blocked}
            facesOf={contactsIn}
            onPick={(slot) => setPicking(slot)}
            onDrop={(slot) =>
              setSchedule((prev) => {
                const next = { ...prev }
                delete next[slot]
                return next
              })
            }
          />

          <div className="vu-courses-answers">
            {complaint && <span className="vu-courses-complaint">{complaint}</span>}
            <div className="vu-foot">
              <motion.button
                id="class-schedule-cancel"
                className="vu-btn vu-btn--quiet"
                type="button"
                {...gestures(false, quietLift, quietPress)}
                onClick={onClose}
              >
                Cancel
              </motion.button>
              <motion.button
                id="class-schedule-finalize"
                className="vu-btn vu-btn--primary vu-btn--panel vu-paper"
                type="button"
                disabled={complaint !== null}
                {...gestures(complaint !== null, lift, press)}
                onClick={finalize}
              >
                Finalize
              </motion.button>
            </div>
          </div>
        </motion.div>
      </motion.div>

      {/* A sibling of this modal's veil rather than a child of it, so a click inside the
          picker does not reach that veil's own handler through the React tree. A blocked
          hour never opens it, so it is handed no shifts. */}
      <AnimatePresence propagate>
        {picking !== null && (
          <CoursePickerModal
            key={`course-${picking}`}
            slot={picking}
            theme={theme}
            options={catalog.filter((entry) => entry.slot === picking)}
            dropped={droppedCodes}
            facesOf={contactsIn}
            onPick={(code) => {
              setSchedule((prev) => ({ ...prev, [picking]: code }))
              setPicking(null)
            }}
            onClose={() => setPicking(null)}
          />
        )}
      </AnimatePresence>
    </>,
    host
  )
}
