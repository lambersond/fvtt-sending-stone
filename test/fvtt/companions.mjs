// A character's companions (module 0.36.0, its contract §2, §4.1-§4.7, §5, §6.2-§6.7, §6.11-§6.12):
// the creatures it summons, while their tokens are on the active scene, and the NPCs its player owns
// in Foundry by name, listed in the hello and `companions.listed`, each sent in `companion.updated`
// from its live actor, a token's synthetic actor for an unlinked token, to an app that reads them,
// `features.companions`; commanded from the app with `of`, on that live actor, as its character's
// player; in combat and chat to such an app alone; and kept right after their character in initiative
// where the Gamemaster chose so. The real module; dnd5e 5.3.3's real dice classes, or 6.0.5's with
// DND5E6=1; dnd5e's actors, items and activities ported (actor5e.mjs, activity5e.mjs); scenes,
// tokens, synthetic actors and their hooks as v14 has them (token-core.mjs); with MIDI=1,
// midi-fake.mjs's workflow; a stand-in Foundry core and app. Run with --import ./unref-timers.mjs
// --import ./dnd5e-register.mjs, and SLIM_CHECK=1 (every full sheet posted, a companion's among
// them, slims and expands back). Since module 0.45.0, two campaigns in one world: a character's
// players by their own ids, never through `default`, else whom it's assigned to; and a public card
// another campaign's alone kept from a campaign's chat. Since module 0.46.0, those players wherever a
// campaign reads who plays a character. Since module 0.51.0, to an app that answers companions: 3,
// companions on every scene, each saying whether it's away, and the hello's companionsEverywhere.
// Since module 0.54.0, to an app that answers companions: 4, the Gamemaster's constant companions,
// marked on Manage Campaigns, with a token or without, and the hello's companionsConstant.
import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import { settings, user, users, actors } from './stub.mjs'
import { click, document as page, drop, find, openSettings, save, view } from './settings-app.mjs'
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
// The module's long waits, shortened a hundredfold; its 250 ms settling kept as it is.
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms = 0, ...args) => realSetTimeout(fn, ms >= 1000 ? ms / 100 : ms, ...args)
const wait = ms => new Promise(resolve => realSetTimeout(resolve, ms))
globalThis.document = { hidden: false }
// A clock the heartbeat case moves on.
let clock = 0
const realNow = Date.now
Date.now = () => realNow() + clock

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
const TYPES = ['slashing', 'piercing', 'bludgeoning', 'fire', 'thunder', 'force']
CONFIG.DND5E = {
  skills: { prc: { label: 'Perception', ability: 'wis' } },
  tools: {},
  abilities: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(key => [key, { label: key.toUpperCase() }])),
  defaultAbilities: { initiative: 'dex' },
  spellcasting: { spell: { exclusive: { spells: false, slots: false } }, pact: { exclusive: { spells: false, slots: false } } },
  damageTypes: Object.fromEntries(TYPES.map(type => [type, { label: type.charAt(0).toUpperCase() + type.slice(1) }])),
  healingTypes: { healing: { label: 'Healing' } },
  actorSizes: { tiny: { label: 'Tiny' }, medium: { label: 'Medium' }, large: { label: 'Large' }, huge: { label: 'Huge' } },
  // config.mjs:1053-1072: a legendary or mythic action spends the creature's legendary actions.
  activityActivationTypes: {
    action: { label: 'Action' }, bonus: { label: 'Bonus Action' }, reaction: { label: 'Reaction' },
    legendary: { label: 'Legendary Action', consume: { property: 'resources.legact' } },
    mythic: { label: 'Mythic Action', consume: { property: 'resources.legact' } },
    lair: { label: 'Lair Action' },
  },
  characterFlags: { elvenAccuracy: { abilities: ['dex', 'int', 'wis', 'cha'] } },
}
settings.set('messageMode', 'public')
settings.set('criticalDamageModifiers', false)
settings.set('criticalDamageMaxDice', false)
settings.set('attackRollVisibility', 'hideAC')
settings.set('initiativeDexTiebreaker', true)
globalThis._loc ??= (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key))

const { Actor5e } = await import('./actor5e.mjs')
const { AttackActivity, SaveActivity, DamageActivity, HealActivity, Item5e, equip, port } = await import('./activity5e.mjs')
const { midi, placeables, installMidi } = await import('./midi-fake.mjs')
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
// Foundry's escapeHTML (common/utils/helpers.mjs), as a description's roll names where it's from.
foundry.utils.escapeHTML ??= value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[ch])
// Foundry drops a secret section where a description is enriched without secrets.
foundry.applications.ux.TextEditor = { implementation: { async enrichHTML(html, options = {}) {
  return options.secrets ? html : String(html ?? '').replace(/<section class="secret"[^>]*>[\s\S]*?<\/section>/g, '')
} } }
port.targets = true

const {
  activate, changeActor, changeBaseItem, changeDelta, combatOf, companionActor, createScene, createToken, faults, placeToken, scene, scenes,
} = await import('./token-core.mjs')

// ---- The users ----
users.activeGM = user('gm', 'Gamemaster', true)
users.get('gm').targets = new Set()
const alice = user('alice', 'Alice')
const bob = user('bob', 'Bob')
const dave = user('dave', 'Dave')
const pellp = user('pellp', 'Pell\'s player')
const quillp = user('quillp', 'Quill\'s player')
for (const n of [1, 2, 3]) user(`b${n}`, `Big ${n}`)
if (MIDI) installMidi()

// ---- The characters ----
const add = actor => { actors.set(actor.id, actor); return actor }
const weapon = (id, name, activity, system = {}) => ({
  id, name, type: 'weapon', system: { properties: [], quantity: 1, attackType: 'melee', description: { value: `<p>About ${name}.</p>` }, ...system }, activities: [activity],
})
const summonSpell = (id, name, activity) => ({
  id, name, type: 'spell', system: { level: 1, method: 'spell', properties: [] }, activities: [{ id: activity, type: 'summon' }],
})
// Thorin, Alice's: Find Familiar and Summon Dragon, and a longsword.
const thorin = add(new Actor5e({ id: 'thorin', name: 'Thorin', owners: ['alice'], mods: { str: 3, dex: 2, wis: 2 }, skills: { prc: { ability: 'wis' } } }))
alice.character = thorin
equip(thorin, {
  items: [
    summonSpell('findFamiliar', 'Find Familiar', 'ff-summon'),
    summonSpell('summonDragon', 'Summon Dragon', 'sd-summon'),
    weapon('longsword', 'Longsword', { id: 'ls-swing', damage: [{ number: 1, denomination: 8, bonus: '@mod', types: ['slashing'] }] }),
  ],
})
// Vex, Bob's.
const vex = add(new Actor5e({ id: 'vex', name: 'Vex', owners: ['bob'], mods: { dex: 3 }, skills: { prc: { ability: 'wis' } } }))
equip(vex, { items: [] })
bob.character = vex

/** npc.mjs:367-377, 444-446: a pool's max with one more in its lair, and what's left of it. */
function prepareNpc(actor) {
  const { resources } = actor.system
  if (!resources) return
  const lair = Number(Boolean(resources.lair?.value && resources.lair?.inside))
  for (const key of ['legact', 'legres']) {
    const pool = resources[key]
    if (!pool) continue
    if (pool.max) pool.max += lair
    Object.defineProperty(pool, 'value', { configurable: true, enumerable: true, get() { return Math.min(Math.max(this.max - this.spent, 0), this.max) } })
  }
}

// ---- Scenes and companions ----
const arena = scene('arena', { active: true })
const den = scene('den')
const SECRET = '<section class="secret"><p>A secret of the Gamemaster\'s.</p></section>'
const creature = (mods = {}) => ({ mods, skills: { prc: { ability: 'wis' } }, hp: { value: 12, max: 12, temp: 0 } })
// Brakka, a sidekick: linked, Alice's by id, with a greataxe and a roar her foes save against.
const brakka = companionActor('brakka', 'Brakka', {
  owners: ['alice'], linked: true, spec: { ...creature({ str: 3, dex: 1, con: 2 }), hp: { value: 30, max: 30, temp: 0 } },
  gear: { items: [
    weapon('greataxe', 'Greataxe', { id: 'cleave', damage: [{ number: 1, denomination: 12, bonus: '@mod', types: ['slashing'] }] },
      { description: { value: `<p>A heavy axe.</p>${SECRET}` } }),
    { id: 'roar', name: 'Roar', type: 'feat', system: { description: { value: '<p>A roar.</p>' } },
      activities: [{ id: 'roar-save', type: 'save', save: ['con'], dc: 13, affects: 'creature', count: 1, damage: [{ number: 2, denomination: 6, types: ['thunder'] }] }] },
  ] },
  system: { traits: { important: true }, details: { biography: { value: `<p>Brakka is loyal.</p>${SECRET}`, public: '<p>A loyal sidekick.</p>' }, type: { value: 'humanoid', label: 'Humanoid' }, cr: 2 } },
})
// A wolf, Alice's, unlinked, two of its tokens on the active scene, a third hidden.
const bite = { id: 'bite', damage: [{ number: 2, denomination: 4, bonus: '@mod', types: ['piercing'] }] }
const howl = { id: 'howl', name: 'Howl', type: 'feat', system: { description: { value: '<p>A howl.</p>' } },
  activities: [{ id: 'howl-use', type: 'utility', activation: { type: 'bonus', value: 1 }, affects: 'ally', count: 1 }] }
const wolf = companionActor('wolf', 'Wolf', { owners: ['alice'], linked: false, spec: creature({ str: 2, dex: 2 }), gear: { items: [weapon('jaws', 'Bite', bite), howl] } })
const wolf1 = placeToken(arena, wolf, { id: 'wolf1', name: 'Wolf' })
const wolf2 = placeToken(arena, wolf, { id: 'wolf2', name: 'Wolf' })
placeToken(arena, wolf, { id: 'wolf3', name: 'Wolf', hidden: true })
// A hound the Gamemaster owns, whose one token's delta gives Alice Owner.
const hound = companionActor('hound', 'Hound', { linked: false, spec: creature({ str: 1 }) })
const hound1 = placeToken(arena, hound, { id: 'hound1', name: 'Hound', delta: { ownership: { alice: 3 } } })
// The Bat, Find Familiar's template, and its summoned tokens: on the active scene with its own HP, and on another.
const SUMMONED = { dnd5e: { summon: { origin: 'Actor.thorin.Item.findFamiliar', activity: 'ff-summon' } } }
const bat = companionActor('bat', 'Bat', {
  owners: ['alice'], linked: false, flags: { dnd5e: { isAutoImported: true } }, spec: { ...creature({ dex: 2 }), hp: { value: 4, max: 4, temp: 0 } },
  gear: { items: [{ id: 'echo', name: 'Echolocation', type: 'feat', system: { uses: { max: 3, spent: 0, recovery: [] }, description: { value: '<p>Echoes.</p>' } },
    activities: [{ id: 'echo-use', type: 'utility', activation: { type: 'bonus', value: 1 }, consumption: [{ type: 'itemUses', value: '1' }] }] }] },
  system: { traits: { size: 'tiny' }, details: { type: { value: 'beast', label: 'Beast' } } },
})
const bat1 = placeToken(arena, bat, { id: 'bat1', name: 'Bat', delta: { flags: SUMMONED, system: { attributes: { hp: { value: 1 } } } } })
placeToken(den, bat, { id: 'bat2', name: 'Bat', delta: { flags: SUMMONED } })
// A token of the template placed by hand, not summoned: a summon's template is never an owned companion.
placeToken(arena, bat, { id: 'bat8', name: 'Bat' })
// An NPC everyone owns through its default only, a character-type actor Alice owns outside the
// campaign, and a polymorphed copy of Brakka.
companionActor('ghost', 'Ghost', { ownership: { default: 3 }, linked: true })
companionActor('ranger', 'Ranger', { owners: ['alice'], linked: true, type: 'character' })
companionActor('brakkaWolf', 'Brakka (Wolf)', { owners: ['alice'], linked: true, flags: { dnd5e: { isPolymorphed: true } } })
// The Draconic Spirit, summoned by Thorin's Summon Dragon, owned by no player. Its claws' description
// has a save and a roll its player acts on, as dnd5e enriches them, and a save in a secret section.
const SAVE_LINK = (ability, dc, label) => `<span class="roll-link-group" data-type="save" data-ability="${ability}" data-dc="${dc}"><a class="roll-link" data-action="roll"><i class="fa-solid fa-dice-d20" inert=""></i>${label}</a></span>`
const INLINE_ROLL = formula => `<a class="inline-roll roll" data-mode="roll" data-flavor="" data-formula="${formula}"><i class="fas fa-dice-d20"></i>${formula}</a>`
const CLAWS = `<p>Claws: a ${SAVE_LINK('dex', 14, 'DC 14 Dexterity')} saving throw, or ${INLINE_ROLL('1d4')} more.</p><section class="secret"><p>A secret of the Gamemaster's: a ${SAVE_LINK('wis', 13, 'DC 13 Wisdom')} saving throw.</p></section>`
const draconic = companionActor('draconic', 'Draconic Spirit', {
  linked: false, spec: creature({ str: 4 }),
  gear: { items: [weapon('rend', 'Rend', { id: 'rend-swing', damage: [{ number: 1, denomination: 6, bonus: '4', types: ['piercing'] }] },
    { description: { value: CLAWS } })] },
  system: { details: { biography: { value: `<p>Spirit.</p>${SECRET}`, public: '<p>A spirit of dragonkind.</p>' } } },
})
placeToken(arena, draconic, { id: 'spirit1', name: 'Draconic Spirit', delta: { flags: { dnd5e: { summon: { origin: 'Actor.thorin.Item.summonDragon', activity: 'sd-summon' } } } } })

// The dragon, Dave's campaign character, with legendary actions and resistances, a lair it's in,
// and a Recharge 5–6 breath.
const legendary = (id, name, cost, extra = {}) => ({
  id, name, type: 'feat', system: { description: { value: `<p>${name}.</p>` } },
  activities: [{ id: `${id}-use`, type: 'utility', activation: { type: extra.type ?? 'legendary', value: cost }, ...extra.activity }],
})
const dragon = companionActor('dragon', 'Adult Red Dragon', {
  owners: ['dave'], linked: true, spec: { ...creature({ str: 8, dex: 0, con: 7 }), hp: { value: 256, max: 256, temp: 0 }, npc: { denomination: 12, max: 19, spent: 0 } },
  gear: { items: [
    { id: 'breath', name: 'Fire Breath', type: 'feat', system: { description: { value: '<p>Fire.</p>' } },
      activities: [{ id: 'breath-save', type: 'save', save: ['dex'], dc: 21, template: 'cone', affects: 'creature', damage: [{ number: 18, denomination: 6, types: ['fire'] }],
        uses: { max: 1, spent: 1, recovery: [{ period: 'recharge', type: 'recoverAll', formula: '5' }] } }] },
    legendary('tail', 'Tail Attack', 2),
    legendary('detect', 'Detect', 0),
    legendary('wing', 'Wing Attack', 2, { activity: { consumption: [{ type: 'attribute', target: 'resources.legact.value', value: '2' }] } }),
    legendary('mythic', 'Mythic Roar', 2, { type: 'mythic' }),
  ] },
  system: {
    details: { cr: 17, type: { value: 'dragon', label: 'Dragon' }, alignment: 'Chaotic Evil' },
    traits: { size: 'huge' },
    resources: { legact: { max: 3, spent: 0 }, legres: { max: 3, spent: 0 }, lair: { value: true, inside: true, initiative: 20 } },
  },
})
prepareNpc(dragon)

// Pell and Quill, each a character of a campaign of its own and the other's companion in the other's.
const pell = companionActor('pell', 'Pell', { owners: ['pellp', 'quillp'], linked: true, spec: creature({ dex: 1 }) })
const quill = companionActor('quill', 'Quill', { owners: ['pellp', 'quillp'], linked: true, spec: creature({ dex: 1 }) })

// A big campaign: three characters, each with twenty NPCs of their own, one with a name too long.
const big = []
for (const n of [1, 2, 3]) {
  const character = add(new Actor5e({ id: `big${n}`, name: `Big ${n}`, owners: [`b${n}`] }))
  equip(character, { items: [] })
  big.push(character.id)
  for (let i = 1; i <= ((n === 1) ? 19 : 20); i++) {
    companionActor(`npc${n}x${String(i).padStart(2, '0')}`, `Companion ${n}-${String(i).padStart(2, '0')} of a long and storied name`, { owners: [`b${n}`] })
  }
}
const LONG = 'L'.repeat(300)
companionActor('longname', LONG, { owners: ['b1'], img: `icons/${'x'.repeat(3000)}.webp` })

// A goblin, no one's.
const goblin = add(new Actor5e({ id: 'goblin', name: 'Goblin', mods: { dex: 2 }, hp: { value: 7, max: 7, temp: 0 } }))
goblin.type = 'npc'
equip(goblin, { ac: 13 })
const goblinToken = placeToken(arena, goblin, { id: 'gob1', name: 'Goblin', actorLink: true })
placeables.set(goblinToken.id, goblinToken.object)
if (MIDI) canvas.scene.tokens.size = placeables.size

// ---- The app ----
const app = { events: [], polls: [], waiting: new Map(), wake: null, features: { commands: true, companions: 1 }, hold: null, answers: {}, failing: null }
const json = body => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  if (String(url).endsWith('/api/events')) {
    if ((body.type === 'bridge.hello') && app.hold) { const held = app.hold; app.hold = null; await held }
    // A post the app fails for now, as one restarting does: not taken.
    if (await app.failing?.(body)) {
      return { ok: false, status: 503, statusText: 'Service Unavailable', headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ reason: 'unavailable', message: 'restarting' }) }
    }
    app.events.push(body)
    // As the app answers every post: with what it takes, its terms for sheets among them.
    return json({ features: app.answers[body.campaign?.id] ?? app.features })
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
  const end = realNow() + ms
  while (!test()) {
    if (realNow() > end) throw new Error(`Timed out waiting for ${what}`)
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
/** Commands queued at once, their results awaited together. */
async function sendAll(commands, campaign = 'camp-a') {
  app.waiting.set(campaign, [...(app.waiting.get(campaign) ?? []), ...commands])
  app.wake?.()
  await until(() => commands.every(command => results(command.id).length), 'their results')
  return commands.map(command => results(command.id)[0])
}
const plain = { mode: 0, explicit: false, extras: [] }
const skill = (fields = {}) => ({ id: `skill-${++ids}`, actorId: 'thorin', kind: 'skill', key: 'prc', ...plain, dice: [{ faces: 20, results: [11] }], ...fields })
const messageOf = id => [...messages.values()].find(m => m.flags?.['sending-stone']?.request === id)
const since = from => app.events.slice(from)
const ofType = (events, type, campaign = 'camp-a') => events.filter(e => (e.type === type) && (e.campaign.id === campaign))
const helloOf = (campaign = 'camp-a') => app.events.filter(e => (e.type === 'bridge.hello') && (e.campaign.id === campaign)).at(-1)
const listed = (from = 0, campaign = 'camp-a') => ofType(since(from), 'companions.listed', campaign)
const sheetsSent = (from = 0, campaign = 'camp-a') => ofType(since(from), 'companion.updated', campaign)
const keysOf = list => list.map(entry => entry.key)

// ---- Start-up ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('campaignSecrets', { 'camp-a': 'a-secret', 'camp-p': 'p-secret', 'camp-q': 'q-secret', 'camp-big': 'big-secret' })
settings.set('combatEvents', true)
settings.set('chatEvents', true)
const CAMPAIGNS = [
  { id: 'camp-a', title: 'Ashlands', characters: ['thorin', 'vex', 'dragon'], rolls: true, attacks: true, transfers: true },
  { id: 'camp-p', title: 'Pellmark', characters: ['pell'], rolls: true, attacks: true, companionInitiative: 'after' },
  { id: 'camp-q', title: 'Quillford', characters: ['quill'], rolls: true, attacks: true, companionInitiative: 'after' },
  { id: 'camp-big', title: 'Bigtown', characters: big, rolls: true, attacks: true },
]
settings.set('campaigns', CAMPAIGNS)
await Hooks.callAll('ready')
const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
const { getCampaigns } = await import(`${MODULE}/scripts/campaigns.mjs`)
const { companionList, companionsOf } = await import(`${MODULE}/scripts/creatures.mjs`)
const { followValue } = await import(`${MODULE}/scripts/creature-initiative.mjs`)
const { checkBridge } = await import(`${MODULE}/scripts/bridge.mjs`)
const { heartbeat } = await import(`${MODULE}/scripts/heartbeat.mjs`)
const { SHEET_TERMS_HOOK } = await import(`${MODULE}/scripts/constants.mjs`)
await until(() => app.polls.length > 0, 'the first fetch')
await settle()
assert.equal(diceStatus.ready, true, `self-test: ${diceStatus.error}`)
const ashlands = () => getCampaigns().find(c => c.id === 'camp-a')

/* -------------------------------------------- */
/*  The list                                    */
/* -------------------------------------------- */

const SUMMON = (itemId, item, activityId) => ({ itemId, item, activityId })
const entry = (key, kind, actorId, { tokenId = null, sceneId = null, uuid, name, img, summon = null, of = ['thorin'] } = {}) => ({
  key, of, kind, actorId, tokenId, sceneId, uuid: uuid ?? `Actor.${actorId}`, name, img: img ?? `${actorId}.webp`, summon,
})
const EXPECTED = [
  entry('brakka', 'owned', 'brakka', { name: 'Brakka' }),
  entry('arena-hound1', 'owned', 'hound', { tokenId: 'hound1', sceneId: 'arena', uuid: 'Scene.arena.Token.hound1.Actor.hound', name: 'Hound' }),
  entry('arena-wolf1', 'owned', 'wolf', { tokenId: 'wolf1', sceneId: 'arena', uuid: 'Scene.arena.Token.wolf1.Actor.wolf', name: 'Wolf' }),
  entry('arena-wolf2', 'owned', 'wolf', { tokenId: 'wolf2', sceneId: 'arena', uuid: 'Scene.arena.Token.wolf2.Actor.wolf', name: 'Wolf' }),
  entry('arena-bat1', 'summoned', 'bat', { tokenId: 'bat1', sceneId: 'arena', uuid: 'Scene.arena.Token.bat1.Actor.bat', name: 'Bat', summon: SUMMON('findFamiliar', 'Find Familiar', 'ff-summon') }),
  entry('arena-spirit1', 'summoned', 'draconic', { tokenId: 'spirit1', sceneId: 'arena', uuid: 'Scene.arena.Token.spirit1.Actor.draconic', name: 'Draconic Spirit', summon: SUMMON('summonDragon', 'Summon Dragon', 'sd-summon') }),
]
const hello = helloOf()
assert.deepEqual(hello.data.companions, EXPECTED)
assert.deepEqual(Object.keys(hello.data.companions[0]), ['key', 'of', 'kind', 'actorId', 'tokenId', 'sceneId', 'uuid', 'name', 'img', 'summon'])
// Changed on purpose (round 0.40.0 §10.2): a polymorphed campaign character's form is no companion
// either: the dragon, Dave's character, transformed into a linked NPC Dave owns, as dnd5e copies its
// type and ownership onto the form, which names the dragon its original.
companionActor('dragonForm000000', 'Adult Red Dragon (Giant Ape)', { owners: ['dave'], linked: true, flags: { dnd5e: { isPolymorphed: true, originalActor: 'dragon' } } })
assert.ok(!companionsOf(ashlands()).some(({ entry: listedEntry }) => listedEntry.actorId === 'dragonForm000000'), "the dragon's form, no one's companion")
actors.delete('dragonForm000000')
ok("the hello lists Thorin's companions exactly: Brakka, owned and linked; the Hound's token, owned through its delta; the two Wolf tokens, keyed <scene>-<token>; the Bat's token, summoned by Find Familiar; and the Draconic Spirit, summoned though no player owns it: owned then summoned, each by name; never the Bat's template, nor a token of it placed by hand, the Bat on another scene, the hidden wolf, an NPC owned through its default, a character-type actor, a polymorphed Brakka or a campaign character, nor a campaign character's own form")
assert.ok(hello.data.companions.every(each => each.of.length === 1 && each.of[0] === 'thorin'), "none is Vex's")
assert.deepEqual(companionsOf(ashlands()).map(({ entry: listedEntry }) => listedEntry.of), EXPECTED.map(() => ['thorin']))
ok("Vex's list is none: Bob owns none of them")

// The kinds a companion's command takes: the campaign's, less those only a character takes.
// Changed on purpose (round 0.36.0 §6.13): and ending a turn, the character's to do.
// Changed on purpose (round 0.36.0 §6.14): and taking one back.
// Changed on purpose (round 0.42.1 §U.7.1): and a spell slot spent or restored, after Heroic Inspiration.
// Changed on purpose (round 0.42.1 §P.6.1): and a spell prepared or unprepared, after the charges.
// Changed on purpose (module 0.44.0, the v0.44 plan's item 7): and a plain roll of the dice tray, its
// character's player's.
// Changed on purpose (module 0.51.0, the app's item 18): and `away`, that companions are listed on
// every scene, each saying whether it's away, to an app that answers 3.
// Changed on purpose (module 0.54.0, item 98): and `constant`, that the Gamemaster's constant
// companions are listed to an app that answers 4.
const UNTAKEN = ['inspiration', 'hitDie', 'hitDice', 'spend', 'spellSlot', 'prepare', 'transfer', 'remove', 'note', 'endTurn', 'undoEndTurn', 'plainRoll']
assert.deepEqual(hello.data.features.companions, { kinds: hello.data.features.rolls.kinds.filter(kind => !UNTAKEN.includes(kind)), initiative: 'own', away: true, constant: true })
assert.ok(hello.data.features.companions.kinds.includes('itemDamage') && hello.data.features.companions.kinds.includes('recharge'))
assert.ok(!hello.data.features.companions.kinds.some(kind => UNTAKEN.includes(kind)))
ok("features.companions: the campaign's kinds less inspiration, hit dice, spending, spell slots, spells prepared, moves, removals, notes, ending a turn and taking one back, and the dice tray's plain roll, and each its own initiative")

// The big campaign: fifty listed of sixty, under 64 KB, a name of 300 cut to 200 and an img of 3,000 sent null.
const bigHello = helloOf('camp-big')
assert.equal(bigHello.data.companions.length, 50)
assert.ok(Buffer.byteLength(JSON.stringify(bigHello.data.companions)) < 64 * 1024, `${Buffer.byteLength(JSON.stringify(bigHello.data.companions))} bytes`)
const longEntry = bigHello.data.companions.find(each => each.key === 'longname')
assert.deepEqual([longEntry.name, longEntry.img], ['L'.repeat(200), null])
assert.deepEqual([1, 2, 3].map(n => bigHello.data.companions.filter(each => each.of[0] === `big${n}`).length), [20, 20, 10])
ok('a campaign of sixty companions lists fifty, each character twenty at most, in under 64 KB; a name of 300 characters is cut to 200, a portrait path of 3,000 sent null')

/* -------------------------------------------- */
/*  The format                                  */
/* -------------------------------------------- */

const { announce } = await import(`${MODULE}/scripts/bridge.mjs`)
const { campaignStatus } = await import(`${MODULE}/scripts/delivery-status.mjs`)
{
  const a = app.events.filter(e => e.campaign?.id === 'camp-a')
  const lastSheet = a.findLastIndex(e => ['character.updated', 'group.updated'].includes(e.type))
  const posted = a.filter(e => e.type === 'companion.updated')
  assert.ok(a.findIndex(e => e.type === 'companion.updated') > lastSheet, 'after the character and group sheets')
  assert.deepEqual(posted.map(e => e.data.companion), EXPECTED, 'each in the list, in its order')
  assert.ok(posted.every(e => (JSON.stringify(Object.keys(e.data)) === '["companion","sheet"]') && e.data.sheet), 'each its entry and its sheet')
  assert.equal(listed().length, 0, 'the hello listed them: no companions.listed')
  ok('an app answering companions: 1 is sent each companion\'s sheet in companion.updated, its entry beside it, after the character and group sheets')
}

// An app that doesn't read companions: told nothing of them, and its combats and chat as 0.35.0's.
const COMBATANT_035 = ['id', 'name', 'img', 'actorId', 'tokenId', 'sceneId', 'groupId', 'initiative', 'defeated', 'character', 'playerOwned', 'disposition']
let from = app.events.length
for (const answer of [{ commands: true, companions: 0 }, { commands: true }]) {
  app.answers['camp-a'] = answer
  announce({ campaignId: 'camp-a' })
  await until(() => since(from).some(e => (e.type === 'bridge.hello') && (e.campaign.id === 'camp-a')), 'the hello')
  await settle()
  from = app.events.length
}
const bat3 = await createToken(arena, bat, { id: 'bat3', name: 'Bat', delta: { flags: SUMMONED } })
await changeDelta(bat1, { system: { attributes: { hp: { value: 2 } } } })
const batOnly = combatOf('batonly', [{ id: 'cb-only-bat', token: bat1 }])
await Hooks.callAll('createCombat', batOnly, {}, 'gm')
const mixed = combatOf('mixed', [{ id: 'cb-m-thorin', actor: thorin }, { id: 'cb-m-bat', token: bat1 }])
await Hooks.callAll('createCombat', mixed, {}, 'gm')
const squeak = await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: bat1.actor }), content: '<p>Squeak.</p>' })
await settle()
{
  const told = since(from)
  assert.equal(listed(from).length + sheetsSent(from).length, 0, 'no companions.listed or companion.updated')
  assert.ok(!ofType(told, 'combat.created').some(e => e.data.combat.id === 'batonly'), 'a Bat-only fight not sent')
  const fight = ofType(told, 'combat.created').find(e => e.data.combat.id === 'mixed')
  assert.ok(fight, 'a fight with Thorin sent')
  const [thorinCb, batCb] = fight.data.combat.combatants
  assert.deepEqual(Object.keys(thorinCb), [...COMBATANT_035, 'hp'])
  assert.deepEqual(Object.keys(batCb), COMBATANT_035, "no companion key, and no companion's hit points")
  const message = ofType(told, 'chat.message.created').find(e => e.data.message.id === squeak.id)
  assert.ok(!message || !('companion' in message.data.message), 'its chat as 0.35.0 sends it')
  ok("an app answering companions: 0, or nothing of companions, is sent no companions.listed or companion.updated as tokens come and change; its combatants are module 0.35.0's, no companion key, no companion's hit points; a fight with only the Bat isn't sent, and its chat has no companion")
}

// A heartbeat's answer that starts reading companions: the list and every sheet at once, and its
// combats as they're described for it now.
app.answers['camp-a'] = undefined
from = app.events.length
clock += 31_000
heartbeat()
await until(() => listed(from).length, 'the list after the heartbeat')
await settle()
{
  const [list] = listed(from)
  assert.ok(keysOf(list.data.companions).includes('arena-bat3'), 'the Bat placed meanwhile in it')
  assert.deepEqual(sheetsSent(from).map(e => e.data.companion.key).sort(), keysOf(list.data.companions).sort(), 'every sheet')
  const created = ofType(since(from), 'combat.created')
  assert.ok(created.some(e => e.data.combat.id === 'batonly'), 'the Bat-only fight reaches it now')
  const again = created.find(e => e.data.combat.id === 'mixed')
  assert.deepEqual(again?.data.combat.combatants.map(cb => cb.companion), [null, 'arena-bat1'], 'the fight again, its companion told')
  ok("a heartbeat's answer starting to read companions sends the list and every companion's sheet at once, and its combats again, the Bat-only fight among them")
}
await bat3.delete()
await settle()

// A token deleted while the hello is on its way: the list without it, at once, once it's answered.
{
  let release
  app.hold = new Promise(resolve => { release = resolve })
  from = app.events.length
  announce({ campaignId: 'camp-a' })
  await wait(20)
  await wolf2.delete()
  release()
  await until(() => since(from).some(e => (e.type === 'bridge.hello') && (e.campaign.id === 'camp-a')), 'the hello')
  await until(() => listed(from).length, 'the list after the hello', 200)
  assert.ok(keysOf(helloOf().data.companions).includes('arena-wolf2'), 'the hello listed it')
  assert.ok(!keysOf(listed(from)[0].data.companions).includes('arena-wolf2'), 'the list after it, without it')
  assert.ok(!sheetsSent(from).some(e => e.data.companion.key === 'arena-wolf2'), 'and no sheet of it')
  ok('a token deleted while the hello is on its way: once the hello is answered, companions.listed without it, at once')
}
await settle()
placeToken(arena, wolf, { id: 'wolf2', name: 'Wolf' })
await Hooks.callAll('createToken', arena.tokens.get('wolf2'), {}, 'gm')
await settle()
const wolf2b = arena.tokens.get('wolf2')

/* -------------------------------------------- */
/*  Changes                                     */
/* -------------------------------------------- */

const lastList = () => listed().at(-1).data.companions
{
  from = app.events.length
  const started = realNow()
  const bat4 = await createToken(arena, bat, { id: 'bat4', name: 'Bat', delta: { flags: SUMMONED } })
  await until(() => listed(from).length, 'the list with the new Bat', 1000)
  // The module settles changes for 250 ms; what's past 300 here is the harness's own polling and load.
  assert.ok(realNow() - started < 300 + 200, `within 300 ms (${realNow() - started} ms)`)
  assert.ok(keysOf(listed(from)[0].data.companions).includes('arena-bat4'))
  await until(() => sheetsSent(from).some(e => e.data.companion.key === 'arena-bat4'), 'its sheet')
  assert.ok(app.events.indexOf(listed(from)[0]) < app.events.indexOf(sheetsSent(from).find(e => e.data.companion.key === 'arena-bat4')), 'the list, then its sheet')
  from = app.events.length
  await bat4.delete()
  await until(() => listed(from).length, 'the list without it')
  assert.ok(!keysOf(lastList()).includes('arena-bat4'))
  // Its maps forgotten: placed again, its sheet goes again.
  from = app.events.length
  await createToken(arena, bat, { id: 'bat4', name: 'Bat', delta: { flags: SUMMONED } })
  await until(() => sheetsSent(from).some(e => e.data.companion.key === 'arena-bat4'), 'its sheet again')
  from = app.events.length
  await arena.tokens.get('bat4').update({ hidden: true })
  await until(() => listed(from).length, 'the list without the hidden one')
  assert.ok(!keysOf(lastList()).includes('arena-bat4'))
  await arena.tokens.get('bat4').delete()
  await settle()
  ok("a token created on the active scene: companions.listed within 300 ms, then its sheet; deleted, the list without it, and what was told of it forgotten, so placed again its sheet goes again; hidden, it's gone")
}
{
  from = app.events.length
  await activate(den)
  await until(() => listed(from).length, 'the list on the other scene')
  assert.deepEqual(keysOf(lastList()), ['brakka', 'den-bat2'], 'the other scene\'s Bat in, the active scene\'s tokens out, Brakka linked still')
  from = app.events.length
  await den.delete()
  await until(() => listed(from).length, 'the list without the deleted scene')
  assert.deepEqual(keysOf(lastList()), ['brakka'])
  scenes.set(den.id, den)
  from = app.events.length
  await activate(arena)
  await until(() => listed(from).length, 'the list back')
  assert.deepEqual(keysOf(lastList()), keysOf(EXPECTED))
  ok("the active scene switched: the other scene's Bat in, this one's tokens out; the active scene deleted: its tokens' companions out")
}
const stray = companionActor('stray', 'Stray Cat', { linked: true })
{
  from = app.events.length
  await changeActor(stray, { ownership: { alice: 3 } })
  await until(() => listed(from).length, 'the list with the Stray Cat')
  assert.ok(keysOf(lastList()).includes('stray'))
  from = app.events.length
  await changeActor(stray, { ownership: { alice: 0 } })
  await until(() => listed(from).length, 'the list without it')
  assert.ok(!keysOf(lastList()).includes('stray'))
  from = app.events.length
  alice.isGM = true
  await Hooks.callAll('updateUser', alice, { role: 4 }, {}, 'gm')
  await until(() => listed(from).length, 'the list without her NPCs')
  assert.deepEqual(lastList().map(each => each.kind), ['summoned', 'summoned'], 'only the summoned ones, which need no owner')
  alice.isGM = false
  from = app.events.length
  await Hooks.callAll('updateUser', alice, { role: 1 }, {}, 'gm')
  await until(() => listed(from).length, 'the list back')
  assert.deepEqual(keysOf(lastList()), keysOf(EXPECTED))
  ok('an NPC given to Alice as Owner: listed; taken from her: gone; Alice made a Gamemaster: her NPCs gone, the summoned ones kept')
}
{
  // Thorin given from Alice to Bob in Foundry: Alice's NPCs are no longer his companions, his summons
  // still are; given back, they are again.
  from = app.events.length
  thorin.owners = ['bob']
  await Hooks.callAll('updateActor', thorin, { ownership: { alice: 0, bob: 3 } }, {}, 'gm')
  await until(() => listed(from).length, "the list without Alice's NPCs")
  assert.deepEqual(lastList().map(each => [each.kind, each.of]), [['summoned', ['thorin']], ['summoned', ['thorin']]])
  from = app.events.length
  thorin.owners = ['alice']
  await Hooks.callAll('updateActor', thorin, { ownership: { alice: 3, bob: 0 } }, {}, 'gm')
  await until(() => listed(from).length, 'the list back')
  assert.deepEqual(keysOf(lastList()), keysOf(EXPECTED))
  await settle()
  ok("a campaign character's owners changed in Foundry: the list again, its player's NPCs gone with her, its summons kept; and back")
}
{
  // A companion placed and, before the list settles, every companion's sheet sent again as the app's
  // terms change: its sheet goes only after the list that names it.
  from = app.events.length
  const bat12 = await createToken(arena, bat, { id: 'bat12', name: 'Bat', delta: { flags: SUMMONED } })
  await Hooks.callAll(SHEET_TERMS_HOOK, 'camp-a')
  await until(() => listed(from).length && sheetsSent(from).some(e => e.data.companion.key === 'arena-bat12'), 'the list and its sheet')
  assert.ok(app.events.indexOf(listed(from)[0]) < app.events.indexOf(sheetsSent(from).find(e => e.data.companion.key === 'arena-bat12')), 'its sheet after the list naming it')
  await bat12.delete()
  await settle()
  ok("a companion placed while every sheet goes again, before the list settles: its sheet only after the list naming it")
}
{
  from = app.events.length
  const bat5 = placeToken(arena, bat, { id: 'bat5', name: 'Bat', delta: { flags: SUMMONED } })
  await Hooks.callAll('createToken', bat5, {}, 'gm')
  await wait(50)
  await Hooks.callAll('createToken', bat5, {}, 'gm')
  await settle(); await settle()
  assert.equal(listed(from).length, 1, 'one post')
  from = app.events.length
  await bat5.delete()
  await until(() => listed(from).length, 'the list without it')
  ok('one change heard twice in 250 ms: one companions.listed')
}
{
  // A companions.listed lost to failures that might not last, the sheet after it taken; and one lost
  // while a later list is on its way. The app takes no sheet of a companion it doesn't list (APP-A's
  // saveCompanion), so each lost list's companions' sheets go again after a list it takes, and every
  // companion it then lists has its sheet.
  const held = () => {
    let keys = []
    const sheets = new Set()
    for (const e of app.events.filter(each => each.campaign?.id === 'camp-a')) {
      if (e.type === 'bridge.hello') { keys = keysOf(e.data.companions); sheets.clear() }
      if (e.type === 'companions.listed') {
        keys = keysOf(e.data.companions)
        for (const key of [...sheets]) if (!keys.includes(key)) sheets.delete(key)
      }
      if ((e.type === 'companion.updated') && keys.includes(e.data.companion.key)) sheets.add(e.data.companion.key)
    }
    return { keys, unsheeted: keys.filter(key => !sheets.has(key)) }
  }
  assert.deepEqual(held().unsheeted, [], 'every companion with its sheet before')
  let failing = null
  let delay = 0
  let attempts = 0
  app.failing = async body => {
    if (!failing || (body.type !== 'companions.listed') || (body.campaign?.id !== 'camp-a') || !failing(keysOf(body.data.companions))) return false
    attempts++
    await wait(delay)
    return true
  }
  const resent = async (key, what) => {
    const at = app.events.length
    clock += 31_000
    heartbeat()
    await until(() => sheetsSent(at).some(e => e.data.companion.key === key), what)
    await settle()
    return at
  }
  const sheetAt = (key, at) => app.events.indexOf(sheetsSent(at).find(e => e.data.companion.key === key))
  try {
    // Lost, and the sheet after it taken.
    from = app.events.length
    failing = keys => keys.includes('arena-bat9')
    await createToken(arena, bat, { id: 'bat9', name: 'Bat', delta: { flags: SUMMONED } })
    await until(() => (attempts >= 3) && sheetsSent(from).some(e => e.data.companion.key === 'arena-bat9'), 'its sheet, its list lost')
    assert.equal(listed(from).length, 0, 'its list not taken')
    assert.ok(held().keys.length && !held().keys.includes('arena-bat9'), 'nor its sheet')
    failing = null
    let at = await resent('arena-bat9', "the Bat's sheet again")
    assert.ok(keysOf(listed(at)[0]?.data.companions ?? []).includes('arena-bat9'), 'the list again')
    assert.ok(app.events.indexOf(listed(at)[0]) < sheetAt('arena-bat9', at), 'then its sheet')
    assert.deepEqual(held(), { keys: keysOf(companionList(ashlands())), unsheeted: [] }, 'the app lists every companion, each with its sheet')
    // Lost while a later list is on its way, which is taken.
    from = app.events.length
    attempts = 0
    delay = 150
    failing = keys => keys.includes('arena-bat10') && !keys.includes('arena-bat11')
    await createToken(arena, bat, { id: 'bat10', name: 'Bat', delta: { flags: SUMMONED } })
    await until(() => attempts >= 1, 'its list on its way')
    await createToken(arena, bat, { id: 'bat11', name: 'Bat', delta: { flags: SUMMONED } })
    await until(() => (attempts >= 3) && listed(from).length && sheetsSent(from).some(e => e.data.companion.key === 'arena-bat11'), 'the later list taken')
    await settle()
    assert.ok(sheetAt('arena-bat10', from) < app.events.indexOf(listed(from)[0]), "the first Bat's sheet went before the later list")
    assert.deepEqual(held().unsheeted, ['arena-bat10'], 'and was ignored')
    failing = null
    delay = 0
    at = await resent('arena-bat10', "the first Bat's sheet again")
    assert.deepEqual(held(), { keys: keysOf(companionList(ashlands())), unsheeted: [] }, 'every companion with its sheet')
  } finally {
    app.failing = null
  }
  for (const id of ['bat9', 'bat10', 'bat11']) await arena.tokens.get(id)?.delete()
  await settle()
  ok("a companions.listed lost, the sheet after it taken: the list again, then that sheet; one lost while a later list is on its way: its companion's sheet again after that one; the app lists every companion, each with its sheet")
}

/* -------------------------------------------- */
/*  Sheets                                      */
/* -------------------------------------------- */

const sheetOf = (key, events = app.events) => events.filter(e => (e.type === 'companion.updated') && (e.campaign.id === 'camp-a') && (e.data.companion.key === key)).at(-1)?.data.sheet
const expanded = sheet => sheet
{
  assert.equal(sheetOf('arena-bat1').hp.value, 2, "the Bat's own HP, its delta's")
  assert.equal(bat.system.attributes.hp.value, 4, "the base's untouched")
  for (const [n, fault] of [[3, 'token'], [1, 'delta'], [4, 'actor']]) {
    faults.deltaHooks = fault
    from = app.events.length
    await changeDelta(bat1, { system: { attributes: { hp: { value: n } } } })
    await settle(); await settle()
    const sent = since(from).filter(e => ['companion.updated', 'character.updated'].includes(e.type) && (e.campaign.id === 'camp-a'))
    assert.deepEqual(sent.map(e => e.data.companion?.key ?? e.data.character?.id), ['arena-bat1'], `${fault}: its sheet alone, once`)
    assert.equal(sheetOf('arena-bat1', sent).hp.value, n, fault)
  }
  faults.deltaHooks = 'both'
  ok("the Bat's sheet is its token's creature's, its HP its delta's; a delta change sends its sheet again, once, never the base's or Thorin's, whether core tells it by updateToken, updateActorDelta or updateActor")
  let spent = 0
  for (const parent of ['actor', 'delta', 'none']) {
    faults.syntheticItemParent = parent
    from = app.events.length
    await bat1.actor.updateEmbeddedDocuments('Item', [{ _id: 'echo', 'system.uses.spent': ++spent }])
    await settle(); await settle()
    const echo = sheetsSent(from).filter(e => e.data.companion.key === 'arena-bat1')
    assert.equal(echo.length, 1, `${parent}: its sheet again`)
    const feature = echo[0].data.sheet.features.flatMap(section => section.features).find(each => each.name === 'Echolocation')
    assert.equal(feature.uses.value, 3 - spent, `${parent}: as spent`)
  }
  faults.syntheticItemParent = 'actor'
  ok("a use spent on the Bat's item sends its sheet again, whether its item hooks name its actor, its delta or none, updateActorDelta alone")
  from = app.events.length
  await changeDelta(wolf1, { system: { attributes: { hp: { value: 5 } } } })
  await settle(); await settle()
  assert.deepEqual(sheetsSent(from).map(e => e.data.companion.key), ['arena-wolf1'], 'one wolf, not the other')
  assert.notEqual(sheetOf('arena-wolf1').hp.value, sheetOf('arena-wolf2').hp.value)
  ok("two wolves of one Wolf are sent apart, each by its own key, c:<key>")
  // The Gamemaster renames the world Wolf's bite: core makes both its tokens' creatures again from
  // it, telling only of the world Wolf's item. Both wolves' sheets go again, each read from its own.
  from = app.events.length
  await changeBaseItem(wolf, 'jaws', { name: 'Fang' })
  await settle(); await settle()
  assert.deepEqual(sheetsSent(from).map(e => e.data.companion.key).sort(), ['arena-wolf1', 'arena-wolf2'])
  assert.ok(sheetsSent(from).every(e => JSON.stringify(e.data.sheet).includes('"Fang"')), 'each with the bite renamed')
  assert.deepEqual(['arena-wolf1', 'arena-wolf2'].map(key => sheetsSent(from).find(e => e.data.companion.key === key).data.sheet.hp.value), [5, 12], 'each its own hit points')
  await changeBaseItem(wolf, 'jaws', { name: 'Bite' })
  await settle(); await settle()
  ok("the world Wolf's item changed by the Gamemaster: both its tokens' creatures' sheets again, each its own")
}
{
  const dragonSheet = app.events.filter(e => (e.type === 'character.updated') && (e.data.character.id === 'dragon')).at(-1).data.character.sheet
  assert.deepEqual(dragonSheet.creature, {
    cr: 17, type: 'Dragon', size: 'Huge', alignment: 'Chaotic Evil', important: false,
    legendary: { value: 4, max: 4 }, resistance: { value: 4, max: 4 }, lair: { inside: true, initiative: 20 },
    hitDice: { denomination: 'd12', value: 19, max: 19 },
  })
  const thorinSheet = app.events.filter(e => (e.type === 'character.updated') && (e.data.character.id === 'thorin')).at(-1).data.character.sheet
  assert.ok(!('creature' in thorinSheet), "none on Thorin's")
  const rows = JSON.parse(JSON.stringify(dragonSheet.actions ?? []))
  const breath = JSON.stringify(rows).match(/"recharge":(\d)/)
  assert.equal(breath?.[1], '5', 'the breath recharges on a 5')
  assert.ok(!/legact|legres|"lair"/.test(JSON.stringify(dragonSheet.favorites ?? [])), 'no favorites of its pools')
  assert.equal(sheetOf('brakka').creature.important, true, "Brakka's traits.important")
  ok("an NPC's sheet has its creature: the dragon's CR 17, type, size, alignment, legendary actions and resistances 4 of 4 as dnd5e prepares them in its lair, its lair, its hit dice d12; none on Thorin's; its breath's uses recharge on a 5; none of its pools a favorite")
}
{
  // Withheld when too large, warned once per key, named for the Gamemaster.
  const warned = []
  const warn = ui.notifications.warn
  ui.notifications.warn = message => warned.push(message)
  const logs = []
  const consoleWarn = console.warn
  console.warn = (...args) => logs.push(args.join(' '))
  const item = bat1.actor.items.get('echo')
  const name = item.name
  item.updateSource({ name: 'E'.repeat(1_100_000) })
  for (const n of [0, 1]) {
    from = app.events.length
    await changeDelta(bat1, { system: { attributes: { hp: { value: n } } } })
    await settle(); await settle()
    const [sent] = sheetsSent(from)
    assert.deepEqual([sent.data.sheet, sent.data.companion.key, sent.data.companion.sheetWithheld.reason], [null, 'arena-bat1', 'tooLarge'])
  }
  assert.equal(warned.length, 1, 'warned once')
  assert.ok(campaignStatus(ashlands()).some(line => (line.state === 'warning') && line.text.includes('"name":"Bat"')), 'the withheld note names the Bat')
  item.updateSource({ name })
  await changeDelta(bat1, { system: { attributes: { hp: { value: 2 } } } })
  await settle(); await settle()
  assert.ok(sheetOf('arena-bat1'), 'sent again in full once it fits')
  ui.notifications.warn = warn
  console.warn = consoleWarn
  ok('a sheet too large is withheld, its entry saying so, the Gamemaster warned once for it, the note naming the Bat; sent in full again once it fits')
}
{
  // A slim-terms change resends every companion's sheet.
  from = app.events.length
  app.features = { commands: true, companions: 1, slimSheets: 1 }
  clock += 31_000
  heartbeat()
  await until(() => sheetsSent(from).length >= keysOf(EXPECTED).length, 'every sheet again')
  await settle()
  assert.deepEqual(sheetsSent(from).map(e => e.data.companion.key).sort(), keysOf(EXPECTED).sort())
  assert.ok(sheetsSent(from).every(e => e.data.sheet?.slim === 1), 'slim')
  app.features = { commands: true, companions: 1 }
  clock += 31_000
  heartbeat()
  await settle(); await settle()
  ok("a change of the app's terms for sheets, slim now, sends every companion's sheet again")
}
{
  // A world setting for critical hits changed, which every sheet says the rules of: every companion's
  // sheet again; and the world's permissions changed: every companion's sheet built again, as every
  // character's is, the Bat's sent where it changed meanwhile unheard.
  const companionCritical = () => sheetsSent(from).map(e => [e.data.companion.key, e.data.sheet?.critical?.powerfulCritical])
  from = app.events.length
  settings.set('criticalDamageMaxDice', true)
  await Hooks.callAll('updateSetting', { key: 'dnd5e.criticalDamageMaxDice' }, {}, {}, 'gm')
  await settle(); await settle()
  assert.deepEqual(companionCritical().map(([key]) => key).sort(), keysOf(companionList(ashlands())).sort(), 'every companion')
  assert.ok(companionCritical().every(([, most]) => most === true), "a critical hit's dice at their most now")
  settings.set('criticalDamageMaxDice', false)
  await Hooks.callAll('updateSetting', { key: 'dnd5e.criticalDamageMaxDice' }, {}, {}, 'gm')
  await settle(); await settle()
  from = app.events.length
  bat1.actor.system.attributes.hp.value = 1
  await Hooks.callAll('updateSetting', { key: 'core.permissions' }, {}, {}, 'gm')
  await settle(); await settle()
  assert.deepEqual(sheetsSent(from).map(e => [e.data.companion.key, e.data.sheet.hp.value]), [['arena-bat1', 1]], "the Bat's sheet built again")
  await changeDelta(bat1, { system: { attributes: { hp: { value: 2 } } } })
  await settle(); await settle()
  ok("a world setting for critical hits changed sends every companion's sheet again, as its rules say now; the world's permissions changed builds each again")
}
{
  // A temporary effect on the Bat, and a round change: its sheet again.
  // Changed on purpose (round 0.39.0 §1.9): the effect is Thorin's Bless, which on a character's own
  // sheet its player could turn off and delete; a companion's effects take no commands, so the Bat's
  // sheet offers none, `ops: []`.
  const blessUuid = `${thorin.uuid}.Item.bless`
  const hadFromUuid = Object.hasOwn(globalThis, 'fromUuidSync')
  const fromUuid = globalThis.fromUuidSync
  globalThis.fromUuidSync = uuid => ((uuid === blessUuid) ? { documentName: 'Item', name: 'Bless', actor: thorin } : (fromUuid?.(uuid, { strict: false }) ?? null))
  bat1.actor.effectsMade = [{ id: 'fx1', name: 'Blessed', img: 'bless.webp', isTemporary: true, disabled: false, statuses: new Set(), duration: { value: 6, remaining: 6, label: '6 seconds' }, changes: [], transfer: false, origin: blessUuid, parent: bat1.actor, getFlag: () => undefined }]
  await changeDelta(bat1, { system: { attributes: { hp: { value: 3 } } } })
  await settle(); await settle()
  from = app.events.length
  bat1.actor.effectsMade[0].duration = { value: 6, remaining: 3, label: '3 seconds' }
  await Hooks.callAll('updateCombat', mixed, { round: 2 }, {}, 'gm')
  await settle(); await settle()
  const batSheets = sheetsSent(from).filter(e => e.data.companion.key === 'arena-bat1')
  assert.ok(batSheets.length, 'its sheet again')
  assert.deepEqual(batSheets.at(-1).data.sheet.effects.flatMap(section => section.effects).map(row => [row.name, row.source, row.ops]), [['Blessed', 'Bless', []]],
    "Thorin's Bless on the Bat: no ops")
  bat1.actor.effectsMade = []
  if (hadFromUuid) globalThis.fromUuidSync = fromUuid
  else delete globalThis.fromUuidSync
  ok("a temporary effect on the Bat runs down with the round: its sheet again, the effect's row offering its player nothing, as a companion's never do")
}

/* -------------------------------------------- */
/*  Secrets                                     */
/* -------------------------------------------- */

{
  const texts = Object.assign({}, ...app.events.filter(e => (e.type === 'character.texts') && (e.campaign.id === 'camp-a')).map(e => e.data.texts ?? {}))
  const html = hash => texts[hash] ?? ''
  const brakkaSheet = sheetOf('brakka')
  const spiritSheet = sheetOf('arena-spirit1')
  assert.match(html(brakkaSheet.details.biography), /Brakka was|A secret of the Gamemaster/, "Brakka's biography with its secret")
  const textsOf = sheet => Object.values(texts).filter(Boolean)
  const axe = JSON.stringify(brakkaSheet).match(/"text":"([0-9a-f]{14})"/g) ?? []
  assert.ok(axe.some(m => html(m.slice(8, -1)).includes('secret of the Gamemaster')), "Brakka's item descriptions with their secrets")
  assert.equal(html(spiritSheet.details.biography), '<p>A spirit of dragonkind.</p>', "the Spirit's biography the public one")
  const spiritTexts = (JSON.stringify(spiritSheet).match(/"text":"([0-9a-f]{14})"/g) ?? []).map(m => html(m.slice(8, -1)))
  assert.ok(spiritTexts.some(text => text.includes('Claws')) && !spiritTexts.some(text => text.includes('secret of the Gamemaster')), "the Spirit's descriptions without their secrets")
  void textsOf
  ok("a companion Alice owns, Brakka, goes with its secrets; one no player owns, the Draconic Spirit, without them, its biography the public one")
}
{
  // The Spirit's links are read as its descriptions were sent, without the Gamemaster's secrets: a
  // save and a roll in its claws' text made with of: thorin; that text as it reads with them, which
  // was never sent, refused gone.
  const texts = Object.assign({}, ...app.events.filter(e => (e.type === 'character.texts') && (e.campaign.id === 'camp-a')).map(e => e.data.texts ?? {}))
  const hashes = (JSON.stringify(sheetOf('arena-spirit1')).match(/"text":"([0-9a-f]{14})"/g) ?? []).map(m => m.slice(8, -1))
  const claws = hashes.find(hash => (texts[hash] ?? '').includes('Claws'))
  assert.ok(claws && !texts[claws].includes('Wisdom'), 'its claws sent without their secret save')
  const linkSave = (text, link) => send({ id: `link-${++ids}`, actorId: 'arena-spirit1', of: 'thorin', kind: 'save', key: 'dex', ...plain, dice: [{ faces: 20, results: [11] }], text, link })
  const made = await linkSave(claws, 0)
  assert.equal(made.status, 'done', JSON.stringify(made))
  assert.equal(messageOf(made.id).speakerActor, arena.tokens.get('spirit1').actor, "the Spirit's own")
  const { characterSheet } = await import(`${MODULE}/scripts/sheet.mjs`)
  const { SheetTexts } = await import(`${MODULE}/scripts/sheet-texts.mjs`)
  const withSecrets = new SheetTexts({ secrets: true })
  characterSheet(arena.tokens.get('spirit1').actor, withSecrets, { secrets: true })
  const secretClaws = [...withSecrets.sources].find(([, source]) => String(source.html ?? '').includes('Claws'))?.[0]
  assert.ok(secretClaws && (secretClaws !== claws), 'with its secrets, another text')
  const unsent = await linkSave(secretClaws, 0)
  assert.deepEqual([unsent.status, unsent.reason], ['failed', 'gone'], 'that text, never sent: gone')
  if (!DND5E6) {
    // A description's own roll, as command-texts.mjs makes it, under dnd5e 5.
    const n = Number(/<span class="ss-roll[^>]*data-n="(\d+)"/.exec(texts[claws])?.[1])
    const roll = text => send({ id: `link-${++ids}`, actorId: 'arena-spirit1', of: 'thorin', kind: 'textRoll', text, link: n, ...plain, dice: [{ faces: 4, results: [3] }] })
    const rolled = await roll(claws)
    assert.equal(rolled.status, 'done', JSON.stringify(rolled))
    const gone = await roll(secretClaws)
    assert.deepEqual([gone.status, gone.reason], ['failed', 'gone'], 'its roll in the text never sent: gone')
  }
  ok(`the Draconic Spirit's links, read as its descriptions were sent without secrets: its claws' save${DND5E6 ? '' : ' and roll'} made with of: thorin; the same text as it reads with its secrets, never sent, refused gone`)
}

/* -------------------------------------------- */
/*  Commands                                    */
/* -------------------------------------------- */

const fight = combatOf('fight', [
  { id: 'cb-thorin', actor: thorin }, { id: 'cb-vex', actor: vex }, { id: 'cb-brakka', actor: brakka },
  { id: 'cb-wolf1', token: wolf1 }, { id: 'cb-wolf2', token: wolf2b }, { id: 'cb-bat', token: bat1 },
  { id: 'cb-gob', actor: goblin, token: goblinToken },
])
game.combat = fight
await Hooks.callAll('createCombat', fight, {}, 'gm')
await settle()
const attack = (fields = {}) => ({
  id: `atk-${++ids}`, actorId: 'thorin', kind: 'attack', item: 'longsword', activity: 'ls-swing', target: { combatId: 'fight', combatantId: 'cb-gob' },
  ...plain, dice: [{ faces: 20, results: [15] }], ...fields,
})
const use = (fields = {}) => ({ id: `use-${++ids}`, actorId: 'thorin', kind: 'use', targets: [], slot: null, ...fields })
const useCard = id => [...messages.values()].find(m => m.flags?.['sending-stone']?.use === id)
const madeBy = made => messageOf(made.id) ?? useCard(made.id)
{
  const made = await send(skill({ actorId: 'arena-bat1', of: 'thorin' }))
  assert.equal(made.status, 'done', JSON.stringify(made))
  const message = messageOf(made.id)
  assert.equal(message.speakerActor, bat1.actor, "the token's creature, not its base")
  assert.deepEqual([message.speaker.actor, message.speaker.token, message.speaker.scene], ['bat', 'bat1', 'arena'])
  assert.equal(message.author.id, 'alice', 'authored as Alice')
  assert.equal(message.flags['sending-stone'].companion, 'arena-bat1')
  ok("the Bat token's perception, with of: thorin, is rolled on the token's creature, authored as Alice, its message marked as the companion's")
}
{
  const made = await send(attack({ actorId: 'arena-spirit1', of: 'thorin', item: 'rend', activity: 'rend-swing' }))
  assert.equal(made.status, 'done', JSON.stringify(made))
  // On Midi-QOL's path the card is the workflow's, made on the Gamemaster's client as every app use's is.
  if (!MIDI) assert.equal(madeBy(made).author.id, 'alice', 'authored as Alice, though no player owns it')
  ok(MIDI ? "the Draconic Spirit's attack, owned by no player, is made through Midi-QOL's workflow" : "the Draconic Spirit's attack, owned by no player, is authored as Alice, Thorin's player")
}
{
  const made = await send(use({ actorId: 'brakka', of: 'thorin', item: 'roar', activity: 'roar-save', targets: [{ combatId: 'fight', combatantId: 'cb-gob' }] }))
  assert.equal(made.status, 'done', JSON.stringify(made))
  const card = useCard(made.id)
  assert.equal(card.speakerActor, brakka)
  const targets = MIDI ? [...(midi.made.at(-1)?.targets ?? [])].map(t => t.document?.id ?? t.id) : (card.flags.dnd5e?.targets ?? []).map(t => t.uuid)
  assert.deepEqual(targets, MIDI ? ['gob1'] : ['Actor.goblin'], 'the card names its target')
  ok("Brakka's roar, a save activity, is used, its card naming the goblin she aimed it at")
}
{
  const bitten = await send(attack({ actorId: 'arena-wolf1', of: 'thorin', item: 'jaws', activity: 'bite' }))
  assert.equal(bitten.status, 'done', JSON.stringify(bitten))
  const other = await send({ id: `dmg-${++ids}`, actorId: 'arena-wolf2', of: 'thorin', kind: 'damage', use: bitten.id, dice: [{ faces: 4, results: [2, 3] }] })
  assert.deepEqual([other.status, other.reason], ['failed', 'unknown'], "the other wolf's damage on this wolf's card")
  faults.speakerNoToken = true
  const again = await send(attack({ actorId: 'arena-wolf1', of: 'thorin', item: 'jaws', activity: 'bite' }))
  assert.equal(again.status, 'done', JSON.stringify(again))
  const otherAgain = await send({ id: `dmg-${++ids}`, actorId: 'arena-wolf2', of: 'thorin', kind: 'damage', use: again.id, dice: [{ faces: 4, results: [2, 3] }] })
  assert.deepEqual([otherAgain.status, otherAgain.reason], ['failed', 'unknown'], 'and with a speaker naming no token')
  faults.speakerNoToken = false
  ok("a damage for one wolf's attack made as the other wolf's is refused unknown, by the creature its use was made by, whatever the card's speaker names")
}
{
  for (const canvas of [null, 'den']) {
    faults.canvasScene = canvas
    await fight.setInitiative(fight.combatants.get('cb-wolf2'), null)
    const made = await send({ id: `init-${++ids}`, actorId: 'arena-wolf2', of: 'thorin', kind: 'initiative', combatId: 'fight', ...plain, dice: [{ faces: 20, results: [12] }] })
    assert.equal(made.status, 'done', `${canvas}: ${JSON.stringify(made)}`)
    assert.equal(fight.combatants.get('cb-wolf2').initiative, 14, `${canvas}: the second wolf's combatant`)
    assert.equal(fight.combatants.get('cb-wolf1').initiative, null, `${canvas}: never the first's`)
  }
  faults.canvasScene = null
  await fight.setInitiative(fight.combatants.get('cb-wolf2'), null)
  ok("the second wolf's initiative sets the second wolf's combatant, never the first's, with the Gamemaster on the scene or another")
}
{
  const made = await send(use({ actorId: 'arena-wolf1', of: 'thorin', item: 'howl', activity: 'howl-use', self: true }))
  assert.equal(made.status, 'done', JSON.stringify(made))
  const card = useCard(made.id)
  const targets = MIDI ? [...(midi.made.at(-1)?.targets ?? [])].map(t => t.document?.uuid ?? t.uuid) : (card.flags.dnd5e?.targets ?? []).map(t => t.uuid)
  assert.deepEqual(targets, [MIDI ? wolf1.uuid : wolf1.actor.uuid], 'its own token')
  ok('Self, for a token\'s creature, is its own token')
}
{
  for (const kind of ['inspiration', 'hitDie', 'spend', 'transfer']) {
    const made = await send({ id: `of-${++ids}`, actorId: 'brakka', of: 'thorin', kind, ...plain, dice: [] })
    assert.deepEqual([made.status, made.reason, made.error], ['failed', 'invalid', 'of'], kind)
  }
  const notCharacter = await send(skill({ actorId: 'brakka', of: 'goblin' }))
  assert.deepEqual([notCharacter.status, notCharacter.reason], ['failed', 'unknown'], 'of a non-character')
  // Thorin's companions named as Vex's, another of the campaign's characters: no companion of his.
  const count = messages.size
  for (const actorId of ['arena-wolf1', 'brakka']) {
    const other = await send(skill({ actorId, of: 'vex' }))
    assert.deepEqual([other.status, other.reason], ['failed', 'unknown'], `${actorId} as Vex's`)
  }
  assert.equal(messages.size, count, 'nothing rolled or posted')
  const noOf = await send(skill({ actorId: 'brakka' }))
  assert.deepEqual([noOf.status, noOf.reason], ['failed', 'unknown'], "a world NPC's id without of, as 0.35.0")
  const bat6 = await createToken(arena, bat, { id: 'bat6', name: 'Bat', delta: { flags: SUMMONED } })
  await settle()
  await bat6.delete()
  const deleted = await send(skill({ actorId: 'arena-bat6', of: 'thorin' }))
  assert.deepEqual([deleted.status, deleted.reason], ['failed', 'unknown'], 'a key no longer listed')
  await wolf1.update({ hidden: true })
  await wait(10)
  const hidden = await send(skill({ actorId: 'arena-wolf1', of: 'thorin' }))
  assert.deepEqual([hidden.status, hidden.reason], ['failed', 'unknown'], 'hidden 10 ms before, the list not settled')
  await wolf1.update({ hidden: false })
  await settle()
  ok("inspiration, a hit die, spending and moves with of are refused invalid of; of a non-character, of another character whose companion it isn't, a token deleted, one hidden a moment before, and a world NPC's id with no of, unknown, nothing rolled")
}

/* -------------------------------------------- */
/*  Visibility                                  */
/* -------------------------------------------- */

{
  // Whispered to Alice and the Gamemaster, as a world might whisper an NPC's rolls to their owners.
  const whisper = (message, source) => {
    if (message.flags?.['sending-stone']?.companion === 'arena-spirit1') message.updateSource({ whisper: ['alice', 'gm'] })
  }
  Hooks.on('preCreateChatMessage', whisper)
  const made = await send(skill({ actorId: 'arena-spirit1', of: 'thorin' }))
  Hooks.off('preCreateChatMessage', whisper)
  assert.deepEqual(messageOf(made.id).whisper, ['alice', 'gm'])
  assert.equal(made.visible, true, "visible to Thorin's player")
  ok("a companion's roll whispered to Alice is visible in Thorin's result, though no player owns the Draconic Spirit")
}
{
  // A wolf two players own has no one player of its own: its rolls are its seat's player's, never the
  // Gamemaster's, whose rolls on Midi-QOL's cards players see trimmed.
  await changeDelta(wolf2b, { ownership: { bob: 3 } })
  await settle()
  const made = await send(skill({ actorId: 'arena-wolf2', of: 'thorin' }))
  assert.equal(made.status, 'done', JSON.stringify(made))
  assert.equal(messageOf(made.id).author.id, 'alice', "a two-owner wolf's roll authored as Thorin's player")
  const asVex = await send(skill({ actorId: 'arena-wolf2', of: 'vex' }))
  assert.equal(asVex.status, 'done', JSON.stringify(asVex))
  assert.equal(messageOf(asVex.id).author.id, 'bob', "and as Vex's, authored as his player")
  if (MIDI) {
    const bitten = await send(attack({ actorId: 'arena-wolf2', of: 'thorin', item: 'jaws', activity: 'bite' }))
    assert.equal(bitten.status, 'done', JSON.stringify(bitten))
  }
  await changeDelta(wolf2b, { ownership: { bob: 0 } })
  await settle()
  ok(`a wolf Alice and Bob both own rolls as Alice, Thorin's player, never as the Gamemaster, and as Bob for Vex${MIDI ? ", and attacks through Midi-QOL's workflow" : ''}`)
}

/* -------------------------------------------- */
/*  Legendary                                   */
/* -------------------------------------------- */

{
  const legact = dragon.system.resources.legact
  const act = (item, activity) => send(use({ actorId: 'dragon', item, activity }))
  legact.spent = 3
  const short = await act('tail', 'tail-use')
  assert.deepEqual([short.status, short.reason], ['failed', 'legendary'], 'a 2-cost action with 1 left')
  assert.equal(legact.spent, 3, 'nothing used')
  legact.spent = 0
  const used = await act('tail', 'tail-use')
  assert.equal(used.status, 'done', JSON.stringify(used))
  assert.equal(legact.spent, 2, 'two spent')
  legact.spent = 4
  const none = await act('detect', 'detect-use')
  assert.deepEqual([none.status, none.reason], ['failed', 'legendary'], 'a 0-cost action with none left')
  legact.spent = 3
  const own = await act('wing', 'wing-use')
  assert.notEqual(own.reason, 'legendary', 'one whose own consumption spends the pool is left to dnd5e')
  assert.equal(legact.spent, 3, "dnd5e's own consumption refuses it, nothing spent")
  legact.spent = 0
  const wing = await act('wing', 'wing-use')
  assert.equal(wing.status, 'done', JSON.stringify(wing))
  assert.equal(legact.spent, 2, 'spent by its own consumption, once')
  legact.spent = 3
  const mythic = await act('mythic', 'mythic-use')
  assert.deepEqual([mythic.status, mythic.reason], ['failed', 'legendary'], 'a mythic action alike')
  legact.spent = 0
  ok("legendary actions: a 2-cost one with 1 left refused legendary, nothing used; with 4 left used, 2 spent; a 0-cost one with none left refused; one whose consumption spends the pool left to dnd5e's own; a mythic one alike")
}

/* -------------------------------------------- */
/*  Midi's averaged damage                      */
/* -------------------------------------------- */

if (MIDI) {
  const swing = fields => send(attack({ actorId: 'brakka', of: 'thorin', item: 'greataxe', activity: 'cleave', ...fields }))
  midi.settings.averageDamage = 'npc'
  const averaged = await swing()
  assert.equal(averaged.status, 'done', JSON.stringify(averaged))
  assert.equal(averaged.damage ?? null, null, "Brakka's damage Midi's own, averaged: none due")
  midi.settings.averageDamage = 'none'
  const due = await swing()
  assert.ok(due.damage?.rolls?.length, 'due as ever')
  midi.settings.averageDamage = 'character'
  const thorins = await send(attack())
  assert.equal(thorins.damage ?? null, null, "Thorin's averaged under character")
  midi.settings.averageDamage = 'none'
  ok("Midi's averaged damage: under npc, Brakka's attack has no damage due; under none, due as ever; Thorin's none due under character")
}

/* -------------------------------------------- */
/*  Combat and chat                             */
/* -------------------------------------------- */

{
  from = app.events.length
  const alone = combatOf('batfight', [{ id: 'cb-bf-bat', token: bat1 }, { id: 'cb-bf-gob', actor: goblin, token: goblinToken }])
  await Hooks.callAll('createCombat', alone, {}, 'gm')
  await settle()
  const created = ofType(since(from), 'combat.created').find(e => e.data.combat.id === 'batfight')
  assert.ok(created, 'a fight with only the Bat reaches the campaign')
  const [batCb, gobCb] = created.data.combat.combatants
  assert.deepEqual([batCb.companion, batCb.hp?.value, gobCb.companion, 'hp' in gobCb], ['arena-bat1', bat1.actor.system.attributes.hp.value, null, false])
  settings.set('chatScope', 'connected')
  from = app.events.length
  const made = await send(skill({ actorId: 'arena-bat1', of: 'thorin' }))
  const own = await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: bat1.actor }), content: '<p>Squeak.</p>' })
  await settle()
  const chat = ofType(since(from), 'chat.message.created').map(e => e.data.message)
  assert.equal(chat.find(m => m.id === messageOf(made.id).id)?.companion, 'arena-bat1', 'by its mark')
  assert.equal(chat.find(m => m.id === own.id)?.companion, 'arena-bat1', 'by its speaker')
  settings.set('chatScope', 'all')
  ok("a fight with only the Bat reaches the campaign, its combatant companion arena-bat1 with its hit points, the goblin's null; the Bat's messages, the module's by its mark and Foundry's by its speaker, are the companion's, in scope though only connected characters' are")
}
// A token of Brakka placed unlinked and hidden: no companion, though its actor is Brakka's, linked.
const brakkaCopy = placeToken(arena, brakka, { id: 'brakka2', name: 'Brakka', hidden: true })
{
  from = app.events.length
  const copyFight = combatOf('copyfight', [{ id: 'cb-cf-thorin', actor: thorin }, { id: 'cb-cf-copy', token: brakkaCopy }])
  await Hooks.callAll('createCombat', copyFight, {}, 'gm')
  await settle()
  const created = ofType(since(from), 'combat.created').find(e => e.data.combat.id === 'copyfight')
  assert.deepEqual(created?.data.combat.combatants.map(each => [each.id, each.companion]), [['cb-cf-thorin', null], ['cb-cf-copy', null]])
  game.combats.delete('copyfight')
  ok("an unlinked token of Brakka, hidden, is no companion in combat: its combatant's companion null, though Brakka's world actor is one")
}

/* -------------------------------------------- */
/*  The queue                                   */
/* -------------------------------------------- */

{
  const realRollAttack = AttackActivity.prototype.rollAttack
  AttackActivity.prototype.rollAttack = async function (...args) {
    if (this.actor?.id === 'thorin') await wait(80)
    return realRollAttack.apply(this, args)
  }
  const [swing, perceive] = await sendAll([attack(), skill({ actorId: 'arena-bat1', of: 'thorin' })])
  AttackActivity.prototype.rollAttack = realRollAttack
  assert.deepEqual([swing.status, perceive.status], ['done', 'done'])
  const order = [...messages.values()].map(m => m.flags?.['sending-stone']?.request ?? m.flags?.['sending-stone']?.use)
  assert.ok(order.lastIndexOf(swing.id) < order.indexOf(perceive.id), "Thorin's attack made before the Bat's skill")
  const [one, two] = await sendAll([skill({ actorId: 'arena-wolf1', of: 'thorin' }), skill({ actorId: 'arena-wolf2', of: 'thorin' })])
  assert.deepEqual([messageOf(one.id).speaker.token, messageOf(two.id).speaker.token], ['wolf1', 'wolf2'], 'each wolf its own')
  ok("a companion's commands wait for its character's: Thorin's slow attack made before the Bat's skill; two wolves' skills each made on its own")
}

/* -------------------------------------------- */
/*  Initiative                                  */
/* -------------------------------------------- */

const cb = id => fight.combatants.get(id)
const initiativeOf = (...ids) => ids.map(id => cb(id).initiative)
const COMPANION_CBS = ['cb-brakka', 'cb-wolf1', 'cb-wolf2', 'cb-bat']
const resetFight = async () => { for (const each of fight.combatants.values()) await fight.setInitiative(each, null) }
const saveInitiative = async value => {
  await game.settings.set('sending-stone', 'campaigns', CAMPAIGNS.map(c => ((c.id === 'camp-a') ? { ...c, companionInitiative: value } : c)))
  await settle()
}
const initiative = (fields = {}) => ({ id: `init-${++ids}`, actorId: 'arena-bat1', of: 'thorin', kind: 'initiative', combatId: 'fight', ...plain, dice: [{ faces: 20, results: [10] }], ...fields })
await resetFight()

// Its own roll: the campaign stored without the field.
{
  assert.equal(ashlands().companionInitiative, 'own')
  const w = fight.writes
  await fight.setInitiative(cb('cb-thorin'), 18.14)
  await settle()
  assert.equal(fight.writes - w, 0, 'nothing written')
  assert.deepEqual(initiativeOf(...COMPANION_CBS), [null, null, null, null])
  const made = await send(initiative())
  assert.equal(made.status, 'done', JSON.stringify(made))
  assert.notEqual(cb('cb-bat').initiative, null, "the Bat's own combatant rolled")
  assert.equal(messageOf(made.id)?.flags['sending-stone'].companion, 'arena-bat1')
  ok("each its own roll, the campaign saved before the field: Thorin's initiative set writes no companion's; the Bat's own initiative, with of, rolled on its own combatant")
}
await resetFight()

// Right after its character.
{
  from = app.events.length
  await saveInitiative('after')
  assert.equal(helloOf().data.features.companions.initiative, 'after', 'the hello says so')
  const w = fight.writes
  await fight.setInitiative(cb('cb-gob'), 18.13)
  await fight.setInitiative(cb('cb-thorin'), 18.14)
  await settle()
  assert.equal(fight.writes - w, 1, 'one write')
  assert.deepEqual(initiativeOf(...COMPANION_CBS), [18.139, 18.139, 18.139, 18.139])
  assert.deepEqual(fight.written.at(-1).options, { 'sending-stone': { follows: true } }, 'marked as the module\'s')
  assert.deepEqual(fight.written.at(-1).updates.map(u => u._id).sort(), [...COMPANION_CBS].sort())
  assert.deepEqual(initiativeOf('cb-gob', 'cb-vex'), [18.13, null], "the goblin's and Vex's untouched")
  const order = fight.turns.map(each => each.id)
  assert.ok(COMPANION_CBS.every(id => order.indexOf(id) < order.indexOf('cb-gob')), 'the goblin below them')
  await settle()
  assert.equal(fight.writes - w, 1, "that write's own hooks write nothing more")
  for (const [value, expected] of [[16, 15.999], [9, 8.999]]) {
    await fight.setInitiative(cb('cb-thorin'), value)
    await settle()
    assert.deepEqual(initiativeOf(...COMPANION_CBS), COMPANION_CBS.map(() => expected), `${value}`)
  }
  assert.deepEqual([followValue(18.14), followValue(16), followValue(9), followValue(0)], [18.139, 15.999, 8.999, -0.001])
  await fight.setInitiative(cb('cb-thorin'), null)
  await settle()
  assert.deepEqual(initiativeOf(...COMPANION_CBS), [null, null, null, null], 'cleared with him')
  await fight.setInitiative(cb('cb-thorin'), 12)
  await settle()
  const before = fight.writes
  await fight.setInitiative(cb('cb-bat'), 5)
  await settle()
  assert.deepEqual([fight.writes - before, cb('cb-bat').initiative], [0, 5], "the Gamemaster's 5 on the Bat stands")
  assert.equal(cb('cb-brakka').flags['sending-stone'].followed, 11.999, 'the value written kept on its combatant')
  // It stands through a save of Manage Campaigns that switches nothing here, one that switches
  // another campaign to after, and this client taking the bridge again, as on a page load; while
  // Thorin's change missed meanwhile still places those the module placed last.
  await game.settings.set('sending-stone', 'campaigns', CAMPAIGNS.map(c => ((c.id === 'camp-a') ? { ...c, companionInitiative: 'after', title: 'Ashlands, renamed' } : c)))
  await settle()
  assert.deepEqual([fight.writes - before, cb('cb-bat').initiative], [0, 5], 'through a save that renames the campaign')
  await game.settings.set('sending-stone', 'campaigns', CAMPAIGNS.map(c => (['camp-a', 'camp-big'].includes(c.id) ? { ...c, companionInitiative: 'after' } : c)))
  await settle()
  assert.deepEqual([fight.writes - before, cb('cb-bat').initiative], [0, 5], 'through another campaign switched to after')
  {
    const gm = users.get('gm')
    gm.isActiveGM = false
    checkBridge()
    await fight.setInitiative(cb('cb-thorin'), 14)
    await settle()
    assert.deepEqual(initiativeOf(...COMPANION_CBS), [11.999, 11.999, 11.999, 5], 'nothing written off the bridge')
    gm.isActiveGM = true
    checkBridge()
    await settle()
    assert.deepEqual(initiativeOf(...COMPANION_CBS), [13.999, 13.999, 13.999, 5], "the bridge again: Thorin's 14 followed by those the module placed, the Gamemaster's 5 standing")
  }
  await fight.setInitiative(cb('cb-thorin'), 18.14)
  await settle()
  assert.equal(cb('cb-bat').initiative, 18.139, "until Thorin's next")
  assert.ok(!fight.written.some(write => write.updates.some(u => /spirit/.test(u._id))), 'the Draconic Spirit, no combatant, untouched')
  // Joining the combat: the Bat while Thorin has 18.14; Thorin with 15, into a fight Brakka is in.
  const bat7 = await createToken(arena, bat, { id: 'bat7', name: 'Bat', delta: { flags: SUMMONED } })
  await settle()
  await fight.createEmbeddedDocuments('Combatant', [{ id: 'cb-bat7', token: bat7 }])
  await settle()
  assert.equal(cb('cb-bat7').initiative, 18.139, 'a companion joining is placed after him')
  const other = combatOf('later', [{ id: 'cb-l-brakka', actor: brakka }])
  await other.createEmbeddedDocuments('Combatant', [{ id: 'cb-l-thorin', actor: thorin, fields: { initiative: 15 } }])
  await settle()
  assert.equal(other.combatants.get('cb-l-brakka').initiative, 14.999, 'Thorin joining with 15 places his companions')
  fight.combatants.delete('cb-bat7')
  await bat7.delete()
  await settle()
  await fight.createEmbeddedDocuments('Combatant', [{ id: 'cb-brakka2', token: brakkaCopy }])
  await settle()
  assert.equal(cb('cb-brakka2').initiative, null, "Brakka's unlinked token, no companion, not placed")
  fight.combatants.delete('cb-brakka2')
  ok("right after its character: the hello says after; Thorin's 18.14 sets Brakka, both wolves and the Bat to 18.139 in one write marked the module's, the goblin's 18.13 below and Vex untouched, its own hooks writing nothing more; 16 makes 15.999, 9 8.999; cleared, theirs cleared; the Gamemaster's 5 on the Bat stands until Thorin's next, through a save that renames the campaign, another campaign switched to after, and the bridge taken again, which follows Thorin's change missed meanwhile for the others; the Spirit, no combatant, untouched; a companion joining placed, an unlinked token of Brakka's not, and Thorin joining with 15 places his at 14.999")
}
await resetFight()

// Leaders: a wolf both Alice and Bob own follows the first of its characters with an initiative.
{
  await changeDelta(wolf2b, { ownership: { bob: 3 } })
  await settle()
  assert.deepEqual(companionList(ashlands()).find(each => each.key === 'arena-wolf2').of, ['thorin', 'vex'], 'of both')
  await fight.setInitiative(cb('cb-thorin'), 18.14)
  await fight.setInitiative(cb('cb-vex'), 12)
  await settle()
  assert.equal(cb('cb-wolf2').initiative, 18.139)
  await fight.setInitiative(cb('cb-vex'), 20)
  await settle()
  assert.equal(cb('cb-wolf2').initiative, 18.139, 'Thorin leads')
  await fight.setInitiative(cb('cb-thorin'), null)
  await settle()
  assert.equal(cb('cb-wolf2').initiative, 19.999, 'Vex leads now')
  await fight.setInitiative(cb('cb-vex'), null)
  await settle()
  assert.equal(cb('cb-wolf2').initiative, null, 'no one leads')
  await changeDelta(wolf2b, { ownership: { bob: 0 } })
  await settle()
  ok("a wolf Alice and Bob both own, of Thorin and Vex: 18.139 after Thorin's 18.14 with Vex at 12, still when Vex has 20, Thorin leading; 19.999 once Thorin's is cleared; cleared with Vex's")
}
await resetFight()

// The writer: the active Gamemaster's client alone.
{
  const gm = users.get('gm')
  gm.isActiveGM = false
  checkBridge()
  const w = fight.writes
  await fight.setInitiative(cb('cb-thorin'), 10)
  await settle()
  assert.equal(fight.writes - w, 0, 'not the bridge: nothing written')
  gm.isActiveGM = true
  checkBridge()
  await settle()
  assert.deepEqual(initiativeOf(...COMPANION_CBS), COMPANION_CBS.map(() => 9.999), 'becoming the bridge places them')
  await saveInitiative('own')
  await fight.setInitiative(cb('cb-thorin'), 7)
  await settle()
  assert.deepEqual(initiativeOf(...COMPANION_CBS), COMPANION_CBS.map(() => 9.999), 'under its own roll, nothing written')
  // The Bat's own roll under its own roll: switched to after, it's placed too.
  await fight.setInitiative(cb('cb-bat'), 2)
  await saveInitiative('after')
  assert.deepEqual(initiativeOf(...COMPANION_CBS), COMPANION_CBS.map(() => 6.999), 'saved after: every companion placed at once, its own roll among them')
  await saveInitiative('own')
  const own = fight.writes
  await fight.setInitiative(cb('cb-thorin'), 3)
  await settle()
  assert.equal(fight.writes - own, 0, 'saved back own: nothing written')
  // Pell and Quill, each the other's companion.
  const cycle = combatOf('cycle', [{ id: 'cb-pell', actor: pell }, { id: 'cb-quill', actor: quill }])
  await cycle.setInitiative(cycle.combatants.get('cb-pell'), 10)
  await settle(); await settle()
  assert.deepEqual([cycle.combatants.get('cb-quill').initiative, cycle.writes], [9.999, 1], 'Quill written once, and nothing more')
  assert.equal(cycle.combatants.get('cb-pell').initiative, 10)
  ok("only the bridge writes: not the active Gamemaster's client, nothing; becoming it places them; under its own roll nothing; saved after, every companion placed at once; saved back, nothing; Pell's set moves Quill once, Quill's move never moving Pell")
}
await resetFight()

// A companion's own initiative command under right after its character.
{
  await saveInitiative('after')
  const before = messages.size
  const refused = await send(initiative())
  assert.deepEqual([refused.status, refused.reason], ['failed', 'follows'], 'refused while Thorin is in the combat')
  assert.deepEqual([cb('cb-bat').initiative, messages.size], [null, before], 'nothing rolled')
  const batfight = game.combats.get('batfight')
  game.combat = batfight
  const alone = await send(initiative({ combatId: 'batfight' }))
  assert.equal(alone.status, 'done', `with Thorin not in it: ${JSON.stringify(alone)}`)
  game.combat = fight
  await saveInitiative('own')
  const rolled = await send(initiative())
  assert.equal(rolled.status, 'done', `own: ${JSON.stringify(rolled)}`)
  ok("the Bat's own initiative under right after its character: refused follows while Thorin is in the combat, nothing rolled; rolled where he isn't; rolled under its own roll")
}

// Since module 0.51.0 (item 36): a sidekick fighting without its character, on another scene, its
// fight begun and chosen there while the Gamemaster has the arena's up.
{
  const den = combatOf('denfight', [{ id: 'cb-df-brakka', actor: brakka }])
  den._source.scene = 'den'
  den.round = 1
  den.turn = 0
  game.combat = fight
  const own = den.combatants.get('cb-df-brakka')
  const arena = cb('cb-brakka').initiative
  for (const value of ['after', 'own']) {
    await saveInitiative(value)
    await den.setInitiative(own, null)
    const made = await send(initiative({ actorId: 'brakka', combatId: 'denfight' }))
    assert.equal(made.status, 'done', `${value}: ${JSON.stringify(made)}`)
    assert.notEqual(own.initiative, null, `${value}: her den combatant set`)
    assert.equal(cb('cb-brakka').initiative, arena, `${value}: the arena's untouched`)
  }
  await den.setInitiative(own, null)
  den.active = false
  const unchosen = await send(initiative({ actorId: 'brakka', combatId: 'denfight' }))
  den.active = true
  den.round = 0
  const unbegun = await send(initiative({ actorId: 'brakka', combatId: 'denfight' }))
  assert.deepEqual([unchosen.status, unchosen.reason, unbegun.status, unbegun.reason], ['failed', 'not-in-combat', 'failed', 'not-in-combat'], 'not chosen, or not begun: refused')
  assert.equal(own.initiative, null, 'nothing set')
  game.combats.delete('denfight')
  ok("a sidekick fighting without its character: Brakka's initiative, with of, rolled into her own begun fight on the den while the Gamemaster has the arena's up, under its own roll and right after its character alike, Thorin's fight untouched; refused not-in-combat where the den's isn't its scene's chosen one, or hasn't begun")
}

// Since module 0.40.0 (its contract §4.2): Thorin shaped, his combatant made from his form's token,
// which keeps the form's id, leads his companions under right after its character as his own does.
{
  await saveInitiative('after')
  const form = companionActor('thorinForm000000', 'Thorin (Wolf)', {
    owners: ['alice'], type: 'character', flags: { dnd5e: { isPolymorphed: true, originalActor: 'thorin', previousActorIds: ['thorin'] } },
  })
  const shaped = combatOf('shaped', [{ id: 'cb-s-form', actor: form }, { id: 'cb-s-brakka', actor: brakka }])
  await shaped.setInitiative(shaped.combatants.get('cb-s-form'), 17)
  await settle()
  assert.equal(shaped.combatants.get('cb-s-brakka').initiative, 16.999, "Brakka right after the form's combatant")
  const joined = combatOf('joined', [{ id: 'cb-j-form', actor: form, fields: { initiative: 17 } }])
  await joined.createEmbeddedDocuments('Combatant', [{ id: 'cb-j-brakka', actor: brakka }])
  await settle()
  assert.equal(joined.combatants.get('cb-j-brakka').initiative, 16.999, "Brakka joining a combat where the form's combatant has 17")
  const batShaped = combatOf('batshaped', [{ id: 'cb-bs-form', actor: form }, { id: 'cb-bs-bat', token: bat1 }])
  game.combat = batShaped
  const refused = await send(initiative({ combatId: 'batshaped' }))
  assert.deepEqual([refused.status, refused.reason], ['failed', 'follows'], "the Bat's own initiative refused while the form's combatant is in the combat")
  game.combat = fight
  await saveInitiative('own')
  for (const id of ['shaped', 'joined', 'batshaped']) game.combats.delete(id)
  actors.delete(form.id)
  ok("right after its character, Thorin shaped (round 0.40.0): his form's combatant, which keeps the form's id, leads Brakka, set and joining, and the Bat's own initiative is refused follows while it's in the combat")
}

// Since module 0.41.0 (its contract §8.2.2): an app that reads damage on its own's choices is sent a
// companion's with them, and a companion's damage on its own spends on its live actor. Only here does
// the stand-in app answer aloneChoices; every case above is as before.
{
  brakka.items.set('brakka-potion', new Item5e(brakka, {
    id: 'brakka-potion', name: 'Potion of Healing', type: 'consumable', system: { properties: [], quantity: 2, type: { value: 'potion' }, uses: { max: 1, spent: 0, autoDestroy: true } },
    activities: [{ id: 'bp-heal', type: 'heal', activation: { type: 'bonus', value: 1 }, healing: { number: 2, denomination: 4, bonus: '2', types: ['healing'] }, consumption: [{ type: 'itemUses', value: '1' }] }],
  }))
  let from = app.events.length
  app.features = { commands: true, companions: 1, aloneChoices: 1 }
  clock += 31_000
  heartbeat()
  await until(() => sheetsSent(from).some(e => e.data.companion.key === 'brakka'), "Brakka's sheet again")
  await settle()
  const rowsIn = whole => {
    const found = []
    JSON.stringify(whole, (key, value) => {
      if (value && (typeof value === 'object') && Object.hasOwn(value, 'tableDamage')) found.push(value)
      return value
    })
    return found
  }
  const potionRow = rowsIn(sheetOf('brakka')).find(row => (row.activity?.id === 'bp-heal') || (row.id === 'bp-heal'))
  assert.deepEqual([potionRow?.tableDamage?.choices, potionRow?.tableDamage?.spends], [[], ['uses']], "Brakka's potion: choices and spends")
  const made = await send({ id: `alone-${++ids}`, actorId: 'brakka', of: 'thorin', kind: 'itemDamage', item: 'brakka-potion', activity: 'bp-heal', consume: true, ...plain, dice: [{ faces: 4, results: [2, 3] }] })
  assert.equal(made.status, 'done', JSON.stringify(made))
  assert.deepEqual([made.alone, brakka.items.get('brakka-potion').system.quantity], [{ spent: ['uses'] }, 1], "spent on Brakka's own actor")
  assert.equal(messageOf(made.id).flags['sending-stone'].companion, 'brakka')
  from = app.events.length
  app.features = { commands: true, companions: 1 }
  clock += 31_000
  heartbeat()
  await until(() => sheetsSent(from).some(e => e.data.companion.key === 'brakka'), "Brakka's sheet again, without them")
  await settle()
  assert.ok(rowsIn(sheetOf('brakka')).every(row => (row.tableDamage === null) || isDeepStrictEqual(Object.keys(row.tableDamage), ['normal', 'critical'])), 'without them once the answer drops it')
  brakka.items.delete('brakka-potion')
  ok("an app answering aloneChoices 1 is sent a companion's sheet again with choices and spends, Brakka's potion [uses]; its damage on its own with consume, of: thorin, spends on Brakka's actor; dropped, sent again without them")
}

// Since module 0.52.0 (item 65): an app that reads checks on any ability the game has is sent every
// companion's sheet again with them, in answer to a heartbeat: a check activity on Sanity carries
// its check, and a companion's descriptions are hashed for that app, so that a command reads its
// links as they were sent. Only here does the stand-in app answer anyAbility; every case above is
// as before.
{
  CONFIG.DND5E.abilities.san = { label: 'Sanity' }
  brakka.system.abilities.san = foundry.utils.deepClone(brakka.system.abilities.wis)
  brakka.items.set('brakka-wits', new Item5e(brakka, {
    id: 'brakka-wits', name: 'Keen Wits', type: 'feat', system: { properties: [], description: { value: '<p>Wits.</p>' } },
    activities: [{ id: 'bw-check', type: 'check', affects: '', range: 'self', check: { ability: 'san', associated: [], dc: { formula: '12' } } }],
  }))
  const witsOf = () => sheetOf('brakka')?.actions?.flatMap(section => section.actions).find(action => action.id === 'brakka-wits')
  const spirit = arena.tokens.get('spirit1').actor
  const { characterSheet } = await import(`${MODULE}/scripts/sheet.mjs`)
  const { SheetTexts } = await import(`${MODULE}/scripts/sheet-texts.mjs`)
  // The Spirit's claws as one app or the other is sent them, without the Gamemaster's secrets.
  const clawsFor = anyAbility => {
    const texts = new SheetTexts({ secrets: false, anyAbility })
    characterSheet(spirit, texts, { secrets: false, ops: false })
    return [...texts.sources].find(([, source]) => String(source.html ?? '').includes('Claws'))?.[0]
  }
  const sentClaws = () => (JSON.stringify(sheetOf('arena-spirit1')).match(/"text":"([0-9a-f]{14})"/g) ?? []).map(m => m.slice(8, -1))
  const [anyClaws, sixClaws] = [clawsFor(true), clawsFor(false)]
  assert.ok(anyClaws && sixClaws && (anyClaws !== sixClaws), 'hashed apart')
  let from = app.events.length
  app.features = { commands: true, companions: 1, anyAbility: 1 }
  clock += 31_000
  heartbeat()
  await until(() => sheetsSent(from).some(e => e.data.companion.key === 'brakka'), "Brakka's sheet again")
  // A sheet is sent only where it changed: the Spirit's, as its descriptions' hashes did.
  await until(() => sentClaws().includes(anyClaws), "the Spirit's claws hashed as for an app that reads checks on any ability")
  await settle()
  // Under dnd5e 6, no check activity is offered at all.
  assert.deepEqual(witsOf()?.check, DND5E6 ? undefined : { checks: [{ type: 'check', ability: 'san' }], dc: 12, own: true }, `Brakka's Sanity check: ${JSON.stringify(witsOf())}`)
  assert.ok(!sentClaws().includes(sixClaws), "the Spirit's claws as for an older app no more")
  const linkSave = text => send({ id: `any-${++ids}`, actorId: 'arena-spirit1', of: 'thorin', kind: 'save', key: 'dex', ...plain, dice: [{ faces: 20, results: [11] }], text, link: 0 })
  const made = await linkSave(anyClaws)
  assert.equal(made.status, 'done', JSON.stringify(made))
  const gone = await linkSave(sixClaws)
  assert.deepEqual([gone.status, gone.reason], ['failed', 'gone'], 'as an older app is sent it: gone')
  if (!DND5E6) {
    const sanity = await send({ id: `any-${++ids}`, actorId: 'brakka', of: 'thorin', kind: 'ability', key: 'san', item: 'brakka-wits', activity: 'bw-check', ...plain, dice: [{ faces: 20, results: [11] }] })
    assert.equal(sanity.status, 'done', JSON.stringify(sanity))
  }
  from = app.events.length
  app.features = { commands: true, companions: 1 }
  clock += 31_000
  heartbeat()
  await until(() => sheetsSent(from).some(e => e.data.companion.key === 'brakka'), "Brakka's sheet again, without them")
  await until(() => sentClaws().includes(sixClaws), "the Spirit's claws hashed as before")
  await settle()
  assert.ok(witsOf() && (witsOf().check === undefined), 'no check to an app before 0.52.0')
  assert.ok(!sentClaws().includes(anyClaws), "the Spirit's claws as for an app that reads checks on any ability no more")
  brakka.items.delete('brakka-wits')
  delete brakka.system.abilities.san
  delete CONFIG.DND5E.abilities.san
  ok(`an app answering anyAbility 1 is sent every companion's sheet again, ${DND5E6 ? '' : "Brakka's check activity on Sanity with its check and rolled, of: thorin, and "}the Spirit's descriptions hashed for it, its claws' save made by that hash and gone by the other; dropped, sent again as before`)
}

// Round 0.41.0 §2.5.3.2 and §2.6.6: under Midi-QOL's Enforce settings, in a fight, a companion's damage
// on its own that spends is checked and marked on the companion, as Midi keeps a Bonus Action and a
// reaction on each actor: its own used refuses it, its character's never does, and the mark is its own.
if (MIDI) {
  brakka.items.set('brakka-potion', new Item5e(brakka, {
    id: 'brakka-potion', name: 'Potion of Healing', type: 'consumable', system: { properties: [], quantity: 2, type: { value: 'potion' }, uses: { max: 1, spent: 0, autoDestroy: true } },
    activities: [{ id: 'bp-heal', type: 'heal', activation: { type: 'bonus', value: 1 }, healing: { number: 2, denomination: 4, bonus: '2', types: ['healing'] }, consumption: [{ type: 'itemUses', value: '1' }] }],
  }))
  brakka.items.set('brakka-snap', new Item5e(brakka, {
    id: 'brakka-snap', name: 'Snap', type: 'feat', system: { properties: [], uses: { max: 2, spent: 0, recovery: [] } },
    activities: [{ id: 'bs-hit', type: 'damage', activation: { type: 'reaction', value: 1 }, damage: [{ number: 1, denomination: 6, types: ['piercing'] }], consumption: [{ type: 'itemUses', value: '1' }] }],
  }))
  const alone = (item, activity, dice) => send({ id: `alone-${++ids}`, actorId: 'brakka', of: 'thorin', kind: 'itemDamage', item, activity, consume: true, ...plain, dice })
  const drink = () => alone('brakka-potion', 'bp-heal', [{ faces: 4, results: [2, 3] }])
  const snap = () => alone('brakka-snap', 'bs-hit', [{ faces: 6, results: [4] }])
  const refused = (made, reason) => assert.deepEqual([made.status, made.reason], ['failed', reason], JSON.stringify(made))
  const done = made => assert.equal(made.status, 'done', JSON.stringify(made))
  game.combat = fight
  assert.deepEqual([brakka.inCombat, thorin.inCombat], [true, true], 'both in the fight')
  midi.settings.enforceBonusActions = 'all'
  midi.settings.enforceReactions = 'all'
  // Brakka's own Bonus Action used: refused, nothing rolled or spent.
  midi.usedBonus.add('brakka')
  const before = messages.size
  refused(await drink(), 'bonus-action')
  assert.deepEqual([messages.size, brakka.items.get('brakka-potion').system.quantity], [before, 2], 'nothing rolled, nothing spent')
  // Thorin's used, Brakka's not: drunk, and marked on Brakka alone.
  midi.usedBonus.clear()
  midi.usedBonus.add('thorin')
  let marks = midi.bonusMarks.length
  done(await drink())
  assert.deepEqual([midi.bonusMarks.slice(marks), brakka.items.get('brakka-potion').system.quantity], [['brakka'], 1], 'marked on Brakka, never Thorin')
  // A reaction the same: Brakka's own used refuses it; Thorin's doesn't, and the mark is Brakka's.
  midi.usedReaction.add('brakka')
  refused(await snap(), 'reaction')
  midi.usedReaction.clear()
  midi.usedReaction.add('thorin')
  marks = midi.reactionMarks.length
  done(await snap())
  assert.deepEqual([midi.reactionMarks.slice(marks), brakka.items.get('brakka-snap').system.uses.spent], [['brakka'], 1], 'its reaction marked on Brakka, never Thorin')
  midi.usedBonus.clear()
  midi.usedReaction.clear()
  midi.settings.enforceBonusActions = 'none'
  midi.settings.enforceReactions = 'none'
  brakka.items.delete('brakka-potion')
  brakka.items.delete('brakka-snap')
  ok("Midi-QOL's Enforce bonus actions and reactions \"all\", in a fight: Brakka's potion with consume refused \"bonus-action\" while Brakka's own Bonus Action is used, nothing rolled; with only Thorin's used, drunk and marked on Brakka, never Thorin; a reaction of Brakka's refused \"reaction\" while Brakka's own is used, with only Thorin's used done and marked on Brakka")
}

/* -------------------------------------------- */
/*  Two campaigns in one world (module 0.45.0)  */
/* -------------------------------------------- */

// The app's ROADMAP item 19, the owner's answers Q1 A and Q2 A: Brightwater beside Ashlands, its
// character Orla shared with every player as Owner through her default and owned by no one by id, as
// a Gamemaster may share a party's sheets. Alice's sidekick, Brakka, is never Orla's companion, so
// Ashlands' fight with Brakka in it doesn't reach Brightwater; and a public card that's Ashlands'
// alone stays out of every other campaign's chat.
{
  const carol = user('carol', 'Carol')
  const orla = add(new Actor5e({ id: 'orla', name: 'Orla', mods: { dex: 1 }, skills: { prc: { ability: 'wis' } } }))
  equip(orla, { items: [] })
  orla.ownership = { default: 3 }
  // Carol's own sidekick, by id; an orc no one owns, unlinked, and an ogre and an innkeeper, linked.
  companionActor('kestrel', 'Kestrel', { owners: ['carol'], linked: true, spec: creature({ dex: 2 }) })
  const orcToken = placeToken(arena, companionActor('orc', 'Orc', { linked: false, spec: creature({ str: 3 }) }), { id: 'orc1', name: 'Orc' })
  const ogre = companionActor('ogre', 'Ogre', { linked: true, spec: creature({ str: 4 }) })
  const innkeeper = companionActor('innkeeper', 'Innkeeper', { linked: true, spec: creature() })
  const { ownedByPlayers } = await import(`${MODULE}/scripts/creatures.mjs`)
  settings.set('campaignSecrets', { ...settings.get('campaignSecrets'), 'camp-b': 'b-secret' })
  from = app.events.length
  await game.settings.set('sending-stone', 'campaigns', [...settings.get('campaigns'), { id: 'camp-b', title: 'Brightwater', characters: ['orla'], rolls: true, attacks: true }])
  await until(() => since(from).some(e => (e.type === 'bridge.hello') && (e.campaign.id === 'camp-b')), "Brightwater's hello")
  await settle()
  assert.deepEqual(helloOf('camp-b').data.companions, [], 'none of Alice\'s, Bob\'s or anyone\'s NPCs through her default')
  assert.equal(ownedByPlayers(brakka, ['orla']), false, "Brakka's secrets not hers")

  // Ashlands' fight: Thorin, his player's sidekick Brakka, and the orc.
  from = app.events.length
  const ashfight = combatOf('ashfight', [{ id: 'cb-af-thorin', actor: thorin }, { id: 'cb-af-brakka', actor: brakka }, { id: 'cb-af-orc', token: orcToken }])
  await Hooks.callAll('createCombat', ashfight, {}, 'gm')
  await settle()
  assert.ok(ofType(since(from), 'combat.created').some(e => e.data.combat.id === 'ashfight'), 'Ashlands is told of its fight')
  announce('camp-b')
  await until(() => since(from).some(e => (e.type === 'bridge.hello') && (e.campaign.id === 'camp-b')), "Brightwater's hello again")
  await settle()
  assert.deepEqual(since(from).filter(e => (e.campaign?.id === 'camp-b') && /^(combat|companion)/.test(e.type)).map(e => e.type), [], 'Brightwater told of no fight, no companion and no sheet')
  assert.deepEqual([helloOf('camp-b').data.combats, helloOf('camp-b').data.companions], [[], []], "its hello's combats and companions")
  const refused = await send(skill({ actorId: 'brakka', of: 'orla' }), 'camp-b')
  assert.deepEqual([refused.status, refused.reason], ['failed', 'unknown'], "Brakka as Orla's, from Brightwater")
  ok("a character shared with every player through its default, Orla, is no one's for companions: Brightwater lists none of Ashlands' players' NPCs, isn't told of Ashlands' fight with Alice's sidekick in it, nor in its hello, gets no sheet of Brakka's, nor its secrets, and a command for Brakka as Orla's is refused unknown")

  // Public cards, under "All its players can read": Ashlands' alone, or every campaign's.
  const everyone = getCampaigns().map(campaign => campaign.id).sort()
  // The events of a type a message was sent in since `at`, and the campaigns they're for.
  const copiesOf = (at, type, made) => since(at).filter(e => (e.type === type) && ((e.data.message?.id ?? e.data.id) === made.id))
  const campaignsOf = copies => copies.map(e => e.campaign.id).sort()
  const say = async (speaker, fields = {}) => {
    const at = app.events.length
    const made = await ChatMessage.create({ speaker, content: '<p>Cards.</p>', ...fields })
    await settle()
    return { made, copies: copiesOf(at, 'chat.message.created', made) }
  }
  const reach = async (speaker, fields) => campaignsOf((await say(speaker, fields)).copies)
  assert.equal(settings.get('chatScope') ?? 'all', 'all')
  assert.deepEqual(await reach(ChatMessage.getSpeaker({ actor: orcToken.actor }), { flavor: 'Orc rolls for Initiative!' }), ['camp-a'], "the orc's initiative in Ashlands' fight")
  assert.deepEqual(await reach(ChatMessage.getSpeaker({ actor: thorin }), { author: 'alice' }), ['camp-a'], "Thorin's attack")
  assert.deepEqual(await reach(ChatMessage.getSpeaker({ actor: brakka }), { author: 'alice' }), ['camp-a'], "Brakka's, Ashlands' companion")
  assert.deepEqual(await reach({}, { content: '<p>Roll initiative!</p>' }), everyone, "the Gamemaster's narration")
  const innkeepers = await say(ChatMessage.getSpeaker({ actor: innkeeper }))
  assert.deepEqual(campaignsOf(innkeepers.copies), everyone, 'an innkeeper in no fight')
  // A fight both are in: Thorin, Orla and the ogre.
  from = app.events.length
  const sharedfight = combatOf('sharedfight', [{ id: 'cb-sf-thorin', actor: thorin }, { id: 'cb-sf-orla', actor: orla }, { id: 'cb-sf-ogre', actor: ogre }])
  await Hooks.callAll('createCombat', sharedfight, {}, 'gm')
  await settle()
  assert.deepEqual(['camp-a', 'camp-b'].map(id => ofType(since(from), 'combat.created', id).some(e => e.data.combat.id === 'sharedfight')), [true, true], 'both told of it')
  const ogres = await say(ChatMessage.getSpeaker({ actor: ogre }))
  assert.deepEqual(campaignsOf(ogres.copies), ['camp-a', 'camp-b'], "the ogre's, in a fight both are in")
  const orlas = await say(ChatMessage.getSpeaker({ actor: orla }))
  assert.deepEqual(orlas.copies.map(e => [e.campaign.id, e.data.message.character]).sort(), [['camp-a', null], ['camp-b', 'orla']], "Orla's, in a fight both are in, hers in Brightwater's copy alone")
  ok("a public card that's another campaign's alone is left out: the orc's in Ashlands' fight, by its token, Thorin's and Brakka's reach Ashlands only; the Gamemaster's narration and an innkeeper in no fight reach every campaign; in a fight both are in, the ogre's, by its actor, and Orla's reach both, and no other, Orla named its speaker in Brightwater's alone")

  // Module 0.46.0, the app's ROADMAP item 37: wherever a campaign reads who plays a character, its
  // players are as for its companions. Orla, shared through her default and owned by no one by id,
  // has none, so no other player's whisper or private roll reaches Brightwater; and under Challenge
  // Visibility's "Hide all", the outcome of Alice's check in the fight both are in is told to its
  // author's characters alone, Thorin, never Orla.
  // A Perception check against DC 13, by its author, spoken by the actor: its check as each campaign is told it.
  const checkOf = async (actor, author) => {
    const roll = await new CONFIG.Dice.D20Roll('1d20 + 2', {}, { target: 13, criticalSuccess: 20, criticalFailure: 1 }).evaluate()
    const { copies } = await say(ChatMessage.getSpeaker({ actor }), { author, rolls: [roll], flags: { dnd5e: { roll: { type: 'skill', skillId: 'prc' } } } })
    return Object.fromEntries(copies.map(e => [e.campaign.id, e.data.message.dnd5e?.check]))
  }
  settings.set('challengeVisibility', 'none')
  assert.deepEqual(await reach({}, { author: 'bob', whisper: ['alice'] }), ['camp-a'], "Bob's whisper to Alice")
  assert.deepEqual(await reach({}, { author: 'alice', rollMode: 'gmroll' }), ['camp-a'], "Alice's private roll")
  const alices = await checkOf(thorin, 'alice')
  assert.deepEqual([Object.keys(alices).sort(), alices['camp-a']?.readers, alices['camp-b']], [['camp-a', 'camp-b'], ['thorin'], { target: 'Actor.thorin' }], "Alice's check in the fight both are in")
  settings.delete('challengeVisibility')
  ok("module 0.46.0: Orla, shared with every player through her default and owned by no one by id, has no player: Bob's whisper to Alice and Alice's private roll reach Ashlands alone; and under Hide all, Alice's check in the fight both are in tells its outcome to Thorin's seat alone, never Brightwater")

  // Item 38: her roster names no owner; and in Foundry a dish's card is whispered to the Gamemaster
  // alone, and a group Bob owns isn't hers to see.
  const { readersOf } = await import(`${MODULE}/scripts/dish-card.mjs`)
  const { accessFor } = await import(`${MODULE}/scripts/groups.mjs`)
  const brightwater = () => getCampaigns().find(campaign => campaign.id === 'camp-b')
  // A group the Gamemaster lists for Brightwater, its ownership as core keeps it: Carol observes it,
  // and Bob, of Ashlands, owns it.
  const hall = { ownership: { default: 0, carol: 2, bob: 3 }, getUserLevel(user) { return user.isGM ? 3 : (this.ownership[user.id] ?? this.ownership.default) } }
  assert.deepEqual(helloOf('camp-b').data.characters.map(each => [each.id, each.owners]), [['orla', []]], 'her roster')
  assert.deepEqual([readersOf(brightwater()), accessFor(hall, orla)], [['gm'], null], "a dish's card's readers, the hall")
  ok("module 0.46.0: Orla's roster names no owner; a dish's card is whispered to the Gamemaster alone; and a hall Bob owns and Carol observes isn't hers to see")

  // Item 40: under "Hide all", Alice's card's DC isn't her player's own.
  const { showsChallenge } = await import(`${MODULE}/scripts/results.mjs`)
  settings.set('challengeVisibility', 'none')
  assert.equal(showsChallenge({ author: alice }, orla), false, "Alice's card's DC")
  settings.delete('challengeVisibility')
  ok("module 0.46.0: under Hide all, Alice's card's DC isn't Orla's player's own")

  // Whose a card is is read as it's made: its edits go where it went, whatever fight has begun or
  // ended since, and a deletion goes to every campaign, as one never held deletes nothing; one made
  // while this browser didn't send chat, as before it began sending, is read as the fights stand at
  // its edit. A tavern brawl, Ashlands' alone: Thorin and the innkeeper.
  const editTo = async ({ made }) => {
    const at = app.events.length
    await made.update({ content: '<p>Edited.</p>' })
    await settle()
    return campaignsOf(copiesOf(at, 'chat.message.updated', made))
  }
  const deleteTo = async ({ made }) => {
    const at = app.events.length
    await made.delete()
    await Hooks.callAll('deleteChatMessage', made, {}, 'gm')
    await settle()
    return campaignsOf(copiesOf(at, 'chat.message.deleted', made))
  }
  const brawl = combatOf('brawl', [{ id: 'cb-br-thorin', actor: thorin }, { id: 'cb-br-innkeeper', actor: innkeeper }])
  await Hooks.callAll('createCombat', brawl, {}, 'gm')
  await settle()
  const brawls = await say(ChatMessage.getSpeaker({ actor: innkeeper }))
  assert.deepEqual(campaignsOf(brawls.copies), ['camp-a'], "the innkeeper's in the brawl")
  assert.deepEqual(await editTo(innkeepers), everyone, "the innkeeper's from before the brawl, edited in it")
  settings.set('chatEvents', false)
  const unsent = await say(ChatMessage.getSpeaker({ actor: innkeeper }))
  settings.set('chatEvents', true)
  assert.deepEqual(await editTo(unsent), ['camp-a'], "the innkeeper's in the brawl, made while chat wasn't sent, edited in it")
  for (const fight of [brawl, sharedfight]) {
    game.combats.delete(fight.id)
    await Hooks.callAll('deleteCombat', fight, {}, 'gm')
  }
  await settle()
  assert.deepEqual(await editTo(brawls), ['camp-a'], "the innkeeper's from the brawl, edited once it's over")
  assert.deepEqual(await editTo(ogres), ['camp-a', 'camp-b'], "the ogre's from the fight both were in, edited once it's over")
  assert.deepEqual(await deleteTo(brawls), everyone, "the innkeeper's from the brawl, deleted")
  assert.deepEqual(await deleteTo(orlas), everyone, "Orla's from the fight both were in, deleted once it's over")
  ok("a card's edits go where it went as it was made: the innkeeper's from before Ashlands' brawl, edited in it, to every campaign; one made in the brawl while chat wasn't sent, edited in it, to Ashlands alone, as the fights stand; once the brawl and the fight both were in are over, the innkeeper's from the brawl edited to Ashlands alone, the ogre's to both; and a card's deletion to every campaign, the brawl's and Orla's alike")

  // Orla assigned to Carol in User Configuration: Carol's own sidekick is hers.
  from = app.events.length
  carol.character = orla
  await Hooks.callAll('updateUser', carol, { character: 'orla' }, {}, 'gm')
  await until(() => listed(from, 'camp-b').length, "Brightwater's list")
  await settle()
  assert.deepEqual(listed(from, 'camp-b').at(-1).data.companions.map(each => [each.key, each.of]), [['kestrel', ['orla']]])
  ok("Orla assigned to Carol, owned by no one by id: Carol's own sidekick, Kestrel, is listed hers, and no one else's NPC")
  // Module 0.46.0: her card's DC is her player's own on her form too, as Midi-QOL's concentration card
  // speaks for the form, which dnd5e makes with her ownership and assigns no one: Carol's, never Bob's.
  const wolfForm = new Actor5e({ id: 'orlaWolf', name: 'Orla (Wolf)', flags: { isPolymorphed: true, originalActor: 'orla', previousActorIds: [] } })
  wolfForm.ownership = { ...orla.ownership }
  settings.set('challengeVisibility', 'none')
  assert.deepEqual([showsChallenge({ author: carol }, wolfForm), showsChallenge({ author: bob }, wolfForm)], [true, false], "Carol's and Bob's cards' DCs, on her form")
  settings.delete('challengeVisibility')
  ok("module 0.46.0: Orla assigned to Carol, in a form dnd5e made of her: Carol's card's DC is her player's own, Bob's isn't")

  // Carol and Alice made Owners of Orla by their own ids, Alice playing in both: Alice's NPCs are
  // Orla's too, and, as since module 0.36.0, a fight her sidekick is in reaches Brightwater.
  from = app.events.length
  orla.ownership = { default: 3, carol: 3, alice: 3 }
  await Hooks.callAll('updateActor', orla, { ownership: { carol: 3, alice: 3 } }, {}, 'gm')
  await until(() => listed(from, 'camp-b').length, "Brightwater's list again")
  await settle()
  const coOwned = listed(from, 'camp-b').at(-1).data.companions
  assert.ok(['brakka', 'kestrel'].every(key => coOwned.some(each => (each.key === key) && isDeepStrictEqual(each.of, ['orla']))), 'Brakka and Kestrel hers')
  assert.ok(ofType(since(from), 'combat.created', 'camp-b').some(e => e.data.combat.id === 'ashfight'), "Ashlands' fight, Brakka in it")
  assert.equal(ownedByPlayers(brakka, ['orla']), true, 'with her secrets')
  const taken = await send(skill({ actorId: 'brakka', of: 'orla' }), 'camp-b')
  assert.equal(taken.status, 'done', JSON.stringify(taken))
  game.combats.delete(ashfight.id)
  ok("Carol and Alice given Owner on Orla by their own ids: Alice's NPCs are Orla's too, beside Kestrel, Brakka with its secrets, taken as Orla's from Brightwater, and Ashlands' fight with Brakka in it reaches Brightwater")

  // Module 0.46.0, item 37: owned by Carol and Alice by their own ids, Orla's players are theirs alone,
  // though she's still shared with every player through her default: the Gamemaster's whisper to
  // Carol reaches Brightwater and Bob's to Dave doesn't; and Carol's check on Orla tells her seat its
  // outcome.
  settings.set('challengeVisibility', 'none')
  assert.deepEqual(await reach({}, { whisper: ['carol'] }), ['camp-b'], "the Gamemaster's whisper to Carol")
  assert.deepEqual(await reach({}, { author: 'bob', whisper: ['dave'] }), ['camp-a'], "Bob's whisper to Dave")
  const carols = await checkOf(orla, 'carol')
  assert.deepEqual([Object.keys(carols), carols['camp-b']?.readers, 'outcome' in (carols['camp-b'] ?? {})], [['camp-b'], ['orla'], true], "Carol's check on Orla")
  settings.delete('challengeVisibility')
  ok("module 0.46.0: Orla owned by Carol and Alice by their own ids, still shared through her default: the Gamemaster's whisper to Carol reaches Brightwater, Bob's to Dave doesn't; and Carol's check on Orla tells her seat its outcome")

  // Item 38: her roster names Alice and Carol; a dish's card is whispered to them; and the hall is
  // hers to observe, as Carol does, never to own, as Bob does.
  await until(() => ofType(since(from), 'character.updated', 'camp-b').some(e => e.data.character.id === 'orla'), "Orla's roster entry again")
  assert.deepEqual(ofType(since(from), 'character.updated', 'camp-b').at(-1).data.character.owners, [{ id: 'alice', name: 'Alice' }, { id: 'carol', name: 'Carol' }], 'her roster')
  assert.deepEqual([readersOf(brightwater()), accessFor(hall, orla)], [['gm', 'alice', 'carol'], 'observer'], "a dish's card's readers, the hall")
  ok("module 0.46.0: Orla owned by Carol and Alice by their own ids: her roster names them; a dish's card is whispered to them and the Gamemaster; and the hall is hers to observe, as Carol does, never to own, as Bob does")

  // Item 40: Carol's card's DC is her player's own, Bob's isn't.
  settings.set('challengeVisibility', 'none')
  assert.deepEqual([showsChallenge({ author: carol }, orla), showsChallenge({ author: bob }, orla)], [true, false], "Carol's and Bob's cards' DCs")
  settings.delete('challengeVisibility')
  ok("module 0.46.0: Orla owned by Carol and Alice by their own ids: under Hide all, Carol's card's DC is her player's own, Bob's isn't")
}

/* -------------------------------------------- */
/*  Every scene (module 0.51.0)                 */
/* -------------------------------------------- */

// The app's ROADMAP item 18, as its owner answered it: companions found on every scene, each away
// where none of its tokens is on the active scene and one is on another, to an app that answers
// `companions: 3` alone. Wideholm, Thorin's alone, answers 3; Ashlands answers 2 from here, and
// Bigtown and the rest 1, and theirs are as before. The Bat on the den, summoned by Thorin, is the
// companion away.
const WIDE = { commands: true, companions: 3 }
const NARROW = { commands: true, companions: 2 }
const wideholm = () => getCampaigns().find(campaign => campaign.id === 'camp-w')
const bigtown = () => getCampaigns().find(campaign => campaign.id === 'camp-big')
const awayOf = list => Object.fromEntries(list.map(each => [each.key, each.away]))
const ENTRY_KEYS = ['key', 'of', 'kind', 'actorId', 'tokenId', 'sceneId', 'uuid', 'name', 'img', 'summon']
const { noteCompanionReader } = await import(`${MODULE}/scripts/creature-sync.mjs`)
const { awayReader } = await import(`${MODULE}/scripts/creatures.mjs`)
const denBat = den.tokens.get('bat2')
const AT_ARENA = { brakka: false, 'arena-hound1': false, 'arena-wolf1': false, 'arena-wolf2': false, 'arena-bat1': false, 'den-bat2': true, 'arena-spirit1': false }
settings.set('campaignSecrets', { ...settings.get('campaignSecrets'), 'camp-w': 'w-secret' })
app.answers['camp-w'] = WIDE
app.answers['camp-a'] = NARROW
from = app.events.length
await game.settings.set('sending-stone', 'campaigns', [...settings.get('campaigns'), { id: 'camp-w', title: 'Wideholm', characters: ['thorin'], rolls: true, attacks: true }])
await until(() => sheetsSent(from, 'camp-w').some(e => e.data.companion.key === 'den-bat2'), "Wideholm's hello answered, and the den's Bat's sheet")
await settle(); await settle()

// 1. The list, to an app that answers 3: every scene's, each entry ending with away.
{
  const list = companionList(wideholm())
  assert.deepEqual(awayOf(list), AT_ARENA, "the den's Bat away; the arena's, and Brakka, placed nowhere, not")
  assert.deepEqual(keysOf(list), keysOf(EXPECTED).toSpliced(5, 0, 'den-bat2'), "in today's order: owned, then summoned, each by name, then key")
  assert.ok(list.every(each => isDeepStrictEqual(Object.keys(each), [...ENTRY_KEYS, 'away'])), 'away last in each')
  assert.deepEqual(helloOf('camp-w').data.companionsEverywhere, list, "the hello's companionsEverywhere")
  assert.deepEqual(listed(from, 'camp-w'), [], 'kept as the hello listed it: no companions.listed')
  ok("to an app that answers companions: 3, a campaign's companions are found on every scene: the Bat on the den listed with away true, the arena's and Brakka, linked and placed nowhere, with away false; owned, then summoned, each by name, as ever; away the last key of each; the hello's companionsEverywhere")
}

// 2. Formats 1 and 2: as before, byte for byte, with no away.
{
  assert.deepEqual(companionList(ashlands()), EXPECTED, 'Ashlands, at 2')
  assert.deepEqual(helloOf().data.companions, EXPECTED, "Ashlands' last hello's companions")
  assert.deepEqual(helloOf('camp-w').data.companions, EXPECTED, "Wideholm's own hello's companions, the active scene's")
  assert.ok([bigtown(), ashlands()].every(campaign => companionList(campaign).every(each => !('away' in each))), 'no away at 1 or 2')
  const keys = Object.keys(helloOf().data)
  assert.equal(keys.indexOf('companionsEverywhere'), keys.indexOf('companions') + 1, 'companionsEverywhere right after companions, to every app')
  ok("an app that answers companions: 1 or 2 is listed the active scene's companions as before, byte for byte, with no away, in its hello's companions too, which every hello carries beside companionsEverywhere")
}

// 6. The hello built before any answer, as at every Gamemaster's page load (the critic's C1): its
// companions the active scene's, its companionsEverywhere every scene's, and its combats described by
// the active scene's, as for any app. An app that answers 3 keeps companionsEverywhere, so no
// companions.listed follows, the den's Bat's sheet goes, and a fight on the den with only the Bat in
// it follows; one that answers 2 keeps companions, and nothing more follows, of the Bat or its fight.
{
  const denfight = combatOf('denhello', [{ id: 'cb-dh-bat2', token: denBat }])
  const fightIn = data => data.combats.find(each => each.id === 'denhello')?.combatants.map(each => each.companion)
  const fightSent = at => since(at).filter(e => e.type.startsWith('combat.') && (e.campaign.id === 'camp-w') && (e.data.combat?.id === 'denhello'))
  const hello = async answer => {
    app.answers['camp-w'] = answer
    noteCompanionReader('camp-w', null)
    const at = app.events.length
    announce({ campaignId: 'camp-w' })
    await until(() => since(at).some(e => (e.type === 'bridge.hello') && (e.campaign.id === 'camp-w')), "Wideholm's hello")
    await until(() => sheetsSent(at, 'camp-w').some(e => e.data.companion.key === 'brakka'), "Brakka's sheet after it")
    await settle(); await settle()
    return at
  }
  // The hello built again, the app's last answer kept, as when a setting changes or the app asks
  // for it (`resend: hello`).
  const helloAgain = async () => {
    const at = app.events.length
    announce({ campaignId: 'camp-w' })
    await until(() => since(at).some(e => (e.type === 'bridge.hello') && (e.campaign.id === 'camp-w')), "Wideholm's hello again")
    await until(() => sheetsSent(at, 'camp-w').some(e => e.data.companion.key === 'brakka'), "Brakka's sheet after it")
    await settle(); await settle()
    return at
  }
  let at = await hello(WIDE)
  const built = helloOf('camp-w').data
  assert.deepEqual(built.companions, companionList(wideholm(), { everywhere: false }), 'companions: as an app that reads 2 is listed them')
  assert.ok(!keysOf(built.companions).includes('den-bat2') && built.companions.every(each => !('away' in each)), 'without the den\'s Bat, and no away')
  assert.deepEqual(awayOf(built.companionsEverywhere), AT_ARENA, 'companionsEverywhere: every scene\'s')
  assert.equal(fightIn(built), undefined, 'its combats without the fight on the den')
  assert.deepEqual(listed(at, 'camp-w'), [], 'answered 3: no companions.listed follows')
  assert.ok(sheetsSent(at, 'camp-w').some(e => e.data.companion.key === 'den-bat2'), "and the den's Bat's sheet goes")
  assert.deepEqual(fightSent(at).map(e => [e.type, e.data.combat.combatants.map(each => each.companion)]), [['combat.created', ['den-bat2']]], 'and the fight on the den, the Bat named')
  // Built again while the app's last answer is 3: its companions still the active scene's, byte for
  // byte, for any app; its companionsEverywhere every scene's; and those noted as told, which its
  // combats are described by, every scene's, so the fight on the den is in it, and isn't sent again.
  at = await helloAgain()
  const again = helloOf('camp-w').data
  assert.deepEqual(again.companions, built.companions, "companions: the active scene's, as an app that reads 2 is listed them, at 3 too")
  assert.deepEqual(again.companionsEverywhere, built.companionsEverywhere, "companionsEverywhere: every scene's")
  assert.deepEqual(fightIn(again), ['den-bat2'], 'its combats with the fight on the den, the Bat named')
  assert.deepEqual([listed(at, 'camp-w'), fightSent(at)], [[], []], 'nothing follows, of the list or the fight')
  at = await hello(NARROW)
  assert.equal(fightIn(helloOf('camp-w').data), undefined, 'answered 2: its combats without the fight on the den')
  assert.deepEqual(listed(at, 'camp-w'), [], 'none follows either')
  assert.ok(!sheetsSent(at, 'camp-w').some(e => e.data.companion.key === 'den-bat2'), "nor the den's Bat's sheet")
  assert.deepEqual(fightSent(at), [], 'nor anything of the fight')
  // Built again while its last answer is 2: those noted as told the active scene's, so its combats
  // are still without the fight on the den.
  at = await helloAgain()
  assert.equal(fightIn(helloOf('camp-w').data), undefined, 'built again at 2: its combats without the fight on the den')
  assert.deepEqual([listed(at, 'camp-w'), fightSent(at)], [[], []], 'and nothing follows, of the list or the fight')
  game.combats.delete(denfight.id)
  await Hooks.callAll('deleteCombat', denfight, {}, 'gm')
  await settle()
  assert.deepEqual(fightSent(at), [], 'nor its end')
  ok("a hello built before its app's answer, as at a Gamemaster's page load: its companions the active scene's, its companionsEverywhere every scene's, its combats without a fight with only the den's Bat in it; answered 3, no companions.listed follows, and the Bat's sheet and the fight follow; built again while the app's answer is 3, its companions still the active scene's and its combats with the fight, and nothing follows; answered 2, nothing more follows, of the Bat or its fight, nor when it's built again")
}

// 7. A heartbeat's answer that moves to 3, then back to 2, as an app deployed and rolled back: the
// list as it now reads it, at once.
{
  for (const [answer, wide] of [[WIDE, true], [NARROW, false]]) {
    app.answers['camp-w'] = answer
    const at = app.events.length
    clock += 31_000
    heartbeat()
    await until(() => listed(at, 'camp-w').length, `the list at ${answer.companions}`, 1000)
    await settle()
    const [list, ...more] = listed(at, 'camp-w')
    assert.equal(more.length, 0, 'once')
    assert.deepEqual(keysOf(list.data.companions).includes('den-bat2'), wide, `the den's Bat at ${answer.companions}`)
    assert.ok(list.data.companions.every(each => ('away' in each) === wide), `away at ${answer.companions}`)
    if (wide) assert.ok(sheetsSent(at, 'camp-w').some(e => e.data.companion.key === 'den-bat2'), "the den's Bat's sheet after it")
  }
  app.answers['camp-w'] = WIDE
  clock += 31_000
  heartbeat()
  await until(() => awayReader('camp-w'), 'Wideholm at 3 again')
  await settle(); await settle()
  ok("a heartbeat's answer moving to 3 sends the list of every scene at once, the den's Bat with its sheet after it; moving back to 2, the active scene's, at once, without it")
}

// 3. The den made the active scene: the arena's companions stay, away now, the den's Bat not, in
// one companions.listed; Ashlands, at 2, is listed the den's as before.
{
  from = app.events.length
  await activate(den)
  await until(() => listed(from, 'camp-w').length && listed(from).length, 'the lists on the den')
  await settle(); await settle()
  assert.equal(listed(from, 'camp-w').length, 1, 'one companions.listed')
  assert.deepEqual(awayOf(listed(from, 'camp-w')[0].data.companions), Object.fromEntries(Object.keys(AT_ARENA).map(key => [key, key.startsWith('arena-')])))
  assert.deepEqual(keysOf(lastList()), ['brakka', 'den-bat2'], 'Ashlands, at 2, as before')
  from = app.events.length
  await activate(arena)
  await until(() => listed(from, 'camp-w').length, 'the list back')
  await settle(); await settle()
  assert.deepEqual(awayOf(listed(from, 'camp-w').at(-1).data.companions), AT_ARENA)
  ok("the den made the active scene: Wideholm's companions on the arena stay, away now, and the den's Bat isn't, in one companions.listed; Ashlands, at 2, is listed the den's alone, as before; and back")
}

// 3, with no scene active (PROTOCOL's rule 8): no companion is away, neither a token's creature nor a
// linked NPC Alice owns whose one token is on the den; Brakka, placed nowhere, as it was; Ashlands, at
// 2, keeps only the linked ones, as before; and the arena active again, as they were.
{
  const newt = companionActor('newt', 'Newt', { owners: ['alice'], linked: true, spec: creature() })
  await createToken(den, newt, { id: 'newt1', actorLink: true, name: 'Newt' })
  await settle(); await settle()
  const before = companionList(wideholm())
  const AT_ARENA_NEWT = { ...AT_ARENA, newt: true }
  assert.deepEqual(awayOf(before), AT_ARENA_NEWT, 'the Newt, its one token on the den, away')
  from = app.events.length
  await arena.update({ active: false })
  await until(() => listed(from, 'camp-w').length && listed(from).length, 'the lists with no scene active')
  await settle(); await settle()
  const [list, ...more] = listed(from, 'camp-w')
  assert.equal(more.length, 0, 'one companions.listed')
  assert.deepEqual(awayOf(list.data.companions), Object.fromEntries(Object.keys(AT_ARENA_NEWT).map(key => [key, false])), 'none away')
  assert.deepEqual(list.data.companions.find(each => each.key === 'brakka'), before.find(each => each.key === 'brakka'), 'Brakka as it was')
  assert.deepEqual(keysOf(lastList()), ['brakka', 'newt'], 'Ashlands, at 2: the linked ones alone')
  assert.ok(lastList().every(each => !('away' in each)), 'and no away')
  from = app.events.length
  await activate(arena)
  await until(() => listed(from, 'camp-w').length, 'the list back')
  await settle(); await settle()
  assert.deepEqual(awayOf(listed(from, 'camp-w').at(-1).data.companions), AT_ARENA_NEWT)
  await den.tokens.get('newt1').delete()
  actors.delete('newt')
  await Hooks.callAll('deleteActor', newt, {}, 'gm')
  await settle(); await settle()
  ok("with no scene active, none of Wideholm's companions is away, the arena's tokens' creatures nor a linked one Alice owns whose one token is on the den, and Brakka, placed nowhere, is as it was; Ashlands, at 2, keeps only the linked ones; the arena active again, they're as they were")
}

// 4. Linked companions, by where their tokens are: an owned one away while its one token is on the
// den, here once a hidden token of it is on the arena; a linked summon on the den, listed summoned
// and away, gone once its token is, though dnd5e keeps its sheet.
{
  const moth = companionActor('moth', 'Moth', { owners: ['alice'], linked: true, spec: creature() })
  await createToken(den, moth, { id: 'moth1', actorLink: true, name: 'Moth' })
  await settle()
  assert.equal(awayOf(companionList(wideholm())).moth, true, 'its one token on the den: away')
  await createToken(arena, moth, { id: 'moth2', actorLink: true, name: 'Moth', hidden: true })
  await settle()
  assert.equal(awayOf(companionList(wideholm())).moth, false, 'a hidden token of it on the arena: here')
  const owl = companionActor('owl', 'Owl', { linked: true, flags: { dnd5e: { summon: { origin: 'Actor.thorin.Item.findFamiliar', activity: 'ff-summon' }, isAutoImported: true } } })
  const owlToken = await createToken(den, owl, { id: 'owl1', actorLink: true, name: 'Owl' })
  await settle()
  const entryOfOwl = companionList(wideholm()).find(each => each.key === 'owl')
  assert.deepEqual([entryOfOwl?.kind, entryOfOwl?.tokenId, entryOfOwl?.away], ['summoned', null, true], 'the linked summon on the den')
  assert.ok(!keysOf(companionList(ashlands())).includes('owl'), 'not Ashlands\', at 2')
  from = app.events.length
  await owlToken.delete()
  await until(() => listed(from, 'camp-w').length, 'the list without the Owl')
  assert.ok(!keysOf(listed(from, 'camp-w').at(-1).data.companions).includes('owl') && game.actors.get('owl'), 'gone, its world actor kept')
  for (const id of ['moth1', 'moth2']) await (den.tokens.get(id) ?? arena.tokens.get(id)).delete()
  for (const id of ['moth', 'owl']) {
    const actor = actors.get(id)
    actors.delete(id)
    await Hooks.callAll('deleteActor', actor, {}, 'gm')
  }
  await settle(); await settle()
  ok("a linked NPC Alice owns whose one token is on the den is away, and not once a hidden token of it is on the arena; a linked summon of Thorin's on the den is listed summoned and away, not to Ashlands, at 2; its token deleted, it leaves, though its world actor stays")
}

// 5. Commands: the den's Bat rolled for from Wideholm, on its own creature; from Ashlands, at 2, the
// same key is no one's companion, and nothing is rolled.
{
  const made = await send(skill({ actorId: 'den-bat2', of: 'thorin' }), 'camp-w')
  assert.equal(made.status, 'done', JSON.stringify(made))
  assert.equal(messageOf(made.id).speakerActor, denBat.actor, "the den's Bat's own creature")
  const count = messages.size
  const refused = await send(skill({ actorId: 'den-bat2', of: 'thorin' }))
  assert.deepEqual([refused.status, refused.reason, messages.size], ['failed', 'unknown', count], 'from Ashlands, at 2')
  ok("a skill for the den's Bat, of: thorin, from Wideholm is rolled on its own creature, away though it is; from Ashlands, at 2, refused unknown, nothing rolled")
}

// 8. A character's twenty: those not away kept first, in today's order. Thorin with 22 Rats on the den
// and 3 Vipers on the arena, beside his own.
{
  const rat = companionActor('rat', 'Rat', { owners: ['alice'], linked: false, spec: creature() })
  const viper = companionActor('viper', 'Viper', { owners: ['alice'], linked: false, spec: creature() })
  const rats = Array.from({ length: 22 }, (_, i) => placeToken(den, rat, { id: `rat${String(i + 1).padStart(2, '0')}`, name: 'Rat' }))
  const vipers = [1, 2, 3].map(n => placeToken(arena, viper, { id: `viper${n}`, name: 'Viper' }))
  const list = companionList(wideholm())
  const ratKeys = rats.slice(0, 11).map(token => `den-${token.id}`)
  assert.deepEqual(keysOf(list), ['brakka', 'arena-hound1', ...ratKeys, 'arena-viper1', 'arena-viper2', 'arena-viper3', 'arena-wolf1', 'arena-wolf2', 'arena-bat1', 'arena-spirit1'],
    'every one not away kept, then the first eleven away, in their order')
  assert.equal(companionList(ashlands()).filter(each => each.of.includes('thorin')).length, 9, 'Ashlands, at 2: the arena\'s, the Vipers among them')
  for (const token of [...rats, ...vipers]) token.parent.tokens.delete(token.id)
  for (const id of ['rat', 'viper']) actors.delete(id)
  ok("a character with 22 owned tokens on the den and 3 on the arena beside his own keeps every one not away among his twenty, then the first of those away, all in today's order")
}

// 9. The campaign's fifty: those not away kept first. Bigtown's Big 1's twenty on the den, Big 3's on
// the arena; Big 2's placed nowhere.
{
  const placed = []
  for (const [n, on] of [[1, den], [3, arena]]) {
    for (const actor of game.actors.filter(each => (each.type === 'npc') && (each.ownership?.[`b${n}`] === 3))) {
      placed.push(placeToken(on, actor, { id: `t${actor.id}`, actorLink: true, name: actor.name }))
    }
  }
  const wide = companionList(bigtown(), { everywhere: true })
  const of = n => wide.filter(each => each.of[0] === `big${n}`)
  assert.deepEqual([wide.length, of(1).length, of(2).length, of(3).length], [50, 10, 20, 20], 'Big 3\'s twenty within the fifty')
  assert.ok(of(1).every(each => each.away) && [...of(2), ...of(3)].every(each => !each.away))
  assert.deepEqual(wide.map(each => each.of[0]), [...Array(10).fill('big1'), ...Array(20).fill('big2'), ...Array(20).fill('big3')], 'in its characters\' order')
  assert.deepEqual([1, 2, 3].map(n => companionList(bigtown()).filter(each => each.of[0] === `big${n}`).length), [20, 20, 10], 'at 1, as before')
  for (const token of placed) token.parent.tokens.delete(token.id)
  ok("a campaign's fifty keep those not away first: Big 1's twenty on the den leave room for Big 3's on the arena, each character's in its order; at 1, as before")
}

// 10. A scene made with its tokens, as the den duplicated: its copy of the Bat listed within the
// settle, though no createToken told of it.
{
  await settle(); await settle()
  from = app.events.length
  const copy = await createScene('den2', [{ base: bat, id: 'bat2', name: 'Bat', delta: { flags: SUMMONED } }])
  await until(() => listed(from, 'camp-w').length, "the list with the copy's Bat", 1000)
  assert.equal(awayOf(listed(from, 'camp-w').at(-1).data.companions)['den2-bat2'], true, 'listed, away')
  from = app.events.length
  await copy.delete()
  await until(() => listed(from, 'camp-w').length, 'the list without it')
  assert.ok(!keysOf(listed(from, 'camp-w').at(-1).data.companions).includes('den2-bat2'))
  ok("a scene made with its tokens, as one duplicated, tells of its own tokens by createScene alone: the copy's Bat listed, away, within the settle; the copy deleted, it's gone")
}

// 11-12. What it costs: every token of every scene looked at, each call (rule 4 of the batch's
// brief). Tokens that can't be companions, none owned or summoned, have no creature made up; tokens
// that can, a Wolf Alice owns on every map, are made up once and kept.
{
  const timeOf = fn => { const started = performance.now(); fn(); return performance.now() - started }
  const mob = companionActor('mob', 'Orc', { linked: false, spec: creature() })
  const before = companionList(wideholm())
  const mobs = Array.from({ length: 200 }, (_, n) => {
    const each = scene(`mob${n}`)
    for (let t = 0; t < 50; t++) placeToken(each, mob, { id: `m${n}x${t}`, name: 'Orc' })
    return each
  })
  const tokensOf = list => list.flatMap(each => each.tokens.contents)
  const wideMs = timeOf(() => assert.deepEqual(companionList(wideholm()), before, 'the list unchanged'))
  const narrowMs = timeOf(() => companionList(ashlands()))
  assert.ok(tokensOf(mobs).length === 10_000 && tokensOf(mobs).every(token => !token._synthetic), 'no creature made up for any of the 10,000')
  for (const each of mobs) scenes.delete(each.id)
  ok(`200 scenes of 50 tokens no player owns and nothing summoned: Wideholm's companions found in ${wideMs.toFixed(1)} ms, none of the 10,000 made up, the list unchanged (Ashlands', the active scene's, ${narrowMs.toFixed(1)} ms)`)

  const wolves = Array.from({ length: 200 }, (_, n) => {
    const each = scene(`wolves${n}`)
    placeToken(each, wolf, { id: `w${n}`, name: 'Wolf' })
    return each
  })
  const firstMs = timeOf(() => companionsOf(wideholm()))
  const made = tokensOf(wolves).map(token => token._synthetic)
  const secondMs = timeOf(() => assert.equal(companionList(wideholm()).length, 20, 'Thorin\'s twenty'))
  assert.ok(made.every(Boolean) && tokensOf(wolves).every((token, i) => token._synthetic === made[i]), 'each made up once, and kept')
  for (const each of wolves) scenes.delete(each.id)
  actors.delete('mob')
  ok(`200 scenes, a Wolf Alice owns on each: the first call makes up 200 creatures, in ${firstMs.toFixed(1)} ms; the next makes none, in ${secondMs.toFixed(1)} ms; Thorin's list twenty`)
}

// 13. A fight on the den with only the Bat away in it reaches Wideholm, its companion told; never
// Ashlands, at 2.
{
  from = app.events.length
  const denfight = combatOf('denfight', [{ id: 'cb-df-bat2', token: denBat }])
  await Hooks.callAll('createCombat', denfight, {}, 'gm')
  await settle()
  const created = ofType(since(from), 'combat.created', 'camp-w').find(e => e.data.combat.id === 'denfight')
  assert.deepEqual(created?.data.combat.combatants.map(each => each.companion), ['den-bat2'], 'Wideholm told, its companion named')
  assert.ok(!ofType(since(from), 'combat.created').some(e => e.data.combat.id === 'denfight'), 'Ashlands not')
  game.combats.delete('denfight')
  await Hooks.callAll('deleteCombat', denfight, {}, 'gm')
  await settle()
  ok("a fight on the den with only the Bat in it reaches Wideholm, its combatant's companion den-bat2; Ashlands, at 2, isn't told of it")
}

// 14. Under Midi-QOL, a companion away attacks and uses as ever: what the Gamemaster's canvas
// doesn't draw, as the den's tokens while they view the arena, is refused "scene", unless they allow
// targets off their screen, and then only where Midi doesn't need a target. A Wolf of Alice's and a
// goblin, both on the den.
if (MIDI) {
  const denWolf = await createToken(den, wolf, { id: 'wolf9', name: 'Wolf' })
  const denGoblin = placeToken(den, goblin, { id: 'gob9', name: 'Goblin', actorLink: true })
  // The Gamemaster's canvas draws the arena: no placeable for a token on the den.
  denWolf.object = null
  denGoblin.object = null
  await settle()
  const brawl = combatOf('denbrawl', [{ id: 'cb-db-wolf', token: denWolf }, { id: 'cb-db-gob', token: denGoblin }])
  const bite = () => send(attack({ actorId: 'den-wolf9', of: 'thorin', item: 'jaws', activity: 'bite', target: { combatId: 'denbrawl', combatantId: 'cb-db-gob' } }), 'camp-w')
  const howlAt = () => send(use({ actorId: 'den-wolf9', of: 'thorin', item: 'howl', activity: 'howl-use', self: true }), 'camp-w')
  const flowOf = () => [...(midi.made.at(-1)?.targets ?? [])]
  const required = midi.settings.requiresTargets
  try {
    const unseen = await bite()
    assert.deepEqual([unseen.status, unseen.reason], ['failed', 'scene'], 'at a goblin the canvas doesn\'t draw')
    midi.settings.requiresTargets = 'none'
    await game.settings.set('sending-stone', 'offCanvasTargets', true)
    const allowed = await bite()
    assert.equal(allowed.status, 'done', JSON.stringify(allowed))
    assert.deepEqual([madeBy(allowed).flags.dnd5e.targets.map(t => t.name), flowOf()], [['Goblin'], []], 'its card names the goblin, Midi works on no one')
    const own = await howlAt()
    assert.equal(own.status, 'done', JSON.stringify(own))
    assert.deepEqual([useCard(own.id).flags.dnd5e.targets.map(t => t.name), flowOf()], [['Wolf'], []], 'at itself: its card names it, Midi works on no one')
    midi.settings.requiresTargets = 'always'
    for (const made of [await bite(), await howlAt()]) assert.deepEqual([made.status, made.reason], ['failed', 'scene'], 'where Midi needs a target it can draw')
  } finally {
    midi.settings.requiresTargets = required
    await game.settings.set('sending-stone', 'offCanvasTargets', false)
  }

  // 14b. Since module 0.53.0, Midi-QOL's Bonus Actions and reactions in an encounter the Gamemaster
  // doesn't have up: the den's brawl, begun and its scene's chosen one, while they view the arena's
  // fight, which the Wolf isn't in. Its Howl (a Bonus Action) and its Bite at the goblin (out of its
  // turn, an opportunity attack where Midi records them) are checked there as in the encounter up,
  // marked by the module, and the mark taken off at the Wolf's next turn there, never before.
  {
    const wolfId = denWolf.actor.id
    const cbWolf = brawl.combatants.get('cb-db-wolf')
    const cbGob = brawl.combatants.get('cb-db-gob')
    const was = {
      settings: { ...midi.settings }, initiatives: [cbWolf.initiative, cbGob.initiative], round: brawl.round, turn: brawl.turn, active: brawl.active,
    }
    const failedAs = (made, reason, what) => assert.deepEqual([made.status, made.reason], ['failed', reason], `${what}: ${JSON.stringify(made)}`)
    const doneAs = (made, what) => assert.equal(made.status, 'done', `${what}: ${JSON.stringify(made)}`)
    game.combat = fight
    cbGob.initiative = 20
    cbWolf.initiative = 10
    brawl.round = 1
    brawl.turn = 0
    Object.assign(midi.settings, { requiresTargets: 'none', enforceBonusActions: 'all', enforceReactions: 'all', recordAOO: 'all' })
    await game.settings.set('sending-stone', 'offCanvasTargets', true)
    try {
      assert.equal(denWolf.actor.inCombat, false, "the Wolf not in the fight the Gamemaster has up, by core's reading")
      // 1. Its Bonus Action used: Howl refused, no workflow made.
      midi.usedBonus.add(wolfId)
      let made = midi.made.length
      failedAs(await howlAt(), 'bonus-action', 'its Bonus Action used')
      assert.equal(midi.made.length, made, 'no workflow')
      // 2. Unused: a Howl that never has its card, as one a module's dnd5e.preUseActivity stops, fails
      // "midi" and marks nothing; one made is marked by the module, as Midi would mark it in the
      // encounter up.
      midi.usedBonus.delete(wolfId)
      let marks = midi.bonusMarks.length
      Hooks.once('dnd5e.preUseActivity', () => false)
      failedAs(await howlAt(), 'midi', 'stopped before its card')
      assert.deepEqual([midi.bonusMarks.slice(marks), midi.usedBonus.has(wolfId)], [[], false], 'no card: nothing marked')
      doneAs(await howlAt(), 'its Bonus Action unused')
      assert.deepEqual(midi.bonusMarks.slice(marks), [wolfId], 'marked once')
      // 3. A new round, the goblin's turn: the mark stays, and Howl again is refused.
      const removals = midi.bonusRemovals.length
      await brawl.setTurn(2, 0)
      assert.deepEqual(midi.bonusRemovals.slice(removals), [], "the goblin's turn takes nothing off")
      failedAs(await howlAt(), 'bonus-action', 'marked: Howl again')
      // 4. Two Howls sent together: the first made and marked, the second refused, one after the other.
      midi.usedBonus.delete(wolfId)
      const both = await sendAll([
        use({ actorId: 'den-wolf9', of: 'thorin', item: 'howl', activity: 'howl-use', self: true }),
        use({ actorId: 'den-wolf9', of: 'thorin', item: 'howl', activity: 'howl-use', self: true }),
      ], 'camp-w')
      assert.deepEqual(both.map(each => [each.status, each.reason]), [['done', null], ['failed', 'bonus-action']], JSON.stringify(both))
      // 5. The Wolf's turn begins: the mark taken off, forced, and Howl made again.
      await brawl.setTurn(2, 1)
      assert.deepEqual([midi.bonusRemovals.slice(removals), midi.usedBonus.has(wolfId)], [[wolfId], false], 'taken off at its turn')
      doneAs(await howlAt(), 'its turn: Howl again')
      // 5b. The turn taken back onto the Wolf is its turn again, never its next: the Howl's mark stays.
      // Its turn ended from the app, the goblin's next round, and taken back with Undo, under a core
      // that tells of a turn written with its turn events off; then on to the goblin's again and back
      // with Previous Turn, a round back. Its next turn there takes it off (8b).
      const back = midi.bonusRemovals.length
      const ended = await send({ id: `turn-${++ids}`, actorId: 'thorin', kind: 'endTurn', turn: { combatId: 'denbrawl', round: 2, combatantId: 'cb-db-wolf' }, ...plain, dice: [] }, 'camp-w')
      doneAs(ended, 'its turn ended from the app')
      assert.deepEqual([brawl.round, brawl.combatant.id], [3, 'cb-db-gob'], "the goblin's turn, the next round")
      faults.turnEventsNotify = true
      try {
        doneAs(await send({ id: `undo-${++ids}`, actorId: 'thorin', kind: 'undoEndTurn', undo: ended.id, turn: { combatId: 'denbrawl', round: 3, combatantId: 'cb-db-gob' }, ...plain, dice: [] }, 'camp-w'), 'taken back')
      } finally {
        faults.turnEventsNotify = false
      }
      assert.deepEqual([brawl.round, brawl.combatant.id, midi.bonusRemovals.slice(back), midi.usedBonus.has(wolfId)], [2, 'cb-db-wolf', [], true], 'taken back with Undo: its mark stays')
      await brawl.setTurn(3, 0)
      await brawl.previousTurn()
      assert.deepEqual([brawl.round, brawl.combatant.id, midi.bonusRemovals.slice(back), midi.usedBonus.has(wolfId)], [2, 'cb-db-wolf', [], true], 'Previous Turn, a round back: its mark stays')
      failedAs(await howlAt(), 'bonus-action', 'its turn taken back: Howl again')
      // 6. Still its turn, its reaction used: its Bite is no opportunity attack, made, nothing marked.
      midi.usedReaction.add(wolfId)
      marks = midi.reactionMarks.length
      doneAs(await bite(), 'its own turn: the Bite')
      assert.deepEqual(midi.reactionMarks.slice(marks), [], 'no reaction marked')
      // 7. Not its turn, its reaction used: the Bite, an opportunity attack, refused. A begun encounter
      // on a copy of the den, listed before the brawl, whose combatant has the Wolf's token's id and
      // whose turn it is, isn't the Wolf's: a token's creature is matched by its token and its scene.
      brawl.turn = 0
      const copy = combatOf('dencopy', [{ id: 'cb-copy-wolf', actor: wolf, fields: { tokenId: denWolf.id, sceneId: 'den-copy' } }])
      Object.assign(copy, { round: 1, turn: 0 })
      game.combats.delete(brawl.id)
      game.combats.set(brawl.id, brawl)
      try {
        failedAs(await bite(), 'reaction', "the goblin's turn, its reaction used: the Bite")
      } finally {
        game.combats.delete(copy.id)
      }
      // 8. Not its turn, its reaction unused: an attack Midi aborts once it has its card (no ammunition)
      // has its reaction marked all the same, as Midi marks one once its use has its card.
      midi.usedReaction.delete(wolfId)
      midi.abortNext = true
      failedAs(await bite(), 'midi', "the goblin's turn, its reaction unused: the Bite aborted")
      assert.deepEqual(midi.reactionMarks.slice(marks), [wolfId], 'its reaction marked, the attack aborted')
      // Made, and its reaction marked.
      midi.usedReaction.delete(wolfId)
      marks = midi.reactionMarks.length
      doneAs(await bite(), "the goblin's turn, its reaction unused: the Bite")
      assert.deepEqual(midi.reactionMarks.slice(marks), [wolfId], 'its reaction marked once')
      // 8b. Its Bonus Action (step 5's Howl, on its own turn) and its reaction (the Bite) both marked in
      // the brawl: at its next turn there both are taken off, each once.
      const offs = [midi.bonusRemovals.length, midi.reactionRemovals.length]
      assert.deepEqual([midi.usedBonus.has(wolfId), midi.usedReaction.has(wolfId)], [true, true], 'both marked')
      await brawl.setTurn(3, 1)
      assert.deepEqual([midi.bonusRemovals.slice(offs[0]), midi.reactionRemovals.slice(offs[1]), midi.usedBonus.has(wolfId), midi.usedReaction.has(wolfId)],
        [[wolfId], [wolfId], false, false], 'both taken off at its next turn there, each once')
      // 8c. Its Howl marked again on that turn, then its token gone from the den: at its next turn
      // nothing is taken off a creature no longer there, and nothing is logged.
      doneAs(await howlAt(), 'its turn: Howl')
      den.tokens.delete(denWolf.id)
      const gone = [midi.bonusRemovals.length, midi.reactionRemovals.length]
      const errors = []
      const logged = console.error
      console.error = (...args) => errors.push(args.map(String).join(' '))
      try {
        await brawl.setTurn(4, 1)
      } finally {
        console.error = logged
        den.tokens.set(denWolf.id, denWolf)
      }
      assert.deepEqual([midi.bonusRemovals.length, midi.reactionRemovals.length, errors], [...gone, []], 'its token gone: nothing taken off, nothing logged')
      midi.usedBonus.delete(wolfId)
      midi.usedReaction.delete(wolfId)
      // 9. The brawl not begun, or not its scene's chosen one: it counts for nothing.
      midi.usedBonus.add(wolfId)
      marks = midi.bonusMarks.length
      brawl.round = 0
      doneAs(await howlAt(), 'not begun')
      brawl.round = 1
      brawl.active = false
      doneAs(await howlAt(), 'not its scene\'s chosen one')
      assert.deepEqual(midi.bonusMarks.slice(marks), [], 'neither marked')
      // 10. The Gamemaster views the brawl: Midi finds the Wolf in it, so the module marks nothing.
      brawl.active = true
      game.combat = brawl
      assert.equal(denWolf.actor.inCombat, true, 'in the fight the Gamemaster has up')
      midi.usedBonus.delete(wolfId)
      doneAs(await howlAt(), 'the encounter up')
      assert.deepEqual(midi.bonusMarks.slice(marks), [], "Midi's own to mark there")
    } finally {
      game.combat = fight
      Object.assign(midi.settings, was.settings)
      await game.settings.set('sending-stone', 'offCanvasTargets', false)
      ;[cbWolf.initiative, cbGob.initiative] = was.initiatives
      Object.assign(brawl, { round: was.round, turn: was.turn, active: was.active })
      midi.usedBonus.delete(wolfId)
      midi.usedReaction.delete(wolfId)
    }
    ok("since module 0.53.0, under Midi-QOL, a Wolf fighting in the den's brawl, begun and chosen, while the Gamemaster has the arena's fight up: its Howl refused bonus-action with its Bonus Action used; unused, one stopped before its card failing midi and marking nothing, one made marked by the module; a new round's first turn, another's, leaves the mark and refuses Howl; two Howls at once, one made, one refused; at its own turn the mark taken off, forced; its turn ended from the app and taken back with Undo under a core that tells of it, or a round back with Previous Turn, leaves its mark on; its Bite on its own turn no opportunity attack, on the goblin's refused reaction with its reaction used, never read from a copy of the den whose combatant has its token's id; unused, an attack Midi aborts still marked, one made marked; its Bonus Action and reaction marked in the brawl both taken off at its next turn, each once; its token gone, nothing taken off or logged; the brawl not begun, or not chosen, counts for nothing; the brawl up, Midi's own to mark")
  }
  game.combats.delete(brawl.id)
  den.tokens.delete(denGoblin.id)
  await denWolf.delete()
  await settle()
  ok("under Midi-QOL, a Wolf away on the den: its bite at a goblin there, which the Gamemaster's canvas doesn't draw, refused scene; with targets off the screen allowed, and Midi needing none, made, its card naming the goblin and Midi working on no one, and its howl at itself the same; where Midi needs a target, both refused scene")
}

/* -------------------------------------------- */
/*  Constant companions (module 0.54.0)         */
/* -------------------------------------------- */

// The app's ROADMAP item 98: the NPCs the Gamemaster marks as a character's constant companions on
// Manage Campaigns, listed to an app that answers `companions: 4` whether or not a token of them is on
// a scene, keyed by the NPC marked. Keepwatch, Thorin's and Vex's, answers 4. Its Steel Defender, a
// world NPC no player owns, unlinked, and dnd5e's copies of it for a summon, flagged as dnd5e flags
// them now and as it did; the Hawk, linked, whose copy dnd5e makes when Thorin summons it; and an Owl
// of Alice's.
const CONSTANT = { commands: true, companions: 4 }
const keepwatch = () => getCampaigns().find(campaign => campaign.id === 'camp-k')
const { constantCopies, companionFormat } = await import(`${MODULE}/scripts/creatures.mjs`)
const { concentrationCardOf, saveCard, deleteMessage, withConcentrationChecks } = await import('./dnd5e-cards.mjs')
const SD_SOURCE = 'Compendium.dnd5e.monsters.Actor.sd'
const BY_THORIN = { dnd5e: { summon: { origin: 'Actor.thorin.Item.findFamiliar', activity: 'ff-summon' } } }
const BY_VEX = { dnd5e: { summon: { origin: 'Actor.vex.Item.steelDefender', activity: 'sd-summon' } } }
const rendHit = { id: 'rend-hit', damage: [{ number: 1, denomination: 8, bonus: '@mod', types: ['force'] }] }
const repairUse = { id: 'repair', name: 'Repair', type: 'feat', system: { uses: { max: 3, spent: 0, recovery: [] }, description: { value: '<p>It mends.</p>' } },
  activities: [{ id: 'repair-use', type: 'utility', activation: { type: 'action', value: 1 }, consumption: [{ type: 'itemUses', value: '1' }] }] }
const steelGear = { items: [weapon('forceRend', 'Force-Empowered Rend', rendHit), repairUse] }
const steelSpec = { ...creature({ str: 2, dex: 1 }), hp: { value: 20, max: 20, temp: 0 } }
const steelDef = withConcentrationChecks(companionActor('steelDef', 'Steel Defender', { linked: false, stats: { compendiumSource: SD_SOURCE }, spec: steelSpec, gear: steelGear }))
const steelCopy = companionActor('steelCopy', 'Steel Defender', { linked: false, flags: { dnd5e: { isAutoImported: true } }, stats: { compendiumSource: SD_SOURCE }, spec: steelSpec, gear: steelGear })
// dnd5e's older copy of it for a summon, flagged with the older `summonedCopy` alone, as dnd5e still reads it.
const steelOld = companionActor('steelOld', 'Steel Defender', { linked: false, flags: { dnd5e: { summonedCopy: true } }, stats: { compendiumSource: SD_SOURCE }, spec: steelSpec, gear: steelGear })
companionActor('hawk', 'Hawk', { linked: true, spec: creature({ dex: 3 }) })
const STEEL = { actorId: 'steelDef', characterId: 'thorin' }
const steelOf = (list = companionList(keepwatch())) => list.find(each => each.key === 'steelDef')
const thorinsOf = list => list.filter(each => each.of.includes('thorin'))
const copyOf = entry => [entry?.actorId, entry?.tokenId, entry?.sceneId, entry?.uuid, entry?.placed, entry?.away]
const sheetsOf = (key, at) => sheetsSent(at, 'camp-k').filter(e => e.data.companion.key === key)
const KEEP = { id: 'camp-k', title: 'Keepwatch', characters: ['thorin', 'vex'], rolls: true, attacks: true, prompts: true }
/** Keepwatch saved as the window saves it, with its marks: every campaign's hello goes again (`reannounce`). */
async function saveKeep(fields = {}, sheetOf = 'brakka') {
  const at = app.events.length
  await game.settings.set('sending-stone', 'campaigns', [...settings.get('campaigns').filter(c => c.id !== 'camp-k'), { ...KEEP, ...fields }])
  await until(() => since(at).some(e => (e.type === 'bridge.hello') && (e.campaign.id === 'camp-k')), "Keepwatch's hello")
  await until(() => sheetsOf(sheetOf, at).length, `${sheetOf}'s sheet after it`)
  await settle(); await settle()
  return at
}
/** A heartbeat answered as given, and the list it sends at once. */
async function answerKeep(answer) {
  app.answers['camp-k'] = { commands: true, companions: answer }
  const at = app.events.length
  clock += 31_000
  heartbeat()
  await until(() => companionFormat('camp-k') === answer, `Keepwatch at ${answer}`)
  await until(() => listed(at, 'camp-k').length, `Keepwatch's list at ${answer}`, 1000)
  await settle(); await settle()
  return at
}
settings.set('campaignSecrets', { ...settings.get('campaignSecrets'), 'camp-k': 'k-secret' })
app.answers['camp-k'] = CONSTANT
await saveKeep()
const unmarked = helloOf('camp-k').data

// K1. Marked and saved, the hello sent again: its companionsConstant, right after
// companionsEverywhere, lists the Steel Defender, Thorin's last, with no token; its companions and
// companionsEverywhere byte for byte as before the mark.
{
  const at = await saveKeep({ constantCompanions: [STEEL] }, 'steelDef')
  const { data } = helloOf('camp-k')
  const keys = Object.keys(data)
  assert.equal(keys.indexOf('companionsConstant'), keys.indexOf('companionsEverywhere') + 1, 'right after companionsEverywhere')
  assert.deepEqual(steelOf(data.companionsConstant), {
    key: 'steelDef', of: ['thorin'], kind: 'constant', actorId: 'steelDef', tokenId: null, sceneId: null, uuid: 'Actor.steelDef',
    name: 'Steel Defender', img: 'steelDef.webp', summon: null, away: false, placed: false,
  })
  assert.equal(thorinsOf(data.companionsConstant).at(-1).key, 'steelDef', "Thorin's last")
  assert.deepEqual(data.companionsConstant.filter(each => each.key !== 'steelDef'), unmarked.companionsEverywhere, 'the rest as an app at 3 is listed them')
  assert.equal(JSON.stringify([data.companions, data.companionsEverywhere]), JSON.stringify([unmarked.companions, unmarked.companionsEverywhere]), 'the older lists byte for byte')
  assert.equal(data.features.companions.constant, true)
  assert.ok(sheetsOf('steelDef', at).length, 'its sheet follows')
  assert.deepEqual(listed(at, 'camp-k'), [], 'kept as the hello listed it')
  ok("K1. to an app that answers companions: 4, a Steel Defender marked as Thorin's constant companion is listed with no token, kind constant, keyed by the NPC marked, named and pictured by it, placed false, last of Thorin's, in the hello's companionsConstant right after companionsEverywhere, its sheet after it; the hello's companions and companionsEverywhere byte for byte as before the mark; features.companions.constant")
}

// K2 and K11. An app that answers 3, then 2, is listed as before the mark, at once as its heartbeat's
// answer moves, and a token of dnd5e's copy summoned by Thorin is his summoned companion there; a
// command naming the Steel Defender is refused unknown. Moving back to 4, the constant at once.
{
  let at = await answerKeep(3)
  assert.deepEqual(listed(at, 'camp-k').at(-1).data.companions, unmarked.companionsEverywhere, 'at 3, at once: as before the mark')
  at = app.events.length
  announce({ campaignId: 'camp-k' })
  await until(() => sheetsOf('brakka', at).length, "Keepwatch's hello at 3")
  await settle(); await settle()
  const { data } = helloOf('camp-k')
  assert.equal(JSON.stringify([data.companions, data.companionsEverywhere]), JSON.stringify([unmarked.companions, unmarked.companionsEverywhere]), "the hello's lists at 3")
  at = app.events.length
  const sdx = await createToken(arena, steelCopy, { id: 'sdx', name: 'Steel Defender', delta: { flags: BY_THORIN } })
  await until(() => listed(at, 'camp-k').length, 'the list with the summoned token', 1000)
  const moved = listed(at, 'camp-k').at(-1).data.companions
  assert.deepEqual([moved.find(each => each.key === 'arena-sdx')?.kind, steelOf(moved), moved.some(each => 'placed' in each)], ['summoned', undefined, false], "at 3 Thorin's summoned companion, no constant")
  const refused = await send(skill({ actorId: 'steelDef', of: 'thorin' }), 'camp-k')
  assert.deepEqual([refused.status, refused.reason], ['failed', 'unknown'], 'at 3, refused')
  at = await answerKeep(2)
  assert.ok(!listed(at, 'camp-k').at(-1).data.companions.some(each => (each.key === 'steelDef') || ('away' in each)), 'at 2, as before')
  const refused2 = await send(skill({ actorId: 'steelDef', of: 'thorin' }), 'camp-k')
  assert.deepEqual([refused2.status, refused2.reason], ['failed', 'unknown'], 'at 2, refused')
  await sdx.delete()
  await settle()
  await answerKeep(3)
  at = await answerKeep(4)
  assert.deepEqual(copyOf(steelOf(listed(at, 'camp-k').at(-1).data.companions)), ['steelDef', null, null, 'Actor.steelDef', false, false], 'back to 4, at once')
  assert.ok(sheetsOf('steelDef', at).length, 'its sheet after it')
  at = await answerKeep(3)
  assert.equal(steelOf(listed(at, 'camp-k').at(-1).data.companions), undefined, '4 to 3, at once without it')
  await answerKeep(4)
  ok("K2, K11. an app that answers 3, then 2, is listed as before the mark, the hello's lists and each companions.listed, a token of dnd5e's copy that Thorin summoned his summoned companion there, a command naming the Steel Defender refused unknown; a heartbeat's answer moving to 4 lists it at once with its sheet, and back to 3 at once without it")
}

// K3. Order and the cuts: Thorin's owned, then summoned, then constant, each by name; past twenty,
// every constant one kept, the owned and summoned not away kept first, cut from the end.
{
  const list = thorinsOf(companionList(keepwatch()))
  assert.deepEqual(keysOf(list), [...keysOf(thorinsOf(unmarked.companionsEverywhere)), 'steelDef'], "today's order, then the constant")
  const sentinels = Array.from({ length: 15 }, (_, i) => companionActor(`sentinel${String(i + 1).padStart(2, '0')}`, `Sentinel ${String(i + 1).padStart(2, '0')}`, { linked: true }))
  const marks = [STEEL, ...sentinels.map(each => ({ actorId: each.id, characterId: 'thorin' }))]
  const capped = thorinsOf(companionList({ ...keepwatch(), constantCompanions: marks }))
  const here = thorinsOf(unmarked.companionsEverywhere).filter(each => !each.away).slice(0, 20 - marks.length)
  assert.deepEqual(keysOf(capped), [...keysOf(here), ...sentinels.map(each => each.id), 'steelDef'], 'every constant kept, then the first not away')
  for (const each of sentinels) actors.delete(each.id)
  // The campaign's fifty: Bigtown's three characters' twenty each, none away, and a constant one last
  // of Big 2's and of Big 3's, both kept, in the list's order, where the first fifty would keep
  // neither of Big 3's.
  const keeper = companionActor('keeper', 'Keeper', { linked: true })
  const plain = companionList(bigtown(), { everywhere: true })
  const ofBig = n => keysOf(plain.filter(each => each.of[0] === `big${n}`))
  assert.deepEqual([1, 2, 3].map(n => ofBig(n).length), [20, 20, 10], 'unmarked: the first fifty')
  const bigMarks = [{ actorId: 'keeper', characterId: 'big3' }, { actorId: 'steelDef', characterId: 'big2' }]
  const wide = companionList({ ...bigtown(), constantCompanions: bigMarks }, { everywhere: true, constant: true })
  assert.deepEqual(keysOf(wide), [...ofBig(1), ...ofBig(2).slice(0, 19), 'steelDef', ...ofBig(3).slice(0, 9), 'keeper'], "both constant ones kept, each last of its character's, then the first not away, in the list's order")
  actors.delete(keeper.id)
  ok("K3. Thorin's companions owned, then summoned, then constant, each by name; past twenty, all sixteen constant ones kept, then the first of his own not away, in the list's order; and past the campaign's fifty, Bigtown's sixty, a constant one of Big 2's and of Big 3's both kept, each last of its character's, then the first of the rest, in the list's order")
}

// K4. Thorin summons dnd5e's copy onto the den, not the active scene: one companions.listed, its key
// the NPC marked, its copy the token, placed and away, no entry of its own; its sheet the token's. The
// token is renamed, as a Gamemaster may name it: the companion is still named by the NPC marked.
const placedAt = async (on, id, flags = BY_THORIN, system = {}, { name = 'Steel Defender', base = steelCopy } = {}) => {
  const at = app.events.length
  const token = await createToken(on, base, { id, name, delta: { flags, system } })
  await until(() => listed(at, 'camp-k').length, `the list with ${id}`, 1000)
  await settle(); await settle()
  return { token, at }
}
{
  const { at } = await placedAt(den, 'sd1', BY_THORIN, { attributes: { hp: { value: 15 } } }, { name: 'Steel Defender (Thorin)' })
  const lists = listed(at, 'camp-k')
  assert.equal(lists.length, 1, 'one companions.listed')
  const entry = steelOf(lists[0].data.companions)
  assert.deepEqual(copyOf(entry), ['steelCopy', 'sd1', 'den', 'Scene.den.Token.sd1.Actor.steelCopy', true, true])
  assert.deepEqual([entry.name, entry.img, entry.summon], ['Steel Defender', 'steelDef.webp', null], "named and pictured by the NPC marked, not by its token, Steel Defender (Thorin)")
  assert.ok(!keysOf(lists[0].data.companions).includes('den-sd1'), 'no entry of its own')
  const sheet = sheetsOf('steelDef', at).at(-1)
  assert.ok(sheet && (app.events.indexOf(sheet) > app.events.indexOf(lists[0])), 'its sheet sent again, after the list')
  assert.equal(sheet.data.sheet.hp.value, 15, "the token's hit points")
  assert.equal(sheet.data.companion.name, 'Steel Defender', 'its sheet under the same name')
  ok("K4. Thorin's summon of dnd5e's copy onto the den: one companions.listed, the Steel Defender keyed as marked, its actorId, tokenId, sceneId and uuid the token's, placed and away, no den-sd1 of its own, and named by the NPC marked though its token is Steel Defender (Thorin); then its sheet again, the token's hit points")
}

// K5. A second token, on the arena: the active scene's first, whatever the order of scenes; deleted,
// the den's again; both deleted, no token, its sheet the NPC's again.
{
  await placedAt(arena, 'sd2')
  assert.deepEqual(copyOf(steelOf()).slice(1, 3), ['sd2', 'arena'], "the arena's")
  await activate(den)
  await settle(); await settle()
  assert.deepEqual(copyOf(steelOf()).slice(1, 3), ['sd1', 'den'], "the den made the active scene: the den's, though the arena is first")
  await activate(arena)
  await settle(); await settle()
  assert.deepEqual(copyOf(steelOf()).slice(1, 3), ['sd2', 'arena'], 'and back')
  await arena.tokens.get('sd2').delete()
  await settle(); await settle()
  assert.deepEqual(copyOf(steelOf()).slice(1, 3), ['sd1', 'den'], "the arena's deleted: the den's")
  const at = app.events.length
  await den.tokens.get('sd1').delete()
  await until(() => sheetsOf('steelDef', at).length, 'its sheet again')
  assert.deepEqual(copyOf(steelOf(listed(at, 'camp-k').at(-1).data.companions)), ['steelDef', null, null, 'Actor.steelDef', false, false], 'no token')
  ok("K5. a second token on the arena is its copy over the den's, and the den's once the den is the active scene, though the arena comes first; the arena's deleted, the den's; both deleted, the NPC itself, placed false, its sheet sent again")
}

// K6. Its only token hidden: still its copy, and nothing is sent.
{
  await placedAt(arena, 'sd3')
  const shown = steelOf()
  const at = app.events.length
  await arena.tokens.get('sd3').update({ hidden: true })
  await settle(); await settle()
  assert.deepEqual(steelOf(), shown, 'its copy the hidden token')
  assert.deepEqual([listed(at, 'camp-k'), sheetsOf('steelDef', at)], [[], []], 'nothing sent')
  await arena.tokens.get('sd3').delete()
  await settle(); await settle()
  ok('K6. its only token hidden, it stays its copy: the same entry, placed, and nothing sent')
}

// K7. Vex's own summon of dnd5e's copy is Vex's summoned companion; Thorin's constant keeps his own.
{
  await placedAt(arena, 'sdv', BY_VEX)
  await placedAt(arena, 'sd4')
  const list = companionList(keepwatch())
  const vexs = list.find(each => each.key === 'arena-sdv')
  assert.deepEqual([vexs?.kind, vexs?.of], ['summoned', ['vex']], "Vex's summoned companion")
  assert.equal(steelOf(list).tokenId, 'sd4', "Thorin's own token")
  for (const id of ['sdv', 'sd4']) await arena.tokens.get(id).delete()
  await settle(); await settle()
  ok("K7. a token of dnd5e's copy that Vex summoned stays Vex's summoned companion, arena-sdv; Thorin's Steel Defender keeps his own token")
}

// K8. The Hawk, linked, marked: with no summon yet the NPC itself, though dnd5e keeps two copies of
// it for other summons, a linked one Vex summoned and an unlinked one; Thorin summons it, and dnd5e
// makes its linked copy for the summon, which the Gamemaster has renamed, and places its token: the
// copy, placed; the token gone, the copy kept, with no sheet sent again, as it's the same creature;
// named the Hawk all the while. Marked for Vex too, Vex's mark first, Thorin's copy, as he comes first
// in the campaign; for Vex alone, the copy Vex summoned.
{
  await saveKeep({ constantCompanions: [STEEL, { actorId: 'hawk', characterId: 'thorin' }] }, 'hawk')
  const hawkOf = (list = companionList(keepwatch())) => list.find(each => each.key === 'hawk')
  assert.deepEqual(copyOf(hawkOf()), ['hawk', null, null, 'Actor.hawk', false, false], 'no summon yet: the NPC itself')
  const hawkCopy = (id, name, origin, linked, hp = 12) => companionActor(id, name, {
    linked, flags: { dnd5e: { isAutoImported: true, summon: { origin, activity: 'sd-summon' } } },
    stats: { duplicateSource: 'Actor.hawk' }, spec: { ...creature({ dex: 3 }), hp: { value: hp, max: 12, temp: 0 } },
  })
  const vexHawk = hawkCopy('hawkVex', 'Hawk', 'Actor.vex.Item.steelDefender', true)
  const looseHawk = hawkCopy('hawkLoose', 'Hawk', 'Actor.thorin.Item.summonDragon', false)
  for (const each of [vexHawk, looseHawk]) await Hooks.callAll('createActor', each, {}, 'gm')
  await settle(); await settle()
  assert.deepEqual(copyOf(hawkOf()), ['hawk', null, null, 'Actor.hawk', false, false], "Vex's linked copy and an unlinked one aren't Thorin's: still the NPC itself")
  let at = app.events.length
  const clone = hawkCopy('hawkClone', 'Hawk (Thorin)', 'Actor.thorin.Item.summonDragon', true, 9)
  await Hooks.callAll('createActor', clone, {}, 'gm')
  const hk1 = await createToken(arena, clone, { id: 'hk1', actorLink: true, name: 'Hawk (Thorin)' })
  await until(() => listed(at, 'camp-k').length && sheetsOf('hawk', at).length, "the list and the Hawk's sheet", 1000)
  await settle(); await settle()
  const placed = listed(at, 'camp-k').at(-1).data.companions
  assert.deepEqual(copyOf(hawkOf(placed)), ['hawkClone', null, null, 'Actor.hawkClone', true, false], "dnd5e's linked copy, placed")
  assert.equal(hawkOf(placed).name, 'Hawk', 'named by the NPC marked, not its copy, Hawk (Thorin)')
  assert.ok(!keysOf(placed).includes('hawkClone'), 'no entry of its own')
  assert.equal(sheetsOf('hawk', at).at(-1).data.sheet.hp.value, 9, "the copy's hit points")
  at = app.events.length
  await hk1.delete()
  await until(() => listed(at, 'camp-k').length, 'the list without the token', 1000)
  await settle(); await settle()
  const kept = hawkOf(listed(at, 'camp-k').at(-1).data.companions)
  assert.deepEqual(copyOf(kept), ['hawkClone', null, null, 'Actor.hawkClone', false, false], "the copy Thorin summoned kept, with no token, not Vex's")
  assert.equal(kept.name, 'Hawk', 'still named by the NPC marked')
  assert.deepEqual(sheetsOf('hawk', at), [], 'no sheet sent again')
  const forVex = { actorId: 'hawk', characterId: 'vex' }
  const markedFor = marks => hawkOf(companionList({ ...keepwatch(), constantCompanions: [STEEL, ...marks] }))
  const both = markedFor([forVex, { actorId: 'hawk', characterId: 'thorin' }])
  assert.deepEqual([both?.uuid, both?.of], ['Actor.hawkClone', ['thorin', 'vex']], "marked for Vex and Thorin, Vex's mark first: Thorin's copy, first in the campaign")
  assert.equal(markedFor([forVex])?.uuid, 'Actor.hawkVex', "for Vex alone, the copy Vex summoned")
  for (const each of [vexHawk, looseHawk, clone]) {
    actors.delete(each.id)
    await Hooks.callAll('deleteActor', each, {}, 'gm')
  }
  await settle(); await settle()
  ok("K8. a linked Hawk marked: with no summon yet the NPC itself, though dnd5e keeps a linked copy Vex summoned and an unlinked one; summoned by Thorin, dnd5e's linked copy of it, its token placed, the copy's sheet sent; its token deleted, the copy Thorin summoned kept, with the summon's last hit points, placed false and no sheet sent again; named the Hawk though its copy is renamed; marked for Vex and Thorin, Vex's mark first, Thorin's copy, and for Vex alone, Vex's")
}

// K9. An Owl Alice owns, marked for Thorin: listed once, constant; Bob given Owner, Vex's too.
{
  const sideOwl = companionActor('sideOwl', 'Owl', { owners: ['alice'], linked: true, spec: creature({ dex: 2 }) })
  await Hooks.callAll('createActor', sideOwl, {}, 'gm')
  await saveKeep({ constantCompanions: [STEEL, { actorId: 'sideOwl', characterId: 'thorin' }] }, 'sideOwl')
  const owls = () => companionList(keepwatch()).filter(each => each.uuid === 'Actor.sideOwl')
  assert.deepEqual(owls().map(each => [each.key, each.kind, each.of]), [['sideOwl', 'constant', ['thorin']]], 'once, constant')
  await changeActor(sideOwl, { ownership: { bob: 3 } })
  await settle(); await settle()
  assert.deepEqual(owls().map(each => [each.key, each.kind, each.of]), [['sideOwl', 'constant', ['thorin', 'vex']]], "Bob's too: Vex's")
  // dnd5e's copies for a summon that Bob's summon for Vex made, his as dnd5e makes them, each marked
  // for Thorin: an unlinked one, flagged isAutoImported, and a linked one with Vex's summon on it.
  // Thorin's alone: a copy or a summon is never an owned companion (rule 2), so Bob's owning it makes
  // it nothing of Vex's.
  const bobCopy = companionActor('kBobCopy', 'Owl', { owners: ['bob'], linked: false, flags: { dnd5e: { isAutoImported: true } }, stats: { compendiumSource: 'Compendium.dnd5e.monsters.Actor.owl' }, spec: creature({ dex: 2 }) })
  const bobClone = companionActor('kBobClone', 'Owl', { owners: ['bob'], linked: true, flags: { dnd5e: { isAutoImported: true, summon: { origin: 'Actor.vex.Item.steelDefender', activity: 'sd-summon' } } }, stats: { duplicateSource: 'Actor.hawk' }, spec: creature({ dex: 2 }) })
  const bobsMarked = companionList({ ...keepwatch(), constantCompanions: [STEEL, ...['kBobCopy', 'kBobClone'].map(actorId => ({ actorId, characterId: 'thorin' }))] })
  assert.deepEqual(['kBobCopy', 'kBobClone'].map(key => bobsMarked.filter(each => each.uuid === `Actor.${key}`).map(each => [each.key, each.kind, each.of])),
    [[['kBobCopy', 'constant', ['thorin']]], [['kBobClone', 'constant', ['thorin']]]], "dnd5e's copies Bob's summon made, marked for Thorin: Thorin's alone, once each")
  for (const each of [bobCopy, bobClone]) actors.delete(each.id)
  actors.delete('sideOwl')
  await Hooks.callAll('deleteActor', sideOwl, {}, 'gm')
  await saveKeep({ constantCompanions: [STEEL] }, 'steelDef')
  ok("K9. an Owl Alice owns, marked for Thorin, is listed once, as constant, of Thorin; given Bob too, of Thorin and Vex, in the roster's order; dnd5e's copies for a summon Bob's summon for Vex made, unlinked or linked, his, marked for Thorin, of Thorin alone")
}

// K10. Not listed, read from the campaign given before anything is saved: a mark of a campaign
// character, a transformed actor, a character-type actor, a deleted actor, or for a character no
// longer in the campaign.
{
  companionActor('kForm', 'Hound (Wolf)', { linked: true, flags: { dnd5e: { isPolymorphed: true } } })
  companionActor('kSquire', 'Squire', { linked: true, type: 'character' })
  const marks = ['dragon', 'kForm', 'kSquire', 'kGone00000000000'].map(actorId => ({ actorId, characterId: 'thorin' }))
  const campaign = { ...keepwatch(), characters: new Set(['thorin', 'dragon']), constantCompanions: [...marks, { actorId: 'steelDef', characterId: 'vex' }] }
  assert.equal(constantCopies(campaign).size, 0, 'none')
  assert.ok(!companionList(campaign).some(each => each.kind === 'constant'))
  for (const id of ['kForm', 'kSquire']) actors.delete(id)
  ok("K10. no constant companion of a mark of a campaign character, a transformed actor, a character-type actor or a deleted actor, nor of one for Vex once Vex isn't the campaign's, read at once from the campaign given")
}

// K12, K13. A hello on its way: a chat message the Steel Defender speaks with no token is its; the hello
// answered at 4, its companionsConstant kept, and nothing follows.
{
  let release
  app.hold = new Promise(resolve => { release = resolve })
  const at = app.events.length
  announce({ campaignId: 'camp-k' })
  await wait(30)
  const said = await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: steelDef }), content: '<p>Whirr.</p>' })
  release()
  await until(() => sheetsOf('steelDef', at).length, 'the hello answered, and its sheet')
  await settle(); await settle()
  const chat = ofType(since(at), 'chat.message.created', 'camp-k').find(e => e.data.message.id === said.id)
  assert.equal(chat?.data.message.companion, 'steelDef', 'its chat, with no token')
  assert.deepEqual(listed(at, 'camp-k'), [], 'answered at 4: no companions.listed follows')
  ok("K12, K13. a hello on its way: a chat message the Steel Defender speaks with no token is marked its; answered at 4, the hello's companionsConstant is kept, and no companions.listed follows")
}

// K14. No scene active, then no scene at all: listed with no token, and rolled for.
{
  let at = app.events.length
  await arena.update({ active: false })
  await until(() => listed(at, 'camp-k').length, 'the list with no scene active', 1000)
  await settle(); await settle()
  assert.deepEqual(copyOf(steelOf(listed(at, 'camp-k').at(-1).data.companions)), ['steelDef', null, null, 'Actor.steelDef', false, false], 'no scene active')
  // A token of its copy placed on the den while no scene is active: the list still built, that token
  // its copy, placed, and not away, as none is away with no scene active (rule 8).
  {
    const { token, at: placing } = await placedAt(den, 'sdk')
    const told = steelOf(listed(placing, 'camp-k').at(-1).data.companions)
    assert.deepEqual(copyOf(told), ['steelCopy', 'sdk', 'den', 'Scene.den.Token.sdk.Actor.steelCopy', true, false], 'no scene active, a token of its copy on the den: its copy, placed, not away')
    assert.deepEqual(copyOf(steelOf()), copyOf(told), 'and so as read at once')
    await token.delete()
    await settle(); await settle()
  }
  const all = [...scenes.entries()]
  scenes.clear()
  try {
    assert.deepEqual(copyOf(steelOf()), ['steelDef', null, null, 'Actor.steelDef', false, false], 'no scene at all')
    const checked = await send({ id: `chk-${++ids}`, actorId: 'steelDef', of: 'thorin', kind: 'ability', key: 'str', ...plain, dice: [{ faces: 20, results: [12] }] }, 'camp-k')
    assert.equal(checked.status, 'done', JSON.stringify(checked))
    const struck = await send(attack({ actorId: 'steelDef', of: 'thorin', item: 'forceRend', activity: 'rend-hit', target: null }), 'camp-k')
    assert.equal(struck.status, 'done', JSON.stringify(struck))
  } finally {
    for (const [id, each] of all) scenes.set(id, each)
  }
  at = app.events.length
  await activate(arena)
  await settle(); await settle()
  ok('K14. with no scene active, and with no scene at all, the Steel Defender is listed, placed and away false, and its check and its attack at no one are made; with no scene active and a token of its copy placed on the den, that token its copy, placed, not away')
}

// K15, K16. With no token, everything its sheet in Foundry allows, on the NPC: a check, a save, an
// attack at no one, Repair spending a use of its own, its hit points set, at itself; and at the goblin
// picked, as any tokenless linked NPC's.
{
  const done = (made, what) => assert.equal(made.status, 'done', `${what}: ${JSON.stringify(made)}`)
  const made = [
    await send({ id: `chk-${++ids}`, actorId: 'steelDef', of: 'thorin', kind: 'ability', key: 'dex', ...plain, dice: [{ faces: 20, results: [9] }] }, 'camp-k'),
    await send({ id: `sv-${++ids}`, actorId: 'steelDef', of: 'thorin', kind: 'save', key: 'con', ...plain, dice: [{ faces: 20, results: [13] }] }, 'camp-k'),
  ]
  made.forEach((each, i) => done(each, ['check', 'save'][i]))
  assert.ok(made.every(each => messageOf(each.id)?.speakerActor === steelDef), 'on the NPC itself')
  const required = MIDI ? midi.settings.requiresTargets : null
  if (MIDI) midi.settings.requiresTargets = 'none'
  try {
    const struck = await send(attack({ actorId: 'steelDef', of: 'thorin', item: 'forceRend', activity: 'rend-hit', target: null }), 'camp-k')
    done(struck, 'an attack at no one')
    assert.deepEqual(madeBy(struck).flags.dnd5e.targets ?? [], [], 'its card names no one')
    const spent = steelDef.items.get('repair').system.uses.spent
    const repaired = await send(use({ actorId: 'steelDef', of: 'thorin', item: 'repair', activity: 'repair-use' }), 'camp-k')
    done(repaired, 'Repair')
    assert.equal(steelDef.items.get('repair').system.uses.spent, spent + 1, "a use of the NPC's spent")
    const self = await send(use({ actorId: 'steelDef', of: 'thorin', item: 'repair', activity: 'repair-use', self: true }), 'camp-k')
    done(self, 'Repair at itself')
    assert.deepEqual(useCard(self.id).flags.dnd5e.targets.map(t => t.name), ['Steel Defender'], 'its card names it')
    // K16: at the goblin picked from the fight, as Brakka, a linked NPC with no token, is.
    const atGoblin = await send(attack({ actorId: 'steelDef', of: 'thorin', item: 'forceRend', activity: 'rend-hit' }), 'camp-k')
    const brakkas = await send(attack({ actorId: 'brakka', of: 'thorin', item: 'greataxe', activity: 'cleave' }), 'camp-k')
    assert.deepEqual([atGoblin.status, atGoblin.reason], [brakkas.status, brakkas.reason], `as Brakka's: ${JSON.stringify([atGoblin, brakkas])}`)
    if (atGoblin.status === 'done') assert.deepEqual(madeBy(atGoblin).flags.dnd5e.targets.map(t => t.name), ['Goblin'], 'made at the goblin')
  } finally {
    if (MIDI) midi.settings.requiresTargets = required
  }
  const set = await send({ id: `hp-${++ids}`, actorId: 'steelDef', of: 'thorin', kind: 'hitPoints', ...plain, dice: [], hitPoints: { op: 'set', value: 14, from: { value: 20 } } }, 'camp-k')
  done(set, 'its hit points set')
  assert.equal(steelDef.system.attributes.hp.value, 14, "the NPC's own")
  ok(`K15, K16. with no token, on the NPC itself: a check and a save made; an attack at no one, its card naming no one${MIDI ? ', Midi needing no target' : ''}; Repair spending a use of its own; Repair at itself, its card naming it; its hit points set; and an attack at the goblin picked made or refused as Brakka's, a linked NPC with no token`)
}

// K17. Initiative: with no token, no combatant, refused not-in-combat; its token in the arena's fight,
// rolled for that combatant.
{
  const refused = await send({ id: `init-${++ids}`, actorId: 'steelDef', of: 'thorin', kind: 'initiative', combatId: 'fight', ...plain, dice: [{ faces: 20, results: [10] }] }, 'camp-k')
  assert.deepEqual([refused.status, refused.reason], ['failed', 'not-in-combat'], 'no combatant')
  const { token } = await placedAt(arena, 'sd5')
  const added = await fight.createEmbeddedDocuments('Combatant', [{ id: 'cb-steel', token }])
  await settle(); await settle()
  const rolled = await send({ id: `init-${++ids}`, actorId: 'steelDef', of: 'thorin', kind: 'initiative', combatId: 'fight', ...plain, dice: [{ faces: 20, results: [10] }] }, 'camp-k')
  assert.equal(rolled.status, 'done', JSON.stringify(rolled))
  assert.notEqual(added[0].initiative, null, "its token's combatant rolled")
  fight.combatants.delete('cb-steel')
  await token.delete()
  await settle(); await settle()
  ok("K17. the Steel Defender's initiative with no token is refused not-in-combat; with its token in the arena's fight, rolled on that token's combatant")
}

// K18. With no token, concentrating: dnd5e's concentration card, which asks the actor, asks it, filed
// under its key.
{
  const conc = await steelDef.beginConcentrating({ id: 'repair-use', item: steelDef.items.get('repair') })
  const set = await send({ id: `hp-${++ids}`, actorId: 'steelDef', of: 'thorin', kind: 'hitPoints', ...plain, dice: [], hitPoints: { op: 'set', value: 10, from: { value: 14 } } }, 'camp-k')
  assert.equal(set.status, 'done', JSON.stringify(set))
  const at = app.events.length
  const card = await concentrationCardOf(steelDef, { dc: 10 })
  await settle()
  const asked = ofType(since(at), 'roll.prompt.opened', 'camp-k').map(e => e.data.prompt)
  assert.deepEqual(asked.map(prompt => [prompt.id, prompt.actorId, prompt.type]), [[`${card.id}-steelDef`, 'steelDef', 'concentration']], 'asked, filed under its key')
  await deleteMessage(card)
  await steelDef.endConcentration(conc.id)
  await settle()
  ok("K18. with no token, concentrating, its hit points lowered from the app: dnd5e's concentration card asks the Steel Defender, filed under steelDef, its prompt <card>-steelDef")
}

// K19. A save card at its copy token: asked by the token's id, filed under its key; the token deleted,
// its copy is another creature, so what it was asked closes gone, and an answer after is another's.
// Not under Midi-QOL, which takes a save card's saves itself (companion-saves.mjs, with Midi's saves,
// pins that what Midi waits on is let go, gone, through the same call, closeCompanionPrompts).
if (!MIDI) {
  const { token } = await placedAt(arena, 'sd6')
  let at = app.events.length
  const card = await saveCard({ by: goblin, item: { id: 'burning', name: 'Burning Hands', img: 'burning.webp', uuid: 'Actor.goblin.Item.burning' }, dc: 13, abilities: ['dex'], targets: [token.actor] })
  await settle()
  const [prompt] = ofType(since(at), 'roll.prompt.opened', 'camp-k').map(e => e.data.prompt)
  assert.deepEqual([prompt?.id, prompt?.actorId], [`${card.id}-sd6`, 'steelDef'], "its token's id, filed under its key")
  at = app.events.length
  await token.delete()
  await until(() => ofType(since(at), 'roll.prompt.closed', 'camp-k').length, 'its prompt closed', 1000)
  const order = since(at).filter(e => e.campaign?.id === 'camp-k').map(e => e.type)
  assert.deepEqual(ofType(since(at), 'roll.prompt.closed', 'camp-k').map(e => [e.data.id, e.data.reason]), [[prompt.id, 'gone']], 'closed gone')
  assert.ok(order.indexOf('companions.listed') < order.indexOf('roll.prompt.closed'), 'in the comparison that lists the change')
  const late = await send({ id: `ans-${++ids}`, actorId: 'steelDef', of: 'thorin', kind: 'save', key: 'dex', ...plain, dice: [{ faces: 20, results: [14] }], prompt: prompt.id }, 'camp-k')
  assert.deepEqual([late.status, late.reason, late.error], ['failed', 'prompt', 'character'], 'an answer after: another creature\'s')
  await deleteMessage(card)
  await settle()
  ok("K19. a save card at its copy token asks it by the token's id, filed under steelDef; the token deleted, its prompt closes gone as the list changes, and an answer after is refused prompt, its error character")
}

// K20. The NPC marked deleted: not listed, its sheet forgotten.
{
  const at = app.events.length
  actors.delete('steelDef')
  await Hooks.callAll('deleteActor', steelDef, {}, 'gm')
  await until(() => listed(at, 'camp-k').length, 'the list without it', 1000)
  assert.equal(steelOf(listed(at, 'camp-k').at(-1).data.companions), undefined, 'gone')
  actors.set('steelDef', steelDef)
  const back = app.events.length
  await Hooks.callAll('createActor', steelDef, {}, 'gm')
  await until(() => sheetsOf('steelDef', back).length, 'its sheet again, as new')
  await settle(); await settle()
  ok('K20. the NPC marked deleted is listed no more, and its sheet forgotten: made again, its sheet is sent as a new companion\'s')
}

// K21. What it costs: the every-scene world of 200 scenes of 50 tokens at 4, with a mark: no
// creature made up for any of them.
{
  const mob = companionActor('kMob', 'Orc', { linked: false, spec: creature() })
  const before = companionList(keepwatch())
  const mobs = Array.from({ length: 200 }, (_, n) => {
    const each = scene(`kmob${n}`)
    for (let t = 0; t < 50; t++) placeToken(each, mob, { id: `km${n}x${t}`, name: 'Orc' })
    return each
  })
  const started = performance.now()
  assert.deepEqual(companionList(keepwatch()), before, 'the list unchanged')
  const ms = performance.now() - started
  assert.ok(mobs.flatMap(each => each.tokens.contents).every(token => !token._synthetic), 'none of the 10,000 made up')
  for (const each of mobs) scenes.delete(each.id)
  actors.delete('kMob')
  ok(`K21. 200 scenes of 50 tokens at 4 with a constant companion marked: Keepwatch's companions found in ${ms.toFixed(1)} ms, none of the 10,000 creatures made up`)
}

// K22-K25. Manage Campaigns' Companions tab, where the Gamemaster marks them: drawn from the real
// template in jsdom (settings-app.mjs), used as the Gamemaster would.
const C = 'SENDINGSTONE.Config.Companions'
const Event = page.defaultView.Event
const marksSaved = () => settings.get('campaigns').find(campaign => campaign.id === 'camp-k').constantCompanions
const rowsOf = (win, character) => [...win.element.querySelectorAll(`[data-constant-character="${character}"] [data-constant-row]`)].map(row => row.dataset.constantRow)
const addButton = character => `[data-action="openCompanionPicker"][data-character-id="${character}"]`
const warned = []
const warn = ui.notifications.warn
ui.notifications.warn = message => { warned.push(message) }
const openTab = async () => {
  const win = await openSettings()
  await view(win, 'campaign', { campaignId: 'camp-k', tab: 'companions' })
  return win
}
await saveKeep({ constantCompanions: [] })

// K22. The tab, between Party, where drawn, and Player actions; under another system, none.
{
  const win = await openTab()
  const tabs = [...win.element.querySelectorAll('.sending-stone-tabs [data-tab]')].map(button => button.dataset.tab)
  assert.deepEqual(tabs, ['players', 'companions', 'actions', 'connection'], 'Companions before Player actions (no Group actors here, so no Party tab)')
  assert.equal(find(win, '.sending-stone-tabs [data-tab="companions"]').getAttribute('aria-current'), 'page')
  assert.equal(find(win, '.sending-stone-scroll > p.hint').textContent.trim(), `${C}.Lead`, 'the lead first')
  const box = character => find(win, `[data-constant-character="${character}"]`)
  assert.match(box('thorin').textContent, /Thorin[\s\S]*Alice/, "Thorin's box names his player")
  assert.ok(box('vex').textContent.includes(`${C}.None`), "Vex's: none")
  assert.deepEqual([...win.element.querySelectorAll('[data-constant-character]')].map(each => each.dataset.constantCharacter), ['thorin', 'vex'], "in the campaign's order")
  assert.equal([...win.element.querySelectorAll('.sending-stone-scroll > p.hint')].at(-1).textContent.trim(), `${C}.FoundAlone`, 'and last, the companions it never lists')
  assert.equal(find(win, '.sending-stone-tabs [data-tab="companions"]').textContent.trim(), 'SENDINGSTONE.Config.Tabs.Companions', 'the tab named Companions')
  assert.deepEqual(['thorin', 'vex'].map(id => [find(win, `[data-constant-drop="${id}"] > .hint`).textContent.trim(), find(win, addButton(id)).textContent.trim()]),
    [[`${C}.Drop {"character":"Thorin"}`, `${C}.Add`], [`${C}.Drop {"character":"Vex"}`, `${C}.Add`]], "each character's place says what to drop on it, by his name, and has its Add companions")
  // A campaign with no characters yet, added and not saved: no box, and where to add them.
  await click(win, '[data-action="addCampaign"]')
  await click(win, '.sending-stone-tabs [data-tab="companions"]')
  assert.deepEqual([find(win, '.sending-stone-scroll > .sending-stone-empty').textContent.trim(), win.element.querySelectorAll('[data-constant-character]').length],
    [`${C}.NoCharacters`, 0], 'a campaign with no characters: says to add them first')
  game.system.id = 'pf2e'
  try {
    await win.render()
    assert.equal(win.element.querySelector('.sending-stone-tabs [data-tab="companions"]'), null, 'no tab under another system')
    assert.equal(find(win, '.sending-stone-tabs [data-tab="players"]').getAttribute('aria-current'), 'page', 'and the view back on Players')
  } finally {
    game.system.id = 'dnd5e'
    await win.close()
  }
  ok("K22. Manage Campaigns' Companions tab, named Companions, before Player actions, opens on the lead and a box for each of the campaign's characters in its order, Thorin's naming Alice, Vex's with none, each place saying what to drop on it by his name and with its Add companions, and ends on those it never lists; a campaign with no characters says to add them first; under another system there's no such tab, and a view on it goes back to Players")
}

// K23. Dropped from the Actors sidebar: an NPC kept, marked as unsaved, saved; dropped again on the
// same character, still one; anything else warned and nothing kept; a drop after the tab is drawn again
// works; a token of it named by its scene. Dragged over a character's place it's lit, still lit as the
// drag moves onto a part of it, and unlit as it leaves, or as anything is dropped, kept or not; a drag
// over the tab outside any character's place isn't taken.
{
  let win = await openTab()
  {
    const zone = find(win, '[data-constant-drop="thorin"]')
    const drag = (type, target, relatedTarget = null) => {
      const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }), { relatedTarget })
      target.dispatchEvent(event)
      return event.defaultPrevented
    }
    assert.deepEqual([drag('dragover', zone.querySelector('.hint')), zone.hasAttribute('data-over')], [true, true], 'dragged over a part of his place: taken, and lit')
    drag('dragleave', zone, zone.querySelector('button'))
    assert.ok(zone.hasAttribute('data-over'), 'moved onto its Add companions: still lit')
    drag('dragleave', zone.querySelector('button'), find(win, '.sending-stone-tabs [data-tab="players"]'))
    assert.equal(zone.hasAttribute('data-over'), false, 'and off his place: unlit')
    assert.equal(drag('dragover', find(win, '.sending-stone-scroll > p.hint')), false, "over the lead, no character's place: not taken")
  }
  const dropped = await drop(win, '[data-constant-drop="thorin"]', { type: 'Actor', uuid: 'Actor.steelDef' })
  assert.deepEqual([dropped.accepted, dropped.lit, dropped.taken], [true, true, true], 'lit while dragged over, and the drop taken')
  assert.deepEqual(rowsOf(win, 'thorin'), ['steelDef'], 'a row')
  assert.equal(find(win, '[data-constant-row="steelDef"] .hint').textContent.trim(), `${C}.NoToken`)
  const remove = find(win, '[data-action="removeConstant"][data-actor-id="steelDef"]')
  const removeLabel = `${C}.Remove {"name":"Steel Defender","character":"Thorin"}`
  assert.deepEqual([find(win, '[data-constant-row="steelDef"] .sending-stone-row-name > span').textContent.trim(), remove.getAttribute('aria-label'), remove.getAttribute('data-tooltip')],
    ['Steel Defender', removeLabel, removeLabel], 'its row named, and its Remove button, an icon, named for it and Thorin, its tooltip the same')
  assert.equal(find(win, '[data-dirty]').dataset.dirty, 'true', 'unsaved')
  assert.equal(page.activeElement, find(win, addButton('thorin')), "focus on Thorin's Add companions")
  warned.length = 0
  const again = await drop(win, '[data-constant-drop="thorin"]', { type: 'Actor', uuid: 'Actor.steelDef' })
  assert.deepEqual([rowsOf(win, 'thorin'), warned], [['steelDef'], []], 'dropped again on Thorin: still one row, and no warning')
  assert.equal(again.zone.hasAttribute('data-over'), false, 'and unlit, though nothing was drawn again')
  const group = companionActor('kBand', 'Band', { type: 'group' })
  // A compendium's NPC, as Foundry's fromUuidSync gives it: its document, with its pack, where it's
  // loaded, else its index entry; and a token's own actor, by its uuid. None is a world actor.
  const packed = { documentName: 'Actor', id: 'sd', name: 'Steel Defender', type: 'npc', pack: 'dnd5e.monsters', flags: {}, uuid: SD_SOURCE }
  const indexed = { _id: 'sd2', name: 'Steel Defender', type: 'npc', uuid: 'Compendium.dnd5e.monsters.Actor.sd2' }
  placeToken(arena, hound, { id: 'kh1', name: 'Hound' })
  assert.ok(fromUuidSync('Scene.arena.Token.kh1.Actor.hound')?.isToken, "the hound token's own actor")
  const theirSync = globalThis.fromUuidSync
  globalThis.fromUuidSync = (uuid, options) => ({ [packed.uuid]: packed, [indexed.uuid]: indexed })[uuid] ?? theirSync(uuid, options)
  const lit = []
  try {
    for (const data of [{ type: 'Actor', uuid: 'Actor.kBand' }, { type: 'Actor', uuid: 'Actor.vex' }, { type: 'Actor', uuid: 'Actor.brakkaWolf' }, { type: 'Actor', uuid: packed.uuid },
      { type: 'Actor', uuid: indexed.uuid }, { type: 'Actor', uuid: 'Scene.arena.Token.kh1.Actor.hound' }, 'not json']) {
      const { zone } = await drop(win, '[data-constant-drop="thorin"]', data)
      lit.push(zone.hasAttribute('data-over'))
    }
  } finally {
    globalThis.fromUuidSync = theirSync
    arena.tokens.delete('kh1')
  }
  assert.deepEqual(warned.map(each => String(each)), [`${C}.NotNpc`, `${C}.IsCharacter {"name":"Vex"}`, ...Array(5).fill(`${C}.NotNpc`)], 'each warned, a transformed NPC, a compendium\'s and a token\'s own among them')
  assert.deepEqual([rowsOf(win, 'thorin'), win.element.querySelectorAll('[data-constant-row]').length], [['steelDef'], 1], 'nothing more kept')
  assert.deepEqual(lit, Array(7).fill(false), 'and his place unlit after each')
  actors.delete(group.id)
  await click(win, '[data-action="removeConstant"][data-actor-id="steelDef"]')
  assert.deepEqual(rowsOf(win, 'thorin'), [], 'removed')
  await drop(win, '[data-constant-drop="thorin"]', { type: 'Actor', uuid: 'Actor.steelDef' })
  assert.deepEqual(rowsOf(win, 'thorin'), ['steelDef'], 'dropped again after a render')
  await save(win)
  await settle(); await settle()
  assert.deepEqual(marksSaved(), [STEEL], 'saved')
  await placedAt(arena, 'sd7')
  win = await openTab()
  assert.equal(find(win, '[data-constant-row="steelDef"] .hint').textContent.trim(), `${C}.OnScene {"scene":"arena"}`, 'its token named by its scene')
  await win.close()
  await arena.tokens.get('sd7').delete()
  await settle(); await settle()
  ok("K23. dragged over Thorin's place it's taken and lit, still lit moving onto a part of it, unlit off it, and a drag over the lead isn't taken; an NPC dropped from the Actors sidebar on his place is kept as his, its row saying no token, the window unsaved and focus on his Add companions, and saved; dropped on him again, still one row; its row named, and its Remove button named for it and Thorin, its tooltip the same; a Group, a campaign character, a transformed NPC, a compendium's NPC, loaded or by its index entry, a token's own actor and text that isn't one are each warned and nothing kept, his place unlit after each drop; dropped again after a render it's kept again; with a token on the arena its row names the arena")
}

// K24. Add companions: the world's NPCs, by name, those his already ticked and disabled, dnd5e's
// copies hinted; nothing to add until one is ticked; a filter by name, and one nothing matches; Add
// Selected; opened again with no filter; Escape. Vex's chooser, which offers Thorin's Hawk as his to
// pick, and adds what's picked as Vex's alone; Cancel, which keeps nothing; the chooser closed by
// leaving for another tab; and what it says with every NPC his already, or none in the world.
{
  const win = await openTab()
  await click(win, addButton('thorin'))
  assert.equal(find(win, '#sending-stone-companion-picker-title').textContent.trim(), `${C}.PickerTitle {"character":"Thorin"}`)
  assert.equal(page.activeElement, find(win, '[data-filter="companions"]'), 'focus on its filter')
  const boxes = [...win.element.querySelectorAll('[data-pick-companion]')]
  const ids = boxes.map(box => box.dataset.pickCompanion)
  assert.ok(ids.every(id => game.actors.get(id)?.type === 'npc'), 'NPCs only')
  assert.ok(!ids.includes('thorin') && !ids.includes('brakkaWolf') && ids.includes('dragon'), "no campaign character, nor a transformed one; another campaign's NPC character is one")
  const names = ids.map(id => game.actors.get(id).name)
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'en')), 'by name')
  const rowOf = id => find(win, `[data-pick-companion="${id}"]`).closest('label')
  const close = find(win, '.sending-stone-picker-head [data-action="closeCompanionPicker"]')
  assert.deepEqual([find(win, '[data-companion-picker]').getAttribute('aria-labelledby'), close.getAttribute('aria-label'), close.getAttribute('data-tooltip'), find(win, '[data-filter="companions"]').getAttribute('aria-label'),
    find(win, '[data-pick-companion-count]').getAttribute('role'), find(win, '.sending-stone-picker-footer [data-action="closeCompanionPicker"]').textContent.trim(), find(win, '[data-action="addPickedCompanions"]').textContent.trim(),
    rowOf('hawk').querySelector('.sending-stone-row-name > span').textContent.trim()],
  ['sending-stone-companion-picker-title', 'SENDINGSTONE.Config.Picker.Cancel', 'SENDINGSTONE.Config.Picker.Cancel', `${C}.Filter`, 'status', 'SENDINGSTONE.Config.Picker.Cancel', 'SENDINGSTONE.Config.Picker.Add', 'Hawk'],
  'named: the chooser by its title, its close button and Cancel, its filter, its count read out, Add Selected, and each NPC by its name')
  assert.deepEqual([find(win, '[data-pick-companion="steelDef"]').checked, find(win, '[data-pick-companion="steelDef"]').disabled], [true, true], 'his already: ticked, disabled')
  assert.equal(rowOf('steelDef').querySelector('.hint').textContent.trim(), `${C}.Already {"character":"Thorin"}`)
  assert.deepEqual(['steelCopy', 'steelOld'].map(id => rowOf(id).querySelector('.hint').textContent.trim()), [`${C}.SummonCopy`, `${C}.SummonCopy`], "dnd5e's copies hinted, flagged as it flags them now and as it did")
  assert.ok(find(win, '[data-action="addPickedCompanions"]').disabled, 'nothing to add yet')
  assert.equal(find(win, '[data-pick-companion-count]').textContent, 'SENDINGSTONE.Config.Picker.NoneSelected', 'and it says so')
  const hawkBox = find(win, '[data-pick-companion="hawk"]')
  hawkBox.checked = true
  hawkBox.dispatchEvent(new Event('change', { bubbles: true }))
  assert.equal(find(win, '[data-action="addPickedCompanions"]').disabled, false, 'one ticked')
  assert.equal(find(win, '[data-pick-companion-count]').textContent, 'SENDINGSTONE.Config.Picker.Selected {"count":1}')
  const filter = find(win, '[data-filter="companions"]')
  const shownIds = () => [...win.element.querySelectorAll('[data-filter-list="companions"] [data-search]')].filter(row => !row.hidden).map(row => row.querySelector('input').dataset.pickCompanion)
  filter.value = 'zzz'
  filter.dispatchEvent(new Event('input', { bubbles: true }))
  const noMatch = find(win, '[data-filter-list="companions"] [data-filter-empty]')
  assert.deepEqual([shownIds(), noMatch.hidden, noMatch.textContent.trim()], [[], false, `${C}.NoMatch`], 'none matching: says so')
  filter.value = 'haw'
  filter.dispatchEvent(new Event('input', { bubbles: true }))
  const shown = shownIds()
  assert.deepEqual(shown.map(id => game.actors.get(id).name), shown.map(() => 'Hawk'), 'filtered by name')
  assert.equal(noMatch.hidden, true, 'and no word of none matching')
  await click(win, '[data-action="addPickedCompanions"]')
  assert.deepEqual(rowsOf(win, 'thorin'), ['steelDef', 'hawk'], 'added')
  assert.equal(page.activeElement, find(win, addButton('thorin')), "focus back on Thorin's Add companions")
  await click(win, addButton('thorin'))
  assert.deepEqual([find(win, '[data-filter="companions"]').value, shownIds().length], ['', ids.length], 'opened again: no filter, every NPC shown')
  win.element.querySelector('[data-filter="companions"]').dispatchEvent(new page.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(win.element.querySelector('[data-companion-picker]'), null, 'Escape closes it')
  assert.equal(page.activeElement, find(win, addButton('thorin')), "focus on Thorin's Add companions")
  // Vex's: Thorin's Hawk is his to pick, and what's picked is his alone.
  const pick = id => {
    const box = find(win, `[data-pick-companion="${id}"]`)
    box.checked = true
    box.dispatchEvent(new Event('change', { bubbles: true }))
  }
  await click(win, addButton('vex'))
  assert.equal(find(win, '#sending-stone-companion-picker-title').textContent.trim(), `${C}.PickerTitle {"character":"Vex"}`)
  assert.deepEqual([find(win, '[data-pick-companion="hawk"]').checked, find(win, '[data-pick-companion="hawk"]').disabled, rowOf('hawk').querySelector('.hint')],
    [false, false, null], "Thorin's Hawk, in Vex's chooser: not ticked, not disabled, not his already")
  pick('hawk')
  await click(win, '[data-action="addPickedCompanions"]')
  assert.deepEqual([rowsOf(win, 'vex'), rowsOf(win, 'thorin')], [['hawk'], ['steelDef', 'hawk']], "added as Vex's, Thorin's as they were")
  assert.equal(page.activeElement, find(win, addButton('vex')), "focus back on Vex's Add companions")
  await click(win, addButton('vex'))
  pick('dragon')
  await click(win, '.sending-stone-picker-footer [data-action="closeCompanionPicker"]')
  assert.deepEqual([win.element.querySelector('[data-companion-picker]'), rowsOf(win, 'vex')], [null, ['hawk']], 'Cancel: closed, and the one picked not kept')
  assert.equal(page.activeElement, find(win, addButton('vex')), "focus on Vex's Add companions")
  // Left open for Player actions, and back: the boxes, not the chooser.
  await click(win, addButton('thorin'))
  await click(win, '.sending-stone-tabs [data-tab="actions"]')
  await click(win, '.sending-stone-tabs [data-tab="companions"]')
  assert.deepEqual([win.element.querySelector('[data-companion-picker]'), rowsOf(win, 'thorin')], [null, ['steelDef', 'hawk']], 'left for Player actions and back: the boxes again')
  // A world whose every NPC is Thorin's already, then one with none: the chooser says so. The world's
  // actors are put back as they were, in their order.
  await click(win, addButton('thorin'))
  const world = [...actors.entries()]
  try {
    for (const [id, actor] of world) if ((actor.type === 'npc') && (id !== 'steelDef') && (id !== 'hawk')) actors.delete(id)
    await win.render()
    assert.equal(find(win, '[data-companion-picker-empty]').textContent.trim(), `${C}.PickerEmpty {"character":"Thorin"}`, 'every NPC his already: says so')
    for (const id of ['steelDef', 'hawk']) actors.delete(id)
    await win.render()
    assert.deepEqual([find(win, '[data-companion-picker-empty]').textContent.trim(), win.element.querySelectorAll('[data-pick-companion]').length], [`${C}.NoNpcs`, 0], 'no NPC in the world: says so')
  } finally {
    actors.clear()
    for (const [id, actor] of world) actors.set(id, actor)
  }
  await click(win, '.sending-stone-picker-footer [data-action="closeCompanionPicker"]')
  await save(win)
  await settle(); await settle()
  assert.deepEqual(marksSaved(), [STEEL, { actorId: 'hawk', characterId: 'thorin' }, { actorId: 'hawk', characterId: 'vex' }], "saved: Thorin's two and Vex's Hawk")
  ok("K24. Add companions offers the world's NPCs by name, the chooser named by its title, its close button, Cancel, filter and Add Selected named and its count read out, no campaign character or transformed actor, Thorin's own ticked and disabled, already his, and dnd5e's copies for a summon hinted, the older flag's too; Add Selected waits for a tick and counts it; the filter narrows by name, and says when nothing matches; added, focus returns to his Add companions; opened again, no filter; Escape closes it the same; Vex's chooser offers Thorin's Hawk as Vex's to pick and adds it as Vex's alone; Cancel keeps nothing picked; leaving for another tab closes it; it says when every NPC is his already and when the world has none; saved")
}

// K25. Removed, that pair alone: the Hawk off Thorin, Vex's Hawk kept; focus on Add companions; marked
// again, in another order, nothing unsaved; saved without it, Vex's kept. A deleted actor's row isn't
// drawn; and a save drops the mark of an actor deleted, and of a character taken out of the campaign.
{
  let win = await openTab()
  const dirty = () => find(win, '[data-dirty]').dataset.dirty
  const removeHawk = () => click(win, '[data-action="removeConstant"][data-actor-id="hawk"][data-character-id="thorin"]')
  assert.deepEqual([rowsOf(win, 'thorin'), rowsOf(win, 'vex')], [['steelDef', 'hawk'], ['hawk']], 'as saved')
  await removeHawk()
  assert.deepEqual([rowsOf(win, 'thorin'), rowsOf(win, 'vex')], [['steelDef'], ['hawk']], "the Hawk off Thorin, and Vex's kept")
  assert.equal(page.activeElement, find(win, addButton('thorin')), "focus on Thorin's Add companions")
  assert.equal(dirty(), 'true', 'unsaved')
  await drop(win, '[data-constant-drop="thorin"]', { type: 'Actor', uuid: 'Actor.hawk' })
  assert.deepEqual([rowsOf(win, 'thorin'), dirty()], [['steelDef', 'hawk'], 'false'], 'marked again, after Vex\'s now: nothing unsaved')
  await removeHawk()
  await save(win)
  await settle(); await settle()
  assert.deepEqual(marksSaved(), [STEEL, { actorId: 'hawk', characterId: 'vex' }], "saved: Vex's Hawk, and not Thorin's")
  win = await openTab()
  const temp = companionActor('kTemp', 'Gargoyle', { linked: true })
  await drop(win, '[data-constant-drop="thorin"]', { type: 'Actor', uuid: 'Actor.kTemp' })
  await drop(win, '[data-constant-drop="thorin"]', { type: 'Actor', uuid: 'Actor.hawk' })
  assert.deepEqual(rowsOf(win, 'thorin'), ['steelDef', 'kTemp', 'hawk'])
  await click(win, '[data-action="removeConstant"][data-actor-id="steelDef"][data-character-id="thorin"]')
  assert.deepEqual([rowsOf(win, 'thorin'), rowsOf(win, 'vex')], [['kTemp', 'hawk'], ['hawk']], 'that one removed, no other')
  assert.equal(page.activeElement, find(win, addButton('thorin')), "focus on Thorin's Add companions")
  actors.delete(temp.id)
  await win.render()
  assert.deepEqual(rowsOf(win, 'thorin'), ['hawk'], "drawn again with the Gargoyle deleted: no row of it")
  await click(win, '.sending-stone-tabs [data-tab="players"]')
  await click(win, '[data-action="removeCharacter"][data-actor-id="vex"]')
  await save(win)
  await settle(); await settle()
  assert.deepEqual(marksSaved(), [{ actorId: 'hawk', characterId: 'thorin' }], "saved without it, the deleted actor's mark or the departed character's")
  // Marks saved by hand, outside the window: a pair twice, and a character-type actor's. The window's
  // save keeps the pair once and drops the other.
  const hireling = companionActor('kHireling', 'Hireling', { linked: true, type: 'character' })
  const hawkMark = { actorId: 'hawk', characterId: 'thorin' }
  await saveKeep({ constantCompanions: [hawkMark, hawkMark, { actorId: 'kHireling', characterId: 'thorin' }] })
  const again = await openTab()
  await save(again)
  await settle(); await settle()
  assert.deepEqual(marksSaved(), [hawkMark], 'the pair once, and no character-type actor')
  actors.delete(hireling.id)
  // A character deleted from the world, still in the campaign as it was saved: his mark goes at the save.
  const gone = add(new Actor5e({ id: 'kGone', name: 'Gone', owners: [] }))
  equip(gone, { items: [] })
  await saveKeep({ constantCompanions: [hawkMark, { actorId: 'hawk', characterId: 'kGone' }], characters: ['thorin', 'vex', 'kGone'] })
  actors.delete(gone.id)
  const after = await openTab()
  assert.ok(getCampaigns().find(campaign => campaign.id === 'camp-k').characters.has('kGone'), 'still in the campaign as saved')
  await save(after)
  await settle(); await settle()
  assert.deepEqual(marksSaved(), [hawkMark], "saved: the deleted character's mark gone")
  ui.notifications.warn = warn
  await saveKeep({ constantCompanions: [STEEL], characters: ['thorin', 'vex'] })
  ok("K25. Remove takes that pair alone off, the Hawk off Thorin and Vex's Hawk kept, focus on Thorin's Add companions; marked again, though in another order, nothing is unsaved; saved, Vex's Hawk kept and Thorin's gone; a deleted actor's row isn't drawn; and a save drops the mark of an actor deleted since, of a character taken out of the campaign, a pair marked twice by hand but once, a character-type actor's, and a character's deleted from the world though still in the campaign as saved")
}

// K26. A token of dnd5e's older copy, flagged summonedCopy alone, that Thorin summoned: his constant
// companion's copy, as dnd5e still takes such a copy for the summon, and no summoned companion of his own.
{
  const { token } = await placedAt(den, 'sdo', BY_THORIN, {}, { base: steelOld })
  const list = companionList(keepwatch())
  assert.deepEqual(copyOf(steelOf(list)), ['steelOld', 'sdo', 'den', 'Scene.den.Token.sdo.Actor.steelOld', true, true], 'the older copy\'s token, its copy')
  assert.ok(!keysOf(list).includes('den-sdo'), 'no entry of its own')
  await token.delete()
  await settle(); await settle()
  ok("K26. a token of dnd5e's older copy, flagged summonedCopy alone, that Thorin summoned onto the den is his Steel Defender's copy, placed and away, with no den-sdo of its own")
}

// K27. A token of the NPC marked itself, dragged onto the arena from the Actors sidebar, with no summon
// about it: its copy, as the Gamemaster placed it.
{
  const { token } = await placedAt(arena, 'sdm', {}, {}, { base: steelDef })
  const list = companionList(keepwatch())
  assert.deepEqual(copyOf(steelOf(list)), ['steelDef', 'sdm', 'arena', 'Scene.arena.Token.sdm.Actor.steelDef', true, false], 'the token of the NPC marked, no summon about it')
  assert.ok(!keysOf(list).includes('arena-sdm'), 'no entry of its own')
  await token.delete()
  await settle(); await settle()
  ok("K27. a token of the NPC marked itself, placed on the arena with no summon about it, is its copy, placed, with no arena-sdm of its own")
}

// K28. Its only token, of dnd5e's copy that Thorin summoned, transformed in Foundry as dnd5e transforms
// an unlinked token, in its delta: not its copy, as a transformed creature is never a companion; with
// no other, the NPC itself, placed false, and no entry of its own.
{
  const shaped = { dnd5e: { ...BY_THORIN.dnd5e, isPolymorphed: true, originalActor: 'steelCopy' } }
  const token = await createToken(arena, steelCopy, { id: 'sdw', name: 'Steel Defender', delta: { flags: shaped } })
  await settle(); await settle()
  assert.ok(arena.tokens.get('sdw')?.actor?.flags?.dnd5e?.isPolymorphed, 'its creature transformed')
  const list = companionList(keepwatch())
  assert.deepEqual(copyOf(steelOf(list)), ['steelDef', null, null, 'Actor.steelDef', false, false], 'not its copy: the NPC itself')
  assert.ok(!keysOf(list).includes('arena-sdw'), 'no entry of its own')
  await token.delete()
  await settle(); await settle()
  ok("K28. its only token, of dnd5e's copy Thorin summoned, transformed in its delta, isn't its copy: the NPC itself, placed false, and no arena-sdw of its own")
}

// K29. Each copy one mark's, as the Gamemaster may mark both an NPC and dnd5e's copy of it, which the
// chooser offers both. The Steel Defender and dnd5e's copy of it marked for Thorin: a token of the copy
// is its own mark's, listed once, and the NPC marked, with no token, itself; a second token of the copy,
// the NPC's. The Hawk and dnd5e's linked copy of it Thorin summoned, both marked: with no token, each
// itself; a linked token of the copy, the copy's, the Hawk still itself. A Wild Hawk from the compendium
// the copy was made from, marked first: the copy's linked token its, by the compendium, and never the
// Hawk's copy too. The copy marked for Thorin, the Hawk for Vex, a linked token of the copy Vex
// summoned: the Hawk's, and Thorin's mark not listed while it is, its only copy the Hawk's.
{
  const marked = marks => companionList({ ...keepwatch(), constantCompanions: marks })
  const by = (list, key) => copyOf(list.find(each => each.key === key))
  const COPY = { actorId: 'steelCopy', characterId: 'thorin' }
  placeToken(arena, steelCopy, { id: 'sdt1', name: 'Steel Defender', delta: { flags: BY_THORIN } })
  let list = marked([STEEL, COPY])
  assert.deepEqual([by(list, 'steelCopy'), by(list, 'steelDef')], [['steelCopy', 'sdt1', 'arena', 'Scene.arena.Token.sdt1.Actor.steelCopy', true, false], ['steelDef', null, null, 'Actor.steelDef', false, false]],
    "a token of the copy, its own mark's; the NPC marked, with no token, itself")
  assert.deepEqual(list.filter(each => each.tokenId === 'sdt1').map(each => each.key), ['steelCopy'], 'the token listed once')
  placeToken(arena, steelCopy, { id: 'sdt2', name: 'Steel Defender', delta: { flags: BY_THORIN } })
  list = marked([STEEL, COPY])
  assert.deepEqual([by(list, 'steelCopy'), by(list, 'steelDef')], [['steelCopy', 'sdt1', 'arena', 'Scene.arena.Token.sdt1.Actor.steelCopy', true, false], ['steelCopy', 'sdt2', 'arena', 'Scene.arena.Token.sdt2.Actor.steelCopy', true, false]],
    "a second token of the copy, the NPC's")
  for (const id of ['sdt1', 'sdt2']) arena.tokens.delete(id)

  const linkedCopy = (id, origin, stats) => companionActor(id, 'Hawk', {
    linked: true, flags: { dnd5e: { isAutoImported: true, summon: { origin, activity: 'sd-summon' } } }, stats, spec: creature({ dex: 3 }),
  })
  const twin = linkedCopy('hawkTwin', 'Actor.thorin.Item.summonDragon', { duplicateSource: 'Actor.hawk', compendiumSource: 'Compendium.dnd5e.monsters.Actor.hawk' })
  const HAWK = { actorId: 'hawk', characterId: 'thorin' }
  const TWIN = { actorId: 'hawkTwin', characterId: 'thorin' }
  list = marked([HAWK, TWIN])
  assert.deepEqual([by(list, 'hawk'), by(list, 'hawkTwin')], [['hawk', null, null, 'Actor.hawk', false, false], ['hawkTwin', null, null, 'Actor.hawkTwin', false, false]],
    "with no token, each itself: dnd5e's linked copy Thorin summoned, marked, isn't the Hawk's copy too")
  placeToken(arena, twin, { id: 'hkt', actorLink: true, name: 'Hawk' })
  list = marked([HAWK, TWIN])
  assert.deepEqual([by(list, 'hawk'), by(list, 'hawkTwin')], [['hawk', null, null, 'Actor.hawk', false, false], ['hawkTwin', null, null, 'Actor.hawkTwin', true, false]],
    "its linked token, the copy's own mark's; the Hawk still itself")
  const wild = companionActor('hawkWild', 'Wild Hawk', { linked: false, stats: { compendiumSource: 'Compendium.dnd5e.monsters.Actor.hawk' }, spec: creature({ dex: 3 }) })
  list = marked([{ actorId: 'hawkWild', characterId: 'thorin' }, HAWK])
  assert.deepEqual([by(list, 'hawkWild'), by(list, 'hawk')], [['hawkTwin', null, null, 'Actor.hawkTwin', true, false], ['hawk', null, null, 'Actor.hawk', false, false]],
    "marked first, the Wild Hawk takes the copy's linked token, by the compendium it was made from; the Hawk, with no token, itself, not that copy kept for a summon")
  arena.tokens.delete('hkt')

  const vexTwin = linkedCopy('hawkVexTwin', 'Actor.vex.Item.steelDefender', { duplicateSource: 'Actor.hawk' })
  const VEX_HAWK = { actorId: 'hawk', characterId: 'vex' }
  const THORIN_TWIN = { actorId: 'hawkVexTwin', characterId: 'thorin' }
  placeToken(arena, vexTwin, { id: 'hkv', actorLink: true, name: 'Hawk' })
  list = marked([THORIN_TWIN, VEX_HAWK])
  assert.deepEqual([by(list, 'hawk'), list.find(each => each.key === 'hawkVexTwin')], [['hawkVexTwin', null, null, 'Actor.hawkVexTwin', true, false], undefined],
    "a linked token of the copy Vex summoned: the Hawk's, Vex's, and Thorin's mark of the copy not listed while it is")
  arena.tokens.delete('hkv')
  list = marked([THORIN_TWIN, VEX_HAWK])
  assert.deepEqual([by(list, 'hawk'), by(list, 'hawkVexTwin')], [['hawk', null, null, 'Actor.hawk', false, false], ['hawkVexTwin', null, null, 'Actor.hawkVexTwin', false, false]],
    "the token gone, Thorin's mark listed again, itself, and the Hawk itself")
  for (const each of [twin, wild, vexTwin]) actors.delete(each.id)
  ok("K29. each copy one mark's: a token of dnd5e's copy of the Steel Defender, both marked, the copy's own mark's, listed once, the NPC itself with no token, and a second token of the copy the NPC's; the Hawk and dnd5e's linked copy of it, both marked, each itself with no token, and a linked token of the copy the copy's, the Hawk still itself; a Wild Hawk marked first, from the compendium the copy was made from, takes the copy's linked token, and the Hawk isn't that copy too; a linked token of the copy Vex summoned is Vex's Hawk's, and Thorin's mark of the copy isn't listed while it is, and is once it's gone")
}

// K30. With no token of it on the active scene, the first scene's in Foundry's order, whichever was
// placed first: Thorin's summons of dnd5e's copy, one on the Moor, a scene after the den, then one on
// the den: the den's; the den's deleted, the Moor's.
{
  const moor = scene('kMoor')
  placeToken(moor, steelCopy, { id: 'sdm1', name: 'Steel Defender', delta: { flags: BY_THORIN } })
  placeToken(den, steelCopy, { id: 'sdd1', name: 'Steel Defender', delta: { flags: BY_THORIN } })
  assert.deepEqual(copyOf(steelOf()).slice(1, 3), ['sdd1', 'den'], "the den's, first in Foundry's order of scenes, though placed second")
  den.tokens.delete('sdd1')
  assert.deepEqual(copyOf(steelOf()).slice(1, 3), ['sdm1', 'kMoor'], "the den's gone, the Moor's")
  scenes.delete(moor.id)
  ok("K30. with no token on the active scene, a constant companion's copy is the token on the first scene in Foundry's order, the den's over the Moor's though placed after it; the den's gone, the Moor's")
}

// K31. The Steel Defender and dnd5e's copies of it for a summon, flagged as dnd5e flags them now and
// as it did, all marked for Thorin: each copy's row on the Companions tab says it's dnd5e's copy for a
// summon, as the chooser does, and its Remove button is named and tooltipped so, so that two Steel
// Defender rows are told apart, by sight and by name; the NPC's says neither. A token of the copy on
// the arena, its row names the arena so; Remove on the copy's row takes off that mark alone.
{
  const marks = ['steelDef', 'steelCopy', 'steelOld'].map(actorId => ({ actorId, characterId: 'thorin' }))
  await saveKeep({ constantCompanions: marks })
  const rowOf = (win, id) => {
    const remove = find(win, `[data-action="removeConstant"][data-actor-id="${id}"]`)
    return [find(win, `[data-constant-row="${id}"] .sending-stone-row-name > span`).textContent.trim(), find(win, `[data-constant-row="${id}"] .hint`).textContent.trim(),
      remove.getAttribute('aria-label'), remove.getAttribute('data-tooltip')]
  }
  const named = key => `${C}.${key} {"name":"Steel Defender","character":"Thorin"}`
  let win = await openTab()
  assert.deepEqual(rowsOf(win, 'thorin'), ['steelDef', 'steelCopy', 'steelOld'], 'three Steel Defender rows, in the order marked')
  assert.deepEqual(['steelDef', 'steelCopy', 'steelOld'].map(id => rowOf(win, id)), [
    ['Steel Defender', `${C}.NoToken`, named('Remove'), named('Remove')],
    ['Steel Defender', `${C}.CopyNoToken`, named('RemoveCopy'), named('RemoveCopy')],
    ['Steel Defender', `${C}.CopyNoToken`, named('RemoveCopy'), named('RemoveCopy')],
  ], "each copy's row and Remove button say it's dnd5e's copy for a summon, the older flag's too; the NPC's says neither")
  await win.close()
  const { token } = await placedAt(arena, 'sdc')
  win = await openTab()
  assert.deepEqual(['steelDef', 'steelCopy'].map(id => rowOf(win, id)[1]), [`${C}.NoToken`, `${C}.CopyOnScene {"scene":"arena"}`], "a token of the copy on the arena: the copy's row names it, dnd5e's copy, the NPC's no token")
  await click(win, '[data-action="removeConstant"][data-actor-id="steelCopy"]')
  assert.deepEqual(rowsOf(win, 'thorin'), ['steelDef', 'steelOld'], "Remove on the copy's row: that mark alone off")
  await win.close()
  await token.delete()
  await saveKeep({ constantCompanions: [STEEL] }, 'steelDef')
  ok("K31. the Steel Defender and dnd5e's copies of it, flagged isAutoImported and summonedCopy, all marked for Thorin: each copy's row says dnd5e's copy for a summon, with no token and with one on the arena, its Remove button named and tooltipped so, the NPC's row neither; Remove on the copy's row takes off that mark alone")
}

// K32. What a constant companion's copy is never, each read at once from the campaign given: a campaign
// with no marks at all, as one before 0.54.0 was; another NPC from the same compendium, marked for
// Vex, which isn't dnd5e's copy of Thorin's Steel Defender, so a second token of his isn't Vex's; a
// linked import of the compendium's own Steel Defender that Thorin summoned, which isn't the NPC's
// linked copy (dnd5e's clone of it, by its duplicateSource), so with no token the NPC is itself; a
// token of dnd5e's copy that isn't an NPC, or that has no actor, which isn't taken; a list for the
// active scene alone, which holds none unless asked; and a linked NPC's token that isn't its copy,
// as another summoned it, which makes it neither placed nor away.
{
  const marked = (...marks) => ({ ...keepwatch(), constantCompanions: [STEEL, ...marks] })
  assert.equal(constantCopies({ ...keepwatch(), constantCompanions: undefined }).size, 0, 'a campaign with no marks list: none')
  const sd2 = companionActor('kSd2', 'Steel Defender', { linked: false, stats: { compendiumSource: SD_SOURCE }, spec: steelSpec })
  placeToken(arena, steelDef, { id: 'g1', name: 'Steel Defender' })
  placeToken(arena, steelDef, { id: 'g2', name: 'Steel Defender' })
  const two = constantCopies(marked({ actorId: 'kSd2', characterId: 'vex' }))
  assert.deepEqual([two.get('steelDef')?.token?.id, two.get('kSd2')?.token ?? null, two.get('kSd2')?.actor?.id], ['g1', null, 'kSd2'],
    "two NPCs from one compendium: the second token of Thorin's isn't Vex's, whose is itself")
  for (const id of ['g1', 'g2']) arena.tokens.delete(id)
  const imported = companionActor('kSdImport', 'Steel Defender', {
    linked: true, flags: { dnd5e: { isAutoImported: true, summon: { origin: 'Actor.thorin.Item.findFamiliar', activity: 'ff-summon' } } },
    stats: { compendiumSource: SD_SOURCE }, spec: steelSpec,
  })
  assert.deepEqual(copyOf(steelOf(companionList(marked()))), ['steelDef', null, null, 'Actor.steelDef', false, false],
    "a linked import of the compendium's own that Thorin summoned, with no token: the NPC itself")
  actors.delete(imported.id)
  const odd = companionActor('kSdOdd', 'Steel Defender', { linked: false, type: 'character', flags: { dnd5e: { isAutoImported: true } }, stats: { compendiumSource: SD_SOURCE } })
  placeToken(arena, odd, { id: 'g3', name: 'Steel Defender' })
  const bare = placeToken(arena, steelCopy, { id: 'g4', name: 'Steel Defender' })
  Object.defineProperty(bare, 'actor', { configurable: true, get: () => null })
  try {
    assert.deepEqual(copyOf(steelOf(companionList(marked()))), ['steelDef', null, null, 'Actor.steelDef', false, false],
      "a token of a copy that isn't an NPC, and one with no actor: neither its copy")
  } finally {
    for (const id of ['g3', 'g4']) arena.tokens.delete(id)
    for (const each of [sd2, odd]) actors.delete(each.id)
  }
  // Read for an app that reads no scene but the active one, as the hello's first list is: none of
  // them by default, though Keepwatch's app reads 4.
  assert.deepEqual(companionList(marked(), { everywhere: false }).filter(each => each.kind === 'constant'), [],
    'the active scene alone: no constant companions by default')
  // A linked NPC marked for Thorin whose own flags say Vex summoned it: its linked token on the den
  // isn't its copy, so it's itself, not placed and not away, though its token is on another scene.
  const kite = companionActor('kKite', 'Kite', { linked: true, flags: BY_VEX, spec: creature({ dex: 3 }) })
  placeToken(den, kite, { id: 'g6', actorLink: true, name: 'Kite' })
  try {
    const kiteOf = companionList(marked({ actorId: 'kKite', characterId: 'thorin' })).find(each => each.key === 'kKite')
    assert.deepEqual(copyOf(kiteOf), ['kKite', null, null, 'Actor.kKite', false, false],
      "a linked NPC Vex summoned, marked for Thorin, its token on the den: itself, not placed, not away")
  } finally {
    den.tokens.delete('g6')
    actors.delete(kite.id)
  }
  ok("K32. a campaign with no marks list has none; another NPC from the Steel Defender's compendium marked for Vex isn't its copy, nor a second token of it Vex's; a linked import of the compendium's own that Thorin summoned isn't its linked copy; a token of a copy that isn't an NPC, or has no actor, isn't its copy; read for the active scene alone, none by default; a linked NPC Vex summoned, marked for Thorin, its token on the den: not placed, not away")
}

// K33. A hello answered that holds no companionsConstant, as no hello of 0.54.0's lacks: its
// companionsEverywhere is kept as told, so nothing is told again. Then the Companions tab with an NPC
// among Keepwatch's characters, as a campaign saved so may hold one: its box says it has no player,
// and Thorin's chooser never offers it; a drop that says it's anything but an Actor, though its uuid
// is an NPC's, and one whose uuid isn't text, are each warned and nothing kept; and an NPC marked for
// Thorin deleted while the window is open leaves it unsaved, as its mark won't be saved again.
{
  const { companionsDelivered } = await import(`${MODULE}/scripts/creature-sync.mjs`)
  const now = companionList(keepwatch())
  let at = app.events.length
  companionsDelivered(keepwatch(), { data: { companions: [], companionsEverywhere: now } })
  await settle(); await settle()
  assert.deepEqual(listed(at, 'camp-k'), [], 'no companionsConstant: its companionsEverywhere kept as told, nothing told again')
  const hireling = companionActor('kHire', 'Hireling', {})
  const kite = companionActor('kKite2', 'Kite', {})
  await saveKeep({ characters: ['thorin', 'vex', 'kHire'], constantCompanions: [STEEL, { actorId: 'kKite2', characterId: 'thorin' }] })
  const win = await openTab()
  try {
    const playersOf = character => find(win, `[data-constant-character="${character}"] .sending-stone-constant-head .hint`).textContent.trim()
    assert.deepEqual([playersOf('thorin'), playersOf('kHire')], ['Alice', 'SENDINGSTONE.Config.Players.NoOwner'], "Thorin's box names Alice; the Hireling's, who has no player, says so")
    await click(win, addButton('thorin'))
    const offered = [...win.element.querySelectorAll('[data-pick-companion]')].map(box => box.dataset.pickCompanion)
    assert.ok(offered.includes('hawk') && !offered.includes('kHire'), "Thorin's chooser never offers the Hireling, an NPC of the campaign's characters")
    await click(win, '.sending-stone-picker-footer [data-action="closeCompanionPicker"]')
    warned.length = 0
    ui.notifications.warn = message => { warned.push(message) }
    try {
      for (const data of [{ type: 'Item', uuid: 'Actor.hawk' }, { type: 'Actor', uuid: ['Actor.hawk'] }]) await drop(win, '[data-constant-drop="thorin"]', data)
    } finally {
      ui.notifications.warn = warn
    }
    assert.deepEqual([warned.map(each => String(each)), rowsOf(win, 'thorin')], [[`${C}.NotNpc`, `${C}.NotNpc`], ['steelDef', 'kKite2']],
      "dropped as an Item though its uuid is the Hawk's, and as an Actor with a uuid that isn't text: each warned, nothing kept")
    assert.equal(find(win, '[data-dirty]').dataset.dirty, 'false', 'nothing unsaved')
    actors.delete(kite.id)
    await win.render()
    assert.equal(find(win, '[data-dirty]').dataset.dirty, 'true', 'the Kite, marked for Thorin, deleted while the window is open: unsaved, as its mark won\'t be saved again')
  } finally {
    await win.close()
    actors.delete(kite.id)
    await saveKeep({ constantCompanions: [STEEL] }, 'steelDef')
    actors.delete(hireling.id)
  }
  ok("K33. a hello answered with no companionsConstant has its companionsEverywhere kept as told; an NPC among Keepwatch's characters has its box say it has no player, and Thorin's chooser never offers it; a drop as anything but an Actor, though its uuid is an NPC's, and one whose uuid isn't text, are each warned and nothing kept; an NPC marked for Thorin deleted while the window is open leaves it unsaved")
}

console.log(`companions${MIDI ? ' (Midi)' : ''}${DND5E6 ? ' (dnd5e 6)' : ''}: done, ${oks} ok`)
process.exit(0)
