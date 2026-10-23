// Preloaded (node --import ./slim-check.mjs) on harness runs that post sheets: every full sheet the
// module posts must come back exactly from the module's slimSheet and the app's expansion
// (slim-expand.mjs), the sheet given left as it was. One `ok` for the run; exit 1 at the first
// mismatch. With SLIM_FIXTURE=<file>, each actor's widest sheet of the run is added to that file as a
// {name, full, slim} pair, for the app's tests: under MIDI=1 only where it differs from the run's
// own without, and only while the file stays under 600 KB.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { expandSheet } from './slim-expand.mjs'

const { slimSheet } = await import(`${process.env.MODULE_DIR}/scripts/sheet-slim.mjs`)
const run = basename(process.argv[1] ?? '', '.mjs')
const variant = process.env.MIDI ? 'MIDI' : 'X'
const FIXTURE_MOST = 600_000

let checked = 0
const widest = new Map()

function fail(why, sheet, detail) {
  process.stderr.write(`not ok - slim-check (${run} ${variant}): ${why}\n${detail ?? ''}\n`)
  // SLIM_DUMP=<file> keeps the sheet that failed, to look into.
  if (process.env.SLIM_DUMP && sheet) writeFileSync(process.env.SLIM_DUMP, JSON.stringify(sheet))
  process.exit(1)
}

function check(sheet, actorId) {
  if (!sheet || typeof sheet !== 'object' || 'slim' in sheet) return
  const before = JSON.stringify(sheet)
  let slim
  try { slim = slimSheet(sheet) } catch (err) { fail(`slimSheet threw for ${actorId}`, sheet, err.stack) }
  if (JSON.stringify(sheet) !== before) fail(`slimSheet changed the sheet it was given, of ${actorId}`)
  if (slim === sheet || slim?.slim !== 1) fail(`slimSheet gave no new slim sheet for ${actorId}`)
  const back = expandSheet(JSON.parse(JSON.stringify(slim)))
  if (!isDeepStrictEqual(back, sheet)) {
    const keys = Object.keys(sheet).filter(key => !isDeepStrictEqual(back?.[key], sheet[key]))
    fail(`the sheet of ${actorId} doesn't come back from slim: ${keys.join(', ')}`, sheet,
      keys.slice(0, 2).map(key => `  full ${JSON.stringify(sheet[key]).slice(0, 600)}\n  back ${JSON.stringify(back?.[key]).slice(0, 600)}`).join('\n'))
  }
  checked++
  const size = before.length
  if (size > (widest.get(actorId)?.size ?? -1)) widest.set(actorId, { size, full: JSON.parse(before), slim })
}

function inspect(body) {
  let envelope
  try { envelope = JSON.parse(body) } catch { return }
  if (envelope?.type === 'character.updated') check(envelope.data?.character?.sheet, envelope.data?.character?.id)
  // Module 0.30.0 (its contract §2.3): a group's sheet slims as a character's does.
  if (envelope?.type === 'group.updated') check(envelope.data?.group?.sheet, envelope.data?.group?.id)
  // Module 0.36.0 (round 0.36.0 §4.4): a companion's sheet, beside its entry, slims as a character's.
  if (envelope?.type === 'companion.updated') check(envelope.data?.sheet, envelope.data?.companion?.key)
  if (envelope?.type === 'bridge.hello') for (const c of envelope.data?.characters ?? []) check(c.sheet, c.id)
}

// Every harness sets globalThis.fetch for itself, after this has loaded: whatever it sets is the
// fetch posts reach, through this.
let inner = globalThis.fetch
const watching = (url, init) => {
  if (typeof init?.body === 'string') inspect(init.body)
  return inner(url, init)
}
Object.defineProperty(globalThis, 'fetch', { configurable: true, get: () => watching, set: fn => { inner = fn } })

function addToFixture(file) {
  const pairs = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []
  for (const [actorId, { full, slim }] of widest) {
    const name = `${run} ${variant} ${actorId}`
    const without = pairs.find(pair => pair.name === `${run} X ${actorId}`)
    if ((variant === 'MIDI') && without && isDeepStrictEqual(without.full, full)) continue
    const kept = pairs.filter(pair => pair.name !== name)
    const next = [...kept, { name, full, slim }]
    if (Buffer.byteLength(JSON.stringify(next)) >= FIXTURE_MOST) {
      process.stderr.write(`slim-check: ${name} left out of the fixture, which would come to 600 KB or more\n`)
      continue
    }
    pairs.splice(0, pairs.length, ...next)
  }
  writeFileSync(file, JSON.stringify(pairs))
}

process.on('exit', code => {
  if (code !== 0) return
  if (!checked) {
    process.stderr.write(`not ok - slim-check (${run} ${variant}): no full sheet was posted\n`)
    process.exitCode = 1
    return
  }
  if (process.env.SLIM_FIXTURE) addToFixture(process.env.SLIM_FIXTURE)
  console.log(`ok - every full sheet posted (${checked}, of ${widest.size} characters) slims and expands back to itself, untouched`)
})
