import type { JSX } from 'react'
import { motion } from 'motion/react'
import { gestures, quietLift, quietPress } from '../views/motion'
import { ChevronIcon } from '../views/screenIcons'

export interface StepSquareProps {
  id: string
  /** What a press does, for the square has only its chevron to say it with. */
  label: string
  dead: boolean
  /** The square that steps back, its chevron turned to face that way. */
  back?: boolean
  onStep: () => void
}

/**
 * One end of a value's scale. Dead at its own end and rendered there anyway, so the value
 * between the two squares never moves.
 */
export function StepSquare({ id, label, dead, back = false, onStep }: StepSquareProps): JSX.Element {
  return (
    <motion.button
      id={id}
      className="vu-square vu-square--step"
      type="button"
      disabled={dead}
      aria-label={label}
      {...gestures(dead, quietLift, quietPress)}
      onClick={onStep}
    >
      <ChevronIcon back={back} />
    </motion.button>
  )
}
