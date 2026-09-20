/**
 * One girl's milestones, as a screen rather than a line: her sprite, the scene's milestone
 * sentences with the phrase that earned them marked, and a heart (or broken heart) behind her.
 */
import { type CSSProperties, type JSX, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'

import { milestoneMarkOf } from '@shared/relationship'
import { Burst } from '../components/Burst'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import type { ScreenTheme } from './clockTheme'
import { BrokenHeartIcon, HeartIcon } from './screenIcons'
import {
  gestures,
  lift,
  milestoneHeart,
  milestoneLines,
  milestoneSprite,
  panelUnderTab,
  press,
  slideInQuick,
  veilIn
} from './motion'
import '../vu_styles/Milestone.css'

/** How thin the mark behind the panel is drawn: the app's own 2.5 is a band at this size. */
const HEART_STROKE = 0.7

export interface MilestoneModalProps {
  /** Already masked by the loop, exactly as a speaker is: `???` until he can name her. */
  name: string
  /** Her sprite, resolved by the caller: this milestone's own expression in her default wardrobe. */
  sprite: string
  /** `Character.height`, a share of the tallest she could be — the stage's own `--stage-char-scale`. */
  scale: number
  /** Her milestone sentences, in `milestoneStatusLines`' own order; never empty. */
  lines: readonly string[]
  /** She friendzoned him, he friendzoned her, or they broke up — the mark turns on it. */
  negative: boolean
  /** The slot's own half of the day, as every modal over the scene takes it. */
  theme: ScreenTheme
  onClose: () => void
}

export function MilestoneModal({
  name,
  sprite,
  scale,
  lines,
  negative,
  theme,
  onClose
}: MilestoneModalProps): JSX.Element | null {
  const { host, overlayProps } = useModalShell(onClose, 'none')
  // Which rows have finished sliding in: a splash is thrown off a phrase the moment its own row
  // lands, so the dots leave the word rather than travelling with it.
  const [landed, setLanded] = useState<ReadonlySet<number>>(() => new Set())
  const land = (index: number): void => {
    setLanded((was) => (was.has(index) ? was : new Set(was).add(index)))
  }
  if (!host) return null

  return createPortal(
    <motion.div
      className="vu-veil vu-mile-veil"
      data-theme={theme}
      variants={veilIn}
      initial="hidden"
      animate="shown"
      exit="gone"
      {...overlayProps}
    >
      {/* The mark, written **before** the panel so it paints under it: two positioned siblings
          stack in tree order and neither needs a `z-index` for it. It peeks out of the panel's
          left, top and foot, which is what makes it the ground rather than a picture on the
          sheet, and it answers no pointer — a click through it is a click on the dimming. */}
      <motion.div
        className={negative ? 'vu-mile-heart vu-mile-heart--broken' : 'vu-mile-heart'}
        variants={milestoneHeart}
        aria-hidden="true"
      >
        {negative ? (
          <BrokenHeartIcon strokeWidth={HEART_STROKE} />
        ) : (
          <HeartIcon strokeWidth={HEART_STROKE} />
        )}
      </motion.div>

      <motion.div
        className="vu-mile vu-paper"
        variants={panelUnderTab}
        role="dialog"
        aria-modal="true"
        aria-label="Milestone"
      >
        <TitleTab>Milestone</TitleTab>

        <div className="vu-mile-said">
          <span className="vu-mile-name">{name}</span>
          <motion.ul className="vu-mile-lines" variants={milestoneLines}>
            {lines.map((line, index) => {
              // The phrase the hour turned on, painted where the sentence carries it; a line
              // naming none is said plain.
              const mark = milestoneMarkOf(line)
              return (
                <motion.li
                  key={line}
                  variants={slideInQuick}
                  onAnimationComplete={(label) => {
                    if (label === 'shown') land(index)
                  }}
                >
                  {mark ? (
                    <>
                      {line.slice(0, mark.start)}
                      <span className="vu-mile-mark" data-tone={mark.tone}>
                        {line.slice(mark.start, mark.end)}
                        {landed.has(index) && <Burst kind="splash" />}
                      </span>
                      {line.slice(mark.end)}
                    </>
                  ) : (
                    line
                  )}
                </motion.li>
              )
            })}
          </motion.ul>
        </div>

        <div className="vu-foot">
          <motion.button
            id="milestone-ok"
            type="button"
            className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
            onClick={onClose}
            {...gestures(false, lift, press)}
          >
            Okay
          </motion.button>
        </div>
      </motion.div>

      {/* Her, written **after** the panel so she paints over it: two positioned siblings stack in
          tree order, which is the heart's own reasoning read the other way round. She is the
          stage's sprite at the stage's height, standing on the veil's bottom edge, and she
          answers no pointer. */}
      <motion.div className="vu-mile-stand" variants={milestoneSprite} aria-hidden="true">
        <img
          className="vu-stage-portrait"
          src={sprite}
          alt=""
          style={{ '--stage-char-scale': scale } as CSSProperties}
        />
      </motion.div>
    </motion.div>,
    host
  )
}
