import { useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { EMOTIONS } from '@shared/emotions'
import { appError, messageOf } from '@shared/errors'
import type { Emotion, OutfitSet } from '@shared/types'
import { ConfirmModal } from '../components/ConfirmModal'
import { LayerPainter, toPngBase64, type PainterStage } from '../components/LayerPainter'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { useCharacterStore, useSpriteVersion } from '../stores/characterStore'
import { useUiStore } from '../stores/uiStore'
import { HandPreviewModal } from './HandPreviewModal'
import { gestures, lift, panelUnderTab, press, quietLift, quietPress, veilIn } from './motion'

export interface FingerFixModalProps {
  charId: string
  /** Which wardrobe is being repaired; `null` is the default one. */
  set: OutfitSet | null
  /** The wardrobe's name, as the panel that opened this shows it. */
  title: string
  theme: 'day' | 'night'
  onClose: () => void
}

const HINT =
  "If the generated images are missing fingers, pick the color of the hand and draw where you'd " +
  'like the image generator to place a finger. If the hand has too many fingers instead of too few, or the fingers are too ' +
  'near the face, it\'s better to regenerate the whole outfit instead.'

/**
 * The paint-over-the-sprite editor for one wardrobe: the strokes say where a finger
 * belongs, and Fix hands them to a hand detailer over the set's base frame.
 */
export function FingerFixModal({
  charId,
  set,
  title,
  theme,
  onClose
}: FingerFixModalProps): JSX.Element | null {
  const paintRef = useRef<HTMLCanvasElement>(null)
  const [stage, setStage] = useState<PainterStage | null>(null)
  const [dirty, setDirty] = useState(false)
  const [painted, setPainted] = useState(false)
  const [hasBase, setHasBase] = useState(true)
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [discarding, setDiscarding] = useState(false)

  const swept = useRef(false)
  const version = useSpriteVersion(charId)
  const expressions = useCharacterStore((s) => s.expressions[charId])
  const outfits = useCharacterStore((s) => s.outfits[charId])
  const hasBaseImage = useCharacterStore((s) => s.hasBaseImage)
  const discardLayer = useCharacterStore((s) => s.discardWardrobeLayer)
  const present = set === null ? expressions : outfits?.[set]
  const repairing = EMOTIONS.filter((emotion: Emotion) => present?.[emotion])

  /* Any strokes a previous repair left behind, thrown away as this opens: they placed a
     finger on a hand that repair replaced, so they are an instruction about a picture that is no
     longer there. Guarded by a ref rather than by its deps, since StrictMode runs this twice. */
  useEffect(() => {
    if (swept.current) return
    swept.current = true
    void discardLayer(charId, set, 'hands')
  }, [charId, set, discardLayer])

  /* The frame the fix repaints, which is not one of the images the panel counts: a set
     filled before this build, or half-rendered, can have every sprite and no base. */
  useEffect(() => {
    let live = true
    void hasBaseImage(charId, set ?? 'default').then((answer) => {
      if (live) setHasBase(answer)
    })
    return () => {
      live = false
    }
  }, [charId, set, hasBaseImage, version])

  /** Hands the strokes to the preview, which owns the render and the decision over it. */
  const fix = async (): Promise<void> => {
    const canvas = paintRef.current
    if (!canvas || previewing) return
    try {
      setPreviewing(await toPngBase64(canvas))
    } catch (err) {
      useUiStore
        .getState()
        .showError(appError('FIX_NOT_PNG', 'Could not read the paint layer.', messageOf(err)))
    }
  }

  /* Paint that has never been fixed with is work, and work is not thrown away on a stray click
     outside — the Edit modal's own rule for its form. */
  const requestClose = (): void => {
    if (dirty) setDiscarding(true)
    else onClose()
  }

  const { host, overlayProps } = useModalShell(requestClose)
  if (!host) return null

  // Nothing to repair until there is a sprite, a set, her base frame and a stroke on it.
  // The button goes dead on any of the four and says nothing about which.
  const fixBlocked = !stage || repairing.length === 0 || !hasBase || !painted
  const fixDead = previewing !== null || fixBlocked

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
          id="fix-fingers"
          className="vu-sheet--wide vu-fix vu-paper"
          role="dialog"
          aria-modal="true"
          aria-label={`Fix fingers — ${title}`}
          variants={panelUnderTab}
        >
          <TitleTab>Fix fingers</TitleTab>

          {/* Sprite under, paint over it: the strokes are an instruction about the picture,
              not a layer of it, so they are drawn where the player can see what they cover. */}
          <LayerPainter
            idPrefix="hands"
            charId={charId}
            set={set}
            version={version}
            restoreFrom={null}
            order="over"
            hint={HINT}
            canvasRef={paintRef}
            disabled={previewing !== null}
            onStage={setStage}
            onChange={(state) => {
              setDirty(state.dirty)
              setPainted(state.painted)
            }}
          >
            <div className="vu-foot">
              <motion.button
                id="hands-cancel"
                className="vu-btn vu-btn--quiet"
                type="button"
                disabled={previewing !== null}
                {...gestures(previewing !== null, quietLift, quietPress)}
                onClick={requestClose}
              >
                Cancel
              </motion.button>
              <motion.button
                id="hands-fix"
                className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
                type="button"
                disabled={fixDead}
                {...gestures(fixDead, lift, press)}
                onClick={() => void fix()}
              >
                {`Fix ${repairing.length} sprites`}
              </motion.button>
            </div>
          </LayerPainter>
        </motion.div>
      </motion.div>

      <AnimatePresence propagate>
        {previewing !== null && (
          <HandPreviewModal
            key="preview"
            charId={charId}
            set={set}
            title={title}
            theme={theme}
            paintLayer={previewing}
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
            id="hands-discard"
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
