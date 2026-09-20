import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { appError, messageOf } from '@shared/errors'
import type { Emotion, OutfitSet, WardrobeFixImage } from '@shared/types'
import { toPngBase64 } from '../components/LayerPainter'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { loadWardrobeImage, useCharacterStore } from '../stores/characterStore'
import { useJobStore } from '../stores/jobStore'
import { useUiStore } from '../stores/uiStore'
import { compositeHands, previewBox } from './handFix'
import { gestures, lift, panelUnderTab, press, quietLift, quietPress, spin, veilIn } from './motion'
import '../vu_styles/HandPreview.css'

export interface HandPreviewModalProps {
  charId: string
  /** Which wardrobe is being repaired; `null` is the default one. */
  set: OutfitSet | null
  /** The wardrobe's name, as the panel that opened this shows it. */
  title: string
  theme: 'day' | 'night'
  /** The strokes the fix renders from, as the painter exported them. */
  paintLayer: string
  /** The sprites on disk this would be applied to. */
  emotions: readonly Emotion[]
  onCancel: () => void
  onApplied: () => void
}

/** What the fix has produced so far, and what the foot may offer over it. */
type Phase = 'running' | 'ready' | 'none'

/** The close-up, at the size a hand is judged at. */
const CELL = 600

/**
 * What the hand fix rendered, before any of it is written. It answers only by its own
 * buttons — Escape and the dimming do nothing — because the two things it can be doing are a
 * render the queue is holding and a decision nothing else can make.
 */
export function HandPreviewModal({
  charId,
  set,
  title,
  theme,
  paintLayer,
  emotions,
  onCancel,
  onApplied
}: HandPreviewModalProps): JSX.Element | null {
  const cellRef = useRef<HTMLCanvasElement>(null)
  const frames = useRef<{ cutout: ImageBitmap; region: ImageBitmap } | null>(null)
  const [phase, setPhase] = useState<Phase>('running')
  const [applying, setApplying] = useState(false)

  const fixHands = useCharacterStore((s) => s.fixHands)
  const cancelHandFix = useCharacterStore((s) => s.cancelHandFix)
  const applyFix = useCharacterStore((s) => s.applyWardrobeFix)

  /* The queue's own words for where the job is. Read only while this modal's own phase
     says one is running: a finished entry keeps its `Done` and would flash under the next. */
  const step = useJobStore((s) => s.jobs[`${charId}:hands:${set ?? 'default'}`]?.step)

  /** True until this modal is gone: what a job resolving into an unmounted modal is tested on. */
  const live = useRef(true)
  /**
   * Whether this modal has already submitted its render. **Not** the same as `live`: StrictMode
   * remounts once in dev, so a `[]`-keyed effect runs twice with `live` back to `true`, and two
   * renders would queue under two seeds, the second replacing the first under the player. A ref
   * survives the simulated remount; state does not.
   */
  const started = useRef(false)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      frames.current?.cutout.close()
      frames.current?.region.close()
    }
  }, [])

  /* The render, started once on mount: this modal *is* the job, and cancelling it is what its
     Cancel does. A failure has already raised its own modal in the store, so all that is left
     here is to go back to the strokes. */
  useEffect(() => {
    if (started.current) return
    started.current = true

    void (async () => {
      const rendered = await fixHands(charId, set, paintLayer)
      if (!live.current) return
      if (!rendered) {
        onCancel()
        return
      }

      try {
        const [cutout, region] = await Promise.all([
          createImageBitmap(new Blob([rendered.cutout], { type: 'image/png' })),
          createImageBitmap(new Blob([rendered.region], { type: 'image/png' }))
        ])
        if (!live.current) {
          cutout.close()
          region.close()
          return
        }
        frames.current?.cutout.close()
        frames.current?.region.close()
        frames.current = { cutout, region }

        // An empty region is the graph saying it found no hand near the strokes.
        const box = previewBox(region)
        if (!box) {
          setPhase('none')
          return
        }

        const sprite = await loadWardrobeImage(charId, set, 'neutral')
        if (!live.current || !sprite) {
          sprite?.close()
          setPhase('none')
          return
        }

        // The close-up is the composite itself, cropped: what is shown is what would land.
        const whole = document.createElement('canvas')
        compositeHands(whole, sprite, region, cutout)
        sprite.close()

        const cell = cellRef.current
        const ctx = cell?.getContext('2d')
        if (cell && ctx) {
          const scale = CELL / Math.max(box.width, box.height)
          cell.width = Math.round(box.width * scale)
          cell.height = Math.round(box.height * scale)
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(
            whole,
            box.x,
            box.y,
            box.width,
            box.height,
            0,
            0,
            cell.width,
            cell.height
          )
        }
        setPhase('ready')
      } catch (err) {
        if (!live.current) return
        useUiStore
          .getState()
          .showError(appError('FIX_NOT_PNG', 'Could not read the fixed hand.', messageOf(err)))
        onCancel()
      }
    })()
    // Guarded by the ref above rather than by these deps: under StrictMode an empty array is
    // still run twice, and each run is a whole render of the queue's.
  }, [])

  /** Stops the render and goes back to the strokes, which are still on the painter's canvas. */
  const stop = (): void => {
    void cancelHandFix(charId, set)
    onCancel()
  }

  /** Lays the fix over every sprite the set has and writes them back. */
  const apply = async (): Promise<void> => {
    const rendered = frames.current
    if (!rendered || applying) return

    setApplying(true)
    try {
      const work = document.createElement('canvas')
      const images: WardrobeFixImage[] = []

      for (const emotion of emotions) {
        const sprite = await loadWardrobeImage(charId, set, emotion)
        // Gone since the panel counted it; the others are still repaired.
        if (!sprite) continue

        compositeHands(work, sprite, rendered.region, rendered.cutout)
        sprite.close()
        images.push({ emotion, data: await toPngBase64(work) })
      }

      if (images.length === 0) return
      // No layer kept, and the one this repair was painted over removed with the write: the
      // strokes placed a finger on the hand these sprites no longer have.
      const ok = await applyFix(charId, set, images, null, 'hands')
      if (ok) onApplied()
    } catch (err) {
      // Compositing has no service behind it, so its failure is wrapped here (a tier-2 recoverable
      // modal).
      useUiStore
        .getState()
        .showError(appError('SPRITE_UNWRITABLE', 'Could not repair the sprites.', messageOf(err)))
    } finally {
      setApplying(false)
    }
  }

  // Answered by its buttons alone: a render in flight and a decision are neither of them
  // things a stray click outside should settle.
  const { host, overlayProps } = useModalShell(() => {})
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
        id="hand-preview"
        className="vu-hands vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label={`Fixed hand — ${title}`}
        variants={panelUnderTab}
      >
        <TitleTab>Fixed hand</TitleTab>

        <div className="vu-hands-cell" style={{ '--cell': `${CELL}px` } as CSSProperties}>
          {phase === 'running' && (
            <div className="vu-hands-waiting">
              <motion.span className="vu-ring vu-hands-ring" animate={spin} />
              <span className="vu-hands-step">{step ?? 'Queued'}</span>
            </div>
          )}
          {phase === 'none' && (
            <p className="vu-hands-empty">
              Nothing was redrawn. Paint a larger area over the hand, covering where the
              finger is missing.
            </p>
          )}
          <canvas ref={cellRef} className="vu-hands-shot" hidden={phase !== 'ready'} />
        </div>

        <p className="vu-hands-hint">
          {phase === 'ready'
            ? `Fix will be applied to all outfit sprites. If it still looks bad, try cancelling and retrying with a new seed.`
            : phase === 'running'
              ? 'Generation in progress. Please wait...'
              : 'Changes have not been applied yet.'}
        </p>

        <div className="vu-foot">
          <motion.button
            id="hand-cancel"
            className="vu-btn vu-btn--quiet"
            type="button"
            disabled={applying}
            {...gestures(applying, quietLift, quietPress)}
            onClick={phase === 'running' ? stop : onCancel}
          >
            {phase === 'running' ? 'Cancel' : 'Back to paint'}
          </motion.button>
          {phase === 'ready' && (
            <motion.button
              id="hand-apply"
              className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
              type="button"
              disabled={applying}
              {...gestures(applying, lift, press)}
              onClick={() => void apply()}
            >
              {applying ? 'Applying…' : `Apply to ${emotions.length} sprites`}
            </motion.button>
          )}
        </div>
      </motion.div>
    </motion.div>,
    host
  )
}
