import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { classGroupLabel, classGroupOf, isCourse } from '@shared/academics'
import { TIME_SLOT_ROWS, WEEKDAY_NAMES } from '@shared/classes'
import type { ClassEntry, ClassSlot } from '@shared/types'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { profileUrl, useSpriteVersion } from '../stores/characterStore'
import type { ScreenTheme } from './clockTheme'
import {
  dealt,
  gestures,
  lift,
  panelUnderTab,
  press,
  rowLift,
  rowPress,
  slideInQuick,
  veilIn
} from './motion'

/**
 * Everything meeting in one hour, for a timetable to fill it with. Rendered inline as the
 * screen's own layer inside `ClassSelectView`, or portalled as a themed modal from the add/drop
 * editor — `theme` present or absent says which; both go through `useModalShell`.
 */

export interface CoursePickerModalProps {
  slot: ClassSlot
  /** Every course meeting in `slot`, in catalog order. */
  options: readonly ClassEntry[]
  onPick: (code: string) => void
  onClose: () => void
  /**
   * Present and the picker portals into its own dimming wearing this theme; absent and it is
   * the screen's layer, inheriting the one that screen already drew.
   */
  theme?: ScreenTheme
  /** Courses he has already dropped: listed, dead, and never offered again. */
  dropped?: ReadonlySet<string>
  /** Which classmates ride a row, if any. */
  facesOf?: (entry: ClassEntry) => readonly string[]
}

/** The deal runs with the panel: nothing here resizes, so there is no landing to wait on. */
const PICK_DEAL = dealt(0, 0.03)

/** Who teaches it, in the two words the game uses for the two kinds of class. */
export function teacherOf(entry: ClassEntry): string {
  return isCourse(entry) ? `Prof. ${entry.professor.lastName}` : `Coach ${entry.instructor.lastName}`
}

/**
 * A course's code, tinted by the group it is offered in. The one mark the tile on the grid and
 * the row in this list both wear, which is what makes the colour on a tile mean anything: the
 * line under it in this list spells the group out, so nothing on the screen needs a key.
 */
export function CourseCode({ entry }: { entry: ClassEntry }): JSX.Element {
  return (
    <span className="vu-code" data-group={classGroupOf(entry)}>
      {entry.code}
    </span>
  )
}

/**
 * A classmate beside the course she is in — her `profile.png` in an archway. She opens nothing
 * here; the row and tile she rides answer the pointer. Reading `spriteVersion` busts the cache
 * so a reframed face doesn't keep showing the picture behind the old URL.
 */
function CourseFace({ charId }: { charId: string }): JSX.Element {
  const version = useSpriteVersion(charId)
  return (
    <span className="vu-arch vu-courses-face">
      <span className="vu-crop">
        <img className="vu-crop-img" src={profileUrl(charId, version)} alt="" />
      </span>
    </span>
  )
}

/**
 * Who is in the room, under what the course says about itself. `null` is a screen that shows
 * nobody at all; an empty list is a room he can name nobody in yet, drawn as one dashed
 * archway rather than left out. Every element is a `span`, a picker row being a `button`.
 */
export function CourseFaces({ faces }: { faces: readonly string[] | null }): JSX.Element | null {
  if (faces === null) return null
  if (faces.length === 0) {
    return (
      <span className="vu-courses-faces">
        <span className="vu-courses-face vu-courses-face--unknown" aria-hidden="true">
          ?
        </span>
      </span>
    )
  }
  return (
    <span className="vu-courses-faces">
      {faces.map((charId) => (
        <CourseFace key={charId} charId={charId} />
      ))}
    </span>
  )
}

/** `"Tuesday · Day"` — the hour being filled, carried in from the tile that was clicked. */
function slotWords(slot: ClassSlot): string {
  return `${WEEKDAY_NAMES[Math.floor(slot / 2)]} · ${TIME_SLOT_ROWS[slot % 2].label}`
}

/** Which group a class is offered in, and how hard it is; PE sits out the arithmetic. */
function metaOf(entry: ClassEntry): string {
  const group = classGroupLabel(classGroupOf(entry))
  return isCourse(entry) ? `${group} · ${entry.difficulty}` : group
}

/** What a row says about its course, whether or not the row can be pressed. */
function RowBody({
  entry,
  faces,
  dropped
}: {
  entry: ClassEntry
  faces: readonly string[] | null
  dropped: boolean
}): JSX.Element {
  return (
    <>
      <span className="vu-pickcourse-headline">
        <CourseCode entry={entry} />
        <span className="vu-pickcourse-name">{entry.name}</span>
        {/* The one word for the state, on the row it is about: a course he has dropped is
            listed so the hour reads whole, and the dim says the rest. */}
        {dropped && <span className="vu-pickcourse-tag">Dropped</span>}
        <span className="vu-pickcourse-teacher">{teacherOf(entry)}</span>
      </span>
      {/* Under the chip rather than beside the title, which leaves the title the width. It is
          still the line the chip is read against, so the colour is learned here and merely
          recognised on the grid afterwards. */}
      <span className="vu-pickcourse-meta" data-group={classGroupOf(entry)}>
        {metaOf(entry)}
      </span>
      <span className="vu-pickcourse-desc">{entry.description}</span>
      <CourseFaces faces={faces} />
    </>
  )
}

export function CoursePickerModal({
  slot,
  options,
  onPick,
  onClose,
  theme,
  dropped,
  facesOf
}: CoursePickerModalProps): JSX.Element | null {
  // On the registrar the host is the one part of the shell this modal has no use for: it
  // renders in place. From the editor it is what it portals into.
  const { host, overlayProps } = useModalShell(onClose)

  const panel = (
    <motion.div
      id="course-picker"
      className="vu-pickcourse vu-paper"
      role="dialog"
      aria-modal="true"
      aria-label="Available courses"
      variants={panelUnderTab}
    >
      <TitleTab>Available Courses</TitleTab>

      <div className="vu-pickcourse-head">
        <span className="vu-pickcourse-slot">{slotWords(slot)}</span>
      </div>

      <div className="vu-pickcourse-scroll">
        {options.length === 0 ? (
          <p className="vu-empty vu-empty--flush">No available courses.</p>
        ) : (
          <motion.ul className="vu-pickcourse-list" variants={PICK_DEAL}>
            {options.map((entry) => {
              const gone = dropped?.has(entry.code) ?? false
              // A course he cannot take again is not a room he will be in, and a screen that
              // was handed no roster knows of nobody: either way the row shows nobody at all,
              // which is not the same as a room he can name nobody in yet.
              const faces = gone || !facesOf ? null : facesOf(entry)
              return (
                <motion.li key={entry.code} variants={slideInQuick}>
                  {gone ? (
                    // A `div` rather than a dead button: it is not a control at all, and it
                    // stays in the list so the hour's options do not renumber under the hand.
                    <div className="vu-row vu-pickcourse-row vu-pickcourse-row--dropped">
                      <RowBody entry={entry} faces={faces} dropped />
                    </div>
                  ) : (
                    /* One tap enrolls: the tile's own ✕ is the undo, so there is nothing here
                       for a confirm to protect. A row that already spans its column tints
                       rather than swelling into the one under it. */
                    <motion.button
                      type="button"
                      className="vu-row vu-pickcourse-row"
                      {...gestures(false, rowLift, rowPress)}
                      onClick={() => onPick(entry.code)}
                    >
                      <RowBody entry={entry} faces={faces} dropped={false} />
                    </motion.button>
                  )}
                </motion.li>
              )
            })}
          </motion.ul>
        )}
      </div>

      {/* A panel that has committed nothing has one answer, and a modal is left by a
          button rather than by a ✕. */}
      <div className="vu-foot">
        <motion.button
          id="course-picker-close"
          className="vu-btn vu-btn--primary vu-btn--panel vu-paper"
          type="button"
          {...gestures(false, lift, press)}
          onClick={onClose}
        >
          Close
        </motion.button>
      </div>
    </motion.div>
  )

  // The registrar's own layer: it dims the page and not the browser above it, and it is
  // written where it is read rather than portalled out of the screen.
  if (theme === undefined) {
    return (
      <motion.div
        className="vu-courses-veil"
        variants={veilIn}
        initial="hidden"
        animate="shown"
        exit="gone"
        {...overlayProps}
      >
        {panel}
      </motion.div>
    )
  }

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
      {panel}
    </motion.div>,
    host
  )
}
