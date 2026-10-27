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
import { readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
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
  // Module 0.41.0: the names the damage card gives a level and a mode, as dnd5e's config has them, localized.
  spellLevels: { 0: 'Cantrip', 1: '1st Level', 2: '2nd Level', 3: '3rd Level', 4: '4th Level', 5: '5th Level', 6: '6th Level', 7: '7th Level', 8: '8th Level', 9: '9th Level' },
  attackModes: { oneHanded: { label: 'One-Handed' }, twoHanded: { label: 'Two-Handed' }, offhand: { label: 'Off-Hand' }, thrown: { label: 'Thrown' }, 'thrown-offhand': { label: 'Offhand Throw' } },
}
// Since module 0.41.0 the damage card says what was chosen and spent in the module's own words, from
// its language file, as Foundry's i18n gives them.
{
  const flat = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) => (typeof value === 'object')
    ? flat(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]])
  game.i18n.translations = Object.fromEntries(flat(JSON.parse(readFileSync(`${process.env.MODULE_DIR}/lang/en.json`, 'utf8'))))
  game.i18n.format = function (key, data = {}) { return this.localize(key).replace(/\{(\w+)\}/g, (_, name) => String(data[name] ?? '')) }
}
settings.set('messageMode', 'gm')
settings.set('criticalDamageModifiers', false)
settings.set('criticalDamageMaxDice', false)
settings.set('attackRollVisibility', 'hideAC')
globalThis._loc ??= (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key))

const { Actor5e } = await import('./actor5e.mjs')
const { Activity, AttackActivity, SaveActivity, DamageActivity, HealActivity, Item5e, equip, port, screen } = await import('./activity5e.mjs')
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
    // Module 0.41.0 (its contract §8.2.2): damage on its own at a level, in a mode, with ammunition,
    // spending what it uses. Burning Hands, 3d6 and a die a level; a Potion of Healing, a Bonus Action,
    // its one use destroying it, two of them; Grip, a 2nd-level concentration spell that doesn't scale;
    // Ember Lance, whose damage reads the spell's level; a scroll of Burning Hands written at 3rd; Battle
    // Cry, its use spent only in a fight; a versatile Battleaxe; a light, thrown Dagger, three of them,
    // and one that returns; and plain Arrows, and arrows that return, beside the Arrows of Fire.
    { id: 'hands', name: 'Burning Hands', type: 'spell', system: { level: 1, method: 'spell', properties: [] },
      activities: [{ id: 'hands-save', type: 'save', save: ['dex'], dc: 13, damage: [{ number: 3, denomination: 6, types: ['fire'], scaling: 1 }] }] },
    { id: 'potion', name: 'Potion of Healing', type: 'consumable', system: { properties: [], quantity: 2, type: { value: 'potion' }, uses: { max: 1, spent: 0, autoDestroy: true } },
      activities: [{ id: 'potion-heal', type: 'heal', activation: { type: 'bonus', value: 1 }, healing: { number: 2, denomination: 4, bonus: '2', types: ['healing'] }, consumption: [{ type: 'itemUses', value: '1' }] }] },
    { id: 'grip', name: 'Grip', type: 'spell', system: { level: 2, method: 'spell', properties: ['concentration'] },
      activities: [{ id: 'grip-hit', type: 'damage', concentration: true, damage: [{ number: 1, denomination: 6, types: ['force'] }] }] },
    { id: 'lance', name: 'Ember Lance', type: 'spell', system: { level: 1, method: 'spell', properties: [] },
      activities: [{ id: 'lance-hit', type: 'damage', damage: [{ custom: { enabled: true, formula: '(@item.level)d8' }, types: ['fire'] }] }] },
    { id: 'scroll', name: 'Spell Scroll of Burning Hands', type: 'consumable', flags: { dnd5e: { scaling: 2, spellLevel: { value: 3, base: 1 } } },
      system: { properties: [], quantity: 1, level: 3, type: { value: 'scroll' }, uses: { max: 1, spent: 0, autoDestroy: true } },
      activities: [{ id: 'scroll-save', type: 'save', save: ['dex'], dc: 13, damage: [{ number: 3, denomination: 6, types: ['fire'], scaling: 1 }], consumption: [{ type: 'itemUses', value: '1' }] }] },
    feat('cry', 'Battle Cry', [{ id: 'cry-hit', type: 'damage', damage: [{ number: 1, denomination: 6, types: ['force'] }], consumption: [{ type: 'itemUses', value: '1', combatOnly: true }] }],
      { uses: { max: 2, spent: 0, recovery: [] } }),
    weapon('axe', 'Battleaxe', { id: 'axe-swing', versatile: 10, damage: [{ number: 1, denomination: 8, bonus: '@mod', types: ['slashing'] }] }, { properties: ['ver'] }),
    weapon('dagger', 'Dagger', { id: 'dagger-stab', damage: [{ number: 1, denomination: 4, bonus: '@mod', types: ['piercing'] }] }, { properties: ['lgt', 'thr'], quantity: 3 }),
    weapon('boomerang', 'Returning Dagger', { id: 'boomerang-stab', damage: [{ number: 1, denomination: 4, bonus: '@mod', types: ['piercing'] }] }, { properties: ['lgt', 'thr', 'ret'], quantity: 1 }),
    { id: 'arrows2', name: 'Arrows', type: 'consumable', system: { type: { value: 'ammo' }, quantity: 10, properties: [] }, activities: [] },
    { id: 'arrows3', name: 'Returning Arrows', type: 'consumable', system: { type: { value: 'ammo' }, quantity: 5, properties: ['ret'] }, activities: [] },
  ],
  spells: { spell1: { value: 2, max: 2, level: 1 }, spell2: { value: 1, max: 1, level: 2 } },
})
// Module 0.41.0: Wren, Alice's too, a pact-only warlock, one pact slot at 3rd level, with Hellish
// Rebuke, a 1st-level reaction cast with it.
const wren = add(new Actor5e({ id: 'wren', name: 'Wren', owners: ['alice'], mods: { cha: 3 } }))
equip(wren, {
  items: [{ id: 'rebuke', name: 'Hellish Rebuke', type: 'spell', system: { level: 1, method: 'pact', properties: [] },
    activities: [{ id: 'rebuke-save', type: 'save', activation: { type: 'reaction', value: 1 }, save: ['dex'], dc: 13, damage: [{ number: 2, denomination: 10, types: ['fire'], scaling: 1 }] }] }],
  spells: { pact: { value: 1, max: 1, level: 3 } },
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
// Since module 0.41.0 it reads damage on its own's choices too, unless a case says not.
const app = { events: [], polls: [], waiting: new Map(), wake: null, features: { commands: true, companions: 1, aloneChoices: 1 } }
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
  { id: 'camp-a', title: 'Ashlands', characters: ['thorin', 'wren'], rolls: true, attacks: true },
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

// Changed on purpose (round 0.41.0 §8.2.4): Thorin's, as Wren is the campaign's too.
const sheet = app.events.filter(e => (e.type === 'character.updated') && (e.campaign.id === 'camp-a') && (e.data.character.id === 'thorin')).at(-1).data.character.sheet
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

/* -------------------------------------------- */
/*  Choices (module 0.41.0)                     */
/* -------------------------------------------- */

// Round 0.41.0 §8.2.2, with round.v1.md's weapon cases 6-8: damage on its own at a level, in a mode,
// with ammunition, and spending what it uses, for an app that answered `aloneChoices: 1`.
const { characterSheet } = await import(`${MODULE}/scripts/sheet.mjs`)
const { slimSheet } = await import(`${MODULE}/scripts/sheet-slim.mjs`)
const { expandSheet } = await import('./slim-expand.mjs')
const { send: post } = await import(`${MODULE}/scripts/transport.mjs`)
/** Every row of a sheet that has a tableDamage. */
const rowsIn = whole => {
  const found = []
  JSON.stringify(whole, (key, value) => {
    if (value && (typeof value === 'object') && Object.hasOwn(value, 'tableDamage')) found.push(value)
    return value
  })
  return found
}
const rowIn = (whole, id) => rowsIn(whole).find(row => (row.activity?.id === id) || (row.attackId === id) || (row.id === id))
const formulasOf = plan => plan?.rolls.map(roll => roll.formula) ?? null
const sheetOf = (actor = thorin) => characterSheet(actor, undefined, { aloneChoices: true })
const sentSheet = (id = 'thorin') => app.events.filter(e => (e.type === 'character.updated') && (e.campaign.id === 'camp-a') && (e.data.character.id === id)).at(-1)?.data.character.sheet
const slotOf = (actor, key) => actor.system.spells[key].value
const setSlot = (actor, key, value) => { actor.system.spells[key].value = value }
const aloneOf = fields => send({ id: `alone-${++ids}`, actorId: 'thorin', kind: 'itemDamage', ...plain, ...fields })
const hands = fields => aloneOf({ item: 'hands', activity: 'hands-save', ...fields })
const rebuke = fields => send({ id: `alone-${++ids}`, actorId: 'wren', kind: 'itemDamage', item: 'rebuke', activity: 'rebuke-save', ...plain, ...fields })
const d = (faces, ...results) => ({ faces, results })
const FOUR = [d(6, 3, 5, 2, 6)]
const THREE = [d(6, 3, 5, 2)]
const usageCards = since => [...messages.values()].slice(since).filter(m => (m.type === 'usage') || (m.flags?.dnd5e?.messageType === 'usage'))
const failedAs = (made, reason, error = null) => assert.deepEqual([made.status, made.reason, made.error], ['failed', reason, error], JSON.stringify(made))
const doneOf = made => { assert.equal(made.status, 'done', JSON.stringify(made)); return messageOf(made.id) }
const chosenOf = card => card.flags['sending-stone'].chosen
/** The potions as they were made: two, their use unspent. */
const POTION = thorin.items.get('potion').toObject()
const restorePotion = () => thorin.items.set('potion', new Item5e(thorin, foundry.utils.deepClone(POTION)))

{
  // 1. The hello.
  const rolls = helloOf('camp-a').data.features.rolls
  assert.equal(rolls.aloneChoices, true, 'aloneChoices where itemDamage is offered')
  const keys = Object.keys(rolls)
  assert.equal(keys[keys.indexOf('midiPrompts') + 1], 'aloneChoices', 'right after midiPrompts')
  assert.equal(keys[keys.indexOf('aloneChoices') + 1], 'companionPrompts', 'companionPrompts after it')
  assert.equal(helloOf('camp-b').data.features.rolls.aloneChoices, false, 'not with attacks off')
  assert.equal(helloOf('camp-c').data.features.rolls.aloneChoices, false, 'nor with rolls off, in the off object')
  const [ashlands] = getCampaigns()
  const was = diceStatus.attacks
  diceStatus.attacks = false
  assert.equal(rollFeatures(ashlands).aloneChoices, false, 'nor before the damage self-test passes')
  diceStatus.attacks = was
  ok('the hello: features.rolls.aloneChoices true where itemDamage is offered, right after midiPrompts, companionPrompts after it; false with attacks off, rolls off and before the self-test')
}

// A ranged weapon's damage bonus, which a thrown weapon gets, as dnd5e's thrown mode makes it a ranged attack.
thorin.system.bonuses.rwak.damage = '1'
{
  // 2. The sheet.
  const full = sheetOf()
  const plan = id => rowIn(full, id).tableDamage
  const hands41 = plan('hands-save')
  assert.deepEqual(hands41.choices.map(each => [Object.keys(each), each.level, formulasOf(each.normal), each.critical]),
    [[['level', 'normal', 'critical'], 2, ['4d6'], null]], 'Burning Hands at 2nd: 4d6')
  assert.deepEqual(hands41.spends, ['slot'])
  assert.deepEqual([plan('potion-heal').choices, plan('potion-heal').spends], [[], ['uses']], 'the potion: its uses')
  assert.deepEqual([plan('ls-swing').choices, plan('ls-swing').spends], [[], []], 'the longsword: nothing')
  assert.deepEqual([plan('grip-hit').choices, plan('grip-hit').spends], [[], ['slot']], 'Grip: no level that changes it')
  assert.deepEqual([plan('scroll-save').choices, plan('scroll-save').spends, formulasOf(plan('scroll-save').normal)], [[], ['uses'], ['5d6']], 'the scroll: a fixed level, 5d6')
  const lance = plan('lance-hit')
  assert.deepEqual(lance.choices.map(each => [each.level, each.normal.rolls.map(roll => roll.dice)]), [[2, [[{ faces: 8, number: 2 }]]]], "Ember Lance at 2nd, its level read: two d8")
  assert.deepEqual([plan('cry-hit').choices, plan('cry-hit').spends], [[], ['uses']], 'Battle Cry: its uses')
  const axe = plan('axe-swing')
  assert.deepEqual(axe.choices.map(each => [Object.keys(each), each.attackMode, formulasOf(each.normal), formulasOf(each.critical)]),
    [[['attackMode', 'normal', 'critical'], 'twoHanded', ['1d10 + 3'], ['2d10 + 3']]], 'the Battleaxe two-handed; one-handed, the same as its own, left out')
  assert.deepEqual(axe.spends, [])
  const dagger = plan('dagger-stab')
  assert.deepEqual(dagger.choices.map(each => [each.attackMode, formulasOf(each.normal)]),
    [['offhand', ['1d4']], ['thrown', ['1d4 + 3 + 1']], ['thrown-offhand', ['1d4 + 1']]], 'the Dagger off-hand, thrown (a ranged attack\'s bonus), thrown off-hand')
  assert.deepEqual(dagger.spends, ['thrown'])
  assert.deepEqual(plan('boomerang-stab').spends, [], 'a returning dagger spends nothing thrown')
  const bow = plan('bow-shot')
  assert.deepEqual(bow.choices.map(each => [Object.keys(each), each.ammunition, formulasOf(each.normal)]),
    [[['ammunition', 'normal', 'critical'], 'arrows', ['1d8 + 2 + 1', '1d4']]], 'the Longbow (and a ranged attack\'s bonus) with Arrows of Fire; plain and returning arrows, the same as its own, left out')
  assert.deepEqual(bow.spends, ['ammunition'])
  const wren41 = rowIn(sheetOf(wren), 'rebuke-save').tableDamage
  assert.deepEqual([wren41.choices.map(each => [each.level, formulasOf(each.normal)]), wren41.spends], [[[3, ['4d10']]], ['slot']], "Wren's Hellish Rebuke at her pact slot's 3rd: 4d10")
  // Slim sheets keep both keys, and come back whole.
  const slim = slimSheet(full)
  assert.ok(rowsIn(slim).some(row => row.tableDamage?.choices?.length && row.tableDamage?.spends), 'the slim sheet keeps choices and spends')
  assert.deepEqual(expandSheet(JSON.parse(JSON.stringify(slim))), JSON.parse(JSON.stringify(full)), 'and expands back to the full sheet, as posted')
  // The gate: an app that answers no aloneChoices is sent 0.40.0's tableDamage, byte for byte; one
  // whose answer rises to 1 is sent the sheets again, with the keys.
  assert.ok(rowIn(sentSheet(), 'hands-save').tableDamage.choices, 'the sheet the app was sent carries them')
  const campaign = getCampaigns().find(({ id }) => id === 'camp-a')
  let from = app.events.length
  app.features = { commands: true, companions: 1 }
  post('bridge.heartbeat', {}, campaign, { sequenced: false })
  await until(() => app.events.slice(from).some(e => (e.type === 'character.updated') && (e.data.character.id === 'thorin')), 'the sheet sent again without them')
  await settle()
  assert.ok(rowsIn(sentSheet()).every(row => (row.tableDamage === null) || isDeepStrictEqual(Object.keys(row.tableDamage), ['normal', 'critical'])),
    'every tableDamage {normal, critical} alone')
  assert.ok(rowsIn(sentSheet('wren')).every(row => (row.tableDamage === null) || isDeepStrictEqual(Object.keys(row.tableDamage), ['normal', 'critical'])), "Wren's too")
  from = app.events.length
  app.features = { commands: true, companions: 1, aloneChoices: 1 }
  post('bridge.heartbeat', {}, campaign, { sequenced: false })
  await until(() => app.events.slice(from).some(e => (e.type === 'character.updated') && (e.data.character.id === 'thorin')), 'the sheet sent again with them')
  await settle()
  assert.deepEqual(rowIn(sentSheet(), 'hands-save').tableDamage.spends, ['slot'], 'the answer risen to 1: sent again with the keys')
  ok("the sheet, to an app that answered aloneChoices 1: Burning Hands' choices [{level 2, 4d6}] and spends [slot]; the potion's uses; the longsword nothing; Grip [slot] with no level entry; the scroll at its fixed 5d6, [uses]; Ember Lance's two d8 at 2nd; Battle Cry's uses; the Battleaxe two-handed alone, 1d10 + 3; the Dagger off-hand (1d4), thrown (1d4 + 3 + 1) and thrown off-hand, [thrown]; a returning dagger nothing; the Longbow with Arrows of Fire, [ammunition]; Wren's pact Hellish Rebuke at 3rd, 4d10; the slim sheet keeps both and expands back; an app that answers none is sent {normal, critical} alone, the sheets sent again as the answer changes")
}
{
  // 2, the size: a level-20 wizard's full sheet, with the keys and without.
  const mage = new Actor5e({ id: 'mage', name: 'Mage', owners: [], mods: { int: 5 } })
  const levels = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 1, 2]
  equip(mage, {
    spells: Object.fromEntries([4, 3, 3, 3, 3, 2, 2, 1, 1].map((max, index) => [`spell${index + 1}`, { value: max, max, level: index + 1 }])),
    items: levels.map((level, n) => ({ id: `spell-${n}`, name: `Spell ${n}`, type: 'spell', system: { level, method: 'spell', properties: [] },
      activities: [{ id: `spell-${n}-save`, type: 'save', save: ['dex'], dc: 19, damage: [{ number: 2 + (n % 4), denomination: [6, 8, 10][n % 3], types: [TYPES[n % TYPES.length]], scaling: 1 }] }] })),
  })
  const plainSheet = JSON.stringify(characterSheet(mage))
  const keyed = JSON.stringify(characterSheet(mage, undefined, { aloneChoices: true }))
  const added = keyed.length - plainSheet.length
  // Printed for the record: a stand-in's sheet is far smaller than dnd5e's own, so only what's added
  // is held to a bound here.
  console.log(`the level-20 wizard's sheet: ${plainSheet.length} bytes without the keys, ${keyed.length} with (${added} added, ${(100 * added / plainSheet.length).toFixed(1)}% of the stand-in's)`)
  assert.ok(added <= 64 * 1024, 'at most 64 KB added')
  ok("the size of a level-20 wizard's full sheet with twenty damaging spells, with and without the keys, printed: at most 64 KB added")
}
{
  // 2, past MOST_ALONE_CHOICES: a crossbow with seventy kinds of bolt, each its own damage.
  const quartermaster = new Actor5e({ id: 'quartermaster', name: 'Quartermaster', owners: [], mods: { dex: 2 } })
  equip(quartermaster, {
    items: [
      weapon('crossbow', 'Heavy Crossbow', { id: 'crossbow-shot', ability: 'dex', actionType: 'rwak', damage: [{ number: 1, denomination: 10, bonus: '@mod', types: ['piercing'] }] }, { properties: ['amm'], attackType: 'ranged' }),
      ...Array.from({ length: 70 }, (_, n) => ({ id: `bolt-${n}`, name: `Bolt ${String(n).padStart(2, '0')}`, type: 'consumable',
        system: { type: { value: 'ammo' }, quantity: 5, properties: [], damage: { base: { number: 1, denomination: 4, types: [TYPES[n % TYPES.length]] } } }, activities: [] })),
    ],
  })
  const crossbow = rowIn(characterSheet(quartermaster, undefined, { aloneChoices: true }), 'crossbow-shot').tableDamage
  assert.deepEqual([crossbow.choices, crossbow.spends, formulasOf(crossbow.normal)], [undefined, ['ammunition'], ['1d10 + 2']], 'no choices past 64, its own plan and what it spends kept')
  ok('a row past MOST_ALONE_CHOICES, a crossbow with seventy bolts each its own damage: no choices, its own plan and spends kept')
}

{
  // 3. A level.
  let made = await hands({ slot: 'spell2', dice: FOUR })
  let card = doneOf(made)
  assert.deepEqual([card.rolls[0].formula, cardTargets(card), card.flags['sending-stone'].alone], ['4d6', [], true], "dnd5e's card, 4d6, no targets, on its own")
  assert.equal(card.flavor, 'Burning Hands - Damage Roll · 2nd Level · nothing spent')
  assert.deepEqual(chosenOf(card), { level: 2, consume: false })
  assert.deepEqual([slotOf(thorin, 'spell2'), made.alone], [1, undefined], 'nothing spent, no alone in the result')
  failedAs(await hands({ slot: 'spell2', dice: THREE }), 'invalid', 'dice')
  made = await hands({ slot: 'spell1', dice: THREE })
  card = doneOf(made)
  assert.deepEqual([card.rolls[0].formula, card.flavor], ['3d6', 'Burning Hands - Damage Roll · 1st Level · nothing spent'], "the spell's own level, its base")
  ok("a level: Burning Hands at 2nd with 4d6, dnd5e's card 4d6 with no targets, its flavor \"· 2nd Level · nothing spent\", chosen {level 2, consume false}, nothing spent; the base dice at 2nd invalid dice; at 1st, the base")

  // 4. Spending a slot.
  const since = messages.size
  made = await hands({ slot: 'spell2', consume: true, dice: FOUR })
  card = doneOf(made)
  assert.deepEqual([slotOf(thorin, 'spell2'), made.alone, usageCards(since).length], [0, { spent: ['slot'] }, 0], 'its slot spent, no usage card')
  assert.equal(card.flavor, 'Burning Hands - Damage Roll · 2nd Level · spell slot spent')
  assert.deepEqual(chosenOf(card), { level: 2, consume: true, spent: ['slot'] })
  const before = messages.size
  made = await hands({ slot: 'spell2', consume: true, dice: FOUR })
  assert.deepEqual([made.status, made.reason], ['failed', 'consume'])
  assert.ok(String(made.error).includes('SpellCastNoSlots'), "dnd5e's own message")
  assert.equal(messages.size, before, 'nothing rolled')
  card = doneOf(await hands({ slot: 'spell2', dice: FOUR }))
  assert.equal(slotOf(thorin, 'spell2'), 0)
  ok('spending a slot: Burning Hands at 2nd with consume, 2nd-level slots 1 → 0, alone {spent: [slot]}, no usage card, the flavor ending "· spell slot spent"; again "consume" with dnd5e\'s message, nothing rolled; without consume, rolled, nothing spent')

  // 5. Pact magic.
  const TEN4 = [d(10, 1, 2, 3, 4)]
  const TEN2 = [d(10, 5, 6)]
  made = await rebuke({ slot: 'pact', consume: true, dice: TEN4 })
  card = doneOf(made)
  assert.deepEqual([slotOf(wren, 'pact'), made.alone, card.rolls[0].formula, chosenOf(card).level], [0, { spent: ['slot'] }, '4d10', 3], 'its pact slot, 4d10 at 3rd')
  setSlot(wren, 'pact', 1)
  made = await rebuke({ consume: true, dice: TEN4 })
  card = doneOf(made)
  assert.deepEqual([slotOf(wren, 'pact'), card.rolls[0].formula, chosenOf(card).level], [0, '4d10', 3], 'no slot named: the default slot, scaled and spent')
  setSlot(wren, 'pact', 1)
  failedAs(await rebuke({ consume: true, dice: TEN2 }), 'invalid', 'dice')
  made = await rebuke({ dice: TEN2 })
  card = doneOf(made)
  assert.deepEqual([slotOf(wren, 'pact'), card.rolls[0].formula, card.flavor, made.alone], [1, '2d10', 'Hellish Rebuke - Damage Roll · nothing spent', undefined], "an older app's request: its own level, nothing spent")
  ok("pact magic: Wren's Hellish Rebuke at her pact slot with consume, 4d10, the slot spent; no slot named with consume, the default slot's level and spend; then the base 2d10 invalid dice; neither field, 2d10 at its own level, nothing spent")
}
{
  // 6. Concentration.
  const grip = fields => aloneOf({ item: 'grip', activity: 'grip-hit', dice: [d(6, 4)], ...fields })
  const effects = () => [...thorin.concentration.effects.values()]
  setSlot(thorin, 'spell2', 1)
  let made = await grip({ consume: true })
  let card = doneOf(made)
  assert.deepEqual([effects().map(effect => effect.flags.dnd5e.item.data), made.alone], [['grip-hit'], { spent: ['slot'], concentrating: true }], "Grip's concentration begun")
  assert.equal(card.flavor, 'Grip - Damage Roll · 2nd Level · spell slot spent · concentrating')
  assert.deepEqual(chosenOf(card), { level: 2, consume: true, spent: ['slot'], concentrating: true })
  for (const effect of effects()) await thorin.endConcentration(effect.id)
  const other = await thorin.beginConcentrating(thorin.items.get('hands').system.activities.get('hands-save'))
  setSlot(thorin, 'spell2', 1)
  made = await grip({ consume: true })
  doneOf(made)
  assert.deepEqual(effects().map(effect => effect.flags.dnd5e.item.data), ['grip-hit'], 'at the limit: the other ended, Grip\'s begun')
  assert.ok(!effects().includes(other))
  for (const effect of effects()) await thorin.endConcentration(effect.id)
  setSlot(thorin, 'spell2', 1)
  made = await grip({})
  doneOf(made)
  assert.deepEqual([effects().length, slotOf(thorin, 'spell2')], [0, 1], 'without consume: none begun')
  ok('concentration: Grip with consume begins it, alone {spent: [slot], concentrating: true}, the flavor ending "· concentrating"; at the limit the other one ended and Grip\'s begun, as dnd5e\'s use; without consume none')
}
if (MIDI) {
  // 13. Midi-QOL's Bonus Actions and reactions, where it enforces them, in a fight.
  const potion = fields => aloneOf({ item: 'potion', activity: 'potion-heal', dice: [d(4, 2, 3)], ...fields })
  midi.settings.enforceBonusActions = 'all'
  midi.usedBonus.add('thorin')
  const before = messages.size
  failedAs(await potion({ consume: true }), 'bonus-action')
  assert.equal(messages.size, before, 'nothing rolled')
  let marks = midi.bonusMarks.length
  doneOf(await potion({}))
  assert.equal(midi.bonusMarks.length, marks, 'without consume: neither checked nor marked')
  midi.usedBonus.delete('thorin')
  doneOf(await potion({ consume: true }))
  assert.deepEqual(midi.bonusMarks.slice(marks), ['thorin'], 'with consume: marked')
  midi.settings.enforceReactions = 'all'
  combatant(fight, 'cb-wren', wren)
  midi.usedReaction.add('wren')
  failedAs(await rebuke({ slot: 'pact', consume: true, dice: [d(10, 1, 2, 3, 4)] }), 'reaction')
  midi.usedReaction.delete('wren')
  doneOf(await rebuke({ slot: 'pact', consume: true, dice: [d(10, 1, 2, 3, 4)] }))
  assert.deepEqual(midi.reactionMarks, ['wren'], 'its reaction marked')
  setSlot(wren, 'pact', 1)
  fight.combatants.delete('cb-wren')
  const inCombat = Object.getOwnPropertyDescriptor(thorin, 'inCombat')
  Object.defineProperty(thorin, 'inCombat', { configurable: true, value: false })
  midi.usedBonus.add('thorin')
  marks = midi.bonusMarks.length
  doneOf(await potion({ consume: true }))
  assert.equal(midi.bonusMarks.length, marks, 'out of a fight: neither checked nor marked')
  Object.defineProperty(thorin, 'inCombat', inCombat)
  midi.usedBonus.clear()
  midi.usedReaction.clear()
  midi.settings.enforceBonusActions = 'none'
  midi.settings.enforceReactions = 'none'
  restorePotion()
  ok("Midi-QOL's economy with consume: Enforce bonus actions \"all\", Thorin's used, the potion refused \"bonus-action\", nothing rolled; without consume rolled, nothing marked; unused, marked; Enforce reactions \"all\", Wren's used, Hellish Rebuke refused \"reaction\", unused marked; out of a fight neither")
}
{
  // 7. Uses.
  const potion = () => aloneOf({ item: 'potion', activity: 'potion-heal', consume: true, dice: [d(4, 2, 3)] })
  let made = await potion()
  const card = doneOf(made)
  if (DND5E6) assert.equal(card.type, 'healing')
  else assert.equal(card.flags.dnd5e.roll.type, 'healing')
  assert.deepEqual([thorin.items.get('potion').system.quantity, made.alone], [1, { spent: ['uses'] }], 'a healing card, one potion fewer')
  assert.equal(card.flavor, 'Potion of Healing - Healing Roll · use spent')
  made = await potion()
  doneOf(made)
  assert.deepEqual([thorin.items.has('potion'), made.alone], [false, { spent: ['uses'] }], 'its last: deleted')
  ok("uses: the potion's healing with consume, a healing card, quantity 2 → 1, [uses]; its last deleted, [uses]")

  // 8. A use spent only in a fight.
  const cry = () => aloneOf({ item: 'cry', activity: 'cry-hit', consume: true, dice: [d(6, 4)] })
  const inCombat = Object.getOwnPropertyDescriptor(thorin, 'inCombat')
  Object.defineProperty(thorin, 'inCombat', { configurable: true, value: false })
  made = await cry()
  doneOf(made)
  assert.deepEqual([thorin.items.get('cry').system.uses.spent, made.alone], [0, { spent: [] }], 'out of a fight: unspent')
  Object.defineProperty(thorin, 'inCombat', inCombat)
  made = await cry()
  doneOf(made)
  assert.deepEqual([thorin.items.get('cry').system.uses.spent, made.alone], [1, { spent: ['uses'] }], 'in a fight: spent')
  ok('a use spent only in a fight: Battle Cry with consume out of a fight unspent, spent []; in a fight [uses]')

  // 9. A scroll.
  failedAs(await aloneOf({ item: 'scroll', activity: 'scroll-save', slot: 'spell1', dice: [d(6, 1, 2, 3, 4, 5)] }), 'slot')
  made = await aloneOf({ item: 'scroll', activity: 'scroll-save', consume: true, dice: [d(6, 1, 2, 3, 4, 5)] })
  assert.deepEqual([doneOf(made).rolls[0].formula, thorin.items.has('scroll'), made.alone], ['5d6', false, { spent: ['uses'] }], 'at its 3rd level, the scroll gone')
  ok('a scroll: a slot named "slot"; with consume 5d6 at its fixed 3rd level, the scroll deleted, [uses]')

  // 10. Damage that reads the level.
  made = await aloneOf({ item: 'lance', activity: 'lance-hit', slot: 'spell2', dice: [d(8, 3, 4)] })
  assert.deepEqual(doneOf(made).rolls[0].dice.map(die => [die.faces, die.number]), [[8, 2]], 'two d8 at 2nd')
  failedAs(await aloneOf({ item: 'lance', activity: 'lance-hit', slot: 'spell2', dice: [d(8, 3)] }), 'invalid', 'dice')
  ok("damage that reads the level: Ember Lance at 2nd, two d8 on dnd5e's card; one d8 invalid dice")
}
{
  // 11. Vetoes.
  setSlot(thorin, 'spell2', 1)
  const veto = Hooks.on('dnd5e.preActivityConsumption', () => false)
  let made = await hands({ slot: 'spell2', consume: true, dice: FOUR })
  Hooks.off('dnd5e.preActivityConsumption', veto)
  let card = doneOf(made)
  assert.deepEqual([slotOf(thorin, 'spell2'), made.alone, card.flavor], [1, { spent: [] }, 'Burning Hands - Damage Roll · 2nd Level · nothing spent'], 'vetoed before: nothing written')
  const after = Hooks.on('dnd5e.postActivityConsumption', () => false)
  made = await hands({ slot: 'spell2', consume: true, dice: FOUR })
  Hooks.off('dnd5e.postActivityConsumption', after)
  card = doneOf(made)
  assert.deepEqual([slotOf(thorin, 'spell2'), made.alone, card.flavor], [0, { spent: ['slot'] }, 'Burning Hands - Damage Roll · 2nd Level · spell slot spent'], 'vetoed after writing: spent all the same')
  ok("vetoes: dnd5e.preActivityConsumption false, rolled, nothing written, spent [], \"· nothing spent\"; dnd5e.postActivityConsumption false after writing, the slot spent, [slot], \"· spell slot spent\"")

  // 12. A race: the slot spent between the roll and the spend.
  setSlot(thorin, 'spell2', 1)
  const race = Hooks.on('dnd5e.rollDamage', () => setSlot(thorin, 'spell2', 0))
  const notes = screen.notifications.length
  made = await hands({ slot: 'spell2', consume: true, dice: FOUR })
  Hooks.off('dnd5e.rollDamage', race)
  doneOf(made)
  assert.deepEqual([made.alone, screen.notifications.length], [{ spent: [] }, notes], 'nothing spent, no notification on the Gamemaster\'s screen')
  ok('a race: the slot spent between the roll and the spend, done with spent [], no notification')

  // 14. Shapes.
  failedAs(await hands({ slot: 3, dice: THREE }), 'invalid', 'slot')
  failedAs(await hands({ consume: 'yes', dice: THREE }), 'invalid', 'consume')
  failedAs(await hands({ consume: false, dice: THREE }), 'invalid', 'consume')
  failedAs(await aloneOf({ item: 'axe', activity: 'axe-swing', attackMode: '!', dice: [d(8, 3)] }), 'invalid', 'attack-mode')
  failedAs(await aloneOf({ item: 'bow', activity: 'bow-shot', ammunition: '', dice: [d(8, 3)] }), 'invalid', 'ammo')
  failedAs(await hands({ use: 'some-use', dice: THREE }), 'invalid', 'item')
  ok('shapes: a slot not a key, invalid slot; consume not true, invalid consume; a mode not a key, invalid attack-mode; ammunition not an id, invalid ammo; a use named, invalid item')
}
{
  // Weapons (round.v1.md §8.2.2 cases 6-8, built in 0.41.0). 6. A mode.
  const axe = fields => aloneOf({ item: 'axe', activity: 'axe-swing', ...fields })
  const before = MIDI ? midi.made.length : 0
  let made = await axe({ attackMode: 'twoHanded', dice: [d(10, 7)] })
  let card = doneOf(made)
  assert.deepEqual([card.rolls[0].formula, card.flavor, chosenOf(card)], ['1d10 + 3', 'Battleaxe - Damage Roll · Two-Handed · nothing spent', { attackMode: 'twoHanded', consume: false }],
    `two-handed, its versatile die${MIDI ? ", kept under Midi-QOL" : ''}`)
  if (MIDI) {
    thorin.effectsMade = [{ disabled: false, isSuppressed: false, system: { changes: [{ key: 'flags.midi-qol.rollModifiers.damage.all.all', value: 'min3', priority: 20 }] } }]
    made = await axe({ attackMode: 'twoHanded', dice: [d(10, 1)] })
    thorin.effectsMade = []
    assert.deepEqual([doneOf(made).rolls[0].formula, doneOf(made).rolls[0].total], ['1d10min3 + 3', 6], "Midi's min3 on the versatile die")
    assert.equal(midi.made.length, before, 'no workflow')
  }
  assert.equal(doneOf(await axe({ attackMode: 'oneHanded', dice: [d(8, 5)] })).rolls[0].formula, '1d8 + 3', 'one-handed, its own')
  failedAs(await axe({ attackMode: 'thrown', dice: [d(8, 5)] }), 'mode')
  failedAs(await hands({ attackMode: 'twoHanded', dice: THREE }), 'mode')
  ok(`a mode: the Battleaxe two-handed, 1d10 + 3 on dnd5e's card, "· Two-Handed" in its flavor${MIDI ? ", under Midi-QOL too, with Midi's min3 as 1d10min3 + 3, no workflow" : ''}; one-handed its own 1d8 + 3; a mode the axe hasn't, or on Burning Hands, "mode"`)

  // 7. Thrown.
  const dagger = fields => aloneOf({ item: 'dagger', activity: 'dagger-stab', ...fields })
  made = await dagger({ attackMode: 'thrown', consume: true, dice: [d(4, 2)] })
  card = doneOf(made)
  assert.deepEqual([card.rolls[0].formula, thorin.items.get('dagger').system.quantity, made.alone], ['1d4 + 3 + 1', 2, { spent: ['thrown'] }], 'thrown: a ranged attack\'s bonus, one dagger fewer')
  assert.equal(card.flavor, 'Dagger - Damage Roll · Thrown · thrown weapon spent')
  assert.equal(doneOf(await dagger({ attackMode: 'offhand', dice: [d(4, 2)] })).rolls[0].formula, '1d4', 'off-hand: no modifier')
  made = await aloneOf({ item: 'boomerang', activity: 'boomerang-stab', attackMode: 'thrown', consume: true, dice: [d(4, 2)] })
  doneOf(made)
  assert.deepEqual([thorin.items.get('boomerang').system.quantity, made.alone], [1, { spent: [] }], 'a returning dagger kept')
  thorin.items.get('dagger').updateSource({ 'system.quantity': 0 })
  failedAs(await dagger({ attackMode: 'thrown', consume: true, dice: [d(4, 2)] }), 'consume')
  thorin.items.get('dagger').updateSource({ 'system.quantity': 3 })
  ok('thrown: the Dagger thrown with consume, 1d4 + 3 + 1, quantity 3 → 2, [thrown], "· Thrown · thrown weapon spent"; off-hand 1d4; a returning dagger kept, spent []; none left "consume"')

  // 8. Ammunition.
  const bow = fields => aloneOf({ item: 'bow', activity: 'bow-shot', ...fields })
  const FIRE = [d(8, 5), d(4, 3)]
  // Under Midi-QOL, an attack earlier in the run fired one already.
  const arrows = thorin.items.get('arrows').system.quantity
  made = await bow({ ammunition: 'arrows', consume: true, dice: FIRE })
  card = doneOf(made)
  assert.deepEqual([card.rolls.map(roll => roll.formula), thorin.items.get('arrows').system.quantity, made.alone], [['1d8 + 2 + 1', '1d4'], arrows - 1, { spent: ['ammunition'] }], 'its fire too, one arrow fewer')
  assert.deepEqual([card.flavor, chosenOf(card)], ['Longbow - Damage Roll · Arrows of Fire · ammunition spent', { ammunition: 'arrows', consume: true, spent: ['ammunition'] }])
  thorin.items.get('arrows').updateSource({ 'system.quantity': 1, 'system.uses.autoDestroy': true })
  made = await bow({ ammunition: 'arrows', consume: true, dice: FIRE })
  doneOf(made)
  assert.deepEqual([thorin.items.has('arrows'), made.alone], [false, { spent: ['ammunition'] }], 'its last, destroying itself: deleted')
  thorin.items.get('arrows2').updateSource({ 'system.quantity': 0 })
  failedAs(await bow({ ammunition: 'arrows2', consume: true, dice: [d(8, 5)] }), 'ammo')
  doneOf(await bow({ ammunition: 'arrows2', dice: [d(8, 5)] }))
  failedAs(await bow({ ammunition: 'potion-none', dice: [d(8, 5)] }), 'ammo')
  failedAs(await hands({ ammunition: 'arrows2', dice: THREE }), 'ammo')
  made = await bow({ ammunition: 'arrows3', consume: true, dice: [d(8, 5)] })
  doneOf(made)
  assert.deepEqual([thorin.items.get('arrows3').system.quantity, made.alone], [5, { spent: [] }], 'returning arrows kept')
  ok('ammunition: the Longbow with Arrows of Fire and consume, 1d8 + 2 + 1 and 1d4 on the card, one arrow fewer, [ammunition], "· Arrows of Fire · ammunition spent"; its last destroying itself deleted; plain arrows at 0 with consume "ammo", without rolled; ammunition not the bow\'s, or on Burning Hands, "ammo"; returning arrows kept, spent []')
}

console.log(`alone${MIDI ? ' (Midi)' : ''}${DND5E6 ? ' (dnd5e 6)' : ''}: done, ${oks} ok`)
process.exit(0)
