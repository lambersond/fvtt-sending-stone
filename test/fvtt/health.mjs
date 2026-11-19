// Other creatures' health in the app (module 0.50.0, the app's ROADMAP item 58): the hello's
// `features.health` by the campaign's two switches; how hurt a creature is, run beside dnd5e's own
// `updateBloodied`, read from 5.3.3's or with DND5E6=1 6.0.5's actor.mjs by its lines; who is shown
// it, and who never is, under dnd5e only; its hit points with the second switch; the watch that
// sends a combatant again 250 ms after its hit points, health or defeat change between combat
// events, the party's too, by every hook that can change them (an actor, its delta, its token's
// delta, disposition, hiding, link and actor, an effect made, changed or deleted), once for a burst
// however long, as it settles, and each fight waiting on its own; a combat sent afresh on an app's
// first answer that reads it, and described anew by the hello as the switches are saved mid-fight;
// two campaigns; where the watch sends nothing (combat events off, a client that isn't the bridge,
// a fight its campaign isn't told of or no longer in, a combatant hidden mid-fight); the campaign's
// settings rows; and an older app sent exactly what it was before, as an answer saying health in
// any other form than a format number is. The real module on stub.mjs's Foundry, with a stand-in
// app that answers each post with the features it reads, and plain tokens as scenario.mjs makes
// them. Run with --import ./unref-timers.mjs --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { actor, combat, combatant, combats, settings, user, users } from './stub.mjs'
import { DND5E5, DND5E6 as DND5E6_ROOT } from './paths.mjs'

const MODULE = process.env.MODULE_DIR
const DND5E6 = Boolean(process.env.DND5E6)
let oks = 0
const ok = message => { oks++; console.log('ok -', message) }
if (DND5E6) game.system.version = '6.0.5'
// dnd5e's Bloodied threshold, as each release's configuration has it: a fraction in 5, a percent in 6.
CONFIG.DND5E = { bloodied: { threshold: DND5E6 ? 50 : 0.5 } }

// The module's own words, as Foundry's i18n gives them.
const flat = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) => (typeof value === 'object')
  ? flat(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]])
const words = Object.fromEntries(flat(JSON.parse(readFileSync(`${MODULE}/lang/en.json`, 'utf8'))))
game.i18n.localize = key => words[key] ?? key

// A clock the heartbeats are sent by.
let clock = 0
const realNow = Date.now
Date.now = () => realNow() + clock
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const settle = () => wait(30)
// Past the watch's 250 ms and the posts after it.
const settled = () => wait(420)

// ---- The app: every post taken, each answered with the features its campaign's app reads ----
const app = { events: [], answers: {} }
const json = body => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  app.events.push(body)
  return json({ features: app.answers[body.campaign?.id] ?? {} })
}
const ofType = (events, type, campaign = 'camp-a') => events.filter(e => (e.type === type) && (e.campaign?.id === campaign))
const helloOf = (campaign = 'camp-a') => ofType(app.events, 'bridge.hello', campaign).at(-1)
const updates = (from, campaign = 'camp-a') => ofType(app.events.slice(from), 'combat.combatant.updated', campaign)
const created = (from, campaign = 'camp-a') => ofType(app.events.slice(from), 'combat.created', campaign)
const byId = list => Object.fromEntries(list.map(each => [each.id, each]))

// ---- The table ----
users.activeGM = user('gm', 'Gamemaster', true)
user('alice', 'Alice'); user('bob', 'Bob'); user('carol', 'Carol')
/** A creature's hit points as dnd5e prepares them, with dnd5e 6's own Bloodied percent. */
const hpOf = (max, more = {}) => ({ value: max, max, effectiveMax: max, temp: 0, ...(DND5E6 && { bloodied: 50 }), ...more })
const creature = (id, name, max, owners = []) => {
  const made = actor(id, name, owners, 'npc', hpOf(max))
  made.documentName = 'Actor'
  return made
}
const thorin = actor('thorin', 'Thorin', ['alice'], 'character', hpOf(30))
thorin.documentName = 'Actor'
const vex = actor('vex', 'Vex', ['bob'], 'character', hpOf(30))
const goblin = creature('goblin', 'Goblin', 10)
const ogre = creature('ogre', 'Ogre', 59)
const wolf = creature('wolf', 'Wolf', 11)
// An unlinked token's creature: a synthetic actor with its base's id, as core makes one.
creature('kobold', 'Kobold', 6)
const kobold = { id: 'kobold', name: 'Kobold', isToken: true, hasPlayerOwner: false, documentName: 'Actor', system: { attributes: { hp: hpOf(6) } } }
const token = (id, disposition, more = {}) => ({ id, disposition, hidden: false, ...more })
const tokens = {
  goblin: token('t-gob', CONST.TOKEN_DISPOSITIONS.HOSTILE, { actor: goblin }),
  ogre: token('t-ogre', CONST.TOKEN_DISPOSITIONS.NEUTRAL, { actor: ogre }),
  wolf: token('t-wolf', CONST.TOKEN_DISPOSITIONS.FRIENDLY, { actor: wolf }),
  kobold: token('t-kob', CONST.TOKEN_DISPOSITIONS.HOSTILE, { actor: kobold, actorLink: false }),
  thorin: token('t-thorin', CONST.TOKEN_DISPOSITIONS.FRIENDLY, { actor: thorin }),
  vex: token('t-vex', CONST.TOKEN_DISPOSITIONS.FRIENDLY, { actor: vex }),
}

await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('combatEvents', true)
// Two campaigns saved before 0.50.0: neither has the keys.
settings.set('campaigns', [
  { id: 'camp-a', title: 'Erebor', characters: ['thorin'] },
  { id: 'camp-b', title: 'Mirkwood', characters: ['vex'] },
])
await Hooks.callAll('ready')
await settle()

const { getCampaigns } = await import(`${MODULE}/scripts/campaigns.mjs`)
const { healthChanges, snapshotCombat, registerCombatantCompanion } = await import(`${MODULE}/scripts/combat-data.mjs`)
const { combatantCompanion } = await import(`${MODULE}/scripts/creature-sync.mjs`)
const { healthOf, isHealthShown, noteHealthReader } = await import(`${MODULE}/scripts/creature-health.mjs`)
const { foundrySettings } = await import(`${MODULE}/scripts/foundry-settings.mjs`)
const { heartbeat } = await import(`${MODULE}/scripts/heartbeat.mjs`)
const { announce } = await import(`${MODULE}/scripts/bridge.mjs`)
const campaignA = () => getCampaigns().find(c => c.id === 'camp-a')
/** Save the campaigns with these switches, which says the hello again, as the settings window does. */
async function switches(a, b = {}) {
  const stored = settings.get('campaigns')
  await game.settings.set('sending-stone', 'campaigns', stored.map(c => ({ ...c, ...((c.id === 'camp-a') ? a : b) })))
  await settle()
}
/** A heartbeat to each campaign, as one sent nothing for 30 s gets; its answer read. */
async function beat() {
  clock += 31_000
  heartbeat()
  await settle()
}
/** Set a creature's hit points, heard as the given hook tells it. */
async function hitPointsTo(who, value, hook = 'updateActor', subject = who) {
  who.system.attributes.hp.value = value
  await Hooks.callAll(hook, subject, (hook === 'updateToken') ? { delta: { system: { attributes: { hp: { value } } } } } : { system: { attributes: { hp: { value } } } })
}

// ---- H2: the hello ----
{
  const features = helloOf().data.features
  assert.deepEqual(Object.keys(features).slice(-3), ['hitPoints', 'coins', 'health'], 'last, after coins')
  assert.deepEqual(features.health, { enabled: false, reason: 'off', hitPoints: false }, 'off for a campaign saved without the keys')
  await switches({ health: true })
  assert.deepEqual(helloOf().data.features.health, { enabled: true, reason: null, hitPoints: false }, 'on, without hit points')
  assert.deepEqual(helloOf('camp-b').data.features.health, { enabled: false, reason: 'off', hitPoints: false }, "the other campaign's off")
  await switches({ health: true, healthHitPoints: true })
  assert.deepEqual(helloOf().data.features.health, { enabled: true, reason: null, hitPoints: true }, 'on, with hit points')
  game.system.id = 'pf2e'
  announce()
  await settle()
  assert.deepEqual(helloOf().data.features.health, { enabled: false, reason: 'system', hitPoints: false }, 'under another system')
  assert.deepEqual(helloOf('camp-b').data.features.health, { enabled: false, reason: 'off', hitPoints: false }, 'off says so before the system')
  game.system.id = 'dnd5e'
  await switches({ health: false, healthHitPoints: true })
  assert.deepEqual(helloOf().data.features.health, { enabled: false, reason: 'off', hitPoints: false }, 'the second switch counts for nothing while the first is off')
  ok("H2: the hello's features end with health: off for a campaign saved without the switches, on with and without hit points, off before the system, and the system under another")
}

// ---- H11: the campaign's settings rows ----
{
  const rows = () => foundrySettings(campaignA()).sections.find(section => section.id === 'campaign').rows
  const row = id => rows().find(each => each.id === id)
  await switches({ health: false, healthHitPoints: false })
  assert.deepEqual(rows().map(each => each.id).slice(-4), ['companionInitiative', 'health', 'healthHitPoints', 'groups'])
  assert.deepEqual(row('health'), { id: 'health', label: "Allow Players to see other creatures' health in the app", value: false, text: 'Off' })
  assert.deepEqual(row('healthHitPoints'), { id: 'healthHitPoints', label: 'Show their hit points too', value: false, text: 'Off' })
  await switches({ health: true, healthHitPoints: true })
  assert.deepEqual([row('health').text, row('healthHitPoints').text], ['On', 'On'])
  game.system.id = 'pf2e'
  assert.equal(row('health').note, words['SENDINGSTONE.Config.Actions.RollsReason.system'], 'its note under another system')
  assert.equal(Object.hasOwn(row('healthHitPoints'), 'note'), false, 'none on the second')
  game.system.id = 'dnd5e'
  assert.equal(Object.hasOwn(row('health'), 'note'), false, 'none under dnd5e')
  ok("H11: the campaign's settings rows gain health and healthHitPoints after companions' initiative, labelled, On or Off, the first with a note under another system")
}

// ---- H3: the bands, beside dnd5e's own updateBloodied ----
{
  const D = DND5E6 ? DND5E6_ROOT : DND5E5
  const [first, last] = DND5E6 ? [3624, 3640] : [3535, 3552]
  const lines = readFileSync(`${D}/module/documents/actor/actor.mjs`, 'utf8').split('\n').slice(first - 1, last)
  assert.match(lines[0], /^\s*updateBloodied\(options\) \{/, `dnd5e's updateBloodied at ${first}`)
  const made = []
  const Bloodied = new Function('ActiveEffect5e', 'ActiveEffect', 'CONFIG', 'game', 'dnd5e', '_loc', 'CONST', `return class { ${lines.join('\n')} }`)(
    { ID: { BLOODIED: 'bloodied' } }, { implementation: { create: data => { made.push(data); return data } } },
    { DND5E: { bloodied: { threshold: CONFIG.DND5E.bloodied.threshold, name: 'Bloodied', img: '' } } },
    { settings: { get: () => 'player' }, i18n: { localize: key => key } }, { settings: { bloodied: 'player' } }, key => key, { ACTIVE_EFFECT_SHOW_ICON: {} })
  const dnd5eSays = hp => {
    const subject = new Bloodied()
    subject.system = { attributes: { hp }, isCreature: true }
    subject.effects = new Map()
    made.length = 0
    subject.updateBloodied({})
    return made.length > 0
  }
  let rows = 0
  for (const max of [1, 2, 3, 7, 10, 11, 59, 100]) {
    for (let value = 1; value <= max; value++) {
      for (const bloodied of DND5E6 ? [25, 50, 75] : [50]) {
        const hp = { value, max, effectiveMax: max, temp: 0, pct: (value / max) * 100, ...(DND5E6 && { bloodied }) }
        const said = healthOf({ system: { attributes: { hp } } })
        assert.equal(said === 'bloodied', dnd5eSays(hp), `${value}/${max}${DND5E6 ? ` at ${bloodied}%` : ''}: ${said}`)
        assert.equal(said, (value >= max) ? 'unhurt' : (dnd5eSays(hp) ? 'bloodied' : 'hurt'))
        rows++
      }
    }
  }
  assert.equal(rows, DND5E6 ? 579 : 193)
  const of = hp => healthOf({ system: { attributes: { hp } } })
  assert.equal(of(hpOf(10, { value: 0 })), 'down')
  assert.equal(of(hpOf(10, { value: -3 })), 'down', 'below 0, down')
  assert.equal(of({ value: 5, max: null, effectiveMax: undefined, temp: 0 }), null, 'no maximum')
  assert.equal(of({ value: 5, max: 0, effectiveMax: 0, temp: 0 }), null, 'a maximum of 0')
  assert.equal(of({ value: '5', max: 10 }), null, 'no hit points as dnd5e models them')
  assert.equal(healthOf(null), null)
  assert.equal(of(hpOf(10, { temp: 5 })), 'unhurt', 'temporary hit points over the top change nothing')
  assert.equal(of(hpOf(10, { value: 4, temp: 10 })), 'bloodied', 'nor below it')
  assert.equal(of(hpOf(10, { value: 9, effectiveMax: 15 })), 'hurt', 'the maximum with its temporary change')
  if (DND5E6) {
    const { bloodied, ...vehicle } = hpOf(10, { value: 1 })
    assert.equal(of(vehicle), 'hurt', 'an actor with no hp.bloodied, as a vehicle, is never bloodied')
  }
  settings.set('bloodied', 'none')
  assert.equal(of(hpOf(100, { value: 25 })), 'hurt', "Never Display: dnd5e applies no Bloodied, and nor does this")
  assert.equal(of(hpOf(100, { value: 0 })), 'down')
  settings.set('bloodied', 'player')
  assert.equal(of(hpOf(100, { value: 25 })), 'bloodied', 'Only Display for Allies hides nothing here')
  ok(`H3: the bands agree with dnd5e ${DND5E6 ? '6.0.5' : '5.3.3'}'s own updateBloodied on ${rows} cases; 0 and below down; no maximum null; temporary hit points don't count; ${DND5E6 ? 'no hp.bloodied never bloodied; ' : ''}Never Display never bloodied`)
}

// ---- The fight: Thorin, Vex, and creatures of every side ----
const fight = combat('cmbt1')
const add = (id, who, initiative, more = {}) => combatant(fight, id, who, { initiative, ...more })
add('c-gob', goblin, 15, { token: tokens.goblin, tokenId: 't-gob' })
add('c-ogre', ogre, 14, { token: tokens.ogre, tokenId: 't-ogre' })
add('c-wolf', wolf, 13, { token: tokens.wolf, tokenId: 't-wolf' })
add('c-kob', kobold, 12, { token: tokens.kobold, tokenId: 't-kob', actorId: 'kobold' })
add('c-vex', vex, 11, { token: tokens.vex, tokenId: 't-vex' })
await Hooks.callAll('createCombatant', add('c-thorin', thorin, 20, { token: tokens.thorin, tokenId: 't-thorin' }))
await settle()
assert.equal(created(0).at(-1)?.data.combat.id, 'cmbt1', 'Erebor told of the fight')
assert.equal(created(0, 'camp-b').at(-1)?.data.combat.id, 'cmbt1', 'and Mirkwood')

// ---- H1: an older app, which says nothing of health ----
{
  await switches({ health: true, healthHitPoints: true })
  const on = JSON.stringify(snapshotCombat(fight, campaignA()))
  await switches({ health: false, healthHitPoints: false })
  const off = JSON.stringify(snapshotCombat(fight, campaignA()))
  assert.equal(on, off, 'every description the same, switches on or off')
  assert.ok(!on.includes('"health"'), on)
  assert.ok(!Object.hasOwn(byId(JSON.parse(on).combatants)['c-gob'], 'hp'), "no other creature's hit points")
  await switches({ health: true, healthHitPoints: true })
  assert.ok(!JSON.stringify(helloOf().data.combats).includes('"health"'), "the hello's combats")
  const from = app.events.length
  await hitPointsTo(goblin, 5)
  await settled()
  assert.deepEqual(updates(from), [], 'and the Goblin falling posts nothing')
  await hitPointsTo(goblin, 10)
  await settled()
  ok("H1: to an app that doesn't say health, with both switches on every description is as with both off, with no health and no other creature's hit points, and a creature's fall posts nothing")
}

// ---- H8: the first answer that says health ----
{
  // Health said in any other form than a format number, 1 or later, isn't read: no fight afresh,
  // and no description with health, the switches on.
  for (const said of [0, '1', true]) {
    app.answers = { 'camp-a': { health: said } }
    const from = app.events.length
    await beat()
    assert.equal(created(from).length, 0, `health: ${JSON.stringify(said)} sends no fight afresh`)
    assert.ok(!JSON.stringify(snapshotCombat(fight, campaignA())).includes('"health"'), `health: ${JSON.stringify(said)} isn't read`)
  }
  app.answers = { 'camp-a': { health: 1 }, 'camp-b': { health: 1 } }
  let from = app.events.length
  await beat()
  const afresh = created(from)
  assert.equal(afresh.length, 1, 'the fight sent again, whole')
  const goblinRow = byId(afresh[0].data.combat.combatants)['c-gob']
  assert.deepEqual([goblinRow.health, goblinRow.hp], ['unhurt', { value: 10, max: 10, temp: 0 }], 'now with its health')
  assert.equal(created(from, 'camp-b').length, 1, "Mirkwood's too, its app reading health")
  assert.ok(!JSON.stringify(created(from, 'camp-b')).includes('"health"'), 'its switch off: no health')
  from = app.events.length
  await beat()
  assert.deepEqual([created(from).length, created(from, 'camp-b').length], [0, 0], 'a second answer sends nothing')
  // A rolled back app, and the newer one again, by a hello's answer.
  app.answers = { 'camp-b': { health: 1 } }
  await beat()
  app.answers = { 'camp-a': { health: 1 }, 'camp-b': { health: 1 } }
  from = app.events.length
  announce({ campaignId: 'camp-a' })
  await settle()
  const types = ofType(app.events.slice(from), 'bridge.hello').concat(created(from))
  assert.equal(types.length, 2, 'the hello, then the fight')
  assert.ok(!JSON.stringify(types[0].data.combats).includes('"health"'), 'the hello described without it')
  assert.equal(byId(types[1].data.combat.combatants)['c-gob'].health, 'unhurt', 'the fight after it with it')
  assert.ok(app.events.indexOf(types[0]) < app.events.indexOf(types[1]))
  ok("H8: an app's first answer saying health, a heartbeat's or a hello's, sends each fight its campaign knows again whole, with health; a second sends nothing; health said as 0, '1' or true isn't read")
}

// ---- H4 and H5: who is shown ----
{
  const sides = combat('cmbt-sides')
  const more = (id, who, tokenOf, extra = {}) => combatant(sides, id, who, { initiative: 1, ...(tokenOf && { token: tokenOf, tokenId: tokenOf.id }), ...extra })
  const others = {
    hostile: creature('h-hostile', 'Hostile', 9), neutral: creature('h-neutral', 'Neutral', 9),
    friendly: creature('h-friendly', 'Friendly', 9), tokenless: creature('h-tokenless', 'Tokenless', 9),
    secret: creature('h-secret', 'Secret', 9), veiled: creature('h-veiled', 'Veiled', 9),
    odd: creature('h-odd', 'Odd', 9), lurker: creature('h-lurker', 'Lurker', 9),
    pet: creature('h-pet', "Carol's pet", 9, ['carol']), familiar: creature('h-fam', 'Familiar', 9),
  }
  const D = CONST.TOKEN_DISPOSITIONS
  more('s-thorin', thorin, token('st-thorin', D.FRIENDLY))
  more('s-vex', vex, token('st-vex', D.FRIENDLY))
  more('s-hostile', others.hostile, token('st-h', D.HOSTILE))
  more('s-neutral', others.neutral, token('st-n', D.NEUTRAL))
  more('s-friendly', others.friendly, token('st-f', D.FRIENDLY))
  more('s-tokenless', others.tokenless, null)
  more('s-secret', others.secret, token('st-s', D.SECRET))
  more('s-veiled', others.veiled, token('st-v', D.HOSTILE, { hidden: true }))
  more('s-odd', others.odd, token('st-o', 7))
  more('s-lurker', others.lurker, token('st-l', D.HOSTILE), { hidden: true })
  more('s-pet', others.pet, token('st-p', D.HOSTILE))
  more('s-fam', others.familiar, token('st-fam', D.FRIENDLY))
  // Thorin's familiar, summoned and so no player's, listed as Erebor's companion, as creature-sync.mjs
  // says it to an app that reads them.
  registerCombatantCompanion((each, campaign) => ((each.id === 's-fam') && (campaign.id === 'camp-a')) ? 'h-fam' : combatantCompanion(each, campaign))
  await switches({ health: true, healthHitPoints: false })
  settings.set('gmContent', true)
  const told = byId(snapshotCombat(sides, campaignA()).combatants)
  const health = id => Object.hasOwn(told[id], 'health') ? told[id].health : 'none'
  assert.deepEqual(['s-hostile', 's-neutral', 's-friendly', 's-tokenless'].map(health), ['unhurt', 'unhurt', 'unhurt', 'unhurt'], 'Hostile, Neutral, Friendly and no token')
  assert.deepEqual(['s-secret', 's-veiled', 's-odd', 's-lurker'].map(health), ['none', 'none', 'none', 'none'], 'never Secret, a hidden token, any other disposition, a hidden combatant')
  assert.deepEqual(['s-pet', 's-vex'].map(health), ['none', 'none'], "nor a creature a player owns, nor another campaign's character")
  assert.deepEqual(['s-thorin', 's-fam'].map(health), ['none', 'none'], "nor the campaign's own")
  assert.deepEqual([told['s-thorin'].hp, told['s-fam'].hp], [{ value: 30, max: 30, temp: 0 }, { value: 9, max: 9, temp: 0 }], 'who have their hit points')
  // H5: with Gamemaster-only information on every combatant has its hit points, as before, but no
  // health where it isn't shown; and without, only the party.
  assert.ok(['s-secret', 's-veiled', 's-lurker', 's-hostile'].every(id => Object.hasOwn(told[id], 'hp')), 'GM-only details: hit points as before')
  settings.set('gmContent', false)
  let plain = byId(snapshotCombat(sides, campaignA()).combatants)
  assert.ok(['s-hostile', 's-secret', 's-veiled', 's-pet'].every(id => !Object.hasOwn(plain[id], 'hp')), 'without, none of theirs')
  assert.equal(plain['s-lurker'], undefined, 'and no hidden combatant')
  await switches({ health: true, healthHitPoints: true })
  others.hostile.system.attributes.hp = hpOf(10, { value: 7, effectiveMax: 12, temp: 3 })
  plain = byId(snapshotCombat(sides, campaignA()).combatants)
  assert.deepEqual([plain['s-hostile'].hp, plain['s-hostile'].health], [{ value: 7, max: 12, temp: 3 }, 'hurt'], 'Show their hit points too: its maximum with its change, and its temporary hit points')
  assert.ok(['s-secret', 's-veiled', 's-odd', 's-pet', 's-vex'].every(id => !Object.hasOwn(plain[id], 'hp')), 'never for one not shown')
  assert.deepEqual([isHealthShown(sides.combatants.get('s-tokenless'), others.tokenless), isHealthShown(null, null)], [true, false])
  // Under another system the switches show nothing: no health, and no other creature's hit points.
  game.system.id = 'pf2e'
  const elsewhere = byId(snapshotCombat(sides, campaignA()).combatants)
  assert.ok(!JSON.stringify(elsewhere).includes('"health"'), 'no health under another system')
  assert.ok(['s-hostile', 's-neutral', 's-friendly', 's-tokenless'].every(id => !Object.hasOwn(elsewhere[id], 'hp')), "nor another creature's hit points")
  assert.deepEqual([elsewhere['s-thorin'].hp, elsewhere['s-fam'].hp], [{ value: 30, max: 30, temp: 0 }, { value: 9, max: 9, temp: 0 }], "the campaign's own keep theirs")
  game.system.id = 'dnd5e'
  registerCombatantCompanion(combatantCompanion)
  combats.delete(sides.id)
  ok("H4: Hostile, Neutral, Friendly and tokenless creatures get health; a Secret token, a hidden one, any other disposition, a hidden combatant, a player's creature and another campaign's character never do; the campaign's character and companion have hit points, never health; and under another system no creature has health, nor another's hit points")
  ok("H5: Show their hit points too gives a shown creature its hit points, the maximum with its change and its temporary hit points, and never one not shown; GM-only details still sends every combatant's hit points, with no health where it isn't shown")
}

// ---- H6: the watch ----
await switches({ health: true, healthHitPoints: false })
{
  // The Goblin hurt: one post, a quarter of a second after.
  let from = app.events.length
  await hitPointsTo(goblin, 9)
  await wait(150)
  assert.deepEqual(updates(from), [], 'nothing before it settles')
  await settled()
  let posted = updates(from)
  assert.equal(posted.length, 1, 'one post')
  assert.deepEqual([posted[0].data.combatId, posted[0].data.changes, posted[0].data.combatant.id, posted[0].data.combatant.health], ['cmbt1', ['health'], 'c-gob', 'hurt'])
  assert.equal(Object.hasOwn(posted[0].data.combatant, 'hp'), false, 'no hit points with the second switch off')
  // The same band: nothing.
  from = app.events.length
  await hitPointsTo(goblin, 8)
  await settled()
  assert.deepEqual(updates(from), [], 'the same band posts nothing')
  // A burst longer than the wait, each change in it under 250 ms after the one before: healed whole,
  // bloodied 150 ms later, healed whole 150 ms after that. Each change starts the wait again, so
  // nothing goes until 250 ms after the last, and then once, as it settled: never Bloodied, which it
  // was only mid-burst.
  from = app.events.length
  await hitPointsTo(goblin, 10)
  await wait(150)
  await hitPointsTo(goblin, 3)
  await wait(150)
  await hitPointsTo(goblin, 10)
  await wait(150)
  assert.deepEqual(updates(from), [], 'nothing while a burst longer than the wait goes on, nor until it settles')
  await settled()
  posted = updates(from)
  assert.deepEqual(posted.map(each => [each.data.changes, each.data.combatant.health]), [[['health'], 'unhurt']], 'then one post, as it settled')
  // Three changes within 100 ms: one post, of the last.
  from = app.events.length
  await hitPointsTo(goblin, 7)
  await wait(30)
  await hitPointsTo(goblin, 6)
  await wait(30)
  await hitPointsTo(goblin, 4)
  await settled()
  posted = updates(from)
  assert.equal(posted.length, 1, 'a burst posts once')
  assert.equal(posted[0].data.combatant.health, 'bloodied')
  // Two fights at once, each waiting for the last change to any creature in it, and only in it: the
  // Goblin hurt here; 100 ms later a Warg in a camp Thorin is fighting too; 100 ms after that the
  // Ogre here. The camp goes 250 ms after the Warg; this fight 250 ms after the Ogre, the Goblin
  // with it, put off by the Ogre and not by the Warg.
  const camp = combat('cmbt-camp')
  const warg = creature('warg', 'Warg', 12)
  combatant(camp, 'k-warg', warg, { initiative: 7, token: token('t-warg', CONST.TOKEN_DISPOSITIONS.HOSTILE, { actor: warg }), tokenId: 't-warg' })
  const thorinInCamp = combatant(camp, 'k-thorin', thorin, { initiative: 6, token: token('t-thorin3', CONST.TOKEN_DISPOSITIONS.FRIENDLY, { actor: thorin }), tokenId: 't-thorin3' })
  from = app.events.length
  await Hooks.callAll('createCombatant', thorinInCamp)
  await settle()
  assert.equal(byId(created(from).at(-1)?.data.combat.combatants ?? [])['k-warg']?.health, 'unhurt', 'Erebor told of the camp, the Warg unhurt')
  from = app.events.length
  await hitPointsTo(goblin, 9)
  await wait(100)
  await hitPointsTo(warg, 5)
  await wait(100)
  await hitPointsTo(ogre, 58)
  await settled()
  assert.deepEqual(updates(from).map(each => [each.data.combatId, each.data.combatant.id, each.data.combatant.health]),
    [['cmbt-camp', 'k-warg', 'bloodied'], ['cmbt1', 'c-gob', 'hurt'], ['cmbt1', 'c-ogre', 'hurt']], 'each fight posted as its own changes settled')
  combats.delete(camp.id)
  await Hooks.callAll('deleteCombat', camp)
  await hitPointsTo(goblin, 4)
  await hitPointsTo(ogre, 59)
  await settled()
  // An unlinked token's creature, by its delta, and by its token's delta.
  from = app.events.length
  await hitPointsTo(kobold, 2, 'updateActorDelta', { parent: { actor: kobold } })
  await settled()
  posted = updates(from)
  assert.deepEqual(posted.map(each => [each.data.combatant.id, each.data.combatant.health]), [['c-kob', 'bloodied']], 'heard by updateActorDelta')
  from = app.events.length
  await hitPointsTo(kobold, 5, 'updateToken', tokens.kobold)
  await settled()
  posted = updates(from)
  assert.deepEqual(posted.map(each => [each.data.combatant.id, each.data.combatant.health]), [['c-kob', 'hurt']], 'and by updateToken with its delta')
  const told = from => updates(from).map(each => [each.data.combatant.id, each.data.changes, each.data.combatant.health])
  // The Kobold's token linked to its base actor, whole, and unlinked again: heard by actorLink.
  const baseKobold = game.actors.get('kobold')
  from = app.events.length
  Object.assign(tokens.kobold, { actorLink: true, actor: baseKobold })
  fight.combatants.get('c-kob').actor = baseKobold
  await Hooks.callAll('updateToken', tokens.kobold, { actorLink: true })
  await settled()
  assert.deepEqual(told(from), [['c-kob', ['health'], 'unhurt']], 'a token linked to its actor')
  from = app.events.length
  Object.assign(tokens.kobold, { actorLink: false, actor: kobold })
  fight.combatants.get('c-kob').actor = kobold
  await Hooks.callAll('updateToken', tokens.kobold, { actorLink: false })
  await settled()
  assert.deepEqual(told(from), [['c-kob', ['health'], 'hurt']], 'and unlinked')
  // The Wolf's token made to stand for a hurt Dire wolf, and back: heard by actorId. The combatant
  // keeps its own actorId, as core's does, and reads its actor through its token.
  const direWolf = creature('dire-wolf', 'Dire wolf', 20)
  direWolf.system.attributes.hp.value = 12
  from = app.events.length
  Object.assign(tokens.wolf, { actorId: 'dire-wolf', actor: direWolf })
  fight.combatants.get('c-wolf').actor = direWolf
  await Hooks.callAll('updateToken', tokens.wolf, { actorId: 'dire-wolf' })
  await settled()
  assert.deepEqual(told(from), [['c-wolf', ['health'], 'hurt']], 'a token made to stand for another actor')
  from = app.events.length
  Object.assign(tokens.wolf, { actorId: 'wolf', actor: wolf })
  fight.combatants.get('c-wolf').actor = wolf
  await Hooks.callAll('updateToken', tokens.wolf, { actorId: 'wolf' })
  await settled()
  assert.deepEqual(told(from), [['c-wolf', ['health'], 'unhurt']], 'and for its own again')
  // An effect raising the Ogre's maximum, as Aid does; changed, as Aid suspended and resumed; and
  // deleted, as Aid ends: each heard by its own hook, with no change to the actor.
  const aid = { parent: ogre, documentName: 'ActiveEffect' }
  from = app.events.length
  ogre.system.attributes.hp.effectiveMax = 64
  await Hooks.callAll('createActiveEffect', aid)
  await settled()
  assert.deepEqual(told(from), [['c-ogre', ['health'], 'hurt']], 'an effect raising its maximum makes it hurt')
  from = app.events.length
  ogre.system.attributes.hp.effectiveMax = 59
  await Hooks.callAll('updateActiveEffect', aid, { disabled: true })
  await settled()
  assert.deepEqual(told(from), [['c-ogre', ['health'], 'unhurt']], 'an effect changed: Aid suspended')
  from = app.events.length
  ogre.system.attributes.hp.effectiveMax = 64
  await Hooks.callAll('updateActiveEffect', aid, { disabled: false })
  await settled()
  assert.deepEqual(told(from), [['c-ogre', ['health'], 'hurt']], 'and resumed')
  from = app.events.length
  ogre.system.attributes.hp.effectiveMax = 59
  await Hooks.callAll('deleteActiveEffect', aid)
  await settled()
  assert.deepEqual(told(from), [['c-ogre', ['health'], 'unhurt']], 'an effect deleted: Aid ended')
  // The Goblin's token made Secret: posted without health.
  from = app.events.length
  tokens.goblin.disposition = CONST.TOKEN_DISPOSITIONS.SECRET
  await Hooks.callAll('updateToken', tokens.goblin, { disposition: CONST.TOKEN_DISPOSITIONS.SECRET })
  await settled()
  posted = updates(from)
  assert.deepEqual(posted.map(each => [each.data.combatant.id, each.data.changes]), [['c-gob', ['health']]])
  assert.equal(Object.hasOwn(posted[0].data.combatant, 'health'), false, 'Secret: no health')
  tokens.goblin.disposition = CONST.TOKEN_DISPOSITIONS.HOSTILE
  await Hooks.callAll('updateToken', tokens.goblin, { disposition: CONST.TOKEN_DISPOSITIONS.HOSTILE })
  await settled()
  // The Goblin's token hidden from players mid-fight, with Show their hit points too on: posted with
  // neither its health nor its hit points; shown again, with both.
  await switches({ health: true, healthHitPoints: true })
  from = app.events.length
  tokens.goblin.hidden = true
  await Hooks.callAll('updateToken', tokens.goblin, { hidden: true })
  await settled()
  posted = updates(from)
  assert.deepEqual(posted.map(each => [each.data.combatant.id, each.data.changes]), [['c-gob', ['hp', 'health']]], 'a token hidden mid-fight')
  assert.ok(!Object.hasOwn(posted[0].data.combatant, 'health') && !Object.hasOwn(posted[0].data.combatant, 'hp'), JSON.stringify(posted[0].data.combatant))
  from = app.events.length
  tokens.goblin.hidden = false
  await Hooks.callAll('updateToken', tokens.goblin, { hidden: false })
  await settled()
  posted = updates(from)
  assert.deepEqual(posted.map(each => [each.data.combatant.id, each.data.changes, each.data.combatant.health, each.data.combatant.hp]),
    [['c-gob', ['hp', 'health'], 'bloodied', { value: 4, max: 10, temp: 0 }]], 'and shown again')
  await switches({ health: true, healthHitPoints: false })
  // The Wolf down, then made Dead by an effect.
  from = app.events.length
  await hitPointsTo(wolf, 0)
  await settled()
  assert.deepEqual(updates(from).map(each => [each.data.combatant.id, each.data.changes, each.data.combatant.health]), [['c-wolf', ['health'], 'down']])
  from = app.events.length
  fight.combatants.get('c-wolf').isDefeated = true
  await Hooks.callAll('createActiveEffect', { parent: wolf, documentName: 'ActiveEffect', statuses: new Set(['dead']) })
  await settled()
  assert.deepEqual(updates(from).map(each => [each.data.combatant.id, each.data.changes, each.data.combatant.defeated]), [['c-wolf', ['defeated'], true]], 'Dead after down: defeated')
  ok('H6: the watch posts once, 250 ms after a change settles, a creature whose health changed; nothing in the same band; one post for a burst, nothing until 250 ms after its last change however long it goes on, and as it settled; two fights at once each posted; an unlinked creature by its delta and its token; a token linked, or made to stand for another actor; an effect made, changed and deleted; a token made Secret, without health; a token hidden, without health or hit points; and Dead after down, as defeated')
}

// ---- H7: a turn between the change and the watch ----
{
  fight.started = true; fight.round = 1; fight.turn = 0
  await Hooks.callAll('combatTurnChange', fight, { round: 0, turn: null, combatantId: null }, { round: 1, turn: 0, combatantId: 'c-thorin' })
  await settled()
  // The Ogre bloodied, a turn telling it so before the watch settles, then healed whole.
  let from = app.events.length
  await hitPointsTo(ogre, 20)
  fight.turn = 1
  await Hooks.callAll('combatTurnChange', fight, { round: 1, turn: 0, combatantId: 'c-thorin' }, { round: 1, turn: 1, combatantId: 'c-gob' })
  await settle()
  const turn = ofType(app.events.slice(from), 'combat.turn').at(-1)
  assert.equal(byId(turn.data.combat.combatants)['c-ogre'].health, 'bloodied', 'the turn told it bloodied')
  await hitPointsTo(ogre, 59)
  await settled()
  assert.deepEqual(updates(from).map(each => [each.data.combatant.id, each.data.combatant.health]), [['c-ogre', 'unhurt']], 'the watch tells it whole again')
  // Told by a turn, nothing changed since: the watch sends nothing again.
  from = app.events.length
  await hitPointsTo(ogre, 20)
  fight.turn = 2
  await Hooks.callAll('combatTurnChange', fight, { round: 1, turn: 1, combatantId: 'c-gob' }, { round: 1, turn: 2, combatantId: 'c-ogre' })
  await settled()
  assert.deepEqual(updates(from), [], 'what a turn told is not told again')
  await hitPointsTo(ogre, 59)
  await settled()
  ok('H7: what every description tells a campaign is noted: a turn telling the Ogre bloodied before the watch settles, then healed whole, posts unhurt; told by a turn and unchanged, nothing')
}

// ---- H9: the party's own hit points follow the game, whatever the switch ----
{
  await switches({ health: false, healthHitPoints: false })
  const from = app.events.length
  await hitPointsTo(thorin, 12)
  await settled()
  const posted = updates(from)
  assert.deepEqual(posted.map(each => [each.data.combatant.id, each.data.changes, each.data.combatant.hp]), [['c-thorin', ['hp'], { value: 12, max: 30, temp: 0 }]])
  assert.ok(!JSON.stringify(posted).includes('"health"'))
  await hitPointsTo(thorin, 30)
  await settled()
  ok("H9: Thorin's hit points changing between turns post his combatant, changes ['hp'], with the switch off")
}

// ---- H10: two campaigns ----
{
  await switches({ health: true }, { health: false })
  const from = app.events.length
  await hitPointsTo(goblin, 6)
  await settled()
  assert.deepEqual(updates(from).map(each => each.data.combatant.health), ['hurt'], 'Erebor, its switch on')
  assert.deepEqual(updates(from, 'camp-b'), [], 'Mirkwood, its switch off, nothing')
  await switches({ health: true }, { health: true })
  const told = byId(snapshotCombat(fight, getCampaigns().find(c => c.id === 'camp-b')).combatants)
  assert.equal(told['c-gob'].health, 'hurt', 'until its own switch is on')
  assert.equal(Object.hasOwn(told['c-thorin'], 'health'), false, "Thorin is another campaign's character there")
  ok("H10: only the campaign whose switch is on is sent another creature's health")
}

// ---- H12: the switches saved mid-fight ----
{
  let from = app.events.length
  await switches({ health: true, healthHitPoints: true }, { health: true })
  const fightOf = (campaign = 'camp-a') => byId(ofType(app.events.slice(from), 'bridge.hello', campaign).at(-1)?.data.combats.find(c => c.id === 'cmbt1')?.combatants ?? [])
  assert.deepEqual([fightOf()['c-gob'].health, fightOf()['c-gob'].hp], ['hurt', { value: 6, max: 10, temp: 0 }], "the hello after the save describes the fight anew: the Goblin's hit points too")
  assert.equal(Object.hasOwn(fightOf('camp-b')['c-gob'], 'hp'), false, "Mirkwood's still without them")
  assert.deepEqual([updates(from).length, created(from).length], [0, 0], 'nothing else is sent')
  from = app.events.length
  await switches({ health: false, healthHitPoints: false }, { health: true })
  const goblinOff = fightOf()['c-gob']
  assert.ok(!Object.hasOwn(goblinOff, 'health') && !Object.hasOwn(goblinOff, 'hp'), JSON.stringify(goblinOff))
  from = app.events.length
  await hitPointsTo(goblin, 7)
  await settled()
  assert.deepEqual(updates(from), [], 'and with the switch off, a fall the hello told none of posts nothing')
  await switches({ health: true }, { health: true })
  ok("H12: the switches saved mid-fight: the hello after the save describes each fight anew, other creatures' health and hit points in or out, and nothing else is sent")
}

// ---- H13: where the watch sends nothing ----
{
  const fall = async (who, value) => { await hitPointsTo(who, value); await settled() }
  // Combat events off: a fall posts nothing, and an app first saying health is sent no fight afresh.
  settings.set('combatEvents', false)
  let from = app.events.length
  await fall(goblin, 3)
  assert.deepEqual(updates(from), [], 'combat events off: nothing')
  app.answers = { 'camp-b': { health: 1 } }
  await beat()
  app.answers = { 'camp-a': { health: 1 }, 'camp-b': { health: 1 } }
  from = app.events.length
  await beat()
  assert.deepEqual(created(from), [], 'nor a fight afresh to an app first saying health')
  await fall(goblin, 7)
  settings.set('combatEvents', true)
  // A client that isn't the bridge hears the same hooks, and posts nothing.
  users.get('gm').isActiveGM = false
  from = app.events.length
  await fall(goblin, 3)
  assert.deepEqual([updates(from), updates(from, 'camp-b')], [[], []], "a client that isn't the bridge: nothing")
  await fall(goblin, 7)
  users.get('gm').isActiveGM = true
  // A fight its campaign isn't told of: Thorin left the ambush, then came back unheard while combat
  // events were off, and they're on again before any hello.
  const ambush = combat('cmbt-ambush')
  const orc = creature('orc', 'Orc', 15)
  combatant(ambush, 'a-orc', orc, { initiative: 9, token: token('t-orc', CONST.TOKEN_DISPOSITIONS.HOSTILE, { actor: orc }), tokenId: 't-orc' })
  const thorinThere = combatant(ambush, 'a-thorin', thorin, { initiative: 8, token: token('t-thorin2', CONST.TOKEN_DISPOSITIONS.FRIENDLY, { actor: thorin }), tokenId: 't-thorin2' })
  from = app.events.length
  await Hooks.callAll('createCombatant', thorinThere)
  await settle()
  assert.equal(byId(created(from).at(-1)?.data.combat.combatants ?? [])['a-orc']?.health, 'unhurt', 'Erebor told of the ambush, the Orc unhurt')
  ambush.combatants.delete('a-thorin')
  await Hooks.callAll('deleteCombatant', thorinThere)
  await settle()
  assert.equal(ofType(app.events.slice(from), 'combat.ended').at(-1)?.data.combat.id, 'cmbt-ambush', 'and that it ended for it, as Thorin left')
  settings.set('combatEvents', false)
  ambush.combatants.set('a-thorin', thorinThere)
  await Hooks.callAll('createCombatant', thorinThere)
  settings.set('combatEvents', true)
  from = app.events.length
  await fall(orc, 5)
  assert.deepEqual(updates(from).filter(each => each.data.combatId === 'cmbt-ambush'), [], "a fight its campaign isn't told of: nothing")
  combats.delete(ambush.id)
  await Hooks.callAll('deleteCombat', ambush)
  await settle()
  // A fight its campaign is told of but no longer in: Erebor's characters saved without Thorin,
  // before the hello that follows. Mirkwood, still in it, is sent the fall.
  const saved = settings.get('campaigns')
  settings.set('campaigns', saved.map(c => (c.id === 'camp-a') ? { ...c, characters: [] } : c))
  from = app.events.length
  await fall(goblin, 3)
  assert.deepEqual([updates(from).length, updates(from, 'camp-b').length], [0, 1], "a fight its campaign is no longer in: nothing, while Mirkwood's told")
  await fall(goblin, 7)
  settings.set('campaigns', saved)
  // A combatant hidden mid-fight, Gamemaster-only information off: removed, then sent nothing as
  // its hit points change; shown again, added back.
  const ogreThere = fight.combatants.get('c-ogre')
  from = app.events.length
  ogreThere.hidden = true
  await Hooks.callAll('updateCombatant', ogreThere, { hidden: true })
  await settle()
  assert.deepEqual(ofType(app.events.slice(from), 'combat.combatant.removed').map(each => each.data.combatantId), ['c-ogre'], 'hidden: removed')
  from = app.events.length
  await fall(ogre, 20)
  assert.deepEqual([updates(from), updates(from, 'camp-b')], [[], []], 'a combatant hidden mid-fight: nothing')
  await fall(ogre, 59)
  ogreThere.hidden = false
  await Hooks.callAll('updateCombatant', ogreThere, { hidden: false })
  await settle()
  assert.equal(ofType(app.events.slice(from), 'combat.combatant.added').at(-1)?.data.combatant.health, 'unhurt', 'shown again: added back, unhurt')
  ok("H13: the watch sends nothing with combat events off, nor a fight afresh then; nothing from a client that isn't the bridge; nothing for a fight its campaign isn't told of, or no longer has a character in; and nothing for a combatant hidden mid-fight")
}

// A combat deleted is forgotten, and its watch with it.
{
  noteHealthReader('camp-a', { health: 1 })
  await hitPointsTo(goblin, 10)
  const goblinThere = fight.combatants.get('c-gob')
  assert.deepEqual(healthChanges(goblinThere, campaignA()), ['health'], 'told hurt, unhurt now')
  combats.delete(fight.id)
  await Hooks.callAll('deleteCombat', fight)
  // The fight's combat.ended described the Goblin unhurt; hurt since, it would differ, but nothing
  // told of a deleted fight is kept.
  goblin.system.attributes.hp.value = 2
  assert.deepEqual(healthChanges(goblinThere, campaignA()), [], 'what it was told is forgotten')
  const from = app.events.length
  await settled()
  assert.deepEqual(updates(from), [], 'nothing after the fight is deleted')
  ok('a deleted combat is forgotten, what each campaign was told of it and its waiting check with it')
}

assert.equal(oks, 14)
console.log(`\nall ${oks} health cases passed`)
