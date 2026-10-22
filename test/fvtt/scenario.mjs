import assert from 'node:assert/strict'
import { actor, combat, combatant, combats, message, posts, settle, user, users } from './stub.mjs'

const MODULE = process.env.MODULE_DIR
const ok = msg => console.log('ok -', msg)
const take = () => posts.splice(0).map(p => ({ ...p.envelope, url: p.url, auth: p.headers.Authorization }))
const byCampaign = envs => Object.fromEntries(envs.map(e => [e.campaign?.title, e]))

// The table: a Gamemaster, two players, a character each, and an NPC.
const gm = user('gm', 'Gamemaster', true)
users.activeGM = gm
user('alice', 'Alice'); user('bob', 'Bob')
const thorin = actor('thorin', 'Thorin', ['alice'])
const vex = actor('vex', 'Vex', ['bob'])
const goblin = actor('goblin', 'Goblin', [], 'npc', { value: 7, max: 7, temp: 0 })

await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')

// A world set up before campaigns: a full listener URL and connected characters.
const { settings } = await import('./stub.mjs')
settings.set('listenerUrl', 'https://stone.example/api/sending-stone')
settings.set('secret', 'hunter2')
settings.set('chatEvents', true)
settings.set('combatEvents', true)
settings.set('characters', new Set(['thorin', 'vex']))

await Hooks.callAll('ready')
await settle()

// ---- Migration and the destination ----
const { getCampaigns } = await import(`${MODULE}/scripts/campaigns.mjs`)
let campaigns = getCampaigns()
assert.equal(campaigns.length, 1)
assert.equal(campaigns[0].title, 'Return to Erebor')
assert.deepEqual([...campaigns[0].characters], ['thorin', 'vex'])
assert.deepEqual([...settings.get('characters')], [])
ok('connected characters from before campaigns move into a campaign titled after the world')

let sent = take()
assert.ok(sent.length >= 1)
assert.ok(sent.every(e => e.url === 'https://stone.example/api/events'), 'legacy full URL reduced to its origin + /api/events')
assert.ok(sent.every(e => e.auth === 'Bearer hunter2'))
assert.ok(sent.every(e => e.protocol === 2 && e.campaign.title === 'Return to Erebor'))
// Each hello is followed, once it's answered, by each of its characters in a post of its own.
const order = sent.map(e => (e.type === 'bridge.hello') ? 'hello' : `${e.type} ${e.data.character.id}`)
assert.equal(order.join(', '), Array(order.filter(o => o === 'hello').length).fill('hello, character.updated thorin, character.updated vex').join(', '))
assert.ok(sent.filter(e => e.type === 'bridge.hello').every(e => e.data.sheetsApart === true && e.data.characters.every(c => !('sheet' in c))))
ok('a legacy listener URL posts to <origin>/api/events with the secret, protocol 2, hello per campaign, its sheets after it')

// ---- Two campaigns ----
const { getDestination, parseDestination, eventsUrl } = await import(`${MODULE}/scripts/config.mjs`)
for (const [typed, origin] of [
  ['sending-stone.vercel.app', 'https://sending-stone.vercel.app'],
  ['https://sending-stone.vercel.app/api/events?x=1', 'https://sending-stone.vercel.app'],
  ['localhost:3000', 'http://localhost:3000'],
  ['http://127.0.0.1:8787/events', 'http://127.0.0.1:8787'],
  ['[::1]:8787', 'http://[::1]:8787'],
  ['HTTPS://Stone.Example:8443/', 'https://stone.example:8443'],
]) assert.equal(parseDestination(typed)?.origin, origin, typed)
for (const bad of ['', 'ftp://x.example', 'not a host', 'javascript:alert(1)']) assert.equal(parseDestination(bad), null, bad)
assert.equal(eventsUrl(parseDestination('https://a.example/deep/path')), 'https://a.example/api/events')
ok('destinations reduce to their origin, defaulting to https (http for localhost); bad ones are refused')

await game.settings.set('sending-stone', 'listenerUrl', 'https://sending-stone.vercel.app')
await game.settings.set('sending-stone', 'campaigns', [
  { id: 'camp-a', title: 'Erebor', characters: ['thorin'] },
  { id: 'camp-b', title: 'Mirkwood', characters: ['vex'] },
])
await settle()
assert.equal(getDestination(), 'https://sending-stone.vercel.app')
sent = take().filter(e => e.type === 'bridge.hello')
const hellos = byCampaign(sent.slice(-2))
assert.deepEqual(hellos.Erebor.data.characters.map(c => c.id), ['thorin'])
assert.deepEqual(hellos.Mirkwood.data.characters.map(c => c.id), ['vex'])
assert.deepEqual(hellos.Erebor.campaign, { id: 'camp-a', title: 'Erebor' })
assert.ok(sent.every(e => e.url === 'https://sending-stone.vercel.app/api/events'))
ok('changing campaigns sends each its own bridge.hello with only its characters')

// ---- Chat ----
const say = async (msg) => { await Hooks.callAll('createChatMessage', msg); await settle(); return take() }

let out = await say(message('m1', { content: '<p>Roll initiative!</p>' }))
assert.deepEqual(out.map(e => e.campaign.title).sort(), ['Erebor', 'Mirkwood'])
assert.deepEqual(byCampaign(out).Erebor.data.message.audience.characters, ['thorin'])
assert.deepEqual(byCampaign(out).Mirkwood.data.message.audience.characters, ['vex'])
assert.notEqual(byCampaign(out).Erebor.id, byCampaign(out).Mirkwood.id)
ok('a public message reaches every campaign, its audience listing only that campaign’s characters')

out = await say(message('m2', { whisper: ['alice'] }))
assert.deepEqual(out.map(e => e.campaign.title), ['Erebor'])
assert.deepEqual(out[0].data.message.audience, { public: false, gmOnly: false, users: ['alice'], characters: ['thorin'] })
ok("a whisper to Thorin's player goes only to Thorin's campaign")

out = await say(message('m3', { speakerActor: vex, speaker: { actor: 'vex' }, alias: 'Vex', author: users.get('bob'), _source: { author: 'bob' } }))
assert.equal(byCampaign(out).Mirkwood.data.message.character, 'vex')
assert.equal(byCampaign(out).Erebor.data.message.character, null)
ok("a campaign's own character is named as the speaker only in its campaign")

out = await say(message('m4', { whisper: ['gm'], blind: true, speakerActor: thorin, speaker: { actor: 'thorin' } }))
assert.deepEqual(out, [])
ok('Gamemaster-only messages stay unsent while Gamemaster-only information is off')

settings.set('gmContent', true)
out = await say(message('m5', { whisper: ['gm'], blind: true, speakerActor: thorin, speaker: { actor: 'thorin' } }))
assert.deepEqual(out.map(e => e.campaign.title), ['Erebor'])
settings.set('gmContent', false)
ok('with Gamemaster-only information on, a blind roll by Thorin goes to his campaign only')

settings.set('chatScope', 'connected')
out = await say(message('m6'))
assert.deepEqual(out, [])
out = await say(message('m7', { speakerActor: thorin, speaker: { actor: 'thorin' } }))
assert.deepEqual(out.map(e => e.campaign.title), ['Erebor'])
settings.set('chatScope', 'all')
ok("'its characters' messages only' sends a campaign just what its characters said")

// ---- Chat cards that ask for a save, and their DCs ----
// dnd5e's cards as its templates render them: a roll request (roll-request-card.hbs, with
// createRollLabel's labels), and a save's and a check's activity cards (activity-card.hbs, with
// save.mjs's and check.mjs's labels).
CONFIG.DND5E = { abilities: Object.fromEntries([['str', 'Strength'], ['dex', 'Dexterity'], ['con', 'Constitution']].map(([key, label]) => [key, { label }])) }
// A request for a link whose author hid its DC (hideDC) keeps the DC on its button, marked so, and
// labels it without the DC either way (enrichers.mjs: handlePostRequest, createRollLabel).
const requestHtml = (buttons) => `<div class="chat-card request-card">
    <div class="card-buttons">
        ${buttons.map(({ ability, dc, type = 'save', hideDC = false }) => `<button data-type="${type}"${ability ? ` data-ability="${ability}"` : ''}${dc ? ` data-dc="${dc}"` : ''}${hideDC ? ' data-hide-dc="true"' : ''} data-format="${type === 'save' ? 'long' : 'short'}" data-action="rollRequest" data-visibility="all">
            <span class="visible-dc"><i class="fas fa-shield-heart"></i>${(dc && !hideDC) ? `DC ${dc} ` : ''}${CONFIG.DND5E.abilities[ability]?.label ?? 'Concentration '}${type === 'save' ? ' saving throw' : ''}</span>
            <span class="hidden-dc"><i class="fas fa-shield-heart"></i>${CONFIG.DND5E.abilities[ability]?.label ?? 'Concentration '}${type === 'save' ? ' saving throw' : ''}</span>
        </button>`).join('\n        ')}
    </div>
</div>`
const activityHtml = (name, buttons) => `<div class="chat-card activation-card">
    <section class="card-header description collapsible">
        <header class="summary">
            <img class="gold-icon" src="icons/fire.webp" alt="${name}">
            <div class="name-stacked border">
                <span class="title">${name}</span>
            </div>
            <i class="fa-solid fa-chevron-down fa-fw" inert></i>
        </header>
        <section class="details collapsible-content card-content">
            <div class="wrapper"><p>A thin sheet of flames.</p></div>
        </section>
    </section>
    <div class="card-buttons">
        ${buttons.join('\n        ')}
    </div>
</div>`
const saveButton = `<button type="button" data-dc="13" data-ability="dex" data-action="rollSave" data-visibility="all">
            <i class="fa-solid fa-shield-heart" inert></i> <span>
          <span class="visible-dc">DC 13 Dexterity Saving Throw</span>
          <span class="hidden-dc">Dexterity Saving Throw</span>
        </span>
        </button>`
const checkButton = `<button type="button" data-ability="str" data-action="rollCheck" data-visibility="all" data-dc="15" data-skill="ath">
            <i class="dnd5e-icon" data-src="systems/dnd5e/icons/svg/ability-score-improvement.svg" inert></i> <span>
          <span class="visible-dc">DC 15 Strength (Athletics)</span>
          <span class="hidden-dc">Strength (Athletics)</span>
        </span>
        </button>`
const damageButton = `<button type="button" data-action="rollDamage">
            <i class="fas fa-burst" inert></i> <span>Damage</span>
        </button>`
const card = (id, fields) => say(message(id, { flavor: 'Roll Request', alias: 'Gamemaster', ...fields })).then(out => byCampaign(out).Erebor.data.message)
const alice = users.get('alice')
const fromAlice = { author: alice, _source: { author: 'alice' }, speakerActor: thorin, speaker: { actor: 'thorin' }, alias: 'Thorin' }

settings.set('challengeVisibility', 'player')
let sent2 = await card('r1', { content: requestHtml([{ ability: 'dex', dc: 15 }]) })
assert.deepEqual([sent2.ask, sent2.text], [{ type: 'save', abilities: ['dex'] }, 'Dexterity saving throw'])
sent2 = await card('r2', { content: requestHtml([{ ability: 'dex', dc: 15 }]), ...fromAlice })
assert.deepEqual([sent2.ask, sent2.text], [{ type: 'save', abilities: ['dex'], dc: 15 }, 'DC 15 Dexterity saving throw'])
sent2 = await card('r3', { content: requestHtml([{ ability: 'str', dc: 20 }, { ability: 'dex', dc: 20 }]) })
assert.deepEqual([sent2.ask, sent2.text], [{ type: 'save', abilities: ['str', 'dex'] }, 'Strength saving throw Dexterity saving throw'])
sent2 = await card('r4', { content: requestHtml([{ type: 'concentration', dc: 10 }]) })
assert.deepEqual([sent2.ask, sent2.text], [{ type: 'concentration', abilities: [] }, 'Concentration'])
settings.set('challengeVisibility', 'all')
sent2 = await card('r5', { content: requestHtml([{ ability: 'dex', dc: 15 }]) })
assert.deepEqual([sent2.ask, sent2.text], [{ type: 'save', abilities: ['dex'], dc: 15 }, 'DC 15 Dexterity saving throw'])
// One whose author hid its DC shows it no one, under Show all too, and from a player too; nor does
// any card whose labels with and without the DC are the same.
sent2 = await card('r5h', { content: requestHtml([{ ability: 'dex', dc: 15, hideDC: true }]) })
assert.deepEqual([sent2.ask, sent2.text], [{ type: 'save', abilities: ['dex'] }, 'Dexterity saving throw'])
sent2 = await card('r5i', { content: requestHtml([{ type: 'concentration', dc: 12, hideDC: true }]), ...fromAlice })
assert.deepEqual([sent2.ask, sent2.text], [{ type: 'concentration', abilities: [] }, 'Concentration'])
sent2 = await card('r5j', { content: requestHtml([{ ability: 'dex', dc: 15 }]).replace('DC 15 Dexterity', 'Dexterity') })
assert.deepEqual([sent2.ask, sent2.text], [{ type: 'save', abilities: ['dex'] }, 'Dexterity saving throw'])
settings.set('challengeVisibility', 'none')
sent2 = await card('r6', { content: requestHtml([{ ability: 'dex', dc: 15 }]), ...fromAlice })
assert.deepEqual([sent2.ask, sent2.text], [{ type: 'save', abilities: ['dex'] }, 'Dexterity saving throw'])
settings.set('challengeVisibility', 'player')
ok("a roll request card tells the app what it asks, its DC and its text's one label only where dnd5e's Challenge Visibility shows players, and never a DC the card hides")

sent2 = await card('r7', { content: requestHtml([{ ability: 'constructor', dc: 15 }, { ability: 'dex', dc: 15 }]) })
assert.deepEqual(sent2.ask, { type: 'save', abilities: ['dex'] })
sent2 = await card('r8', {
  content: requestHtml([{ ability: 'dex', dc: 11 }]), ...fromAlice,
  flavor: 'EDITOR.DND5E.Inline.RollRequest: &lt;b&gt;Fire &amp; Ice&lt;/b&gt;',
  flags: { 'sending-stone': { request: 'req-1', ask: { actorId: 'thorin', text: '00000000e00001', link: 0 } } },
})
assert.deepEqual(sent2.ask, { type: 'save', abilities: ['dex'], dc: 11, label: '<b>Fire & Ice</b>' })
assert.equal((await card('r9', { content: requestHtml([{ ability: 'dex', dc: 11 }]), flavor: 'EDITOR.DND5E.Inline.RollRequest: Fake' })).ask.label, undefined)
ok("an ability only dnd5e has is asked; the module's own ask says what asks, unescaped, and no other card does")

// A request for a check, as dnd5e's handlePostRequest makes it for a /check, /skill or /tool link
// (createCheckRequestButtons, createRequestButton, createRollLabel): a button for each check, with
// its kind, ability, skill or tool, DC and the short format, and the tool a skill is checked using.
CONFIG.DND5E.abilities.int = { label: 'Intelligence' }
CONFIG.DND5E.abilities.wis = { label: 'Wisdom' }
CONFIG.DND5E.abilities.cha = { label: 'Charisma' }
CONFIG.DND5E.abilities.hon = { label: 'Honor' }
CONFIG.DND5E.skills = { ath: { label: 'Athletics', ability: 'str' }, acr: { label: 'Acrobatics', ability: 'dex' }, slt: { label: 'Sleight of Hand', ability: 'dex' }, prc: { label: 'Perception', ability: 'wis' } }
CONFIG.DND5E.tools = { thief: { ability: 'dex', id: 'Compendium.dnd5e.equipment24.Item.phbtulThievesToo' } }
CONFIG.DND5E.vehicleTypes = { water: 'Water Vehicle' }
globalThis.dnd5e = { documents: { Trait: { keyLabel: (key, { trait }) => ((trait === 'tool') ? ({ thief: "Thieves' Tools", water: 'Water Vehicle' })[key] : undefined) ?? key } } }
const CHECK_ICON = '<i class="dnd5e-icon" data-src="systems/dnd5e/icons/svg/ability-score-improvement.svg"></i>'
const checkLabel = ({ ability, skill, tool }) => {
  const named = CONFIG.DND5E.abilities[ability]?.label ?? ''
  const type = skill ? CONFIG.DND5E.skills[skill]?.label : (tool ? globalThis.dnd5e.documents.Trait.keyLabel(tool, { trait: 'tool' }) : null)
  return type ? `${named} (${type})` : named
}
const checkRequestHtml = buttons => `<div class="chat-card request-card">
    <div class="card-buttons">
        ${buttons.map(({ type = 'skill', ability, skill, tool, usingTool, dc, hideDC = false }) => `<button data-type="${type}"${ability ? ` data-ability="${ability}"` : ''}${skill ? ` data-skill="${skill}"` : ''}${tool ? ` data-tool="${tool}"` : ''}${usingTool ? ` data-using-tool="${usingTool}"` : ''}${dc ? ` data-dc="${dc}"` : ''}${hideDC ? ' data-hide-dc="true"' : ''} data-format="short" data-action="rollRequest" data-visibility="all">
            <span class="visible-dc">${CHECK_ICON}${(dc && !hideDC) ? `DC ${dc} ` : ''}${checkLabel({ ability, skill, tool })}</span>
            <span class="hidden-dc">${CHECK_ICON}${checkLabel({ ability, skill, tool })}</span>
        </button>`).join('\n        ')}
    </div>
</div>`
const athAcr = [{ ability: 'str', skill: 'ath', dc: 12 }, { ability: 'dex', skill: 'acr', dc: 12 }]
const asAthAcr = { type: 'check', checks: [{ type: 'skill', ability: 'str', skill: 'ath' }, { type: 'skill', ability: 'dex', skill: 'acr' }] }
settings.set('challengeVisibility', 'player')
// [[/check skill=ath/acr dc=12]]: the Gamemaster's, its DC hidden from players under "only from
// other players"; a player's, shown.
sent2 = await card('c1', { content: checkRequestHtml(athAcr) })
assert.deepEqual([sent2.ask, sent2.text], [asAthAcr, 'Strength (Athletics) Dexterity (Acrobatics)'])
sent2 = await card('c2', { content: checkRequestHtml(athAcr), ...fromAlice })
assert.deepEqual([sent2.ask, sent2.text], [{ ...asAthAcr, dc: 12 }, 'DC 12 Strength (Athletics) DC 12 Dexterity (Acrobatics)'])
settings.set('challengeVisibility', 'all')
// [[/check str 15]], [[/tool thief 15]], [[/check slt thief]] under the 2024 rules, and a kind of
// vehicle with an ability the author gave it: a tool named as dnd5e names it, never by its label.
sent2 = await card('c3', { content: checkRequestHtml([{ type: 'check', ability: 'str', dc: 15 }]) })
assert.deepEqual([sent2.ask, sent2.text], [{ type: 'check', checks: [{ type: 'check', ability: 'str' }], dc: 15 }, 'DC 15 Strength'])
sent2 = await card('c4', { content: checkRequestHtml([{ type: 'tool', ability: 'dex', tool: 'thief', dc: 15 }]).replaceAll("(Thieves' Tools)", '(Fake Tools)') })
assert.deepEqual([sent2.ask, sent2.text], [{ type: 'check', checks: [{ type: 'tool', ability: 'dex', tool: 'thief', name: "Thieves' Tools" }], dc: 15 }, 'DC 15 Dexterity (Fake Tools)'])
sent2 = await card('c5', { content: checkRequestHtml([{ ability: 'dex', skill: 'slt', usingTool: 'thief' }, { type: 'tool', ability: 'int', tool: 'water' }]) })
assert.deepEqual(sent2.ask, { type: 'check', checks: [{ type: 'skill', ability: 'dex', skill: 'slt' }, { type: 'tool', ability: 'int', tool: 'water', name: 'Water Vehicle' }] })
// One whose author hid its DC shows it no one, under Show all too.
sent2 = await card('c6', { content: checkRequestHtml([{ ability: 'str', skill: 'ath', dc: 18, hideDC: true }]) })
assert.deepEqual([sent2.ask, sent2.text], [{ type: 'check', checks: [{ type: 'skill', ability: 'str', skill: 'ath' }] }, 'Strength (Athletics)'])
settings.set('challengeVisibility', 'none')
sent2 = await card('c7', { content: checkRequestHtml(athAcr), ...fromAlice })
assert.deepEqual([sent2.ask, sent2.text], [asAthAcr, 'Strength (Athletics) Dexterity (Acrobatics)'])
settings.set('challengeVisibility', 'player')
ok("a check's roll request card tells the app the checks it asks for, an ability, skill or tool, a tool by dnd5e's name for it, and its DC only where players may see it")

// Only what dnd5e has, by keys the app accepts, with one of the six abilities, its own or the
// skill's or tool's; each once; and a card that asks for more than ten asks nothing of the app.
CONFIG.DND5E.skills['odd.one'] = { label: 'Oddity', ability: 'str' }
sent2 = await card('c8', { content: checkRequestHtml([{ ability: 'str', skill: 'odd.one' },
  { ability: 'constructor', skill: 'ath' }, { ability: 'str', skill: 'constructor' }, { type: 'tool', ability: 'dex', tool: 'toString' }, { type: 'check', ability: 'hon' },
  { type: 'check', ability: 'spellcasting' }, { type: 'tool', tool: 'water' }, { type: 'attack', ability: 'dex' }, { skill: 'acr' }, { ability: 'str', skill: 'ath' }, { ability: 'dex', skill: 'ath' },
]) })
assert.deepEqual(sent2.ask, { type: 'check', checks: [{ type: 'skill', ability: 'dex', skill: 'acr' }, { type: 'skill', ability: 'str', skill: 'ath' }] })
delete CONFIG.DND5E.skills['odd.one']
assert.equal((await card('c9', { content: checkRequestHtml([{ type: 'check', ability: 'hon' }, { ability: 'str', skill: 'nope' }]) })).ask, null)
const eleven = [...['str', 'dex', 'con', 'int', 'wis', 'cha'].map(ability => ({ type: 'check', ability })),
  ...['ath', 'acr', 'slt', 'prc'].map(skill => ({ skill, ability: CONFIG.DND5E.skills[skill].ability })), { type: 'tool', ability: 'dex', tool: 'thief' }]
assert.equal((await card('c10', { content: checkRequestHtml(eleven) })).ask, null)
assert.equal((await card('c11', { content: checkRequestHtml(eleven.slice(1)) })).ask.checks.length, 10)
// A save's request is asked as a save, though the card has a check's button too.
sent2 = await card('c12', { content: requestHtml([{ ability: 'dex', dc: 15 }]).replace('</div>\n</div>', `${checkRequestHtml([{ ability: 'str', skill: 'ath' }])}</div>\n</div>`) })
assert.deepEqual(sent2.ask, { type: 'save', abilities: ['dex'] })
delete CONFIG.DND5E.abilities.hon
delete globalThis.dnd5e
ok("a check's request offers only dnd5e's skills, tools and abilities, each once, and no more than ten; a save's request with it is a save's")

sent2 = await card('a1', { flavor: '', content: activityHtml('Burning Hands', [saveButton, damageButton]) })
assert.deepEqual([sent2.ask, sent2.text], [null, 'Burning Hands A thin sheet of flames. Dexterity Saving Throw Damage'])
sent2 = await card('a2', { flavor: '', content: activityHtml('Burning Hands', [saveButton, damageButton]), ...fromAlice })
assert.equal(sent2.text, 'Burning Hands A thin sheet of flames. DC 13 Dexterity Saving Throw Damage')
sent2 = await card('a3', { flavor: '', content: activityHtml('Shove', [checkButton]) })
assert.deepEqual([sent2.ask, sent2.text], [null, 'Shove A thin sheet of flames. Strength (Athletics)'])
settings.set('challengeVisibility', 'all')
sent2 = await card('a4', { flavor: '', content: activityHtml('Shove', [checkButton]) })
assert.equal(sent2.text, 'Shove A thin sheet of flames. DC 15 Strength (Athletics)')
settings.set('challengeVisibility', 'player')
assert.equal((await card('p1', { content: '<p>Roll initiative!</p>' })).ask, null)
ok("a save's or a check's activity card has one label for each button in its text, and asks the app's chat nothing")

// Anyone may post a message, of any length: content links are reduced to their labels quickly,
// whatever it holds, in its content and in an ask's flavor alike.
sent2 = await card('l1', { content: '<p>Ask @UUID[Actor.thorin]{Thorin} and @Compendium[dnd5e.rules.x]{the rules}.</p>' })
assert.equal(sent2.text, 'Ask Thorin and the rules.')
const hostile = [['@a[', 33_334], ['@a[]{', 20_000], ['@a[x]{', 16_667], [`@${'a'.repeat(60)}[`, 1_600]]
const timings = []
for (const [unit, times] of hostile) {
  const start = performance.now()
  sent2 = await card(`l-${unit.length}`, {
    content: unit.repeat(times), ...fromAlice, flavor: `EDITOR.DND5E.Inline.RollRequest: ${unit.repeat(times)}`,
    flags: { 'sending-stone': { request: 'req-2', ask: { actorId: 'thorin', text: '00000000e00001', link: 0 } } },
  })
  const ms = performance.now() - start
  timings.push(`${unit.slice(0, 6)}… ${ms.toFixed(0)} ms`)
  assert.ok(ms < 250, `${unit}: ${ms.toFixed(0)} ms`)
  assert.equal(sent2.text.length, unit.length * times)
}
console.log('   ', timings.join(', '))
delete CONFIG.DND5E
ok('content links are reduced to their labels, and 100,000 characters of hostile chat are read in well under a second')

const m8 = message('m8')
await Hooks.callAll('updateChatMessage', Object.assign(m8, { whisper: ['bob'] }), { whisper: ['bob'] })
await settle()
out = take()
assert.equal(byCampaign(out).Mirkwood.type, 'chat.message.updated')
assert.equal(byCampaign(out).Erebor.type, 'chat.message.deleted')
ok('a message made private is updated where it can still be read and deleted elsewhere')

await Hooks.callAll('deleteChatMessage', message('m9'), {})
await settle()
assert.deepEqual(take().map(e => `${e.type} ${e.campaign.title}`).sort(), ['chat.message.deleted Erebor', 'chat.message.deleted Mirkwood'])
await Hooks.callAll('deleteChatMessage', message('m10'), { deleteAll: true })
await Hooks.callAll('deleteChatMessage', message('m11'), { deleteAll: true })
await settle()
assert.deepEqual(take().map(e => `${e.type} ${e.campaign.title}`).sort(), ['chat.cleared Erebor', 'chat.cleared Mirkwood'])
ok('deletions follow the message; clearing the log is one chat.cleared per campaign')

// ---- Combat ----
const fight = combat('cmbt1')
const fire = async (hook, ...args) => { await Hooks.callAll(hook, ...args); await settle(); return take() }

assert.deepEqual(await fire('createCombat', fight), [])
assert.deepEqual(await fire('createCombatant', combatant(fight, 'c-gob', goblin, { initiative: 12 })), [])
ok('an encounter with no campaign characters is sent nowhere')

out = await fire('createCombatant', combatant(fight, 'c-thorin', thorin, { initiative: 17 }))
assert.deepEqual(out.map(e => `${e.type} ${e.campaign.title}`), ['combat.created Erebor'])
const snapshot = out[0].data.combat
assert.deepEqual(snapshot.combatants.map(c => [c.id, c.character, c.hp ?? null]), [
  ['c-thorin', 'thorin', { value: 30, max: 40, temp: 0 }],
  ['c-gob', null, undefined ?? null],
])
assert.ok(!('hp' in snapshot.combatants[1]))
ok("Thorin joining sends his campaign the whole combat, with only his hit points")

out = await fire('createCombatant', combatant(fight, 'c-vex', vex, { initiative: 15 }))
assert.deepEqual(out.map(e => `${e.type} ${e.campaign.title}`).sort(), ['combat.combatant.added Erebor', 'combat.created Mirkwood'])
const added = byCampaign(out).Erebor.data.combatant
assert.equal(added.character, null)
assert.ok(!('hp' in added))
ok("Vex joining: Mirkwood gets the combat; Erebor gets Vex as someone else's character")

fight.started = true; fight.round = 1; fight.turn = 0
out = await fire('combatTurnChange', fight, { round: 0, turn: null, combatantId: null }, { round: 1, turn: 0, combatantId: 'c-thorin' })
assert.deepEqual(out.map(e => `${e.type} ${e.campaign.title}`), [
  'combat.started Erebor', 'combat.started Mirkwood', 'combat.turn Erebor', 'combat.turn Mirkwood',
])
assert.equal(byCampaign(out.slice(2)).Erebor.data.combatant.character, 'thorin')
assert.equal(byCampaign(out.slice(2)).Mirkwood.data.combatant.character, null)
ok('starting the fight and each turn reach both campaigns, described for each')

const hiding = fight.combatants.get('c-vex')
hiding.hidden = true
out = await fire('updateCombatant', hiding, { hidden: true })
assert.deepEqual(out.map(e => `${e.type} ${e.campaign.title}`).sort(), ['combat.combatant.removed Erebor', 'combat.ended Mirkwood'])
hiding.hidden = false
out = await fire('updateCombatant', hiding, { hidden: false })
assert.deepEqual(out.map(e => `${e.type} ${e.campaign.title}`).sort(), ['combat.combatant.added Erebor', 'combat.created Mirkwood'])
ok("hiding Vex ends the fight for Mirkwood; revealing him brings it back")

fight.combatants.delete('c-vex')
out = await fire('deleteCombatant', hiding, {})
assert.deepEqual(out.map(e => `${e.type} ${e.campaign.title}`).sort(), ['combat.combatant.removed Erebor', 'combat.ended Mirkwood'])
// Again, as if Foundry still listed the combatant when the hook ran.
const back = combatant(fight, 'c-vex', vex, { initiative: 15 })
await fire('createCombatant', back)
out = await fire('deleteCombatant', back, {})
assert.deepEqual(out.map(e => `${e.type} ${e.campaign.title}`).sort(), ['combat.combatant.removed Erebor', 'combat.ended Mirkwood'])
fight.combatants.delete('c-vex')
ok('removing Vex ends the fight for Mirkwood, whether or not Foundry still lists him')

const goblinC = fight.combatants.get('c-gob')
goblinC.isDefeated = true
out = await fire('updateCombatant', goblinC, { defeated: true })
assert.deepEqual(out.map(e => `${e.type} ${e.campaign.title}`), ['combat.combatant.updated Erebor'])
ok('combatant updates go to the campaigns in the fight')

combats.delete(fight.id)
out = await fire('deleteCombat', fight)
assert.deepEqual(out.map(e => `${e.type} ${e.campaign.title}`), ['combat.ended Erebor'])
ok('ending the encounter tells the campaigns still in it')

// ---- Dispositions (module 0.29.0) ----
// Each combatant's token's, as players see its border: friendly, neutral or hostile; never Secret,
// which players see as none, nor one of a token hidden from them, nor of no token.
const ogreA = actor('ogre', 'Ogre', [], 'npc')
const sides = combat('cmbt3')
const token = (disposition, hidden = false) => ({ disposition, hidden })
const dispositionsOf = combatants => Object.fromEntries(combatants.map(c => [c.id, c.disposition]))
combatant(sides, 'd-thorin', thorin, { initiative: 20, token: token(1) })
combatant(sides, 'd-friend', ogreA, { initiative: 18, token: token(1) })
combatant(sides, 'd-neutral', ogreA, { initiative: 16, token: token(0) })
combatant(sides, 'd-hostile', goblin, { initiative: 14, token: token(-1) })
combatant(sides, 'd-secret', goblin, { initiative: 12, token: token(-2) })
combatant(sides, 'd-veiled', ogreA, { initiative: 10, token: token(1, true) })
combatant(sides, 'd-tokenless', goblin, { initiative: 8 })
combatant(sides, 'd-odd', goblin, { initiative: 6, token: token(7) })
const expected = {
  'd-thorin': 'friendly', 'd-friend': 'friendly', 'd-neutral': 'neutral', 'd-hostile': 'hostile',
  'd-secret': null, 'd-veiled': null, 'd-tokenless': null, 'd-odd': null,
}
let dispositionEvents = await fire('createCombatant', sides.combatants.get('d-thorin'))
assert.deepEqual(dispositionEvents.map(e => `${e.type} ${e.campaign.title}`), ['combat.created Erebor'])
assert.deepEqual(dispositionsOf(dispositionEvents[0].data.combat.combatants), expected)
assert.ok(dispositionEvents[0].data.combat.combatants.every(c => Object.hasOwn(c, 'disposition')))
sides.started = true; sides.round = 1; sides.turn = 4
dispositionEvents.push(...await fire('combatTurnChange', sides, { round: 0, turn: null, combatantId: null }, { round: 1, turn: 4, combatantId: 'd-secret' }))
const turned = dispositionEvents.find(e => e.type === 'combat.turn')
assert.deepEqual([turned.data.combatant.id, turned.data.combatant.disposition], ['d-secret', null])
assert.deepEqual(dispositionsOf(turned.data.combat.combatants), expected)
dispositionEvents.push(...await fire('updateCombatant', sides.combatants.get('d-neutral'), { initiative: 17 }))
settings.set('gmContent', true)
const hidingNeutral = sides.combatants.get('d-neutral')
hidingNeutral.hidden = true
dispositionEvents.push(...await fire('updateCombatant', hidingNeutral, { hidden: true }))
const withGm = await fire('combatTurnChange', sides, { round: 1, turn: 4, combatantId: 'd-secret' }, { round: 1, turn: 5, combatantId: 'd-veiled' })
dispositionEvents.push(...withGm)
assert.deepEqual(dispositionsOf(withGm.find(e => e.type === 'combat.turn').data.combat.combatants), expected, 'the same with Gamemaster-only information on')
settings.set('gmContent', false)
hidingNeutral.hidden = false
assert.ok(dispositionEvents.length >= 5)
for (const event of dispositionEvents) {
  const json = JSON.stringify(event.data)
  assert.ok(!/"disposition":(?:"secret"|-?\d)/.test(json), json)
}
combats.delete(sides.id)
await fire('deleteCombat', sides)
ok("each combatant says its token's disposition, friendly, neutral or hostile; Secret, a hidden token, one of no token, or of any other is null, never Secret or its number, with Gamemaster-only information on or off")

// ---- Hello after a reload includes combats a campaign's characters are in ----
const second = combat('cmbt2')
combatant(second, 'c-vex2', vex, { initiative: 9 })
combatant(second, 'c-gob2', goblin, { initiative: 5 })
const { announce } = await import(`${MODULE}/scripts/bridge.mjs`)
announce()
await settle()
out = take()
assert.deepEqual(out.map(e => `${e.type} ${e.campaign.title}`), ['bridge.hello Erebor', 'bridge.hello Mirkwood', 'character.updated Erebor', 'character.updated Mirkwood'])
out = byCampaign(out.filter(e => e.type === 'bridge.hello'))
assert.deepEqual(out.Mirkwood.data.combats.map(c => c.id), ['cmbt2'])
assert.deepEqual(out.Erebor.data.combats.map(c => c.id), [])
ok("bridge.hello carries only the combats a campaign's characters are in")
out = await fire('createCombatant', combatant(second, 'c-gob3', goblin, { initiative: 3 }))
assert.deepEqual(out.map(e => `${e.type} ${e.campaign.title}`), ['combat.combatant.added Mirkwood'])
ok('after hello, a campaign already told about a combat gets ordinary updates')

// ---- Sequences and the ping ----
const all = posts
const { buildEnvelope } = await import(`${MODULE}/scripts/transport.mjs`)
const ping = buildEnvelope('bridge.ping', {}, { sequenced: false })
assert.equal(ping.campaign, null)
assert.equal(ping.sequence, null)
const a = buildEnvelope('chat.cleared', {}, { campaign: { id: 'camp-a', title: 'Erebor', characters: new Set() } })
const b = buildEnvelope('chat.cleared', {}, { campaign: { id: 'camp-b', title: 'Mirkwood', characters: new Set() } })
const a2 = buildEnvelope('chat.cleared', {}, { campaign: { id: 'camp-a', title: 'Erebor', characters: new Set() } })
assert.equal(a2.sequence, a.sequence + 1)
assert.notEqual(a.sequence, b.sequence + 100)
assert.deepEqual(a.campaign, { id: 'camp-a', title: 'Erebor' })
ok('each campaign is numbered as its own stream; a ping belongs to no campaign')

console.log('\nall module scenarios passed')
