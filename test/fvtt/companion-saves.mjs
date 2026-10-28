// The saves the game asks of companions (module 0.41.0, its contract §3, §4.6, §8.2.3): a save card's
// targets, a concentration card's speaker and Midi-QOL's own saves, asked of an app that answers
// `companions: 2` where they're a listed companion's, filed under its key, its token's or actor's id in
// the prompt's; answered from the app with `of`, on its live actor, as its character's player; closed by
// the companion's own save, from the app or clicked in Foundry, and `gone` as it leaves the list; sent
// again when the app first says it reads them. The real module; dnd5e 5.3.3's real dice classes, or
// 6.0.5's with DND5E6=1; companions.mjs's world on token-core.mjs (Brakka linked, two Wolf tokens of
// one base, the Bat Find Familiar summoned, the Draconic Spirit no player owns) and the Mule Thorin
// and Mira share; dnd5e's cards (dnd5e-cards.mjs), read with jsdom's parser; with MIDI=1,
// midi-fake.mjs's workflow and midi-saves.mjs's saves; a stand-in Foundry core and app. Run with
// --import ./unref-timers.mjs --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { settings, user, users, actors } from './stub.mjs'
import { DND5E5, DND5E6 as DND5E6_ROOT } from './paths.mjs'

const MODULE = process.env.MODULE_DIR
const MIDI = Boolean(process.env.MIDI)
const DND5E6 = Boolean(process.env.DND5E6)
const DND5E = DND5E6 ? `${DND5E6_ROOT}/module/dice` : `${DND5E5}/module/dice`
let oks = 0
const ok = message => { oks++; console.log('ok -', message) }

// Foundry's hooks: callAll and call run their handlers at once, as Foundry's do; once removes itself.
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
// The module's long waits, shortened a hundredfold: a card's ten minutes take six seconds, Midi's
// minute 0.6; its 250 ms settling kept as it is. A case whose steps take longer than 0.6 s while Midi
// waits shortens them less, for the waits it starts.
const realSetTimeout = globalThis.setTimeout
let shortened = 100
globalThis.setTimeout = (fn, ms = 0, ...args) => realSetTimeout(fn, ms >= 1000 ? ms / shortened : ms, ...args)
const wait = ms => new Promise(resolve => realSetTimeout(resolve, ms))
globalThis.document = { hidden: false }
// A clock the heartbeat cases move on.
let clock = 0
const realNow = Date.now
Date.now = () => realNow() + clock
// A browser's HTML parser, for the module to read dnd5e's cards with.
globalThis.DOMParser = new JSDOM('').window.DOMParser

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
  defaultAbilities: { initiative: 'dex', concentration: 'con' },
  spellcasting: { spell: { exclusive: { spells: false, slots: false } }, pact: { exclusive: { spells: false, slots: false } } },
  damageTypes: Object.fromEntries(TYPES.map(type => [type, { label: type.charAt(0).toUpperCase() + type.slice(1) }])),
  healingTypes: { healing: { label: 'Healing' } },
  actorSizes: { tiny: { label: 'Tiny' }, medium: { label: 'Medium' }, large: { label: 'Large' } },
  activityActivationTypes: { action: { label: 'Action' }, bonus: { label: 'Bonus Action' }, reaction: { label: 'Reaction' } },
  characterFlags: {},
}
CONFIG.specialStatusEffects = { CONCENTRATING: 'concentrating' }
settings.set('messageMode', 'public')
// dnd5e's default: players see the DC on their own cards and other players', never the Gamemaster's.
settings.set('challengeVisibility', 'player')
settings.set('criticalDamageModifiers', false)
settings.set('criticalDamageMaxDice', false)
globalThis._loc ??= (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key))

// Documents by uuid, as far as the cards name them: a world actor and its items; token-core.mjs adds
// what's on a scene.
globalThis.fromUuidSync = uuid => {
  const [type, id, embedded, embeddedId] = String(uuid).split('.')
  if (type !== 'Actor') return null
  const actor = actors.get(id) ?? null
  if (!embedded) return actor
  return (embedded === 'Item') ? (actor?.items?.get?.(embeddedId) ?? null) : null
}

const { Actor5e } = await import('./actor5e.mjs')
const { AttackActivity, SaveActivity, DamageActivity, HealActivity } = await import('./activity5e.mjs')
const { midi, installMidi } = await import('./midi-fake.mjs')
const {
  Character, saveCard, requestCard, midiConcentrationCard, deleteMessage, concentrationCardOf, withConcentrationChecks,
} = await import('./dnd5e-cards.mjs')
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
foundry.utils.escapeHTML ??= value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[ch])
foundry.applications.ux.TextEditor = { implementation: { async enrichHTML(html) { return String(html ?? '') } } }

const { companionActor, createToken, faults, placeToken, scene } = await import('./token-core.mjs')

// ---- The users ----
users.activeGM = user('gm', 'Gamemaster', true)
const gm = users.get('gm')
gm.active = true
gm.targets = new Set()
const alice = user('alice', 'Alice')
const bea = user('bea', 'Bea')
// Neither player is in Foundry: Midi's saves for their creatures are the Gamemaster's, held for the app.
for (const each of [alice, bea]) each.active = false

// ---- Midi-QOL ----
let saves = null
if (MIDI) {
  installMidi()
  game.modules.set('midi-qol', { active: true, version: '13.0.60' })
  saves = await import('./midi-saves.mjs')
  saves.installMidiSaves({ actorClasses: [Actor5e], concentrationClass: Character })
  // dnd5e's cards first: Midi leaves their saves to the card's buttons and its concentration to dnd5e's
  // card, until the Midi cases (13).
  Object.assign(midi.settings, { autoCheckSaves: 'none', doConcentrationCheck: 'chatOnly', requiresTargets: 'none', gmAutoFastForward: ['save'] })
}

// ---- The characters ----
const add = actor => { actors.set(actor.id, actor); return actor }
// Thorin, Alice's, who summoned the Bat and the Draconic Spirit; Mira, Bea's.
const thorin = add(new Character({ id: 'thorin', name: 'Thorin', owners: ['alice'], mods: { str: 3, dex: 2, wis: 2 } }))
alice.character = thorin
const mira = add(new Character({ id: 'mira', name: 'Mira', owners: ['bea'], mods: { dex: 1 } }))
bea.character = mira
// The goblin casting at them, no one's.
const goblin = add(new Character({ id: 'goblin', name: 'Goblin Shaman' }))
goblin.type = 'npc'
const burning = { id: 'burning', name: 'Burning Hands', img: 'burning.webp', uuid: 'Actor.goblin.Item.burning' }
goblin.items.set('burning', burning)

// ---- Scenes and companions ----
const arena = scene('arena', { active: true })
const creature = (mods = {}) => ({ mods, skills: { prc: { ability: 'wis' } }, hp: { value: 12, max: 12, temp: 0 } })
const spell = (id, name) => ({
  id, name, type: 'spell', system: { level: 1, method: 'spell', properties: [], description: { value: `<p>${name}.</p>` } },
  activities: [{ id: `${id}-use`, type: 'utility' }],
})
// Each companion checks concentration as dnd5e's actors do, its tokens' creatures too
// (dnd5e-cards.mjs's withConcentrationChecks); its concentration effects are activity5e.mjs's equip()'s.
const withConcentration = withConcentrationChecks
// Brakka, a sidekick: linked, Alice's by id, with a token on the arena her rolls are spoken by.
const brakka = withConcentration(companionActor('brakka', 'Brakka', {
  owners: ['alice'], linked: true, spec: { ...creature({ str: 3, dex: 1, con: 2 }), hp: { value: 30, max: 30, temp: 0 } },
  gear: { items: [spell('bless', 'Bless')] },
}))
const brakkaToken = placeToken(arena, brakka, { id: 'brakkaTok', name: 'Brakka', actorLink: true })
brakka.speakerToken = brakkaToken
// The Mule, linked, owned by Alice and Bea: Thorin's companion and Mira's.
withConcentration(companionActor('mule', 'Mule', { owners: ['alice', 'bea'], linked: true, spec: creature({ str: 2, con: 1 }) }))
const mule = actors.get('mule')
// A wolf, Alice's, unlinked, two of its tokens on the arena.
const wolf = withConcentration(companionActor('wolf', 'Wolf', { owners: ['alice'], linked: false, spec: creature({ str: 2, dex: 2 }) }))
const wolf1 = placeToken(arena, wolf, { id: 'wolf1', name: 'Wolf' })
const wolf2 = placeToken(arena, wolf, { id: 'wolf2', name: 'Wolf' })
// The Bat, Find Familiar's template, summoned onto the arena by Thorin.
const summoned = (item, activity) => ({ dnd5e: { summon: { origin: `Actor.thorin.Item.${item}`, activity } } })
const bat = withConcentration(companionActor('bat', 'Bat', {
  owners: ['alice'], linked: false, flags: { dnd5e: { isAutoImported: true } }, spec: { ...creature({ dex: 2 }), hp: { value: 4, max: 4, temp: 0 } },
}))
const bat1 = placeToken(arena, bat, { id: 'bat1', name: 'Bat 1', delta: { flags: summoned('findFamiliar', 'ff-summon') } })
// The Draconic Spirit, summoned by Thorin's Summon Dragon, owned by no player.
const draconic = withConcentration(companionActor('draconic', 'Draconic Spirit', {
  linked: false, spec: creature({ str: 4, con: 3 }), gear: { items: [spell('hold', 'Hold Monster')] },
}))
const spirit1 = placeToken(arena, draconic, { id: 'spirit1', name: 'Draconic Spirit', delta: { flags: summoned('summonDragon', 'sd-summon') } })
void bat

// ---- The app ----
// Every post answered with what the app takes: companions' prompts (`companions: 2`) and Midi's, unless
// a case says otherwise; each fetch with the characters open in it, for Midi's saves.
const FEATURES = { commands: true, companions: 2, midiPrompts: 1 }
const app = { events: [], polls: [], waiting: new Map(), wake: null, answers: new Map(), open: new Map(), answered: new Map(), hold: null }
const json = body => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  const id = body.campaign?.id
  if (String(url).endsWith('/api/events')) {
    // A hello held on its way, as over a slow connection, while another is queued behind it.
    if ((body.type === 'bridge.hello') && app.hold) { const held = app.hold; app.hold = null; await held }
    app.events.push(body)
    return json({ features: app.answers.get(id) ?? FEATURES })
  }
  if (String(url).endsWith('/api/bridge/commands')) {
    app.polls.push(body)
    if (!app.waiting.get(id)?.length) {
      await new Promise(resolve => {
        const timer = realSetTimeout(resolve, 30)
        app.wake = () => { clearTimeout(timer); resolve() }
        init.signal?.addEventListener('abort', resolve, { once: true })
      })
    }
    const commands = app.waiting.get(id) ?? []
    app.waiting.set(id, [])
    app.answered.set(id, (app.answered.get(id) ?? 0) + 1)
    return json({ commands, open: [...(app.open.get(id) ?? [])] })
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
const settle = (ms = 40) => wait(ms)
let ids = 0
const results = id => app.events.filter(e => (e.type === 'command.result') && (e.data.id === id)).map(e => e.data)
async function send(command, campaign = 'camp-a') {
  app.waiting.set(campaign, [...(app.waiting.get(campaign) ?? []), command])
  app.wake?.()
  await until(() => results(command.id).length, `the result of ${command.id}`)
  return results(command.id)[0]
}
const plain = { mode: 0, explicit: false, extras: [] }
/** A save from the app, as a prompt banner sends it: Thorin's unless it names whose. */
const answer = fields => send({ id: `ans-${++ids}`, actorId: 'thorin', kind: 'save', key: 'dex', ...plain, dice: [{ faces: 20, results: [14] }], ...fields })
const refusal = made => [made.status, made.reason, made.error]
const sent = (type, campaign = 'camp-a') => app.events.filter(e => (e.type === type) && (e.campaign?.id === campaign))
const opened = (campaign = 'camp-a') => sent('roll.prompt.opened', campaign).map(e => e.data.prompt)
const openedOf = (id, campaign = 'camp-a') => opened(campaign).filter(prompt => prompt.id === id)
const closed = (campaign = 'camp-a') => sent('roll.prompt.closed', campaign).map(e => e.data)
const closeOf = id => closed().find(each => each.id === id)
const helloOf = (campaign = 'camp-a') => sent('bridge.hello', campaign).at(-1)
const iso = ms => new Date(ms).toISOString()
/** Wait for the app to answer a campaign's fetch this many times more, then for the module. */
async function fetched(campaign = 'camp-a', times = 2) {
  const start = app.answered.get(campaign) ?? 0
  await until(() => (app.answered.get(campaign) ?? 0) >= start + times, `${campaign}'s fetches`)
  await settle()
}
async function setOpen(list, campaign = 'camp-a') {
  app.open.set(campaign, new Set(list))
  await fetched(campaign)
}
/** A save's card of the goblin's at these targets. */
async function saveAt(targets, options = {}) {
  const card = await saveCard({ by: goblin, item: burning, dc: 13, abilities: ['dex'], targets, ...options })
  await settle()
  return card
}
/** dnd5e's concentration card for a companion concentrating (dnd5e-cards.mjs's concentrationCardOf). */
async function concentrationCard(actor, dc) {
  const card = await concentrationCardOf(actor, { dc })
  await settle()
  return card
}
/** A card done with: deleted, as in Foundry, so its prompts close and nothing of it lingers. */
async function done(...cards) {
  for (const card of cards) await deleteMessage(card)
  await settle()
}

// ---- Start-up ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('campaignSecrets', { 'camp-a': 'a-secret', 'camp-b': 'b-secret' })
const CAMPAIGNS = [
  { id: 'camp-a', title: 'Ashlands', characters: ['thorin', 'mira'], rolls: true, prompts: true },
  { id: 'camp-b', title: 'Mirkwood', characters: ['thorin'], rolls: true, prompts: false },
]
settings.set('campaigns', CAMPAIGNS)
await Hooks.callAll('ready')
const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
const { announce } = await import(`${MODULE}/scripts/bridge.mjs`)
await until(() => (app.answered.get('camp-a') ?? 0) > 0, 'the first fetch')
await settle(300)
assert.equal(diceStatus.ready, true, `self-test: ${diceStatus.error}`)
/** A hello for Ashlands, answered as the app answers it now. */
async function hello(campaign = 'camp-a') {
  const before = sent('bridge.hello', campaign).length
  announce({ campaignId: campaign })
  await until(() => sent('bridge.hello', campaign).length > before, 'the hello')
  await settle(80)
  return helloOf(campaign)
}

assert.deepEqual(helloOf().data.companions.map(entry => [entry.key, entry.of]), [
  ['brakka', ['thorin']], ['mule', ['thorin', 'mira']], ['arena-wolf1', ['thorin']], ['arena-wolf2', ['thorin']],
  ['arena-bat1', ['thorin']], ['arena-spirit1', ['thorin']],
])
const WOLF1 = 'arena-wolf1'
const WOLF2 = 'arena-wolf2'

/* -------------------------------------------- */
/*  1. The hello and the gate                   */
/* -------------------------------------------- */

{
  const rolls = helloOf().data.features.rolls
  const keys = Object.keys(rolls)
  assert.deepEqual([rolls.prompts, rolls.companionPrompts], [true, true])
  assert.equal(keys[keys.indexOf('aloneChoices') + 1], 'companionPrompts', 'after aloneChoices')
  assert.equal(keys.at(-1), 'companionPrompts')
  assert.deepEqual([helloOf('camp-b').data.features.rolls.prompts, helloOf('camp-b').data.features.rolls.companionPrompts], [false, false], 'off where its players are asked nothing')
  // An app answering companions: 1 is asked nothing of them.
  app.answers.set('camp-a', { ...FEATURES, companions: 1 })
  await hello()
  const from = opened().length
  const card = await saveAt([wolf1.actor, wolf2.actor, brakka, thorin])
  assert.deepEqual(opened().slice(from).map(prompt => [prompt.id, prompt.actorId]), [[`${card.id}-thorin`, 'thorin']], 'Thorin alone')
  const listed = (await hello()).data.prompts
  assert.ok(listed.some(prompt => prompt.id === `${card.id}-thorin`), "the hello lists Thorin's")
  assert.ok(!listed.some(prompt => [WOLF1, WOLF2, 'brakka'].includes(prompt.actorId)), 'none of theirs')
  await done(card)
  app.answers.delete('camp-a')
  await hello()
  assert.equal(opened().length, from + 1, 'answering 2 again finds none open to send')
  ok("features.rolls.companionPrompts is true where prompts is, after aloneChoices, false where the campaign asks no saves; an app answering companions: 1 is asked no companion's save, by a card or in its hello's prompts, its characters' as ever")
}

/* -------------------------------------------- */
/*  2-5. Two wolves of one Wolf                 */
/* -------------------------------------------- */

let card = await saveAt([wolf1.actor, wolf2.actor])
{
  const two = opened().filter(prompt => prompt.messageId === card.id)
  assert.deepEqual(two, [WOLF1, WOLF2].map(key => ({
    id: `${card.id}-${key.split('-')[1]}`, actorId: key, messageId: card.id, type: 'save', abilities: ['dex'], dc: null,
    label: 'Burning Hands', openedAt: iso(card.timestamp), expiresAt: iso(card.timestamp + 600_000),
  })))
  assert.equal(openedOf(`${card.id}-thorin`).length, 0, 'Thorin not asked')
  ok("2. a save card at both wolves of one Wolf asks each, by its token's id, filed under its key, roll.prompt.opened twice; Thorin, not targeted, isn't asked")
}
{
  // 3. Wolf 1's answered from the app: on its own token's creature, as Thorin's player.
  const made = await answer({ actorId: WOLF1, of: 'thorin', prompt: `${card.id}-wolf1`, dice: [{ faces: 20, results: [14] }] })
  assert.equal(made.status, 'done', JSON.stringify(made))
  const message = messages.get(made.messageId)
  assert.equal(message.speakerActor, wolf1.actor, "Wolf 1's synthetic actor")
  assert.deepEqual([message.speaker.token, message.author.id, message.rolls[0].total, message.rolls[0].options.target], ['wolf1', 'alice', 16, 13])
  assert.deepEqual(message.flags['sending-stone'], { request: made.id, companion: WOLF1 })
  assert.equal(message.flags.dnd5e.originatingMessage, card.id)
  await settle()
  assert.deepEqual(closeOf(`${card.id}-wolf1`), { id: `${card.id}-wolf1`, reason: 'answered' })
  assert.equal(closeOf(`${card.id}-wolf2`), undefined, "Wolf 2's open")
  assert.deepEqual(refusal(await answer({ actorId: WOLF1, of: 'thorin', prompt: `${card.id}-wolf1` })), ['failed', 'prompt', 'answered'])
  // A core that gives a token's creature's speaker without its token: closed by the app's own mark.
  const again = await saveAt([wolf1.actor, wolf2.actor])
  faults.speakerNoToken = true
  const blind = await answer({ actorId: WOLF1, of: 'thorin', prompt: `${again.id}-wolf1` })
  faults.speakerNoToken = false
  assert.equal(blind.status, 'done', JSON.stringify(blind))
  assert.deepEqual([messages.get(blind.messageId).speaker.token, messages.get(blind.messageId).speaker.actor], [MIDI ? 'wolf1' : undefined, 'wolf'])
  await settle()
  assert.deepEqual([closeOf(`${again.id}-wolf1`)?.reason, closeOf(`${again.id}-wolf2`)], ['answered', undefined])
  await done(again)
  ok("3. answered from the app, of: thorin, Wolf 1's save is rolled on its own token's creature (its DEX), authored by Alice, flagged companion and request, on the card; only its prompt closes, answered; with a speaker core gives without its token, closed by the app's mark")
}
{
  // 4. Wolf 2's clicked on the card in Foundry, by the Gamemaster with Wolf 2's token selected.
  await wolf2.actor.rollSavingThrow({ ability: 'dex', target: 13 }, { configure: false }, {
    data: { flags: { dnd5e: { originatingMessage: card.id } }, speaker: ChatMessage.getSpeaker({ actor: wolf2.actor, token: wolf2 }) },
  })
  await settle()
  assert.deepEqual(closeOf(`${card.id}-wolf2`), { id: `${card.id}-wolf2`, reason: 'rolled' })
  assert.deepEqual(refusal(await answer({ actorId: WOLF2, of: 'thorin', prompt: `${card.id}-wolf2` })), ['failed', 'prompt', 'answered'])
  await done(card)
  ok('4. clicked on the card in Foundry with Wolf 2\'s token selected, its prompt closes rolled, and the app\'s answer then is refused answered')
}
{
  // 5. Another's id part.
  card = await saveAt([wolf1.actor, wolf2.actor])
  assert.deepEqual(refusal(await answer({ prompt: `${card.id}-wolf1` })), ['failed', 'prompt', 'character'], "Thorin's own seat")
  assert.deepEqual(refusal(await answer({ actorId: WOLF2, of: 'thorin', prompt: `${card.id}-wolf1` })), ['failed', 'prompt', 'character'], "Wolf 2's seat")
  assert.deepEqual([closeOf(`${card.id}-wolf1`), closeOf(`${card.id}-wolf2`)], [undefined, undefined], 'both still open')
  await done(card)
  ok("5. Wolf 1's prompt answered from Thorin's own seat, or from Wolf 2's, is refused prompt, character, and stays open")
}

/* -------------------------------------------- */
/*  6. Brakka, linked                           */
/* -------------------------------------------- */

{
  card = await saveAt([brakka])
  assert.deepEqual(openedOf(`${card.id}-brakka`).map(prompt => [prompt.actorId, prompt.type]), [['brakka', 'save']])
  const made = await answer({ actorId: 'brakka', of: 'thorin', prompt: `${card.id}-brakka` })
  assert.equal(made.status, 'done', JSON.stringify(made))
  assert.deepEqual([messages.get(made.messageId).speakerActor, messages.get(made.messageId).author.id], [brakka, 'alice'])
  await settle()
  assert.deepEqual(closeOf(`${card.id}-brakka`), { id: `${card.id}-brakka`, reason: 'answered' })
  await done(card)
  // Her concentration card, whispered to her owners, asked; ended from the app, closed gone.
  const effect = await brakka.beginConcentrating({ id: 'bless-use', item: brakka.items.get('bless') })
  const asked = await concentrationCard(brakka, 12)
  const [prompt] = openedOf(`${asked.id}-brakka`)
  assert.deepEqual(prompt, {
    id: `${asked.id}-brakka`, actorId: 'brakka', messageId: asked.id, type: 'concentration', abilities: ['con'], dc: null,
    label: 'Bless', openedAt: iso(asked.timestamp), expiresAt: iso(asked.timestamp + 600_000),
  })
  const ended = await send({ id: `end-${++ids}`, actorId: 'brakka', of: 'thorin', kind: 'endConcentration', concentration: { effect: effect.id }, ...plain, dice: [] })
  assert.equal(ended.status, 'done', JSON.stringify(ended))
  await settle()
  assert.deepEqual(closeOf(prompt.id), { id: prompt.id, reason: 'gone' })
  await done(asked)
  ok("6. Brakka, linked: a save card's prompt is <card>-brakka, filed under brakka, answered on her own actor as Alice; her concentration card asks her, its ability her own; ended from the app, of: thorin, it closes gone")
}

/* -------------------------------------------- */
/*  7. The Spirit no player owns                */
/* -------------------------------------------- */

{
  settings.set('challengeVisibility', 'all')
  const spirit = spirit1.actor
  const effect = await spirit.beginConcentrating({ id: 'hold-use', item: spirit.items.get('hold') })
  const asked = await concentrationCard(spirit, 12)
  assert.deepEqual(asked.whisper, ['gm'], 'whispered to the Gamemaster alone')
  const [prompt] = openedOf(`${asked.id}-spirit1`)
  assert.deepEqual([prompt?.actorId, prompt?.type, prompt?.abilities, prompt?.dc, prompt?.label], ['arena-spirit1', 'concentration', ['con'], 12, 'Hold Monster'])
  const made = await answer({ actorId: 'arena-spirit1', of: 'thorin', key: 'con', prompt: prompt.id, dice: [{ faces: 20, results: [15] }] })
  assert.equal(made.status, 'done', JSON.stringify(made))
  const message = messages.get(made.messageId)
  assert.deepEqual([message.speakerActor, message.author.id, message.rolls[0].total, message.flags['sending-stone'].companion], [spirit, 'alice', 21, 'arena-spirit1'])
  await settle()
  assert.equal(closeOf(prompt.id)?.reason, 'answered')
  // Asked again, and its concentration ended from the app: a token's creature's, by its key, closed gone.
  const again = await concentrationCard(spirit, 10)
  assert.equal(openedOf(`${again.id}-spirit1`).length, 1)
  const ended = await send({ id: `end-${++ids}`, actorId: 'arena-spirit1', of: 'thorin', kind: 'endConcentration', concentration: { effect: effect.id }, ...plain, dice: [] })
  assert.equal(ended.status, 'done', JSON.stringify(ended))
  await settle()
  assert.deepEqual(closeOf(`${again.id}-spirit1`), { id: `${again.id}-spirit1`, reason: 'gone' })
  settings.set('challengeVisibility', 'player')
  await done(asked, again)
  ok("7. the Draconic Spirit's concentration card, whispered to the Gamemaster alone, asks it under its key, its DC as Challenge Visibility says; answered, its check is authored by Alice, Thorin's player; its concentration ended from the app closes the next card's gone")
}

/* -------------------------------------------- */
/*  8. A Gamemaster's request in chat           */
/* -------------------------------------------- */

{
  const from = opened().length
  card = await requestCard({ abilities: ['dex'], dc: 13 })
  await settle()
  assert.deepEqual(opened().slice(from).map(prompt => prompt.actorId), ['thorin', 'mira'])
  await done(card)
  ok("8. a Gamemaster's request for a save in chat asks the characters, Thorin and Mira, and no companion")
}

/* -------------------------------------------- */
/*  9. Leaving the list                         */
/* -------------------------------------------- */

{
  card = await saveAt([wolf2.actor])
  const id = `${card.id}-wolf2`
  assert.equal(openedOf(id).length, 1)
  const from = app.events.length
  await wolf2.delete()
  await until(() => closeOf(id), "Wolf 2's prompt to close")
  const order = app.events.slice(from).filter(e => e.campaign?.id === 'camp-a').map(e => e.type)
  assert.ok(order.indexOf('companions.listed') < order.indexOf('roll.prompt.closed'), 'at the list\'s comparison')
  assert.ok(!sent('companions.listed').at(-1).data.companions.some(entry => entry.key === WOLF2))
  assert.deepEqual(closeOf(id), { id, reason: 'gone' })
  assert.deepEqual(refusal(await answer({ actorId: WOLF2, of: 'thorin', prompt: id })), ['failed', 'unknown', null], 'a late answer')
  await done(card)
  ok("9. Wolf 2's token deleted while it's asked: its prompt closes gone as the list is compared, and a late answer is refused unknown")
}

/* -------------------------------------------- */
/*  10. The hello's list                        */
/* -------------------------------------------- */

{
  card = await saveAt([wolf1.actor, brakka])
  const made = await answer({ actorId: 'brakka', of: 'thorin', prompt: `${card.id}-brakka` })
  assert.equal(made.status, 'done', JSON.stringify(made))
  const listed = (await hello()).data.prompts
  assert.deepEqual(listed.filter(prompt => prompt.messageId === card.id).map(prompt => [prompt.id, prompt.actorId]), [[`${card.id}-wolf1`, WOLF1]])
  await done(card)
  // A token's creature answered is left out too, found answered by its prompt's part, its token's id,
  // which is not its key, as Brakka's is.
  const lone = await saveAt([wolf1.actor])
  const theirs = await answer({ actorId: WOLF1, of: 'thorin', prompt: `${lone.id}-wolf1` })
  assert.equal(theirs.status, 'done', JSON.stringify(theirs))
  assert.deepEqual((await hello()).data.prompts.filter(prompt => prompt.messageId === lone.id), [], "Wolf 1's answered prompt not listed")
  await done(lone)
  ok("10. a hello after a reconnect lists the companions' prompts open, Wolf 1's, and not one answered, Brakka's, nor Wolf 1's once answered, by its token's id")
}

/* -------------------------------------------- */
/*  11. Every reader                            */
/* -------------------------------------------- */

{
  const alone = await saveAt([mule], { whisper: ['alice'] })
  assert.equal(opened().filter(prompt => prompt.messageId === alone.id).length, 0, 'only Alice reads it: not asked')
  const both = await saveAt([mule, mule], { whisper: ['alice', 'bea'] })
  assert.deepEqual(opened().filter(prompt => prompt.messageId === both.id).map(prompt => [prompt.id, prompt.actorId]), [[`${both.id}-mule`, 'mule']])
  await done(alone, both)
  ok("11. a save card at the Mule, Thorin's and Mira's, asks it only where both their players read it, and then once, under mule")
}

/* -------------------------------------------- */
/*  12. A reload                                */
/* -------------------------------------------- */

/** The module's readers cleared, as a reload leaves them: a hello answered with nothing of companions. */
async function forgotten() {
  app.answers.set('camp-a', { commands: true, midiPrompts: 1 })
  await hello()
  app.answers.delete('camp-a')
}
/** A heartbeat to every campaign, the clock moved on past its half minute. */
async function heartbeatNow() {
  clock += 31_000
  const before = sent('bridge.heartbeat').length
  heartbeat()
  await until(() => sent('bridge.heartbeat').length > before, 'the heartbeat')
  await settle(80)
}
const { heartbeat } = await import(`${MODULE}/scripts/heartbeat.mjs`)
{
  card = await saveAt([wolf1.actor])
  const id = `${card.id}-wolf1`
  assert.equal(openedOf(id).length, 1)
  await forgotten()
  const fresh = await hello()
  assert.ok(!fresh.data.prompts.some(prompt => prompt.id === id), "the hello built before its answer leaves Wolf 1's out")
  await until(() => openedOf(id).length === 2, "Wolf 1's prompt again")
  const [after] = sent('roll.prompt.opened').filter(e => e.data.prompt.id === id).slice(-1)
  assert.ok(after.sequence > fresh.sequence, 'after the hello')
  assert.deepEqual(after.data.prompt, openedOf(id)[0])
  ok("12. after the module's readers are cleared, as by a reload, a hello leaves a companion's open prompt out; its answer, companions: 2, sends it again, after the hello")

  // Two hellos on their way at once, both built before the answer: followed once the second's delivered.
  await forgotten()
  let release
  app.hold = new Promise(resolve => { release = resolve })
  const before = sent('bridge.hello').length
  announce({ campaignId: 'camp-a' })
  await settle()
  announce({ campaignId: 'camp-a' })
  release()
  await until(() => sent('bridge.hello').length >= before + 2, 'both hellos')
  await settle(120)
  const second = helloOf()
  assert.ok(!second.data.prompts.some(prompt => prompt.id === id), 'the second hello, built before the answer, leaves it out too')
  await until(() => openedOf(id).length === 3, "Wolf 1's prompt again, after the second hello")
  assert.ok(sent('roll.prompt.opened').filter(e => e.data.prompt.id === id).at(-1).sequence > second.sequence)
  ok('12. with a second hello built before the answer still on its way, the prompt follows that hello once it is delivered')

  // An app deployed mid-session, its answer to a heartbeat rising from 1 to 2.
  app.answers.set('camp-a', { ...FEATURES, companions: 1 })
  await hello()
  const late = await saveAt([wolf1.actor])
  const lateId = `${late.id}-wolf1`
  assert.equal(openedOf(lateId).length, 0, 'not asked of an app answering 1')
  app.answers.delete('camp-a')
  await heartbeatNow()
  assert.equal(openedOf(lateId).length, 1, 'sent once its heartbeat\'s answer says 2')
  ok("12. an app whose heartbeat's answer first says 2, as one deployed mid-session, is sent the companions' prompts open now")

  // A later answer of 2, to a heartbeat or a hello, sends nothing again.
  const count = opened().length
  await heartbeatNow()
  await hello()
  assert.equal(opened().length, count, 'a later answer of 2 sends nothing again')
  await done(card, late)
  ok('12. a later answer of 2, to a heartbeat or a hello, sends nothing again')
}

/* -------------------------------------------- */
/*  13. Midi-QOL's own saves                    */
/* -------------------------------------------- */

if (MIDI) {
  const { midiSaves, saveWorkflow, runSaves, saveActivity, overTimeTurn } = saves
  // Midi checks saves, showing them, so an answer's roll makes a message; and asks concentration on its own card.
  Object.assign(midi.settings, { autoCheckSaves: 'allShow', doConcentrationCheck: 'chat' })
  let spells = 0
  const hold = target => {
    const slug = `spell${++spells}`
    const item = { id: slug, name: 'Hold Person', type: 'spell', uuid: `Actor.goblin.Item.${slug}`, flags: {}, system: { description: { value: '' } } }
    return saveWorkflow({ actor: goblin, item, activity: saveActivity({ item, abilities: ['dex'], dc: 14 }), targets: [target] })
  }
  const nextPrompt = async count => {
    await until(() => opened().length > count, 'a prompt to open')
    return opened()[count]
  }

  // Wolf 1's save while Thorin is open: asked, waiting; answered as Alice, Midi's roll.
  await setOpen(['thorin'])
  let count = opened().length
  let queued = midiSaves.queued.length
  let workflow = await hold(wolf1.object)
  let running = runSaves(workflow)
  let prompt = await nextPrompt(count)
  assert.match(prompt.id, /^[A-Za-z0-9]{1,64}-wolf1$/)
  assert.deepEqual([prompt.actorId, prompt.type, prompt.source, prompt.abilities, prompt.askedInFoundry], [WOLF1, 'save', 'midi', ['dex'], false])
  await settle(60)
  assert.equal(midiSaves.queued.length, queued, "Midi's own request waits on the app")
  let made = await answer({ actorId: WOLF1, of: 'thorin', prompt: prompt.id, dice: [{ faces: 20, results: [16] }] })
  await running
  assert.equal(made.status, 'done', JSON.stringify(made))
  let message = messages.get(made.messageId)
  assert.deepEqual([message.speakerActor, message.speaker.token, message.author.id, message.flags['sending-stone'].companion], [wolf1.actor, 'wolf1', 'alice', WOLF1])
  const processed = midiSaves.processed.find(each => each.workflow === workflow)
  assert.deepEqual(processed.results[0][0].dice[0].results.map(result => result.result), [16])
  assert.deepEqual([workflow.saves.has(wolf1.object), midiSaves.queued.length], [true, queued])
  assert.deepEqual(closeOf(prompt.id), { id: prompt.id, reason: 'answered' })
  ok("13. Midi's save of Wolf 1 while Thorin is open: asked under arena-wolf1, <key>-wolf1, Midi's own way waiting; answered, rolled on Wolf 1 as Alice, Midi takes the roll")

  // Thorin not open: Midi's own way at once.
  await setOpen([])
  count = opened().length
  queued = midiSaves.queued.length
  workflow = await hold(wolf1.object)
  running = runSaves(workflow)
  await settle()
  assert.deepEqual([midiSaves.queued.length, opened().length], [queued + 1, count])
  await running
  // Thorin closing while it waits: left to Midi.
  await setOpen(['thorin'])
  count = opened().length
  queued = midiSaves.queued.length
  workflow = await hold(wolf1.object)
  running = runSaves(workflow)
  prompt = await nextPrompt(count)
  await setOpen([])
  await until(() => closeOf(prompt.id), 'the prompt released')
  assert.deepEqual(closeOf(prompt.id), { id: prompt.id, reason: 'expired' })
  await running
  assert.equal(midiSaves.queued.length, queued + 1, "Midi's own request, once released")
  ok("13. with no character of Wolf 1's open Midi asks its own way at once; Thorin's page closing while it waits releases it to Midi")

  // The Bat's OverTime turn save.
  await setOpen(['thorin'])
  count = opened().length
  const poison = { id: 'poison', name: 'Poisoned', uuid: `${bat1.actor.uuid}.ActiveEffect.poison`, changes: [{ key: 'flags.midi-qol.OverTime', value: 'turn=start, saveAbility=con, saveDC=12, label=Poison' }] }
  running = overTimeTurn(bat1.actor, bat1.object, poison)
  prompt = await nextPrompt(count)
  assert.match(prompt.id, /^[A-Za-z0-9]{1,64}-bat1$/)
  assert.deepEqual([prompt.actorId, prompt.source, prompt.abilities], ['arena-bat1', 'overtime', ['con']])
  made = await answer({ actorId: 'arena-bat1', of: 'thorin', key: 'con', prompt: prompt.id, dice: [{ faces: 20, results: [1] }] })
  await running
  assert.equal(made.status, 'done', JSON.stringify(made))
  // Brakka's concentration on Midi's own card, spoken by her token.
  count = opened().length
  await brakka.beginConcentrating({ id: 'bless-use', item: brakka.items.get('bless') })
  const midiCard = await midiConcentrationCard(brakka, 11)
  assert.equal(midiCard.speaker.token, 'brakkaTok')
  prompt = await nextPrompt(count)
  assert.match(prompt.id, /^[A-Za-z0-9]{1,64}-brakka$/)
  assert.deepEqual([prompt.actorId, prompt.type, prompt.source, prompt.messageId], ['brakka', 'concentration', 'concentration', midiCard.id])
  made = await answer({ actorId: 'brakka', of: 'thorin', key: 'con', prompt: prompt.id, dice: [{ faces: 20, results: [15] }] })
  assert.equal(made.status, 'done', JSON.stringify(made))
  assert.deepEqual([messages.get(made.messageId).author.id, messages.get(made.messageId).speakerActor], ['alice', brakka])
  ok("13. the Bat's OverTime turn save is asked under arena-bat1, and Midi's concentration card spoken by Brakka's token under brakka, each answered from the app")

  // The Spirit's Midi save, answered as Thorin's player though no player owns it.
  count = opened().length
  workflow = await hold(spirit1.object)
  running = runSaves(workflow)
  prompt = await nextPrompt(count)
  assert.deepEqual([prompt.actorId, prompt.id.split('-')[1]], ['arena-spirit1', 'spirit1'])
  made = await answer({ actorId: 'arena-spirit1', of: 'thorin', prompt: prompt.id, dice: [{ faces: 20, results: [12] }] })
  await running
  message = messages.get(made.messageId)
  assert.deepEqual([made.status, message.author.id, message.speakerActor], ['done', 'alice', spirit1.actor])
  await setOpen([])
  ok("13. the Draconic Spirit's Midi save, which no player owns, is answered as Alice, Thorin's player")

  // An app answering companions: 1, as 0.40's does, is asked no companion's Midi save, though Thorin
  // is open: Midi takes it its own way at once, never held for an app that can't answer it.
  app.answers.set('camp-a', { ...FEATURES, companions: 1 })
  await hello()
  await setOpen(['thorin'])
  count = opened().length
  queued = midiSaves.queued.length
  workflow = await hold(wolf1.object)
  running = runSaves(workflow)
  await until(() => midiSaves.queued.length > queued, "Midi's own request")
  await running
  assert.deepEqual([opened().length, midiSaves.queued.length], [count, queued + 1], 'no prompt sent, Midi its own way')
  app.answers.delete('camp-a')
  await hello()
  ok("13. an app answering companions: 1 is asked no companion's Midi save while Thorin is open, and Midi takes it its own way at once")

  // The cases below wait on Midi longer than its minute shortened a hundredfold, so it's shortened
  // tenfold for them: six seconds.
  shortened = 10
  // Wolf 3 leaving the list while Midi waits on the app for its save: closed gone and released to
  // Midi at once, never held for Midi's minute on a token that's gone.
  const wolf3 = await createToken(arena, wolf, { id: 'wolf3', name: 'Wolf' })
  await until(() => sent('companions.listed').at(-1)?.data.companions.some(entry => entry.key === 'arena-wolf3'), 'Wolf 3 listed')
  await setOpen(['thorin'])
  count = opened().length
  queued = midiSaves.queued.length
  workflow = await hold(wolf3.object)
  running = runSaves(workflow)
  prompt = await nextPrompt(count)
  assert.deepEqual([prompt.actorId, prompt.source], ['arena-wolf3', 'midi'])
  await settle(60)
  assert.equal(midiSaves.queued.length, queued, "Midi's own request waits on the app")
  await wolf3.delete()
  await until(() => closeOf(prompt.id), "Wolf 3's Midi prompt to close", 3000)
  assert.deepEqual(closeOf(prompt.id), { id: prompt.id, reason: 'gone' })
  await until(() => midiSaves.queued.length > queued, "Midi's own request, once released", 3000)
  await running
  ok("13. Wolf 3's token deleted while Midi waits on the app for its save: its prompt closes gone at once, and Midi takes it its own way")

  // The module's readers cleared, as by a reload, while Midi waits on the app for Wolf 1's save: a
  // hello built before the answer leaves it out; the answer, companions: 2, sends it again; and the
  // app's answer to it is still the roll Midi takes.
  count = opened().length
  workflow = await hold(wolf1.object)
  running = runSaves(workflow)
  prompt = await nextPrompt(count)
  await forgotten()
  const fresh = await hello()
  assert.ok(!fresh.data.prompts.some(each => each.id === prompt.id), 'left out of the hello built before its answer')
  await until(() => openedOf(prompt.id).length === 2, "Wolf 1's Midi prompt sent again")
  assert.ok(sent('roll.prompt.opened').filter(e => e.data.prompt.id === prompt.id).at(-1).sequence > fresh.sequence, 'after the hello')
  made = await answer({ actorId: WOLF1, of: 'thorin', prompt: prompt.id, dice: [{ faces: 20, results: [13] }] })
  await running
  assert.equal(made.status, 'done', JSON.stringify(made))
  const taken = midiSaves.processed.find(each => each.workflow === workflow)
  assert.deepEqual(taken.results[0][0].dice[0].results.map(result => result.result), [13], "the app's roll, Midi's")
  await setOpen([])
  shortened = 100
  ok("13. with the module's readers cleared while Midi waits on the app for Wolf 1's save, a hello built before the answer leaves it out, the answer companions: 2 sends it again after the hello, and the app's answer is Midi's roll")
}

console.log(`companion-saves${MIDI ? ' (Midi)' : ''}${DND5E6 ? ' (dnd5e 6)' : ''}: done, ${oks} ok`)
process.exit(0)
