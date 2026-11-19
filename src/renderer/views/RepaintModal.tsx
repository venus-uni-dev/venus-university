import { useRef, useState, type CSSProperties, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { EMOTIONS } from '@shared/emotions'
import { appError, messageOf } from '@shared/errors'
import { REPAINT_STRENGTH } from '@shared/outfits'
import type { Emotion, OutfitSet } from '@shared/types'
import { ConfirmModal } from '../components/ConfirmModal'
import { LayerPainter, toPngBase64, type PainterStage } from '../components/LayerPainter'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { loadWardrobeImage, useCharacterStore, useSpriteVersion } from '../stores/characterStore'
import { useUiStore } from '../stores/uiStore'
import { RegionPreviewModal } from './RegionPreviewModal'
import { gestures, lift, panelUnderTab, press, quietLift, quietPress, veilIn } from './motion'

export interface RepaintModalProps {
  charId: string
  /** Which wardrobe is being repaired; `null` is the default one. */
  set: OutfitSet | null
  /** The wardrobe's name, as the panel that opened this shows it. */
  title: string
  theme: 'day' | 'night'
  onClose: () => void
}

const HINT =
  'If part of the sprite came out strange, paint over it in the colors it should be and the ' +
  'image generator will redraw it, or use Mark to have an area redrawn as it is. It is meant ' +
  'for fixing what the tags already describe, not for adding anything new. Higher strength ' +
  'strays further from your paint. The face is never redrawn; regenerate the expression instead.'

/** The slider's own units: whole percents of the detailer's denoise. */
const PERCENT = 100
const STRENGTH_MIN = Math.round(REPAINT_STRENGTH.min * PERCENT)
const STRENGTH_MAX = Math.round(REPAINT_STRENGTH.max * PERCENT)
const STRENGTH_STEP = 5

/** What one press of Repaint hands the render: three PNGs and the strength. */
interface RepaintRequest {
  layers: { source: string; paint: string; mask: string }
  strength: number
}

/** A blank canvas at the stage's size, or a failure the press reports. */
function blankCanvas(stage: PainterStage): {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
} {
  const canvas = document.createElement('canvas')
  canvas.width = stage.width
  canvas.height = stage.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('The compositing canvas could not be opened.')
  return { canvas, ctx }
}

/**
 * The paint-over-the-sprite editor that redraws: paint says what colour a part should be, Mark
 * says redraw it as it is, and Repaint hands both to an inpaint over the neutral sprite whose
 * result is laid over every sprite of the set.
 */
export function RepaintModal({
  charId,
  set,
  title,
  theme,
  onClose
}: RepaintModalProps): JSX.Element | null {
  const paintRef = useRef<HTMLCanvasElement>(null)
  const markRef = useRef<HTMLCanvasElement>(null)
  const [stage, setStage] = useState<PainterStage | null>(null)
  const [dirty, setDirty] = useState(false)
  const [painted, setPainted] = useState(false)
  const [strength, setStrength] = useState(Math.round(REPAINT_STRENGTH.initial * PERCENT))
  const [previewing, setPreviewing] = useState<RepaintRequest | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [discarding, setDiscarding] = useState(false)

  const version = useSpriteVersion(charId)
  const expressions = useCharacterStore((s) => s.expressions[charId])
  const outfits = useCharacterStore((s) => s.outfits[charId])
  const repaint = useCharacterStore((s) => s.repaint)
  const cancelRepaint = useCharacterStore((s) => s.cancelRepaint)
  const present = set === null ? expressions : outfits?.[set]
  const repairing = EMOTIONS.filter((emotion: Emotion) => present?.[emotion])

  /**
   * Builds what the render reads: the neutral sprite flattened on white, the paint as it lies,
   * and everything painted or marked as one mask — and hands them to the preview, which owns
   * the render and the decision over it.
   */
  const start = async (): Promise<void> => {
    const paint = paintRef.current
    const mark = markRef.current
    if (!paint || !mark || !stage || previewing || preparing) return

    setPreparing(true)
    try {
      const sprite = await loadWardrobeImage(charId, set, 'neutral')
      if (!sprite) throw new Error('The neutral sprite could not be read.')
      const source = blankCanvas(stage)
      source.ctx.fillStyle = '#ffffff'
      source.ctx.fillRect(0, 0, stage.width, stage.height)
      source.ctx.drawImage(sprite, 0, 0, stage.width, stage.height)
      sprite.close()

      // Every pixel either layer holds, as opaque white: the alpha is what the graph reads.
      const mask = blankCanvas(stage)
      mask.ctx.drawImage(paint, 0, 0)
      mask.ctx.drawImage(mark, 0, 0)
      mask.ctx.globalCompositeOperation = 'source-in'
      mask.ctx.fillStyle = '#ffffff'
      mask.ctx.fillRect(0, 0, stage.width, stage.height)

      const [sourcePng, paintPng, maskPng] = await Promise.all([
        toPngBase64(source.canvas),
        toPngBase64(paint),
        toPngBase64(mask.canvas)
      ])
      setPreviewing({
        layers: { source: sourcePng, paint: paintPng, mask: maskPng },
        strength: strength / PERCENT
      })
    } catch (err) {
      useUiStore
        .getState()
        .showError(appError('FIX_NOT_PNG', 'Could not read the paint layer.', messageOf(err)))
    } finally {
      setPreparing(false)
    }
  }

  /* Paint that has never been repainted with is work, and work is not thrown away on a stray
     click outside — the Edit modal's own rule for its form. */
  const requestClose = (): void => {
    if (dirty) setDiscarding(true)
    else onClose()
  }

  const { host, overlayProps } = useModalShell(requestClose)
  if (!host) return null

  const busy = previewing !== null || preparing
  // Nothing to redraw until there is a sprite, a set and a stroke on either layer. The button
  // goes dead on any of the three and says nothing about which.
  const repaintDead = busy || !stage || repairing.length === 0 || !painted

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
          id="repaint"
          className="vu-sheet--wide vu-fix vu-paper"
          role="dialog"
          aria-modal="true"
          aria-label={`Repaint — ${title}`}
          variants={panelUnderTab}
        >
          <TitleTab>Repaint</TitleTab>

          {/* Sprite under, paint and marks over it: both are instructions about the picture,
              drawn where the player can see what they cover. */}
          <LayerPainter
            idPrefix="repaint"
            charId={charId}
            set={set}
            version={version}
            restoreFrom={null}
            order="over"
            hint={HINT}
            canvasRef={paintRef}
            markRef={markRef}
            theme={theme}
            disabled={busy}
            onStage={setStage}
            onChange={(state) => {
              setDirty(state.dirty)
              setPainted(state.painted)
            }}
            fields={
              <div className="vu-fix-field">
                <span className="vu-range-label">Strength</span>
                <input
                  id="repaint-strength"
                  className="vu-range"
                  type="range"
                  min={STRENGTH_MIN}
                  max={STRENGTH_MAX}
                  step={STRENGTH_STEP}
                  value={strength}
                  disabled={busy}
                  aria-label="Strength"
                  aria-valuetext={`${strength} percent`}
                  style={
                    {
                      '--range-fill': `${
                        ((strength - STRENGTH_MIN) / (STRENGTH_MAX - STRENGTH_MIN)) * 100
                      }%`
                    } as CSSProperties
                  }
                  onChange={(event) => setStrength(Number(event.target.value))}
                />
                <span className="vu-fix-readout">{strength}%</span>
              </div>
            }
          >
            <div className="vu-foot">
              <motion.button
                id="repaint-close"
                className="vu-btn vu-btn--quiet"
                type="button"
                disabled={busy}
                {...gestures(busy, quietLift, quietPress)}
                onClick={requestClose}
              >
                Cancel
              </motion.button>
              <motion.button
                id="repaint-start"
                className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
                type="button"
                disabled={repaintDead}
                {...gestures(repaintDead, lift, press)}
                onClick={() => void start()}
              >
                {`Repaint ${repairing.length} sprites`}
              </motion.button>
            </div>
          </LayerPainter>
        </motion.div>
      </motion.div>

      <AnimatePresence propagate>
        {previewing !== null && (
          <RegionPreviewModal
            key="preview"
            repair="repaint"
            charId={charId}
            set={set}
            title={title}
            theme={theme}
            render={() => repaint(charId, set, previewing.layers, previewing.strength)}
            cancel={() => void cancelRepaint(charId, set)}
            emotions={repairing}
            onCancel={() => setPreviewing(null)}
            // The preview comes down with the panel it applied to, for the discard confirm's reason.
            onApplied={() => {
              setPreviewing(null)
              onClose()
            }}
          />
        )}

        {discarding && (
          <ConfirmModal
            key="discard"
            id="repaint-discard"
            theme={theme}
            title="Discard changes?"
            message="No fixes have been applied yet."
            confirmText="Discard"
            cancelText="Keep painting"
            // Taken down before the panel goes, so the two do not leave as one exiting child
            // rendered twice under the same key.
            onConfirm={() => {
              setDiscarding(false)
              onClose()
            }}
            onCancel={() => setDiscarding(false)}
          />
        )}
      </AnimatePresence>
    </>,
    host
  )
}
