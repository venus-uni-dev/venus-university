import { useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { EMOTIONS } from '@shared/emotions'
import { appError, messageOf } from '@shared/errors'
import { REPAINT_DENOISE_INITIAL } from '@shared/outfits'
import type { Emotion, OutfitSet } from '@shared/types'
import { ConfirmModal } from '../components/ConfirmModal'
import { DENOISE_SCALE, DenoiseField } from '../components/DenoiseField'
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
  'You can use this to paint over generation errors, like an arm in front of a jacket. You can use the Mark tool without painting to target it for inpainting. Only the painted and marked areas will be regenerated. Please note that this tool is bad at adding new elements: for that it\'s better to change the prompt and regenerate.'

/** What one press of Repaint hands the render: three PNGs and the denoise. */
interface RepaintRequest {
  layers: { source: string; paint: string; mask: string }
  denoise: number
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
  const [denoise, setDenoise] = useState(Math.round(REPAINT_DENOISE_INITIAL * DENOISE_SCALE))
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
        denoise: denoise / DENOISE_SCALE
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
              <DenoiseField
                id="repaint-denoise"
                value={denoise}
                disabled={busy}
                onChange={setDenoise}
              />
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
            render={() => repaint(charId, set, previewing.layers, previewing.denoise)}
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
