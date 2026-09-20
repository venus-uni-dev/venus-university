// The two school beats: the registrar's week grid, and a midterm paper on screen.

import { sleep } from '../game.mjs'

/** School 1: VenusBot's thread with the add/drop week grid open over it. */
export async function registrar({ g }) {
  await g.reset()
  // The schedule button is live only while the add/drop window is still open.
  await g.setSlot({ date: 8, time: 0 })
  await g.phone.venus()
  await sleep(900)
  // React-local state: only a real press opens the panel.
  await g.cdp.waitFor(`document.querySelector('#bb-venus-schedule')`, 10000)
  await g.cdp.press('#bb-venus-schedule')
  await sleep(900)
  return g.probe()
}

/** School 2: the midterm. Five questions go in and the reader answers at most four. */
export async function exam({ g, copy, opts, log }) {
  const beat = copy.beats.exam
  const staged = await g.exam({ code: beat.code, action: beat.action, questions: beat.questions })
  log(`${staged.questions} questions are loaded — answer at most four; the fifth hands the paper in`)
  if (opts.auto) {
    // The intro and the question read themselves out, and the four buttons go live.
    await g.auto(2, opts.auto)
    await g.openTurn()
  }
  return staged
}

/** Answers one question on camera, by letter. */
export async function quizAnswer({ g }, letter) {
  await g.cdp.press(`#game-quiz-${letter}`)
  await sleep(800)
  return g.probe()
}
