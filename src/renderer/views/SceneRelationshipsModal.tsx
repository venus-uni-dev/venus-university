/**
 * How one Scene Creator girl stands with each other girl in the scene: a picker per pair, the
 * same answer read from either girl's row.
 */
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'

import type { NpcRelationshipMap } from '@shared/npcRelationships'
import {
  datingOffered,
  pairsAsLaid,
  relationOf,
  SCENE_RELATIONS,
  type SceneRelation,
  type SetupPeople
} from '@shared/sceneCreator'
import type { Character } from '@shared/types'
import { SelectField } from '../components/SelectField'
import { TitleTab } from '../components/TitleTab'
import { useModalShell } from '../components/useModalShell'
import type { ScreenTheme } from './clockTheme'
import { gestures, lift, panelUnderTab, press, veilIn } from './motion'
import '../vu_styles/SceneCreator.css'

/** Each relation as the picker names it. */
export const RELATION_LABELS: Record<SceneRelation, string> = {
  dating: 'Dating',
  friends: 'Friends',
  acquaintances: 'Acquaintances',
  strangers: 'Strangers',
  enemies: 'Enemies'
}

/**
 * The relations a pair's picker offers: every one, but Dating only where the two may still date
 * once every other pick is laid over `base`.
 */
export function relationOptions(
  base: Readonly<NpcRelationshipMap>,
  pairs: Readonly<Record<string, SceneRelation>>,
  a: string,
  b: string,
  people: SetupPeople
): { value: SceneRelation; label: string }[] {
  const dating = datingOffered(base, pairs, a, b, people)
  return SCENE_RELATIONS.filter((relation) => relation !== 'dating' || dating).map((relation) => ({
    value: relation,
    label: RELATION_LABELS[relation]
  }))
}

export interface SceneRelationshipsModalProps {
  theme: ScreenTheme
  character: Character
  /** Everybody else in the scene. */
  others: readonly Character[]
  pairs: Readonly<Record<string, SceneRelation>>
  /** Each of the cast's traits and milestones, which decide who may be set to dating. */
  people: SetupPeople
  onChange: (other: string, relation: SceneRelation) => void
  onClose: () => void
}

/** The relationships panel: every picker is already the answer, so it carries one way out. */
export function SceneRelationshipsModal({
  theme,
  character,
  others,
  pairs,
  people,
  onChange,
  onClose
}: SceneRelationshipsModalProps): JSX.Element | null {
  const { host, overlayProps } = useModalShell(onClose)
  if (!host) return null
  // A pair set to dating that cannot hold, as the scene will play it.
  const shown = pairsAsLaid({}, pairs, people)

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
        id="scene-relationships"
        className="vu-scene-panel vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label={`${character.firstName}'s relationships`}
        variants={panelUnderTab}
      >
        <TitleTab>Relationships</TitleTab>

        <div className="vu-scene-relations">
          {others.map((other) => (
            <SelectField
              key={other.charId}
              id={`scene-relation-${other.charId}`}
              label={`${character.firstName} and ${other.firstName}`}
              value={relationOf(shown, character.charId, other.charId)}
              options={relationOptions({}, shown, character.charId, other.charId, people)}
              onChange={(value) => onChange(other.charId, value as SceneRelation)}
            />
          ))}
        </div>

        <div className="vu-foot">
          <motion.button
            id="scene-relationships-done"
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
