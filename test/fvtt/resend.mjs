import assert from 'node:assert/strict'
import { actor, combat, combatant, message, settle, settings, user, users } from './stub.mjs'

const MODULE = process.env.MODULE_DIR
const ok = msg => console.log('ok -', msg)
let now = Date.parse('2026-10-05T20:00:00Z')
Date.now = () => now

// The listener's answers: JSON asking for a hello for the campaigns named here.
const asking = new Set()
const sent = []
globalThis.fetch = async (url, init) => {
  const envelope = JSON.parse(init.body)
  sent.push(envelope)
  const wants = envelope.campaign && asking.has(envelope.campaign.id) && envelope.type !== 'bridge.hello'
  return wants
    ? { ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }), json: async () => ({ resend: 'hello' }) }
    : { ok: true, status: 204, statusText: 'No Content', headers: new Headers() }
}
const take = () => sent.splice(0).map(e => `${e.type} ${e.campaign?.title ?? '-'}`)

users.activeGM = user('gm', 'Gamemaster', true)
user('alice', 'Alice'); user('bob', 'Bob')
const thorin = actor('thorin', 'Thorin', ['alice'])
const vex = actor('vex', 'Vex', ['bob'])
const goblin = actor('goblin', 'Goblin', [], 'npc')
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('chatEvents', true)
settings.set('combatEvents', true)
settings.set('campaigns', [
  { id: 'camp-a', title: 'Ashlands', characters: ['thorin'] },
  { id: 'camp-b', title: 'Mirkwood', characters: ['vex'] },
])
await Hooks.callAll('ready')
await settle()
assert.deepEqual(take(), ['bridge.hello Ashlands', 'bridge.hello Mirkwood', 'character.updated Ashlands', 'character.updated Mirkwood'])

// Mirkwood is told about a fight before Ashlands is set up with the listener.
const fight = combat('cmbt1')
combatant(fight, 'c-gob', goblin, { initiative: 12 })
await Hooks.callAll('createCombatant', combatant(fight, 'c-vex', vex, { initiative: 15 }))
await settle()
assert.deepEqual(take(), ['combat.created Mirkwood'])

// The listener now asks for Ashlands' state in its answers.
asking.add('camp-a')
await Hooks.callAll('createChatMessage', message('m1', { whisper: ['alice'] }))
await settle(); await settle()
assert.deepEqual(take(), ['chat.message.created Ashlands', 'bridge.hello Ashlands', 'character.updated Ashlands'])
ok("asked in an answer, the module resends that campaign's hello, and only that campaign's, its sheets after it")

await Hooks.callAll('createChatMessage', message('m2', { whisper: ['alice'] }))
await settle(); await settle()
assert.deepEqual(take(), ['chat.message.created Ashlands'])
ok('asked again within 30 seconds, it waits rather than sending another')

now += 30_000
await Hooks.callAll('createChatMessage', message('m3', { whisper: ['alice'] }))
await settle(); await settle()
assert.deepEqual(take(), ['chat.message.created Ashlands', 'bridge.hello Ashlands', 'character.updated Ashlands'])
ok('still asked 30 seconds later, it resends again')

asking.clear()
now += 60_000
await Hooks.callAll('createChatMessage', message('m4', { whisper: ['alice'] }))
await settle(); await settle()
assert.deepEqual(take(), ['chat.message.created Ashlands'])
ok('a plain answer asks for nothing')

// Resending Ashlands' state left what Mirkwood was told alone: Thorin joining Mirkwood's fight
// brings it to Ashlands, and Mirkwood hears of a new combatant, not a new combat.
await Hooks.callAll('createCombatant', combatant(fight, 'c-thorin', thorin, { initiative: 17 }))
await settle()
assert.deepEqual(take().sort(), ['combat.combatant.added Mirkwood', 'combat.created Ashlands'])
ok("resending one campaign's state leaves what the others were told")

// An answer that isn't JSON, or isn't valid JSON, asks for nothing.
globalThis.fetch = async (url, init) => {
  sent.push(JSON.parse(init.body))
  return { ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => { throw new SyntaxError('bad') } }
}
now += 60_000
await Hooks.callAll('createChatMessage', message('m5', { whisper: ['alice'] }))
await settle(); await settle()
assert.deepEqual(take(), ['chat.message.created Ashlands'])
ok('an unreadable answer asks for nothing')
