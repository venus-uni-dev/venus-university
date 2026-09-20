// The third part of the renderer runtime: the phone, the mix, and the caption layer the trailer's
// cards are written on.

Object.assign(window.__tr, (() => {
  const tr = window.__tr
  const { all, ids, sleep } = tr

  const phone = {
    async close() {
      const m = await all()
      m.bunny.useBunnyboardStore.getState().closeApp()
      return true
    },
    /** Opens one thread — a girl by charKey, or a bot by its own chat id. Last, since
     * `openApp` and `setTab` both clear whichever thread was open. */
    async thread(charKey) {
      const m = await all()
      const id = charKey.includes('_') ? (await ids([charKey]))[0] : charKey
      m.bunny.useBunnyboardStore.getState().openApp()
      m.bunny.useBunnyboardStore.getState().setTab('chats')
      m.bunny.useBunnyboardStore.getState().viewChar(id)
      return id
    },
    /** The VenusBot thread, whose schedule button is the registrar's way in. */
    async venus() {
      const m = await all()
      return phone.thread(m.venus.VENUS_CHAT_ID)
    },
    /** One incoming text, behind the typing bubble the app shows for a real one. */
    async incoming(charKey, text) {
      const m = await all()
      const [charId] = await ids([charKey])
      const state = m.game.useGameStore.getState()
      m.bunny.useBunnyboardStore.getState().setTyping(charId, true)
      await sleep(Math.min(3000, Math.round(49.5 * text.length)))
      m.bunny.useBunnyboardStore.getState().setTyping(charId, false)
      m.game.useGameStore
        .getState()
        .appendChatMessage(
          charId,
          { id: crypto.randomUUID(), sender: 'contact', text, date: state.date, time: state.time },
          0
        )
      return true
    },
    async outgoing(charKey, text) {
      const m = await all()
      const [charId] = await ids([charKey])
      const state = m.game.useGameStore.getState()
      m.game.useGameStore
        .getState()
        .appendChatMessage(
          charId,
          { id: crypto.randomUUID(), sender: 'player', text, date: state.date, time: state.time },
          0
        )
      return true
    },
    /** Sends the composer's text for real, so the reply comes back through the texting loop. */
    async send(charKey, text) {
      const m = await all()
      const [charId] = await ids([charKey])
      await m.texting.sendMessage(charId, text)
      return charId
    },
    /** BunnyBot's own delivery, which is what rings the tile and shakes it. */
    async bunnybotSeen(charKey) {
      const m = await all()
      const [charId] = await ids([charKey])
      const name = m.game.useGameStore.getState().characters[charId].firstName
      const text = m.bunnybot.bunnybotSeenTipText(name)
      m.texting.deliverBunnybotNow([text])
      return text
    },
    async armed() {
      const m = await all()
      return m.bunny.useBunnyboardStore.getState().armedHangout
    }
  }

  /**
   * Drops the game's music without touching the player's settings file. Volumes are percentages,
   * so the other three groups keep the player's own levels rather than being set to 1%.
   */
  async function music(on) {
    const m = await all()
    const settings = m.settings.useSettingsStore.getState().settings
    const volumes = m.sharedAudio.volumesOf(settings ? settings.volumes : null)
    m.audio.useAudioStore
      .getState()
      .setLiveVolumes({ ...volumes, music: on ? volumes.music : 0 })
    return on
  }

  const CAPTION_CSS = [
    '#trailer-caption{position:absolute;inset:0;z-index:1;pointer-events:none;',
    'display:flex;flex-direction:column;align-items:center;justify-content:flex-start;',
    // The top padding holds the card high on the stage, where a sprite standing centre does not
    // swallow the words behind it.
    'gap:0.15em;font-family:var(--font-display);text-align:center;padding:12vh 6vw 0;',
    'transform:rotate(-2deg);}',
    // A run of inline-blocks rather than a flex row, so the gap between two words is the display
    // face's own space. The size is set on the row, not the word: the space between two words is
    // a character of the row's text and would otherwise be drawn at the stage's own size.
    '#trailer-caption .tr-cap-row{display:block;line-height:1.05;font-size:clamp(2rem,6.4vw,5.5rem);}',
    '#trailer-caption .tr-cap-row--big{font-size:clamp(3.6rem,12vw,10rem);}',
    '#trailer-caption .tr-cap-word{display:inline-block;',
    'color:var(--vu-text);text-shadow:0.06em 0.07em 0 var(--vu-shadow);',
    'opacity:0;transform:translateY(0.6em);animation:tr-cap-rise 460ms cubic-bezier(.2,.9,.25,1) forwards;}',
    '@keyframes tr-cap-rise{to{opacity:1;transform:translateY(0);}}'
  ].join('')

  /** Writes the caption layer over the background and under the girls. */
  function caption(text, options) {
    const opts = options || {}
    clearCaption()
    const stage = document.querySelector('.vu-stage')
    if (!stage) throw new Error('there is no stage to caption')

    // Rewritten on every card rather than injected once: the page outlives the driver, so a
    // sheet left behind by an earlier run would keep the rules this one was edited to change.
    const style =
      document.getElementById('trailer-caption-style') ?? document.createElement('style')
    style.id = 'trailer-caption-style'
    style.textContent = CAPTION_CSS
    if (!style.isConnected) document.head.appendChild(style)

    const layer = document.createElement('div')
    layer.id = 'trailer-caption'
    // The stage's own half of the day, so the ink and the paper shadow follow it.
    layer.setAttribute('data-theme', stage.getAttribute('data-theme') ?? 'day')

    let index = 0
    const addRow = (words, big) => {
      const row = document.createElement('div')
      row.className = big ? 'tr-cap-row tr-cap-row--big' : 'tr-cap-row'
      for (const [at, word] of words.entries()) {
        // A real space between the spans: each word is its own box only so it can arrive on its
        // own beat, and the line should still read as one line of type.
        if (at > 0) row.appendChild(document.createTextNode(' '))
        const span = document.createElement('span')
        span.className = 'tr-cap-word'
        span.textContent = word
        // Each word arrives a beat after the one before it.
        span.style.animationDelay = index++ * 90 + 'ms'
        row.appendChild(span)
      }
      layer.appendChild(row)
    }

    if (text) addRow(String(text).split(/\s+/u).filter(Boolean), false)
    if (opts.big) addRow([String(opts.big)], true)

    // Before the portrait row, so it paints above the background and behind the girls.
    stage.insertBefore(layer, stage.querySelector('.vu-stage-row') || null)
    return true
  }

  function clearCaption() {
    document.getElementById('trailer-caption')?.remove()
    return true
  }

  return { phone, music, caption, clearCaption }
})())
