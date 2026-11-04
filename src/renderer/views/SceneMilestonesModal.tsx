/**
 * Where a Scene Creator girl stands with the reader before the scene opens: one box per
 * milestone, each that the others rule out held where they hold it and dimmed.
 */
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'

import {
  effectiveDisposition,
  lockedMilestones,
  normalizeMilestones,
  SCENE_MILESTONES,
  withMilestone,
  type SceneCastEntry,
  type SceneMilestone,
  type SceneMilestones
} from '@shared/sceneCreator'
import type { Character } from '@shared/types'
import { CheckField } from '../components/CheckField'
import { TitleTab } from '../components/TitleTab'
import { useModalShell } from '../components/useModalShell'
import type { ScreenTheme } from './clockTheme'
import { gestures, lift, panelUnderTab, press, veilIn } from './motion'
import '../vu_styles/SceneCreator.css'

/** What each box says, her name standing in where the milestone is hers or his. */
export function milestoneLabel(key: SceneMilestone | 'contact' | 'blocked', name: string): string {
  switch (key) {
    case 'met':
      return `Met before`
    case 'lovers':
      return 'Lovers'
    case 'crush':
      return `Has a crush`
    case 'kissed':
      return 'Kissed before'
    case 'sex':
      return 'Slept together before'
    case 'broke_up':
      return 'Broke up before'
    case 'friendzoned_by_reader':
      return `You friendzoned ${name}`
    case 'friendzoned_reader':
      return `${name} friendzoned you`
    case 'agreed_to_harem':
      return `Agreed to an open relationship`
    case 'contact':
      return 'Gave you her contact info'
    case 'blocked':
      return `${name} blocked you`
  }
}

export interface SceneMilestonesModalProps {
  theme: ScreenTheme
  character: Character
  entry: SceneCastEntry
  onChange: (milestones: SceneMilestones) => void
  onClose: () => void
}

/** The milestones panel: every box is already the answer, so it carries one way out. */
export function SceneMilestonesModal({
  theme,
  character,
  entry,
  onChange,
  onClose
}: SceneMilestonesModalProps): JSX.Element | null {
  const { host, overlayProps } = useModalShell(onClose)
  if (!host) return null

  const disposition = effectiveDisposition(entry)
  const shown = normalizeMilestones(entry.milestones, disposition, character)
  const locked = lockedMilestones(shown, disposition, character)
  const name = character.firstName

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
        id="scene-milestones"
        className="vu-scene-panel vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label={`Milestones with ${name}`}
        variants={panelUnderTab}
      >
        <TitleTab>Milestones</TitleTab>

        <div className="vu-scene-checks">
          {SCENE_MILESTONES.map((key) => (
            <CheckField
              key={key}
              id={`scene-milestone-${key}`}
              label={milestoneLabel(key, name)}
              checked={shown[key]}
              disabled={key in locked}
              onChange={(checked) =>
                onChange(withMilestone(shown, key, checked, disposition, character))
              }
            />
          ))}
        </div>

        <div className="vu-foot">
          <motion.button
            id="scene-milestones-done"
            className="vu-btn vu-btn--primary vu-btn--panel vu-paper"
            type="button"
            {...gestures(false, lift, press)}
            onClick={onClose}
          >
            Done
          </motion.button>
        </div>
      </motion.div>
    </motion.div>,
    host
  )
}
