import { useEffect, useRef, useState } from 'react'
import { appError } from '@shared/errors'
import { keepApplication, keptFolder } from '../stores/applicationStore'
import {
  deletePicture,
  openStoredPicture,
  readPictureCrop,
  writePicture,
  type PictureHome
} from '../stores/loop/profilePicture'
import { useUiStore } from '../stores/uiStore'

/**
 * The reader's picture while New Game names him, kept in the folder the application is kept in,
 * which a save asks for as the lorebook does: so the game the semester opens on finds it there.
 * The crop is read whenever `open` turns true and shown through a URL this hook owns.
 */
export function useNewGamePicture(open: boolean): PictureHome {
  const [crop, setCrop] = useState<string | null>(null)
  const url = useRef<string | null>(null)

  /** Shows these bytes, or none, releasing the URL that stood before. */
  const show = (bytes: Uint8Array<ArrayBuffer> | null): void => {
    if (url.current) URL.revokeObjectURL(url.current)
    url.current = bytes ? URL.createObjectURL(new Blob([bytes])) : null
    setCrop(url.current)
  }

  useEffect(() => {
    if (!open) return
    const folder = keptFolder()
    if (!folder) return
    let live = true
    void readPictureCrop(folder).then((bytes) => {
      if (live) show(bytes)
    })
    return () => {
      live = false
    }
  }, [open])

  useEffect(
    () => () => {
      if (url.current) URL.revokeObjectURL(url.current)
    },
    []
  )

  return {
    crop,
    openStored: () => openStoredPicture(keptFolder()),
    save: async (picture, frame) => {
      const folder = await keepApplication()
      if (!folder) {
        useUiStore
          .getState()
          .showError(
            appError(
              'PROFILE_PICTURE_UNWRITABLE',
              'Could not save the profile picture.',
              'The New Game has no folder to keep it in.'
            )
          )
        return false
      }
      const bytes = await writePicture(folder, picture, frame, () => false)
      if (!bytes) return false
      show(bytes)
      return true
    },
    remove: async () => {
      const folder = keptFolder()
      if (folder && (await deletePicture(folder))) show(null)
    }
  }
}
