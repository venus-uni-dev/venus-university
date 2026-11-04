import { useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { clampProfileCrop } from '@shared/profileCrop'
import { PROFILE_PICTURE_TYPES, type ProfileFrame } from '@shared/profilePicture'
import type { ProfileCrop } from '@shared/types'
import { CheckField } from '../components/CheckField'
import { ConfirmModal } from '../components/ConfirmModal'
import { PortraitFramer } from '../components/PortraitFramer'
import { TitleTab } from '../components/TitleTab'
import { useModalShell } from '../components/useModalShell'
import {
  openPickedPicture,
  openStoredPicture,
  savePicture,
  type ReaderPicture
} from '../stores/loop/profilePicture'
import { gestures, lift, panelUnderTab, press, quietLift, quietPress, veilIn } from './motion'
import '../vu_styles/ProfilePicture.css'

/** A picture's frame as the framer carries one, held inside the picture. */
function cropOf(picture: ReaderPicture): ProfileCrop {
  return clampProfileCrop({ seed: 0, ...picture.frame }, picture.width, picture.height)
}

export interface ReaderPictureModalProps {
  theme: 'day' | 'night'
  /** The file the player just picked; null opens on the picture the playthrough keeps. */
  picked: ReaderPicture | null
  onClose: () => void
  /** The crop and the full picture are kept. */
  onSaved: () => void
}

/**
 * The reader's own picture and the archway his crop is cut through, with the whole picture as the
 * stage. Nothing is kept until Save, so every other way out leaves the playthrough as it was.
 */
export function ReaderPictureModal({
  theme,
  picked,
  onClose,
  onSaved
}: ReaderPictureModalProps): JSX.Element | null {
  const [picture, setPicture] = useState<ReaderPicture | null>(picked)
  const [crop, setCrop] = useState<ProfileCrop | null>(() => (picked ? cropOf(picked) : null))
  const [url, setUrl] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  /** A save is out: every way out waits, so a dismissal cannot be followed by what it answers. */
  const saving = useRef(false)

  // Read once, where nothing was handed over; one that will not read has said so already.
  useEffect(() => {
    if (picked) return
    let live = true
    void openStoredPicture().then((stored) => {
      if (!live) return
      if (!stored) {
        onClose()
        return
      }
      setPicture(stored)
      setCrop(cropOf(stored))
    })
    return () => {
      live = false
    }
  }, [])

  // The URL lives exactly as long as the picture is on the stage.
  const blob = picture?.blob
  useEffect(() => {
    if (!blob) return
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])

  /** Hands a pick to the store, clearing the box so the same file picked twice fires twice. */
  const pick = async (file: File | undefined): Promise<void> => {
    if (fileInput.current) fileInput.current.value = ''
    if (!file) return
    const next = await openPickedPicture(file)
    if (!next) return
    setPicture(next)
    setCrop(cropOf(next))
  }

  const leave = (): void => {
    if (!saving.current) onClose()
  }

  const { host, overlayProps } = useModalShell(leave)
  if (!host) return null

  const confirm = async (): Promise<void> => {
    if (!picture || !crop || saving.current) return
    saving.current = true
    const frame: ProfileFrame = { x: crop.x, y: crop.y, width: crop.width, height: crop.height }
    const ok = await savePicture(picture, frame)
    saving.current = false
    if (ok) onSaved()
  }

  const stage = picture ? { x: 0, y: 0, width: picture.width, height: picture.height } : null

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
        id="reader-picture"
        className="vu-pic vu-pic--full vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label="Profile picture"
        variants={panelUnderTab}
      >
        <TitleTab>Profile picture</TitleTab>

        <PortraitFramer
          src={url}
          imageWidth={picture?.width ?? 0}
          stage={stage}
          crop={crop}
          onCrop={setCrop}
        />

        <p className="vu-check-note">
          The full picture will be sent to the prompts in the Photos tab, while the cropped version
          will appear in scenes when &quot;Show profile picture in scenes&quot; is enabled. For best results, use a full body reference, with the crop set to the face.
        </p>

        <input
          ref={fileInput}
          id="reader-picture-input"
          type="file"
          accept={PROFILE_PICTURE_TYPES.join(',')}
          hidden
          onChange={(event) => void pick(event.target.files?.[0])}
        />

        <div className="vu-foot vu-pic-answers">
          <motion.button
            id="reader-picture-close"
            className="vu-btn vu-btn--quiet"
            type="button"
            {...gestures(false, quietLift, quietPress)}
            onClick={leave}
          >
            Close
          </motion.button>
          <motion.button
            id="reader-picture-upload"
            className="vu-btn vu-btn--quiet"
            type="button"
            {...gestures(false, quietLift, quietPress)}
            onClick={() => fileInput.current?.click()}
          >
            Upload Image
          </motion.button>
          <motion.button
            id="reader-picture-save"
            className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
            type="button"
            disabled={!crop}
            {...gestures(!crop, lift, press)}
            onClick={() => void confirm()}
          >
            Save
          </motion.button>
        </div>
      </motion.div>
    </motion.div>,
    host
  )
}

export interface ScenesAskModalProps {
  theme: 'day' | 'night'
  /** Whether to show the picture in scenes, and whether the box was ticked; every way out answers. */
  onAnswer: (show: boolean, mute: boolean) => void
}

/** The ask after a crop is saved, and the box that stops it being asked again. */
export function ScenesAskModal({ theme, onAnswer }: ScenesAskModalProps): JSX.Element {
  const [mute, setMute] = useState(false)
  return (
    <ConfirmModal
      id="reader-picture-scenes"
      theme={theme}
      title="Show profile picture in scenes?"
      message="You can change this later in Settings."
      aside={
        <CheckField
          id="reader-picture-scenes-mute"
          label="Don't ask again"
          checked={mute}
          onChange={setMute}
        />
      }
      confirmText="Show in scenes"
      cancelText="Not now"
      onCancel={() => onAnswer(false, mute)}
      onConfirm={() => onAnswer(true, mute)}
    />
  )
}
