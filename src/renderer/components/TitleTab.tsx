import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react'
import { FADE, TAB_ARRIVAL, TAB_ARRIVAL_SCALE, tabGone, tweenSize } from '../views/motion'

export interface TitleTabProps {
  /** What the tab says. Changing it swaps the text in place rather than arriving again. */
  children: string
}

/** What the tab would be if nothing were pinning its width — measured, not remembered. */
function naturalWidth(node: HTMLElement): number {
  const pinned = node.style.width
  node.style.width = 'auto'
  const width = node.offsetWidth
  node.style.width = pinned
  return width
}

/**
 * A modal's title on its `.vu-tab`: arrives small on the corner it lives on, growing as the panel
 * rises under it, and never travels — crossing the stage would pull the eye off the panel it
 * names. The one thing it measures is itself, tweening its own width across a text swap.
 */
export function TitleTab({ children }: TitleTabProps): JSX.Element {
  const tab = useRef<HTMLHeadingElement>(null)
  const opacity = useMotionValue(1)
  const still = useReducedMotion()

  // What the tab is showing, which trails the prop while the swap below runs.
  const [shown, setShown] = useState(children)
  // The width it was showing at, measured before the new text was written into it.
  const from = useRef<number | null>(null)

  /** The title changed: fade the old words out, and measure the tab before replacing them. */
  useEffect(() => {
    const node = tab.current
    if (children === shown || !node) return

    const fade = animate(opacity, 0, {
      ...FADE,
      onComplete: () => {
        from.current = node.offsetWidth
        setShown(children)
      }
    })
    return () => fade.stop()
  }, [children, shown, opacity])

  /** The new words are in the DOM and still invisible: grow the tab to them, then show them. */
  useLayoutEffect(() => {
    const node = tab.current
    const start = from.current
    from.current = null
    if (!node || start === null) return

    const size = tweenSize(
      (value) => {
        node.style.width = value
      },
      start,
      naturalWidth(node),
      () => void animate(opacity, 1, FADE)
    )
    return () => size.stop()
  }, [shown, opacity])

  return (
    <motion.h2
      ref={tab}
      className="vu-tab vu-paper"
      aria-label={children}
      // Explicit targets rather than the panel's variant labels, so the panel's rise is not
      // inherited on top of the scale. Reduced motion skips the start and the tab is simply there.
      initial={still ? false : { scale: TAB_ARRIVAL_SCALE }}
      animate={{ scale: 1 }}
      // Guarded like the start: reduced motion applies a transform instantly, and the tab
      // would snap to half size for the length of the veil's fade.
      exit={still ? undefined : tabGone}
      transition={TAB_ARRIVAL}
    >
      <motion.span style={{ opacity }}>{shown}</motion.span>
    </motion.h2>
  )
}
