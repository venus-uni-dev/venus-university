/**
 * The reader's balance as a card: `BALANCE` over an accent strip over the figure. **A caller says
 * where it sits, what the reading was before and when to count; the card owns everything else** —
 * the change under the figure included, the shop's debit and the scene's gain alike.
 */
import { useEffect, useRef, useState, type JSX } from 'react'
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform
} from 'motion/react'

import { formatDelta, formatMoney } from '@shared/money'
import { useAudioStore } from '../stores/audioStore'
import { MONEY_REST, moneyCount, moneyDelta } from '../views/motion'
import '../vu_styles/MoneyCard.css'

export interface MoneyCardProps {
  /** What the balance is, and what a counting card counts *to*. */
  amount: number
  /**
   * What it was, for a card reporting a change. The figure counts from this to
   * {@link amount} and the row under it counts the change to nothing; absent, the card simply
   * stands at the balance.
   */
  from?: number
  /**
   * A debit the caller is **asking** about rather than paying — the shop's card, which prints it
   * under the balance while the question is on screen and holds it there until the answer.
   */
  asking?: number
  /**
   * The card stands frozen: the figure at {@link from} and the change printed under it, and no
   * count until the caller lets it go. A card that is never held counts on arrival.
   */
  held?: boolean
  /** The count has landed and rested a beat, which is the caller's cue to take the card away. */
  onCounted?: () => void
  /** The caller's own seat — where on its screen the card hangs. */
  className?: string
}

export function MoneyCard({
  amount,
  from,
  asking,
  held,
  onCounted,
  className
}: MoneyCardProps): JSX.Element {
  const still = useReducedMotion()
  const figure = useMotionValue(from ?? amount)
  /** What a finished count ended at, which is the whole of what puts the row away again. */
  const [done, setDone] = useState<number | undefined>(undefined)
  /** The two readings the change was last sounded for. */
  const sounded = useRef<string | null>(null)
  // Held in a ref and re-pointed every render, so a caller handing down a fresh handler each
  // render never restarts the count the effect below is in the middle of.
  const counted = useRef(onCounted)
  counted.current = onCounted

  const change = amount - (from ?? amount)
  const counting = change !== 0

  // Both readings are rounded off the **one** value, so the figure and the change under it add
  // up to `amount` on every frame rather than agreeing eventually.
  const shown = useTransform(figure, (value) => formatMoney(Math.round(value)))
  const delta = useTransform(figure, (value) =>
    formatDelta(asking === undefined ? amount - Math.round(value) : -asking)
  )

  // The count. **Imperative, so `MotionConfig`'s reduced motion cannot reach it** — that reaches
  // animated props alone — which is why the branch is written here, `StatRadar`'s arrangement.
  useEffect(() => {
    // The change is *reported* by the card taking it up, so the sound is the arrival and not the
    // count: it is said while a held card still stands frozen, and there where the figure only
    // snaps. The pair it counts between is what it is said for, so an effect that runs again at
    // the same reading stays quiet.
    if (counting && sounded.current !== `${from}:${amount}`) {
      sounded.current = `${from}:${amount}`
      useAudioStore.getState().play('money')
    }
    // Frozen at the reading before, which is also what puts a card handed a new pair mid-life
    // back to the start of it.
    if (held) {
      figure.set(from ?? amount)
      return
    }
    let run: ReturnType<typeof animate> | undefined
    let rest: ReturnType<typeof setTimeout> | undefined
    if (!counting || still) {
      figure.set(amount)
      if (counting) {
        setDone(amount)
        rest = setTimeout(() => counted.current?.(), MONEY_REST * 1000)
      }
    } else {
      // `onComplete` and never the returned promise, which motion settles through `finally` and
      // would mark an interrupted count done (`tweenSize`'s reason).
      run = animate(figure, amount, {
        ...moneyCount(change),
        onComplete: () => {
          setDone(amount)
          rest = setTimeout(() => counted.current?.(), MONEY_REST * 1000)
        }
      })
    }
    return () => {
      run?.stop()
      if (rest) clearTimeout(rest)
    }
  }, [amount, from, change, counting, held, still, figure])

  /** The row is up while a question is standing, and for as long as the count has not landed. */
  const open = asking !== undefined || (counting && done !== amount)
  // The debt pair is read off where the balance *ends*: a card counting down into the red is
  // already reporting a debt, whatever the figures on the way there say.
  const face = amount < 0 ? 'vu-money vu-money--debt vu-paper' : 'vu-money vu-paper'

  return (
    <span className={className ? `${face} ${className}` : face}>
      <span className="vu-money-balance">BALANCE</span>
      <span className="vu-money-stripe" aria-hidden="true" />
      <motion.span className="vu-money-amount">{shown}</motion.span>

      {/* `initial={false}` does two jobs at once: a card that *arrives* with a change to report
          has the row open on its first frame, and a card already on screen still grows one. */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.span
            key="delta"
            className="vu-money-delta"
            variants={moneyDelta}
            initial="shut"
            animate="open"
            exit="closing"
          >
            <motion.span
              className="vu-money-change"
              data-tone={asking === undefined && change > 0 ? 'gain' : 'loss'}
            >
              {delta}
            </motion.span>
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}
