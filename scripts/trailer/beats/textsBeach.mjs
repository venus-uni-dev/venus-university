// Chorus 2: a texting thread that turns into a hangout, and the hangout that opens on the beach.
// With the stub in place this runs the app's real texting loop — composer, paced replies, the
// hangout classifier, Begin hangout and the curtain — and pays for none of it.

import { sleep } from '../game.mjs'
import { hangout, verdict } from '../stub.mjs'

export async function textsBeach({ g, copy, opts, stub, log }) {
  const beat = copy.beats.textsBeach
  await g.music(Boolean(opts.music))
  await g.reset()

  // The girls the scene casts have to be free this slot, or the attendance pass drops them and
  // the beach ends up one girl short of the three the lines are written for.
  const free = await g.freeNow(beat.scene.cast)
  const busy = free.filter((entry) => !entry.free).map((entry) => entry.charKey)
  if (busy.length > 0) log(`busy this slot and liable to be dropped from the cast: ${busy.join(', ')}`)

  await g.phone.thread(beat.charKey)
  await sleep(900)

  if (!stub) {
    log('9229 was unreachable: the thread and the beach scene are staged on the store directly')
    await g.phone.outgoing(beat.charKey, beat.readerText)
    for (const reply of beat.replies) await g.phone.incoming(beat.charKey, reply)
    await sleep(1500)
    await g.phone.close()
    await g.openScene({
      cast: beat.scene.cast,
      bg: beat.scene.bg,
      time: beat.scene.time,
      lines: beat.scene.lines
    })
    if (opts.auto) await g.auto(beat.scene.lines.length - 1, opts.auto)
    return g.probe()
  }

  await stub.clear()
  await stub.queue('llm:completeTexting', { messages: beat.replies, summary: beat.summary })
  await stub.queue('llm:classifyHangout', hangout(beat.hangout.description))
  // The hangout's own scene: the classifier casts it, then the scene call answers with the lines.
  // Two verdicts, because Begin re-classifies when it lands on a prefetch that has not finished
  // casting — and both answers have to put the same three girls on the beach.
  const cast = verdict(beat.scene.cast, { inPublic: true, sceneLocation: 'beach' })
  await stub.queue('llm:classify', cast)
  await stub.queue('llm:classify', cast)
  await stub.queue('llm:completeScene', {
    lines: beat.scene.lines,
    summary: beat.scene.summary ?? null
  })

  // Typed into the composer and sent for real; her replies come back through the pacer.
  await g.cdp.type('#bb-compose', beat.readerText, 55)
  await sleep(400)
  await g.cdp.press('#bb-send')

  await g.cdp.waitFor(`document.querySelector('#bb-begin-hangout')`, 90000)
  const armed = await g.phone.armed()
  log(`Begin hangout is up: ${armed ? armed.description : 'nothing armed'}`)

  // The scene is already being written behind the reply: Begin is only ready once that call has
  // taken its answer off the queue, or it would classify and ask for a second one.
  for (let waited = 0; waited < 40; waited++) {
    if ((await stub.pending())['llm:completeScene'] === 0) break
    await sleep(500)
  }

  if (!opts.auto) {
    log('press Begin hangout when the camera is ready; this beat waits for the scene to open')
  } else {
    await sleep(800)
    await g.cdp.press('#bb-begin-hangout')
  }

  // The curtain goes up on Begin and comes off the beach once the stage has drawn it. The
  // incoming picture is the last of the pair; the first is whatever it is crossfading off.
  await g.cdp.waitFor(
    `(() => { const layer = [...document.querySelectorAll('.vu-stage-bg')].pop();` +
      ` return (layer?.getAttribute('src') || '').includes(${JSON.stringify(beat.scene.bg)}) })()`,
    300000
  )
  await sleep(1500)
  if (opts.auto) await g.auto(beat.scene.lines.length - 1, opts.auto)
  return g.probe()
}
