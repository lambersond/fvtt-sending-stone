// Damage on its own and recharges (module 0.36.0, its contract §3, §4.5, §4.7-§4.9, §6.8-§6.9,
// §6.11): `itemDamage`, an action's damage or healing rolled with the player's dice as dnd5e's own
// card with no targets, for the Gamemaster to apply from its tray, outside Midi-QOL's workflow; its
// preview on every damaging row, `tableDamage`; and `recharge`, a spent recharge rolled as dnd5e's
// own, with the player's d6; and the damage card's mark, `alone`, in its flags and its chat message
// (§20 item 1). The real module; dnd5e 5.3.3's real dice classes, or 6.0.5's with
// DND5E6=1, whose damage and recharge cards this ports (mixin.mjs:857-914, uses-field.mjs:269-347);
// dnd5e's items and activities ported (activity5e.mjs), rollRecharge among them; with MIDI=1,
// midi-fake.mjs's workflow, its damage roll modifiers and the ammunition it keeps; a companion's
// token (token-core.mjs); a stand-in Foundry core and app. Run with --import ./unref-timers.mjs
// --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { settings, user, users, actors } from './stub.mjs'
import { DND5E5, DND5E6 as DND5E6_ROOT } from './paths.mjs'

const MODULE = process.env.MODULE_DIR
const MIDI = Boolean(process.env.MIDI)
const DND5E6 = Boolean(process.env.DND5E6)
const DND5E = DND5E6 ? `${DND5E6_ROOT}/module/dice` : `${DND5E5}/module/dice`
let oks = 0
const ok = message => { oks++; console.log('ok -', message) }

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
const wait = ms => new Promise(resolve => realSetTimeout(resolve, ms))
globalThis.document = { hidden: false }

// ---- dnd5e ----
const { messages } = await import('./dice-core.mjs')
const { default: BasicDie } = await import(`${DND5E}/basic-die.mjs`)
const { default: BasicRoll } = await import(`${DND5E}/basic-roll.mjs`)
const { default: D20Die } = await import(`${DND5E}/d20-die.mjs`)
const { default: D20Roll } = await import(`${DND5E}/d20-roll.mjs`)
const { default: DamageRoll } = await import(`${DND5E}/damage-roll.mjs`)
Object.assign(CONFIG.Dice, { BasicDie, BasicRoll, D20Die, D20Roll, DamageRoll })
CONFIG.Dice.terms.d = BasicDie
if (DND5E6) game.system.version = '6.0.5'
const TYPES = ['slashing', 'piercing', 'fire', 'cold', 'acid', 'radiant', 'necrotic', 'force']
CONFIG.DND5E = {
  skills: { prc: { label: 'Perception', ability: 'wis' } },
  tools: {},
  abilities: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(key => [key, { label: key.toUpperCase() }])),
  defaultAbilities: { initiative: 'dex' },
  spellcasting: { spell: { exclusive: { spells: false, slots: false } }, pact: { exclusive: { spells: false, slots: false } } },
  damageTypes: Object.fromEntries(TYPES.map(type => [type, { label: type.charAt(0).toUpperCase() + type.slice(1) }])),
  healingTypes: { healing: { label: 'Healing' } },
  characterFlags: { elvenAccuracy: { abilities: ['dex', 'int', 'wis', 'cha'] } },
}
settings.set('messageMode', 'gm')
settings.set('criticalDamageModifiers', false)
settings.set('criticalDamageMaxDice', false)
settings.set('attackRollVisibility', 'hideAC')
globalThis._loc ??= (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key))

const { Actor5e } = await import('./actor5e.mjs')
const { Activity, AttackActivity, SaveActivity, DamageActivity, HealActivity, equip, port } = await import('./activity5e.mjs')
const { midi, placeables, installMidi, installMidiDamageModifiers } = await import('./midi-fake.mjs')
globalThis.dnd5e = {
  settings: { rulesVersion: 'modern' },
  dice: { DamageRoll },
  documents: { activity: { AttackActivity, SaveActivity, DamageActivity, HealActivity } },
  registry: {
    messages: {
      get(id, type) {
        return [...messages.values()].filter(m => (m.flags?.dnd5e?.originatingMessage === id) && (m.flags?.dnd5e?.roll?.type === type))
      },
    },
  },
}
globalThis.Item = { implementation: class { constructor(data) { Object.assign(this, data); this.system ??= {} } } }
// A use's and a roll's card name the Gamemaster's targets, as dnd5e's do.
port.targets = true
const { mergeObject, isEmpty } = foundry.utils

if (DND5E6) {
  /**
   * dnd5e 6.0.5's damage card (mixin.mjs:857-914, heal.mjs:69-74): typed `damage`, or `healing`
   * for a heal, its activity and item and the Gamemaster's targets in its own data, no dnd5e flags.
   */
  const sources = activity => ({
    activity: { id: activity.id, name: activity.name, type: activity.type, uuid: activity.uuid },
    item: { id: activity.item.id, name: activity.item.name, type: activity.item.type, uuid: activity.item.uuid },
  })
  const descriptors = () => [...(game.user?.targets ?? [])].map(target => {
    const token = target.document ?? target
    return { actor: token.actor?.uuid, ac: token.actor?.system?.attributes?.ac?.value ?? null, name: token.name, token: token.uuid }
  })
  Activity.prototype.rollDamage = async function (config = {}, dialog = {}, message = {}) {
    const rollConfig = this.getDamageConfig(config)
    rollConfig.hookNames = [...(config.hookNames ?? []), 'damage']
    rollConfig.subject = this
    const messageConfig = mergeObject({
      create: true,
      data: {
        flavor: `${this.item.name} - ${this.damageFlavor}`,
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        system: { ...sources(this), targets: descriptors() },
        type: 'damage',
      },
    }, message)
    const rolls = await CONFIG.Dice.DamageRoll.build(rollConfig, mergeObject({ options: {} }, dialog), messageConfig)
    if (!rolls?.length) return
    const lastDamageTypes = rolls.reduce((obj, roll, index) => (roll.options.type ? { ...obj, [index]: roll.options.type } : obj), {})
    if (!isEmpty(lastDamageTypes) && this.actor?.items.has(this.item.id)) {
      await this.actor.items.get(this.item.id).setFlag('dnd5e', `last.${this.id}.damageType`, lastDamageTypes)
    }
    Hooks.callAll('dnd5e.rollDamage', rolls, { subject: this })
    Hooks.callAll('dnd5e.rollDamageV2', rolls, { subject: this })
    return rolls
  }
  delete SaveActivity.prototype.rollDamage
  HealActivity.prototype.rollDamage = function (config = {}, dialog = {}, message = {}) {
    return Activity.prototype.rollDamage.call(this, config, dialog, mergeObject({ 'data.type': 'healing' }, message))
  }
}

const { companionActor, placeToken, scene } = await import('./token-core.mjs')

// ---- The world ----
users.activeGM = user('gm', 'Gamemaster', true)
const alice = user('alice', 'Alice')
if (MIDI) installMidi()
const add = actor => { actors.set(actor.id, actor); return actor }
const weapon = (id, name, activity, system = {}) => ({
  id, name, type: 'weapon', system: { properties: [], quantity: 1, attackType: 'melee', ...system }, activities: [activity],
})
const feat = (id, name, activities, system = {}) => ({ id, name, type: 'feat', system: { ...system }, activities })
const recharge = (spent, formula = '5', max = 1) => ({ max, spent, recovery: [{ period: 'recharge', type: 'recoverAll', formula }] })
// Thorin, Alice's: Strength 3.
const thorin = add(new Actor5e({ id: 'thorin', name: 'Thorin', owners: ['alice'], mods: { str: 3, dex: 2, wis: 2 } }))
alice.character = thorin
equip(thorin, {
  items: [
    weapon('longsword', 'Longsword', { id: 'ls-swing', damage: [{ number: 1, denomination: 8, bonus: '@mod', types: ['slashing'] }] }),
    weapon('bow', 'Longbow', { id: 'bow-shot', ability: 'dex', actionType: 'rwak', damage: [{ number: 1, denomination: 8, bonus: '@mod', types: ['piercing'] }] },
      { properties: ['amm'], attackType: 'ranged' }),
    { id: 'arrows', name: 'Arrows of Fire', type: 'consumable', system: { type: { value: 'ammo' }, quantity: 20, damage: { base: { number: 1, denomination: 4, types: ['fire'] } } }, activities: [] },
    weapon('orb', 'Orb of Elements', { id: 'orb-shot', damage: [{ number: 2, denomination: 6, types: ['fire', 'cold'] }] }),
    feat('burst', 'Fire Burst', [{ id: 'burst-save', type: 'save', save: ['dex'], dc: 13, affects: 'creature', count: 1, damage: [{ number: 2, denomination: 6, types: ['fire'] }] }]),
    feat('cure', 'Cure', [{ id: 'cure-heal', type: 'heal', healing: { number: 1, denomination: 8, bonus: '@mod' } }]),
    feat('smite', 'Smite', [{ id: 'smite-hit', type: 'damage', criticalAllow: true, damage: [{ number: 2, denomination: 8, types: ['radiant'] }] }]),
    feat('zap', 'Zap', [{ id: 'zap-hit', type: 'damage', damage: [{ number: 1, denomination: 10, types: ['force'] }] }]),
    feat('wither', 'Withering Touch', [{ id: 'wither-hit', type: 'damage', damage: [{ custom: '-1d4 + 2d6', types: ['necrotic'] }] }]),
    { id: 'staff', name: 'Staff of Fire', type: 'equipment', system: { properties: [], quantity: 1, uses: { max: 3, spent: 0, recovery: [] } },
      activities: [{ id: 'staff-cast', type: 'cast', spell: { level: 1 } }, { id: 'staff-fwd', type: 'forward', activity: { id: 'staff-hit' } },
        { id: 'staff-hit', type: 'damage', damage: [{ number: 1, denomination: 6, types: ['fire'] }] }] },
    weapon('mystery', 'Mystery Blade', { id: 'mystery-cut', damage: [{ number: 1, denomination: 6, types: ['slashing'] }] }, { identified: false }),
    { id: 'familiar', name: 'Find Familiar', type: 'spell', system: { level: 1, method: 'spell', properties: [] }, activities: [{ id: 'ff-summon', type: 'summon' }] },
    // Recharges: the item's own, an activity's own, two uses one spent, none spent, and none that recharge.
    feat('breath', 'Fire Breath', [{ id: 'breath-save', type: 'save', save: ['dex'], dc: 15, damage: [{ number: 6, denomination: 6, types: ['fire'] }] }], { uses: recharge(1) }),
    feat('glare', 'Glare', [{ id: 'glare-use', type: 'utility', uses: recharge(1, '6') }]),
    feat('twin', 'Twin Breath', [{ id: 'twin-use', type: 'utility' }], { uses: recharge(1, '5', 2) }),
    feat('fresh', 'Fresh Breath', [{ id: 'fresh-use', type: 'utility' }], { uses: recharge(0) }),
    feat('plainUses', 'Second Wind', [{ id: 'plain-use', type: 'utility' }], { uses: { max: 1, spent: 1, recovery: [{ period: 'sr', type: 'recoverAll' }] } }),
  ],
})
// Midi's damage roll modifiers on Thorin, once an effect gives him some.
thorin.effectsMade = []
thorin.allApplicableEffects = function* () { yield* thorin.effectsMade }
const goblin = add(new Actor5e({ id: 'goblin', name: 'Goblin', mods: {}, hp: { value: 30, max: 30, temp: 0 } }))
goblin.type = 'npc'
equip(goblin, { ac: 13 })
const arena = scene('arena', { active: true })
const goblinToken = placeToken(arena, goblin, { id: 'gob1', name: 'Goblin', actorLink: true })
goblinToken.object.document = goblinToken
placeables.set(goblinToken.id, goblinToken.object)
if (MIDI) canvas.scene.tokens.size = placeables.size
// The Gamemaster has the goblin targeted.
users.get('gm').targets = new Set([goblinToken.object])
// A drake, Alice's, unlinked, with a spent recharge on its token's creature.
const drake = companionActor('drake', 'Drake', { owners: ['alice'], linked: false, gear: { items: [feat('spit', 'Acid Spit', [{ id: 'spit-use', type: 'utility' }], { uses: recharge(1) })] } })
const drake1 = placeToken(arena, drake, { id: 'drake1', name: 'Drake' })
const { combat, combatant } = await import('./stub.mjs')
const fight = combat('fight')
combatant(fight, 'cb-thorin', thorin)
combatant(fight, 'cb-gob', goblin, { token: goblinToken, tokenId: 'gob1', sceneId: 'arena' })
fight.getCombatantsByActor = actor => fight.combatants.filter(cb => cb.actor?.id === actor.id)
game.combat = fight

// ---- The app ----
const app = { events: [], polls: [], waiting: new Map(), wake: null, features: { commands: true, companions: 1 } }
const json = body => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  if (String(url).endsWith('/api/events')) {
    app.events.push(body)
    return json({ features: app.features })
  }
  if (String(url).endsWith('/api/bridge/commands')) {
    app.polls.push(body)
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
async function until(test, what, ms = 4000) {
  const end = Date.now() + ms
  while (!test()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await wait(5)
  }
}
const settle = () => wait(320)
let ids = 0
const results = id => app.events.filter(e => (e.type === 'command.result') && (e.data.id === id)).map(e => e.data)
async function send(command, campaign = 'camp-a') {
  app.waiting.set(campaign, [...(app.waiting.get(campaign) ?? []), command])
  app.wake?.()
  await until(() => results(command.id).length, `the result of ${command.id}`)
  return results(command.id)[0]
}
const plain = { mode: 0, explicit: false, extras: [] }
const itemDamage = (fields = {}) => send({ id: `alone-${++ids}`, actorId: 'thorin', kind: 'itemDamage', item: 'longsword', activity: 'ls-swing', ...plain, dice: [{ faces: 8, results: [5] }], ...fields })
const rechargeOf = (fields = {}) => send({ id: `recharge-${++ids}`, actorId: 'thorin', kind: 'recharge', item: 'breath', ...plain, dice: [{ faces: 6, results: [5] }], ...fields })
const messageOf = id => [...messages.values()].find(m => m.flags?.['sending-stone']?.request === id)
const helloOf = id => app.events.filter(e => (e.type === 'bridge.hello') && (e.campaign.id === id)).at(-1)
const rollDamageHeard = []
Hooks.on('dnd5e.rollDamage', (rolls, { subject }) => rollDamageHeard.push(subject?.id))

// ---- Start-up ----
await import(`${MODULE}/scripts/module.mjs`)
if (MIDI) installMidiDamageModifiers(DamageRoll)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('campaignSecrets', { 'camp-a': 'a', 'camp-b': 'b', 'camp-c': 'c' })
settings.set('campaigns', [
  { id: 'camp-a', title: 'Ashlands', characters: ['thorin'], rolls: true, attacks: true },
  { id: 'camp-b', title: 'Mirkwood', characters: ['thorin'], rolls: true, attacks: false },
  { id: 'camp-c', title: 'Coldwater', characters: ['thorin'], rolls: false, attacks: true },
])
await Hooks.callAll('ready')
const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
const { rollFeatures } = await import(`${MODULE}/scripts/commands.mjs`)
const { getCampaigns } = await import(`${MODULE}/scripts/campaigns.mjs`)
await until(() => app.polls.length > 0, 'the first fetch')
await settle()
assert.deepEqual([diceStatus.ready, diceStatus.attacks, diceStatus.modifiers], [true, true, true], diceStatus.error ?? diceStatus.attacksError)

/* -------------------------------------------- */
/*  Offered                                     */
/* -------------------------------------------- */

const ALONE = ['itemDamage', 'recharge']
{
  const kinds = id => helloOf(id).data.features.rolls.kinds
  assert.deepEqual(kinds('camp-a').slice(-2), ALONE, 'with attacks on, after the rest')
  assert.equal(helloOf('camp-a').data.features.rolls.modifiers, true, 'damage on its own may be changed')
  assert.ok(!ALONE.some(kind => kinds('camp-b').includes(kind)), 'not with attacks off')
  assert.deepEqual(kinds('camp-c'), [], 'nor with rolls off')
  const [ashlands] = getCampaigns()
  const was = diceStatus.attacks
  diceStatus.attacks = false
  assert.ok(!ALONE.some(kind => rollFeatures(ashlands).kinds.includes(kind)), 'nor before the damage self-test passes')
  diceStatus.attacks = was
  assert.deepEqual(helloOf('camp-a').data.features.companions.kinds.filter(kind => ALONE.includes(kind)), ALONE, 'a companion takes them too')
  if (MIDI) {
    const told = app.events.length
    await game.settings.set('sending-stone', 'midiIntegration', false)
    await until(() => app.events.slice(told).some(e => (e.type === 'bridge.hello') && (e.campaign.id === 'camp-a')), 'a fresh hello')
    assert.deepEqual(kinds('camp-a').slice(-2), ALONE, 'with Midi-QOL integration off too')
    assert.equal(helloOf('camp-a').data.features.rolls.modifiers, true)
    await game.settings.set('sending-stone', 'midiIntegration', true)
    await settle()
  }
  ok(`itemDamage and recharge offered with attacks on and the damage self-test passed${MIDI ? ', Midi-QOL integration on or off' : ''}, with modifiers; none with attacks off, rolls off, or before the self-test; a companion takes both`)
}

/* -------------------------------------------- */
/*  The sheet                                   */
/* -------------------------------------------- */

const sheet = app.events.filter(e => (e.type === 'character.updated') && (e.campaign.id === 'camp-a')).at(-1).data.character.sheet
/** Every row the sheet sends that has a tableDamage, by its activity's id or its own. */
const rows = []
JSON.stringify(sheet, (key, value) => {
  if (value && (typeof value === 'object') && Object.hasOwn(value, 'tableDamage')) rows.push(value)
  return value
})
const rowOf = id => rows.find(row => (row.activity?.id === id) || (row.attackId === id) || (row.id === id))
/** Every row the sheet sends of an item, by its id, whatever it carries. */
const itemRows = id => {
  const found = []
  JSON.stringify(sheet, (key, value) => {
    if (value && (typeof value === 'object') && (value.id === id) && (typeof value.name === 'string')) found.push(value)
    return value
  })
  return found
}
{
  const sword = rowOf('ls-swing').tableDamage
  assert.deepEqual(sword.normal.rolls.map(roll => [roll.formula, roll.dice]), [['1d8 + 3', [{ faces: 8, number: 1 }]]])
  assert.deepEqual(sword.critical.rolls.map(roll => [roll.formula, roll.dice]), [['2d8 + 3', [{ faces: 8, number: 2 }]]], "a critical hit's its first die's twice")
  assert.equal(rowOf('burst-save').tableDamage.critical, null, 'a save: no critical')
  assert.ok(rowOf('burst-save').tableDamage.normal.plannable)
  assert.equal(rowOf('cure-heal').tableDamage.critical, null, 'a heal: no critical')
  assert.equal(rowOf('cure-heal').tableDamage.normal.healing, true)
  assert.ok(rowOf('smite-hit').tableDamage.critical, 'a damage activity that allows a critical hit')
  assert.equal(rowOf('zap-hit').tableDamage.critical, null, 'and one that allows none')
  for (const id of ['staff-cast', 'staff-fwd']) assert.equal(rowOf(id)?.tableDamage, null, id)
  // The unidentified blade and the summon are sent with no damage to roll at all: rows of their own,
  // none with a tableDamage, and none of their activities'.
  for (const [itemId, activityId] of [['mystery', 'mystery-cut'], ['familiar', 'ff-summon']]) {
    const own = itemRows(itemId)
    assert.ok(own.length, `${itemId}: its rows`)
    assert.ok(own.every(row => (row.tableDamage ?? null) === null), `${itemId}: none with damage`)
    assert.equal(rows.filter(row => (row.activity?.id === activityId) || (row.attackId === activityId)).length, 0, `${activityId}: no row with damage`)
  }
  assert.equal(itemRows('mystery')[0].identified, false, 'the blade unidentified')
  assert.ok(rows.some(row => (row.tableDamage === null) && (row.type === 'cast' || row.cast)), 'a Cast row has none')
  ok("tableDamage on every damaging row: a longsword's 1d8 + 3, its critical 2d8 + 3; a save's and a heal's with no critical; a damage activity's critical as it allows one; none on a Cast or a forward, an unidentified item, a summon")
}

/* -------------------------------------------- */
/*  itemDamage                                  */
/* -------------------------------------------- */

const cardTargets = card => (DND5E6 ? card.system?.targets : card.flags?.dnd5e?.targets)
{
  const before = midi.made.length
  const made = await itemDamage()
  assert.equal(made.status, 'done', JSON.stringify(made))
  const card = messageOf(made.id)
  assert.deepEqual([card.rolls[0].formula, card.rolls[0].total], ['1d8 + 3', 8])
  if (DND5E6) {
    assert.equal(card.type, 'damage')
    assert.deepEqual(card.system.targets, [], 'no targets, though the Gamemaster has one')
    assert.ok(!card.flags.dnd5e?.targets, 'and none in its flags')
  } else {
    assert.deepEqual([card.flags.dnd5e.messageType, card.flags.dnd5e.roll.type, card.flags.dnd5e.activity.id, card.flags.dnd5e.item.id], ['roll', 'damage', 'ls-swing', 'longsword'])
    assert.deepEqual(card.flags.dnd5e.targets, [], 'no targets, though the Gamemaster has one')
  }
  assert.deepEqual([card.author.id, card.whisper, card.flags['sending-stone'].request], ['alice', [], made.id], 'authored as Alice, public, the request marked')
  assert.ok(rollDamageHeard.includes('ls-swing'), 'dnd5e.rollDamage fired')
  assert.deepEqual(thorin.items.get('longsword').getFlag('dnd5e', 'last.ls-swing.damageType'), { 0: 'slashing' }, 'its last damage types kept')
  if (MIDI) assert.equal(midi.made.length, before, 'no workflow made')
  const crit = await itemDamage({ critical: true, dice: [{ faces: 8, results: [5, 6] }] })
  assert.equal(crit.status, 'done', JSON.stringify(crit))
  assert.deepEqual([messageOf(crit.id).rolls[0].formula, messageOf(crit.id).rolls[0].options.isCritical], ['2d8 + 3', true], 'critical, its dice alone doubled')
  const heal = await itemDamage({ item: 'cure', activity: 'cure-heal', dice: [{ faces: 8, results: [4] }] })
  assert.equal(heal.status, 'done', JSON.stringify(heal))
  if (DND5E6) assert.equal(messageOf(heal.id).type, 'healing')
  else assert.equal(messageOf(heal.id).flags.dnd5e.roll.type, 'healing')
  ok(`damage on its own: the longsword's 1d8 + 3 with Alice's d8, dnd5e's ${DND5E6 ? 'damage card, typed damage' : 'damage card, roll type damage, its activity and item named'}, no targets though the Gamemaster has the goblin targeted, Alice's, public, dnd5e.rollDamage fired and its types kept${MIDI ? ', no workflow made' : ''}; a critical hit's 2d8 + 3; a heal's healing`)
}
{
  const refused = async (fields, reason, error = null) => {
    const made = await itemDamage(fields)
    assert.deepEqual([made.status, made.reason, made.error], ['failed', reason, error], JSON.stringify(fields))
  }
  await refused({ item: 'burst', activity: 'burst-save', critical: true, dice: [{ faces: 6, results: [1, 2, 3, 4] }] }, 'invalid', 'critical')
  await refused({ dice: [{ faces: 6, results: [5] }] }, 'invalid', 'dice')
  await refused({ item: 'wither', activity: 'wither-hit', modifiers: { maximize: true }, dice: [{ faces: 4, results: [4] }, { faces: 6, results: [6, 6] }] }, 'invalid', 'modifiers')
  await refused({ item: 'orb', activity: 'orb-shot', types: ['acid'], dice: [{ faces: 6, results: [3, 4] }] }, 'type')
  await refused({ item: 'staff', activity: 'staff-cast' }, 'gone')
  await refused({ item: 'mystery', activity: 'mystery-cut', dice: [{ faces: 6, results: [3] }] }, 'gone')
  await refused({ use: 'some-use' }, 'invalid', 'item')
  await refused({ activity: undefined }, 'invalid', 'item')
  const offB = await send({ id: `alone-${++ids}`, actorId: 'thorin', kind: 'itemDamage', item: 'longsword', activity: 'ls-swing', ...plain, dice: [{ faces: 8, results: [5] }] }, 'camp-b')
  assert.deepEqual([offB.status, offB.reason], ['failed', 'attacks-off'])
  ok("refused: a save's critical, invalid critical; dice not the activity's, invalid dice; maximize where a die is taken away, invalid modifiers; a kind it doesn't offer, type; a Cast's activity, or an unidentified item's, gone; a use named, or no activity, invalid item; attacks off, attacks-off")
}
if (MIDI) {
  // Midi's damage roll modifiers apply, its activity's own getDamageConfig being Midi's.
  thorin.effectsMade = [{ disabled: false, isSuppressed: false, system: { changes: [{ key: 'flags.midi-qol.rollModifiers.damage.all.all', value: 'min3', priority: 20 }] } }]
  const modified = await itemDamage({ dice: [{ faces: 8, results: [1] }] })
  thorin.effectsMade = []
  assert.equal(modified.status, 'done', JSON.stringify(modified))
  assert.deepEqual([messageOf(modified.id).rolls[0].formula, messageOf(modified.id).rolls[0].total], ['1d8min3 + 3', 6], "Midi's min3 on its die")
  // A bow's attack with fire arrows, through Midi's workflow, then its damage on its own: no arrows.
  const shot = await send({ id: `atk-${++ids}`, actorId: 'thorin', kind: 'attack', item: 'bow', activity: 'bow-shot', ammunition: 'arrows', target: { combatId: 'fight', combatantId: 'cb-gob' }, ...plain, dice: [{ faces: 20, results: [15] }] })
  assert.equal(shot.status, 'done', JSON.stringify(shot))
  const before = midi.made.length
  const bowDamage = await itemDamage({ item: 'bow', activity: 'bow-shot', dice: [{ faces: 8, results: [4] }] })
  assert.equal(bowDamage.status, 'done', JSON.stringify(bowDamage))
  assert.deepEqual([messageOf(bowDamage.id).rolls.length, messageOf(bowDamage.id).rolls[0].formula], [1, '1d8 + 2'], 'no arrow damage')
  assert.equal(midi.made.length, before, 'no workflow')
  assert.deepEqual(messageOf(bowDamage.id).flags.dnd5e.targets, [])
  ok("under Midi-QOL: dnd5e's card, outside Midi's workflow, with no targets; Midi's damage roll modifiers added, as its activity's do; after a bow's attack with fire arrows, the bow's damage on its own carries none of theirs")
}
{
  const typed = await itemDamage({ typed: true })
  assert.equal(messageOf(typed.id).flags['sending-stone'].typed, true, 'marked entered by hand')
  const gm = await itemDamage({ by: 'gm' })
  assert.deepEqual([messageOf(gm.id).flags['sending-stone'].by, messageOf(gm.id).author.id], ['gm', 'alice'], "marked the Gamemaster's, authored as Alice")
  ok("typed: its card marked entered by hand; the Gamemaster's as Thorin: marked GM, authored as Alice")
}

/* -------------------------------------------- */
/*  Recharges                                   */
/* -------------------------------------------- */

{
  const breath = thorin.items.get('breath')
  const success = await rechargeOf()
  assert.deepEqual([success.status, success.outcome], ['done', 'success'], JSON.stringify(success))
  assert.equal(breath.system.uses.spent, 0, 'recharged')
  const card = messageOf(success.id)
  assert.deepEqual([card.rolls[0].formula, card.rolls[0].dice[0].results.map(r => r.result), card.whisper, card.author.id], ['1d6', [5], [], 'alice'])
  if (DND5E6) assert.equal(card.type, 'recharge')
  breath.updateSource({ 'system.uses.spent': 1 })
  const failure = await rechargeOf({ dice: [{ faces: 6, results: [3] }] })
  assert.deepEqual([failure.status, failure.outcome, breath.system.uses.spent], ['done', 'failure', 1])
  const charged = await rechargeOf({ item: 'fresh' })
  assert.deepEqual([charged.status, charged.reason], ['failed', 'charged'])
  const twin = await rechargeOf({ item: 'twin' })
  assert.deepEqual([twin.status, twin.outcome, thorin.items.get('twin').system.uses.spent], ['done', 'success', 0], 'max 2 with 1 spent rolled')
  const glare = await rechargeOf({ item: 'glare', activity: 'glare-use', dice: [{ faces: 6, results: [6] }] })
  assert.deepEqual([glare.status, glare.outcome, thorin.items.get('glare').system.activities.get('glare-use').uses.spent], ['done', 'success', 0], "an activity's own uses")
  const none = await rechargeOf({ item: 'plainUses' })
  assert.deepEqual([none.status, none.reason], ['failed', 'gone'])
  const two = await rechargeOf({ dice: [{ faces: 6, results: [5, 6] }] })
  assert.deepEqual([two.status, two.reason, two.error], ['failed', 'invalid', 'dice'])
  const spit = await rechargeOf({ actorId: 'arena-drake1', of: 'thorin', item: 'spit', dice: [{ faces: 6, results: [6] }] })
  assert.deepEqual([spit.status, spit.outcome], ['done', 'success'], JSON.stringify(spit))
  assert.deepEqual([drake1.actor.items.get('spit').system.uses.spent, drake.items.get('spit').system.uses.spent], [0, 1], "the token's creature's, not its base's")
  assert.equal(messageOf(spit.id).flags['sending-stone'].companion, 'arena-drake1')
  ok(`recharges: the breath's 5 recharges it, dnd5e's card with Alice's d6, public${DND5E6 ? ', typed recharge' : ''}; a 3 leaves it spent; one not spent, charged; two uses one spent, rolled; an activity's own uses; uses with no recharge, gone; two d6, invalid dice; a companion's on its token's creature`)
}

/* -------------------------------------------- */
/*  The card's mark (round 0.36.0 §20 item 1)   */
/* -------------------------------------------- */

// The app is told of chat from here on, so that it can say a damage card was made on its own.
settings.set('chatEvents', true)
{
  const chatEvents = id => app.events.filter(e => ['chat.message.created', 'chat.message.updated'].includes(e.type)
    && (e.campaign.id === 'camp-a') && (e.data.message?.id === id))
  /** The message as the app was last told of it, created or updated. */
  const told = id => chatEvents(id).at(-1)?.data.message
  const toldOf = async card => {
    await until(() => told(card.id), `the app told of ${card.id}`)
    await settle()
    return told(card.id)
  }
  const sword = await itemDamage()
  const heal = await itemDamage({ item: 'cure', activity: 'cure-heal', dice: [{ faces: 8, results: [4] }] })
  for (const made of [sword, heal]) {
    assert.equal(made.status, 'done', JSON.stringify(made))
    const card = messageOf(made.id)
    assert.equal(card.flags['sending-stone'].alone, true, 'the card flagged made on its own')
    assert.equal((await toldOf(card)).alone, true, 'and its message says so')
  }

  // An attack's damage, by its use, and a recharge: neither card is marked, nor its message.
  const attack = await send({ id: `atk-${++ids}`, actorId: 'thorin', kind: 'attack', item: 'longsword', activity: 'ls-swing', target: { combatId: 'fight', combatantId: 'cb-gob' }, ...plain, dice: [{ faces: 20, results: [15] }] })
  assert.equal(attack.status, 'done', JSON.stringify(attack))
  const dealt = await send({ id: `dmg-${++ids}`, actorId: 'thorin', kind: 'damage', use: attack.id, dice: [{ faces: 8, results: [4] }] })
  assert.equal(dealt.status, 'done', JSON.stringify(dealt))
  const recharged = await rechargeOf()
  assert.equal(recharged.status, 'done', JSON.stringify(recharged))
  const madeFor = id => [...messages.values()].filter(m => [m.flags?.['sending-stone']?.request, m.flags?.['sending-stone']?.use].includes(id))
  const others = [...madeFor(attack.id), ...madeFor(dealt.id), ...madeFor(recharged.id)]
  assert.ok(others.some(card => card.rolls.some(roll => roll instanceof DamageRoll)), "the attack's damage among them")
  assert.ok(others.some(card => card.flags['sending-stone'].request === recharged.id), "and the recharge's card")
  for (const card of others) {
    assert.ok(!Object.hasOwn(card.flags['sending-stone'], 'alone'), `${card.id}: no flag`)
    assert.ok(!Object.hasOwn(await toldOf(card), 'alone'), `${card.id}: nor in its message`)
  }

  // Only the module's own flag, true, says so.
  const odd = await ChatMessage.create({ speaker: { actor: 'thorin', alias: 'Thorin' }, content: 'Mine', flags: { 'sending-stone': { alone: 'true' } } })
  assert.ok(!Object.hasOwn(await toldOf(odd), 'alone'), 'a flag that is not true says nothing')

  // To every listener: one that reads no companions is told it too.
  const { serializeMessage } = await import(`${MODULE}/scripts/chat-data.mjs`)
  const unread = { ...getCampaigns().find(({ id }) => id === 'camp-a'), id: 'camp-none' }
  assert.equal(serializeMessage(messageOf(sword.id), unread).companion, undefined, 'a listener reading no companions')
  assert.equal(serializeMessage(messageOf(sword.id), unread).alone, true, 'is told it too')
  ok(`the card damage on its own makes is flagged alone, a heal's too, and the app is told it in its chat message, as a listener that reads no companions is; ${MIDI ? "Midi's card of an attack and its damage" : "an attack's damage, made on its use,"} and a recharge's card are neither, nor a message flagged "true"`)
}

console.log(`alone${MIDI ? ' (Midi)' : ''}${DND5E6 ? ' (dnd5e 6)' : ''}: done, ${oks} ok`)
process.exit(0)
