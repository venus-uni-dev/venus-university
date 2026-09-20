/**
 * The self-improvement screen: what a slot made of the reader, read on a sheet rising from the
 * bottom of the stage. Reads no store — the loop hands it both readings and takes the answer
 * back.
 */
import { type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'

import { STAT_LABELS, tierName, type PlayerStats, type StatKey } from '@shared/playerStats'
import { useModalShell } from '../components/useModalShell'
import { StatRadar, type StatRadarArrival } from '../components/StatRadar'
import type { ScreenTheme } from './clockTheme'
import {
  gestures,
  lift,
  press,
  rankChase,
  rankFoot,
  rankLead,
  rankTitle,
  badgePulse,
  statBadgeRaised,
  tierNew,
  tierOld,
  veilIn
} from './motion'
import '../vu_styles/RankUp.css'

/**
 * What the chart wears here, built **once**: a bundle made during render is a new identity each
 * time, and the badge swap is still running when the pill starts hopping again. The plot and
 * badges have no arrival of their own — the sheet they're printed on is already arriving.
 */
const RANK_ARRIVAL: StatRadarArrival = {
  badgeRaised: statBadgeRaised,
  badgePulse,
  crossfade: { from: tierOld, to: tierNew }
}

export interface RankUpModalProps {
  /** The stats this slot bought a tier on, in stat order; never empty — the loop raises no empty screen. */
  ups: readonly StatKey[]
  /** The reader either side of the scene: the shape walks from one to the other, as do the pills. */
  before: PlayerStats
  after: PlayerStats
  /** The slot's own half of the day, as every modal over the scene takes it. */
  theme: ScreenTheme
  onClose: () => void
}

/**
 * Three layers and what is printed on the near one. **Escape and a click on the dimming are the
 * button**: there is one answer here and nothing to lose by giving it, so the shell's own rule
 * needs no exception.
 */
export function RankUpModal({
  ups,
  before,
  after,
  theme,
  onClose
}: RankUpModalProps): JSX.Element | null {
  const { host, overlayProps } = useModalShell(onClose, 'none')
  if (!host) return null

  return createPortal(
    <motion.div
      className="vu-veil vu-veil--bare vu-rank"
      data-theme={theme}
      variants={veilIn}
      initial="hidden"
      animate="shown"
      exit="gone"
      {...overlayProps}
    >
      {/* The wipe's own two layers standing still: the accent at 60% announces the sheet it is
          offset behind, and the sheet carries the chart up with it. Both are absolute children of
          the veil, which is what takes them out of its centring grid and past its padding — a
          shape that stopped short of the bottom edge would sit on the stage rather than rise
          into it. */}
      <motion.div className="vu-rank-scrim" variants={rankLead} aria-hidden="true" />

      <motion.div
        className="vu-rank-sheet"
        variants={rankChase}
        role="dialog"
        aria-modal="true"
        aria-label="Self-improvement"
      >
        {/* The shape the screen is about, walking into its new reading under the sheet's own
            arrival, with the badges of the stats that moved swelling and swapping on it. */}
        <StatRadar
          className="vu-rank-radar"
          stats={after}
          from={before}
          raised={ups}
          arrival={RANK_ARRIVAL}
        />
      </motion.div>

      {/* The title over the crown of the sheet, and a child of the veil rather than of it: it
          grows in place on its own clock while the sheet is still rising underneath. */}
      <motion.div className="vu-title vu-rank-title" variants={rankTitle}>
        <h2 className="vu-title-text">Self-improvement</h2>
      </motion.div>

      {/* The badge tells the crossing; this records it. One line per stat that moved, naming the
          tier it came from and the tier it reached, on the sheet's other shoulder — it tips with
          the foot and the title and arrives on the foot's own clock. */}
      <motion.div className="vu-rank-note" variants={rankFoot}>
        {ups.map((key) => (
          <span key={key}>
            {`${STAT_LABELS[key]} went from ${tierName(before[key])} to ${tierName(after[key])}.`}
          </span>
        ))}
      </motion.div>

      {/* The answer, in the stage's own corner rather than the sheet's: the sheet's bottom-right
          is below the stage, and this is the screen asking. It arrives on the sheet's own clock,
          so it lands as the surface it is read against does. */}
      <motion.div className="vu-foot vu-rank-foot" variants={rankFoot}>
        <motion.button
          id="rank-up-ok"
          type="button"
          className="vu-btn vu-btn--primary vu-paper"
          onClick={onClose}
          {...gestures(false, lift, press)}
        >
          Awesome
        </motion.button>
      </motion.div>
    </motion.div>,
    host
  )
}
