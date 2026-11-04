/**
 * A girl's milestones set by hand from her contact page: one box per milestone, each that the
 * others rule out held where they hold it and dimmed, under a warning to save first. Nothing is
 * applied until Save.
 */
import { useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'

import { globalSlotOf } from '@shared/jobs'
import {
  EDIT_MILESTONES,
  editLocksOf,
  milestonesOfFlags,
  normalizedEditMilestones,
  withEditMilestone,
  type EditMilestones,
  type EditStanding
} from '@shared/milestoneEdit'
import { affectionFor } from '@shared/relationship'
import { CheckField } from '../components/CheckField'
import { TitleTab } from '../components/TitleTab'
import { useModalShell } from '../components/useModalShell'
import { useGameStore } from '../stores/gameStore'
import type { ReplayOffer } from '../stores/loop/saves'
import { saveMilestones } from '../stores/milestoneEdit'
import type { ScreenTheme } from './clockTheme'
import { gestures, lift, panelUnderTab, press, quietLift, quietPress, veilIn } from './motion'
import { milestoneLabel } from './SceneMilestonesModal'
import '../vu_styles/EditMilestones.css'

export interface EditMilestonesModalProps {
  /** Drawn by the screen that opened this — a portal inherits no palette. */
  theme: ScreenTheme
  /** Whose milestones they are. */
  charId: string
  /** Whether the game can take the edit right now; Save is dead while it cannot. */
  offer: ReplayOffer
  onClose: () => void
}

/** The Edit milestones panel: the warning, the boxes, then Cancel and Save. */
export function EditMilestonesModal({
  theme,
  charId,
  offer,
  onClose
}: EditMilestonesModalProps): JSX.Element | null {
  const character = useGameStore((s) => s.characters[charId])
  const info = useGameStore((s) => s.charInfo[charId])
  const date = useGameStore((s) => s.date)
  const time = useGameStore((s) => s.time)
  const events = useGameStore((s) => s.events)

  const now = globalSlotOf(date, time)
  const standing: EditStanding = {
    affection: affectionFor(info, date, character),
    character,
    planAhead: events.some(
      (event) => event.charIds.includes(charId) && globalSlotOf(event.date, event.time) >= now
    )
  }
  // What the panel opened on, which Save applies the difference from.
  const [opened] = useState<EditMilestones>(() =>
    normalizedEditMilestones(milestonesOfFlags(info?.flags), standing)
  )
  const [picked, setPicked] = useState(opened)
  const locked = editLocksOf(picked, standing)
  const name = character?.firstName ?? ''
  const dead = offer !== 'open'

  // Dismissing is Cancel: nothing is applied until Save, so there is nothing to ask.
  const { host, overlayProps } = useModalShell(onClose)
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
        id="edit-milestones"
        className="vu-milestones vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label={`Milestones with ${name}`}
        variants={panelUnderTab}
      >
        <TitleTab>Edit milestones</TitleTab>

        <p className="vu-milestones-warn">
          Setting or unsetting milestones by hand may have unforeseen consequences. It&apos;s highly
          recommended to make a manual save first.
        </p>

        <div className="vu-milestones-checks">
          {EDIT_MILESTONES.map((key) => (
            <CheckField
              key={key}
              id={`edit-milestone-${key}`}
              label={milestoneLabel(key, name)}
              checked={picked[key]}
              disabled={key in locked}
              onChange={(checked) => setPicked(withEditMilestone(picked, key, checked, standing))}
            />
          ))}
        </div>

        <div className="vu-foot">
          <motion.button
            id="edit-milestones-cancel"
            className="vu-btn vu-btn--quiet"
            type="button"
            {...gestures(false, quietLift, quietPress)}
            onClick={onClose}
          >
            Cancel
          </motion.button>
          <motion.button
            id="edit-milestones-save"
            className="vu-btn vu-btn--primary vu-btn--panel vu-paper"
            type="button"
            disabled={dead}
            {...gestures(dead, lift, press)}
            onClick={() => {
              if (EDIT_MILESTONES.some((key) => opened[key] !== picked[key])) {
                saveMilestones(charId, opened, picked)
              }
              onClose()
            }}
          >
            Save
          </motion.button>
        </div>
      </motion.div>
    </motion.div>,
    host
  )
}
