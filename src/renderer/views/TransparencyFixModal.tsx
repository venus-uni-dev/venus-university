import { useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { EMOTIONS } from '@shared/emotions'
import { appError, messageOf } from '@shared/errors'
import type { Emotion, OutfitSet, WardrobeFixImage } from '@shared/types'
import { ConfirmModal } from '../components/ConfirmModal'
import { LayerPainter, toPngBase64, type PainterStage } from '../components/LayerPainter'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { loadWardrobeImage, useCharacterStore, useSpriteVersion } from '../stores/characterStore'
import { useUiStore } from '../stores/uiStore'
import { gestures, lift, panelUnderTab, press, quietLift, quietPress, veilIn } from './motion'

export interface TransparencyFixModalProps {
  charId: string
  /** Which wardrobe is being repaired; `null` is the default one. */
  set: OutfitSet | null
  /** The wardrobe's name, as the panel that opened this shows it. */
  title: string
  theme: 'day' | 'night'
  onClose: () => void
}

const HINT = 'If the Remove Background node created holes in the sprite, use the brush to paint under the sprite anywhere you see green peeking through. Use the color white or a nearby color depending on what is supposed to be there.'

/** The paint-under-the-sprite editor for one wardrobe. */
export function TransparencyFixModal({
  charId,
  set,
  title,
  theme,
  onClose
}: TransparencyFixModalProps): JSX.Element | null {
  const paintRef = useRef<HTMLCanvasElement>(null)
  const [stage, setStage] = useState<PainterStage | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [discarding, setDiscarding] = useState(false)

  const version = useSpriteVersion(charId)
  const expressions = useCharacterStore((s) => s.expressions[charId])
  const outfits = useCharacterStore((s) => s.outfits[charId])
  const applyFix = useCharacterStore((s) => s.applyWardrobeFix)
  const present = set === null ? expressions : outfits?.[set]
  const repairing = EMOTIONS.filter((emotion: Emotion) => present?.[emotion]).length

  /** Composites the layer under every sprite the set has and writes them back. */
  const save = async (): Promise<void> => {
    const canvas = paintRef.current
    if (!canvas || saving) return

    setSaving(true)
    try {
      const work = document.createElement('canvas')
      const images: WardrobeFixImage[] = []

      for (const emotion of EMOTIONS.filter((e: Emotion) => present?.[e])) {
        const sprite = await loadWardrobeImage(charId, set, emotion)
        // Gone since the panel counted it; the others are still repaired.
        if (!sprite) continue

        work.width = sprite.width
        work.height = sprite.height
        const ctx = work.getContext('2d')
        if (!ctx) {
          sprite.close()
          continue
        }

        // The paint first and the sprite over it: the stage's own order.
        ctx.clearRect(0, 0, work.width, work.height)
        ctx.drawImage(canvas, 0, 0, work.width, work.height)
        ctx.drawImage(sprite, 0, 0)
        sprite.close()

        images.push({ emotion, data: await toPngBase64(work) })
      }

      if (images.length === 0) return
      const ok = await applyFix(charId, set, images, await toPngBase64(canvas), 'fix')
      if (ok) onClose()
    } catch (err) {
      // Compositing has no service behind it, so its failure is wrapped here (a tier-2 recoverable
      // modal).
      useUiStore
        .getState()
        .showError(appError('SPRITE_UNWRITABLE', 'Could not repair the sprites.', messageOf(err)))
    } finally {
      setSaving(false)
    }
  }

  /* Paint that has never been saved is work, and work is not thrown away on a stray click
     outside — the Edit modal's own rule for its form. */
  const requestClose = (): void => {
    if (dirty) setDiscarding(true)
    else onClose()
  }

  const { host, overlayProps } = useModalShell(requestClose)
  if (!host) return null

  // Dead until there is a sprite and something to write it to, and silent about which.
  const saveBlocked = !stage || repairing === 0

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
          id="fix-transparency"
          className="vu-sheet--wide vu-fix vu-paper"
          role="dialog"
          aria-modal="true"
          aria-label={`Fix holes — ${title}`}
          variants={panelUnderTab}
        >
          <TitleTab>Fix holes</TitleTab>

          {/* Green under, paint over it, sprite over that: the order the file is composited in. */}
          <LayerPainter
            idPrefix="fix"
            charId={charId}
            set={set}
            version={version}
            restoreFrom="fix"
            order="under"
            hint={HINT}
            canvasRef={paintRef}
            onStage={setStage}
            onChange={(state) => setDirty(state.dirty)}
          >
            <div className="vu-foot">
              <motion.button
                id="fix-cancel"
                className="vu-btn vu-btn--quiet"
                type="button"
                {...gestures(false, quietLift, quietPress)}
                onClick={requestClose}
              >
                Cancel
              </motion.button>
              <motion.button
                id="fix-save"
                className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
                type="button"
                disabled={saving || saveBlocked}
                {...gestures(saving || saveBlocked, lift, press)}
                onClick={() => void save()}
              >
                {saving ? 'Saving…' : `Save to ${repairing} sprites`}
              </motion.button>
            </div>
          </LayerPainter>
        </motion.div>
      </motion.div>

      <AnimatePresence propagate>
        {discarding && (
          <ConfirmModal
            key="discard"
            id="fix-discard"
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
