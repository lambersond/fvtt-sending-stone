import assert from 'node:assert/strict'
import { actor, message, posts, settle, settings, user, users } from './stub.mjs'

const MODULE = process.env.MODULE_DIR
const ok = msg => console.log('ok -', msg)
const take = () => posts.splice(0).map(p => p.envelope)
let now = Date.parse('2026-10-04T20:00:00Z')
Date.now = () => now
const advance = ms => { now += ms }

const gm = user('gm', 'Gamemaster', true)
users.activeGM = gm
user('alice', 'Alice'); user('bob', 'Bob')
actor('thorin', 'Thorin', ['alice']); actor('vex', 'Vex', ['bob'])

await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('chatEvents', true)
settings.set('campaigns', [
  { id: 'camp-a', title: 'Erebor', characters: ['thorin'] },
  { id: 'camp-b', title: 'Mirkwood', characters: ['vex'] },
])
const realSetInterval = globalThis.setInterval
const intervals = []
globalThis.setInterval = (fn, ms) => { intervals.push(ms); return 1 }
await Hooks.callAll('ready')
await settle()
globalThis.setInterval = realSetInterval
assert.deepEqual(intervals, [10_000])
ok('ready starts one check every 10 seconds')
// Each hello, then once it's answered each of its characters in a post of its own.
let hellos = take()
assert.deepEqual(hellos.map(e => `${e.type} ${e.campaign.title}`), ['bridge.hello Erebor', 'bridge.hello Mirkwood', 'character.updated Erebor', 'character.updated Mirkwood'])
assert.deepEqual(hellos.map(e => e.sequence), [1, 1, 2, 2])
ok("each hello is followed by its characters' sheets, which continue its sequence")

const { heartbeat } = await import(`${MODULE}/scripts/heartbeat.mjs`)
heartbeat(); await settle()
assert.deepEqual(take(), [])
ok('no heartbeat to a campaign just sent its hello')

advance(29_000)
heartbeat(); await settle()
assert.deepEqual(take(), [])
advance(1_000)
heartbeat(); await settle()
let out = take()
assert.deepEqual(out.map(e => `${e.type} ${e.campaign.title} ${e.sequence}`).sort(), ['bridge.heartbeat Erebor null', 'bridge.heartbeat Mirkwood null'])
assert.ok(out.every(e => e.protocol === 2 && JSON.stringify(e.data) === '{}'))
ok('after 30 seconds of quiet, each campaign gets an unsequenced heartbeat')

advance(30_000)
await Hooks.callAll('createChatMessage', message('m1', { whisper: ['alice'] }))
await settle()
assert.deepEqual(take().map(e => `${e.type} ${e.campaign.title} ${e.sequence}`), ['chat.message.created Erebor 3'])
ok('the heartbeat left no gap: the next event continues the sequence')
heartbeat(); await settle()
assert.deepEqual(take().map(e => `${e.type} ${e.campaign.title}`), ['bridge.heartbeat Mirkwood'])
ok('a campaign just sent an event is skipped; the quiet one gets a heartbeat')

advance(60_000)
users.activeGM = undefined; gm.isActiveGM = false
heartbeat(); await settle()
assert.deepEqual(take(), [])
ok('a client that is not the bridge sends nothing')
gm.isActiveGM = true; users.activeGM = gm
settings.set('listenerUrl', '')
heartbeat(); await settle()
assert.deepEqual(take(), [])
ok('nothing is sent with no destination')
