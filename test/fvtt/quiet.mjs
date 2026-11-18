// Quiet fetching while nobody is in the app (module 0.50.0, its plan's Q1–Q10): to an app whose
// answer to a campaign's hello or heartbeat says `features.quiet`, each fetch says whether it is a
// quiet look, `quiet`; an answer's `quiet` is waited in place of its `wait` two minutes after the
// hello is answered, while no command is being made here, with a full fetch at least every five
// minutes; an answer without it, a hand-over, a hello answered, and an app that stops saying it bring
// full fetches at the usual pace back at once, and the fetch after a failed one is in full; and the
// settings window's status line says when it's quiet. An app that says nothing of it is fetched from as before. The real module; a
// stand-in Foundry and app, which answers `wait` 20 and `quiet` 60; the clock moved by the harness
// alone, so a case reads the pause the fetcher asked, never the time it took. Run with X=1 and
// --import ./unref-timers.mjs --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { actor, settings, user, users } from './stub.mjs'

const MODULE = process.env.MODULE_DIR
const ok = msg => console.log('ok -', msg)
let now = Date.parse('2026-11-18T20:00:00Z')
Date.now = () => now
const advance = ms => { now += ms }
const realSetTimeout = globalThis.setTimeout
// Every pause the fetcher asks, as asked: commands.mjs's #pause is the one timer the module starts
// with a function named `done`. A failed fetch's back-off, and a quiet wait of seconds, run at once;
// everything else waits as it would.
const pauses = []
const FAST = new Set([2_000, 4_000, 8_000, 16_000, 32_000])
globalThis.setTimeout = (fn, ms, ...args) => {
  if (fn?.name === 'done') pauses.push(ms)
  return realSetTimeout(fn, FAST.has(ms) ? 1 : ms, ...args)
}
const wait = ms => new Promise(resolve => realSetTimeout(resolve, ms))
const until = async (test, what, ms = 4000) => {
  const end = performance.now() + ms
  while (!test()) {
    if (performance.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await wait(5)
  }
}
foundry.utils.getProperty = (object, path) => path.split('.').reduce((o, key) => o?.[key], object)
// What the module logs, kept rather than printed.
const logged = []
console.warn = console.error = (...args) => logged.push(args.map(String).join(' '))

// ---- The world: Thorin, whose hit points' write the harness may hold ----
CONFIG.DND5E = {
  abilities: Object.fromEntries(['str', 'dex'].map(id => [id, { label: `DND5E.Ability${id}`, abbreviation: id.toUpperCase() }])),
  skills: { ath: { label: 'Athletics' } },
}
CONFIG.statusEffects = []
globalThis.fromUuid = async uuid => ({ uuid, text: { content: '' } })
foundry.applications.ux.TextEditor = { implementation: { enrichHTML: async html => html } }
const gm = user('gm', 'Gamemaster', true)
users.activeGM = gm
user('alice', 'Alice')
const ability = (value, mod) => ({ value, mod, proficient: 0, checkBonus: 0, checkProf: { term: '0', flat: 0 }, save: { value: mod, roll: { mode: 0 } }, check: { roll: { mode: 0 } } })
const thorin = actor('thorin', 'Thorin', ['alice'])
thorin.documentName = 'Actor'
thorin.statuses = new Set()
thorin.system = {
  abilities: { str: ability(14, 2), dex: ability(12, 1) },
  skills: { ath: { ability: 'str', total: 2, passive: 12, prof: { multiplier: 0 }, roll: { mode: 0 } } },
  attributes: { hp: { value: 30, max: 40, temp: 0 }, ac: { value: 15 }, prof: 2, init: { total: 1 }, movement: { walk: 30, speed: 30, units: 'ft' } },
  details: { level: 3, biography: { value: '' }, appearance: '' },
}
// Thorin's write waits while `held` is set, until the harness lets it go.
let held = null
const hold = () => { let release; held = new Promise(resolve => { release = resolve }); return () => { held = null; release() } }
thorin.update = async changes => {
  if (held) await held
  for (const [path, value] of Object.entries(changes)) {
    const keys = path.split('.')
    keys.slice(0, -1).reduce((o, key) => o[key], thorin)[keys.at(-1)] = value
  }
  return thorin
}

// ---- The app ----
// A hello's and heartbeat's answer says it has commands, and `quiet` while `app.quiet` is set; a
// fetch hands over what waits, with `wait` 20 and `quiet` as `app.answerQuiet` says (none where
// someone is in the app), unless a rule answers it otherwise.
const app = { events: [], polls: [], rules: [], waiting: [], quiet: 0, answerQuiet: 60 }
const json = (status, body) => ({
  ok: (status >= 200) && (status < 300), status, statusText: '', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body,
})
const empty = status => ({ ok: (status >= 200) && (status < 300), status, statusText: '', headers: new Headers() })
const when = (test, answer, times) => { const rule = { test, answer, times }; app.rules.push(rule); return rule }
let status = null
let campaignOf = null
// The settings window's line for Erebor's players' rolls, as it stands.
const rollsLine = () => status?.campaignStatus(campaignOf('camp-a')).find(({ text }) => text.startsWith('SENDINGSTONE.Status.Rolls')) ?? null
globalThis.fetch = async (url, init) => {
  const post = { url: String(url), body: JSON.parse(init.body) }
  post.commands = post.url.endsWith('/api/bridge/commands')
  if (post.commands) {
    // When it was made, which of the pauses asked follows it, and the status line as it was made.
    Object.assign(post, { at: now, pauseAt: pauses.length, line: rollsLine() })
    app.polls.push(post)
  } else app.events.push(post)
  const rule = app.rules.find(r => ((r.times ?? 1) > 0) && r.test(post))
  if (rule) {
    if (rule.times !== undefined) rule.times--
    return typeof rule.answer === 'function' ? rule.answer(post) : rule.answer
  }
  if (post.commands) {
    const commands = app.waiting.splice(0)
    return json(200, { commands, wait: 20, ...(app.answerQuiet ? { quiet: app.answerQuiet } : {}), open: [] })
  }
  if (['bridge.hello', 'bridge.heartbeat'].includes(post.body.type)) {
    return json(200, { features: { commands: true, ...(app.quiet ? { quiet: app.quiet } : {}) } })
  }
  return empty(204)
}
const polls = () => app.polls.length
/** The fetches made from the `from`th on, once there are `n` of them. */
const fetches = async (from, n, what) => {
  await until(() => polls() >= from + n, what)
  return app.polls.slice(from, from + n)
}
/** The pause the fetcher asked after a fetch, once asked. */
const pauseAfter = async poll => {
  await until(() => pauses.length > poll.pauseAt, 'the pause after a fetch')
  return pauses[poll.pauseAt]
}
const looks = list => list.map(poll => poll.body.quiet)
const hasQuiet = poll => Object.hasOwn(poll.body, 'quiet')
const sentOf = type => app.events.filter(post => post.body.type === type)
/** Post the campaign's hello, and resolve once its answer has been taken. */
const hello = async () => {
  const from = sentOf('bridge.hello').length
  announce({ campaignId: 'camp-a' })
  await until(() => sentOf('bridge.hello').length > from, 'the hello')
  await wait(30)
}
/** Send the campaign a heartbeat, half a minute on, and resolve once its answer has been taken. */
const beat = async () => {
  advance(30_000)
  const from = sentOf('bridge.heartbeat').length
  heartbeat()
  await until(() => sentOf('bridge.heartbeat').length > from, 'the heartbeat')
  await wait(30)
}
/** The fetches after the clock is moved on, `n` of them. */
const after = async (ms, n, what) => {
  advance(ms)
  return fetches(polls(), n, what)
}

// ---- Start-up: an app that says nothing of quiet ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
status = await import(`${MODULE}/scripts/delivery-status.mjs`)
const { announce } = await import(`${MODULE}/scripts/bridge.mjs`)
const { heartbeat } = await import(`${MODULE}/scripts/heartbeat.mjs`)
const { getCampaigns } = await import(`${MODULE}/scripts/campaigns.mjs`)
const { stopPollers, syncPollers } = await import(`${MODULE}/scripts/commands.mjs`)
const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
campaignOf = id => getCampaigns().find(c => c.id === id)

settings.set('listenerUrl', 'https://stone.example')
settings.set('campaignSecrets', { 'camp-a': 'erebor-secret' })
settings.set('campaigns', [{ id: 'camp-a', title: 'Erebor', characters: ['thorin'], rolls: true, hitPoints: true }])
// The module's own check every 10 seconds is left to the harness, which moves the time itself.
const realSetInterval = globalThis.setInterval
globalThis.setInterval = () => 0
await Hooks.callAll('ready')
globalThis.setInterval = realSetInterval
await until(() => sentOf('bridge.hello').length >= 1, "Erebor's hello")
Object.assign(diceStatus, { ready: true, reason: null })
syncPollers({ retry: true })
await fetches(0, 1, 'the first fetch')

// ---- Q1: an app whose answers say nothing of quiet ----
let list = await fetches(0, 3, 'fetches')
assert.ok(list.every(poll => !hasQuiet(poll)), 'no fetch says quiet')
assert.deepEqual(await Promise.all(list.map(pauseAfter)), [20, 20, 20])
list = await after(130_000, 3, 'fetches two minutes on')
assert.ok(list.every(poll => !hasQuiet(poll)), 'none two minutes on')
assert.deepEqual(await Promise.all(list.map(pauseAfter)), [20, 20, 20], "the answers' quiet 60 not taken")
await beat()
list = await fetches(polls(), 3, 'fetches after a heartbeat')
assert.ok(list.every(poll => !hasQuiet(poll)) && (await Promise.all(list.map(pauseAfter))).every(ms => ms === 20))
assert.equal(rollsLine()?.text.split(' ')[0], 'SENDINGSTONE.Status.RollsFetched')
ok('Q1: an app that says nothing of quiet: no fetch says quiet, and an answer\'s quiet is never waited, two minutes on or after a heartbeat; the status line as before')

// ---- Q2: the app says `quiet` 1: two minutes after the hello at the usual pace ----
app.quiet = 1
await hello()
let from = polls()
list = await fetches(from, 3, 'fetches after the hello')
assert.deepEqual(looks(list), [false, false, false], 'full fetches, saying so')
assert.deepEqual(await Promise.all(list.map(pauseAfter)), [20, 20, 20], 'though each answer says quiet')
list = await after(60_000, 3, 'a minute on')
assert.deepEqual(looks(list), [false, false, false])
assert.deepEqual(await Promise.all(list.map(pauseAfter)), [20, 20, 20])
list = await after(59_000, 3, 'a second short of two minutes')
assert.deepEqual(looks(list), [false, false, false])
assert.deepEqual(await Promise.all(list.map(pauseAfter)), [20, 20, 20])
assert.equal(rollsLine()?.text.split(' ')[0], 'SENDINGSTONE.Status.RollsFetched', 'not quiet yet')
ok('Q2: an app that says quiet 1: every fetch says quiet false, and for two minutes after the hello each waits its answer\'s wait, 20, though each answer says quiet')

// ---- Q3: two minutes on, quiet ----
list = await after(1_000, 3, 'two minutes after the hello')
assert.deepEqual(looks(list), [true, true, true], 'quiet looks')
assert.deepEqual(await Promise.all(list.map(pauseAfter)), [60, 60, 60], "each waits the answer's quiet")
ok('Q3: two minutes after the hello, the answer\'s quiet 60 is waited in place of its wait, and each next fetch is a quiet look')

// ---- Q4: an answer without quiet, and one handing over a command, bring full fetches back ----
when(post => post.commands, json(200, { commands: [], wait: 20, open: [] }), 1)
from = polls()
list = await fetches(from, 4, 'fetches after someone came')
assert.deepEqual(looks(list.slice(0, 2)), [true, false], 'the look someone was found at, then a full fetch')
assert.equal(await pauseAfter(list[0]), 20, 'waited 20 after an answer without quiet')
assert.equal(await pauseAfter(list[1]), 60, 'quiet again after an answer with it')
assert.deepEqual(looks(list.slice(2)), [true, true])
// A command handed over with quiet: the next fetch is full; the command, Gamemaster's hit points for
// a character not in the campaign, refused at once.
app.waiting.push({ id: 'hp-gone', actorId: 'nobody', kind: 'hitPoints', mode: 0, explicit: false, extras: [], dice: [], hitPoints: { op: 'set', value: 1, from: { value: 30 } } })
from = polls()
list = await fetches(from, 4, 'fetches after a hand-over')
assert.equal(app.waiting.length, 0, 'handed over')
assert.ok(sentOf('command.result').some(post => post.body.data.id === 'hp-gone' && post.body.data.reason === 'unknown'), 'refused at once')
assert.deepEqual(looks(list), [true, false, true, true], 'the look that took it, a full fetch, then looks')
assert.equal(await pauseAfter(list[0]), 20, 'the usual pace after a hand-over')
ok('Q4: an answer without quiet, as with someone in the app, and an answer handing over a command though it says quiet: the next fetch is full, after the answer\'s wait 20; quiet again after the next answer that says so')

// ---- Q5: a full fetch at least every five minutes ----
list = await after(300_000, 3, 'five minutes of looks on')
assert.deepEqual(looks(list), [false, true, true], 'a full fetch, then looks again')
assert.deepEqual(await Promise.all(list.map(pauseAfter)), [60, 60, 60], 'at the quiet pace')
list = await after(299_000, 2, 'a second short of five minutes on')
assert.deepEqual(looks(list), [true, true])
list = await after(1_000, 2, 'five minutes after the full fetch')
assert.deepEqual(looks(list), [false, true])
ok('Q5: while quiet, a full fetch five minutes after the last, at the quiet pace, and looks again after it')

// ---- Q6: the hello answered: at once, full, and two minutes at the usual pace ----
app.answerQuiet = 60_000
list = await fetches(polls(), 1, 'a fetch answered with a minute\'s quiet')
assert.equal(await pauseAfter(list[0]), 60_000, 'waiting a minute')
from = polls()
await wait(50)
assert.equal(polls(), from, 'and waits')
await hello()
await fetches(from, 1, 'the fetch at once after the hello')
app.answerQuiet = 60
list = await fetches(from, 3, 'fetches after the hello')
assert.deepEqual(looks(list), [false, false, false], 'full fetches')
assert.deepEqual(await Promise.all(list.map(pauseAfter)), [20, 20, 20], 'at the usual pace')
list = await after(119_000, 3, 'a second short of two minutes after the hello')
assert.deepEqual(looks(list), [false, false, false])
list = await after(1_000, 2, 'two minutes after the hello')
assert.deepEqual(looks(list), [true, true])
ok('Q6: the hello sent and answered while a quiet wait of a minute runs: a full fetch at once, then two minutes of full fetches at the usual pace, then looks')

// ---- Q7: a command being made keeps the usual pace ----
const release = hold()
app.waiting.push({ id: 'hp-held', actorId: 'thorin', kind: 'hitPoints', mode: 0, explicit: false, extras: [], dice: [], hitPoints: { op: 'set', value: 25, from: { value: 30 } } })
from = polls()
list = await fetches(from, 5, 'fetches while the command is made')
assert.equal(held !== null, true, 'still held')
assert.deepEqual(looks(list), [true, false, false, false, false], 'the look that took it, then full fetches')
assert.deepEqual(await Promise.all(list.map(pauseAfter)), [20, 20, 20, 20, 20], "the usual pace, though the answers say quiet")
release()
await until(() => sentOf('command.result').some(post => post.body.data.id === 'hp-held'), 'the held command made')
assert.equal(sentOf('command.result').find(post => post.body.data.id === 'hp-held').body.data.status, 'done')
from = polls()
list = await fetches(from, 3, 'fetches after it is made')
assert.deepEqual(looks(list.slice(1)), [true, true], 'quiet again')
ok('Q7: a command being made, its write held: the answers\' quiet is not taken and every fetch is full, after wait 20; made, quiet again')

// ---- Q8: an app that stops saying quiet ----
/** The fetches from the first one made since `from` that passes the test, `n` of them. */
const fromFirst = async (from, test, n, what) => {
  await until(() => app.polls.slice(from).some(test), what)
  return fetches(app.polls.findIndex((poll, i) => (i >= from) && test(poll)), n, what)
}
app.quiet = 0
from = polls()
await beat()
list = await fromFirst(from, poll => !hasQuiet(poll), 3, 'fetches after the heartbeat')
assert.ok(list.every(poll => !hasQuiet(poll)), 'no fetch says quiet')
assert.deepEqual(await Promise.all(list.map(pauseAfter)), [20, 20, 20])
app.quiet = 1
from = polls()
await beat()
list = await fromFirst(from, hasQuiet, 3, 'fetches after the next heartbeat')
assert.deepEqual(looks(list), [false, true, true], 'a full fetch, then looks: no hello, so no two minutes')
ok('Q8: a heartbeat\'s answer without quiet: no fetch says it, and wait 20 is waited; one with it again: looks again after one full fetch')

// ---- Q9: a failed fetch ----
when(post => post.commands, json(500, { reason: 'unavailable', message: 'Down' }), 1)
from = polls()
list = await fetches(from, 3, 'fetches after a failure')
assert.equal(list[0].body.quiet, true, 'the look that failed')
assert.equal(await pauseAfter(list[0]), 2_000, 'the back-off')
assert.deepEqual(looks(list.slice(1)), [false, true], 'a full fetch, then looks')
assert.equal(await pauseAfter(list[1]), 60)
ok('Q9: a quiet look that fails: the next fetch, after the back-off, is full; looks again after its answer says quiet')

// ---- Q10: the settings window's line ----
app.answerQuiet = 2_000
from = polls()
list = await fetches(from, 3, 'fetches answered quiet 2000')
assert.equal(await pauseAfter(list[1]), 2_000)
let line = rollsLine()
assert.equal(line.state, 'ok')
assert.match(line.text, /^SENDINGSTONE\.Status\.RollsQuiet \{"time":"[^"]+","seconds":2\}$/)
when(post => post.commands, json(200, { commands: [], wait: 20, open: [] }), 1)
from = polls()
list = await fetches(from, 2, 'fetches after an answer without quiet')
assert.match(list[1].line.text, /^SENDINGSTONE\.Status\.RollsFetched /, 'after an answer without quiet')
await fetches(polls(), 2, 'looks again')
assert.match(rollsLine().text, /^SENDINGSTONE\.Status\.RollsQuiet /)
when(post => post.commands, json(500, { reason: 'unavailable', message: 'Down' }), 1)
from = polls()
list = await fetches(from, 2, 'fetches after a failure')
assert.match(list[1].line.text, /^SENDINGSTONE\.Status\.RollsFetched /, 'after a failed fetch')
// The hello answered while a quiet wait of a minute runs: the line says nothing of quiet at once, as
// the full fetch it brings is made, before that fetch is answered.
app.answerQuiet = 60_000
list = await fetches(polls(), 1, 'a fetch answered with a minute\'s quiet')
assert.equal(await pauseAfter(list[0]), 60_000)
assert.match(rollsLine().text, /^SENDINGSTONE\.Status\.RollsQuiet \{"time":"[^"]+","seconds":60\}$/)
app.answerQuiet = 2_000
from = polls()
await hello()
list = await fetches(from, 1, 'the fetch at once after the hello')
assert.equal(list[0].body.quiet, false)
assert.match(list[0].line.text, /^SENDINGSTONE\.Status\.RollsFetched /, 'as the hello is answered')
// Fetching stopped, as when the campaign no longer fetches anything, or this client stops sending:
// the line says when its rolls were last fetched, and nothing of quiet fetches no longer made.
await after(120_000, 2, 'two minutes after the hello')
await until(() => rollsLine().text.startsWith('SENDINGSTONE.Status.RollsQuiet '), 'quiet again')
Object.assign(diceStatus, { ready: false })
await until(() => rollsLine().text.startsWith('SENDINGSTONE.Status.RollsFetched '), 'the line once fetching stops')
from = polls()
await wait(50)
assert.equal(polls(), from, 'fetching stopped')
Object.assign(diceStatus, { ready: true })
syncPollers()
await after(120_000, 2, 'two minutes after fetching started again')
await until(() => rollsLine().text.startsWith('SENDINGSTONE.Status.RollsQuiet '), 'quiet again')
stopPollers()
assert.match(rollsLine().text, /^SENDINGSTONE\.Status\.RollsFetched /, 'as this client stops fetching')
from = polls()
await wait(50)
assert.equal(polls(), from, 'fetching stopped')
// The words, as the Gamemaster reads them.
const lang = JSON.parse(readFileSync(`${MODULE}/lang/en.json`, 'utf8'))
assert.equal(lang.SENDINGSTONE.Status.RollsQuiet, "Players' rolls fetched at {time}. No one has a character or party open in the app, so Sending Stone asks it every {seconds} seconds.")
ok('Q10: the settings window says RollsQuiet with its seconds while quiet, RollsFetched after an answer without quiet and after a failed fetch, at once as a hello is answered, and once fetching stops, as the campaign fetches nothing or this client stops, in the words Players\' rolls fetched at {time}. No one has a character or party open in the app, so Sending Stone asks it every {seconds} seconds.')

assert.deepEqual(logged, [], 'nothing logged')
console.log('\nall quiet checks passed')
process.exit(0)
