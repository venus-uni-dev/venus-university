// The second part of the renderer runtime: putting a scene on the stage, turning its lines, the
// two end-of-scene screens, the curtain's splash and the exam.

Object.assign(window.__tr, (() => {
  const tr = window.__tr
  const { all, ids, sleep, probe, resetToLanding, setSlot } = tr

  /** The `cg:` position a line carries, swapped for the one the command asked for. */
  function withCgPosition(lines, position) {
    if (!position) return lines
    return lines.map((line) => ({
      ...line,
      ...(line.actions
        ? {
            actions: line.actions.map((action) =>
              action.startsWith('cg:') ? 'cg:' + position : action
            )
          }
        : {})
    }))
  }

  /**
   * Puts a hand-written scene on the stage: the cast seated, the first line's background and
   * entrance applied, and the rest queued for the player's own clicks.
   */
  async function stageScene({ cast, time, date, weather, lines, cg }) {
    const m = await all()
    await resetToLanding()
    await setSlot({ date, time, weather })
    await m.promptState.stageCast(await ids(cast))

    const written = withCgPosition(lines, cg)
    const store = m.game.useGameStore.getState()
    store.appendSceneLines(written)
    store.appendPendingLines(written)
    m.game.useGameStore.setState({ awaitingInput: false, busy: false, waitingForLine: false })
    // The first line lands now, so the background and whoever opens the scene are on screen
    // before the camera rolls.
    m.game.useGameStore.getState().advanceLine()
    return probe()
  }

  /**
   * The same, opened under the curtain the app raises on a real scene start, so the reveal is on
   * camera. The stage draws the background while the cover is down and the curtain comes off it.
   */
  async function openScene(options) {
    const m = await all()
    await resetToLanding()
    await setSlot({ date: options.date, time: options.time, weather: options.weather })
    await m.promptState.stageCast(await ids(options.cast))

    m.slotCrossing.coverSceneOpening()
    while (m.crossing.useCrossingStore.getState().phase !== 'holding') await sleep(50)
    await sleep(1400)

    const written = withCgPosition(options.lines, options.cg)
    m.game.useGameStore.setState({ awaitingInput: false, busy: false })
    m.game.useGameStore.getState().setWaitingForLine(true)
    await m.stream.deliverSceneLines(written, m.loopState.currentRun())
    return probe()
  }

  /**
   * A continuation's lines landing on a scene already running — the fallback the typed turn uses
   * when the main-process stub is not available.
   */
  async function appendLines(lines) {
    const m = await all()
    const store = m.game.useGameStore
    store.getState().setInputDraft('')
    store.setState({ awaitingInput: false, busy: false, waitingForLine: false })
    store.getState().appendSceneLines(lines)
    store.getState().appendPendingLines(lines)
    store.getState().advanceLine()
    return probe()
  }

  /** Hands the turn back, which is what the box opening on the player's own click amounts to. */
  async function openTurn() {
    const m = await all()
    m.game.useGameStore.setState({ awaitingInput: true, busy: false, waitingForLine: false })
    return true
  }

  /** Resolves once the player has read the scene out and the box is his. */
  async function waitForTurn(timeoutMs) {
    const m = await all()
    const store = m.game.useGameStore
    const started = Date.now()
    while (!store.getState().awaitingInput || store.getState().pendingLines.length > 0) {
      if (Date.now() - started > (timeoutMs || 300000)) throw new Error('the turn never opened')
      await sleep(200)
    }
    return true
  }

  /** Resolves once a turn in flight has landed its reply. */
  async function waitForReply(timeoutMs) {
    const m = await all()
    const store = m.game.useGameStore
    const started = Date.now()
    while (store.getState().busy || store.getState().streaming) {
      if (Date.now() - started > (timeoutMs || 60000)) throw new Error('the reply never landed')
      await sleep(200)
    }
    return probe()
  }

  /** Turns `count` lines at the given pace — what `--auto` uses in place of the player's clicks. */
  async function auto(count, everyMs) {
    const m = await all()
    const store = m.game.useGameStore
    for (let turned = 0; turned < count; turned++) {
      await sleep(everyMs)
      if (!store.getState().advanceLine()) break
    }
    return store.getState().pendingLines.length
  }

  /** Raises the ✨ off a girl by hand, for the turn whose 50% roll missed. */
  async function sparkle(charKey) {
    const m = await all()
    const [charId] = await ids([charKey])
    m.game.useGameStore.setState({ sparkle: { charId, key: Date.now() } })
    return charId
  }

  /** The rank-up sheet, walking from one reading of the reader to the other. */
  async function rankUp({ stat, before, after }) {
    const m = await all()
    m.game.useGameStore.getState().setStatusModal({ kind: 'rankUp', ups: [stat], before, after })
    return true
  }

  /**
   * The milestone screen, over the status line that would precede it in play. `memory` is what
   * she took away from the hour, drawn in the box with its verb coloured and its own sting; the
   * sheet's sentence is the app's own, built from the same flag diff the ledger's would be.
   */
  async function milestone({ charKey, event, emotion, negative, memory }) {
    const m = await all()
    const [charId] = await ids([charKey])
    const name = m.game.useGameStore.getState().characters[charId].firstName

    if (memory) {
      const line = m.relationship.memoryStatusLine(name, memory)
      // The way it went, which is what rings as the line lands; the marks are the line's own.
      const marked = { ...line, status: { ...line.status, polarity: 'positive' } }
      const store = m.game.useGameStore.getState()
      store.appendSceneLines([marked])
      store.appendPendingLines([marked])
      m.game.useGameStore.getState().advanceLine()
      // The sheet must not rise over a line still being typed: the forward chevron is the box's
      // own report that it has finished writing one, and the splash lands off the note behind it.
      const until = Date.now() + 15000
      for (;;) {
        const hint = document.querySelector('.vu-box-hint')
        if (hint && Number(getComputedStyle(hint).opacity) > 0.9) break
        if (Date.now() > until) break
        await sleep(80)
      }
      await sleep(900)
    }

    const before = m.relationship.emptyFlags()
    const after = { ...before, [event || 'isLover']: true }
    const lines = m.relationship.milestoneStatusLines(name, before, after)
    m.game.useGameStore.getState().setStatusModal({
      kind: 'milestone',
      charId,
      name,
      lines,
      negative: Boolean(negative),
      emotion
    })
    return { charId, name, lines }
  }

  /** Raises the curtain on a slot that is not the one the save is in, and holds it there. */
  async function splash({ date, time, weather, from, to }) {
    const m = await all()
    const state = m.game.useGameStore.getState()
    const stamp = m.slotCrossing.slotStampOf(date, time, state.occasions, weather || 'clear')
    m.crossing.beginCrossing(undefined, { from, to, splash: stamp })
    while (m.crossing.useCrossingStore.getState().phase === 'closing') await sleep(50)
    return stamp
  }

  async function endSplash() {
    const m = await all()
    m.crossing.endCrossing()
    while (m.crossing.useCrossingStore.getState().phase !== 'idle') await sleep(50)
    return true
  }

  /** The date midterm week opens on — what the splash announces. */
  async function midtermDate() {
    const m = await all()
    return m.occasions.MIDTERM_WEEK.startDate
  }

  /**
   * Puts a midterm paper on screen, mirroring `startExam` with the questions handed in rather
   * than written: the A–D buttons then answer it for real.
   */
  async function exam({ code, action, questions }) {
    const m = await all()
    await resetToLanding()
    const store = m.game.useGameStore
    const entry = store.getState().classes[code]
    if (!entry) throw new Error('the loaded save is not enrolled in ' + code)

    store.getState().setCast([], { classCode: code })
    store.getState().logPlayerAction(action, false)
    store.getState().setSceneQuiz({ code, exam: 'midterm', questions, index: 0, correct: 0 })
    store
      .getState()
      .setSceneSummary(
        'The reader sat the midterm exam for ' + entry.name + '.',
        store.getState().currentSceneTranscript.length
      )
    store.getState().appendPendingLines([
      {
        speaker: '',
        bg: 'lecture_hall',
        text: m.academics.examIntroLine(entry.name, 'midterm', store.getState().time === 1)
      },
      { speaker: '', text: m.academics.QUIZ_RECALL_LINE },
      { speaker: '', text: questions[0].question }
    ])
    store.setState({ streaming: false, busy: false, waitingForLine: false, awaitingInput: false })
    store.getState().advanceLine()
    return { code, name: entry.name, questions: questions.length }
  }

  /** Whether each of these girls could turn up in this slot — nothing scheduled, not away. */
  async function freeNow(charKeys) {
    const m = await all()
    const castIds = await ids(charKeys)
    return castIds.map((charId, at) => ({
      charKey: charKeys[at],
      free: !m.timetable.charUnavailableNow(charId)
    }))
  }

  return {
    stageScene,
    openScene,
    appendLines,
    openTurn,
    waitForTurn,
    waitForReply,
    auto,
    sparkle,
    rankUp,
    milestone,
    splash,
    endSplash,
    midtermDate,
    exam,
    freeNow
  }
})())
