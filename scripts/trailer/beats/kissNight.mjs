// Build 2: the rooftop at night, then the typed turn. Her reply comes from the main-process
// stub, so the box clears and the wait shows exactly as they do in play — with no call.

import { sleep } from '../game.mjs'

export async function kissNight({ g, copy, opts, stub, log }) {
  const beat = copy.beats.kissNight
  await g.music(Boolean(opts.music))
  await g.stageScene({ cast: beat.cast, bg: beat.bg, time: beat.time, lines: beat.lines })

  // The player clicks the six lines through himself; `--auto` does it at that pace instead.
  if (opts.auto) {
    await g.auto(beat.lines.length - 1, opts.auto)
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
    log('9229 was unreachable: her reply is staged on the store instead of run through the loop')
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

  // The scene's own sparkle is a 50/50 roll on her first happy line; the trailer wants it every time.
  await sleep(600)
  await g.sparkle(beat.cast[0])
  return g.probe()
}
