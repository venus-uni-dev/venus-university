// Build 1: two girls on the quad, working on him and on each other, and then the typed choice.
// What they answer with comes from the main-process stub, so the box clears and the wait shows
// exactly as they do in play — with no call. The trailer's opening cards are drawn behind them
// under `--captions`; without it the scene is bare and `caption` writes a card by hand.

import { sleep } from '../game.mjs'

export async function duoDay({ g, copy, opts, stub, log }) {
  const beat = copy.beats.duoDay
  await g.music(Boolean(opts.music))
  await g.stageScene({ cast: beat.cast, bg: beat.bg, time: beat.time, lines: beat.lines })
  if (opts.captions) await g.caption(copy.captions.intro)

  // The player clicks the lines through himself; `--auto` does it at that pace instead, and the
  // second card lands on the way so it is on screen when the question reaches him.
  if (opts.auto) {
    const half = Math.floor(beat.lines.length / 2)
    await g.auto(half, opts.auto)
    if (opts.captions) await g.caption(copy.captions.anything.lead, { big: copy.captions.anything.big })
    await g.auto(beat.lines.length - half - 1, opts.auto)
    await g.openTurn()
  } else {
    log(`read the ${beat.lines.length} lines out — the box opens on the last one, then it types itself`)
    await g.waitForTurn(600000)
  }
  await sleep(700)

  if (stub) {
    await stub.clear()
    // A continuation calls the scene channel and nothing else; the classifier is not asked.
    await stub.queue('llm:completeScene', { lines: beat.reply.lines, summary: beat.reply.summary })
  } else {
    log('9229 was unreachable: their answer is staged on the store instead of run through the loop')
  }

  await g.cdp.type('#game-action', beat.action, 60)
  await sleep(500)
  await g.cdp.press('#game-submit')

  if (stub) await g.waitForReply(60000)
  else {
    await sleep(1200)
    await g.appendLines(beat.reply.lines)
  }
  // The reply's first line is on screen either way; the rest are the player's clicks, or `--auto`'s.
  if (opts.auto) await g.auto(beat.reply.lines.length - 1, opts.auto)

  // One girl at a time: the store holds a single sparkle, so they are raised a beat apart.
  await sleep(600)
  await g.sparkle(beat.cast[0])
  await sleep(700)
  await g.sparkle(beat.cast[1])
  if (opts.captions) await g.clearCaption()
  return g.probe()
}
