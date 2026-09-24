import type { JSX } from 'react'
import { motion } from 'motion/react'
import { peek, quietPress, tuck } from '../views/motion'
import { CloseIcon } from '../views/screenIcons'

export interface DeleteXProps {
  /** Whether the row or cell it rides is under the pointer, which is what reveals it. */
  hovered: boolean
  label: string
  onDelete: () => void
  /** `.vu-x` and the caller's own class that places it. */
  className?: string
}

/**
 * The ✕ that removes a row or a cell, revealed by the row's own hover. A sibling of the face,
 * never inside it — a button in a button is invalid, and nesting is what would make a click on
 * the ✕ also open the row.
 */
export function DeleteX({
  hovered,
  label,
  onDelete,
  className = 'vu-x'
}: DeleteXProps): JSX.Element {
  return (
    <motion.button
      className={className}
      type="button"
      aria-label={label}
      // Or it flashes at full opacity on mount before animating away.
      initial={false}
      animate={hovered ? peek : tuck}
      whileFocus={peek}
      whileTap={quietPress}
      onClick={onDelete}
    >
      <CloseIcon />
    </motion.button>
  )
}
