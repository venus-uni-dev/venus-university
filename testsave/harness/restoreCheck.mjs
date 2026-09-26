import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { unzipSync } from 'fflate'

/**
 * Drives the browser build through first run and a restore from `testsave/backup.zip`, then
 * checks the bridge sees exactly what the zip carries. Needs a running browser build on
 * `VU_WEB_PORT` (default 5199) and the harness mock (`mock.mjs`) on `VU_MOCK_PORT` (default
 * 8783) — this script starts neither. `testsave/backup.zip` must already exist (`makeBackup.mjs`
 * writes it); nothing here builds it.
 *
 * Usage: `node testsave/harness/restoreCheck.mjs`
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const WEB_PORT = process.env.VU_WEB_PORT || '5199'
const MOCK_PORT = process.env.VU_MOCK_PORT || '8783'
const BACKUP_PATH = join(REPO_ROOT, 'testsave', 'backup.zip')

let failures = 0
function check(ok, label) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`)
  if (!ok) failures++
  return ok
}

/** Loads chromium from the repo's own Playwright — a bare `import('playwright')` only resolves
 * when node_modules is on this file's own resolution path, so the absolute path is used the
 * same way `driver.mjs` loads it. */
async function loadChromium() {
  const entry = pathToFileURL(join(REPO_ROOT, 'node_modules', 'playwright', 'index.mjs')).href
  const mod = await import(entry)
  return mod.chromium
}

/** Clicks a field and types into it — the app's controlled inputs do not answer Playwright's `fill`. */
async function clickAndType(page, selector, text) {
  await page.click(selector)
  await page.keyboard.type(text)
}

/**
 * First run's API-key stage, pointed at the mock endpoint, then the SFW-content prompt —
 * the same steps `driver.mjs`'s `firstRun` runs, copied rather than imported (this file owns
 * no dependency on that one).
 */
async function firstRun(page, endpointUrl, modelId) {
  await page.waitForSelector('#setup-provider')
  await page.selectOption('#setup-provider', 'openai')

  await clickAndType(page, '#setup-endpoint-url', endpointUrl)
  await page.click('#setup-endpoint-key')
  await page.keyboard.type('')

  await clickAndType(page, '#setup-model-id', modelId)
  await page.click('.vu-setup-card-heading')

  await page.waitForSelector('#setup-key-save:not([disabled])')
  await page.click('#setup-key-save')

  await page.waitForSelector('#sfw-prompt-continue')
  await page.click('#sfw-prompt-continue')
}

/** `window.api`'s `Result<T>` — throws with the carried `AppError` on a failed call. */
function unwrap(result, label) {
  if (!result.ok) {
    throw new Error(`${label} failed: ${result.error.code} ${result.error.message}`)
  }
  return result.data
}

async function main() {
  const backupBytes = await readFile(BACKUP_PATH)
  const entries = unzipSync(new Uint8Array(backupBytes))
  const backup = JSON.parse(new TextDecoder().decode(entries['backup.json']))
  const [playthroughId] = Object.keys(backup.playthroughs)
  const expectedRecord = backup.playthroughs[playthroughId].record
  const expectedSaves = backup.saves.filter((s) => s.playthroughId === playthroughId)
  const expectedSettings = backup.settings

  const chromium = await loadChromium()
  const profileDir = await mkdtemp(join(tmpdir(), 'vu-restore-'))
  let context
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      viewport: { width: 1920, height: 1080 }
    })
    const page = context.pages()[0] ?? (await context.newPage())

    await page.goto(`http://localhost:${WEB_PORT}/`)
    await firstRun(page, `http://127.0.0.1:${MOCK_PORT}/v1`, 'mock-model')

    await page.waitForSelector('#menu-settings')
    await page.click('#menu-settings')

    await page.waitForSelector('#settings-backup-import')
    await page.click('#settings-backup-import')

    await page.waitForSelector('#settings-restore-confirm-confirm')
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('#settings-restore-confirm-confirm')
    ])
    await chooser.setFiles(BACKUP_PATH)

    // The restore's own busy state, off the same button the confirm dismissed.
    await page.waitForFunction(
      () => !document.querySelector('#settings-backup-import')?.textContent?.includes('Restoring'),
      { timeout: 60_000 }
    )

    const result = await page.evaluate(async () => {
      const playthroughs = await window.api.saves.playthroughs()
      const settings = await window.api.settings.get()
      let list = null
      let reads = []
      if (playthroughs.ok && playthroughs.data.length === 1) {
        const id = playthroughs.data[0].playthroughId
        list = await window.api.saves.list(id)
        if (list.ok) {
          for (const entry of list.data.saves) {
            reads.push({ saveId: entry.saveId, result: await window.api.saves.read(id, entry.saveId) })
          }
        }
      }
      return { playthroughs, settings, list, reads }
    })

    const playthroughs = unwrap(result.playthroughs, 'saves.playthroughs()')
    check(playthroughs.length === 1, `saves.playthroughs() shows exactly one playthrough (got ${playthroughs.length})`)
    if (playthroughs.length === 1) {
      check(
        playthroughs[0].playthroughId === playthroughId,
        `the restored playthrough id is ${playthroughId} (got ${playthroughs[0].playthroughId})`
      )
      check(
        playthroughs[0].saveCount + (playthroughs[0].hasAutosave ? 1 : 0) + playthroughs[0].manualCount ===
          expectedSaves.length,
        `saves.playthroughs() counts ${expectedSaves.length} save(s) (got ` +
          `${playthroughs[0].saveCount} slot + ${playthroughs[0].manualCount} manual + ${playthroughs[0].hasAutosave ? 1 : 0} autosave)`
      )
    }

    const list = result.list && unwrap(result.list, 'saves.list()')
    if (check(list !== null, 'saves.list() answered ok')) {
      check(
        isDeepStrictEqual(list.record, expectedRecord),
        'saves.list().record deep-equals the backup\'s playthrough record'
      )
      check(
        list.saves.length === expectedSaves.length && list.saves.every((s) => s.error === null),
        `saves.list().saves holds ${expectedSaves.length} save(s), none refused`
      )
    }

    check(result.reads.length === expectedSaves.length, `read every expected save (${result.reads.length})`)
    for (const { saveId, result: readResult } of result.reads) {
      const expected = expectedSaves.find((s) => s.saveId === saveId)
      try {
        const data = unwrap(readResult, `saves.read(${playthroughId}, ${saveId})`)
        check(
          expected !== undefined && isDeepStrictEqual(data.save, expected.save),
          `saves.read(${playthroughId}, ${saveId}).save deep-equals the backup's`
        )
        check(
          isDeepStrictEqual(data.record, expectedRecord),
          `saves.read(${playthroughId}, ${saveId}).record deep-equals the backup's playthrough record`
        )
      } catch (err) {
        check(false, err.message)
      }
    }

    const settings = unwrap(result.settings, 'settings.get()')
    check(
      isDeepStrictEqual(settings, expectedSettings),
      'settings.get() deep-equals the backup\'s settings'
    )
  } finally {
    if (context) await context.close()
    await rm(profileDir, { recursive: true, force: true })
  }

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`)
  if (failures > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error(`restoreCheck failed: ${err.stack ?? err.message}`)
  process.exitCode = 1
})
