// The links in descriptions the app can act on (scripts/sheet-links.mjs), and the hashes and
// enrichment of the descriptions they are in (scripts/sheet-texts.mjs): dnd5e 5.3.3's enricher
// markup exactly as its enrichers.mjs builds it (saves, checks, damage), the sheet's tools, Foundry's inline rolls as documented, plain text
// from dnd5e's packs, forged spans, a game in French, long hostile inputs, and finding a link the
// way a command does. Run with --import ./unref-timers.mjs --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { actor, settings, user, users } from './stub.mjs'

import { DND5E5 } from './paths.mjs'
const MODULE = process.env.MODULE_DIR
const ok = msg => console.log('ok -', msg)
await import('./dice-core.mjs')
// dnd5e 5.3.3's real DamageRoll, which the module builds a damage link's parts with, to see that a
// player can throw their dice (module 0.21.0).
const { default: DamageRoll } = await import(`${DND5E5}/module/dice/damage-roll.mjs`)
CONFIG.Dice.DamageRoll = DamageRoll
foundry.utils.getProperty =(object, path) => path.split('.').reduce((o, key) => o?.[key], object)

// ---- dnd5e 5.3's configuration, its labels localized as dnd5e's preLocalize leaves them ----
const translations = {
  'DND5E.AbilityStr': 'Strength', 'DND5E.AbilityDex': 'Dexterity', 'DND5E.AbilityCon': 'Constitution',
  'DND5E.AbilityInt': 'Intelligence', 'DND5E.AbilityWis': 'Wisdom', 'DND5E.AbilityCha': 'Charisma',
  'DND5E.CurrencyAbbrGP': 'GP', 'DND5E.ConProne': 'Prone', 'DND5E.ConPoisoned': 'Poisoned',
}
game.i18n.localize = key => translations[key] ?? key
game.i18n.has = key => key in translations
const CONTENT24 = 'Compendium.dnd5e.content24.JournalEntry.phbAppendixCRule.JournalEntryPage'
const RULES14 = 'Compendium.dnd5e.rules.JournalEntry.w7eitkpD7QQTB6j0.JournalEntryPage'
const conditionTypes = {
  bleeding: { name: 'Bleeding', pseudo: true },
  blinded: { name: 'Blinded', reference: `${CONTENT24}.uDogReMO6QtH6NDw` },
  burning: { name: 'Burning', reference: `${CONTENT24}.mPBGM1vguT5IPzxT`, pseudo: true },
  charmed: { name: 'Charmed', reference: `${CONTENT24}.vLAsIUa0FhZNsyLk` },
  frightened: { name: 'Frightened', reference: `${CONTENT24}.93uaingTESo8N1qL` },
  incapacitated: { name: 'Incapacitated', reference: `${CONTENT24}.4i3G895hy99piand` },
  invisible: { name: 'Invisible', reference: `${CONTENT24}.MQIZ1zRLWRcNOtPN` },
  petrified: { name: 'Petrified', reference: `${CONTENT24}.6vtLuQT9lwZ9N299` },
  poisoned: { name: 'DND5E.ConPoisoned', reference: `${CONTENT24}.HWs8kEojffqwTSJz` },
  prone: { name: 'DND5E.ConProne', reference: `${CONTENT24}.QxCrRcgMdUd3gfzz` },
  restrained: { name: 'Restrained', reference: `${CONTENT24}.dqLeGdpHtb8FfcxX` },
  unconscious: { name: 'Unconscious', reference: `${CONTENT24}.fZCRaKEJd4KoQCqH` },
}
CONFIG.DND5E = {
  abilities: Object.fromEntries(['Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha'].map(a => [a.toLowerCase(), { label: `DND5E.Ability${a}`, abbreviation: a.toLowerCase() }])),
  damageTypes: Object.fromEntries(['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder']
    .map(t => [t, { label: t[0].toUpperCase() + t.slice(1) }])),
  healingTypes: { healing: { label: 'Healing' }, temphp: { label: 'Temporary HP' } },
  conditionTypes,
  currencies: { gp: { label: 'DND5E.CurrencyGP', abbreviation: 'DND5E.CurrencyAbbrGP' } },
  // dnd5e 5.3's skills and tools (config.mjs), as far as these use them, preLocalized, and a kind
  // of vehicle, a tool with no ability of its own.
  skills: Object.fromEntries([['acr', 'Acrobatics', 'dex'], ['ath', 'Athletics', 'str'], ['dec', 'Deception', 'cha'], ['ins', 'Insight', 'wis'],
    ['inv', 'Investigation', 'int'], ['per', 'Persuasion', 'cha'], ['prc', 'Perception', 'wis'], ['slt', 'Sleight of Hand', 'dex'], ['ste', 'Stealth', 'dex']]
    .map(([key, label, ability]) => [key, { label, ability }])),
  tools: { thief: { ability: 'dex', id: 'phbtulThievesToo' }, herb: { ability: 'int', id: 'phbtulHerbalismK' } },
  vehicleTypes: { water: 'Water Vehicle' },
}
const window = new JSDOM('').window
const unescape = globalThis.unescape

const { normaliseLinks, cleanLinks, readLink, findLink, originOf, MOST_LINKS } = await import(`${MODULE}/scripts/sheet-links.mjs`)
const { SheetTexts, textOf, hiddenDCsOf, textHash } = await import(`${MODULE}/scripts/sheet-texts.mjs`)

// What a normalised description holds: its spans of the app's, and its text.
const parse = html => new window.DOMParser().parseFromString(html, 'text/html').body
function spans(html) {
  return Array.from(parse(html).querySelectorAll('span[class*="ss-"]'), el => ({
    class: el.className, ...Object.fromEntries(Object.entries(el.dataset)), text: el.textContent,
  }))
}
const textOfHtml = html => parse(html).textContent
const norm = (html, options) => normaliseLinks(html, options)

// ---- dnd5e 5.3.3's markup (enrichers.mjs: createRollLink, createRequestLink, _addDataset) ----
const ICON = '<i class="fa-solid fa-dice-d20" inert=""></i>'
const REQUEST = '<a class="enricher-action" data-action="postRequest" data-tooltip="EDITOR.DND5E.Inline.RequestRoll" aria-label="Request Roll"><i class="fa-solid fa-comment-dots"></i></a>'
// Foundry wraps what an enricher with onRender makes (unverified: core isn't on this machine).
const wrap = html => `<enriched-content data-enricher-id="dnd5e-enricher">${html}</enriched-content>`
const request = (attrs, label) => wrap(`<span class="roll-link-group" ${attrs}><a class="roll-link" data-action="roll">${ICON}${label}</a>${REQUEST}</span>`)
const damage = (attrs, label) => wrap(`<a class="roll-link-group" data-action="roll" ${attrs}>${label}</a>`)
const formulaSpan = f => `<span class="roll-link">${ICON}${f}</span>`
const reference = (key, uuid, name, apply = true) => wrap(`<span class="reference-link"><a class="content-link" draggable="true" data-link="" data-uuid="${uuid}" data-id="${uuid.split('.').at(-1)}" data-type="JournalEntryPage" data-tooltip="Text Page"><i class="fas fa-book-open"></i>${name}</a>${apply ? `<a class="enricher-action" data-action="applyStatus" data-status="${key}" data-tooltip="" aria-label="Apply Status to Selected Tokens"><i class="fas fa-fw fa-reply-all fa-flip-horizontal"></i></a>` : ''}</span>`)
// Foundry's inline rolls, from its documented shape: [[/r …]] waits to be rolled; [[…]] was rolled
// as the description was enriched, its roll stored on the link.
const deferred = (formula, label = formula, mode = 'roll') => `<a class="inline-roll ${mode}" data-mode="${mode}" data-flavor="" data-formula="${formula}"><i class="fas fa-dice-d20"></i>${label}</a>`
const rolledRoll = (formula, total, label) => `<a class="inline-roll inline-result" data-tooltip-text="${formula}" data-roll="${escape(JSON.stringify({ class: 'Roll', options: {}, dice: [], formula, terms: [], total, evaluated: true }))}"><i class="fas fa-dice-d20"></i>${label ? `${label}: ${total}` : total}</a>`

// Items, spells, effects and the character, as far as a description's links read them.
const saveActivity = (ability, dc) => ({ type: 'save', save: { ability: new Set([ability].flat()), dc: { value: dc } } })
const activities = list => ({ getByType: type => list.filter(a => a.type === type), values: () => list.values() })
const thorin = {
  documentName: 'Actor', id: 'thorin', uuid: 'Actor.thorin', name: 'Thorin',
  system: { abilities: { str: { mod: 4 }, dex: { mod: 2 } }, attributes: { prof: 3, spell: { dc: 14 } }, details: { level: 5 } },
  getRollData() { return { prof: 3, mod: 4, abilities: { str: { mod: 4 } } } },
}
const wand = {
  documentName: 'Item', id: 'wand', uuid: 'Actor.thorin.Item.wand', name: 'Wand of Frost', type: 'equipment', parent: thorin,
  system: { identified: true, activities: activities([saveActivity('wis', 13), saveActivity(['str', 'dex'], 16)]) },
  getRollData() { return { ...thorin.getRollData(), item: { level: 1 } } },
}
const hiddenWand = { ...wand, id: 'hidden', uuid: 'Actor.thorin.Item.hidden', name: 'Strange Rod', system: { ...wand.system, identified: false } }

// ---- saving throws ----
{
  let html = norm(`<p>Make a ${request('data-type="save" data-ability="dex" data-dc="15"', 'DC 15 Dexterity')} saving throw.</p>`)
  assert.equal(html, '<p>Make a <span class="ss-save roll" data-n="0" data-ability="dex" data-dc="15">DC 15 Dexterity</span> saving throw.</p>')
  // [[/save str/dex 20]]: one link per ability inside the group, the GM's request link after them.
  html = norm(`<p>${request('data-type="save" data-ability="str|dex" data-dc="20"', '').replace(`<a class="roll-link" data-action="roll">${ICON}</a>`,
    `DC 20 <a class="roll-link" data-ability="str" data-action="roll">${ICON}Strength</a> or <a class="roll-link" data-ability="dex" data-action="roll">${ICON}Dexterity</a>`)}</p>`)
  assert.deepEqual(spans(html), [{ class: 'ss-save roll', n: '0', ability: 'str|dex', dc: '20', text: 'DC 20 Strength or Dexterity' }])
  // [[/save wis dc=@attributes.spell.dc]]: dnd5e resolved the DC with the roll data.
  assert.deepEqual(spans(norm(request('data-type="save" data-ability="wis" data-dc="14"', 'DC 14 Wisdom')))[0].dc, '14')
  // [[/save]] on an item: dnd5e linked its save activity, with its abilities and DC.
  assert.deepEqual(spans(norm(request('data-type="save" data-ability="con" data-dc="13" data-activity-uuid="Actor.thorin.Item.wand.Activity.abc"', 'DC 13 Constitution'))),
    [{ class: 'ss-save roll', n: '0', ability: 'con', dc: '13', text: 'DC 13 Constitution' }])
  // [[/save dex 15 format=long]]
  assert.equal(spans(norm(request('data-type="save" data-ability="dex" data-dc="15" data-format="long"', 'DC 15 Dexterity saving throw')))[0].text, 'DC 15 Dexterity saving throw')
  // [[/save dex 15 hideDC]]: its author hid the DC. It's never sent, but noted apart by its link's
  // number, for the module to roll against, as dnd5e does; so is a concentration check's.
  const hiddenDCs = new Map()
  html = norm(`<p>${request('data-type="save" data-ability="wis" data-dc="13"', 'DC 13 Wisdom')} then ${request('data-type="save" data-ability="dex" data-dc="17" data-hide-d-c="true"', 'Dexterity')}`
    + ` or ${request('data-type="concentration" data-dc="12" data-hide-d-c="true"', 'Concentration')}, and ${request('data-type="save" data-ability="str" data-hide-d-c="true"', 'Strength')}</p>`,
  { hiddenDCs })
  assert.deepEqual(spans(html).map(s => [s.n, s.ability, s.dc, s.type]), [['0', 'wis', '13', undefined], ['1', 'dex', undefined, undefined], ['2', undefined, undefined, 'concentration'], ['3', 'str', undefined, undefined]])
  assert.ok(!html.includes('17') && !html.includes('12') && !html.includes('hide'), html)
  assert.deepEqual([...hiddenDCs], [[1, 17], [2, 12]])
  assert.equal(spans(norm(request('data-type="save" data-ability="dex" data-dc="15" data-hide-d-c="true"', 'Dexterity')))[0].dc, undefined)
  // A DC dnd5e couldn't resolve (0 is left out), one out of range, and none: the text's, the spell
  // save DC, or the item's save activity for that ability (identified items only).
  assert.equal(spans(norm(`DC 12 ${request('data-type="save" data-ability="dex"', 'Dexterity')} saving throw`))[0].dc, '12')
  assert.equal(spans(norm(`${request('data-type="save" data-ability="dex"', 'Dexterity')} saving throw (DC 11)`))[0].dc, '11')
  assert.equal(spans(norm(`${request('data-type="save" data-ability="wis"', 'Wisdom')} saving throw against your spell save DC`, { relativeTo: wand }))[0].dc, '14')
  assert.equal(spans(norm(request('data-type="save" data-ability="wis"', 'Wisdom'), { relativeTo: wand }))[0].dc, '13')
  assert.equal(spans(norm(request('data-type="save" data-ability="dex"', 'Dexterity'), { relativeTo: wand }))[0].dc, '16')
  assert.equal(spans(norm(request('data-type="save" data-ability="wis"', 'Wisdom'), { relativeTo: hiddenWand }))[0].dc, undefined)
  assert.equal(spans(norm(request('data-type="save" data-ability="wis" data-dc="120"', 'DC 120 Wisdom')))[0].dc, undefined)
  assert.equal(spans(norm(request('data-type="save" data-ability="cha"', 'Charisma'), { relativeTo: thorin }))[0].dc, undefined)
  // [[/concentration 10]]: no ability unless one is given; the character's own is used.
  assert.deepEqual(spans(norm(request('data-type="concentration" data-dc="10"', 'DC 10 Concentration '))),
    [{ class: 'ss-save roll', n: '0', dc: '10', type: 'concentration', text: 'DC 10 Concentration' }])
  assert.deepEqual(spans(norm(request('data-type="concentration" data-ability="int"', 'Concentration (int)'))),
    [{ class: 'ss-save roll', n: '0', ability: 'int', type: 'concentration', text: 'Concentration (int)' }])
  // An ability dnd5e doesn't have is no saving throw.
  assert.equal(norm(request('data-type="save" data-ability="luck"', 'Luck')), 'Luck')
  assert.ok(!norm(request('data-type="save" data-ability="dex" data-dc="15"', 'DC 15 Dexterity')).includes('enricher-action'), "the GM's request link is gone")
}
ok('saving throws: one ability or a choice, DCs from dnd5e, the text, the spell save DC or the item, and concentration')

// ---- checks ----
// dnd5e 5.3.3's enrichCheck (enrichers.mjs:449-596): a single check is a request link with its
// type, ability (the author's, or else the skill's or tool's own), skill or tool, and DC; a choice
// of several is a group of type "check" with its skills and tools joined by "|", and a roll link
// for each (createRollLink: type, skill or tool, and ability only where they differ by ability).
const rollLink = (attrs, label) => `<a class="roll-link" ${attrs} data-action="roll">${ICON}${label}</a>`
const group = (attrs, html) => wrap(`<span class="roll-link-group" ${attrs}>${html}${REQUEST}</span>`)
const checkActivity = (ability, associated, dc) => ({ type: 'check', check: { ability, associated: new Set(associated), dc: { value: dc } } })
const rope = {
  documentName: 'Item', id: 'rope', uuid: 'Actor.thorin.Item.rope', name: 'Rope of Climbing', type: 'equipment', parent: thorin,
  system: { identified: true, activities: activities([checkActivity('', ['ath'], 17), checkActivity('int', [], 11), saveActivity('dex', 9)]) },
  getRollData() { return thorin.getRollData() },
}
const hiddenRope = { ...rope, id: 'hiddenRope', uuid: 'Actor.thorin.Item.hiddenRope', system: { ...rope.system, identified: false } }
const checksOf = html => spans(html).map(({ class: c, n, text, ...data }) => [c, n, text, data])
{
  // [[/check str 15]]: "check" is the author's text after the link, as with CheckShort.
  let html = norm(`<p>Make a ${request('data-type="check" data-ability="str" data-dc="15"', 'DC 15 Strength')} check.</p>`)
  assert.equal(html, '<p>Make a <span class="ss-check roll" data-n="0" data-checks="check:str" data-dc="15">DC 15 Strength</span> check.</p>')
  // [[/skill ath 15]], [[/skill ath ability=dex]], [[/tool thief 15]] and [[/tool thief ability=int]]:
  // the ability dnd5e put on the link, the author's or else the skill's or tool's own.
  assert.deepEqual(checksOf(norm(request('data-type="skill" data-ability="str" data-skill="ath" data-dc="15"', 'DC 15 Strength (Athletics)'))),
    [['ss-check roll', '0', 'DC 15 Strength (Athletics)', { checks: 'skill:str:ath', dc: '15' }]])
  assert.deepEqual(checksOf(norm(request('data-type="skill" data-ability="dex" data-skill="ath"', 'Dexterity (Athletics)'))),
    [['ss-check roll', '0', 'Dexterity (Athletics)', { checks: 'skill:dex:ath' }]])
  assert.deepEqual(checksOf(norm(request('data-type="tool" data-ability="dex" data-tool="thief" data-dc="15"', "DC 15 Dexterity (Thieves' Tools)"))),
    [['ss-check roll', '0', "DC 15 Dexterity (Thieves' Tools)", { checks: 'tool:dex:thief', dc: '15' }]])
  assert.equal(spans(norm(request('data-type="tool" data-ability="int" data-tool="thief"', "Intelligence (Thieves' Tools)")))[0].checks, 'tool:int:thief')
  // [[/check skill=ath/acr dc=12]]: a choice, each with its own ability; the group names none.
  html = norm(group('data-type="check" data-skill="ath|acr" data-dc="12"', `DC 12 ${rollLink('data-type="skill" data-skill="ath" data-ability="str"', 'Strength (Athletics)')}`
    + ` or ${rollLink('data-type="skill" data-skill="acr" data-ability="dex"', 'Dexterity (Acrobatics)')}`))
  assert.deepEqual(checksOf(html), [['ss-check roll', '0', 'DC 12 Strength (Athletics) or Dexterity (Acrobatics)', { checks: 'skill:str:ath|skill:dex:acr', dc: '12' }]])
  assert.ok(!html.includes('roll-link') && !html.includes('data-skill') && !html.includes('data-ability'), html)
  // [[/check ability=str skill=dec/per dc=15]]: one ability for both, which the group names.
  html = norm(group('data-type="check" data-ability="str" data-skill="dec|per" data-dc="15"',
    `DC 15 Strength (${rollLink('data-type="skill" data-skill="dec"', 'Deception')} or ${rollLink('data-type="skill" data-skill="per"', 'Persuasion')})`))
  assert.deepEqual(checksOf(html), [['ss-check roll', '0', 'DC 15 Strength (Deception or Persuasion)', { checks: 'skill:str:dec|skill:str:per', dc: '15' }]])
  // [[/check slt thief]] under the 2024 rules: Sleight of Hand checked using Thieves' Tools, the
  // tool no check of its own; under the 2014 rules, a choice of the two.
  html = norm(group('data-type="check" data-format="long" data-using-tool="thief" data-skill="slt" data-tool="thief"',
    `${rollLink('data-type="skill" data-skill="slt"', 'Dexterity (Sleight of Hand)')} check using Thieves' Tools`))
  assert.deepEqual(checksOf(html), [['ss-check roll', '0', "Dexterity (Sleight of Hand) check using Thieves' Tools", { checks: 'skill:dex:slt', usingTool: 'thief' }]])
  assert.ok(html.includes('data-using-tool="thief"'))
  html = norm(group('data-type="check" data-skill="slt" data-tool="thief"',
    `Dexterity (${rollLink('data-type="skill" data-skill="slt"', 'Sleight of Hand')} or ${rollLink('data-type="tool" data-tool="thief"', "Thieves' Tools")})`))
  assert.deepEqual(checksOf(html), [['ss-check roll', '0', "Dexterity (Sleight of Hand or Thieves' Tools)", { checks: 'skill:dex:slt|tool:dex:thief' }]])
  // format=long, and a label of the author's own: [[/skill ath 15]]{Climb it}.
  assert.equal(spans(norm(request('data-type="skill" data-ability="str" data-skill="ath" data-dc="15" data-format="long"', 'DC 15 Strength (Athletics) check')))[0].text, 'DC 15 Strength (Athletics) check')
  assert.deepEqual(checksOf(norm(request('data-type="skill" data-ability="str" data-skill="ath" data-dc="15"', 'Climb it'))),
    [['ss-check roll', '0', 'Climb it', { checks: 'skill:str:ath', dc: '15' }]])
  // [[/check]] on an item: dnd5e linked its check activity, with its ability, skills and DC.
  assert.deepEqual(checksOf(norm(request('data-type="skill" data-ability="str" data-skill="ath" data-dc="17" data-activity-uuid="Actor.thorin.Item.rope.Activity.abc"', 'DC 17 Strength (Athletics)'), { relativeTo: rope })),
    [['ss-check roll', '0', 'DC 17 Strength (Athletics)', { checks: 'skill:str:ath', dc: '17' }]])
  // [[/skill ath 15 hideDC]] and [[/tool thief 14 hideDC]]: never sent, but noted apart by number.
  const hiddenDCs = new Map()
  html = norm(`<p>${request('data-type="save" data-ability="dex" data-dc="13" data-hide-d-c="true"', 'Dexterity')} then ${request('data-type="skill" data-ability="str" data-skill="ath" data-dc="15" data-hide-d-c="true"', 'Strength (Athletics)')}`
    + ` and ${request('data-type="check" data-ability="int" data-dc="11"', 'DC 11 Intelligence')} or ${request('data-type="tool" data-ability="dex" data-tool="thief" data-dc="14" data-hide-d-c="true"', "Dexterity (Thieves' Tools)")}</p>`, { hiddenDCs })
  assert.deepEqual(spans(html).map(s => [s.n, s.class, s.checks ?? s.ability, s.dc]),
    [['0', 'ss-save roll', 'dex', undefined], ['1', 'ss-check roll', 'skill:str:ath', undefined], ['2', 'ss-check roll', 'check:int', '11'], ['3', 'ss-check roll', 'tool:dex:thief', undefined]])
  assert.ok(!html.includes('15') && !html.includes('14') && !html.includes('hide'), html)
  assert.deepEqual([...hiddenDCs], [[0, 13], [1, 15], [3, 14]])
  // A DC dnd5e left out: the text's before or after it, the spell save DC, or the item's check
  // for that skill, or that ability (identified items only); a save activity is no check's.
  assert.equal(spans(norm(`DC 12 ${request('data-type="check" data-ability="str"', 'Strength')} check`))[0].dc, '12')
  assert.equal(spans(norm(`${request('data-type="skill" data-ability="dex" data-skill="acr"', 'Dexterity (Acrobatics)')} check (DC 13)`))[0].dc, '13')
  assert.equal(spans(norm(`${request('data-type="skill" data-ability="str" data-skill="ath"', 'Strength (Athletics)')} check against your spell save DC`, { relativeTo: rope }))[0].dc, '14')
  assert.equal(spans(norm(request('data-type="skill" data-ability="str" data-skill="ath"', 'Strength (Athletics)'), { relativeTo: rope }))[0].dc, '17')
  assert.equal(spans(norm(request('data-type="check" data-ability="int"', 'Intelligence'), { relativeTo: rope }))[0].dc, '11')
  assert.equal(spans(norm(request('data-type="skill" data-ability="dex" data-skill="ath"', 'Dexterity (Athletics)'), { relativeTo: rope }))[0].dc, undefined, 'an Athletics check made with Strength is no Dexterity one')
  assert.equal(spans(norm(request('data-type="check" data-ability="dex"', 'Dexterity'), { relativeTo: rope }))[0].dc, undefined)
  // A check activity is for the skills and tools it names alone: its Athletics, with no ability of
  // its own, gives no DC to Acrobatics or Thieves' Tools, made with their own abilities; nor its
  // Intelligence check, naming none, to an Intelligence skill.
  for (const [attrs, label, checks] of [
    ['data-type="skill" data-ability="dex" data-skill="acr"', 'Dexterity (Acrobatics)', 'skill:dex:acr'],
    ['data-type="tool" data-ability="dex" data-tool="thief"', "Dexterity (Thieves' Tools)", 'tool:dex:thief'],
    ['data-type="skill" data-ability="int" data-skill="inv"', 'Intelligence (Investigation)', 'skill:int:inv'],
  ]) {
    assert.deepEqual(checksOf(norm(request(attrs, label), { relativeTo: rope })), [['ss-check roll', '0', label, { checks }]], label)
  }
  assert.equal(spans(norm(request('data-type="skill" data-ability="str" data-skill="ath"', 'Strength (Athletics)'), { relativeTo: hiddenRope }))[0].dc, undefined)
  assert.equal(spans(norm(request('data-type="check" data-ability="str" data-dc="120"', 'DC 120 Strength')))[0].dc, undefined)
  // A kind of vehicle is a tool, with an ability the author gave it; it has none of its own.
  assert.equal(spans(norm(request('data-type="tool" data-ability="int" data-tool="water"', 'Intelligence (Water Vehicle)')))[0].checks, 'tool:int:water')
  assert.equal(norm(request('data-type="tool" data-tool="water"', 'Water Vehicle')), 'Water Vehicle')
  // What dnd5e doesn't have, or the app doesn't: a world's own ability, dnd5e 6's "spellcasting",
  // unknown skills and tools, names any object answers to, and none at all, are dropped, and a link
  // with nothing left is text; each check is offered once; and more than ten is text.
  CONFIG.DND5E.abilities.hon = { label: 'Honor', abbreviation: 'hon' }
  assert.equal(norm(request('data-type="check" data-ability="hon" data-dc="10"', 'DC 10 Honor')), 'DC 10 Honor')
  assert.equal(norm(request('data-type="skill" data-ability="hon" data-skill="per"', 'Honor (Persuasion)')), 'Honor (Persuasion)')
  delete CONFIG.DND5E.abilities.hon
  assert.equal(norm(request('data-type="check" data-ability="spellcasting" data-dc="10"', 'DC 10 Spellcasting')), 'DC 10 Spellcasting')
  assert.equal(norm(request('data-type="check" data-dc="10"', 'DC 10')), 'DC 10')
  assert.equal(norm(request('data-type="skill" data-ability="str" data-skill="constructor"', 'x')), 'x')
  assert.equal(norm(request('data-type="tool" data-ability="dex" data-tool="toString"', 'x')), 'x')
  assert.equal(spans(norm(group('data-type="check" data-skill="ath|nope|acr|ath|__proto__" data-tool="thief|thief|lute"', 'choices')))[0].checks,
    'skill:str:ath|skill:dex:acr|tool:dex:thief')
  const eleven = ['acr', 'ath', 'dec', 'ins', 'per', 'prc', 'slt', 'ste'].join('|')
  assert.equal(spans(norm(group(`data-type="check" data-skill="${eleven}" data-tool="thief|herb"`, 'ten')))[0].checks.split('|').length, 10)
  // A world's own skill or tool keyed as the app can't take one, "odd.one": dropped, and the rest
  // kept, rather than the whole link made text by the app; a tool a skill is checked using too.
  CONFIG.DND5E.skills['odd.one'] = { label: 'Odd One', ability: 'str' }
  CONFIG.DND5E.tools['a.b'] = { ability: 'dex' }
  assert.equal(spans(norm(group('data-type="check" data-skill="ath|odd.one" data-tool="thief|a.b"', 'choices')))[0].checks, 'skill:str:ath|tool:dex:thief')
  assert.equal(norm(request('data-type="skill" data-ability="str" data-skill="odd.one"', 'Odd One')), 'Odd One')
  assert.deepEqual(checksOf(norm(group('data-type="check" data-skill="ath" data-tool="a.b" data-using-tool="a.b"', 'x'))), [['ss-check roll', '0', 'x', { checks: 'skill:str:ath' }]])
  delete CONFIG.DND5E.skills['odd.one']
  delete CONFIG.DND5E.tools['a.b']
  assert.equal(norm(group(`data-type="check" data-skill="${eleven}" data-tool="thief|herb|water" data-ability="int"`, 'eleven')), 'eleven')
  // A tool a skill is checked using must be one dnd5e has, and is dropped with no skill to use it.
  assert.equal(spans(norm(group('data-type="check" data-skill="slt" data-tool="lute" data-using-tool="lute"', 'x')))[0].usingTool, undefined)
  assert.equal(norm(group('data-type="check" data-tool="thief" data-using-tool="thief"', 'x')), 'x')
  // [[/skill prc passive]]: dnd5e's passive check is no link, and stays text, "check" or not.
  html = norm(`<p>${'<span class="passive-check" data-type="skill" data-ability="wis" data-skill="prc" data-passive="true" data-tooltip="<section class=&quot;loading&quot; data-passive></section>">passive Wisdom (Perception)</span>'} check, or a passive Wisdom (Perception) check.</p>`)
  assert.equal(spans(html).length, 0)
  assert.equal(textOfHtml(html), 'passive Wisdom (Perception) check, or a passive Wisdom (Perception) check.')
  // [[/check str/dex]], which dnd5e 5.3.3 can't enrich, is its configuration's words.
  assert.equal(norm('<p>Make a [[/check str/dex 15]] check.</p>'), '<p>Make a str/dex 15 check.</p>')
  // In any language, as with saves; but English words after it aren't read in another, such as
  // "against your spell save DC" in English text in a French game: the item's DC, not the spell's.
  game.i18n.lang = 'fr'
  assert.equal(spans(norm(request('data-type="skill" data-ability="str" data-skill="ath" data-dc="15"', 'DD 15 Force (Athlétisme)')))[0].checks, 'skill:str:ath')
  assert.equal(spans(norm(`${request('data-type="skill" data-ability="str" data-skill="ath"', 'Force (Athlétisme)')} check against your spell save DC`, { relativeTo: rope }))[0].dc, '17')
  assert.equal(spans(norm(`${request('data-type="save" data-ability="wis"', 'Sagesse')} saving throw against your spell save DC`, { relativeTo: wand }))[0].dc, '13')
  game.i18n.lang = 'en'
  assert.equal(spans(norm(`${request('data-type="skill" data-ability="str" data-skill="ath"', 'Strength (Athletics)')} check against your spell save DC`, { relativeTo: rope }))[0].dc, '14')
  // Enriched for a condition's rules, nothing in it is a link to act on.
  assert.equal(norm(request('data-type="check" data-ability="str" data-dc="15"', 'DC 15 Strength'), { actionable: false }), 'DC 15 Strength')
}
ok("checks: an ability, skill or tool, or a choice, each with dnd5e's ability, a 2024 tool used with a skill, DCs from dnd5e, the text, the spell save DC or the item's check, hidden DCs noted apart, and what isn't dnd5e's or the app's as text")

// ---- damage and healing ----
{
  let html = norm(`<p>Take ${damage('data-type="damage" data-formulas="2d6" data-damage-types="fire" data-roll-type="damage"', `${formulaSpan('2d6')} Fire`)}.</p>`)
  assert.equal(html, '<p>Take <span class="ss-damage roll" data-n="0" data-formulas="2d6" data-types="fire">2d6 Fire</span>.</p>')
  // [[/damage 1d6 fire & 1d6 cold/fire]]: two parts, the second a choice of types.
  assert.deepEqual(spans(norm(damage('data-type="damage" data-formulas="1d6&amp;1d6" data-damage-types="fire&amp;cold|fire" data-roll-type="damage"',
    `${formulaSpan('1d6')} Fire and ${formulaSpan('1d6')} Cold or Fire`))),
  [{ class: 'ss-damage roll', n: '0', formulas: '1d6&1d6', types: 'fire&cold|fire', text: '1d6 Fire and 1d6 Cold or Fire' }])
  // [[/damage 2d6 fire average]], and extended: "Hit:" stays outside.
  assert.deepEqual(spans(norm(damage('data-type="damage" data-formulas="2d6" data-damage-types="fire" data-roll-type="damage" data-average="true"',
    `7 <span class="formula-group">(${formulaSpan('2d6')})</span> Fire`))), [{ class: 'ss-damage roll', n: '0', formulas: '2d6', types: 'fire', text: '7 (2d6) Fire' }])
  html = norm(`<span class="damage-extended"><em>Hit:</em> ${damage('data-type="damage" data-formulas="1d8 + 4" data-damage-types="slashing" data-roll-type="damage" data-average="true" data-format="extended"',
    `8 <span class="formula-group">(${formulaSpan('1d8 + 4')})</span> Slashing`)} damage</span>`)
  assert.equal(textOfHtml(html), 'Hit: 8 (1d8 + 4) Slashing damage')
  assert.equal(spans(html)[0].formulas, '1d8 + 4')
  // A part with no type, beside one with.
  assert.equal(spans(norm(damage('data-type="damage" data-formulas="1d4&amp;1d6" data-damage-types="&amp;fire" data-roll-type="damage"', `${formulaSpan('1d4')} and ${formulaSpan('1d6')} Fire`)))[0].types, '&fire')
  assert.equal(spans(norm(damage('data-type="damage" data-formulas="1d4" data-roll-type="damage"', formulaSpan('1d4'))))[0].types, undefined)
  // [[/heal 2d4 + 2]] and [[/heal 1d4 temp]]
  assert.deepEqual(spans(norm(damage('data-type="damage" data-formulas="2d4 + 2" data-damage-types="healing" data-roll-type="healing"', `${formulaSpan('2d4 + 2')} Healing`))),
    [{ class: 'ss-damage roll', n: '0', formulas: '2d4 + 2', types: 'healing', healing: 'true', text: '2d4 + 2 Healing' }])
  assert.equal(spans(norm(damage('data-type="damage" data-formulas="1d4" data-damage-types="temphp" data-roll-type="healing"', `${formulaSpan('1d4')} Temporary HP`)))[0].types, 'temphp')
  // [[/damage 1d8 cold]]{a chill}: a labelled link is the group and the link at once.
  assert.deepEqual(spans(norm(wrap(`<a class="roll-link-group roll-link" data-type="damage" data-formulas="1d8" data-damage-types="cold" data-roll-type="damage" data-action="roll">${ICON}a chill</a>`))),
    [{ class: 'ss-damage roll', n: '0', formulas: '1d8', types: 'cold', text: 'a chill' }])
  // Formulas: the roll data fills what dnd5e left, and one that can't be rolled is text.
  assert.equal(spans(norm(damage('data-type="damage" data-formulas="1d8 + @mod" data-damage-types="fire" data-roll-type="damage"', `${formulaSpan('1d8 + @mod')} Fire`), { rollData: { mod: 4 } }))[0].formulas, '1d8 + 4')
  assert.equal(norm(damage('data-type="damage" data-formulas="1d8 + @nothing" data-damage-types="fire" data-roll-type="damage"', `${formulaSpan('1d8 + @nothing')} Fire`)), '1d8 + @nothing Fire')
  assert.equal(norm(damage('data-type="damage" data-formulas="1d8 ++ 2" data-damage-types="fire" data-roll-type="damage"', `${formulaSpan('1d8 ++ 2')} Fire`)), '1d8 ++ 2 Fire')
  assert.equal(norm(damage('data-type="damage" data-formulas="1d6&amp;2d6 + &lt;b&gt;" data-damage-types="fire&amp;fire" data-roll-type="damage"', 'two parts')), 'two parts', 'any part that cannot be rolled leaves the whole as text')
  // Since module 0.21.0, damage whose dice this world can't plan for a player to throw, as a d3's,
  // is text too, any part of it; a die it takes away is planned.
  assert.equal(norm(damage('data-type="damage" data-formulas="1d3 + 2" data-damage-types="cold" data-roll-type="damage"', `${formulaSpan('1d3 + 2')} Cold`)), '1d3 + 2 Cold')
  assert.equal(norm(damage('data-type="damage" data-formulas="1d6&amp;1d3" data-damage-types="fire&amp;cold" data-roll-type="damage"', 'two parts')), 'two parts')
  assert.equal(spans(norm(damage('data-type="damage" data-formulas="3 - 1d4 + 2d6" data-damage-types="fire" data-roll-type="damage"', `${formulaSpan('3 - 1d4 + 2d6')} Fire`)))[0].formulas, '3 - 1d4 + 2d6')
  // Types dnd5e doesn't have are dropped.
  assert.equal(spans(norm(damage('data-type="damage" data-formulas="1d6" data-damage-types="fire|toString|constructor" data-roll-type="damage"', 'x')))[0].types, 'fire')
}
ok('damage and healing: parts, choices of types, averages, extended, labels, roll data, and formulas that cannot be rolled, or whose dice cannot be planned')

// ---- inline rolls ----
{
  assert.deepEqual(spans(norm(`<p>Roll ${deferred('1d6')} for luck.</p>`)), [{ class: 'ss-roll roll', n: '0', formula: '1d6', text: '1d6' }])
  assert.deepEqual(spans(norm(deferred('1d4 + @prof'), { rollData: { prof: 3 } })), [{ class: 'ss-roll roll', n: '0', formula: '1d4 + 3', text: '1d4 + 3' }])
  assert.deepEqual(spans(norm(deferred('1d4 + @prof', 'Bless'), { rollData: { prof: 3 } })), [{ class: 'ss-roll roll', n: '0', formula: '1d4 + 3', text: 'Bless' }])
  assert.equal(norm(deferred('1d4 + @nothing')), '1d4 + @nothing', 'a formula with data left in it is text')
  assert.equal(norm(deferred('5')), '5', 'one that always comes to the same is text')
  assert.equal(norm(deferred('1d20', '1d20', 'gmroll')), '1d20', "one for the Gamemaster's eyes is text")
  assert.equal(norm(deferred('1d20', '1d20', 'blindroll')), '1d20')
  // [[1d6]] rolled while enriching: the formula, never the Gamemaster's 4.
  let html = norm(`<p>You find ${rolledRoll('1d6', 4)} coins.</p>`)
  assert.equal(html, '<p>You find <span class="ss-roll roll" data-n="0" data-formula="1d6">1d6</span> coins.</p>')
  assert.deepEqual(spans(norm(rolledRoll('2d6', 9, 'Gold'))), [{ class: 'ss-roll roll', n: '0', formula: '2d6', text: 'Gold' }])
  html = norm(rolledRoll('1d6', 4).replace(/data-roll="[^"]*"/, ''))
  assert.deepEqual(spans(html), [{ class: 'ss-roll roll', n: '0', formula: '1d6', text: '1d6' }], 'the formula from its tooltip')
  assert.ok(!html.includes('4'))
  assert.equal(norm(rolledRoll('3', 3)), '3', '[[@prof]] shows its number')
  assert.equal(norm(rolledRoll('1d6[fire]', 4)), '1d6[fire]', "one the app can't be sent shows its formula, not the result")
}
ok('inline rolls: [[/r]] with its formula resolved, [[1d6]] with its formula and never its result, and those that are text')

// ---- dice with comparisons (module 0.22.0) ----
// As dnd5e enriches [[/damage 2d6r<=2 + 1d8 + 7 fire]]: a Great Weapon Fighter's greatsword; an
// exploding d6, the highest three of four d6s and d4s counted on a 3 or more; Foundry's [[/r 4d6kh3]]
// and [[/r 2d6r<2]]. Each die throws its number first, the player's; the rest is Foundry's.
{
  const html = norm(`<p>Hit: ${damage('data-type="damage" data-formulas="2d6r&lt;=2 + 1d8 + 7" data-damage-types="fire" data-roll-type="damage"', `${formulaSpan('2d6r&lt;=2 + 1d8 + 7')} Fire`)}.</p>`)
  assert.deepEqual(spans(html), [{ class: 'ss-damage roll', n: '0', formulas: '2d6r<=2 + 1d8 + 7', types: 'fire', text: '2d6r<=2 + 1d8 + 7 Fire' }])
  assert.match(html, /data-formulas="2d6r(&lt;|<)=2 \+ 1d8 \+ 7"/)
  assert.deepEqual(spans(norm(damage('data-type="damage" data-formulas="1d6x&amp;4d6kh3 + 1d4cs&gt;=3" data-damage-types="fire&amp;cold" data-roll-type="damage"', 'burns'))),
    [{ class: 'ss-damage roll', n: '0', formulas: '1d6x&4d6kh3 + 1d4cs>=3', types: 'fire&cold', text: 'burns' }])
  assert.deepEqual(spans(norm(`<p>Roll ${deferred('4d6kh3')} for strength.</p>`)), [{ class: 'ss-roll roll', n: '0', formula: '4d6kh3', text: '4d6kh3' }])
  assert.deepEqual(spans(norm(deferred('2d6r&lt;2', 'Fortune'))), [{ class: 'ss-roll roll', n: '0', formula: '2d6r<2', text: 'Fortune' }])
  // Still never data, nor a formula Foundry can't read, nor markup.
  assert.equal(norm(damage('data-type="damage" data-formulas="2d6r&lt;=@mod" data-damage-types="fire" data-roll-type="damage"', 'x')), 'x')
  assert.equal(norm(damage('data-type="damage" data-formulas="2d6 &lt;= 3 +" data-damage-types="fire" data-roll-type="damage"', 'y')), 'y')
  assert.equal(norm(deferred('1d6 + &lt;i&gt;', 'z')), 'z')
}
ok('damage and rolls whose dice have modifiers, comparisons among them, are links, their formulas as Foundry reads them: 2d6r<=2, 1d6x, 4d6kh3, 1d4cs>=3')

// ---- conditions ----
{
  let html = norm(`<p>It falls ${reference('prone', conditionTypes.prone.reference, 'Prone')}.</p>`)
  assert.equal(html, '<p>It falls <span class="ss-condition ref" data-condition="prone">Prone</span>.</p>')
  // &Reference[prone apply=false]: no Apply Status, known by its page.
  assert.deepEqual(spans(norm(reference('prone', conditionTypes.prone.reference, 'Prone', false))), [{ class: 'ss-condition ref', condition: 'prone', text: 'Prone' }])
  // A link to the 2014 rules' page, in a world on the 2024 rules, and a link to the 2024 page with
  // the configuration on the 2014 rules.
  assert.deepEqual(spans(norm(`<a class="content-link" draggable="true" data-link="" data-uuid="${RULES14}.y0TkcdyoZlOTmAFT" data-type="JournalEntryPage"><i class="fas fa-book-open"></i>prone</a>`)),
    [{ class: 'ss-condition ref', condition: 'prone', text: 'prone' }])
  const modern = conditionTypes.blinded.reference
  conditionTypes.blinded.reference = `${RULES14}.0b8N4FymGGfbZGpJ`
  assert.equal(spans(norm(`<a class="content-link" data-uuid="${modern}">Blinded</a>`))[0].condition, 'blinded')
  assert.equal(spans(norm(`<a class="content-link" data-uuid="${RULES14}.0b8N4FymGGfbZGpJ">Blinded</a>`))[0].condition, 'blinded')
  conditionTypes.blinded.reference = modern
  // Burning is only like a condition: its link stays a link, without Apply Status.
  html = norm(reference('burning', conditionTypes.burning.reference, 'Burning'))
  assert.equal(spans(html).length, 0)
  assert.ok(html.includes('class="content-link"') && !html.includes('applyStatus'))
  // Other references stay links.
  html = norm(wrap('<span class="reference-link"><a class="content-link" data-uuid="Compendium.dnd5e.content24.JournalEntry.phbAppendixDRule.JournalEntryPage.speed">Speed</a></span>'))
  assert.ok(html.includes('class="content-link"') && !spans(html).length)
}
ok('conditions: &Reference with and without Apply Status, either rules\' pages, not pseudo-conditions')

// ---- everything else becomes its text ----
{
  const html = norm([
    wrap(`<span class="roll-link-group" data-type="attack" data-formula="+5"><a class="roll-link" data-action="roll">${ICON}+5</a></span>`),
    wrap(`<span class="roll-link-group" data-type="item" data-roll-item-name="Longsword"><a class="roll-link" data-action="roll">${ICON}Longsword</a></span>`),
    '<span class="passive-check" data-type="skill" data-skill="prc" data-tooltip="<section class=&quot;loading&quot; data-passive><i class=&quot;fas fa-spinner fa-spin-pulse&quot;></i></section>">passive Wisdom (Perception)</span>',
    '<span class="lookup-value">Thorin</span>', '<span class="lookup-value not-found">@name</span>',
    wrap('<span class="award-block dnd5e2" data-award-command="50gp">\n      <span class="award-entry">\n        50 <i class="currency gp" data-tooltip="" aria-label="Gold"></i>\n      </span>\n    \n    <a class="award-link" data-action="awardRequest">\n      <i class="fa-solid fa-trophy"></i> Award\n    </a>\n  </span>'),
  ].join(' | '))
  assert.equal(spans(html).length, 0)
  assert.equal(textOfHtml(html).replace(/\s+/g, ' ').trim(), '+5 | Longsword | passive Wisdom (Perception) | Thorin | @name | 50 GP')
  for (const gone of ['enricher-action', 'award-link', 'enriched-content', 'roll-link', 'data-formula', 'passive-check', 'lookup-value', 'fa-'])
    assert.ok(!html.includes(gone), gone)
}
ok('attacks, items, passive checks, lookups and awards are text; the GM-only links are gone')

// ---- what dnd5e couldn't enrich ----
{
  assert.equal(norm('<p>Roll [[/save]] now.</p>'), '<p>Roll  now.</p>')
  assert.equal(norm('<p>[[/save str dex]]{Resist}</p>'), '<p>Resist</p>')
  assert.equal(norm('<p>&amp;Reference[condition=nowhere]</p>'), '<p>nowhere</p>')
  assert.equal(norm('<p>&amp;reference[Lost apply=false] and &amp;Reference[Speed]{fast}</p>'), '<p>Lost and fast</p>')
  assert.equal(norm('<p>[[/r 1d4 # Luck]]{Lucky}</p>'), '<p>Lucky</p>')
  // A description dnd5e couldn't enrich at all still reads, and its plain words still act.
  assert.deepEqual(spans(norm('<p>Take [[/damage 2d6 fire]] damage.</p>')), [{ class: 'ss-damage roll', n: '0', formulas: '2d6', types: 'fire', text: '2d6 fire damage' }])
}
ok('leftover [[/…]] and &Reference[…] are replaced by their label')

// ---- forged spans ----
{
  const html = norm('<p><span class="ss-damage roll" data-n="0" data-formulas="100d6" data-types="fire">Boom</span> '
    + '<span class="ss-save" data-n="1" data-ability="str" data-dc="30">a trap</span> <b class="ss-roll" data-formula="1d100">x</b> '
    + '<span class="roll" data-formula="1d20">y</span> <a href="https://x.example" class="ss-condition" data-condition="prone">z</a> '
    + '<span class="ss-check roll" data-n="2" data-checks="check:str" data-dc="30">a lock</span> <i data-checks="skill:str:ath" data-using-tool="thief">w</i> '
    + '<em data-critical="false" data-healing="true">v</em> <b data-critical-dice="1" data-critical-damage="1d6">u</b> '
    + `<span class="ss-damage roll" data-n="5">${damage('data-type="damage" data-formulas="1d6" data-damage-types="fire" data-roll-type="damage"', `${formulaSpan('1d6')} Fire`)}</span></p>`)
  assert.deepEqual(spans(html), [{ class: 'ss-damage roll', n: '0', formulas: '1d6', types: 'fire', text: '1d6 Fire' }])
  const body = parse(html)
  assert.equal(body.querySelectorAll('[data-n]').length, 1)
  for (const attr of ['data-formulas', 'data-ability', 'data-dc', 'data-formula', 'data-condition', 'data-types', 'data-checks', 'data-using-tool', 'data-critical', 'data-healing', 'data-critical-dice', 'data-critical-damage'])
    assert.equal(body.querySelectorAll(`[${attr}]`).length, attr === 'data-formulas' || attr === 'data-types' ? 1 : 0, attr)
  assert.equal(body.querySelectorAll('.roll').length, 1, "nothing else looks like a roll")
  assert.equal(readLink(html, 1), null)
}
ok("spans in the source that look like the app's lose their classes and data, what a critical hit adds among it; only the normaliser's are numbered")

// ---- plain text ----
const plain = (html, options) => spans(norm(html, options)).map(({ class: c, n, text, ...data }) => [c.split(' ')[0], text, data])
{
  // From dnd5e's packs: 2014 spells and items, 2024 text.
  assert.deepEqual(plain('<p>Each creature in the area must make a DC 15 Dexterity saving throw. A creature takes 8d6 fire damage on a failed save, or half as much damage on a successful one.</p>'), [
    ['ss-save', 'DC 15 Dexterity saving throw', { ability: 'dex', dc: '15' }],
    ['ss-damage', '8d6 fire damage', { formulas: '8d6', types: 'fire' }],
  ])
  assert.deepEqual(plain('<p>The target must succeed on a Constitution saving throw (DC 13) or take 7 (2d6) poison damage and be poisoned for 1 hour.</p>'), [
    ['ss-save', 'Constitution saving throw (DC 13)', { ability: 'con', dc: '13' }],
    ['ss-damage', '7 (2d6) poison damage', { formulas: '2d6', types: 'poison' }],
    ['ss-condition', 'poisoned', { condition: 'poisoned' }],
  ])
  assert.deepEqual(plain('<p>It must make a Wisdom saving throw against your spell save DC or be <em>frightened</em>.</p>', { relativeTo: wand }), [
    ['ss-save', 'Wisdom saving throw against your spell save DC', { ability: 'wis', dc: '14' }],
  ])
  assert.deepEqual(plain('<p>Make a Strength or Dexterity saving throw.</p>', { relativeTo: wand }), [['ss-save', 'Strength or Dexterity saving throw', { ability: 'str|dex', dc: '16' }]])
  assert.deepEqual(plain('<p>Make a Wisdom saving throw.</p>', { relativeTo: wand }), [['ss-save', 'Wisdom saving throw', { ability: 'wis', dc: '13' }]], "the item's save activity")
  assert.deepEqual(plain('<p>Make a Wisdom saving throw.</p>', { relativeTo: hiddenWand }), [['ss-save', 'Wisdom saving throw', { ability: 'wis' }]], 'not of an item not identified')
  assert.deepEqual(plain('<p>Make a Wisdom save.</p>', { relativeTo: thorin }), [['ss-save', 'Wisdom save', { ability: 'wis' }]])
  assert.deepEqual(plain('<p>A hit deals 1d8 + 3 slashing damage, and an extra 1d6 damage. Hit: 9 (1d10 + 4) Bludgeoning damage. 2D6 Fire Damage.</p>'), [
    ['ss-damage', '1d8 + 3 slashing damage', { formulas: '1d8 + 3', types: 'slashing' }],
    ['ss-damage', '1d6 damage', { formulas: '1d6' }],
    ['ss-damage', '9 (1d10 + 4) Bludgeoning damage', { formulas: '1d10 + 4', types: 'bludgeoning' }],
    ['ss-damage', '2D6 Fire Damage', { formulas: '2d6', types: 'fire' }],
  ])
  assert.deepEqual(plain('<p>The target has the Prone condition and is Incapacitated. It is knocked prone, falls unconscious, and the poisoned condition ends.</p>'), [
    ['ss-condition', 'Prone', { condition: 'prone' }], ['ss-condition', 'Incapacitated', { condition: 'incapacitated' }],
    ['ss-condition', 'prone', { condition: 'prone' }], ['ss-condition', 'unconscious', { condition: 'unconscious' }],
    ['ss-condition', 'poisoned', { condition: 'poisoned' }],
  ])
  // Checks, as dnd5e's packs write them: a skill or an ability, a choice of either, a DC before or
  // after, the spell save DC, or the item's.
  assert.deepEqual(plain('<p>Make a DC 15 Strength (Athletics) check, or succeed on a Wisdom (Perception) check (DC 13). Then an Intelligence or Wisdom check.</p>'), [
    ['ss-check', 'DC 15 Strength (Athletics) check', { checks: 'skill:str:ath', dc: '15' }],
    ['ss-check', 'Wisdom (Perception) check (DC 13)', { checks: 'skill:wis:prc', dc: '13' }],
    ['ss-check', 'Intelligence or Wisdom check', { checks: 'check:int|check:wis' }],
  ])
  assert.deepEqual(plain('<p>It must succeed on a DC 12 Strength (Athletics) or Dexterity (Acrobatics) check to escape, and a Dexterity (Sleight of Hand) check.</p>'), [
    ['ss-check', 'DC 12 Strength (Athletics) or Dexterity (Acrobatics) check', { checks: 'skill:str:ath|skill:dex:acr', dc: '12' }],
    ['ss-check', 'Dexterity (Sleight of Hand) check', { checks: 'skill:dex:slt' }],
  ])
  assert.deepEqual(plain('<p>Make a Strength check against your spell save DC.</p>', { relativeTo: wand }), [
    ['ss-check', 'Strength check against your spell save DC', { checks: 'check:str', dc: '14' }],
  ])
  assert.deepEqual(plain('<p>Make a Strength (Athletics) check, or an Intelligence check, or a Dexterity check.</p>', { relativeTo: rope }), [
    ['ss-check', 'Strength (Athletics) check', { checks: 'skill:str:ath', dc: '17' }],
    ['ss-check', 'Intelligence check', { checks: 'check:int', dc: '11' }],
    ['ss-check', 'Dexterity check', { checks: 'check:dex' }],
  ])
  assert.deepEqual(plain('<p>Make a Strength (Athletics) check.</p>', { relativeTo: hiddenRope }), [['ss-check', 'Strength (Athletics) check', { checks: 'skill:str:ath' }]])
  // Plain text naming a skill the item's check activity doesn't: no DC of it.
  assert.deepEqual(plain('<p>Make a Dexterity (Acrobatics) check, or an Intelligence (Investigation) check.</p>', { relativeTo: rope }), [
    ['ss-check', 'Dexterity (Acrobatics) check', { checks: 'skill:dex:acr' }],
    ['ss-check', 'Intelligence (Investigation) check', { checks: 'skill:int:inv' }],
  ])
  // A list of choices, as dnd5e's packs write one (the 2014 Champion's Remarkable Athlete): each,
  // with the DC before it, with or without a comma before "or", up to all six abilities.
  assert.deepEqual(plain('<p>Add it to any Strength, Dexterity, or Constitution check you make. A DC 12 Strength, Dexterity or Constitution check.</p>'), [
    ['ss-check', 'Strength, Dexterity, or Constitution check', { checks: 'check:str|check:dex|check:con' }],
    ['ss-check', 'DC 12 Strength, Dexterity or Constitution check', { checks: 'check:str|check:dex|check:con', dc: '12' }],
  ])
  assert.deepEqual(plain('<p>A DC 14 Strength (Athletics), Dexterity (Acrobatics), or Dexterity (Stealth) check.</p>'), [
    ['ss-check', 'DC 14 Strength (Athletics), Dexterity (Acrobatics), or Dexterity (Stealth) check', { checks: 'skill:str:ath|skill:dex:acr|skill:dex:ste', dc: '14' }],
  ])
  assert.deepEqual(plain('<p>A DC 13 Strength, Dexterity, or Constitution saving throw, or a Strength, Dexterity, Constitution, Intelligence, Wisdom, or Charisma save.</p>'), [
    ['ss-save', 'DC 13 Strength, Dexterity, or Constitution saving throw', { ability: 'str|dex|con', dc: '13' }],
    ['ss-save', 'Strength, Dexterity, Constitution, Intelligence, Wisdom, or Charisma save', { ability: 'str|dex|con|int|wis|cha' }],
  ])
  // One that ends a list it doesn't take all of is text, rather than offering only the last: more
  // than six, two "or"s, and skills listed in parentheses.
  assert.deepEqual(plain('<p>A Strength, Dexterity, Constitution, Intelligence, Wisdom, Charisma, or Strength (Athletics) check. '
    + 'A Strength or Dexterity or Constitution saving throw. A Charisma (Deception, Persuasion) or Wisdom (Insight) check. A DC 12 Strength, Dexterity, and Constitution check.</p>'), [])
  // Not checks: bonuses to checks, passive scores, a tool's check, which plain text leaves alone, a
  // skill alone, and a skill in parentheses that isn't one.
  assert.deepEqual(plain('<p>You have advantage on Strength checks and Wisdom (Perception) checks. Your passive Wisdom (Perception) is 15, a passive Wisdom (Perception) check. '
    + "A DC 15 Dexterity (Thieves' Tools) check, an Acrobatics check, a Strength (Lifting) check.</p>"), [])
  // Saves and checks side by side.
  assert.deepEqual(plain('<p>A Strength check or a Dexterity saving throw.</p>'), [
    ['ss-check', 'Strength check', { checks: 'check:str' }], ['ss-save', 'Dexterity saving throw', { ability: 'dex' }],
  ])
  // The false positives the probe found: a benefit, not a saving throw; invisible things.
  assert.deepEqual(plain('<p>You have Advantage on Strength saving throws and Dexterity saves. It creates an invisible sphere and sees invisible creatures. A blinded ally.</p>'), [])
  assert.deepEqual(plain('<p>Bleeding and Burning are only like conditions.</p>'), [])
  // Never inside a link, a heading, or across tags.
  assert.deepEqual(plain('<h3>Prone</h3><a href="https://x.example">DC 15 Dexterity saving throw</a><p>DC 15 <strong>Dexterity</strong> saving throw</p>'), [])
  // Text is never made into HTML.
  const html = norm('<p>&lt;img src=x onerror=alert(1)&gt; is Prone &amp; 2d6 fire damage</p>')
  assert.equal(parse(html).querySelectorAll('img').length, 0)
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'))
}
ok('plain text: saving throws and checks with their DCs, damage, conditions in context; the false positives the probe found are left alone')

// ---- a game in French ----
{
  game.i18n.lang = 'fr'
  conditionTypes.petrified.name = 'Pétrifié'
  conditionTypes.prone.name = 'À terre'
  assert.deepEqual(plain('<p>DC 15 Dexterity saving throw, a DC 12 Strength (Athletics) check, 2d6 fire damage, is unconscious. La cible est À terre ou Pétrifiée, puis Pétrifié.</p>'), [
    ['ss-condition', 'À terre', { condition: 'prone' }], ['ss-condition', 'Pétrifié', { condition: 'petrified' }],
  ])
  // dnd5e's own links work in any language.
  assert.equal(spans(norm(request('data-type="save" data-ability="dex" data-dc="15"', 'DD 15 Dextérité')))[0].ability, 'dex')
  game.i18n.lang = 'en'
  conditionTypes.petrified.name = 'Petrified'
  conditionTypes.prone.name = 'DND5E.ConProne'
}
ok("a game in French: English phrases aren't read; conditions are, by their French names, whole words only")

// ---- secret sections ----
{
  const html = norm(`<p>${request('data-type="save" data-ability="dex" data-dc="15"', 'DC 15 Dexterity')}</p><section class="secret"><p>A DC 18 Wisdom saving throw.</p>`
    + `<p>${request('data-type="skill" data-ability="str" data-skill="ath" data-dc="12"', 'DC 12 Strength (Athletics)')} check</p></section>`)
  assert.equal(readLink(html, 0).secret, false)
  assert.equal(readLink(html, 1).secret, true)
  assert.equal(readLink(html, 2).secret, true)
}
ok('a link in a secret section says so')

// ---- reading links back ----
{
  const html = norm(`${request('data-type="save" data-ability="str|dex" data-dc="20"', 'DC 20 Strength or Dexterity')} `
    + damage('data-type="damage" data-formulas="1d6&amp;1d4" data-damage-types="fire&amp;cold|fire" data-roll-type="damage"', 'burns')
    + ` ${damage('data-type="damage" data-formulas="2d4 + 2" data-damage-types="healing" data-roll-type="healing"', 'heals')} ${deferred('1d6')} `
    + `${request('data-type="concentration" data-dc="10"', 'DC 10 Concentration')} Prone`)
  assert.deepEqual(readLink(html, 0), { kind: 'save', abilities: ['str', 'dex'], dc: 20, secret: false })
  assert.deepEqual(readLink(html, 1), { kind: 'damage', parts: [{ formula: '1d6', types: ['fire'] }, { formula: '1d4', types: ['cold', 'fire'] }], healing: false })
  assert.deepEqual(readLink(html, 2), { kind: 'damage', parts: [{ formula: '2d4 + 2', types: ['healing'] }], healing: true })
  assert.deepEqual(readLink(html, 3), { kind: 'roll', formula: '1d6' })
  assert.deepEqual(readLink(html, 4), { kind: 'concentration', abilities: [], dc: 10, secret: false })
  for (const n of [5, -1, 1.5, '0', 200, null]) assert.equal(readLink(html, n), null, String(n))
  // Checks: a choice, read as its options; a tool a skill is checked using.
  const checked = norm(`${group('data-type="check" data-skill="ath|acr" data-dc="12"', 'DC 12 Strength (Athletics) or Dexterity (Acrobatics)')} `
    + `${group('data-type="check" data-format="long" data-using-tool="thief" data-skill="slt" data-tool="thief"', "Dexterity (Sleight of Hand) check using Thieves' Tools")} `
    + `${request('data-type="check" data-ability="int"', 'Intelligence')} or ${request('data-type="tool" data-ability="dex" data-tool="thief" data-dc="15"', "DC 15 Dexterity (Thieves' Tools)")}`)
  assert.deepEqual(readLink(checked, 0), { kind: 'check', checks: [{ type: 'skill', ability: 'str', key: 'ath' }, { type: 'skill', ability: 'dex', key: 'acr' }], dc: 12, secret: false })
  assert.deepEqual(readLink(checked, 1), { kind: 'check', checks: [{ type: 'skill', ability: 'dex', key: 'slt' }], dc: null, usingTool: 'thief', secret: false })
  assert.deepEqual(readLink(checked, 2), { kind: 'check', checks: [{ type: 'check', ability: 'int' }], dc: null, secret: false })
  assert.deepEqual(readLink(checked, 3), { kind: 'check', checks: [{ type: 'tool', ability: 'dex', key: 'thief' }], dc: 15, secret: false })
  // Its own copy of a check is checked again as it's read: each check one dnd5e has, of the shape
  // it names, no more than ten; a tool to use only one dnd5e has, with a skill to use it with.
  const read = (checks, extra = '') => readLink(`<span class="ss-check roll" data-n="0" data-checks="${checks}"${extra}>x</span>`, 0)
  assert.deepEqual(read('check:str|skill:dex:acr|tool:int:water', ' data-dc="999"'), { kind: 'check', checks: [{ type: 'check', ability: 'str' }, { type: 'skill', ability: 'dex', key: 'acr' }, { type: 'tool', ability: 'int', key: 'water' }], dc: null, secret: false })
  for (const bad of ['', 'check', 'check:str:ath', 'skill:str', 'skill:str:ath:x', 'skill:str:constructor', 'tool:dex:toString', 'save:dex', 'check:hon', 'check:str|', `${'check:str|'.repeat(10)}check:dex`])
    assert.equal(read(bad), null, bad)
  assert.equal(read('skill:dex:slt', ' data-using-tool="lute"').usingTool, undefined)
  assert.equal(read('tool:dex:thief', ' data-using-tool="thief"').usingTool, undefined)
  assert.equal(read('check:str|check:str|check:dex').checks.length, 2)
  assert.equal(parse(html).querySelector('.ss-condition').dataset.n, undefined, 'conditions are not numbered')
  // Even its own copy is checked again as it is read.
  assert.equal(readLink('<span class="ss-damage roll" data-n="0" data-formulas="1d6 + @mod">x</span>', 0), null)
  assert.equal(readLink('<span class="ss-damage roll" data-n="0" data-formulas="2d6r&lt;=2 + 7">x</span>', 0).parts[0].formula, '2d6r<=2 + 7')
  assert.equal(readLink('<span class="ss-roll roll" data-n="0" data-formula="6d6cs>=5">x</span>', 0).formula, '6d6cs>=5')
  assert.equal(readLink('<span class="ss-roll roll" data-n="0" data-formula="1d6; alert(1)">x</span>', 0), null)
  assert.deepEqual(readLink('<span class="ss-save roll" data-n="0" data-ability="dex" data-dc="999">x</span>', 0), { kind: 'save', abilities: ['dex'], dc: null, secret: false })
}
ok('readLink reads a link back by its number, checking it again: saves, concentration, checks, damage, healing, rolls')

// ---- limits ----
{
  const many = `<p>${'1d4 damage, '.repeat(300)}${'Prone, '.repeat(300)}</p>`
  const html = norm(many)
  const found = spans(html)
  const numbered = found.filter(s => s.n !== undefined)
  assert.equal(numbered.length, MOST_LINKS)
  assert.deepEqual(numbered.map(s => Number(s.n)), [...Array(MOST_LINKS).keys()], 'numbered 0 to 199 in order')
  assert.equal(found.filter(s => s.class.startsWith('ss-condition')).length, MOST_LINKS)
  assert.equal(textOfHtml(html), textOfHtml(many), 'the rest stay as text')
}
ok('at most 200 links to act on, numbered 0 to 199 in order, and 200 conditions; the rest are text')

// ---- timing: no input makes a pattern take long ----
{
  const time = (label, html, options) => {
    const start = performance.now()
    const out = norm(html, options)
    const ms = performance.now() - start
    assert.ok(ms < 1000, `${label}: ${ms.toFixed(0)} ms`)
    return { out, ms }
  }
  const results = [
    ['100,000 spaces', `<p>is${' '.repeat(100_000)}prone DC${' '.repeat(100_000)}15</p>`],
    ['100,000 no-break spaces', `<p>is${' '.repeat(100_000)}prone Dexterity${' '.repeat(100_000)}saving throw</p>`],
    ['100,000 newlines', `<p>knocked${'\n'.repeat(100_000)}prone</p>`],
    ['unclosed [[/save', `<p>${'[[/save '.repeat(12_500)}</p>`],
    ['unclosed &Reference[', `<p>${'&amp;Reference['.repeat(10_000)}</p>`],
    ['DC after DC', `<p>${'DC 1 '.repeat(20_000)}</p>`],
    ['abilities without saves', `<p>${'Dexterity or '.repeat(8_000)}</p>`],
    ['skills without checks', `<p>${'Dexterity (Acrobatics) or '.repeat(4_000)}</p>`],
    ['parentheses without skills', `<p>${'Strength ( '.repeat(10_000)}</p>`],
    ['passive after passive', `<p>${'passive '.repeat(12_500)}Wisdom check</p>`],
    ['dice without damage', `<p>${'7 (2d6 + '.repeat(10_000)}</p>`],
    ['is is is', `<p>${'is '.repeat(33_000)}prone</p>`],
  ].map(([label, html]) => [label, time(label, html).ms])
  const start = performance.now()
  cleanLinks(`${'[[/save '.repeat(12_500)}${'<a class="x" '.repeat(5_000)}`)
  results.push(['cleanLinks', performance.now() - start])
  assert.ok(results.at(-1)[1] < 1000)
  console.log('   ', results.map(([label, ms]) => `${label} ${ms.toFixed(0)} ms`).join(', '))
}
ok('100,000 characters of spaces, no-break spaces and unclosed [[/save each take well under a second')

// ---- the regex-only cleanup ----
{
  const html = cleanLinks(`<p>${request('data-type="save" data-ability="dex" data-dc="15"', 'DC 15 Dexterity')} [[/save]]{Resist} <span class="ss-damage roll" data-n="0" data-formulas="100d6">x</span>`
    + `${reference('prone', conditionTypes.prone.reference, 'Prone')}</p>`)
  assert.ok(!html.includes('enricher-action') && !html.includes('[[/save') && html.includes('Resist'))
  assert.equal(parse(html).querySelectorAll('[data-n], .ss-damage').length, 0)
  assert.equal(readLink(html, 0), null)
  // An award link in capitals; a link, not the GM's, between; one whose end is too far to be sure of
  // loses its opening tag alone; and <abbr> is no link.
  // Letters whose lower case is longer, such as İ, change nothing.
  assert.equal(cleanLinks('<p>İA<A CLASS="award-link" data-award-command="10gp"><i class="currency gp"></i>10</A>B'
    + '<a class="content-link" href="#">C</a><abbr class="enricher-action">D</abbr>'
    + `<a class="enricher-action">${'e'.repeat(1_000)}</a>E<a class="enricher-action">${'e'.repeat(1_001)}</a>F</p>`),
  `<p>İAB<a class="content-link" href="#">C</a><abbr class="enricher-action">D</abbr>E${'e'.repeat(1_001)}</a>F</p>`)
  // Only as much as is sent is read, and never cut inside a tag.
  const long = cleanLinks(`<p>${'<b class="x">1d4 fire damage</b> '.repeat(4_000)}</p>`)
  assert.ok(long.length <= 100_000 && !/<[^>]*$/.test(long), String(long.length))
}
ok("the string-only cleanup drops the GM's links and leftovers, and nothing in it can be taken for a link")

// ---- hostile descriptions: a link that can't be read, and the string-only cleanup at its longest ----
{
  // A rolled inline roll whose stored roll a player wrote, with a formula that isn't text: it's
  // text, and costs its description nothing else.
  const evil = `<a class="inline-roll inline-result" data-roll='{"formula":{"toString":1}}'>x</a>`
  let html = norm(`<p>Roll ${evil} and take 1d4 fire damage.</p>`)
  assert.deepEqual(spans(html).map(s => [s.class, s.formulas]), [['ss-damage roll', '1d4']])
  assert.ok(!html.includes('inline-roll'))
  // Labelled, as any rolled roll whose formula can't be read, with nothing: never its result.
  assert.equal(textOfHtml(html), 'Roll  and take 1d4 fire damage.')
  // A link whose item can't be read, as one written so that nothing here foresaw it, is its text,
  // and the description's other links are still read.
  const broken = { ...wand, system: { identified: true, activities: { getByType() { throw new Error('unreadable') } } } }
  html = norm(`<p>${request('data-type="save" data-ability="wis"', 'Wisdom')} saving throw</p><p>Take 1d4 fire damage.</p><p>Make a Dexterity saving throw.</p><p>[[/r 1d6]]</p>${deferred('1d8')}`, { relativeTo: broken })
  assert.deepEqual(spans(html).map(s => [s.n, s.class, s.formulas ?? s.formula]), [['0', 'ss-damage roll', '1d4'], ['1', 'ss-roll roll', '1d8']])
  assert.equal(textOfHtml(html), 'Wisdom saving throwTake 1d4 fire damage.Make a Dexterity saving throw.1d61d8')

  // The string-only cleanup, over a million characters that the old pattern took seconds over:
  // tags it reads to their ends, Gamemaster's links with no end, and ends too far away.
  const MILLION = 1_000_000
  const fill = unit => unit.repeat(Math.ceil(MILLION / unit.length))
  const inputs = [
    ['<a enricher-action', fill('<a enricher-action ')],
    ['<a award-link', fill('<a award-link ')],
    ['<a <a <a', fill('<a ')],
    ['unclosed GM links', fill('<a class="enricher-action">x')],
    ['an end far away', `${fill('<a class="award-link">x')}</a>`],
    ['closed GM links', fill('<a class="enricher-action"><i></i></a>')],
    ['[[/save and <a', fill('[[/save <a ')],
  ]
  const times = inputs.map(([label, input]) => {
    const start = performance.now()
    const out = cleanLinks(input)
    const ms = performance.now() - start
    assert.ok(ms < 100, `${label}: ${ms.toFixed(0)} ms`)
    assert.ok(out.length <= 100_100, `${label}: ${out.length}`)
    return `${label} ${ms.toFixed(0)} ms`
  })
  console.log('   ', times.join(', '))
}
ok("a link whose stored roll or item can't be read is its text alone, and the string-only cleanup reads a million hostile characters in well under 100 ms")

// ---- enriching: the three steps, roll data, and the size of what is sent ----
const enrichCalls = []
let enrichFails = false
foundry.applications.ux.TextEditor = { implementation: { async enrichHTML(html, options) {
  enrichCalls.push({ html, options })
  if (enrichFails || html.includes('BROKEN')) throw new Error('cannot enrich')
  // Foundry's own: [[/r …]] waits to be rolled.
  return html.replace(/\[\[\/r ([^\]]+)\]\]/g, (match, formula) => deferred(formula.trim()))
} } }
globalThis.fromUuid = async uuid => ({ uuid, text: { content: `<p>A creature is Prone. It takes 1d4 fire damage. [[/r 1d6]] ${request('data-type="save" data-ability="dex" data-dc="10"', 'DC 10 Dexterity')}</p>` } })
{
  // An effect on the character, and one on an item: enriched with the roll data of what it's on.
  const effect = { documentName: 'ActiveEffect', id: 'bless', uuid: 'Actor.thorin.ActiveEffect.bless', name: 'Bless', parent: thorin }
  const itemEffect = { documentName: 'ActiveEffect', id: 'chill', uuid: 'Actor.thorin.Item.wand.ActiveEffect.chill', name: 'Chill', parent: wand }
  const texts = new SheetTexts()
  const blessed = texts.add({ html: '<p>Add [[/r 1d4]] to your rolls.</p>', relativeTo: effect })
  const chilled = texts.add({ html: '<p>Take [[/r 1d4 + @prof]].</p>', relativeTo: itemEffect })
  assert.deepEqual(spans(await textOf(blessed, texts.sources.get(blessed))), [{ class: 'ss-roll roll', n: '0', formula: '1d4', text: '1d4' }])
  assert.deepEqual(enrichCalls.at(-1).options.rollData, thorin.getRollData())
  assert.equal(spans(await textOf(chilled, texts.sources.get(chilled)))[0].formula, '1d4 + 3')
  assert.deepEqual(enrichCalls.at(-1).options.rollData, wand.getRollData())
  assert.equal(enrichCalls.at(-1).options.secrets, true)

  // A condition's rules: its conditions are marked, but nothing in it is a link to act on.
  const rules = texts.add({ reference: conditionTypes.prone.reference })
  const ruled = await textOf(rules, texts.sources.get(rules))
  assert.deepEqual(spans(ruled), [{ class: 'ss-condition ref', condition: 'prone', text: 'Prone' }])
  assert.ok(ruled.includes('1d4 fire damage') && ruled.includes('DC 10 Dexterity') && !ruled.includes('[data-n]'))

  // 1: a description that can't be enriched is read as stored.
  const broken = texts.add({ html: '<p>BROKEN [[/damage 2d6 fire]] damage, a DC 12 Wisdom saving throw. <span class="ss-save" data-n="0" data-dc="30">x</span></p>', relativeTo: wand })
  const brokenText = await textOf(broken, texts.sources.get(broken))
  assert.deepEqual(spans(brokenText).map(s => s.text), ['2d6 fire damage', 'DC 12 Wisdom saving throw'])
  // 2: one whose links can't be read is cleaned up by string alone.
  const parser = globalThis.DOMParser
  globalThis.DOMParser = class { parseFromString() { throw new Error('no parser') } }
  const plainOne = texts.add({ html: `<p>${request('data-type="save" data-ability="dex" data-dc="15"', 'DC 15 Dexterity')} [[/save]]{Resist} <span class="ss-damage" data-n="0">x</span></p>`, relativeTo: wand })
  let cleaned
  try { cleaned = await textOf(plainOne, texts.sources.get(plainOne)) } finally { globalThis.DOMParser = parser }
  assert.ok(cleaned.includes('DC 15 Dexterity') && cleaned.includes('Resist') && !cleaned.includes('enricher-action') && !cleaned.includes('data-n=') && !cleaned.includes('"ss-'))
  // Neither fails, and a failure is cached as the text it gave.
  enrichFails = true
  const failing = texts.add({ html: '<p>Nothing works.</p>', relativeTo: thorin })
  assert.equal(await textOf(failing, texts.sources.get(failing)), '<p>Nothing works.</p>')
  enrichFails = false

  // A player's biography of a rolled inline roll they wrote to throw, and a million characters the
  // old string-only cleanup took seconds over, which Foundry keeps as it is in a comment: still
  // normalised, its links read, and quickly.
  const hostileHtml = `<p>Roll <a class="inline-roll inline-result" data-roll='{"formula":{"toString":1}}'>x</a> and take 1d4 fire damage.</p><!--${'<a enricher-action '.repeat(52_632)}-->`
  const hostile = texts.add({ html: hostileHtml, relativeTo: thorin })
  let start = performance.now()
  const hostileText = await textOf(hostile, texts.sources.get(hostile))
  const hostileMs = performance.now() - start
  assert.ok(hostileMs < 2_000, `${hostileMs.toFixed(0)} ms`)
  assert.deepEqual(spans(hostileText).map(s => s.formulas), ['1d4'])
  assert.ok(hostileText.length <= 100_000)
  // And where its links can't be read at all, the string-only cleanup is as quick.
  globalThis.DOMParser = class { parseFromString() { throw new Error('no parser') } }
  const hostileAgain = texts.add({ html: `${hostileHtml} `, relativeTo: thorin })
  start = performance.now()
  let cleanedAgain
  try { cleanedAgain = await textOf(hostileAgain, texts.sources.get(hostileAgain)) } finally { globalThis.DOMParser = parser }
  const cleanMs = performance.now() - start
  assert.ok(cleanMs < 500, `${cleanMs.toFixed(0)} ms`)
  assert.ok(cleanedAgain.length <= 100_000 && cleanedAgain.includes('1d4 fire damage'))
  console.log('   ', `hostile biography ${hostileMs.toFixed(0)} ms, cleaned up by string ${cleanMs.toFixed(0)} ms`)

  // Normalised first, then cut: a 100,000-character description dense with damage stays within
  // the longest sent, and is never cut inside a tag.
  const dense = texts.add({ html: `<p>${'1d4 fire damage '.repeat(6_250)}</p>`, relativeTo: thorin })
  const denseText = await textOf(dense, texts.sources.get(dense))
  assert.ok(denseText.length <= 100_000, String(denseText.length))
  assert.ok(!/<[^>]*$/.test(denseText), 'not cut inside a tag')
  assert.equal(spans(denseText).length, MOST_LINKS)
  // One whose tags run on past the cut, where a plain cut would land inside one.
  const tagged = texts.add({ html: `<p>${'<b class="x">1d4 fire damage</b> '.repeat(4_000)}</p>`, relativeTo: thorin })
  const taggedText = await textOf(tagged, texts.sources.get(tagged))
  assert.ok(taggedText.length <= 100_000, String(taggedText.length))
  assert.ok(!/<[^>]*$/.test(taggedText), `not cut inside a tag: …${taggedText.slice(-20)}`)
  const lastLink = Math.max(...spans(taggedText).map(s => Number(s.n)))
  assert.deepEqual([lastLink, readLink(taggedText, lastLink)], [MOST_LINKS - 1, { kind: 'damage', parts: [{ formula: '1d4', types: ['fire'] }], healing: false }])
  const huge = texts.add({ html: `<p>${'f'.repeat(250_000)}</p>`, relativeTo: thorin })
  assert.equal((await textOf(huge, texts.sources.get(huge))).length, 100_000)
  // The same promise every time: a command reads the very text sent.
  assert.equal(textOf(dense, texts.sources.get(dense)), textOf(dense, texts.sources.get(dense)))
  // A saving throw whose author hid its DC: sent without it, kept with the text sent.
  const secretive = texts.add({ html: `<p>${request('data-type="save" data-ability="dex" data-dc="16" data-hide-d-c="true"', 'Dexterity')}</p>`, relativeTo: wand })
  const secretiveText = await textOf(secretive, texts.sources.get(secretive))
  assert.ok(!secretiveText.includes('16'), secretiveText)
  assert.deepEqual([...await hiddenDCsOf(secretive, texts.sources.get(secretive))], [[0, 16]])
  assert.deepEqual([...await hiddenDCsOf(dense, texts.sources.get(dense))], [])
}
ok('enriching: effects with their actor\'s roll data, rules pages without links, the three-step fallback, hostile descriptions quickly, normalising before the cut and never cutting inside a tag, and hidden DCs kept apart')

// ---- the hash: everything the text shows, and nothing else ----
{
  const hashOf = source => new SheetTexts().add(source)
  const fire = { html: '<p>Take [[/damage 1d6 fire]], a Wisdom saving throw, against your spell save DC.</p>', relativeTo: wand }
  const stored = { html: '<p>A plain description.</p>', relativeTo: wand }
  const saving = { html: '<p>Make a Wisdom saving throw.</p>', relativeTo: wand }
  const spellDC = { html: '<p>Against your spell save DC.</p>', relativeTo: thorin }
  const effect = { documentName: 'ActiveEffect', uuid: 'Actor.thorin.ActiveEffect.e', name: 'Hex', parent: thorin }
  const effectRoll = { html: '<p>Roll [[/r 1d6]].</p>', relativeTo: effect }
  const rule = { reference: conditionTypes.prone.reference }
  const all = [fire, stored, saving, spellDC, effectRoll, rule]
  const before = all.map(hashOf)
  assert.deepEqual(all.map(hashOf), before, 'stable while nothing changes')
  assert.equal(new Set(before).size, before.length)
  assert.ok(before.every(hash => /^[0-9a-f]{14}$/.test(hash)))
  // Not the hash a description had before 0.17.0, nor in 0.17.0's format, 2, 0.18.0's, 3,
  // 0.19.0's, 4, 0.20.0's, 5, or 0.21.0's, 6, but in 0.22.0's, 7, whose links may have dice with
  // comparisons, such as 2d6r<=2.
  assert.notEqual(hashOf(stored), textHash(`${wand.uuid}\n\n${stored.html}`))
  assert.notEqual(hashOf(stored), textHash(`format:2\nrules:\nlang:en\n${wand.uuid}\n\n${stored.html}`))
  assert.notEqual(hashOf(stored), textHash(`format:3\nrules:\nlang:en\n${wand.uuid}\n\n${stored.html}`))
  assert.notEqual(hashOf(stored), textHash(`format:4\nrules:\nlang:en\n${wand.uuid}\n\n${stored.html}`))
  assert.notEqual(hashOf(stored), textHash(`format:5\nrules:\nlang:en\n${wand.uuid}\n\n${stored.html}`))
  assert.notEqual(hashOf(stored), textHash(`format:6\nrules:\nlang:en\n${wand.uuid}\n\n${stored.html}`))
  assert.equal(hashOf(stored), textHash(`format:7\nrules:\nlang:en\n${wand.uuid}\n\n${stored.html}`))
  const changes = (label, change, undo, expected) => {
    change()
    const after = all.map(hashOf)
    undo()
    assert.deepEqual(all.map(hashOf), before, `${label}: undone`)
    assert.deepEqual(after.map((hash, i) => hash !== before[i]), expected, label)
  }
  //                                                                      fire   stored saving spellDC effect rule
  changes('the rules', () => settings.set('rulesVersion', 'legacy'), () => settings.delete('rulesVersion'), [true, true, true, true, true, true])
  changes('the language', () => { game.i18n.lang = 'de' }, () => { game.i18n.lang = 'en' }, [true, true, true, true, true, true])
  changes('the spell save DC', () => { thorin.system.attributes.spell.dc = 15 }, () => { thorin.system.attributes.spell.dc = 14 }, [true, false, false, true, true, false])
  changes('a modifier', () => { thorin.system.abilities.str.mod = 5 }, () => { thorin.system.abilities.str.mod = 4 }, [true, false, false, false, true, false])
  const wisSave = wand.system.activities.getByType('save')[0]
  changes("a save activity's DC", () => { wisSave.save.dc.value = 15 }, () => { wisSave.save.dc.value = 13 }, [true, false, true, false, false, false])
  changes("a save activity's ability", () => { wisSave.save.ability = new Set(['cha']) }, () => { wisSave.save.ability = new Set(['wis']) }, [true, false, true, false, false, false])
  // A check, in plain text or dnd5e's links, shows its item's checks, which one with no DC of its own
  // takes, as dnd5e's [[/check]] shows its item's; a description that names none doesn't.
  const climbing = [
    { html: '<p>Make a Strength (Athletics) check.</p>', relativeTo: rope }, { html: '<p>[[/skill ath]]</p>', relativeTo: rope },
    { html: '<p>[[/tool thief]]</p>', relativeTo: rope }, { html: '<p>Make a Dexterity saving throw.</p>', relativeTo: rope },
    { html: '<p>Make a Strength (Athletics) check.</p>', relativeTo: hiddenRope },
  ]
  const climbed = climbing.map(hashOf)
  const athletics = rope.system.activities.getByType('check')[0]
  const checkChanges = (label, change, undo) => {
    change()
    const after = climbing.map(hashOf)
    undo()
    assert.deepEqual(climbing.map(hashOf), climbed, `${label}: undone`)
    assert.deepEqual(after.map((hash, i) => hash !== climbed[i]), [true, true, true, false, false], label)
  }
  checkChanges("a check activity's DC", () => { athletics.check.dc.value = 18 }, () => { athletics.check.dc.value = 17 })
  checkChanges("a check activity's skills", () => { athletics.check.associated = new Set(['acr', 'ath']) }, () => { athletics.check.associated = new Set(['ath']) })
  checkChanges("a check activity's ability", () => { athletics.check.ability = 'dex' }, () => { athletics.check.ability = '' })
  wand._source = { system: { activities: { a: { _id: 'a', type: 'attack', damage: { parts: [{ number: 1, denomination: 6 }] } } } } }
  const withDamage = all.map(hashOf)
  wand._source.system.activities.a.damage.parts[0].denomination = 8
  assert.notEqual(hashOf(fire), withDamage[0], "an activity's damage, for [[/damage]]")
  assert.equal(hashOf(saving), withDamage[2])
  // With an attack, its wielder's extra dice on a melee weapon's critical hit, which decide whether
  // its damage may be one; without one, they show nothing.
  const denominated = hashOf(fire)
  thorin.flags = { ...thorin.flags, dnd5e: { ...thorin.flags?.dnd5e, meleeCriticalDamageDice: 1 } }
  assert.notEqual(hashOf(fire), denominated, 'Savage Attacks, for [[/damage]] of an attack')
  assert.equal(hashOf(saving), withDamage[2])
  wand._source.system.activities.a.type = 'save'
  const saved = hashOf(fire)
  delete thorin.flags.dnd5e.meleeCriticalDamageDice
  assert.equal(hashOf(fire), saved, 'nothing, for [[/damage]] of no attack')
  delete wand._source
  // Since 0.20.0, the damage of an item's activities as resolved, as dnd5e's [[/damage]] links show
  // it, and what a critical hit adds to it: the character's bonuses to damage, such as Rage's, and
  // the scale values they name, and an attack's critical damage. A description with no such link
  // shows none of it.
  const greataxe = {
    documentName: 'Item', id: 'greataxe', uuid: 'Actor.thorin.Item.greataxe', name: 'Greataxe', type: 'weapon', parent: thorin,
    system: { identified: true }, _source: { system: { activities: { chop: { _id: 'chop', type: 'attack' } } } },
    getRollData() { return { ...thorin.getRollData(), scale: structuredClone(thorin.scale) } },
  }
  const chop = {
    id: 'chop', type: 'attack', uuid: `${greataxe.uuid}.Activity.chop`, criticalBonus: '1d6',
    // attack-data.mjs:288-330 and base-activity.mjs:768-791, as far as these use them.
    getDamageConfig(config = {}) {
      const bonus = thorin.system.bonuses.mwak.damage
      const options = { type: 'slashing', types: ['slashing'], ...(this.criticalBonus && { critical: { bonusDamage: this.criticalBonus } }) }
      return { ...config, rolls: [{ parts: ['1d12 + @mod', ...(bonus ? [bonus] : [])], data: greataxe.getRollData(), options }] }
    },
  }
  greataxe.system.activities = activities([chop])
  thorin.system.bonuses = { mwak: { damage: '' } }
  thorin.scale = { barbarian: { rage: 2 } }
  const chopping = { html: '<p>Take [[/damage activity=chop]].</p>', relativeTo: greataxe }
  const plainAxe = { html: '<p>A plain description, of a Wisdom saving throw.</p>', relativeTo: greataxe }
  const axed = [chopping, plainAxe].map(hashOf)
  const axeChanges = (label, change, undo, expected) => {
    change()
    const after = [chopping, plainAxe].map(hashOf)
    undo()
    assert.deepEqual([chopping, plainAxe].map(hashOf), axed, `${label}: undone`)
    assert.deepEqual(after.map((hash, i) => hash !== axed[i]), expected, label)
  }
  axeChanges('its critical damage', () => { chop.criticalBonus = '1d8' }, () => { chop.criticalBonus = '1d6' }, [true, false])
  axeChanges('a bonus to melee weapon damage', () => { thorin.system.bonuses.mwak.damage = '2' }, () => { thorin.system.bonuses.mwak.damage = '' }, [true, false])
  thorin.system.bonuses.mwak.damage = '@scale.barbarian.rage'
  axed.splice(0, 2, ...[chopping, plainAxe].map(hashOf))
  axeChanges('a scale value the bonus names', () => { thorin.scale.barbarian.rage = 3 }, () => { thorin.scale.barbarian.rage = 2 }, [true, false])
  delete thorin.system.bonuses
  delete thorin.scale
  ok("since 0.20.0 a damage link's description is new when what its damage resolves to changes, or what a critical hit adds to it: an attack's critical damage, a bonus to its damage, a scale value the bonus names; one with no such link keeps its hash")
  // An item not identified yet: its saving throws aren't read, so changing them changes nothing.
  const unknown = { html: '<p>Make a Wisdom saving throw.</p>', relativeTo: hiddenWand }
  const unknownHash = hashOf(unknown)
  hiddenWand.system.activities.getByType('save')[0].save.dc.value = 18
  assert.equal(hashOf(unknown), unknownHash)
  hiddenWand.system.activities.getByType('save')[0].save.dc.value = 13
  // An effect on an item reaches its actor through the item.
  const onItem = { html: '<p>Roll [[/r 1d6]].</p>', relativeTo: { documentName: 'ActiveEffect', uuid: 'x', parent: wand } }
  const onItemHash = hashOf(onItem)
  thorin.system.details.level = 6
  assert.notEqual(hashOf(onItem), onItemHash)
  thorin.system.details.level = 5
}
ok('the hash changes with the format, rules, language, spell save DC, modifiers and save and check activities a text shows, and only those; effects find their actor')

// ---- finding a link, as a command does ----
{
  // A character whose sheet can be read: just enough of one.
  const gm = user('gm', 'Gamemaster', true)
  users.activeGM = gm
  const vex = actor('vex', 'Vex', ['bob'])
  vex.documentName = 'Actor'
  Object.assign(vex.system, {
    abilities: { dex: { value: 14, mod: 2 }, wis: { value: 12, mod: 1 } }, skills: {},
    attributes: { ...vex.system.attributes, prof: 2, spell: { dc: 13 } }, details: { level: 3, biography: { value: '<p>Vex is Prone to [[/r 1d4]] naps.</p>' } },
  })
  vex.getRollData = () => ({ prof: 2 })
  const items = new Map()
  vex.items = { get: id => items.get(id), [Symbol.iterator]: () => items.values(), filter: fn => [...items.values()].filter(fn), some: fn => [...items.values()].some(fn), contents: [] }
  vex.itemTypes = {}
  vex.statuses = new Set()
  vex.allApplicableEffects = function* () {}
  CONFIG.Item = { typeLabels: {}, dataModels: {} }
  CONFIG.statusEffects = []
  game.i18n.format = (key, data) => key
  const sheetModule = await import(`${MODULE}/scripts/sheet.mjs`)
  const texts = new SheetTexts()
  assert.ok(sheetModule.characterSheet(vex, texts), 'the stand-in character has a sheet')
  const [hash] = [...texts.sources.keys()]
  const found = await findLink(vex, hash, 0)
  assert.deepEqual(found.link, { kind: 'roll', formula: '1d4' })
  assert.deepEqual(found.origin, { name: 'Vex' })
  assert.deepEqual(found.source, texts.sources.get(hash))
  assert.deepEqual(await findLink(vex, hash, 1), { refusal: 'link' })
  // A saving throw whose author hid its DC is found with it, which the app was never sent.
  const plainBio = vex.system.details.biography.value
  vex.system.details.biography.value = `<p>${request('data-type="save" data-ability="dex" data-dc="14"', 'DC 14 Dexterity')} or ${request('data-type="save" data-ability="wis" data-dc="16" data-hide-d-c="true"', 'Wisdom')}`
    + ` or ${request('data-type="skill" data-ability="str" data-skill="ath" data-dc="13" data-hide-d-c="true"', 'Strength (Athletics)')} check, or a DC 12 Intelligence check</p>`
  const hiding = new SheetTexts()
  sheetModule.characterSheet(vex, hiding)
  const [hidingHash] = [...hiding.sources.keys()]
  assert.deepEqual((await findLink(vex, hidingHash, 0)).link, { kind: 'save', abilities: ['dex'], dc: 14, secret: false })
  assert.deepEqual((await findLink(vex, hidingHash, 1)).link, { kind: 'save', abilities: ['wis'], dc: 16, secret: false, hideDC: true })
  assert.ok(!(await textOf(hidingHash, hiding.sources.get(hidingHash))).includes('16'))
  // So is a check whose author hid its DC.
  assert.deepEqual((await findLink(vex, hidingHash, 2)).link, { kind: 'check', checks: [{ type: 'skill', ability: 'str', key: 'ath' }], dc: 13, secret: false, hideDC: true })
  assert.deepEqual((await findLink(vex, hidingHash, 3)).link, { kind: 'check', checks: [{ type: 'check', ability: 'int' }], dc: 12, secret: false })
  assert.ok(!(await textOf(hidingHash, hiding.sources.get(hidingHash))).includes('13'))
  vex.system.details.biography.value = plainBio
  assert.deepEqual(await findLink(vex, '00000000000000', 0), { refusal: 'gone' })
  vex.system.details.biography.value = '<p>Vex is rested.</p>'
  assert.deepEqual(await findLink(vex, hash, 0), { refusal: 'gone' }, 'a description no longer on the sheet')
  vex.system.abilities = undefined
  assert.deepEqual(await findLink(vex, hash, 0), { refusal: 'gone' }, 'a character with no sheet')
}
ok("findLink reads a link from the description on the character's sheet now, with a DC its author hid of a save or a check, and refuses one gone or missing")

// ---- where a link comes from ----
{
  const staff = { documentName: 'Item', id: 'staff', name: 'Worn Bardic Eternal Flame', type: 'equipment' }
  const wisp = { documentName: 'Item', id: 'wisp', name: 'Starry Wisp', type: 'spell', flags: { dnd5e: { cachedFor: '.Item.staff.Activity.cast' } }, system: { linkedActivity: { item: staff } } }
  assert.deepEqual(originOf(thorin, { relativeTo: wand }), { name: 'Wand of Frost', item: wand })
  assert.deepEqual(originOf(thorin, { relativeTo: wisp }), { name: 'Starry Wisp (Worn Bardic Eternal Flame)', item: staff, spell: wisp })
  assert.deepEqual(originOf(thorin, { relativeTo: { ...hiddenWand, name: 'Unidentified Rod' } }).name, 'Unidentified Rod')
  assert.deepEqual(originOf(thorin, { relativeTo: { documentName: 'ActiveEffect', name: 'Hex', parent: thorin } }), { name: 'Hex' })
  assert.deepEqual(originOf(thorin, { relativeTo: thorin }), { name: 'Thorin' })
}
ok('a link comes from its item, as players know it; a spell an item casts, with the item and the spell; an effect; or the character')
