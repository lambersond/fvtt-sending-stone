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
// them, slims and expands back).
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
const { AttackActivity, SaveActivity, DamageActivity, HealActivity, equip, port } = await import('./activity5e.mjs')
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
  activate, changeActor, changeBaseItem, changeDelta, combatOf, companionActor, createToken, faults, placeToken, scene, scenes,
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
ok("the hello lists Thorin's companions exactly: Brakka, owned and linked; the Hound's token, owned through its delta; the two Wolf tokens, keyed <scene>-<token>; the Bat's token, summoned by Find Familiar; and the Draconic Spirit, summoned though no player owns it: owned then summoned, each by name; never the Bat's template, nor a token of it placed by hand, the Bat on another scene, the hidden wolf, an NPC owned through its default, a character-type actor, a polymorphed Brakka or a campaign character")
assert.ok(hello.data.companions.every(each => each.of.length === 1 && each.of[0] === 'thorin'), "none is Vex's")
assert.deepEqual(companionsOf(ashlands()).map(({ entry: listedEntry }) => listedEntry.of), EXPECTED.map(() => ['thorin']))
ok("Vex's list is none: Bob owns none of them")

// The kinds a companion's command takes: the campaign's, less those only a character takes.
// Changed on purpose (round 0.36.0 §6.13): and ending a turn, the character's to do.
// Changed on purpose (round 0.36.0 §6.14): and taking one back.
const UNTAKEN = ['inspiration', 'hitDie', 'hitDice', 'spend', 'transfer', 'remove', 'note', 'endTurn', 'undoEndTurn']
assert.deepEqual(hello.data.features.companions, { kinds: hello.data.features.rolls.kinds.filter(kind => !UNTAKEN.includes(kind)), initiative: 'own' })
assert.ok(hello.data.features.companions.kinds.includes('itemDamage') && hello.data.features.companions.kinds.includes('recharge'))
assert.ok(!hello.data.features.companions.kinds.some(kind => UNTAKEN.includes(kind)))
ok("features.companions: the campaign's kinds less inspiration, hit dice, spending, moves, removals, notes, ending a turn and taking one back, and each its own initiative")

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

console.log(`companions${MIDI ? ' (Midi)' : ''}${DND5E6 ? ' (dnd5e 6)' : ''}: done, ${oks} ok`)
process.exit(0)
