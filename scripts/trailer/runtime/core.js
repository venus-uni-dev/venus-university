// Runs inside the dev renderer, evaluated by game.mjs before the other two parts. It resolves the
// app's own modules off the dev server, loads the scratch playthrough and owns the between-beats
// reset; `scene.js` and `chrome.js` hang the rest of the beats' vocabulary off the same object.

window.__tr = (() => {
  const cache = {}
  // The hour, the semester's sky and the phone as the save and the record wrote them, so a beat
  // that patches one — or a take that texts somebody — does not leave it behind for the next. On
  // the window, because each run of the driver re-evaluates this file and the page outlives them.
  const held = (window.__trHeld = window.__trHeld || { weather: null, slot: null, phone: null })

  /** The dev server's prefix for files outside the renderer root, read off one it has served. */
  function fsPrefix() {
    const served = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => name.includes('/@fs/') && name.includes('/src/shared/'))
    return served ? served.slice(0, served.indexOf('/src/shared/')) : null
  }

  /**
   * One of the app's own modules, by the tail of its dev-server URL. The timeline is read first,
   * so a hot-reload stamp is followed and an import never lands on a second, idle copy of a
   * store; a screen the app has not opened yet has loaded nothing, and its URL is built instead.
   */
  async function mod(suffix) {
    if (cache[suffix]) return cache[suffix]
    const urls = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => name.split('?')[0].endsWith(suffix))
    let url = urls[urls.length - 1]
    if (!url && suffix.startsWith('/')) url = location.origin + suffix
    if (!url) {
      const prefix = fsPrefix()
      if (prefix) url = prefix + '/src/' + suffix
    }
    if (!url) throw new Error('cannot resolve the module: ' + suffix)
    cache[suffix] = await import(url)
    return cache[suffix]
  }

  /** Every module the beats reach for, resolved once. */
  async function all() {
    const parts = await Promise.all([
      mod('/stores/gameStore.ts'),
      mod('/stores/uiStore.ts'),
      mod('/stores/crossingStore.ts'),
      mod('/stores/slotCrossing.ts'),
      mod('/stores/bunnyboardStore.ts'),
      mod('/stores/audioStore.ts'),
      mod('/stores/textingLoop.ts'),
      mod('/stores/gameLoop.ts'),
      mod('/stores/loop/promptState.ts'),
      mod('/stores/loop/stream.ts'),
      mod('/stores/loop/state.ts'),
      mod('/stores/timetable.ts'),
      mod('/prompts/occasions.ts'),
      mod('/prompts/bunnybot.ts'),
      mod('/prompts/venus.ts'),
      mod('shared/academics.ts'),
      mod('shared/relationship.ts'),
      mod('/stores/settingsStore.ts'),
      mod('shared/audio.ts')
    ])
    const names = [
      'game', 'ui', 'crossing', 'slotCrossing', 'bunny', 'audio', 'texting', 'loop',
      'promptState', 'stream', 'loopState', 'timetable', 'occasions', 'bunnybot', 'venus',
      'academics', 'relationship', 'settings', 'sharedAudio'
    ]
    return Object.fromEntries(names.map((name, at) => [name, parts[at]]))
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const G = async () => (await mod('/stores/gameStore.ts')).useGameStore

  /** charKeys to charIds against the loaded roster; an unknown key throws rather than vanishing. */
  async function ids(charKeys) {
    const map = (await G()).getState().charKeyToId
    return charKeys.map((key) => {
      if (!map[key]) throw new Error('no such character on the roster: ' + key)
      return map[key]
    })
  }

  /** The cheap reading the driver checks before it decides to build the scratch playthrough. */
  async function where() {
    const game = await G()
    const ui = await mod('/stores/uiStore.ts')
    return { view: ui.useUiStore.getState().view, playthroughId: game.getState().playthroughId }
  }

  /** Loads the scratch playthrough's one save straight into the live store. */
  async function loadScratch(playthroughId) {
    const m = await all()
    const listed = await window.api.saves.list(playthroughId)
    if (!listed.ok) throw new Error('saves.list failed: ' + JSON.stringify(listed.error))
    const chars = await window.api.chars.list()
    if (!chars.ok) throw new Error('chars.list failed: ' + JSON.stringify(chars.error))
    const byId = Object.fromEntries(chars.data.map((character) => [character.charId, character]))
    const newest = listed.data.saves[0]
    if (!newest) throw new Error('the scratch playthrough has no save in it')
    // Never `enterGame`: that runs the slot opening, which is a call.
    m.loop.resetLoop()
    m.game.useGameStore.getState().loadSave(newest.save, listed.data.record, byId)
    held.weather = listed.data.record.weather
    held.slot = { date: newest.save.date, time: newest.save.time }
    held.phone = newest.save.bunnyboard
    m.ui.useUiStore.getState().setView('game')
    await resetToLanding()
    return { playthroughId, saveId: newest.saveId, roster: m.game.useGameStore.getState().chars.length }
  }

  /**
   * Closes whatever panel is on screen. The Shop, the Map, the Calendar and the week grid are
   * React-local state no store reaches; Escape is what the app itself answers them with, and the
   * shell that is topmost takes it.
   */
  async function closePanels() {
    const root = document.getElementById('modal-root')
    for (let tries = 0; tries < 6 && root && root.childElementCount > 0; tries++) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await sleep(280)
    }
    return root ? root.childElementCount : 0
  }

  /** The between-beats state: no scene, no modal, no curtain, no phone, no caption. */
  async function resetToLanding() {
    const m = await all()
    await closePanels()
    // The save's own hour and phone and the record's own sky, fetched once per page: each run of
    // the driver is a new process, and only the files know what a beat has to be undone back to.
    const live = m.game.useGameStore.getState()
    if ((!held.weather || !held.slot || !held.phone) && live.playthroughId) {
      const listed = await window.api.saves.list(live.playthroughId)
      if (listed.ok) {
        const save = listed.data.saves[0]?.save
        held.weather = held.weather ?? listed.data.record.weather
        held.slot = held.slot ?? (save ? { date: save.date, time: save.time } : null)
        held.phone = held.phone ?? save?.bunnyboard ?? null
      }
    }
    if (m.crossing.useCrossingStore.getState().phase !== 'idle') m.crossing.cancelCrossing()
    // Whatever the last beat left the loop holding — a parked failure gate, an armed hangout's
    // prefetch, lines a cover was still holding — goes with it.
    m.loop.resetLoop()
    m.bunny.useBunnyboardStore.getState().reset()
    m.game.useGameStore.getState().clearStage()
    m.game.useGameStore.setState({
      ...(held.weather ? { weather: [...held.weather] } : {}),
      ...(held.slot ? held.slot : {}),
      // A fresh copy every time: a take that sent a text, armed a hangout or had BunnyBot speak
      // must not leave those in the thread the next take opens.
      ...(held.phone ? { bunnyboard: structuredClone(held.phone) } : {}),
      cast: [],
      pendingLines: [],
      currentLine: null,
      currentSceneTranscript: [],
      sceneSummary: null,
      sceneQuiz: null,
      sceneLog: [],
      statusModal: null,
      activeGameOver: null,
      sparkle: null,
      inputDraft: '',
      turnError: null,
      closingError: null,
      classifierError: null,
      awaitingInput: true,
      busy: false,
      streaming: false,
      waitingForLine: false
    })
    window.__tr.clearCaption()
    return true
  }

  /** The hour the stage is drawn in, and the sky over it. */
  async function setSlot({ date, time, weather }) {
    const m = await all()
    const state = m.game.useGameStore.getState()
    held.weather = held.weather ?? state.weather
    const patch = {}
    if (typeof date === 'number') patch.date = date
    if (typeof time === 'number') patch.time = time
    const day = patch.date ?? state.date
    const half = patch.time ?? state.time
    if (weather) {
      const table = [...state.weather]
      // One reading per half-day, day 0's morning first.
      table[day * 2 + half] = weather
      patch.weather = table
    }
    m.game.useGameStore.setState(patch)
    return { date: day, time: half }
  }

  /** Everything a beat is checked against, in one reading. */
  async function probe() {
    const m = await all()
    const game = m.game.useGameStore.getState()
    const crossing = m.crossing.useCrossingStore.getState()
    const bunny = m.bunny.useBunnyboardStore.getState()
    const nameOf = (charId) => {
      const character = game.characters[charId]
      return character ? character.firstName + ' ' + character.lastName : charId
    }
    return {
      view: m.ui.useUiStore.getState().view,
      playthroughId: game.playthroughId,
      visibility: document.visibilityState,
      date: game.date,
      time: game.time,
      bg: game.bg,
      // The last of the pair: a crossfade keeps the outgoing picture under the incoming one.
      bgSrc: [...document.querySelectorAll('.vu-stage-bg')].pop()?.getAttribute('src') ?? null,
      cast: game.cast.map(nameOf),
      slots: game.slots.map((charId) => (charId ? nameOf(charId) : null)),
      emotions: Object.fromEntries(
        Object.entries(game.emotions).map(([charId, ref]) => [nameOf(charId), ref])
      ),
      weather: game.weather[game.date * 2 + game.time] ?? 'clear',
      roster: game.chars.map(nameOf),
      line: game.currentLine ? game.currentLine.text.slice(0, 60) : null,
      queued: game.pendingLines.length,
      transcript: game.currentSceneTranscript.length,
      awaitingInput: game.awaitingInput,
      busy: game.busy,
      waitingForLine: game.waitingForLine,
      statusModal: game.statusModal ? game.statusModal.kind : null,
      errors: [game.turnError, game.classifierError, game.closingError]
        .filter(Boolean)
        .map((error) => error.code),
      quiz: game.sceneQuiz
        ? { code: game.sceneQuiz.code, index: game.sceneQuiz.index, correct: game.sceneQuiz.correct }
        : null,
      sparkle: game.sparkle ? nameOf(game.sparkle.charId) : null,
      crossing: { phase: crossing.phase, splash: crossing.splash },
      phone: { open: bunny.open, tab: bunny.tab, thread: bunny.viewingCharId, armed: bunny.armedHangout },
      caption: document.getElementById('trailer-caption')?.textContent ?? null
    }
  }

  return { mod, all, ids, sleep, where, loadScratch, closePanels, resetToLanding, setSlot, probe }
})()
