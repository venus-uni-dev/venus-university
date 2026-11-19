import { useRef, useState, type JSX } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { PROFILE_PICTURE_TYPES } from '@shared/profilePicture'
import {
  openPickedPicture,
  type PictureHome,
  type ReaderPicture
} from '../stores/loop/profilePicture'
import { useSettingsStore } from '../stores/settingsStore'
import { ReaderPictureModal, ScenesAskModal } from '../views/ReaderPictureModal'
import { gestures, portraitLift, quietLift, quietPress } from '../views/motion'
import { CloseIcon, PlusIcon } from '../views/screenIcons'
import '../vu_styles/ReaderPictureArch.css'

/** The control and the panels it opens, for the caller to stand where each belongs. */
export interface ReaderPictureControl {
  /** The archway, the ✕ riding it while a picture is kept, and the hidden file box. */
  arch: JSX.Element
  /** The crop modal and the ask its Save may raise, one presence following the other. */
  modals: JSX.Element
}

/**
 * The reader's own picture as the archway that picks it: the dashed gap and its plus open the file
 * picker, a kept picture opens the crop modal, and a Save asks about showing it in scenes while
 * that setting is off and the ask has not been muted.
 */
export function useReaderPicture(
  theme: 'day' | 'night',
  home: PictureHome,
  inputId: string
): ReaderPictureControl {
  const fileInput = useRef<HTMLInputElement>(null)
  const [panel, setPanel] = useState<'framing' | 'asking' | null>(null)
  /** The file the crop modal opens on, where it does not open on the kept picture. */
  const [picked, setPicked] = useState<ReaderPicture | null>(null)

  /** Hands the pick to the store, clearing the box so the same file picked twice fires twice. */
  const pick = async (file: File | undefined): Promise<void> => {
    if (fileInput.current) fileInput.current.value = ''
    if (!file) return
    const next = await openPickedPicture(file)
    if (!next) return
    setPicked(next)
    setPanel('framing')
  }

  /** The crop is kept: asks about scenes only where the answer could change anything. */
  const onSaved = (): void => {
    const settings = useSettingsStore.getState().settings
    const asks =
      settings?.showProfilePictureInScenes !== true &&
      settings?.askProfilePictureInScenes !== false
    setPanel(asks ? 'asking' : null)
  }

  const onScenesAnswer = (show: boolean, mute: boolean): void => {
    setPanel(null)
    if (!show && !mute) return
    void useSettingsStore.getState().update({
      ...(show ? { showProfilePictureInScenes: true } : {}),
      ...(mute ? { askProfilePictureInScenes: false } : {})
    })
  }

  const arch = (
    <div className="vu-reader-arch-seat">
      {/* The archway is the upload control, and the ✕ that clears it is its sibling, never a
          button inside a button. */}
      <motion.button
        className={`vu-arch vu-reader-arch${home.crop ? '' : ' vu-reader-arch--empty'}`}
        type="button"
        aria-label={home.crop ? 'Edit profile picture' : 'Add a profile picture'}
        {...gestures(false, portraitLift, quietPress)}
        onClick={() => {
          if (!home.crop) {
            fileInput.current?.click()
            return
          }
          setPicked(null)
          setPanel('framing')
        }}
      >
        {home.crop ? (
          <span className="vu-crop">
            <img className="vu-crop-img" src={home.crop} alt="" />
          </span>
        ) : (
          <PlusIcon size={34} />
        )}
      </motion.button>
      {home.crop && (
        <motion.button
          className="vu-x"
          type="button"
          aria-label="Remove profile picture"
          {...gestures(false, quietLift, quietPress)}
          onClick={() => void home.remove()}
        >
          <CloseIcon />
        </motion.button>
      )}
      <input
        ref={fileInput}
        id={inputId}
        type="file"
        accept={PROFILE_PICTURE_TYPES.join(',')}
        hidden
        onChange={(event) => void pick(event.target.files?.[0])}
      />
    </div>
  )

  const modals = (
    <AnimatePresence propagate mode="wait">
      {panel === 'framing' ? (
        <ReaderPictureModal
          key="reader-picture"
          theme={theme}
          picked={picked}
          home={home}
          onClose={() => setPanel(null)}
          onSaved={onSaved}
        />
      ) : panel === 'asking' ? (
        <ScenesAskModal key="reader-picture-scenes" theme={theme} onAnswer={onScenesAnswer} />
      ) : null}
    </AnimatePresence>
  )

  return { arch, modals }
}
