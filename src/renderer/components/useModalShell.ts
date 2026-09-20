import { useEffect, useRef, useState, type MouseEvent, type MouseEventHandler } from 'react'
import { useIsPresent } from 'motion/react'

import { useAudioStore } from '../stores/audioStore'
import { useCrossingStore } from '../stores/crossingStore'

/** What a modal needs to mount itself: the portal host, and the dimming's handlers. */
export interface ModalShell {
  /** `null` until the host is resolved, which is one render — portal nothing before that. */
  host: HTMLElement | null
  overlayProps: {
    onMouseDown: MouseEventHandler<HTMLElement>
    onClick: MouseEventHandler<HTMLElement>
    /** The whole veil, while it is leaving: no clicks, no focus, no keys. */
    inert: boolean
  }
}

/**
 * Every open shell, oldest first: Escape is answered by the last one alone. Module
 * scope because the stack spans components — a modal opened over another is a different
 * tree, and only the two of them together know which is on top.
 */
const openShells: object[] = []

/**
 * The portal host, the outside-click rule, Escape and the sounds a panel arrives and leaves on;
 * styling stays in `vu_styles`. `sound` is the pair it plays — `'phone'` for the Bunnyboard, and
 * `'none'` for a screen whose own sting is the sound of its arrival.
 */
export function useModalShell(
  onClose: () => void,
  sound: 'panel' | 'phone' | 'none' = 'panel'
): ModalShell {
  const [host, setHost] = useState<HTMLElement | null>(null)
  const pressedOverlay = useRef(false)
  // Read at keypress rather than closed over, so the listener is registered once.
  const close = useRef(onClose)
  close.current = onClose

  /**
   * **A modal that is leaving answers nothing**. Its exit keeps it mounted for the length
   * of the fade, and a second Escape there runs `onClose` again — which for a one-way confirm
   * *is* the confirm. `true` outside any `AnimatePresence`, so an un-wrapped caller is unchanged.
   */
  const present = useIsPresent()
  const leaving = useRef(false)
  leaving.current = !present

  useEffect(() => {
    setHost(document.getElementById('modal-root') ?? document.body)
  }, [])

  /**
   * A sound of its own on open and close. Both are guarded against the double mount: open by a
   * ref, close by a microtask that lets an immediate re-setup cancel the teardown that queued it.
   */
  const opened = useRef(false)
  const closed = useRef(false)
  const going = useRef(false)

  useEffect(() => {
    if (opened.current) return
    opened.current = true
    if (sound !== 'none') useAudioStore.getState().play(sound === 'phone' ? 'phone_open' : 'ui_open')
  }, [sound])

  useEffect(() => {
    going.current = false
    const playClose = (): void => {
      if (closed.current) return
      closed.current = true
      if (useCrossingStore.getState().phase !== 'idle') return
      if (sound !== 'none')
        useAudioStore.getState().play(sound === 'phone' ? 'phone_close' : 'ui_close')
    }
    if (!present) playClose()
    return () => {
      going.current = true
      queueMicrotask(() => {
        if (going.current) playClose()
      })
    }
  }, [present, sound])

  /**
   * Escape runs the same handler as an outside click, so a modal that ignores one ignores the
   * other too. Captured and stopped, so the Game View's own Escape listener does not also fire.
   */
  useEffect(() => {
    const token = {}
    openShells.push(token)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (openShells[openShells.length - 1] !== token) return
      if (leaving.current) return
      event.stopPropagation()
      close.current()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      openShells.splice(openShells.indexOf(token), 1)
    }
  }, [])

  /**
   * Records whether the press began on the dimming: a `click` fires on the common ancestor of
   * press and release, so a drag out of a field would otherwise close the modal. React bubbles
   * clicks through the *component* tree, so a modal portalled over this one has its click land
   * here too — harmless only because of the target test.
   */
  function handleOverlayMouseDown(e: MouseEvent<HTMLElement>): void {
    pressedOverlay.current = e.target === e.currentTarget
  }

  function handleOverlayClick(e: MouseEvent<HTMLElement>): void {
    const outside = pressedOverlay.current && e.target === e.currentTarget
    pressedOverlay.current = false
    if (outside) onClose()
  }

  return {
    host,
    overlayProps: {
      onMouseDown: handleOverlayMouseDown,
      onClick: handleOverlayClick,
      inert: !present
    }
  }
}
