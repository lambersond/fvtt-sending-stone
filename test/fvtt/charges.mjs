// Spending charges and Heroic Inspiration from the app (module 0.29.0): the sheet's counters, which
// it says may be spent, and what each use spends; the spend and inspiration commands, their
// refusals, the line each posts in chat, and the Gamemaster's, marked theirs; and since 0.42.1 the
// spellSlot command, one of the character's spell slots spent or restored. The real module and
// its language file, dnd5e 5.3.3's real dice classes, dnd5e's items and activities ported
// (activity5e.mjs), a stand-in Foundry core and app. Under X=1 the attack self-test fails, as this
// world has no damage rolls; under MIDI=1 it passes, Midi-QOL makes items' uses, and the Gamemaster
// has turned its integration off: either way players may not attack here now, and still spend
// their charges, which need neither. Run with --import ./unref-timers.mjs --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { settings, user, actors } from './stub.mjs'

const MODULE = process.env.MODULE_DIR
import { DND5E5 } from './paths.mjs'
const DND5E = `${DND5E5}/module/dice`
const MIDI = Boolean(process.env.MIDI)
const ok = message => console.log('ok -', message)

const registry = new Map()
globalThis.Hooks = {
  on(name, fn) { if (!registry.has(name)) registry.set(name, []); registry.get(name).push(fn); return fn },
  once(name, fn) {
    const once = (...args) => { this.off(name, once); return fn(...args) }
    return this.on(name, once)
  },
  off(name, fn) { registry.set(name, (registry.get(name) ?? []).filter(f => f !== fn)) },
  call(name, ...args) {
    for (const fn of registry.get(name) ?? []) if (fn(...args) === false) return false
    return true
  },
  callAll(name, ...args) { return Promise.all((registry.get(name) ?? []).map(fn => fn(...args))).then(() => true) },
}
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms = 0, ...args) => realSetTimeout(fn, ms >= 1000 ? ms / 100 : ms, ...args)
globalThis.document = { hidden: false }

const { messages } = await import('./dice-core.mjs')
const { default: BasicDie } = await import(`${DND5E}/basic-die.mjs`)
const { default: BasicRoll } = await import(`${DND5E}/basic-roll.mjs`)
const { default: D20Die } = await import(`${DND5E}/d20-die.mjs`)
const { default: D20Roll } = await import(`${DND5E}/d20-roll.mjs`)
Object.assign(CONFIG.Dice, { BasicDie, BasicRoll, D20Die, D20Roll })
// Under MIDI=1 only, damage rolls, which the attack self-test needs.
if (MIDI) CONFIG.Dice.DamageRoll = (await import(`${DND5E}/damage-roll.mjs`)).default
CONFIG.Dice.terms.d = BasicDie
CONFIG.DND5E = {
  skills: { prc: { label: 'Perception', ability: 'wis' } },
  tools: {},
  abilities: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(key => [key, { label: key.toUpperCase() }])),
  defaultAbilities: { initiative: 'dex' },
  spellcasting: { spell: { exclusive: { spells: false, slots: false } }, pact: { exclusive: { spells: false, slots: false } } },
  damageTypes: { fire: { label: 'Fire' } },
  healingTypes: { healing: { label: 'Healing' } },
}
settings.set('messageMode', 'public')
settings.set('criticalDamageModifiers', false)
settings.set('criticalDamageMaxDice', false)

// The module's own words, from its language file, as Foundry's i18n gives them.
const flat = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) => (typeof value === 'object')
  ? flat(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]])
const words = Object.fromEntries(flat(JSON.parse(readFileSync(`${MODULE}/lang/en.json`, 'utf8'))))
game.i18n.localize = key => words[key] ?? key
game.i18n.has = key => Object.hasOwn(words, key)
game.i18n.format = (key, data = {}) => (words[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(data[name] ?? ''))
// Foundry's escapeHTML (common/utils/helpers.mjs).
foundry.utils.escapeHTML = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[ch])

const { Actor5e } = await import('./actor5e.mjs')
const { AttackActivity, SaveActivity, DamageActivity, HealActivity, equip } = await import('./activity5e.mjs')
const { installMidi } = await import('./midi-fake.mjs')
globalThis.dnd5e = { settings: { rulesVersion: 'modern' }, documents: { activity: { AttackActivity, SaveActivity, DamageActivity, HealActivity } } }
globalThis.Item = { implementation: class { constructor(data) { Object.assign(this, data); this.system ??= {} } } }

// ---- The world ----
const users = game.users
users.activeGM = user('gm', 'Gamemaster', true)
users.get('gm').targets = new Set()
const alice = user('alice', 'Alice')
user('bob', 'Bob')
if (MIDI) installMidi()
const add = actor => { actors.set(actor.id, actor); return actor }
const feat = (id, name, activities, system = {}) => ({ id, name, type: 'feat', system: { properties: [], ...system }, activities })
const utility = (id, fields = {}) => ({ id, type: 'utility', affects: 'self', range: 'self', ...fields })
const thorin = add(new Actor5e({ id: 'thorin', name: 'Thorin', owners: ['alice'], mods: { cha: 3 } }))
alice.character = thorin
equip(thorin, {
  items: [
    // Sorcery Points, with Font of Magic spending its own, and Quickened Spell spending them.
    feat('sorcery', 'Sorcery Points', [utility('font', { name: 'Font of Magic', consumption: [{ type: 'itemUses', value: 2 }] })],
      { uses: { max: 20, spent: 12, recovery: [{ period: 'lr' }] } }),
    feat('quicken', 'Quickened Spell', [utility('quick', { consumption: [{ type: 'itemUses', target: 'sorcery', value: 2 }] })]),
    // Lucky: three, spent less than none, as after its maximum dropped, so that what dnd5e leaves
    // is its maximum, not that less what's spent; its reroll spends a formula's worth.
    feat('luck', 'Lucky', [utility('reroll', { consumption: [{ type: 'itemUses', value: '1d4' }] })],
      { uses: { max: 3, spent: -1, recovery: [] } }),
    // A legacy whose powers have uses of their own: one hidden from players.
    feat('legacy', 'Fiendish Legacy', [
      utility('dark', { name: 'Darkness', uses: { max: 2, spent: 0, recovery: [] }, consumption: [{ type: 'activityUses', value: 1 }] }),
      utility('rebuke', { name: 'Rebuke', uses: { max: 1, spent: 1, recovery: [] }, activation: { type: 'reaction', value: 1 } }),
      utility('veiled', { name: 'Veiled', canUse: false, uses: { max: 1, spent: 0, recovery: [] } }),
    ]),
    // A maneuver spending a superiority die, and a charge of a ring not yet identified.
    feat('maneuver', 'Trip Attack', [utility('trip', { consumption: [
      { type: 'attribute', target: 'resources.primary.value', value: 1 }, { type: 'itemUses', target: 'ring', value: 1 },
    ] })]),
    // The ring, the potion and the spell each have an activity with uses of its own too, which are
    // no more to spend directly than their item's.
    { id: 'ring', name: 'Ring of Mystery', type: 'equipment', system: { identified: false, unidentified: { name: 'Ring' }, uses: { max: 3, spent: 0, recovery: [] } },
      activities: [utility('glow', { name: 'Glow', uses: { max: 2, spent: 0, recovery: [] } })] },
    { id: 'potion', name: 'Potion of Healing', type: 'consumable', system: { quantity: 2, uses: { max: 1, spent: 0, autoDestroy: true, recovery: [] } },
      activities: [{ id: 'quaff', uses: { max: 1, spent: 0, recovery: [] }, type: 'heal', affects: 'self', range: 'self', healing: { number: 2, denomination: 4, bonus: '2', types: ['healing'] } }] },
    { id: 'beads', name: 'Bead <b>of</b> Force & Fire', type: 'consumable', system: { quantity: 1, uses: { max: 5, spent: 0, autoDestroy: false, recovery: [] } } },
    { id: 'hellish', name: 'Hellish Rebuke', type: 'spell', system: { level: 1, method: 'innate', properties: [], uses: { max: 1, spent: 0, recovery: [] } },
      activities: [utility('rebuke-cast', { uses: { max: 1, spent: 0, recovery: [] }, activation: { type: 'reaction', value: 1 } })] },
  ],
})
// uses-field.mjs's prepareData: what's left, between none and the maximum.
Object.defineProperty(thorin.items.get('luck')._source.system.uses, 'value', {
  get() { return Math.clamp(this.max - this.spent, 0, this.max) },
})
thorin.system.resources = {
  primary: { label: 'Superiority Dice', max: 4, value: 3, sr: true },
  secondary: { label: '', max: 2, value: 2 },
  tertiary: { label: 'Ki', max: 0, value: 0 },
}
thorin.system.attributes.inspiration = false
thorin.system.favorites = [{ type: 'activity', id: '.Item.legacy.Activity.dark', sort: 1 }]
// Spell slots as dnd5e prepares them (round 0.42.1 §U.7.1): a 1st-level pool 2/3, a 2nd with none
// left, a 3rd with no slots, a 4th above its maximum (temporary slots), and Pact Magic. The stand-in's
// spellcasting methods build no slot sections, so the spellSlot cases read these, and the order of
// the sheet and the result.
thorin.system.spells = {
  spell1: { value: 2, max: 3, level: 1, label: '1st Level' },
  spell2: { value: 0, max: 2, level: 2, label: '2nd Level' },
  spell3: { value: 0, max: 0, level: 3 },
  spell4: { value: 5, max: 4, level: 4, label: '4th Level' },
  pact: { value: 1, max: 2, level: 3, label: 'Pact Magic' },
}
const stranger = add(new Actor5e({ id: 'stranger', name: 'Stranger', owners: ['bob'] }))
equip(stranger, { items: [feat('grit', 'Grit', [], { uses: { max: 2, spent: 0, recovery: [] } })] })

// What's written, by whom.
const writes = []
for (const item of thorin.items.values()) {
  const { update, updateActivity } = item
  item.update = function (changes) { writes.push(['item', this.id, changes]); return update.call(this, changes) }
  item.updateActivity = function (id, changes) { writes.push(['activity', this.id, id, changes]); return updateActivity.call(this, id, changes) }
}
const actorUpdate = thorin.update
thorin.update = function (changes) { writes.push(['actor', this.id, changes]); return actorUpdate.call(this, changes) }

// ---- The app ----
const app = { events: [], waiting: new Map(), wake: null }
const json = body => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  if (String(url).endsWith('/api/events')) {
    app.events.push(body)
    const announcing = ['bridge.hello', 'bridge.heartbeat'].includes(body.type)
    // An app that takes moves too (module 0.31.0): a campaign that lets its players move things is
    // fetched for while its rolls aren't made here, and the rolls fetched then are refused.
    return announcing ? json({ features: { commands: true, transfers: 1, slimSheets: 1, maxBytes: 4_000_000 } }) : { ok: true, status: 204, statusText: 'No Content', headers: new Headers() }
  }
  if (String(url).endsWith('/api/bridge/commands')) {
    const id = body.campaign.id
    if (!app.waiting.get(id)?.length) {
      await new Promise(resolve => {
        const timer = realSetTimeout(resolve, 30)
        app.wake = () => { clearTimeout(timer); resolve() }
        init.signal?.addEventListener('abort', resolve, { once: true })
      })
    }
    const commands = app.waiting.get(id) ?? []
    app.waiting.set(id, [])
    return json({ commands })
  }
  throw new TypeError(`Unexpected fetch of ${url}`)
}
let ids = 0
async function until(test, what, ms = 4000) {
  const end = Date.now() + ms
  while (!test()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await new Promise(resolve => realSetTimeout(resolve, 5))
  }
}
const resultIndex = id => app.events.findIndex(e => (e.type === 'command.result') && (e.data.id === id))
/** A command as the app sends it, and what came of it: its result, the line it posted, and what was posted before the result. */
async function send(kind, fields = {}) {
  const command = { id: `${kind}-${++ids}`, actorId: 'thorin', kind, mode: 0, explicit: false, extras: [], dice: [], ...fields }
  const from = app.events.length
  const madeBefore = messages.size
  app.waiting.set('camp-a', [...(app.waiting.get('camp-a') ?? []), command])
  app.wake?.()
  await until(() => resultIndex(command.id) >= 0, `the result of ${command.id}`)
  const index = resultIndex(command.id)
  const result = app.events[index].data
  return { command, result, line: [...messages.values()].slice(madeBefore)[0], after: app.events.slice(from, index) }
}
const spend = (counter, count, fields) => send('spend', { counter, count, ...fields })
const refusal = ({ result }) => [result.status, result.reason, result.error]
const usesOf = id => {
  const item = thorin.items.get(id)
  return { value: item.system.uses.value ?? (item.system.uses.max - item.system.uses.spent), spent: item.system.uses.spent }
}

// ---- Start-up ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('chatEvents', true)
settings.set('campaignSecrets', { 'camp-a': 'ashlands-secret' })
if (MIDI) settings.set('midiIntegration', false)
const campaigns = [{ id: 'camp-a', title: 'Ashlands', characters: ['thorin'], rolls: true, attacks: true }]
settings.set('campaigns', campaigns)
await Hooks.callAll('ready')
const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
const { attacksUnavailable } = await import(`${MODULE}/scripts/command-uses.mjs`)
const { characterSheet } = await import(`${MODULE}/scripts/sheet.mjs`)
const { slimSheet } = await import(`${MODULE}/scripts/sheet-slim.mjs`)
await until(() => app.events.some(e => e.type === 'bridge.hello'), 'the hello')
await new Promise(resolve => realSetTimeout(resolve, 60))
assert.equal(diceStatus.ready, true, `self-test: ${diceStatus.error}`)
assert.equal(attacksUnavailable(), MIDI ? 'midi-off' : 'self-test')
const kinds = app.events.filter(e => e.type === 'bridge.hello').at(-1).data.features.rolls.kinds
assert.deepEqual(['attack', 'use', 'endEnchantment'].filter(kind => kinds.includes(kind)), [])
// Changed on purpose (round 0.42.1 §U.7.1): and a spell slot spent or restored, after Heroic Inspiration.
assert.deepEqual(['endConcentration', 'spend', 'inspiration', 'spellSlot'].filter(kind => kinds.includes(kind)), ['endConcentration', 'spend', 'inspiration', 'spellSlot'])
ok(`while players' attacks can't be made here (${MIDI ? "Midi's integration off" : 'the attack self-test failed'}), the hello still offers spending charges and Heroic Inspiration, wherever the Gamemaster lets players attack`)

// ---- The sheet ----
const sheet = characterSheet(thorin)
const rowOf = (list, id) => list.find(row => row.id === id)
const features = sheet.features.flatMap(section => section.features)
const inventory = sheet.inventory.sections.flatMap(section => section.items)
const spells = sheet.spells.flatMap(section => section.spells)
const actions = sheet.actions.flatMap(section => section.actions)
assert.deepEqual(rowOf(features, 'sorcery').uses, { value: 8, max: 20, recovery: null, counter: { item: 'sorcery' }, spendable: true })
assert.deepEqual(rowOf(features, 'luck').uses, { value: 3, max: 3, recovery: null, counter: { item: 'luck' }, spendable: true })
assert.deepEqual(rowOf(inventory, 'potion').uses, { value: 1, max: 1, recovery: null, counter: { item: 'potion' } })
assert.deepEqual(rowOf(inventory, 'beads').uses, { value: 5, max: 5, recovery: null, counter: { item: 'beads' }, spendable: true })
assert.equal(rowOf(inventory, 'ring').uses, null)
assert.deepEqual(rowOf(spells, 'hellish').uses, { value: 1, max: 1, recovery: null, counter: { item: 'hellish' } })
assert.deepEqual(rowOf(actions, 'sorcery').uses, rowOf(features, 'sorcery').uses)
const legacyRow = rowOf(actions, 'legacy')
assert.deepEqual(legacyRow.uses, { value: 2, max: 2, recovery: null, counter: { item: 'legacy', activity: 'dark' }, spendable: true })
assert.deepEqual(rowOf(features, 'legacy').activities.map(entry => [entry.id, entry.uses]), [
  ['dark', { value: 2, max: 2, recovery: null, counter: { item: 'legacy', activity: 'dark' }, spendable: true }],
  ['rebuke', { value: 0, max: 1, recovery: null, counter: { item: 'legacy', activity: 'rebuke' }, spendable: true }],
])
assert.deepEqual(sheet.favorites.map(f => [f.type, f.id, f.uses]), [
  ['resource', 'primary', { value: 3, max: 4, recovery: null, counter: { resource: 'primary' }, spendable: true }],
  ['activity', 'dark', { value: 2, max: 2, recovery: null, counter: { item: 'legacy', activity: 'dark' }, spendable: true }],
])
ok("each count says which counter it is, an item's, an activity's own or a resource's, and that it may be spent: not a spell's, nor an item's used up as it runs out; an item not identified yet says nothing")

const slimActions = slimSheet(sheet).actions.flatMap(section => section.actions)
assert.equal('uses' in rowOf(slimActions, 'sorcery'), false, "the action's uses, its row's, are left to its row")
assert.deepEqual(rowOf(slimActions, 'legacy').uses, legacyRow.uses, "the action's own, its lead activity's, go with it")
ok("slim, an action whose counter is its row's leaves it to the row; one whose count is its activity's keeps it")

const used = (list, id) => rowOf(list, id).activity?.spends
assert.deepEqual(used(features, 'sorcery'), [{ counter: { item: 'sorcery' }, amount: 2 }])
assert.deepEqual(used(features, 'quicken'), [{ counter: { item: 'sorcery' }, amount: 2 }])
assert.deepEqual(used(features, 'luck'), [{ counter: { item: 'luck' }, amount: null }])
assert.deepEqual(rowOf(features, 'legacy').activities.find(entry => entry.id === 'dark').activity.spends, [{ counter: { item: 'legacy', activity: 'dark' }, amount: 1 }])
assert.deepEqual(used(features, 'maneuver'), [{ counter: { resource: 'primary' }, amount: 1 }])
assert.equal('spends' in rowOf(inventory, 'potion').activity, false)
ok("each use says what it spends: its item's uses, another item's, its own, a resource, or a formula's worth; never an item's not identified; nothing where it spends nothing")

// ---- Spending ----
let made = await spend({ item: 'sorcery' }, 2)
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual(made.result, { id: made.command.id, status: 'done', reason: null, error: null, messageId: made.line.id, visible: true, rolls: [] })
assert.deepEqual(writes.at(-1), ['item', 'sorcery', { 'system.uses.spent': 14 }])
assert.equal(usesOf('sorcery').value, 6)
const line = made.line
assert.equal(line.content, '<p>Spends 2 · Sorcery Points</p>')
assert.ok(!/\b6\b|\b20\b/.test(line.content), 'never how many are left')
assert.deepEqual([line.author.id, line.speaker.actor, line.whisper, line.blind, line.flags['sending-stone']], ['alice', 'thorin', [], false, { request: made.command.id }])
const sheetPosted = made.after.findIndex(e => (e.type === 'character.updated') && (e.data.character.id === 'thorin'))
assert.ok(sheetPosted >= 0, 'the sheet goes before the result')
assert.equal(made.after[sheetPosted].data.character.sheet.features.flatMap(s => s.features).find(f => f.id === 'sorcery').uses.value, 6)
ok("spends 2 Sorcery Points as dnd5e's sheet writes it, posts \"Spends 2 · Sorcery Points\" as Thorin's player, for everyone, never what's left; the sheet goes before the result")

made = await spend({ item: 'luck' }, 1)
assert.equal(made.result.status, 'done')
assert.deepEqual(writes.at(-1), ['item', 'luck', { 'system.uses.spent': 1 }], 'its maximum less what it then has left, not what was spent and one more')
made = await spend({ item: 'luck' }, 2)
assert.deepEqual([made.result.status, writes.at(-1)], ['done', ['item', 'luck', { 'system.uses.spent': 3 }]])
made = await spend({ item: 'luck' }, 1)
assert.deepEqual(refusal(made), ['failed', 'short', null])
made = await spend({ item: 'sorcery' }, 7)
assert.deepEqual(refusal(made), ['failed', 'short', null])
made = await spend({ item: 'sorcery' }, 6)
assert.equal(made.result.status, 'done')
assert.equal(usesOf('sorcery').value, 0)
ok('spends as many as are left, and no more: one more than are left is refused as short; what is written is the maximum less what is then left')

const beforeWrites = writes.length
made = await spend({ item: 'legacy', activity: 'dark' }, 1)
assert.equal(made.result.status, 'done')
assert.deepEqual(writes.slice(beforeWrites), [
  ['activity', 'legacy', 'dark', { 'uses.spent': 1 }],
  ['item', 'legacy', { 'system.activities.dark': { uses: { spent: 1 } } }],
])
assert.equal(made.line.content, '<p>Spends 1 · Fiendish Legacy: Darkness</p>')
made = await spend({ resource: 'primary' }, 2)
assert.equal(made.result.status, 'done')
assert.deepEqual(writes.at(-1), ['actor', 'thorin', { 'system.resources.primary.value': 1 }])
assert.equal(made.line.content, '<p>Spends 2 · Superiority Dice</p>')
made = await spend({ item: 'beads' }, 1)
assert.equal(made.line.content, '<p>Spends 1 · Bead &lt;b&gt;of&lt;/b&gt; Force &amp; Fire</p>')
ok("an activity's own uses go through updateActivity, a resource through the actor, each named in its line, a name escaped")

const unchanged = writes.length
for (const [counter, why] of [
  [{ item: 'ring' }, 'an item not identified yet'], [{ item: 'potion' }, 'one used up as it runs out'], [{ item: 'hellish' }, 'a spell'],
  [{ item: 'quicken' }, 'no limited uses'], [{ resource: 'secondary' }, 'an unnamed resource'], [{ resource: 'tertiary' }, 'a resource of no maximum'],
  // An activity's own uses, of an item whose own may not be spent so, may not be either.
  [{ item: 'ring', activity: 'glow' }, 'an activity of an item not identified yet'],
  [{ item: 'potion', activity: 'quaff' }, 'an activity of one used up as it runs out'],
  [{ item: 'hellish', activity: 'rebuke-cast' }, "a spell's activity"],
]) assert.deepEqual(refusal(await spend(counter, 1)), ['failed', 'uses', null], why)
for (const [counter, why] of [
  [{ item: 'gone' }, 'an item not the character\'s'], [{ item: 'legacy', activity: 'gone' }, 'an activity not the item\'s'],
  [{ item: 'legacy', activity: 'veiled' }, 'an activity its player can\'t see'],
]) assert.deepEqual(refusal(await spend(counter, 1)), ['failed', 'item', null], why)
assert.equal(writes.length, unchanged)
ok("refuses what may not be spent so: an unidentified item's, a potion's, a spell's, their activities' own, one without uses, an unnamed or empty resource; and what isn't the character's to see")

for (const [fields, error] of [
  [{ counter: { item: 'sorcery', resource: 'primary' } }, 'counter'],
  [{ counter: { resource: 'quaternary' } }, 'counter'],
  [{ counter: { item: 'sorcery', activity: 'font', extra: 1 } }, 'counter'],
  [{ counter: undefined }, 'counter'],
  [{ item: 'sorcery' }, 'counter'],
  [{ count: 0 }, 'count'], [{ count: 1000 }, 'count'], [{ count: 1.5 }, 'count'], [{ count: '2' }, 'count'],
  [{ mode: 1 }, 'dice'], [{ dice: [{ faces: 20, results: [3] }] }, 'dice'],
  [{ by: 'player' }, 'by'],
]) {
  made = await send('spend', { counter: { item: 'beads' }, count: 1, ...fields })
  assert.deepEqual(refusal(made), ['failed', 'invalid', error], JSON.stringify(fields))
}
made = await spend({ item: 'grit' }, 1, { actorId: 'stranger' })
assert.deepEqual(refusal(made), ['failed', 'unknown', null])
assert.equal(writes.length, unchanged)
ok('refuses a spend that names anything but a counter and how many, from 1 to 999, or throws dice; and one for a character not in the campaign')

// The Gamemaster's, made as Thorin, marked theirs, and listed in their result.
made = await spend({ item: 'beads' }, 1, { by: 'gm' })
assert.equal(made.result.status, 'done')
assert.deepEqual([made.line.author.id, made.line.flags['sending-stone']], ['alice', { request: made.command.id, by: 'gm' }])
assert.deepEqual(made.result.messages, [made.line.id])
ok("the Gamemaster's spend from the app posts its line as Thorin's player's, marked the Gamemaster's, and their result lists it")

// A line that can't be posted: the spend stands.
const create = ChatMessage.implementation.create
ChatMessage.implementation.create = async () => { throw new Error('The chat log is full') }
made = await spend({ item: 'beads' }, 1)
ChatMessage.implementation.create = create
assert.deepEqual([made.result.status, made.result.messageId, made.result.visible, usesOf('beads').value], ['done', null, true, 2])
ok('a line that cannot be posted leaves the spend made, and done, with no message')

// ---- Heroic Inspiration ----
made = await send('inspiration', { inspiration: 'use' })
assert.deepEqual(refusal(made), ['failed', 'not-inspired', null])
made = await send('inspiration', { inspiration: 'gain' })
assert.deepEqual([made.result.status, thorin.system.attributes.inspiration, made.line.content], ['done', true, '<p>Gains Heroic Inspiration</p>'])
assert.deepEqual(writes.at(-1), ['actor', 'thorin', { 'system.attributes.inspiration': true }])
assert.deepEqual(made.result, { id: made.command.id, status: 'done', reason: null, error: null, messageId: made.line.id, visible: true, rolls: [] })
assert.ok(made.after.some(e => (e.type === 'character.updated') && (e.data.character.sheet.inspiration === true)), 'the sheet goes before the result')
made = await send('inspiration', { inspiration: 'gain' })
assert.deepEqual(refusal(made), ['failed', 'inspired', null])
made = await send('inspiration', { inspiration: 'use', by: 'gm' })
assert.deepEqual([made.result.status, thorin.system.attributes.inspiration, made.line.content], ['done', false, '<p>Uses Heroic Inspiration</p>'])
assert.deepEqual([made.line.flags['sending-stone'], made.result.messages], [{ request: made.command.id, by: 'gm' }, [made.line.id]])
for (const [fields, error] of [[{ inspiration: 'maybe' }, 'inspiration'], [{ inspiration: undefined }, 'inspiration'], [{ inspiration: 'gain', item: 'luck' }, 'inspiration'], [{ inspiration: 'gain', explicit: true }, 'dice']]) {
  assert.deepEqual(refusal(await send('inspiration', fields)), ['failed', 'invalid', error], JSON.stringify(fields))
}
ok("uses and gains Heroic Inspiration as dnd5e's header does, each posting its line; refuses using none and gaining it twice; the Gamemaster's marked theirs")

// ---- 0.42.1: spell slots spent and restored ----
// Round 0.42.1 §U.7.1: one of the character's spell slots spent from the app, or one restored, as
// dnd5e's sheet's pips do, made only from the count the app showed, one at a time.
const { announce } = await import(`${MODULE}/scripts/bridge.mjs`)
const slotOf = id => thorin.system.spells[id].value
const pools = () => Object.fromEntries(Object.entries(thorin.system.spells).map(([key, pool]) => [key, pool.value]))
const slotCommand = (op, id, from, fields) => ({ spellSlot: { op, id, from }, ...fields })
const spellSlot = (op, id, from, fields) => send('spellSlot', slotCommand(op, id, from, fields))
/** A spellSlot that's refused, with nothing written, posted or changed: why. */
async function refusedSlot(fields, why) {
  const before = [writes.length, messages.size, pools()]
  const made = await send('spellSlot', fields)
  assert.deepEqual([writes.length, messages.size, pools()], before, `${why}: nothing written, posted or changed`)
  return refusal(made)
}
/** The campaign's hello sent again now: its features. */
async function helloNow() {
  const hellos = () => app.events.filter(e => e.type === 'bridge.hello')
  const sent = hellos().length
  announce({ campaignId: 'camp-a' })
  await until(() => hellos().length > sent, 'the hello')
  await new Promise(resolve => realSetTimeout(resolve, 60))
  return hellos().at(-1).data.features
}

let offered = app.events.filter(e => e.type === 'bridge.hello').at(-1).data.features
assert.equal(offered.rolls.kinds.indexOf('spellSlot'), offered.rolls.kinds.indexOf('inspiration') + 1, 'right after inspiration')
assert.ok(offered.companions.kinds.length && !offered.companions.kinds.includes('spellSlot'), "never among a companion's kinds")
settings.set('campaigns', campaigns.map(campaign => ({ ...campaign, attacks: false })))
offered = await helloNow()
assert.deepEqual(['spend', 'inspiration', 'spellSlot'].filter(kind => offered.rolls.kinds.includes(kind)), [], 'none where players may not attack')
settings.set('campaigns', campaigns)
offered = await helloNow()
assert.ok(offered.rolls.kinds.includes('spellSlot'), 'offered again')
ok("0.42.1: spell slots spent and restored: the hello offers spellSlot right after inspiration wherever players may attack, never among the companions' kinds, and not where they may not")

// A favorite of the 1st-level pool, as the app shows its dots: the stand-in builds no slot sections,
// so this is where the sheet sent ahead of the result shows the count it left.
thorin.system.favorites.push({ type: 'slots', id: 'spell1', sort: 2 })
let slotted = await spellSlot('spend', 'spell1', 2)
assert.equal(slotted.result.status, 'done', JSON.stringify(slotted.result))
assert.deepEqual(writes.at(-1), ['actor', 'thorin', { 'system.spells.spell1.value': 1 }])
assert.equal(slotOf('spell1'), 1)
assert.equal(slotted.line.content, '<p>Spends a spell slot · 1st Level</p>')
assert.deepEqual([slotted.line.author.id, slotted.line.speaker.actor, slotted.line.whisper, slotted.line.blind, slotted.line.flags['sending-stone']],
  ['alice', 'thorin', [], false, { request: slotted.command.id }])
assert.deepEqual(slotted.result, { id: slotted.command.id, status: 'done', reason: null, error: null, messageId: slotted.line.id, visible: true, rolls: [] })
const slotSheet = slotted.after.filter(e => (e.type === 'character.updated') && (e.data.character.id === 'thorin')).at(-1)?.data.character.sheet
assert.equal(slotSheet?.favorites.find(f => f.type === 'slots')?.value, 1, 'the sheet, with what it left, goes before the result')
ok('0.42.1: spends a 1st-level slot from 2 to 1, written to system.spells.spell1.value; "Spends a spell slot · 1st Level" as Thorin, by his player, for everyone, flagged with the request; done with its message and no rolls, the sheet before the result')

slotted = await spellSlot('restore', 'spell1', 1)
assert.deepEqual([slotted.result.status, slotOf('spell1'), slotted.line?.content, writes.at(-1)],
  ['done', 2, '<p>Regains a spell slot · 1st Level</p>', ['actor', 'thorin', { 'system.spells.spell1.value': 2 }]])
ok('0.42.1: restores a 1st-level slot from 1 to 2, "Regains a spell slot · 1st Level"')

slotted = await spellSlot('spend', 'pact', 1)
assert.deepEqual([slotted.result.status, slotOf('pact'), slotted.line?.content], ['done', 0, '<p>Spends a spell slot · Pact Magic</p>'])
slotted = await spellSlot('restore', 'pact', 0)
assert.deepEqual([slotted.result.status, slotOf('pact'), slotted.line?.content], ['done', 1, '<p>Regains a spell slot · Pact Magic</p>'])
ok('0.42.1: Pact Magic spent from 1 to 0 and restored to 1, each line naming Pact Magic')

slotted = await spellSlot('spend', 'spell4', 5)
assert.deepEqual([slotted.result.status, slotOf('spell4'), slotted.line?.content], ['done', 4, '<p>Spends a spell slot · 4th Level</p>'])
assert.deepEqual(await refusedSlot(slotCommand('restore', 'spell4', 4), 'restored at its maximum'), ['failed', 'full', null])
ok('0.42.1: temporary slots: a 4th-level pool at 5 of 4 spent to 4; restored at 4 of 4, "full"')

for (const [op, id, from, reason, why] of [
  ['spend', 'spell1', 3, 'changed', 'spent from 3 where it is 2'],
  ['restore', 'spell1', 0, 'changed', 'restored from 0 where it is 2'],
  ['spend', 'spell2', 0, 'slots', 'spent with none left'],
  ['spend', 'spell3', 0, 'slot', 'a pool with no slots'],
  ['spend', 'spell9', 0, 'slot', 'a pool the character has none of'],
  ['spend', 'constructor', 0, 'slot', 'a key every object has'],
  ['spend', 'toString', 0, 'slot', 'another'],
  ['spend', 'nope', 0, 'slot', 'no pool at all'],
]) assert.deepEqual(await refusedSlot(slotCommand(op, id, from), why), ['failed', reason, null], why)
// A pool only inherited, as a key every object has, never the character's own: refused, slots or not.
Object.setPrototypeOf(thorin.system.spells, { spell6: { value: 1, max: 1, level: 6, label: '6th Level' } })
assert.deepEqual(await refusedSlot(slotCommand('spend', 'spell6', 1), 'an inherited pool'), ['failed', 'slot', null])
Object.setPrototypeOf(thorin.system.spells, Object.prototype)
slotted = await spellSlot('restore', 'spell1', 2)
assert.deepEqual([slotted.result.status, slotOf('spell1')], ['done', 3])
assert.deepEqual(await refusedSlot(slotCommand('restore', 'spell1', 3), 'restored with none used'), ['failed', 'full', null])
const valid = { op: 'spend', id: 'spell1', from: 3 }
for (const [fields, error] of [
  [{ spellSlot: undefined }, 'spellSlot'],
  [{ spellSlot: { ...valid, op: 'set' } }, 'spellSlot'],
  [{ spellSlot: { ...valid, id: '' } }, 'spellSlot'],
  [{ spellSlot: { ...valid, id: '1st' } }, 'spellSlot'],
  [{ spellSlot: { ...valid, id: 7 } }, 'spellSlot'],
  [{ spellSlot: { op: 'spend', id: 'spell1' } }, 'spellSlot'],
  [{ spellSlot: { ...valid, from: -1 } }, 'spellSlot'],
  [{ spellSlot: { ...valid, from: 1.5 } }, 'spellSlot'],
  [{ spellSlot: { ...valid, from: '3' } }, 'spellSlot'],
  [{ spellSlot: { ...valid, count: 1 } }, 'spellSlot'],
  [{ spellSlot: valid, slot: 'spell1' }, 'spellSlot'],
  [{ spellSlot: valid, mode: 1 }, 'dice'],
  [{ spellSlot: valid, dice: [{ faces: 20, results: [3] }] }, 'dice'],
  [{ spellSlot: valid, of: 'thorin' }, 'of'],
  [{ spellSlot: valid, by: 'x' }, 'by'],
]) assert.deepEqual(await refusedSlot(fields, JSON.stringify(fields)), ['failed', 'invalid', error], JSON.stringify(fields))
assert.deepEqual(await refusedSlot({ spellSlot: { op: 'spend', id: 'grit', from: 0 }, actorId: 'stranger' }, 'not in the campaign'), ['failed', 'unknown', null])
settings.set('campaigns', campaigns.map(campaign => ({ ...campaign, attacks: false })))
const slotAttacksOff = await refusedSlot({ spellSlot: valid }, 'attacks off')
settings.set('campaigns', campaigns.map(campaign => ({ ...campaign, transfers: true })))
diceStatus.ready = false
const slotDiceOff = await refusedSlot({ spellSlot: valid }, 'the dice not ready')
diceStatus.ready = true
settings.set('campaigns', campaigns)
assert.deepEqual([slotAttacksOff, slotDiceOff], [['failed', 'attacks-off', null], ['failed', 'off', null]])
ok('0.42.1: refused with nothing written or posted: "changed" from a count it isn\'t, "slots" with none left, "full" with none used, "slot" for a pool with no slots, none, a key every object has or one only inherited; "invalid" for a spellSlot that isn\'t exactly {op, id, from} as they may be, beside a roll\'s field, throwing dice, for a companion or by anyone but the Gamemaster; "unknown" for a character not in the campaign; "attacks-off"; "off"')

slotted = await spellSlot('spend', 'spell1', 3, { by: 'gm' })
assert.deepEqual([slotted.result.status, slotOf('spell1'), slotted.line?.content], ['done', 2, '<p>Spends a spell slot · 1st Level</p>'])
assert.deepEqual([slotted.line.author.id, slotted.line.flags['sending-stone']], ['alice', { request: slotted.command.id, by: 'gm' }])
assert.deepEqual(slotted.result.messages, [slotted.line.id])
ok("0.42.1: the Gamemaster's spell slot spent from the app posts its line as Thorin's player's, marked the Gamemaster's, and their result lists it")

thorin.system.spells.spell1.label = '<b>1st</b>'
slotted = await spellSlot('spend', 'spell1', 2)
thorin.system.spells.spell1.label = '1st Level'
assert.deepEqual([slotted.result.status, slotOf('spell1'), slotted.line?.content], ['done', 1, '<p>Spends a spell slot · &lt;b&gt;1st&lt;/b&gt;</p>'])
assert.equal((await spellSlot('restore', 'spell1', 1)).result.status, 'done')
ok("0.42.1: the pool's name escaped in its line")

assert.deepEqual(await refusedSlot(slotCommand('spend', 'spell9', 5), 'no pool, and a count it never had'), ['failed', 'slot', null])
assert.deepEqual(await refusedSlot(slotCommand('spend', 'spell2', 1), 'none left, and a count it isn\'t'), ['failed', 'changed', null])
assert.deepEqual(pools(), { spell1: 2, spell2: 0, spell3: 0, spell4: 4, pact: 1 })
thorin.system.favorites.pop()
ok('0.42.1: refused in order: no such pool before a count it isn\'t ("slot"); a count it isn\'t before none left ("changed", not "slots")')

// ---- Where they're offered ----
const changed = change => campaigns.map(campaign => ({ ...campaign, ...change }))
settings.set('campaigns', changed({ attacks: false }))
const attacksOff = [await spend({ item: 'beads' }, 1), await send('inspiration', { inspiration: 'gain' })]
// Since 0.31.0 only a campaign whose players move items and coins is fetched for while the dice
// aren't ready: what's fetched then is refused, as fetched while rolls are off.
settings.set('campaigns', changed({ transfers: true }))
diceStatus.ready = false
const diceOff = [await spend({ item: 'beads' }, 1), await send('inspiration', { inspiration: 'gain' })]
diceStatus.ready = true
settings.set('campaigns', campaigns)
assert.deepEqual([...attacksOff, ...diceOff].map(refusal), [
  ['failed', 'attacks-off', null], ['failed', 'attacks-off', null], ['failed', 'off', null], ['failed', 'off', null],
])
made = await spend({ item: 'beads' }, 1)
assert.equal(made.result.status, 'done')
ok(`refused where the Gamemaster doesn't let players attack, or the dice aren't ready; made while attacks can't be made here only for ${MIDI ? "Midi's integration being off" : 'the attack self-test'}`)

console.log(`${MIDI ? 'midi' : 'dnd5e'}: done`)
process.exit(0)
