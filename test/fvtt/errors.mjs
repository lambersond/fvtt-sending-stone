// Clear errors for the Gamemaster (module 0.23.0, its contract §8 H1–H13): what they're told of
// every post or fetch the app refuses, and every other failure to reach it, once per cause; what
// the settings window shows of it; and that retrying is as it was.
import assert from 'node:assert/strict'
import { actor, settings, user, users } from './stub.mjs'
import { click, find, openSettings, type, view } from './settings-app.mjs'

const MODULE = process.env.MODULE_DIR
const ok = msg => console.log('ok -', msg)
let now = Date.parse('2026-10-13T20:00:00Z')
Date.now = () => now
const advance = ms => { now += ms }
const realSetTimeout = globalThis.setTimeout
// A failed post is retried after 1 s and 3 s, and a failed fetch after 2 s, then longer: here at
// once. Everything else waits as it would.
const FAST = new Set([1_000, 3_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000])
globalThis.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, FAST.has(ms) ? 1 : ms, ...args)
const wait = ms => new Promise(resolve => realSetTimeout(resolve, ms))
const quiet = () => wait(60)
const until = async (test, what, ms = 4000) => {
  const end = performance.now() + ms
  while (!test()) {
    if (performance.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await wait(5)
  }
}
foundry.utils.getProperty = (object, path) => path.split('.').reduce((o, key) => o?.[key], object)

// Foundry's Hooks.off, which the stub lacks: a listener taken off is no longer called.
const live = new Set()
const hooksOn = Hooks.on.bind(Hooks)
Hooks.on = (name, fn) => {
  const listener = (...args) => (live.has(listener) ? fn(...args) : undefined)
  live.add(listener)
  hooksOn(name, listener)
  return listener
}
Hooks.off = (name, listener) => { live.delete(listener) }

// What the Gamemaster is told, kept to count.
const notices = []
ui.notifications.warn = text => notices.push({ level: 'warn', text })
ui.notifications.info = text => notices.push({ level: 'info', text })
const told = () => notices.splice(0)
const warned = list => list.filter(n => n.level === 'warn').map(n => n.text)
const informed = list => list.filter(n => n.level === 'info').map(n => n.text)
// What the module logs, kept rather than printed.
const logged = []
console.warn = console.error = (...args) => logged.push(args.map(String).join(' '))

// ---- The world: Thorin's sheet can be described, and made as large as wanted ----
CONFIG.DND5E = {
  abilities: Object.fromEntries(['str', 'dex'].map(id => [id, { label: `DND5E.Ability${id}`, abbreviation: id.toUpperCase() }])),
  skills: { ath: { label: 'Athletics' } },
}
CONFIG.statusEffects = []
globalThis.fromUuid = async uuid => ({ uuid, text: { content: '' } })
foundry.applications.ux.TextEditor = { implementation: { enrichHTML: async html => html } }
const gm = user('gm', 'Gamemaster', true)
users.activeGM = gm
user('alice', 'Alice'); user('bob', 'Bob')
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
actor('vex', 'Vex', ['bob'])

// ---- The app ----
// It answers each post or fetch by the first rule that matches it, `times` times (always without),
// or else as the app does: a hello's and heartbeat's answer says it has commands, a fetch has none.
const app = { events: [], polls: [], rules: [] }
const json = (status, body) => ({
  ok: (status >= 200) && (status < 300), status, statusText: '', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body,
})
const empty = status => ({ ok: (status >= 200) && (status < 300), status, statusText: '', headers: new Headers() })
const when = (test, answer, times) => { const rule = { test, answer, times }; app.rules.push(rule); return rule }
const drop = rule => app.rules.splice(app.rules.indexOf(rule), 1)
globalThis.fetch = async (url, init) => {
  const post = { url: String(url), auth: init.headers.Authorization, body: JSON.parse(init.body), bytes: Buffer.byteLength(init.body) }
  post.commands = post.url.endsWith('/api/bridge/commands')
  ;(post.commands ? app.polls : app.events).push(post)
  const rule = app.rules.find(r => ((r.times ?? 1) > 0) && r.test(post))
  if (rule) {
    if (rule.times !== undefined) rule.times--
    const answer = typeof rule.answer === 'function' ? rule.answer(post) : rule.answer
    if (answer instanceof Error) throw answer
    return answer
  }
  if (post.commands) return json(200, { commands: [], wait: 20 })
  return ['bridge.hello', 'bridge.heartbeat'].includes(post.body.type) ? json(200, { features: { commands: true } }) : empty(204)
}
const events = (test = () => true) => app.events.filter(post => test(post.body))
const of = (campaign, type) => e => (e.campaign?.id === campaign) && ((type === undefined) || (e.type === type))
const NOT_SET_UP = { reason: 'notSetUp', message: 'No campaign titled “Mirkwood” is set up for https://lonely-mountain.forge-vtt.com in Sending Stone' }

// ---- Start-up ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
const transport = await import(`${MODULE}/scripts/transport.mjs`)
const status = await import(`${MODULE}/scripts/delivery-status.mjs`)
const { announce } = await import(`${MODULE}/scripts/bridge.mjs`)
const { heartbeat } = await import(`${MODULE}/scripts/heartbeat.mjs`)
const { sendCharacter } = await import(`${MODULE}/scripts/character-sync.mjs`)
const { getCampaigns } = await import(`${MODULE}/scripts/campaigns.mjs`)
const { stopPollers, stopsFetching, syncPollers } = await import(`${MODULE}/scripts/commands.mjs`)
const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
const campaign = id => getCampaigns().find(c => c.id === id)
const lines = id => status.campaignStatus(campaign(id)).map(({ state, text }) => `${state} ${text.split(' ')[0]}`)
const dropped = []
Hooks.on('sendingStone.eventDropped', (envelope, { temporary }) => dropped.push([envelope.type, temporary]))

settings.set('listenerUrl', 'https://stone.example')
settings.set('campaignSecrets', { 'camp-a': 'erebor-secret', 'camp-b': 'mirkwood-secret' })
settings.set('campaigns', [
  { id: 'camp-a', title: 'Erebor', characters: ['thorin'] },
  { id: 'camp-b', title: 'Mirkwood', characters: ['vex'] },
])
// Mirkwood isn't set up in the app under that title: the app since 0.23.0 says so in JSON.
const mirkwoodRefused = when(e => (e.body.campaign?.id === 'camp-b') && !e.commands, json(404, NOT_SET_UP))
// The module's own check every 10 seconds is left to the harness, which moves the time itself.
const realSetInterval = globalThis.setInterval
globalThis.setInterval = () => 0
await Hooks.callAll('ready')
globalThis.setInterval = realSetInterval
await until(() => events(of('camp-a', 'character.updated')).length >= 1, "Erebor's sheets after its hello")
await quiet()
const beat = async () => {
  advance(30_000)
  heartbeat()
  await quiet()
}

// ---- H1: one app answering 204, the other campaign 404: one warning, and no flapping ----
let list = told()
for (let i = 0; i < 3; i++) {
  await beat()
  list.push(...told())
}
assert.equal(events(of('camp-b', 'bridge.heartbeat')).length, 3)
assert.equal(events(of('camp-a', 'bridge.heartbeat')).length, 3)
assert.deepEqual(informed(list), [], 'no info: before 0.23.0, 7 notices alternating each heartbeat')
assert.equal(warned(list).length, 1, warned(list).join('\n'))
assert.match(warned(list)[0], /^SENDINGSTONE\.Notify\.Problem \{"problem":"SENDINGSTONE\.Problem\.notSetUp .*\\"campaign\\":\\"Mirkwood\\".*"fix":"SENDINGSTONE\.Fix\.notSetUp /)
assert.deepEqual(lines('camp-b'), ['error SENDINGSTONE.Status.Failing'])
assert.match(status.campaignStatus(campaign('camp-b'))[0].text, /Status\.Failing .*"time":".+".*Problem\.notSetUp/)
assert.deepEqual(lines('camp-a'), ['ok SENDINGSTONE.Status.Delivered'])
// Still failing, more than ten minutes on: not told again while it lasts.
advance(660_000)
await beat()
assert.deepEqual(told(), [])
ok('H1: Erebor delivered, Mirkwood 404 notSetUp in JSON for 3 heartbeat cycles: 1 warning, Problem.notSetUp naming Mirkwood with its fix, 0 info, and none more while it lasts past 10 minutes; Mirkwood\'s status Failing, Erebor\'s Delivered')

// Set up in the app, or renamed here, Mirkwood is delivered again: told so, once.
drop(mirkwoodRefused)
await beat()
await beat()
list = told()
assert.deepEqual(warned(list), [])
assert.deepEqual(informed(list).map(text => text.split(' ')[0]), ['SENDINGSTONE.Notify.CampaignRecovered'])
assert.match(informed(list)[0], /"campaign":"Mirkwood"/)
assert.deepEqual(lines('camp-b'), ['ok SENDINGSTONE.Status.Delivered'])
ok('H1: once Mirkwood is delivered again, one CampaignRecovered naming it, and its status is Delivered')

// ---- H2: a 401's reason, and a JSON reason before the status ----
const ping = (title = 'Erebor') => transport.buildEnvelope('bridge.ping', {}, { campaign: { id: 'camp-a', title }, sequenced: false })
const refusedWith = async (answer, options = {}) => {
  const rule = when(() => true, answer, 1)
  try {
    await transport.deliver(ping(), { destination: 'https://stone.example', ...options })
  } catch (err) {
    return err
  } finally {
    drop(rule)
  }
  throw new Error('delivered')
}
let err = await refusedWith(empty(401), { secret: '' })
assert.deepEqual([err.name, err.reason, err.status, err.retryable], ['DeliveryError', 'noSecret', 401, false])
assert.equal(app.events.at(-1).auth, undefined, 'sent without a secret')
err = await refusedWith(empty(401), { secret: 'typed' })
assert.equal(err.reason, 'wrongSecret')
err = await refusedWith(json(401, { reason: 'notSetUp', message: 'No campaign' }), { secret: 'typed' })
assert.equal(err.reason, 'notSetUp', 'the JSON reason, not the status')
err = await refusedWith(json(500, { reason: 'badEnvelope', message: 'Not a Sending Stone envelope' }))
assert.deepEqual([err.reason, err.retryable], ['badEnvelope', true], 'retried by its status all the same')
err = await refusedWith(json(401, { reason: 'secretExpired', message: 'Your secret expired' }))
assert.deepEqual([err.reason, err.detail], ['status', 'Your secret expired'], 'an unknown reason: its message said')
err = await refusedWith(json(404, { reason: 'constructor', message: 'Nope' }))
assert.deepEqual([err.reason, err.detail], ['status', 'Nope'], 'only a reason this module knows')
err = await refusedWith(json(403, { reason: 'not a reason!', message: 'Only games on The Forge are accepted' }))
assert.equal(err.reason, 'notForge', 'a reason not like one is none')
err = await refusedWith(json(400, { reason: 'malformed', message: 'm', detail: `  ${'d'.repeat(400)}  `, limit: 4096.5, protocol: 2 }))
assert.deepEqual([err.reason, err.detail, err.limit], ['malformed', 'd'.repeat(300), null], 'detail trimmed to 300; a limit that is no whole number ignored')
ok('H2: a 401 without Authorization is noSecret, with it wrongSecret; a known JSON reason beats the status, which still decides retrying; an unknown or odd one is status, its message the detail')

// ---- H3: the app unreachable from both campaigns: told once, with the address; back, once ----
const offline = when(() => true, () => new TypeError('Failed to fetch'))
for (let i = 0; i < 3; i++) await beat()
list = told()
assert.equal(warned(list).length, 1, warned(list).join('\n'))
assert.match(warned(list)[0], /^SENDINGSTONE\.Notify\.Problem \{"problem":"SENDINGSTONE\.Problem\.unreachable .*\\"address\\":\\"https:\/\/stone\.example\\".*"fix":"SENDINGSTONE\.Fix\.unreachable /)
assert.deepEqual(informed(list), [])
assert.ok(events(of('camp-a', 'bridge.heartbeat')).length && events(of('camp-b', 'bridge.heartbeat')).length)
assert.deepEqual(lines('camp-a'), ['error SENDINGSTONE.Status.Failing'])
assert.deepEqual(lines('camp-b'), ['error SENDINGSTONE.Status.Failing'])
assert.match(status.campaignStatus(campaign('camp-a'))[0].text, /Problem\.unreachable/)
drop(offline)
await beat()
list = told()
assert.deepEqual([warned(list), informed(list)], [[], ['SENDINGSTONE.Notify.Reconnected']])
assert.deepEqual([lines('camp-a'), lines('camp-b')], [['ok SENDINGSTONE.Status.Delivered'], ['ok SENDINGSTONE.Status.Delivered']])
// Offline, it says so.
Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true })
advance(600_000)
const offlineAgain = when(() => true, () => new TypeError('Failed to fetch'))
await beat()
list = told()
assert.equal(warned(list).length, 1)
assert.match(warned(list)[0], /SENDINGSTONE\.Problem\.offline .*"fix":"SENDINGSTONE\.Fix\.unreachable /)
Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true })
drop(offlineAgain)
await beat()
assert.deepEqual(informed(told()), ['SENDINGSTONE.Notify.Reconnected'])
ok('H3: 3 heartbeat cycles of TypeErrors from both campaigns: one Problem.unreachable with the address, both Failing; the next 204: one Reconnected, both Delivered; offline (navigator.onLine false), the offline wording')

// ---- H4: a 413 in JSON: told once per campaign and kind of event; the connection never fails ----
const chat = (id, campaignId, content = '') => transport.send('chat.message.created', { message: { id, content } }, campaign(campaignId))
const tooLarge = when(e => e.body.type === 'chat.message.created', json(413, { reason: 'tooLarge', message: 'Larger than the 4000000 bytes Sending Stone takes', limit: 4_000_000 }))
let from = app.events.length
chat('a1', 'camp-a', 'x'.repeat(1000))
chat('a2', 'camp-a')
await quiet()
list = told()
assert.equal(warned(list).length, 1)
const posted = app.events[from].bytes
assert.match(warned(list)[0], /SENDINGSTONE\.Problem\.tooLarge .*\\"campaign\\":\\"Erebor\\".*\\"size\\":\\"0\.1 MB\\".*\\"limit\\":\\"4\.0 MB\\".*\\"what\\":\\"SENDINGSTONE\.What\.Chat\\"/)
assert.ok(posted > 1000 && posted < 100_000)
chat('b1', 'camp-b')
await quiet()
list = told()
assert.equal(warned(list).length, 1)
assert.match(warned(list)[0], /Problem\.tooLarge .*\\"campaign\\":\\"Mirkwood\\"/)
assert.equal(app.events.length - from, 3, 'each fetched once: not retried')
drop(tooLarge)
await beat()
list = told()
assert.deepEqual([warned(list), informed(list)], [[], []], 'no Reconnected: the connection never failed')
assert.deepEqual(lines('camp-a'), ['ok SENDINGSTONE.Status.Delivered', 'warning SENDINGSTONE.Status.Refused'])
assert.match(status.campaignStatus(campaign('camp-a'))[1].text, /Status\.Refused .*Problem\.tooLarge .*\\"size\\":\\"0\.1 MB\\".*\\"limit\\":\\"4\.0 MB\\"/)
ok('H4: a 413 in JSON with its limit: told once per campaign and kind of event, size posted and limit "4.0 MB", not retried; the next success says nothing; the campaign shows Last refused')

// ---- H5: a post larger than the app takes, before it's sent ----
from = app.events.length
transport.send('combat.updated', { combat: { id: 'c1', name: 'x'.repeat(1_050_000) } }, campaign('camp-a'))
await quiet()
assert.equal(app.events.length, from, 'never fetched')
list = told()
assert.equal(warned(list).length, 1)
assert.match(warned(list)[0], /SENDINGSTONE\.Problem\.tooLarge .*\\"campaign\\":\\"Erebor\\".*\\"size\\":\\"1\.1 MB\\".*\\"limit\\":\\"1\.0 MB\\".*\\"what\\":\\"SENDINGSTONE\.What\.Combat\\".*"fix":"SENDINGSTONE\.Fix\.tooLarge /)
assert.ok(logged.some(line => line.includes('Could not deliver combat.updated') && line.includes('SENDINGSTONE.Error.TooLarge')))
ok('H5: a combat update over the 1,000,000 bytes an app takes until it says more is never fetched: Problem.tooLarge, "1.1 MB" more than "1.0 MB", A combat update')

// ---- H6: a 400 in JSON, malformed: once per kind of event; what was wrong logged ----
const malformed = when(e => e.body.type.startsWith('chat.message.'), e => json(400, {
  reason: 'malformed', message: `Malformed ${e.body.type}`, type: e.body.type, detail: '✖ Invalid input: expected string, received undefined\n  → at message.timestamp',
}))
logged.length = 0
transport.send('chat.message.updated', { message: { id: 'm1' } }, campaign('camp-a'))
transport.send('chat.message.updated', { message: { id: 'm2' } }, campaign('camp-a'))
transport.send('chat.message.deleted', { id: 'm1' }, campaign('camp-a'))
await quiet()
list = told()
assert.equal(warned(list).length, 2, warned(list).join('\n'))
assert.match(warned(list)[0], /SENDINGSTONE\.Problem\.malformed .*\\"what\\":\\"sENDINGSTONE\.What\.Chat\\".*\\"detail\\":\\": ✖ Invalid input: expected string, received undefined\\\\n  → at message\.timestamp\\".*"fix":"SENDINGSTONE\.Fix\.malformed /)
assert.equal(logged.filter(line => line.includes('Could not deliver chat.message.updated') && line.includes('→ at message.timestamp')).length, 2)
drop(malformed)
ok('H6: a 400 in JSON, malformed with its type and detail: told once per kind of event, the detail in what is told and logged')

// ---- H7: an older app's refusals, in text or nothing ----
const text = (status, type, body) => ({ ok: false, status, statusText: '', headers: new Headers({ 'content-type': type }), text: async () => body })
err = await refusedWith(text(404, 'text/plain;charset=UTF-8', 'No campaign titled “Erebor” is set up for https://x.forge-vtt.com in Sending Stone'))
assert.deepEqual([err.reason, err.detail], ['notSetUp', null])
assert.match(err.message, /SENDINGSTONE\.Error\.Status .*: No campaign titled/)
err = await refusedWith(text(403, 'text/plain;charset=UTF-8', 'Only games on The Forge are accepted'))
assert.equal(err.reason, 'notForge')
err = await refusedWith(text(404, 'text/html', 'Not Found\n<html><body>Not Found</body></html>'))
assert.deepEqual([err.reason, err.detail], ['status', 'Not Found'])
err = await refusedWith(empty(401), { secret: 'typed' })
assert.equal(err.reason, 'wrongSecret')
err = await refusedWith(text(400, 'text/plain;charset=UTF-8', 'Unsupported protocol 3'))
assert.deepEqual([err.reason, err.detail], ['malformed', 'Unsupported protocol 3'])
err = await refusedWith(text(400, 'text/plain;charset=UTF-8', 'Malformed chat.cleared\n✖ Invalid input'))
assert.deepEqual([err.reason, err.detail], ['malformed', 'Malformed chat.cleared'], 'its first line')
for (const [answer, reason] of [
  [{ ok: false, status: 418, statusText: '' }, 'status'],
  [{ ok: false, status: 404, statusText: '' }, 'notSetUp'],
  [{ ok: false, status: 503, statusText: '', headers: new Headers({ 'content-type': 'application/json' }) }, 'unavailable'],
  [{ ok: false, status: 429, statusText: '', headers: new Headers({ 'content-type': 'application/json' }), json: async () => { throw new SyntaxError('x') } }, 'rateLimited'],
  [empty(425), 'rateLimited'],
  [{ ok: false, status: 408, statusText: '', headers: { get: () => { throw new Error('odd') } } }, 'timeout'],
  [{ ok: false, status: 413, statusText: '', headers: new Headers(), text: async () => { throw new Error('gone') } }, 'tooLarge'],
]) {
  err = await refusedWith(answer)
  assert.equal(err.reason, reason, String(answer.status))
}
ok('H7: an older app: a 404 "No campaign titled…" in text is notSetUp, "Only games…" notForge, an HTML 404 status with its first line, an empty 401 wrongSecret, a 400 malformed with its first line, a 425 rateLimited; no headers, json or text falls back to the status, never throwing')

// ---- H8: retrying as before ----
dropped.length = 0
from = app.events.length
let rule = when(e => e.body.type === 'combat.started', json(500, { reason: 'unavailable', message: 'Sending Stone couldn’t take this just now' }))
transport.send('combat.started', { combat: { id: 'c1' } }, campaign('camp-a'))
await quiet()
assert.equal(app.events.length - from, 3)
drop(rule)
from = app.events.length
rule = when(e => e.body.type === 'combat.ended', json(404, NOT_SET_UP))
transport.send('combat.ended', { combat: { id: 'c1' } }, campaign('camp-a'))
await quiet()
assert.equal(app.events.length - from, 1)
drop(rule)
assert.deepEqual(dropped, [['combat.started', true], ['combat.ended', false]])
// A hello lost to failures that might not last is sent again at the check 30 seconds later.
rule = when(e => (e.body.type === 'bridge.hello') && (e.body.campaign.id === 'camp-a'), empty(503), 3)
announce({ campaignId: 'camp-a' })
await quiet()
assert.equal(rule.times, 0)
from = app.events.length
await beat()
await until(() => events(of('camp-a', 'bridge.hello')).length && app.events.slice(from).some(e => e.body.type === 'bridge.hello'), 'the hello again')
told()
ok('H8: as before, a 500 is fetched 3 times and dropped as temporary, a 404 once and not; a hello lost to 503s is sent again at the check 30 seconds later')

// ---- H9: the same cause back within ten minutes of when it last cleared isn't told again; after, it is ----
const slowDown = () => when(e => !e.commands, json(429, { message: 'Too many' }))
rule = slowDown()
await beat()
list = told()
assert.equal(warned(list).length, 1)
assert.match(warned(list)[0], /Problem\.rateLimited .*\\"status\\":429/)
drop(rule)
await beat()
assert.deepEqual(informed(told()), ['SENDINGSTONE.Notify.Reconnected'])
advance(240_000)
rule = slowDown()
await beat()
drop(rule)
await beat()
assert.deepEqual(told(), [], 'within 10 minutes: no warning, and no info for what was not told')
// More than ten minutes after it was told, but not after it last cleared: still not.
advance(330_000)
rule = slowDown()
await beat()
drop(rule)
await beat()
assert.deepEqual(told(), [], 'coming and going, it is told once')
advance(600_000)
rule = slowDown()
await beat()
list = told()
assert.equal(warned(list).length, 1)
drop(rule)
await beat()
assert.deepEqual(informed(told()), ['SENDINGSTONE.Notify.Reconnected'])
ok('H9: a 429 told, then recovered (Reconnected); back within 10 minutes of when it last cleared, even 11 minutes after it was told: no warning, no info; back 10 minutes after it last cleared: one warning')

// ---- H10: fetching players' rolls ----
Object.assign(diceStatus, { ready: true, reason: null })
settings.set('campaigns', [
  { id: 'camp-a', title: 'Erebor', characters: ['thorin'], rolls: true },
  { id: 'camp-b', title: 'Mirkwood', characters: ['vex'] },
])
syncPollers({ retry: true })
await until(() => app.polls.length >= 3, 'fetches')
assert.ok(app.polls.every(poll => poll.body.campaign.id === 'camp-a' && poll.auth === 'Bearer erebor-secret'))
assert.deepEqual(lines('camp-a').at(-1), 'ok SENDINGSTONE.Status.RollsFetched')
assert.ok(!lines('camp-b').some(line => line.includes('Rolls')), 'no rolls line without rolls')
// a) A 404, which events told first: the fetch stops, and the cause isn't told again.
const erebor404 = when(e => !e.commands && (e.body.campaign?.id === 'camp-a'), json(404, NOT_SET_UP))
await beat()
assert.deepEqual(warned(told()).map(text => /Problem\.(\w+)/.exec(text)[1]), ['notSetUp'])
let polls = app.polls.length
let stop = when(e => e.commands, json(404, NOT_SET_UP))
await until(() => app.polls.length > polls, 'the refused fetch')
await quiet()
polls = app.polls.length
await quiet()
assert.equal(app.polls.length, polls, 'stopped')
assert.deepEqual(told(), [], 'RollsStopped untold: events told Erebor:notSetUp')
// Its last refused event (H6) stays until the next.
assert.deepEqual(lines('camp-a'), ['error SENDINGSTONE.Status.Failing', 'warning SENDINGSTONE.Status.Refused', 'error SENDINGSTONE.Status.RollsStopped'])
assert.match(status.campaignStatus(campaign('camp-a'))[2].text, /Status\.RollsStopped .*Problem\.notSetUp/)
drop(erebor404)
await beat()
assert.deepEqual(informed(told()).map(text => text.split(' ')[0]), ['SENDINGSTONE.Notify.CampaignRecovered'])
drop(stop)
// b) A 400 stops it too, since 0.23.0, and is told: until the settings change or a hello.
stop = when(e => e.commands, json(400, { reason: 'badEnvelope', message: 'Not a Sending Stone fetch' }))
polls = app.polls.length
syncPollers({ retry: true })
await until(() => app.polls.length > polls, 'the fetch')
await quiet()
assert.equal(app.polls.length, polls + 1, 'one fetch, then stopped')
list = told()
assert.equal(warned(list).length, 1)
assert.match(warned(list)[0], /^SENDINGSTONE\.Notify\.RollsStopped \{"campaign":"Erebor","problem":"SENDINGSTONE\.Problem\.badEnvelope .*"fix":"SENDINGSTONE\.Fix\.badEnvelope /)
assert.ok(['badEnvelope', 'malformed', 'notSetUp', 'wrongSecret', 'noSecret', 'notForge', 'tooLarge', 'status'].every(stopsFetching))
assert.ok(!['unreachable', 'timeout', 'unavailable', 'rateLimited'].some(stopsFetching))
drop(stop)
// c) Three failures in a row that are retried: told once; back, told so.
// Each failing fetch is held until let go, one at a time.
advance(600_000)
const holding = []
const down = when(e => e.commands, async () => {
  await new Promise(resolve => holding.push(resolve))
  throw new TypeError('Failed to fetch')
})
const failOne = async () => {
  await until(() => holding.length, 'a fetch held')
  holding.shift()()
  await wait(10)
}
syncPollers({ retry: true })
await failOne()
await failOne()
assert.deepEqual(told(), [], 'not after two')
assert.deepEqual(lines('camp-a').at(-1), 'ok SENDINGSTONE.Status.RollsFetched', 'nor shown')
await failOne()
list = told()
assert.equal(warned(list).length, 1)
assert.match(warned(list)[0], /^SENDINGSTONE\.Notify\.RollsFailing \{"campaign":"Erebor","problem":"SENDINGSTONE\.Problem\.unreachable /)
assert.deepEqual(lines('camp-a').at(-1), 'warning SENDINGSTONE.Status.RollsFailing')
await failOne()
await failOne()
assert.deepEqual(told(), [], 'once')
drop(down)
await failOne()
await until(() => informed(notices).length, 'the next fetch')
await quiet()
assert.deepEqual(informed(told()), ['SENDINGSTONE.Notify.RollsRecovered {"campaign":"Erebor"}'])
assert.deepEqual(lines('camp-a').at(-1), 'ok SENDINGSTONE.Status.RollsFetched')
// d) One failure, then a fetch: nothing to tell.
polls = app.polls.length
const once = when(e => e.commands, () => new TypeError('Failed to fetch'), 1)
await until(() => (once.times === 0) && (app.polls.length >= polls + 3), 'a failure and fetches after it')
assert.deepEqual(told(), [])
ok('H10: a 404 stops fetching, RollsStopped untold as events told Erebor:notSetUp; a 400 stops it too and is told; 3 failures in a row of a kind retried: one RollsFailing, the next fetch RollsRecovered; one failure then a fetch: nothing; syncPollers({retry}) starts it again')

// ---- H11: the settings window's status lines ----
// Rewritten as the status changes, without the window being drawn again; not once it's closed. The
// open campaign's Connection tab has its lines; each campaign's dot down the side, its worst, with
// every line as its tooltip. A campaign added but not saved is new, and left alone.
const win = await openSettings()
await click(win, '[data-action="addCampaign"]')
const unsaved = find(win, 'nav.sending-stone-nav [aria-current="page"]').dataset.campaignId
await view(win, 'campaign', { campaignId: 'camp-a', tab: 'connection' })
type(win, 'campaign.title', 'typed but not saved')
const statusOf = () => find(win, '[data-campaign-status="camp-a"]')
const dot = id => find(win, `nav.sending-stone-nav [data-campaign-state="${id}"]`)
const shown = () => [...statusOf().children].map(span => `${span.dataset.state} ${span.textContent.split(' ')[0]}`)
// What was drawn is set aside, so that only the rewrite can show the lines again.
const stale = () => {
  statusOf().replaceChildren()
  for (const id of ['camp-a', 'camp-b', unsaved]) dot(id).dataset.state = 'stale'
}
stale()
const renders = win.renders
await beat()
assert.deepEqual(shown(), ['ok SENDINGSTONE.Status.Delivered', 'warning SENDINGSTONE.Status.Refused', 'ok SENDINGSTONE.Status.RollsFetched'])
assert.deepEqual(['camp-a', 'camp-b', unsaved].map(id => dot(id).dataset.state), ['warning', 'warning', 'stale'], 'a campaign not saved is left alone')
assert.match(dot('camp-b').dataset.tooltip, /^SENDINGSTONE\.Status\.Delivered .* SENDINGSTONE\.Status\.Refused /)
assert.equal(find(win, '[data-campaign-state-label="camp-b"]').textContent, 'SENDINGSTONE.Config.State.warning')
assert.equal(find(win, '[name="campaign.title"]').value, 'typed but not saved')
assert.equal(win.renders, renders)
assert.ok([...statusOf().children].every(span => span.children.length === 0), 'text only')
// The context says the same, for a saved campaign only.
const context = await win._prepareContext()
assert.deepEqual(context.nav.campaigns.map(c => [c.state, c.lines.map(line => line.state)]),
  [['warning', ['ok', 'warning', 'ok']], ['warning', ['ok', 'warning']], ['new', []]])
assert.deepEqual(context.campaign.status.map(line => line.state), ['ok', 'warning', 'ok'])
await win.close()
stale()
await beat()
assert.deepEqual(shown(), [], 'not after close')
assert.equal(dot('camp-a').dataset.state, 'stale')
// Not the bridge: only whose browser is.
const other = user('gandalf', 'Gandalf', true)
gm.isActiveGM = false
users.activeGM = other
assert.deepEqual(status.campaignStatus(campaign('camp-a')), [{ state: 'idle', text: 'SENDINGSTONE.Status.OtherBrowser {"name":"Gandalf"}' }])
const elsewhere = await openSettings()
await view(elsewhere, 'campaign', { campaignId: 'camp-a', tab: 'connection' })
assert.deepEqual([...find(elsewhere, '[data-campaign-status="camp-a"]').children].map(span => `${span.dataset.state} ${span.textContent.split(' ')[0]}`), ['idle SENDINGSTONE.Status.OtherBrowser'])
assert.equal(find(elsewhere, 'nav.sending-stone-nav [data-campaign-state="camp-a"]').dataset.state, 'idle')
await elsewhere.close()
gm.isActiveGM = true
users.activeGM = gm
const again = await openSettings()
assert.deepEqual((await again._prepareContext()).nav.campaigns.map(c => c.lines.length), [3, 2])
await again.close()
told()
ok('H11: each saved campaign\'s lines: Delivered, Failing, Refused, the rolls lines (H1-H10); STATUS_HOOK rewrites the open campaign\'s [data-campaign-status] as text, and every saved campaign\'s dot, without drawing the window again or touching what is typed, and not after it closes; another Gamemaster\'s browser says only whose sends')

// ---- H13: a sheet withheld as too large, until it's posted in full ----
from = app.events.length
thorin.system.details.appearance = 'y'.repeat(1_050_000)
sendCharacter('thorin')
await until(() => app.events.slice(from).some(e => e.body.type === 'character.updated'), "Thorin's post")
await quiet()
const withheld = app.events.slice(from).find(e => e.body.type === 'character.updated').body.data.character
assert.equal(withheld.sheet, null)
assert.equal(withheld.sheetWithheld.reason, 'tooLarge')
assert.deepEqual(lines('camp-a').filter(line => line.includes('Withheld')), ['warning SENDINGSTONE.Status.Withheld'])
assert.match(status.campaignStatus(campaign('camp-a')).find(line => line.text.includes('Withheld')).text, /"name":"Thorin","size":"1\.1 MB","limit":"1\.0 MB"/)
assert.deepEqual(warned(told()).map(text => text.split(' ')[0]), ['SENDINGSTONE.Notify.SheetTooLargeUntold'], 'the notice as before')
thorin.system.details.appearance = ''
sendCharacter('thorin')
await quiet()
assert.ok(app.events.at(-1).body.data.character.sheet, 'posted in full')
assert.deepEqual(lines('camp-a').filter(line => line.includes('Withheld')), [])
// Withheld again, and the campaign's hello delivered: none, until a sheet is withheld again. Thorin
// is taken out of the campaign, so that no sheet of his follows the hello.
thorin.system.details.appearance = 'y'.repeat(1_050_000)
sendCharacter('thorin')
await quiet()
assert.equal(lines('camp-a').filter(line => line.includes('Withheld')).length, 1)
const campaigns = settings.get('campaigns')
settings.set('campaigns', campaigns.map(c => (c.id === 'camp-a' ? { ...c, characters: [] } : c)))
from = app.events.length
announce({ campaignId: 'camp-a' })
await until(() => app.events.slice(from).some(e => e.body.type === 'bridge.hello'), 'the hello')
await quiet()
assert.ok(!app.events.slice(from).some(e => e.body.type === 'character.updated'))
assert.deepEqual(lines('camp-a').filter(line => line.includes('Withheld')), [])
settings.set('campaigns', campaigns)
thorin.system.details.appearance = ''
ok('H13: a sheet withheld shows Status.Withheld ("1.1 MB", "1.0 MB") beside the notice as before, until the sheet is posted in full or the campaign\'s hello is delivered')

// ---- H14: one campaign failing for the app's address while the other's posts get through ----
// a) Every Mirkwood post unanswered for 25 minutes, Erebor's delivered: told once, and never that
// the app is reached again while Mirkwood's posts aren't; Erebor's status stays Delivered.
advance(700_000)
told()
const mirkwoodDown = when(e => !e.commands && (e.body.campaign?.id === 'camp-b'), () => new TypeError('Failed to fetch'))
list = []
const ereborShown = new Set()
for (let i = 0; i < 50; i++) {
  await beat()
  list.push(...told())
  ereborShown.add(lines('camp-a')[0])
}
assert.equal(warned(list).length, 1, warned(list).join('\n'))
assert.match(warned(list)[0], /^SENDINGSTONE\.Notify\.Problem \{"problem":"SENDINGSTONE\.Problem\.unreachable /)
assert.deepEqual(informed(list), [], 'before: Reconnected after each warning, and a warning again every 10 minutes')
assert.deepEqual([...ereborShown], ['ok SENDINGSTONE.Status.Delivered'])
assert.deepEqual(lines('camp-b'), ['error SENDINGSTONE.Status.Failing', 'warning SENDINGSTONE.Status.Refused'])
// Mirkwood reached again: told so, once, within the heartbeat.
drop(mirkwoodDown)
await beat()
assert.deepEqual([warned(list = told()), informed(list)], [[], ['SENDINGSTONE.Notify.Reconnected']])
assert.equal(lines('camp-b')[0], 'ok SENDINGSTONE.Status.Delivered')
ok('H14: Erebor delivered while every Mirkwood post goes unanswered for 25 minutes: 1 warning, Problem.unreachable, 0 info, Erebor shown Delivered throughout and Mirkwood Failing; Mirkwood answered again: 1 Reconnected')

// b) Only Mirkwood's hello refused, by a page saying nothing of the campaign, while its heartbeats
// get through and ask for the hello again: told once, and that the app is reached once, not both
// again every 10 minutes as the hello keeps failing between heartbeats that get through.
advance(700_000)
const forbidden = when(e => !e.commands && (e.body.campaign?.id === 'camp-b') && (e.body.type === 'bridge.hello'), text(403, 'text/html', '<html><body>Forbidden</body></html>'))
const askAgain = when(e => !e.commands && (e.body.campaign?.id === 'camp-b') && (e.body.type === 'bridge.heartbeat'), json(200, { resend: 'hello', features: { commands: true } }))
from = events(of('camp-b', 'bridge.hello')).length
list = []
for (let i = 0; i < 50; i++) {
  await beat()
  list.push(...told())
}
assert.ok(events(of('camp-b', 'bridge.hello')).length - from >= 40, 'the hello asked for and refused again and again')
assert.deepEqual(warned(list).map(text => /Problem\.(\w+)/.exec(text)[1]), ['status'], warned(list).join('\n'))
assert.deepEqual(informed(list), ['SENDINGSTONE.Notify.Reconnected'])
assert.equal(lines('camp-a')[0], 'ok SENDINGSTONE.Status.Delivered')
drop(forbidden)
drop(askAgain)
await beat()
await beat()
assert.deepEqual(told(), [])
ok('H14: only Mirkwood\'s hello refused (403, HTML) for 25 minutes, its heartbeats delivered: 1 warning and 1 Reconnected, not again every 10 minutes')

// ---- H15: the rest of what is told and shown ----
advance(700_000)
// A post that can't be written as JSON: malformed, with why, and never fetched.
from = app.events.length
transport.send('combat.updated', { combat: { id: 'c2', round: 1n } }, campaign('camp-a'))
await quiet()
assert.equal(app.events.length, from)
assert.match(warned(told())[0], /^SENDINGSTONE\.Notify\.Problem \{"problem":"SENDINGSTONE\.Problem\.malformed .*\\"detail\\":\\": Do not know how to serialize a BigInt\\"/)
// An event refused is told once a page load, ten minutes on or not.
rule = when(e => e.body.type === 'chat.message.created', json(413, { reason: 'tooLarge', message: 'Larger', limit: 4_000_000 }))
chat('a3', 'camp-a')
await quiet()
drop(rule)
assert.deepEqual(told(), [], 'Erebor\'s chat refused as too large was told in H4')
// A Forge game, on https, sending to an address on http: the browser blocks it, and says so.
const unreachable = { reason: 'unreachable', status: null }
globalThis.location = { protocol: 'https:', origin: 'https://lonely-mountain.forge-vtt.com' }
assert.match(status.describeProblem(unreachable, { destination: 'http://stone.example' }).fix, /^SENDINGSTONE\.Test\.HintMixedContent/)
assert.match(status.describeProblem(unreachable, { destination: 'https://stone.example' }).fix, /^SENDINGSTONE\.Fix\.unreachable /)
delete globalThis.location
assert.match(status.describeProblem(unreachable, { destination: 'http://stone.example' }).fix, /^SENDINGSTONE\.Fix\.unreachable /)
ok('H15: a post JSON can\'t write is Problem.malformed with why, never fetched; an event refused is told once a page load, even 10 minutes on; mixed content has Test.HintMixedContent for its fix')

// The latest failure shown: the app's address, then the campaign.
rule = when(e => !e.commands && (e.body.campaign?.id === 'camp-b'), json(503, { reason: 'unavailable', message: 'Sending Stone couldn’t take this just now' }))
await beat()
assert.match(status.campaignStatus(campaign('camp-b'))[0].text, /Status\.Failing .*Problem\.unavailable/)
drop(rule)
rule = when(e => !e.commands && (e.body.campaign?.id === 'camp-b'), json(404, NOT_SET_UP))
await beat()
assert.match(status.campaignStatus(campaign('camp-b'))[0].text, /Status\.Failing .*Problem\.notSetUp/)
drop(rule)
await beat()
told()
// A cause that changes while the connection fails is told too: the app unreachable, then failing.
advance(700_000)
rule = when(e => !e.commands && (e.body.campaign?.id === 'camp-b'), () => new TypeError('Failed to fetch'))
await beat()
drop(rule)
rule = when(e => !e.commands && (e.body.campaign?.id === 'camp-b'), json(503, { reason: 'unavailable', message: 'Sending Stone couldn’t take this just now' }))
await beat()
drop(rule)
assert.deepEqual(warned(told()).map(text => /Problem\.(\w+)/.exec(text)[1]), ['unreachable', 'unavailable'])
await beat()
assert.deepEqual(informed(told()), ['SENDINGSTONE.Notify.Reconnected'])
// And for players' rolls: three failures in a row told, then a fourth for another reason.
const zirak = { id: 'camp-z', title: 'Zirak' }
for (const failures of [1, 2, 3]) status.noteFetchFailed(zirak, { reason: 'rateLimited', status: 429 }, { failures })
status.noteFetchFailed(zirak, { reason: 'timeout', status: null }, { failures: 4 })
status.noteFetchFailed(zirak, { reason: 'timeout', status: null }, { failures: 5 })
assert.deepEqual(warned(told()).map(text => /^SENDINGSTONE\.Notify\.(\w+) .*Problem\.(\w+)/.exec(text).slice(1).join(' ')), ['RollsFailing rateLimited', 'RollsFailing timeout'])
status.noteFetched('camp-z')
told()
ok('H15: the latest failure is shown, the app\'s address\'s or the campaign\'s; a cause that changes while failing is told, for events and for rolls')

// A status line with markup in it shows it as text.
const watching = await openSettings()
await view(watching, 'campaign', { campaignId: 'camp-a', tab: 'connection' })
rule = when(e => e.body.type === 'chat.cleared', json(400, { reason: 'malformed', message: 'Malformed chat.cleared', type: 'chat.cleared', detail: '<b>x</b>' }))
transport.send('chat.cleared', {}, campaign('camp-a'))
await quiet()
drop(rule)
const spans = [...watching.element.querySelectorAll('[data-campaign-status] span')]
const markup = spans.find(span => span.textContent.includes('Status.Refused'))
assert.ok(markup?.textContent.includes('\\": <b>x</b>\\"'), spans.map(span => span.textContent).join('\n'))
assert.ok(spans.every(span => span.children.length === 0))
const markedDot = find(watching, 'nav.sending-stone-nav [data-campaign-state="camp-a"]')
assert.ok(markedDot.dataset.tooltip.includes('\\": <b>x</b>\\"') && (markedDot.children.length === 0))
await watching.close()
told()
ok('H15: a status line whose detail has markup shows it as text')

// Players' rolls: a fetch cut short after 35 seconds is timeout, and fetching goes on; a 401 with
// the secret saved is the wrong secret.
advance(700_000)
const aborted = when(e => e.commands, () => Object.assign(new Error('signal is aborted without reason'), { name: 'AbortError' }), 3)
syncPollers({ retry: true })
await until(() => aborted.times === 0, 'three fetches cut short')
polls = app.polls.length
await until(() => app.polls.length > polls + 1, 'fetching again')
await quiet()
list = told()
assert.deepEqual(warned(list).map(text => /^SENDINGSTONE\.Notify\.(\w+) .*Problem\.(\w+)/.exec(text).slice(1).join(' ')), ['RollsFailing timeout'])
assert.deepEqual(informed(list).map(text => text.split(' ')[0]), ['SENDINGSTONE.Notify.RollsRecovered'])
drop(aborted)
const refused401 = when(e => e.commands, empty(401), 1)
await until(() => refused401.times === 0, 'the fetch refused')
await quiet()
assert.deepEqual(warned(told()).map(text => /^SENDINGSTONE\.Notify\.(\w+) .*Problem\.(\w+)/.exec(text).slice(1).join(' ')), ['RollsStopped wrongSecret'])
drop(refused401)
ok('H15: a fetch of rolls cut short is Problem.timeout and fetching goes on; one refused 401 with the secret saved is wrongSecret, and stops')

// ---- H16: the last refusal goes once the same kind of post gets through (module 0.25.0) ----
// At once, the settings window told; for a sheet, once that character's does. The notice told
// isn't told again.
advance(700_000)
told()
const refusedLine = id => status.campaignStatus(campaign(id)).find(line => line.text.startsWith('SENDINGSTONE.Status.Refused '))?.text ?? null
const seen = []
Hooks.on('sendingStone.status', () => seen.push(refusedLine('camp-a')))
// a) Vex plays in Erebor too. Thorin's sheet refused as too large; Vex's getting through leaves it;
// Thorin's next clears it.
const before = settings.get('campaigns')
settings.set('campaigns', before.map(c => (c.id === 'camp-a' ? { ...c, characters: ['thorin', 'vex'] } : c)))
const vex = game.actors.get('vex')
const sheetOf = (id, campaignId = 'camp-a') => e => (e.type === 'character.updated') && (e.campaign.id === campaignId) && (e.data.character.id === id)
const sent = async (test, what) => {
  const from = app.events.length
  await until(() => app.events.slice(from).some(e => test(e.body)), what)
  await quiet()
}
vex.img = 'vex-erebor.webp'
let waiting = sent(sheetOf('vex'), "Vex's sheet in Erebor")
sendCharacter('vex')
await waiting
rule = when(e => !e.commands && sheetOf('thorin')(e.body), json(413, { reason: 'tooLarge', message: 'Larger than the 4000000 bytes Sending Stone takes', limit: 4_000_000 }))
thorin.system.attributes.hp.value = 29
waiting = sent(sheetOf('thorin'), "Thorin's sheet refused")
sendCharacter('thorin')
await waiting
drop(rule)
assert.match(refusedLine('camp-a'), /^SENDINGSTONE\.Status\.Refused .*Problem\.tooLarge .*What\.Sheet/)
assert.deepEqual(warned(told()).map(text => /Problem\.(\w+)/.exec(text)[1]), ['tooLarge'])
vex.img = 'vex-again.webp'
waiting = sent(sheetOf('vex'), "Vex's next sheet")
sendCharacter('vex')
await waiting
assert.match(refusedLine('camp-a') ?? '', /Problem\.tooLarge .*What\.Sheet/, "Vex's sheet leaves Thorin's refusal")
seen.length = 0
thorin.system.attributes.hp.value = 28
waiting = sent(sheetOf('thorin'), "Thorin's next sheet")
sendCharacter('thorin')
await waiting
assert.equal(refusedLine('camp-a'), null)
assert.equal(seen.at(-1), null, 'the window told at once')
ok('H16: Thorin\'s sheet refused as too large shows Last refused; Vex\'s sheet in the same campaign getting through leaves it; Thorin\'s next getting through clears it, the window told at once')

// b) A chat message refused as malformed: a message updated getting through leaves it, and so does
// another campaign's message created; the next message created for it clears it. Refused again,
// the line is back, and the notice isn't told again.
rule = when(e => !e.commands && (e.body.type === 'chat.message.created') && (e.body.data.message.id === 'bad'), json(400, { reason: 'malformed', message: 'Malformed chat.message.created', type: 'chat.message.created', detail: 'x' }))
chat('bad', 'camp-a')
await quiet()
assert.match(refusedLine('camp-a'), /Problem\.malformed /)
assert.equal(warned(told()).length, 1)
transport.send('chat.message.updated', { changes: ['content'], message: { id: 'm9', content: '' } }, campaign('camp-a'))
await quiet()
assert.match(refusedLine('camp-a') ?? '', /Problem\.malformed /, 'another type leaves it')
chat('other', 'camp-b')
await quiet()
assert.match(refusedLine('camp-a') ?? '', /Problem\.malformed /, "another campaign's chat message leaves it")
chat('good', 'camp-a')
await quiet()
assert.equal(refusedLine('camp-a'), null)
chat('bad', 'camp-a')
await quiet()
drop(rule)
assert.match(refusedLine('camp-a'), /Problem\.malformed /)
assert.deepEqual(told(), [], 'told once a page load')
chat('fine', 'camp-a')
await quiet()
assert.equal(refusedLine('camp-a'), null)
ok('H16: a chat message refused as malformed shows Last refused until the campaign\'s next chat message created gets through, not a message updated nor another campaign\'s message; refused again, it shows again, untold')

// c) Mirkwood's hello refused as too large: Erebor's hello leaves it; its own next hello clears it.
rule = when(e => !e.commands && (e.body.type === 'bridge.hello') && (e.body.campaign.id === 'camp-b'), json(413, { reason: 'tooLarge', message: 'Larger', limit: 4_000_000 }))
waiting = sent(e => (e.type === 'bridge.hello') && (e.campaign.id === 'camp-b'), "Mirkwood's hello refused")
announce({ campaignId: 'camp-b' })
await waiting
drop(rule)
assert.match(refusedLine('camp-b'), /Problem\.tooLarge .*What\.Hello/)
told()
waiting = sent(e => (e.type === 'bridge.hello') && (e.campaign.id === 'camp-a'), "Erebor's hello")
announce({ campaignId: 'camp-a' })
await waiting
assert.match(refusedLine('camp-b') ?? '', /Problem\.tooLarge .*What\.Hello/, "Erebor's hello leaves Mirkwood's")
waiting = sent(e => (e.type === 'bridge.hello') && (e.campaign.id === 'camp-b'), "Mirkwood's next hello")
announce({ campaignId: 'camp-b' })
await waiting
assert.equal(refusedLine('camp-b'), null)
settings.set('campaigns', before)
ok('H16: Mirkwood\'s hello refused as too large shows Last refused until its next hello gets through, Erebor\'s leaving it')

stopPollers()
console.log('\nall error checks passed')
process.exit(0)
