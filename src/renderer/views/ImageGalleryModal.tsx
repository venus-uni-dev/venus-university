import { useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { POSITIONS } from '@shared/positions'
import { ROOM_VARIANTS, type RoomVariant } from '@shared/room'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import {
  cgTargetFor,
  liveCgTasks,
  liveTaskFor,
  roomUrl,
  spriteUrl,
  stagedOf,
  useCharacterStore,
  useSpriteVersion
} from '../stores/characterStore'
import {
  gestures,
  lift,
  panelUnderTab,
  peek,
  press,
  rowPress,
  spin,
  tuck,
  veilIn
} from './motion'
import '../vu_styles/ImageGallery.css'
import type { Position, SetTarget } from '@shared/types'

/** Which of the two landscape image sets a gallery is showing. */
type GalleryKind = Extract<SetTarget, 'cgs' | 'room'>

/** Everything that differs between the two galleries — the rest is shared. */
const KINDS: Record<
  GalleryKind,
  {
    title: string
    keys: readonly string[]
    /** Two 16:9 frames side by side instead of eight CGs. */
    pair: boolean
    urlOf: (charId: string, key: string, version: number, staged: boolean) => string
    labelOf: (key: string) => string
  }
> = {
  cgs: {
    title: 'NSFW CG',
    keys: POSITIONS,
    pair: false,
    urlOf: (charId, key, version, staged) => spriteUrl(charId, key as Position, version, staged),
    labelOf: (key) => key.replaceAll('_', ' ')
  },
  room: {
    title: 'Room BG',
    keys: ROOM_VARIANTS,
    pair: true,
    urlOf: (charId, key, version, staged) => roomUrl(charId, key as RoomVariant, version, staged),
    labelOf: (key) => key
  }
}

/**
 * One image, and — where it may be re-rolled — the control that does it, shown on the
 * hover. Its own component so each cell owns the hover state driving that reveal.
 */
function GalleryCell({
  src,
  label,
  live,
  onAct
}: {
  src: string | null
  label: string
  /** This image is being re-rolled right now, so its control is a cancel and stays up. */
  live: boolean
  /** Absent where the image is not the player's to re-roll — a plain picture. */
  onAct?: () => void
}): JSX.Element {
  const [hovered, setHovered] = useState(false)

  const picture =
    src === null ? (
      <span className="vu-gallery-empty">NOT GENERATED</span>
    ) : (
      <img className="vu-gallery-img" src={src} alt={label} />
    )
  const empty = src === null ? ' vu-gallery-cell--empty' : ''

  return (
    <li className="vu-gallery-item">
      {onAct ? (
        <motion.button
          className={`vu-gallery-cell vu-gallery-cell--action${empty}`}
          type="button"
          animate={live || hovered ? 'shown' : 'hidden'}
          whileFocus="shown"
          whileTap={rowPress}
          onHoverStart={() => setHovered(true)}
          onHoverEnd={() => setHovered(false)}
          onClick={onAct}
        >
          {picture}
          {/* Variants rather than a `whileHover`, so focusing the cell reveals the pill
              inside it; `initial={false}` or it flashes on mount before tucking away. */}
          <motion.span
            className="vu-gallery-action"
            variants={{ shown: peek, hidden: tuck }}
            initial={false}
          >
            {live ? (
              <>
                <motion.span className="vu-ring" animate={spin} />
                Cancel
              </>
            ) : (
              '↻ Regenerate'
            )}
          </motion.span>
        </motion.button>
      ) : (
        <div className={`vu-gallery-cell${empty}`}>{picture}</div>
      )}
      <span className="vu-gallery-caption">{label}</span>
    </li>
  )
}

export interface ImageGalleryModalProps {
  charId: string
  kind: GalleryKind
  theme: 'day' | 'night'
  /** Whether a CG may be re-rolled by clicking it. */
  regenEnabled?: boolean
  /**
   * Where a re-roll click goes instead of straight to the store — the Edit modal's
   * unsaved-changes gate. Cancel clicks never route through it.
   */
  onRegenerate?: (position: Position) => void
  onClose: () => void
}

/**
 * A character's landscape images at full size — all eight CGs four across, or the two
 * room backgrounds side by side, each captioned at rest.
 */
export function ImageGalleryModal({
  charId,
  kind,
  theme,
  regenEnabled,
  onRegenerate,
  onClose
}: ImageGalleryModalProps): JSX.Element | null {
  const spec = KINDS[kind]
  const onDisk = useCharacterStore((s) => (kind === 'cgs' ? s.cgs[charId] : s.rooms[charId]))
  const version = useSpriteVersion(charId)
  const staged = useCharacterStore((s) => s.staged)
  const progress = useCharacterStore((s) => s.progress[charId])
  const generateSet = useCharacterStore((s) => s.generateSet)
  const cancelSet = useCharacterStore((s) => s.cancelSet)
  // While the set regenerates, the gallery shows this run's staged images.
  const regenerating = Boolean(liveTaskFor(progress, kind)?.staged)
  const present: Record<string, boolean> | undefined = regenerating
    ? stagedOf(staged, charId, kind)
    : onDisk

  // No per-image re-roll while the whole set runs: its control is where it stops.
  const perImage = kind === 'cgs' && regenEnabled === true && !liveTaskFor(progress, 'cgs')
  const rerolling = new Set(liveCgTasks(progress))
  const done = spec.keys.filter((key) => present?.[key]).length

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
        id={`${kind}-gallery`}
        className="vu-gallery vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label={spec.title}
        variants={panelUnderTab}
      >
        <TitleTab>{spec.title}</TitleTab>

        <div className="vu-gallery-head">
          <span
            className={`vu-count vu-gallery-count vu-count--${done === spec.keys.length ? 'good' : 'warn'}`}
          >
            {done}/{spec.keys.length}
          </span>
          {perImage && (
            <span className="vu-gallery-hint">
              Click on a CG to re-render it with a new seed.
            </span>
          )}
        </div>

        <ul className={`vu-gallery-grid${spec.pair ? ' vu-gallery-grid--pair' : ''}`}>
          {spec.keys.map((key) => {
            const live = rerolling.has(key as Position)
            // Only an existing image is offered a re-roll; a gap is the set control's
            // job. A re-roll in flight stays clickable to cancel it.
            const action = perImage && (present?.[key] || live)

            return (
              <GalleryCell
                key={key}
                src={present?.[key] ? spec.urlOf(charId, key, version, regenerating) : null}
                label={spec.labelOf(key)}
                live={live}
                onAct={
                  action
                    ? () => {
                        if (live) {
                          void cancelSet(charId, cgTargetFor(key as Position))
                          return
                        }
                        if (onRegenerate !== undefined) {
                          onRegenerate(key as Position)
                          return
                        }
                        void generateSet(charId, cgTargetFor(key as Position), 'regenerate')
                      }
                    : undefined
                }
              />
            )
          })}
        </ul>

        <div className="vu-foot">
          <motion.button
            id={`${kind}-gallery-close`}
            className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
            type="button"
            {...gestures(false, lift, press)}
            onClick={onClose}
          >
            Close
          </motion.button>
        </div>
      </motion.div>
    </motion.div>,
    host
  )
}
