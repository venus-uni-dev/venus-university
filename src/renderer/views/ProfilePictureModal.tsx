import { useEffect, useMemo, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { PortraitFramer } from '../components/PortraitFramer'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { clampProfileCropWithin, profileStage } from '@shared/profileCrop'
import type { ProfileCrop, ProfileCropInfo } from '@shared/types'
import { spriteUrl, useCharacterStore, useSpriteVersion } from '../stores/characterStore'
import { gestures, lift, panelUnderTab, press, quietLift, quietPress, veilIn } from './motion'
import '../vu_styles/ProfilePicture.css'

export interface ProfilePictureModalProps {
  charId: string
  /** Whose portrait it is, for the label. */
  name: string
  theme: 'day' | 'night'
  onClose: () => void
}

/**
 * Where her portrait is cut from. The stage is a window on the top of the sprite at the frame's
 * own ratio, so the largest frame is it.
 */
export function ProfilePictureModal({
  charId,
  name,
  theme,
  onClose
}: ProfilePictureModalProps): JSX.Element | null {
  const version = useSpriteVersion(charId)
  const readProfileCrop = useCharacterStore((s) => s.readProfileCrop)
  const setProfileCrop = useCharacterStore((s) => s.setProfileCrop)

  const [info, setInfo] = useState<ProfileCropInfo | null>(null)
  const [crop, setCrop] = useState<ProfileCrop | null>(null)
  const [saving, setSaving] = useState(false)

  /** The window she is framed in: the sprite's top third, on her face. */
  const stage = useMemo(
    () => (info ? profileStage(info.suggested, info.width, info.height) : null),
    [info]
  )

  /** The frame her face asks for, as the window holds it — what Reset goes back to. */
  const home = useMemo(
    () => (info && stage ? clampProfileCropWithin(info.suggested, stage) : null),
    [info, stage]
  )

  // Read once: re-reading on a version bump would take away the frame the player is moving.
  useEffect(() => {
    let live = true
    void readProfileCrop(charId).then((next) => {
      if (!live || !next) return
      setInfo(next)
      // A frame stored before the window existed can sit below it; it is pulled in on open.
      const box = profileStage(next.suggested, next.width, next.height)
      setCrop(clampProfileCropWithin(next.stored ?? next.suggested, box))
    })
    return () => {
      live = false
    }
  }, [charId, readProfileCrop])

  const { host, overlayProps } = useModalShell(onClose)
  if (!host) return null

  const isDefault =
    crop !== null &&
    home !== null &&
    crop.x === home.x &&
    crop.y === home.y &&
    crop.width === home.width

  const confirm = async (): Promise<void> => {
    if (!crop) return
    setSaving(true)
    const ok = await setProfileCrop(charId, crop)
    setSaving(false)
    if (ok) onClose()
  }

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
        id="profile-picture"
        className="vu-pic vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label={`Profile picture — ${name}`}
        variants={panelUnderTab}
      >
        <TitleTab>Profile picture</TitleTab>

        <PortraitFramer
          src={spriteUrl(charId, 'neutral', version)}
          imageWidth={info?.width ?? 0}
          stage={stage}
          crop={crop}
          onCrop={setCrop}
        />

        <motion.button
          id="picture-reset"
          className="vu-btn vu-btn--quiet vu-pic-reset"
          type="button"
          disabled={isDefault || !home}
          {...gestures(isDefault || !home, quietLift, quietPress)}
          onClick={() => home && setCrop(home)}
        >
          Reset to default
        </motion.button>

        <div className="vu-foot vu-pic-answers">
          <motion.button
            id="picture-cancel"
            className="vu-btn vu-btn--quiet"
            type="button"
            {...gestures(false, quietLift, quietPress)}
            onClick={onClose}
          >
            Cancel
          </motion.button>
          <motion.button
            id="picture-save"
            className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
            type="button"
            disabled={saving || !crop}
            {...gestures(saving || !crop, lift, press)}
            onClick={() => void confirm()}
          >
            {saving ? 'Saving…' : 'Save'}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>,
    host
  )
}
