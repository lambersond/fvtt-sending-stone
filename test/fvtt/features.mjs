// Step 1 of the fuller sheet: features, conditions and effects in the sheet, and their
// descriptions sent apart in character.texts, under dnd5e 5.3 and 6.0 shaped data.
import assert from 'node:assert/strict'
import { actor, posts, settings, user, users } from './stub.mjs'

const MODULE = process.env.MODULE_DIR
const ok = msg => console.log('ok -', msg)
const take = () => posts.splice(0).map(p => p.envelope)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
// Wait until the posts so far pass a test: normalising descriptions' links with jsdom takes a while
// the first time, and with long descriptions.
const until = async (test, ms = 5000) => { const end = Date.now() + ms; while (!test(posts.map(p => p.envelope)) && Date.now() < end) await wait(10) }
const posted = (type, count = 2) => sent => sent.filter(e => e.type === type).length >= count
foundry.utils.getProperty = (object, path) => path.split('.').reduce((o, key) => o?.[key], object)

// ---- dnd5e 5.3's configuration and translations ----
const translations = {
  'DND5E.FeaturesBackground': 'Background Features', 'DND5E.FeaturesOther': 'Other Features',
  'DND5E.Species.Features': 'Species Features',
  'DND5E.EffectTemporary': 'Temporary Effects', 'DND5E.EffectPassive': 'Passive Effects',
  'DND5E.EffectInactive': 'Inactive Effects', 'DND5E.EffectUnavailable': 'Unavailable Effects',
  'DND5E.USES.Recovery.Period.LongRest.Label': 'Long Rest', 'DND5E.USES.Recovery.Period.ShortRest.Label': 'Short Rest',
  'DND5E.ConPoisoned': 'Poisoned', 'DND5E.ConExhaustion': 'Exhaustion', 'EFFECT.DND5E.StatusConcentrating': 'Concentrating',
  'TYPES.Item.subclass': 'Subclass',
}
game.i18n.localize = key => translations[key] ?? key
game.i18n.has = key => key in translations
game.i18n.format = (key, data) => key === 'DND5E.FeaturesClass' ? `${data.class} Features` : key
const RULES = 'Compendium.dnd5e.rules.JournalEntry.rules.JournalEntryPage'
CONFIG.DND5E = {
  abilities: { str: { label: 'Strength', abbreviation: 'str' } },
  skills: {},
  conditionTypes: {
    poisoned: { name: 'DND5E.ConPoisoned', img: 'icons/poisoned.svg', reference: `${RULES}.poisoned` },
    exhaustion: { name: 'DND5E.ConExhaustion', img: 'icons/exhaustion.svg', reference: `${RULES}.exhaustion`, levels: 6 },
  },
  limitedUsePeriods: { lr: { label: 'DND5E.USES.Recovery.Period.LongRest.Label' }, sr: { label: 'DND5E.USES.Recovery.Period.ShortRest.Label' } },
}
CONFIG.statusEffects = [
  { id: 'poisoned', name: 'DND5E.ConPoisoned', img: 'icons/poisoned.svg', reference: `${RULES}.poisoned` },
  { id: 'exhaustion', name: 'DND5E.ConExhaustion', img: 'icons/exhaustion.svg', reference: `${RULES}.exhaustion` },
  { id: 'concentrating', name: 'EFFECT.DND5E.StatusConcentrating', img: 'icons/concentrating.svg' },
]
CONFIG.specialStatusEffects = { CONCENTRATING: 'concentrating' }
CONFIG.Item = { typeLabels: { subclass: 'TYPES.Item.subclass' } }
const staticID = id => id.padEnd(16, '0').slice(0, 16)
globalThis.dnd5e = { utils: { staticID } }

// Enrichment: links and rolls become HTML; anything marked BROKEN fails.
const enrichCalls = []
let enrichDelay = 0
foundry.applications.ux.TextEditor = { implementation: { async enrichHTML(html, options) {
  enrichCalls.push({ html, options })
  await wait(enrichDelay)
  if (html.includes('BROKEN')) throw new Error('cannot enrich')
  return html.replace(/@UUID\[[^\]]+\]\{([^}]+)\}/g, '<a class="content-link">$1</a>')
    .replace(/\[\[\/(\w+) ([^\]]+)\]\]/g, '<a class="roll-link">$2</a>')
} } }
const documents = new Map()
globalThis.fromUuid = async uuid => uuid.startsWith(RULES) ? { uuid, text: { content: `<p>The rules for ${uuid.split('.').at(-1)}.</p>` } } : null
globalThis.fromUuidSync = uuid => documents.get(uuid) ?? null

// ---- Thorin, a dwarf fighter and rogue, under dnd5e 5.3 ----
const gm = user('gm', 'Gamemaster', true)
users.activeGM = gm
user('alice', 'Alice'); user('bob', 'Bob')
const thorin = actor('thorin', 'Thorin', ['alice'], 'character', { value: 31, max: 44, temp: 0 })
thorin.documentName = 'Actor'
thorin.system = {
  abilities: { str: { value: 18, mod: 4, proficient: 1, save: { value: 7 }, check: {} } },
  skills: {},
  attributes: { hp: { value: 31, max: 44, temp: 0 }, ac: { value: 18 }, prof: 3, init: { total: 2 }, movement: { speed: 25, units: 'ft' }, exhaustion: 2 },
  details: { level: 5 },
}
const items = new Map()
thorin.items = { get: id => items.get(id), [Symbol.iterator]: () => items.values() }
const item = (id, type, name, { system = {}, flags = {}, labels = {}, ...fields } = {}) => {
  const it = {
    documentName: 'Item', id, uuid: `Actor.thorin.Item.${id}`, type, name, img: `icons/${id}.webp`, sort: 0,
    parent: thorin, actor: thorin, labels, system: { description: { value: '' }, ...system },
    getFlag: (scope, key) => flags[scope]?.[key], getRollData: () => ({ mod: 4 }), ...fields,
  }
  items.set(id, it)
  return it
}
const fighter = item('fighter', 'class', 'Fighter', { identifier: 'fighter', system: { levels: 4, hd: { denomination: 'd10', value: 3, max: 4 }, description: { value: '<p>A master of martial combat.</p>' } } })
const rogue = item('rogue', 'class', 'Rogue', { identifier: 'rogue', system: { levels: 1, hd: { denomination: 'd8', value: 1, max: 1 } } })
const champion = item('champion', 'subclass', 'Champion', { identifier: 'champion', sort: 3, class: fighter, flags: { dnd5e: { advancementOrigin: 'fighter.subclass' } }, system: { description: { value: '<p>Raw physical power.</p>' } } })
fighter.subclass = champion
const dwarf = item('dwarf', 'race', 'Dwarf', { system: { description: { value: '<p>Bold and hardy.</p>' } } })
const soldier = item('soldier', 'background', 'Soldier', { system: { description: { value: '<p>War has been your life.</p>' } } })
thorin.system.details.race = dwarf
thorin.system.details.background = soldier
const activities = n => ({ size: n })
const secondWind = item('second-wind', 'feat', 'Second Wind', {
  sort: 2, flags: { dnd5e: { advancementOrigin: 'fighter.abc' } }, labels: { activation: '1 Bonus Action' },
  system: { type: { label: 'Class Feature' }, requirements: 'Fighter 1', activities: activities(1), properties: new Set(),
    uses: { max: 1, spent: 0, value: 1, recovery: [{ period: 'sr' }, { period: 'lr' }] },
    description: { value: '<p>Regain [[/heal 1d10 + @classes.fighter.levels]] hit points.</p>' } },
})
item('action-surge', 'feat', 'Action Surge', {
  sort: 1, flags: { dnd5e: { advancementRoot: 'fighter.def' } }, labels: { activation: 'Special' },
  system: { type: { label: 'Class Feature' }, activities: activities(1), properties: new Set(),
    uses: { max: 1, spent: 1, recovery: [{ period: 'sr' }] }, description: { value: '<p>Take one more action.</p>' } },
})
item('sneak-attack', 'feat', 'Sneak Attack', {
  flags: { dnd5e: { advancementOrigin: 'rogue.abc' } },
  system: { type: { label: 'Class Feature' }, activities: activities(0), properties: new Set(), description: { value: '<p>Once per turn, deal extra damage.</p>' } },
})
item('resilience', 'feat', 'Dwarven Resilience', {
  flags: { dnd5e: { advancementOrigin: 'dwarf.abc' } },
  system: { type: { label: 'Species Feature' }, activities: activities(1), properties: new Set(['trait']), description: { value: '<p>See @UUID[Compendium.dnd5e.rules.poisoned]{Poisoned}.</p><section class="secret"><p>A secret.</p></section>' } },
})
item('rank', 'feat', 'Military Rank', {
  flags: { dnd5e: { advancementRoot: 'soldier.abc' } },
  system: { type: { label: 'Background Feature' }, activities: activities(0), properties: new Set(), description: { value: '<p>Soldiers still recognize your rank.</p>' } },
})
item('lucky', 'feat', 'Lucky', {
  labels: { activation: 'Special' },
  system: { type: { label: 'Feat' }, activities: activities(1), properties: new Set(), uses: { max: 3, spent: 1, value: 2, recovery: [{ period: 'lr' }] }, description: { value: '' } },
})
item('breath', 'feat', 'Mountain Breath', {
  labels: { activation: '1 Action', recharge: 'Recharge [5–6]' },
  system: { type: { label: 'Feat' }, activities: activities(1), properties: new Set(), uses: { max: 1, value: 0, recovery: [{ period: 'recharge', formula: '5' }] }, description: { value: '<p>BROKEN [[/damage 2d6]]</p>' } },
})
const ring = item('ring', 'equipment', 'Ring of Protection', { system: { identified: true } })
const cloak = item('cloak', 'equipment', 'Cloak of Elvenkind', { system: { identified: true } })
const cursed = item('cursed', 'equipment', 'Unidentified Ring', { system: { identified: false } })
const blessFromVex = { documentName: 'Item', name: 'Bless', uuid: 'Actor.vex.Item.bless' }
documents.set(blessFromVex.uuid, blessFromVex)
const bless = item('bless', 'spell', 'Bless')
const byType = {}
for (const it of items.values()) (byType[it.type] ??= []).push(it)
thorin.itemTypes = byType

const effect = (id, name, fields = {}) => ({
  id, name, img: `icons/${id}.webp`, parent: thorin, type: 'base', origin: null, description: '',
  disabled: false, isSuppressed: false, isTemporary: false, statuses: new Set(),
  duration: { remaining: null, label: '', value: null }, updateDuration() { this.updated = true }, ...fields,
})
const thorinEffects = [
  effect(staticID('dnd5epoisoned'), 'Poisoned', { statuses: new Set(['poisoned']) }),
  effect(staticID('dnd5eexhaustion'), 'Exhaustion', { statuses: new Set(['exhaustion']) }),
  effect('concentration', 'Concentrating', { statuses: new Set(['concentrating']), isTemporary: true, origin: 'Actor.thorin.Item.bless', duration: { remaining: 60, label: '1 Minute', value: 1 } }),
  effect('blessed', 'Bless', { isTemporary: true, origin: 'Actor.vex.Item.bless', description: '<p>Add [[/roll 1d4]] to attacks.</p>', duration: { remaining: 9, label: '9 Rounds', value: 10 } }),
  effect('protection', 'Ring of Protection', { parent: ring, description: '<p>+1 to AC and saves.</p>' }),
  effect('elvenkind', 'Elvenkind', { parent: cloak, isSuppressed: true }),
  effect('rage', 'Rage', { disabled: true }),
  effect('curse', 'Curse of Clumsiness', { parent: cursed, description: '<p>The real curse.</p>' }),
  effect('keen', 'Keen Edge', { isAppliedEnchantment: true }),
  effect('ward', 'Ward', { dependentOrigin: { active: false } }),
]
thorin.allApplicableEffects = function* () { yield* thorinEffects }
thorin.statuses = new Set(['poisoned', 'exhaustion', 'concentrating', 'unknown-status'])
thorin.concentration = { items: new Set([bless]), effects: new Set() }

await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('campaigns', [
  { id: 'camp-a', title: 'Erebor', characters: ['thorin'] },
  { id: 'camp-b', title: 'Mirkwood', characters: ['thorin'] },
])
await Hooks.callAll('ready')
await until(posted('character.updated'))

// ---- bridge.hello, then each character's descriptions, then its sheet ----
const hellos = take()
const forCampaign = id => hellos.filter(e => e.campaign.id === id).map(e => e.type)
assert.deepEqual(forCampaign('camp-a').filter(t => t !== 'bridge.heartbeat'), ['bridge.hello', 'character.texts', 'character.updated'])
assert.deepEqual(forCampaign('camp-b').filter(t => t !== 'bridge.heartbeat'), ['bridge.hello', 'character.texts', 'character.updated'])
const hello = hellos.find(e => e.type === 'bridge.hello' && e.campaign.id === 'camp-a')
const update = hellos.find(e => e.type === 'character.updated' && e.campaign.id === 'camp-a')
const textsEvent = hellos.find(e => e.type === 'character.texts' && e.campaign.id === 'camp-a')
assert.equal(textsEvent.sequence, null, 'descriptions are not part of the event stream')
assert.equal(typeof hello.sequence, 'number')
assert.equal(update.sequence, hello.sequence + 1)
assert.ok(hello.data.characters.every(c => !('sheet' in c)))
const sheet = update.data.character.sheet
const texts = textsEvent.data.texts
ok("each campaign is sent its hello, then each character's descriptions in character.texts, then its sheet")

assert.deepEqual(JSON.parse(JSON.stringify(sheet)), sheet)
assert.ok(!JSON.stringify(sheet).includes('{}'), 'no Set turned into {}')
ok('the sheet is plain JSON: no Sets, Infinity or undefined')

// ---- classes and features ----
assert.deepEqual(sheet.classes, [
  { id: 'fighter', identifier: 'fighter', name: 'Fighter', levels: 4, subclass: 'Champion', hitDice: { die: 'd10', value: 3, max: 4 } },
  { id: 'rogue', identifier: 'rogue', name: 'Rogue', levels: 1, subclass: null, hitDice: { die: 'd8', value: 1, max: 1 } },
])
ok('classes carry their hit dice: size, left and most')

assert.deepEqual(sheet.features.map(s => [s.id, s.label, s.features.map(f => f.name)]), [
  ['fighter', 'Fighter Features', ['Action Surge', 'Second Wind', 'Champion']],
  ['rogue', 'Rogue Features', ['Sneak Attack']],
  ['species', 'Species Features', ['Dwarven Resilience']],
  ['background', 'Background Features', ['Military Rank']],
  ['other', 'Other Features', ['Lucky', 'Mountain Breath']],
])
ok("features are grouped as dnd5e groups them: by the class, species or background that granted each, then other")

const feature = name => sheet.features.flatMap(s => s.features).find(f => f.name === name)
assert.deepEqual({ ...feature('Second Wind'), text: undefined }, {
  id: 'second-wind', name: 'Second Wind', img: 'icons/second-wind.webp', kind: 'Class Feature', requirements: 'Fighter 1',
  activation: '1 Bonus Action', passive: false, uses: { value: 1, max: 1, recovery: 'Short Rest, Long Rest', counter: { item: 'second-wind' }, spendable: true }, text: undefined,
})
assert.deepEqual(feature('Action Surge').uses, { value: 0, max: 1, recovery: 'Short Rest', counter: { item: 'action-surge' }, spendable: true }, 'uses left worked out from those spent')
assert.deepEqual(feature('Mountain Breath').uses, { value: 0, max: 1, recovery: 'Recharge [5–6]', counter: { item: 'breath' }, spendable: true })
assert.equal(feature('Sneak Attack').uses, null)
assert.equal(feature('Sneak Attack').passive, true, 'nothing to use: passive')
assert.equal(feature('Dwarven Resilience').passive, true, 'a trait: passive')
assert.equal(feature('Champion').kind, 'Subclass')
assert.equal(feature('Lucky').text, null, 'no description, no text')
ok('a feature has its kind, requirements, activation, uses left and when they come back, and whether it is passive')

// ---- conditions ----
assert.deepEqual(sheet.conditions.map(({ text, ...c }) => c), [
  { id: 'concentrating', name: 'Concentrating', img: 'icons/concentrating.svg', level: null, detail: 'Bless' },
  { id: 'exhaustion', name: 'Exhaustion', img: 'icons/exhaustion.svg', level: 2, detail: null },
  { id: 'poisoned', name: 'Poisoned', img: 'icons/poisoned.svg', level: null, detail: null },
])
assert.equal(sheet.conditions[0].text, null, 'no rules reference, no text')
assert.equal(texts[sheet.conditions[2].text], '<p>The rules for poisoned.</p>')
ok("conditions come from the character's statuses: exhaustion with its level, concentration with what it's on, each with its rules")

// ---- effects ----
assert.deepEqual(sheet.effects.map(c => [c.id, c.label, c.effects.map(e => e.name)]), [
  ['temporary', 'Temporary Effects', ['Concentrating', 'Bless']],
  ['passive', 'Passive Effects', ['Ring of Protection']],
  ['inactive', 'Inactive Effects', ['Rage']],
  ['suppressed', 'Unavailable Effects', ['Elvenkind']],
])
ok("effects are sorted into dnd5e's categories; conditions, enchantments, and what dnd5e hides from players are left out")
const fx = name => sheet.effects.flatMap(c => c.effects).find(e => e.name === name)
assert.deepEqual({ ...fx('Bless'), text: undefined }, { id: 'blessed', name: 'Bless', img: 'icons/blessed.webp', source: 'Bless', duration: '9 Rounds', disabled: false, text: undefined })
assert.equal(fx('Concentrating').duration, '1 Minute')
assert.equal(fx('Concentrating').source, null, "the Bless item isn't a known document here, so no source")
assert.deepEqual([fx('Ring of Protection').id, fx('Ring of Protection').source, fx('Ring of Protection').duration], ['ring.protection', 'Ring of Protection', null])
assert.equal(fx('Rage').disabled, true)
assert.ok(thorinEffects.every(e => e.updated || e.isAppliedEnchantment || e.dependentOrigin || e.parent === cursed), 'durations are brought up to date first')
ok('an effect has where it comes from, the time it has left, and an id unique across items')

// ---- the descriptions ----
const refs = [
  ...sheet.features.flatMap(s => [s.text, ...s.features.map(f => f.text)]),
  ...sheet.effects.flatMap(c => c.effects.map(e => e.text)),
  ...sheet.conditions.map(c => c.text),
].filter(Boolean)
assert.deepEqual(new Set(Object.keys(texts)), new Set(refs), 'the texts are exactly those the sheet refers to')
assert.ok(refs.every(hash => /^[0-9a-f]{14}$/.test(hash)))
assert.equal(texts[feature('Dwarven Resilience').text], '<p>See <a class="content-link">Poisoned</a>.</p><section class="secret"><p>A secret.</p></section>')
// Since 0.17.0 a roll link the app can't act on is its text, and what dnd5e didn't enrich is
// reduced to its words: only what acts looks like it does (sheet-links.mjs).
assert.equal(texts[feature('Second Wind').text], '<p>Regain 1d10 + @classes.fighter.levels hit points.</p>')
assert.equal(texts[feature('Mountain Breath').text], '<p>BROKEN 2d6</p>', 'a description that cannot be enriched goes as stored, [[/damage 2d6]] as its formula')
assert.equal(texts[sheet.features.find(s => s.id === 'species').text], '<p>Bold and hardy.</p>')
assert.ok(!Object.values(texts).some(html => html.includes('real curse')), "an unidentified item's effect is not described")
const call = enrichCalls.find(c => c.html.includes('Regain'))
assert.equal(call.options.secrets, true)
assert.equal(call.options.relativeTo, secondWind)
assert.deepEqual(call.options.rollData, { mod: 4 })
ok("descriptions are enriched as the character's player sees them, secrets included, with the item's roll data")

const enrichedBefore = enrichCalls.length
const campB = hellos.find(e => e.type === 'character.texts' && e.campaign.id === 'camp-b').data.texts
assert.deepEqual(campB, texts)
assert.equal(enrichedBefore, Object.keys(texts).length, 'each description is enriched once, however many campaigns it goes to')
ok('a character in two campaigns has its descriptions sent to both, enriched once')

// ---- character.updated: descriptions only when new ----
thorin.system.attributes.hp.value = 20
await Hooks.callAll('updateActor', thorin, {})
await wait(350)
let sent = take()
assert.deepEqual(sent.map(e => e.type), ['character.updated', 'character.updated'])
ok('a change that adds no description sends only character.updated')

items.get('lucky').system.description.value = '<p>Three times a day, reroll a d20.</p>'
await Hooks.callAll('updateItem', items.get('lucky'), {})
await wait(350)
sent = take()
assert.deepEqual(sent.map(e => [e.campaign.id, e.type]), [
  ['camp-a', 'character.texts'], ['camp-a', 'character.updated'],
  ['camp-b', 'character.texts'], ['camp-b', 'character.updated'],
])
const luckyText = sent[1].data.character.sheet.features.find(s => s.id === 'other').features[0].text
assert.deepEqual(sent[0].data.texts, { [luckyText]: '<p>Three times a day, reroll a d20.</p>' })
ok('a new description is sent once to each campaign, just before the sheet that refers to it')

// A description with rolls, which may show the character's numbers, changes with them.
const before = feature('Second Wind').text
thorin.system.abilities.str.mod = 5
await Hooks.callAll('updateActor', thorin, {})
await wait(350)
sent = take()
const changed = sent.find(e => e.type === 'character.updated').data.character.sheet.features.flatMap(s => s.features)
const named = name => changed.find(f => f.name === name).text
assert.notEqual(named('Second Wind'), before)
assert.equal(named('Dwarven Resilience'), feature('Dwarven Resilience').text, 'a link is not a roll')
// Since 0.17.0 an effect's description finds its actor through its parent, so Bless's roll, on
// the character, changes with its numbers too.
const blessText = sent.find(e => e.type === 'character.updated').data.character.sheet.effects.flatMap(c => c.effects).find(e => e.name === 'Bless').text
assert.notEqual(blessText, fx('Bless').text)
assert.deepEqual(new Set(Object.keys(sent.find(e => e.type === 'character.texts').data.texts)), new Set([named('Second Wind'), named('Mountain Breath'), blessText]))
ok("descriptions with rolls are sent again when the character's numbers change, and only those")

// ---- effects running down ----
thorinEffects[3].duration = { remaining: 8, label: '8 Rounds', value: 10 }
await Hooks.callAll('updateCombat', {}, { round: 2 })
await wait(350)
sent = take()
assert.deepEqual(sent.map(e => e.type), ['character.updated', 'character.updated'])
assert.equal(sent[0].data.character.sheet.effects[0].effects[1].duration, '8 Rounds')
await Hooks.callAll('updateWorldTime', 100, 6)
await wait(350)
assert.equal(take().length, 0, 'time passing without changing a duration sends nothing')
await Hooks.callAll('updateCombat', {}, { active: true })
await wait(350)
assert.equal(take().length, 0)
ok('a new round or turn, or time passing, sends a character whose temporary effects ran down')

// ---- order: slow descriptions keep their place in the queue ----
const { send } = await import(`${MODULE}/scripts/transport.mjs`)
const { sendCharacter } = await import(`${MODULE}/scripts/character-sync.mjs`)
const { getCampaigns } = await import(`${MODULE}/scripts/campaigns.mjs`)
enrichDelay = 150
items.get('rank').system.description.value = '<p>Soldiers salute you.</p>'
sendCharacter('thorin')
send('chat.message.created', { message: { id: 'm1' } }, getCampaigns()[0])
await wait(600)
sent = take()
assert.deepEqual(sent.map(e => [e.campaign.id, e.type]), [
  ['camp-a', 'character.texts'], ['camp-a', 'character.updated'],
  ['camp-b', 'character.texts'], ['camp-b', 'character.updated'],
  ['camp-a', 'chat.message.created'],
])
ok('descriptions that take a while to enrich keep their place: nothing queued after them overtakes them')
enrichDelay = 0

// ---- large descriptions are split, and a huge one cut short ----
for (const [id, letter] of [['rank', 'a'], ['sneak-attack', 'b'], ['resilience', 'c'], ['action-surge', 'd'], ['lucky', 'e']]) {
  items.get(id).system.description.value = `<p>${letter.repeat(90_000)}</p>`
}
items.get('second-wind').system.description.value = `<p>${'f'.repeat(250_000)}</p>`
sendCharacter('thorin')
await until(posted('character.updated'))
sent = take().filter(e => e.campaign.id === 'camp-a')
const chunks = sent.filter(e => e.type === 'character.texts')
assert.equal(chunks.length, 2)
assert.ok(chunks.every(e => JSON.stringify(e).length < 450_000))
assert.equal(Object.values(chunks.flatMap(e => Object.values(e.data.texts))).find(t => t.includes('fff')).length, 100_000)
assert.equal(sent.at(-1).type, 'character.updated')
ok('descriptions too big for one post are split across several, all before the sheet, and a huge one is cut short')

// ---- the listener asks for everything again ----
const { resendHello } = await import(`${MODULE}/scripts/bridge.mjs`)
resendHello('camp-a')
await until(posted('character.updated', 1))
sent = take()
assert.deepEqual(sent.map(e => e.type), ['bridge.hello', 'character.texts', 'character.texts', 'character.updated'])
const all = Object.assign({}, ...sent.filter(e => e.type === 'character.texts').map(e => e.data.texts))
const helloSheet = sent.at(-1).data.character.sheet
const helloRefs = [
  ...helloSheet.features.flatMap(s => [s.text, ...s.features.map(f => f.text)]),
  ...helloSheet.effects.flatMap(c => c.effects.map(e => e.text)),
  ...helloSheet.conditions.map(c => c.text),
].filter(Boolean)
assert.deepEqual(new Set(Object.keys(all)), new Set(helloRefs))
ok('a hello is followed by every description its sheets refer to, then the sheets')

// ---- dnd5e 6.0 ----
Object.assign(translations, {
  'DND5E.EFFECT.Category.Temporary': 'Temporary Effects (6)', 'DND5E.EFFECT.Category.Passive': 'Passive Effects (6)',
  'DND5E.EFFECT.Category.Inactive': 'Inactive Effects (6)', 'DND5E.EFFECT.Category.Unavailable': 'Unavailable Effects (6)',
  'DND5E.EFFECT.Expiry.Type.SourceEnd': "End of Source's Next Turn",
})
CONFIG.statusEffects = Object.fromEntries(CONFIG.statusEffects.map(({ id, ...rest }) => [id, rest]))
delete thorin.system.attributes.exhaustion
thorin.system.conditions = { exhaustion: 3 }
thorinEffects.splice(0, thorinEffects.length,
  effect('poison6', 'Poisoned', { type: 'condition', statuses: new Set(['poisoned']), duration: { remaining: 5, label: '5 Rounds', value: 5 } }),
  effect('conc6', 'Concentrating', { type: 'condition', statuses: new Set(['concentrating']), isTemporary: true,
    expirySupportsDuration: () => true, getDurationParts: () => ['1 Minute'], duration: { remaining: 60, value: 1 } }),
  effect('shield6', 'Shield', { isTemporary: true, expirySupportsDuration: () => false, specialDuration: 'sourceEnd', duration: { label: 'Special' } }),
  effect('old6', 'Faded Blessing', { isTemporary: true, duration: { expired: true, remaining: 0, value: 1 } }),
  effect('hidden6', 'Hidden Mark', { system: { isConcealed: true } }),
)
sendCharacter('thorin')
await wait(100)
const sheet6 = take().find(e => e.type === 'character.updated').data.character.sheet
assert.deepEqual(sheet6.effects.map(c => [c.label, c.effects.map(e => [e.name, e.duration])]), [
  ['Temporary Effects (6)', [['Concentrating', '1 Minute'], ['Shield', "End of Source's Next Turn"]]],
  ['Inactive Effects (6)', [['Faded Blessing', null]]],
])
assert.equal(sheet6.conditions.find(c => c.id === 'exhaustion').level, 3)
assert.equal(sheet6.conditions.find(c => c.id === 'poisoned').name, 'Poisoned', 'statuses described by an object keyed by id')
ok("dnd5e 6.0: condition effects stay with conditions, concentration shows as an effect, turn-based expiry is spelled out, expired effects are inactive, and concealed ones are hidden")

console.log('\nall step 1 checks passed')
