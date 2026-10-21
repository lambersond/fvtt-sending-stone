// Party sheets (module 0.30.0, its contract §2.2-§2.4, §3.2-§3.5, §3.9): a campaign's Group actors,
// listed in its hello and each sent in `group.updated` to an app that reads them, `features.groups`,
// with who may see it as Foundry lets them; members by name and portrait alone; its inventory with
// nothing to roll or use; and its descriptions without secrets or links to act on. Kept current as
// the group, its items, its members and who may see it change, and removed when it's deleted. And
// Manage Campaigns' Party tab, from its own templates (settings-app.mjs). The real module, a
// stand-in Foundry core and app; dnd5e 5.3.3's groups (data/actor/group.mjs), or 6.0.5's with
// DND5E6=1, with fractional coins. Run with SLIM_CHECK=1 (every full sheet posted, a group's
// among them, slims and expands back) and --import ./unref-timers.mjs --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { actor, actors, settings, user, users } from './stub.mjs'
import { click, find, openSettings, save, view } from './settings-app.mjs'
import { expandSheet } from './slim-expand.mjs'
import { oldModule } from './paths.mjs'

const MODULE = process.env.MODULE_DIR
const DND5E6 = Boolean(process.env.DND5E6)
const ok = msg => console.log('ok -', msg)
let now = Date.parse('2026-10-19T20:00:00Z')
Date.now = () => now
const realSetTimeout = globalThis.setTimeout
// A failed post is retried after 1 s and 3 s: here at once. Everything else waits as it would.
globalThis.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, [1_000, 3_000].includes(ms) ? 1 : ms, ...args)
const wait = ms => new Promise(resolve => realSetTimeout(resolve, ms))
const settle = () => wait(320)
// What the module logs, kept rather than printed: the stand-in characters have no sheets to describe.
const logged = []
console.warn = console.error = (...args) => logged.push(args.map(String).join(' '))

// ---- dnd5e ----
CONST.DOCUMENT_OWNERSHIP_LEVELS = { INHERIT: -1, NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 }
game.documentTypes = { Actor: ['character', 'npc', 'vehicle', 'group', 'encounter'] }
if (DND5E6) game.system.version = '6.0.5'
CONFIG.DND5E = {
  abilities: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(a => [a, { label: a.toUpperCase(), abbreviation: a }])),
  currencies: Object.fromEntries(['pp', 'gp', 'ep', 'sp', 'cp'].map(id => [id, { label: `DND5E.Currency${id.toUpperCase()}`, abbreviation: id }])),
  weightUnits: { lb: { abbreviation: 'lb' } },
}
// dnd5e's enrichers, as far as these use them: a save link becomes its request (enrichers.mjs), and
// Foundry drops a secret section where it's enriched without secrets.
const request = (ability, dc) => `<enriched-content data-enricher-id="dnd5e-enricher"><span class="roll-link-group" data-type="save" data-ability="${ability}" data-dc="${dc}"><a class="roll-link" data-action="roll">DC ${dc} ${ability.toUpperCase()}</a></span></enriched-content>`
const enriched = []
foundry.applications.ux.TextEditor = { implementation: { async enrichHTML(html, options = {}) {
  enriched.push(options)
  const shown = options.secrets ? html : html.replace(/<section class="secret"[^>]*>[\s\S]*?<\/section>/g, '')
  return shown.replace(/\[\[\/save (\w+) dc=(\d+)\]\]/g, (match, ability, dc) => request(ability, dc))
} } }

// ---- The world ----
users.activeGM = user('gm', 'Gamemaster', true)
user('gm2', 'Assistant', true)
for (const [id, name] of [['alice', 'Alice'], ['bob', 'Bob'], ['cara', 'Cara'], ['dave', 'Dave']]) user(id, name)
const thorin = actor('thorin', 'Thorin', ['alice'])
const vex = actor('vex', 'Vex', ['bob'])
const lone = actor('lone', 'Lone', ['cara'])
const dax = actor('dax', 'Dax', ['dave'])
const ghost = actor('ghost', 'Ghost', [])
const shared = actor('shared', 'Shared', ['alice', 'bob'])
const keeper = actor('keeper', 'Keeper', ['gm2'])
const anna = actor('anna', 'Anna', ['alice'])
const wolf = actor('wolf', 'Wolf', [], 'npc')
const cart = actor('cart', 'Cart', [], 'vehicle')
const hazard = actor('hazard', 'Hazard', [], 'hazard')
const gone = { id: 'gone', name: 'Gone', type: 'character', img: 'gone.webp' }
for (const a of [thorin, vex, lone, dax, ghost, shared, keeper, anna, wolf, cart, hazard]) {
  a.documentName = 'Actor'
  a.prototypeToken = { texture: { src: `tokens/${a.id}.webp`, randomImg: false } }
}

/** A Group actor, as dnd5e 5.3.3 prepares one (data/actor/group.mjs:148-172). */
function group(id, name, { members = [], ownership = {}, description = {}, flags = {}, currency = {} } = {}) {
  const items = new Map()
  const g = {
    documentName: 'Actor', id, name, type: 'group', uuid: `Actor.${id}`, img: `${id}.webp`,
    ownership: { default: 0, ...ownership }, flags,
    system: { members: [], description: { full: '', summary: '', ...description }, currency: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0, ...currency } },
    items: { get: key => items.get(key), [Symbol.iterator]: () => items.values(), map: items },
    getUserLevel(u) { return u.isGM ? 3 : (this.ownership[u.id] ?? this.ownership.default ?? 0) },
    testUserPermission(u, level) { return this.getUserLevel(u) >= CONST.DOCUMENT_OWNERSHIP_LEVELS[level] },
  }
  members.forEach(m => m && (m.prototypeToken ??= { texture: { src: `tokens/${m.id}.webp` } }))
  prepare(g, members)
  actors.set(id, g)
  return g
}
/** Prepare a group's members as dnd5e does: each `{actor}`, and their ids, `members.ids`. */
function prepare(g, members) {
  const list = members.map(m => ({ actor: m }))
  Object.defineProperty(list, 'ids', { value: new Set(members.map(m => m.id)), enumerable: false })
  g.system.members = list
}
const item = (parent, id, type, name, system = {}) => {
  const it = {
    documentName: 'Item', id, uuid: `${parent.uuid}.Item.${id}`, name, type, img: `${id}.webp`, sort: 0, parent,
    labels: { properties: [] },
    system: { quantity: 1, identified: true, description: { value: '' }, weight: { value: 1, units: 'lb' }, ...system },
  }
  parent.items.map.set(id, it)
  return it
}
const SECRET = '<section class="secret"><p>The cult paid them.</p></section>'
const party = group('party', 'The Company', {
  members: [vex, thorin, cart, wolf, anna, gone, hazard],
  ownership: { alice: 2, bob: 3, cara: 1, dave: 0, default: 2 },
  description: { full: `<p>Sworn at Erebor.</p>${SECRET}`, summary: '<p>Four of Erebor. Each must make a [[/save dex dc=15]].</p>' },
  currency: { gp: DND5E6 ? 12.5 : 12, sp: 7 },
})
item(party, 'sword', 'weapon', 'Sword of the Company', {
  description: { value: `<p>A blade.</p>${SECRET}` }, activities: new Map([['atk', { id: 'atk', type: 'attack' }]]), equipped: true,
})
item(party, 'rope', 'loot', 'Rope', { quantity: 2 })
item(party, 'bag', 'container', 'Bag', { capacity: { count: 10 }, contentsCount: 1 })
item(party, 'gem', 'loot', 'Gem', { container: 'bag', priceLabel: '50 gp' })
const band = group('band', 'Another Band', { members: [lone], ownership: { cara: 3 } })
const secretive = group('secretive', 'The Hidden Hand', { members: [thorin], ownership: { default: 0 }, description: { full: `<p>Unseen.</p>${SECRET}` } })
actor('ambush', 'Ambush', [], 'encounter').documentName = 'Actor'
let primary = 'party'
Object.defineProperty(actors, 'party', { get: () => actors.get(primary) ?? null, configurable: true })

// ---- The app ----
const app = { features: {}, posts: [], fail: null, hold: null }
const answer = body => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })
globalThis.fetch = async (url, init) => {
  const envelope = JSON.parse(init.body)
  // A hello held on its way until it's let go, answered with the features set for the app then.
  if (app.hold && (envelope.type === 'bridge.hello')) { const held = app.hold; app.hold = null; await held }
  if (app.fail?.(envelope)) return { ok: false, status: 503, statusText: 'Unavailable', headers: new Headers() }
  app.posts.push(envelope)
  return answer({ features: app.features })
}
const take = () => app.posts.splice(0)
const groupsIn = posts => posts.filter(e => e.type.startsWith('group.'))

// ---- Start-up ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('campaigns', [
  { id: 'camp-a', title: 'Emberfall', characters: ['thorin', 'vex', 'lone', 'dax', 'ghost', 'shared', 'keeper'], groups: ['party', 'missing', 'ambush', 'thorin'] },
  { id: 'camp-b', title: 'Mirkwood', characters: ['thorin'], groups: ['secretive'] },
])
await Hooks.callAll('ready')
await settle()
const { candidateGroups, campaignGroups, groupEntry, groupsAvailable } = await import(`${MODULE}/scripts/groups.mjs`)
const { getCampaigns } = await import(`${MODULE}/scripts/campaigns.mjs`)
const { heartbeat } = await import(`${MODULE}/scripts/heartbeat.mjs`)
const { announce } = await import(`${MODULE}/scripts/bridge.mjs`)
const campaignA = () => getCampaigns()[0]

// ---- Which groups ----
assert.ok(groupsAvailable())
assert.deepEqual(candidateGroups().map(g => g.id), ['party', 'band', 'secretive'], 'groups alone, never an encounter or a character; the primary party first, then by name')
primary = 'secretive'
assert.deepEqual(candidateGroups().map(g => g.id), ['secretive', 'band', 'party'])
primary = 'party'
assert.deepEqual(campaignGroups(campaignA()).map(g => g.id), ['party'], "a campaign's: those that exist as groups, in order")
const [helloA, helloB] = take().filter(e => e.type === 'bridge.hello')
assert.deepEqual(helloA.data.groups, [groupEntry(party, campaignA())])
assert.deepEqual(Object.keys(helloA.data.groups[0]), ['id', 'uuid', 'name', 'img', 'type', 'primary', 'access'])
assert.deepEqual(helloA.data.groups[0], { ...helloA.data.groups[0], id: 'party', uuid: 'Actor.party', name: 'The Company', img: 'party.webp', type: 'group', primary: true })
assert.deepEqual(helloB.data.groups.map(g => [g.id, g.primary]), [['secretive', false]])
game.system.id = 'pf2e'
assert.equal(groupsAvailable(), false)
assert.deepEqual(campaignGroups(campaignA()), [], 'under another system, none')
game.system.id = 'dnd5e'
ok("the hello lists each campaign's groups, existing groups alone, in order, each without its sheet; candidates are every Group actor, never an encounter, the primary party first; none under another system")

// ---- Who may see a group ----
assert.deepEqual(groupEntry(party, campaignA()).access, {
  thorin: 'observer', // Alice: Observer
  vex: 'owner', // Bob: Owner
  // lone: Cara is Limited, which counts as none; dax: Dave has none.
  ghost: 'observer', // no player owner: the group's default
  shared: 'owner', // Alice and Bob: the higher
  keeper: 'observer', // a Gamemaster's character: no player owner, the default
})
assert.deepEqual(groupEntry(secretive, getCampaigns()[1]).access, {}, 'private')
ok('who may see a group, by each campaign character: its players\' highest ownership of the group, Owner or Observer; Limited or less counts as none; a character no player owns, the group\'s default; a Gamemaster counts for none')

// ---- Gating: an app that doesn't read groups is sent none ----
assert.equal(groupsIn(app.posts).length, 0)
await Hooks.callAll('createItem', item(party, 'torch', 'loot', 'Torch'))
await settle()
assert.equal(groupsIn(take()).length, 0, 'no group.* without features.groups')
ok('an app that doesn\'t say it reads groups is sent no group.updated or group.removed')

// ---- Turned on by a heartbeat's answer: every group, once ----
app.features = { groups: 1 }
now += 60_000
heartbeat()
await settle()
let posts = take()
let updates = posts.filter(e => e.type === 'group.updated')
assert.deepEqual(updates.map(e => [e.campaign.id, e.data.group.id]), [['camp-a', 'party'], ['camp-b', 'secretive']])
now += 60_000
heartbeat()
await settle()
assert.equal(groupsIn(take()).length, 0, 'once')
ok("an app that starts to read groups in a heartbeat's answer, as one deployed mid-session, is sent every group, once")

// ---- The sheet ----
const sent = updates[0].data.group
assert.deepEqual(Object.keys(sent), ['id', 'uuid', 'name', 'img', 'type', 'primary', 'access', 'sheet'])
const sheet = sent.sheet
assert.deepEqual(Object.keys(sheet), ['members', 'description', 'inventory'])
assert.deepEqual(sheet.members, [
  { id: 'anna', name: 'Anna', img: 'anna.webp', type: 'character', character: false },
  { id: 'thorin', name: 'Thorin', img: 'thorin.webp', type: 'character', character: true },
  { id: 'vex', name: 'Vex', img: 'vex.webp', type: 'character', character: true },
  { id: 'wolf', name: 'Wolf', img: 'wolf.webp', type: 'npc', character: false },
  { id: 'cart', name: 'Cart', img: 'cart.webp', type: 'vehicle', character: false },
], 'characters, then NPCs, then vehicles, each by name; a deleted member and another kind left out')
assert.ok(sheet.members.every(m => Object.keys(m).join() === 'id,name,img,type,character'), 'exactly five keys')
assert.ok(!JSON.stringify(sheet.members).includes('hp'), 'no hit points, level or class')
assert.equal(sheet.inventory.encumbrance, null)
assert.equal(sheet.inventory.attunement, null)
assert.deepEqual(sheet.inventory.currency.find(c => c.id === 'gp').value, DND5E6 ? 12.5 : 12, DND5E6 ? 'fractional coins under dnd5e 6' : 'coins')
const rows = [...sheet.inventory.sections.flatMap(s => s.items), ...sheet.inventory.containers, ...sheet.inventory.containers.flatMap(c => c.contents)]
assert.deepEqual(rows.map(r => r.id).sort(), ['bag', 'gem', 'rope', 'sword', 'torch'])
const ROLL_KEYS = ['activation', 'activationType', 'range', 'target', 'toHit', 'attackId', 'activity', 'attackModes', 'ammunition', 'save', 'damage', 'activities', 'consumable', 'enchantments', 'enchantment', 'rollFormula', 'check']
for (const row of rows) assert.ok(ROLL_KEYS.every(key => !(key in row)), `${row.id}: ${Object.keys(row).join(' ')}`)
assert.ok(sheet.description.full && sheet.description.summary)
ok(`a group's sheet: its members by exactly five keys, characters first, as dnd5e lists them; its inventory with containers, nothing to roll, use or enchant, no encumbrance or attunement${DND5E6 ? ', and coins as dnd5e 6 keeps them, fractional' : ''}; and its descriptions by hash`)

// ---- Its descriptions: no secrets, no links to act on ----
const textsSent = posts.filter(e => (e.type === 'character.texts') && (e.campaign.id === 'camp-a')).reduce((all, e) => ({ ...all, ...e.data.texts }), {})
const groupHashes = [sheet.description.full, sheet.description.summary, rows.find(r => r.id === 'sword').text]
for (const hash of groupHashes) assert.ok(hash in textsSent, `${hash} sent before the group`)
for (const hash of groupHashes) assert.ok(!textsSent[hash].includes('The cult paid them'), textsSent[hash])
assert.ok(textsSent[sheet.description.full].includes('Sworn at Erebor'))
assert.ok(!/class="[^"]*ss-/.test(textsSent[sheet.description.summary]), 'no span of the app\'s to act on')
assert.ok(textsSent[sheet.description.summary].includes('DC 15 DEX'))
const { SheetTexts, textOf } = await import(`${MODULE}/scripts/sheet-texts.mjs`)
const html = party.system.description.full
const asCharacter = new SheetTexts()
const own = asCharacter.add({ html, relativeTo: party })
assert.ok((await textOf(own, asCharacter.sources.get(own))).includes('The cult paid them'), "the same HTML, as a character's: with its secret")
assert.notEqual(own, sheet.description.full, 'the two never share a hash')
// Each option counts in the hash on its own (the 0.30.0 contract §3.3): without secrets alone, or with no
// links to act on alone, never names the text of the same HTML made otherwise.
const hashWith = options => new SheetTexts(options).add({ html, relativeTo: party })
assert.notEqual(hashWith({ secrets: false }), hashWith({}), 'secrets alone change the hash')
assert.notEqual(hashWith({ secrets: false, actionable: false }), hashWith({ actionable: false }), 'secrets change it with no links to act on too')
assert.notEqual(hashWith({ actionable: false }), hashWith({}), 'links to act on alone change the hash')
const summary = asCharacter.add({ html: party.system.description.summary, relativeTo: party })
assert.match(await textOf(summary, asCharacter.sources.get(summary)), /class="ss-save roll"/, "a character's: a link to act on")
// A character's hash, as 0.29.0 made it, byte for byte.
const { SheetTexts: OldTexts } = await import(`${oldModule('0.29.0')}/scripts/sheet-texts.mjs`)
for (const [source, why] of [[{ html, relativeTo: party }, 'a description'], [{ html: '<p>Take [[/save dex dc=15]].</p>', relativeTo: thorin }, 'one with a save'], [{ reference: 'Compendium.rules.JournalEntryPage.prone' }, 'a reference']]) {
  assert.equal(new SheetTexts().add(source), new OldTexts().add(source), `${why}: a character's hash unchanged`)
}
assert.ok(enriched.some(options => options.secrets === false), 'enriched without secrets')
ok("a group's descriptions and its items' are sent without their secrets, and with no link to act on; the same HTML on a character keeps both, under another hash; and every character's hash is 0.29.0's, byte for byte")

// ---- A private group ----
const privateOne = updates[1]
assert.deepEqual(privateOne.data.group, { ...groupEntry(secretive, getCampaigns()[1]), sheet: null, sheetWithheld: { reason: 'private' } })
assert.equal(posts.filter(e => (e.type === 'character.texts') && (e.campaign.id === 'camp-b')).length, 0, 'no texts')
assert.ok(!JSON.stringify(posts.filter(e => e.campaign?.id === 'camp-b')).includes('Unseen'))
ok("a group no campaign character's player may see in Foundry goes with no sheet, `private`, and no descriptions")

// ---- Hooks ----
const changed = async (fn, why) => {
  await fn()
  await settle()
  return take().filter(e => (e.type === 'group.updated') && (e.campaign.id === 'camp-a')).map(e => e.data.group)
}
let told = await changed(() => Hooks.callAll('createItem', item(party, 'map', 'loot', 'Map')))
assert.equal(told.length, 1, 'an item created')
told = await changed(() => { party.items.get('map').name = 'Old Map'; return Hooks.callAll('updateItem', party.items.get('map'), { name: 'Old Map' }) })
assert.equal(told.length, 1, 'an item changed')
told = await changed(() => { party.items.get('rope').system.container = 'bag'; return Hooks.callAll('updateItem', party.items.get('rope'), { system: { container: 'bag' } }) })
assert.ok(told[0].sheet.inventory.containers[0].contents.some(c => c.id === 'rope'), 'moved into a container')
told = await changed(() => { const map = party.items.get('map'); party.items.map.delete('map'); return Hooks.callAll('deleteItem', map) })
assert.equal(told.length, 1, 'an item deleted')
told = await changed(() => { thorin.system.attributes.hp.value = 3; return Hooks.callAll('updateActor', thorin, { system: { attributes: { hp: { value: 3 } } } }) })
assert.equal(told.length, 0, "a member's hit points: nothing")
told = await changed(() => { thorin.name = 'Thorin Oakenshield'; return Hooks.callAll('updateActor', thorin, { name: 'Thorin Oakenshield' }) })
assert.deepEqual(told.map(g => g.sheet.members.find(m => m.id === 'thorin').name), ['Thorin Oakenshield'], "a member's name")
told = await changed(() => { ghost.testUserPermission = (u) => u.id === 'dave'; ghost.hasPlayerOwner = true; return Hooks.callAll('updateActor', ghost, { ownership: { dave: 3 } }) })
assert.equal(told.length, 1, "a campaign character's ownership: every group of its campaign")
assert.equal(told[0].access.ghost, undefined, 'Dave has none on the group')
told = await changed(() => Hooks.callAll('updateActor', ghost, { name: 'Ghost' }))
assert.equal(told.length, 0, 'any other change to a character in no group: nothing')
ok("a group is sent again when one of its items is made, changed, moved or deleted, and when a member's name changes, or a campaign character's ownership; a member's hit points changing sends nothing")

primary = 'band'
told = await changed(() => Hooks.callAll('updateSetting', { key: 'dnd5e.primaryParty' }))
assert.deepEqual(told.map(g => [g.id, g.primary]), [['party', false]])
primary = 'party'
told = await changed(() => Hooks.callAll('createSetting', { key: 'dnd5e.primaryParty' }))
assert.deepEqual(told.map(g => [g.id, g.primary]), [['party', true]])
told = await changed(() => Hooks.callAll('updateSetting', { key: 'dnd5e.levelingMode' }))
assert.equal(told.length, 0, 'leveling mode is never read')
ok("the world's primary party changing sends every group, saying which is; its leveling mode isn't watched")

// A token portrait, where the group shows them; never a random one.
party.flags = { dnd5e: { showTokenPortrait: true } }
vex.prototypeToken = { texture: { src: 'tokens/vex.webp' }, randomImg: true }
told = await changed(() => Hooks.callAll('updateActor', party, { flags: { dnd5e: { showTokenPortrait: true } } }))
assert.deepEqual(told[0].sheet.members.map(m => m.img), ['tokens/anna.webp', 'tokens/thorin.webp', 'tokens/vex.webp', 'tokens/wolf.webp', 'tokens/cart.webp'])
ok("where the group shows token portraits, each member's token's image, never one of its random images")

// Deleting a member, then the group.
told = await changed(() => { actors.delete('wolf'); return Hooks.callAll('deleteActor', wolf) })
assert.equal(told.length, 1, 'a member deleted: its group sent again')
assert.ok(!told[0].sheet.members.some(m => m.id === 'wolf'))
// A campaign character in no group deleted: every group of its campaign, for who may see it, as its
// players may see them no longer through it (Keeper, a Gamemaster's, sees the party by its default).
assert.equal(groupEntry(party, campaignA()).access.keeper, 'observer')
told = await changed(() => { actors.delete('keeper'); return Hooks.callAll('deleteActor', keeper) })
assert.equal(told.length, 1, 'a campaign character deleted: its campaign\'s groups sent again')
assert.ok(!('keeper' in told[0].access), JSON.stringify(told[0].access))
assert.equal(told[0].access.shared, 'owner', 'the others as they were')
actors.set('keeper', keeper)
actors.delete('party')
await Hooks.callAll('deleteActor', party)
await settle()
posts = take()
assert.deepEqual(groupsIn(posts).map(e => [e.type, e.campaign.id, e.data]), [['group.removed', 'camp-a', { id: 'party' }]])
actors.set('party', party)
ok("a member deleted sends its groups again without it, and a campaign character deleted its campaign's groups, without it in who may see them; a group deleted sends group.removed")

// ---- A group deleted while its campaign's hello is on its way ----
// The hello was built as it was queued, listing it, and the app keeps each group a hello lists, so
// its removal follows the hello: to an app that read groups, and to one whose answer to that hello
// is the first to say so.
const { helloPending } = await import(`${MODULE}/scripts/transport.mjs`)
for (const [n, [why, before]] of [['an app that read groups', { groups: 1 }], ['an app whose answer to the hello first says it reads them', {}]].entries()) {
  app.features = before
  announce({ campaignId: 'camp-a' })
  await settle()
  take()
  app.features = { groups: 1 }
  const fleeting = group(`fleeting${n}`, 'Fleeting', { members: [thorin], ownership: { alice: 2 } })
  settings.set('campaigns', settings.get('campaigns').map(c => (c.id === 'camp-a') ? { ...c, groups: [...c.groups, fleeting.id] } : c))
  let release
  app.hold = new Promise(resolve => { release = resolve })
  announce({ campaignId: 'camp-a' })
  await wait(5)
  assert.ok(helloPending('camp-a'), 'the hello on its way')
  actors.delete(fleeting.id)
  await Hooks.callAll('deleteActor', fleeting)
  await wait(5)
  release()
  await settle()
  posts = take().filter(e => e.campaign?.id === 'camp-a')
  const at = type => posts.findIndex(e => e.type === type)
  assert.deepEqual(posts[at('bridge.hello')].data.groups.map(g => g.id), ['party', fleeting.id], 'the hello lists it')
  assert.deepEqual(posts.filter(e => e.type === 'group.removed').map(e => e.data), [{ id: fleeting.id }], why)
  assert.ok(at('group.removed') > at('bridge.hello'), 'after the hello')
  assert.ok(!posts.some(e => (e.type === 'group.updated') && (e.data.group.id === fleeting.id)))
}
ok("a group deleted while its campaign's hello is on its way, which lists it, is removed after the hello, whether the app read groups before or its answer to that hello is the first to say so")

// ---- A hello's answer turning it on: after the characters ----
app.features = {}
announce()
await settle()
take()
app.features = { groups: 1 }
announce({ campaignId: 'camp-a' })
await settle()
posts = take().filter(e => e.campaign?.id === 'camp-a' && e.type !== 'character.texts')
const types = posts.map(e => e.type)
assert.equal(types[0], 'bridge.hello')
assert.equal(types.at(-1), 'group.updated', types.join(' '))
assert.ok(types.indexOf('group.updated') > types.lastIndexOf('character.updated'), 'after every character')
ok("an app that reads groups in a hello's answer is sent them after its characters")

// ---- Turned off ----
app.features = {}
now += 60_000
heartbeat()
await settle()
take()
told = await changed(() => Hooks.callAll('createItem', item(party, 'lamp', 'loot', 'Lamp')))
assert.equal(told.length, 0, 'turned off: nothing')
app.features = { groups: 1 }
now += 60_000
heartbeat()
await settle()
take()
ok('an app that stops saying it reads groups is sent none, until it says so again')

// ---- Slim, too large, and lost ----
app.features = { groups: 1, slimSheets: 1 }
now += 60_000
heartbeat()
await settle()
take()
told = await changed(() => Hooks.callAll('createItem', item(party, 'coin', 'loot', 'Lucky Coin')))
assert.equal(told[0].sheet.slim, 1, 'slim, where the app expands it')
const full = await (async () => { app.features = { groups: 1 }; now += 60_000; heartbeat(); await settle(); return take().find(e => (e.type === 'group.updated') && (e.campaign.id === 'camp-a'))?.data.group.sheet })()
assert.ok(full && !('slim' in full), 'full again once it says so no longer')
assert.deepEqual(expandSheet(structuredClone(told[0].sheet)), { ...full }, 'slim, expanded, is the full sheet')
for (let n = 0; n < 2500; n++) item(party, `junk${n}`, 'loot', `Junk ${'x'.repeat(400)} ${n}`)
told = await changed(() => Hooks.callAll('createItem', party.items.get('junk0')))
assert.equal(told[0].sheet, null)
assert.equal(told[0].sheetWithheld.reason, 'tooLarge')
assert.ok(told[0].sheetWithheld.bytes > told[0].sheetWithheld.limit)
for (let n = 0; n < 2500; n++) party.items.map.delete(`junk${n}`)
assert.ok(logged.some(line => line.includes('The sheet of The Company came to')), "the Gamemaster is told, in the module's own words")
told = await changed(() => Hooks.callAll('deleteItem', { parent: party }))
assert.ok(told[0].sheet, 'small again: sent')
ok("a group's sheet goes slim where the app expands it and back in full, and is withheld as too large, the Gamemaster told, as a character's is")

app.fail = envelope => envelope.type === 'group.updated'
told = await changed(() => Hooks.callAll('createItem', item(party, 'lost', 'loot', 'Lost Thing')))
assert.equal(told.length, 0, 'dropped')
app.fail = null
now += 31_000
heartbeat()
await settle()
assert.equal(take().filter(e => e.type === 'group.updated').length, 1, 'sent again after 30 seconds')
app.fail = envelope => envelope.type === 'group.removed'
const band2 = group('band2', 'Short-lived', { members: [thorin], ownership: { alice: 2 } })
settings.set('campaigns', settings.get('campaigns').map(c => (c.id === 'camp-a') ? { ...c, groups: [...c.groups, 'band2'] } : c))
actors.delete('band2')
await Hooks.callAll('deleteActor', band2)
await settle()
app.fail = null
take()
now += 31_000
heartbeat()
await settle()
assert.ok(take().some(e => (e.type === 'bridge.hello') && (e.campaign.id === 'camp-a')), 'a lost group.removed sends the hello again')
ok('a group.updated lost to failures that may not last is sent again some 30 seconds later; a group.removed lost, the hello')

// ---- Manage Campaigns: the Party tab ----
settings.set('chatEvents', true)
let win = await openSettings()
await view(win, 'campaign', { campaignId: 'camp-a', tab: 'party' })
assert.equal(find(win, '.sending-stone-tabs [data-tab="party"]').textContent.trim(), 'SENDINGSTONE.Config.Tabs.Party')
const tabs = [...win.element.querySelectorAll('.sending-stone-tabs [data-tab]')].map(b => b.dataset.tab)
assert.deepEqual(tabs, ['players', 'party', 'actions', 'connection'], 'Party between Players and Actions')
let rowsShown = [...win.element.querySelectorAll('[data-party-list] > li')]
assert.deepEqual(rowsShown.map(r => r.dataset.groupId), ['party'])
assert.ok(find(win, '[data-action="removeParty"]').getAttribute('aria-label').startsWith('SENDINGSTONE.Config.Party.Remove'))
assert.ok(win.element.querySelector('[data-party-seen]'))
assert.ok(win.element.querySelector('[data-results]').textContent.startsWith('SENDINGSTONE.Results.Lead'))
await click(win, '[data-action="openPartyPicker"]')
const picks = [...win.element.querySelectorAll('[data-pick-party]')]
assert.deepEqual(picks.map(box => [box.dataset.pickParty, box.disabled]), [['party', true], ['band', false], ['secretive', false]], 'the primary party first, those already in disabled')
assert.ok(find(win, '[data-action="addPickedParties"]').disabled, 'nothing picked')
const secretBox = picks[2]
secretBox.checked = true
secretBox.dispatchEvent(new win.element.ownerDocument.defaultView.Event('change', { bubbles: true }))
assert.equal(find(win, '[data-action="addPickedParties"]').disabled, false)
await click(win, '[data-action="addPickedParties"]')
rowsShown = [...win.element.querySelectorAll('[data-party-list] > li')]
assert.deepEqual(rowsShown.map(r => r.dataset.groupId), ['party', 'secretive'])
assert.ok(rowsShown[1].querySelector('[data-party-warning]'), 'no player may see it: the warning, in its row')
assert.ok(!rowsShown[0].querySelector('[data-party-warning]'))
await click(win, '[data-action="removeParty"][data-group-id="party"]')
assert.deepEqual([...win.element.querySelectorAll('[data-party-list] > li')].map(r => r.dataset.groupId), ['secretive'])
// The verdict line follows dnd5e's settings while the window is open, drawing nothing again.
const renders = win.renders
const line = win.element.querySelector('[data-results]')
const before = line.textContent
settings.set('attackRollVisibility', 'all')
await Hooks.callAll('updateSetting', { key: 'dnd5e.attackRollVisibility' })
assert.notEqual(win.element.querySelector('[data-results]').textContent, before, 'rewritten')
assert.equal(win.renders, renders, 'not drawn again')
await save(win)
assert.deepEqual(settings.get('campaigns')[0].groups, ['secretive'], 'saved, existing groups alone')
// A world with no group actors.
win = await openSettings()
const saved = [...actors.entries()].filter(([, a]) => a.type === 'group')
for (const [id] of saved) actors.delete(id)
await view(win, 'campaign', { campaignId: 'camp-a', tab: 'party' })
await click(win, '[data-action="openPartyPicker"]')
assert.equal(find(win, '[data-party-picker-empty]').textContent.trim(), 'SENDINGSTONE.Config.Party.NoGroups')
for (const [id, a] of saved) actors.set(id, a)
await win.close()
// Under another system, no Party tab.
game.system.id = 'pf2e'
win = await openSettings()
await view(win, 'campaign', { campaignId: 'camp-a' })
assert.equal(win.element.querySelector('.sending-stone-tabs [data-tab="party"]'), null)
await win.close()
game.system.id = 'dnd5e'
ok("Manage Campaigns' Party tab, between Players and Actions, lists a campaign's groups with whom they're seen by, or a warning in the row where no player may see one; adds them from a picker, the primary party first, and removes them; its header's line of what players see follows dnd5e's settings without drawing again; saves existing groups alone; none under another system")

console.log(`groups${DND5E6 ? ' (dnd5e 6)' : ''}: done`)
process.exit(0)
