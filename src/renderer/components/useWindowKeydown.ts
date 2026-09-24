import { useEffect, useRef } from 'react'

/**
 * One bubble-phase `keydown` listener on the window, for as long as the caller is mounted. The
 * handler is held in a ref and re-pointed every render, so the listener registers once and
 * still reads the values of the render it fires in.
 */
export function useWindowKeydown(handler: (event: KeyboardEvent) => void): void {
  const held = useRef(handler)
  held.current = handler
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => held.current(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
}

/**
 * Whether the event landed in a field the reader is typing in, where a key is a character and
 * not a command.
 */
export function typingIn(event: Event): boolean {
  const target = event.target
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable]') !== null
  )
}
