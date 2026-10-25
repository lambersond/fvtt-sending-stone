// The settings window (module 0.24.0, which replaced Manage Campaigns): what it saves, what it
// shows, and Test, used as the Gamemaster would, drawn from its own templates (settings-app.mjs).
import assert from 'node:assert/strict'
import { actor, actors, settings, user, users } from './stub.mjs'
import { click, find, openSettings, save, tick, type, view } from './settings-app.mjs'
const MODULE = process.env.MODULE_DIR
user('gm', 'Gamemaster', true); user('alice', 'Alice'); user('bob', 'Bob')
actor('thorin', 'Thorin', ['alice']); actor('vex', 'Vex', ['bob'])
const { registerSettings } = await import(`${MODULE}/scripts/settings.mjs`)
registerSettings()
const campaignIds = win => [...win.element.querySelectorAll('nav.sending-stone-nav [data-campaign-id]')].map(button => button.dataset.campaignId)

// Two campaigns, added in turn and titled as typed; their characters ticked in the Roster, one
// ticked and unticked again, and one whose actor is deleted while the window is open.
let win = await openSettings()
assert.ok(find(win, '[name="destination"]'), 'with no campaign, it opens at General')
await click(win, '[data-action="addCampaign"]')
type(win, 'campaign.title', 'Erebor')
await click(win, '[data-action="addCampaign"]')
type(win, 'campaign.title', ' Mirkwood ')
let [a, b] = campaignIds(win)
actor('ghost', 'Ghost', ['alice'])
await view(win, 'roster')
tick(win, `roster.${a}.thorin`); tick(win, `roster.${a}.ghost`)
tick(win, `roster.${b}.vex`); tick(win, `roster.${b}.thorin`); tick(win, `roster.${b}.thorin`, false)
actors.delete('ghost')
await save(win)
// Module 0.30.0 (its contract §3.2): every campaign is saved with its groups, none here.
// Changed on purpose (round 0.36.0 §6.12): and with its companions' initiative, each its own roll.
// Changed on purpose (round 0.38.0 §D8.3): and whether it takes dishes from the Magical Recipe Book, off.
assert.deepEqual(settings.get('campaigns'), [
  { id: a, title: 'Erebor', characters: ['thorin'], groups: [], rolls: false, attacks: false, prompts: false, manualDice: false, transfers: false, dishes: false, companionInitiative: 'own' },
  { id: b, title: 'Mirkwood', characters: ['vex'], groups: [], rolls: false, attacks: false, prompts: false, manualDice: false, transfers: false, dishes: false, companionInitiative: 'own' },
])
assert.equal(win.element.isConnected, false, 'saved, it closes')
console.log('ok - saves campaigns in order, trims titles, drops unticked and missing characters')

// Attacks and saves are offered once rolls are ticked.
win = await openSettings()
await view(win, 'campaign', { campaignId: a, tab: 'actions' })
assert.ok(find(win, '[name="campaign.attacks"]').disabled && find(win, '[name="campaign.prompts"]').disabled)
tick(win, 'campaign.rolls'); tick(win, 'campaign.attacks'); tick(win, 'campaign.prompts')
await save(win)
assert.deepEqual(settings.get('campaigns').map(({ id, rolls, attacks, prompts }) => [id, rolls, attacks, prompts]),
  [[a, true, true, true], [b, false, false, false]])
console.log("ok - saves whether each campaign's players' rolls, and attacks, are made here, and whether they're asked for saves")

// Refused, the window stays open at the campaign at fault, with what was typed.
win = await openSettings()
await view(win, 'campaign', { campaignId: a, tab: 'connection' })
type(win, 'campaign.title', '  ')
await assert.rejects(save(win), /TitleRequired/)
type(win, 'campaign.title', 'Erebor')
await view(win, 'campaign', { campaignId: b, tab: 'connection' })
type(win, 'campaign.title', 'EREBOR')
await assert.rejects(save(win), /TitleTaken/)
assert.ok(win.element.isConnected)
assert.equal(find(win, '[name="campaign.title"]').value, 'EREBOR')
assert.deepEqual(settings.get('campaigns').map(campaign => campaign.title), ['Erebor', 'Mirkwood'])
await win.close()
console.log('ok - refuses a blank or repeated title, keeping what was saved')

win = await openSettings()
await view(win, 'campaign', { campaignId: a, tab: 'connection' })
await click(win, '[data-action="removeCampaign"]')
await click(win, '.sending-stone-tabs [data-tab="connection"]')
await click(win, '[data-action="removeCampaign"]')
assert.deepEqual(campaignIds(win), [])
await save(win)
assert.deepEqual(settings.get('campaigns'), [])
console.log('ok - removing every campaign saves none')

// ---- The address and each campaign's secret ----
const { posts, settle } = await import('./stub.mjs')
const { getSecret } = await import(`${MODULE}/scripts/config.mjs`)
game.ready = true
settings.set('secret', 'old-shared-secret')
win = await openSettings()
type(win, 'destination', 'not a host')
await click(win, '[data-action="addCampaign"]')
type(win, 'campaign.title', 'Erebor')
await assert.rejects(save(win), /InvalidDestination/)
assert.equal(find(win, '[name="destination"]').value, 'not a host', 'refused, it opens General with the address as typed')
type(win, 'destination', 'localhost:3000/anything')
;[a] = campaignIds(win)
await view(win, 'campaign', { campaignId: a, tab: 'connection' })
type(win, 'campaign.secret', ' erebor-secret ')
await click(win, '[data-action="addCampaign"]')
type(win, 'campaign.title', 'Mirkwood')
;[, b] = campaignIds(win)
await view(win, 'roster')
tick(win, `roster.${a}.thorin`); tick(win, `roster.${b}.vex`)
posts.splice(0)
await save(win)
await settle(); await settle()
assert.equal(settings.get('listenerUrl'), 'http://localhost:3000')
assert.deepEqual(settings.get('campaignSecrets'), { [a]: 'erebor-secret' })
assert.ok(settings.get('campaigns').every(campaign => !('secret' in campaign)), 'secrets stay out of the world setting')
assert.equal(getSecret(a), 'erebor-secret')
assert.equal(getSecret(b), 'old-shared-secret')
console.log("ok - saves the app's address as its origin, and each campaign's secret in this browser only")

const hellos = posts.splice(0).filter(post => post.envelope.type === 'bridge.hello')
const auth = Object.fromEntries(hellos.map(post => [post.envelope.campaign.title, post.headers.Authorization]))
assert.deepEqual(auth, { Erebor: 'Bearer erebor-secret', Mirkwood: 'Bearer old-shared-secret' })
assert.ok(hellos.every(post => post.url === 'http://localhost:3000/api/events'))
console.log("ok - each campaign's events carry its own secret, or the old shared one if it has none")

// ---- What the window shows ----
// Since 0.24.0 a campaign's Players tab lists its own characters only; Add characters, the rest.
win = await openSettings()
const players = () => [...win.element.querySelectorAll('[data-filter-list="players"] .sending-stone-row-name')].map(name => name.textContent)
assert.equal(find(win, 'nav.sending-stone-nav [aria-current="page"]').dataset.campaignId, a, 'saved, it opens at the first campaign')
assert.deepEqual(players(), ['Thorin'])
await view(win, 'general')
assert.equal(find(win, '[name="destination"]').value, 'http://localhost:3000')
await view(win, 'campaign', { campaignId: a, tab: 'connection' })
assert.equal(find(win, '[name="campaign.secret"]').value, 'erebor-secret')
await view(win, 'campaign', { campaignId: b, tab: 'connection' })
assert.equal(find(win, '[name="campaign.secret"]').value, 'old-shared-secret')
await view(win, 'campaign', { campaignId: b, tab: 'players' })
assert.deepEqual(players(), ['Vex'])
await click(win, '[data-action="openPicker"]')
assert.deepEqual([...win.element.querySelectorAll('[data-pick]')].map(box => [box.dataset.pick, box.disabled, box.closest('[data-search]').hidden]),
  [['thorin', false, false], ['vex', true, true]], 'Thorin to add; Vex already in, not shown until Everyone')
await win.close()
console.log("ok - the window shows the address, each campaign's secret, and its own characters, the rest to add")

// ---- Testing a campaign as typed ----
// Each Test is the window's own, as Foundry calls it, so that what it found is kept for re-rendering.
win = await openSettings()
const test = async ({ destination, title, secret }, answer) => {
  await view(win, 'general')
  type(win, 'destination', destination)
  await view(win, 'campaign', { campaignId: a, tab: 'connection' })
  type(win, 'campaign.title', title)
  type(win, 'campaign.secret', secret)
  const realFetch = globalThis.fetch
  if (answer) globalThis.fetch = async (url, init) => {
    posts.push({ url: String(url), headers: init.headers, envelope: JSON.parse(init.body) })
    if (answer instanceof Error) throw answer
    return answer
  }
  let target
  try {
    target = await click(win, '[data-action="testCampaign"]')
  } finally {
    globalThis.fetch = realFetch
  }
  const { dataset: { state }, textContent } = find(win, '[data-test-result]')
  return { output: { dataset: { state }, textContent }, target }
}
// What the app since 0.23.0 says in refusing: JSON, its reason first.
const refusal = (status, body) => ({
  ok: false, status, statusText: '', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body,
})
const typed = { destination: 'https://stone.example', title: 'Erebor', secret: 'typed-secret' }

let { output, target } = await test(typed)
let [ping] = posts.splice(0)
assert.equal(ping.url, 'https://stone.example/api/events')
assert.equal(ping.headers.Authorization, 'Bearer typed-secret')
assert.deepEqual([ping.envelope.type, ping.envelope.campaign, ping.envelope.sequence], ['bridge.ping', { id: a, title: 'Erebor' }, null])
assert.equal(output.dataset.state, 'ok')
assert.match(output.textContent, /SENDINGSTONE.Test.Ok/)
assert.equal(target.disabled, false)
console.log('ok - Test pings the address as typed, naming the campaign, with its secret as typed')

// An older app's refusals, a status and no body: the same.
;({ output } = await test(typed, { ok: false, status: 404, statusText: 'Not Found', headers: new Headers() }))
posts.splice(0)
assert.equal(output.dataset.state, 'error')
assert.match(output.textContent, /^SENDINGSTONE\.Problem\.notSetUp \{.*"campaign":"Erebor".*\} SENDINGSTONE\.Fix\.notSetUp /)
;({ output } = await test(typed, { ok: false, status: 401, statusText: 'Unauthorized', headers: new Headers() }))
posts.splice(0)
assert.match(output.textContent, /^SENDINGSTONE\.Problem\.wrongSecret .*"campaign":"Erebor".* SENDINGSTONE\.Fix\.wrongSecret /)
console.log('ok - Test explains a campaign not set up in the app, and a refused secret')

// ---- H12: Test says what went wrong and what to do, as events do (the 0.23.0 contract §4.5) ----
;({ output } = await test(typed, refusal(404, { reason: 'notSetUp', message: 'No campaign titled “Erebor” is set up for https://x.forge-vtt.com in Sending Stone' })))
posts.splice(0)
assert.equal(output.dataset.state, 'error')
assert.match(output.textContent, /^SENDINGSTONE\.Problem\.notSetUp \{/)
assert.match(output.textContent, /"address":"https:\/\/stone\.example"/, 'the address as typed')
assert.match(output.textContent, /"campaign":"Erebor"/, 'the title as typed')
assert.match(output.textContent, / SENDINGSTONE\.Fix\.notSetUp \{/)
assert.doesNotMatch(output.textContent, /HintNetwork|Test\.Failed/)
;({ output } = await test(typed, refusal(401, { reason: 'wrongSecret', message: 'The secret isn’t this campaign’s in Sending Stone' })))
posts.splice(0)
assert.match(output.textContent, /^SENDINGSTONE\.Problem\.wrongSecret .* SENDINGSTONE\.Fix\.wrongSecret /)
// Sent without a secret, it says so: Test sends the secret as typed.
;({ output } = await test({ ...typed, secret: '' }, refusal(401, { reason: 'noSecret', message: 'Send the campaign’s secret' })))
let [unsent] = posts.splice(0)
assert.equal(unsent.headers.Authorization, undefined)
assert.match(output.textContent, /^SENDINGSTONE\.Problem\.noSecret .* SENDINGSTONE\.Fix\.noSecret /)
// A request failed outright: what usually causes it, too.
;({ output } = await test(typed, new TypeError('Failed to fetch')))
posts.splice(0)
assert.match(output.textContent, /^SENDINGSTONE\.Problem\.unreachable .*"address":"https:\/\/stone\.example".* SENDINGSTONE\.Fix\.unreachable .*\nSENDINGSTONE\.Test\.HintNetwork$/)
// So does one that got no answer in time.
;({ output } = await test(typed, Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' })))
posts.splice(0)
assert.match(output.textContent, /^SENDINGSTONE\.Problem\.timeout .*"address":"https:\/\/stone\.example".* SENDINGSTONE\.Fix\.timeout .*\nSENDINGSTONE\.Test\.HintNetwork$/)
console.log('ok - H12: Test says what went wrong and what to do: a JSON 404 not set up, a JSON 401 wrong secret, none sent, and a request failed outright, or unanswered in time, with the network hint')

// Passed, with what's typed unlike what's saved, it says events go as saved. The saved Erebor is
// at http://localhost:3000, with the secret erebor-secret.
const saved = { destination: 'localhost:3000', title: 'Erebor', secret: 'erebor-secret' }
;({ output } = await test(saved))
posts.splice(0)
assert.equal(output.dataset.state, 'ok')
assert.doesNotMatch(output.textContent, /Unsaved/)
for (const unsaved of [{ secret: 'typed-secret' }, { title: 'Erebor Again' }, { destination: 'https://stone.example' }]) {
  ;({ output } = await test({ ...saved, ...unsaved }))
  posts.splice(0)
  assert.equal(output.dataset.state, 'ok')
  assert.match(output.textContent, /^SENDINGSTONE\.Test\.Ok .* SENDINGSTONE\.Test\.Unsaved$/, JSON.stringify(unsaved))
}
// What it found is kept when the window is drawn again, as on coming back to the tab.
const drawnAgain = async () => {
  await click(win, '.sending-stone-tabs [data-tab="players"]')
  await click(win, '.sending-stone-tabs [data-tab="connection"]')
  const shown = find(win, '[data-test-result]')
  return { state: shown.dataset.state, text: shown.textContent }
}
assert.deepEqual(await drawnAgain(), { state: 'ok', text: output.textContent })
;({ output } = await test(typed, refusal(404, { reason: 'notSetUp', message: 'No campaign' })))
posts.splice(0)
assert.deepEqual(await drawnAgain(), { state: 'error', text: output.textContent })
const other = await openSettings()
await view(other, 'campaign', { campaignId: a, tab: 'connection' })
assert.deepEqual([find(other, '[data-test-result]').dataset.state, find(other, '[data-test-result]').textContent], [undefined, ''], "another window's tests are its own")
await other.close()
console.log('ok - H12: a pass says Save Changes when the address, title or secret typed is not what is saved, and not when it is; a result survives a re-render')

;({ output } = await test({ ...typed, destination: 'not a host' }))
assert.match(output.textContent, /InvalidDestination/)
;({ output } = await test({ ...typed, title: ' ' }))
assert.match(output.textContent, /TitleRequired/)
assert.equal(posts.length, 0)
await win.close()
console.log('ok - Test sends nothing without a valid address and a title')

// ---- Module 0.26.0: Allow Players to enter dice results manually ----
// Manual Dice as installed and switched on or not: "missing", "inactive" (installed, not enabled
// in the world), "off" (enabled, switched off in its own settings) or "active".
const { readFileSync } = await import('node:fs')
const { announce } = await import(`${MODULE}/scripts/bridge.mjs`)
const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
const lang = JSON.parse(readFileSync(`${MODULE}/lang/en.json`, 'utf8')).SENDINGSTONE.Config
let manualDiceSwitch = true
const storedGet = game.settings.get
game.settings.get = (module, key) => (module === 'manual-dice') ? manualDiceSwitch : storedGet(module, key)
game.settings.settings ??= new Map()
const manualDice = state => {
  if (state === 'missing') {
    game.modules.delete('manual-dice')
    game.settings.settings.delete('manual-dice.enabled')
  } else {
    game.modules.set('manual-dice', { id: 'manual-dice', title: 'Manual Dice', active: state !== 'inactive', authors: [] })
    game.settings.settings.set('manual-dice.enabled', {})
  }
  manualDiceSwitch = state !== 'off'
}
// Players' rolls can be made here, as once the self-test has passed.
Object.assign(diceStatus, { ready: true, reason: null })
const allow = () => find(win, '[name="campaign.manualDice"]')
const redraw = () => click(win, '.sending-stone-tabs [data-tab="actions"]')
const switches = () => [...win.element.querySelectorAll('[data-filter-list="players"] [data-manual-dice]')]

assert.equal(lang.Actions.DicePlayers, 'Allow Players to enter dice results manually')
win = await openSettings()
await view(win, 'campaign', { campaignId: a, tab: 'actions' })
assert.equal(find(win, '.sending-stone-dice label[for="sending-stone-manual-dice"]').textContent.trim(), 'SENDINGSTONE.Config.Actions.DicePlayers')
assert.equal(find(win, '.sending-stone-dice legend').textContent.trim(), 'SENDINGSTONE.Config.Actions.Dice', 'where Who rolls the dice was')
assert.equal(allow().type, 'checkbox')
assert.equal(win.element.querySelector('[name="diceEntry"]'), null, 'the radios are gone')
assert.equal(win.element.querySelector('.sending-stone-dice .sending-stone-pill'), null, 'no Coming soon chip on it')
tick(win, 'campaign.rolls')
for (const state of ['missing', 'inactive', 'off', 'active']) {
  manualDice(state)
  await redraw()
  assert.equal(allow().disabled, state !== 'active', state)
  assert.equal(allow().closest('.form-group').classList.contains('disabled'), state !== 'active', state)
  assert.match(find(win, '.sending-stone-dice-note').textContent, new RegExp(`SENDINGSTONE\\.Config\\.Actions\\.ManualDice\\.${state}\\b`))
  assert.equal(!!win.element.querySelector('.sending-stone-dice-note [data-action="view"][data-section="modules"]'), state !== 'active', state)
}
console.log('ok - 0.26.0: Allow Players to enter dice results manually, a switch where Who rolls the dice was, disabled with its hint and View modules unless Manual Dice is active')

// It needs Players roll in the app: unticked, it's disabled, and ticked again, enabled; but
// without Manual Dice, ticking rolls leaves it disabled.
tick(win, 'campaign.rolls', false)
assert.ok(allow().disabled)
assert.equal(find(win, '.sending-stone-dice [data-needs="campaign.rolls"]').hidden, false)
await redraw()
assert.ok(allow().disabled, 'drawn with rolls off')
tick(win, 'campaign.rolls')
assert.equal(allow().disabled, false)
assert.equal(find(win, '.sending-stone-dice [data-needs="campaign.rolls"]').hidden, true)
manualDice('off')
tick(win, 'campaign.rolls', false)
await redraw()
tick(win, 'campaign.rolls')
assert.ok(allow().disabled, 'ticking rolls with Manual Dice off leaves it disabled')
assert.ok(find(win, '[name="campaign.attacks"]').disabled === false, 'attacks still follow rolls')
manualDice('active')
await redraw()
console.log('ok - 0.26.0: it needs Players roll in the app, and Manual Dice on whatever rolls does')

// Saved per campaign: Erebor allows it, Mirkwood doesn't. Its players and the app are told.
tick(win, 'campaign.manualDice')
posts.splice(0)
await save(win)
await settle(); await settle()
assert.deepEqual(settings.get('campaigns').map(({ id, rolls, manualDice }) => [id, rolls, manualDice]), [[a, true, true], [b, false, false]])
// Foundry keeps only what the campaigns setting's schema defines, so the choice is kept only as
// one of its fields: a BooleanField, off until it's turned on. Every field the window saves is one.
const { registered } = await import('./stub.mjs')
const { fields: campaignFields } = registered.get('campaigns').type.element
assert.ok(campaignFields.manualDice instanceof foundry.data.fields.BooleanField, 'manualDice is in the schema')
// Module 0.31.0: so is transfers, off until it's turned on.
assert.ok((campaignFields.transfers instanceof foundry.data.fields.BooleanField) && (campaignFields.transfers.initial === false), 'transfers is in the schema')
// Module 0.38.0 (round 0.38.0 §D8.3): so is dishes, off until it's turned on.
assert.ok((campaignFields.dishes instanceof foundry.data.fields.BooleanField) && (campaignFields.dishes.initial === false), 'dishes is in the schema')
assert.equal(campaignFields.manualDice.initial, false)
assert.deepEqual(Object.keys(campaignFields).sort(), Object.keys(settings.get('campaigns')[0]).sort())
const hellosNow = () => Object.fromEntries(posts.splice(0).filter(post => post.envelope.type === 'bridge.hello')
  .map(({ envelope: { campaign, data } }) => [campaign.title, { manualDice: data.features.rolls.manualDice, characters: data.characters.map(c => [c.id, c.manualDice]) }]))
assert.deepEqual(hellosNow(), {
  Erebor: { manualDice: true, characters: [['thorin', false]] },
  Mirkwood: { manualDice: false, characters: [['vex', false]] },
})
console.log("ok - 0.26.0: saved per campaign, in the campaigns setting's schema, and saving sends each its hello again, with features.rolls.manualDice and each character's manualDice")

// Changing only the choice is an unsaved change, and changing it back is none.
win = await openSettings()
await view(win, 'campaign', { campaignId: a, tab: 'actions' })
const dirty = () => { const { dataset, textContent } = find(win, '[data-dirty]'); return [dataset.dirty, textContent.trim()] }
assert.deepEqual(dirty(), ['false', 'SENDINGSTONE.Config.NoChanges'])
tick(win, 'campaign.manualDice', false)
assert.deepEqual(dirty(), ['true', 'SENDINGSTONE.Config.Unsaved'])
tick(win, 'campaign.manualDice')
assert.deepEqual(dirty(), ['false', 'SENDINGSTONE.Config.NoChanges'])
await win.close()
console.log('ok - 0.26.0: changing only the choice is an unsaved change, and changing it back is none')

// The Players tab (module 0.32.0, its contract §3.8): while it's on, each character's read-only mark
// of whether its player may enter its dice results in the app: allowed, needing Make Manual Rolls,
// or with no player; never a switch, nor Coming soon. Each state has an icon of its own, a keyboard,
// a lock and a crossed-out player, so that they differ by more than how faint the mark is; and the
// mark takes focus, its tooltip opening on focus as on hover, for keyboards.
win = await openSettings()
await view(win, 'campaign', { campaignId: a, tab: 'players' })
const markOf = () => {
  const [mark] = switches()
  return mark && [mark.tagName, mark.dataset.manualDice, mark.dataset.state, mark.getAttribute('role'), mark.getAttribute('aria-label'),
    mark.dataset.tooltip, mark.querySelector('input, .sending-stone-pill'), mark.getAttribute('tabindex'),
    [...mark.querySelectorAll('i')].map(icon => [icon.className, icon.hasAttribute('inert')])]
}
const label = (state, player, name = 'Thorin') => `SENDINGSTONE.Config.Players.TypedDice.${state} ${JSON.stringify({ player, name })}`
const ICONS = { allowed: 'fa-solid fa-keyboard', permission: 'fa-solid fa-lock', none: 'fa-solid fa-user-slash' }
const marked = (state, player) => ['SPAN', 'thorin', state, 'img', label(state, player), label(state, player), null, '0', [[ICONS[state], true]]]
// Foundry's tooltips, as the window opens and closes them itself.
const tooltips = []
game.tooltip = { activate: (element, options) => tooltips.push(['activate', element.dataset.manualDice, options?.text]), deactivate: () => tooltips.push(['deactivate']) }
// Alice, Thorin's only owner, a Player: Make Manual Rolls is Trusted and above's.
assert.deepEqual(switches().map(mark => mark.dataset.manualDice), ['thorin'])
assert.deepEqual(markOf(), marked('permission', 'Alice'))
// Focused, as by Tab, its tooltip opens with what it says; leaving it, it closes.
switches()[0].focus()
assert.equal(win.element.ownerDocument.activeElement, switches()[0], 'the mark takes focus')
switches()[0].blur()
assert.deepEqual(tooltips, [['activate', 'thorin', label('permission', 'Alice')], ['deactivate']])
users.get('alice').role = 2
await click(win, '.sending-stone-tabs [data-tab="players"]')
assert.deepEqual(markOf(), marked('allowed', 'Alice'))
users.get('alice').role = 1
const owned = actors.get('thorin').testUserPermission
actors.get('thorin').testUserPermission = () => false
await click(win, '.sending-stone-tabs [data-tab="players"]')
assert.deepEqual(markOf(), marked('none', ''))
actors.get('thorin').testUserPermission = owned
delete game.tooltip
await click(win, '.sending-stone-tabs [data-tab="players"]')
assert.equal(win.element.querySelector('[data-filter-list="players"] input[type="checkbox"]'), null, 'no switch')
assert.ok(!win.element.querySelector('[data-filter-list="players"]').textContent.includes('Soon'), 'nothing coming soon')
assert.deepEqual(lang.Players.TypedDice, {
  allowed: "{player} may enter {name}'s dice results in the app",
  permission: "{player} needs Make Manual Rolls to enter {name}'s dice results in the app",
  none: '{name} has no player to enter its dice results in the app',
})
assert.ok(!('ManualDice' in lang.Players) && !('Soon' in lang.Players), 'the switch and Coming soon gone')
assert.equal(lang.Actions.DicePlayersHint, "They type in what their own dice show, once each turns it on in the app's settings. A character's player needs Make Manual Rolls, which Manual Dice's roles set.")
assert.equal(lang.Actions.ManualDice.active, 'Manual Dice is on. Players with Make Manual Rolls may enter their dice results in the app.')
// Nor while players' rolls can't be made here, under another system or after a failed self-test,
// when the hello says it's off.
for (const reason of ['self-test', 'system']) {
  Object.assign(diceStatus, { ready: false, reason })
  await click(win, '.sending-stone-tabs [data-tab="players"]')
  assert.deepEqual(switches(), [], reason)
}
Object.assign(diceStatus, { ready: true, reason: null })
await click(win, '.sending-stone-tabs [data-tab="players"]')
assert.deepEqual(switches().map(box => box.dataset.manualDice), ['thorin'], "players' rolls made here again")
await view(win, 'campaign', { campaignId: b, tab: 'players' })
assert.deepEqual(switches(), [], 'Mirkwood does not allow it')
// As edited: off with Players roll in the app off, or with it unticked.
await view(win, 'campaign', { campaignId: a, tab: 'actions' })
tick(win, 'campaign.rolls', false)
await click(win, '.sending-stone-tabs [data-tab="players"]')
assert.deepEqual(switches(), [], 'not while rolls are off')
await click(win, '.sending-stone-tabs [data-tab="actions"]')
tick(win, 'campaign.rolls')
tick(win, 'campaign.manualDice', false)
await click(win, '.sending-stone-tabs [data-tab="players"]')
assert.deepEqual(switches(), [], 'not while unticked')
await win.close()
for (const state of ['missing', 'inactive', 'off']) {
  manualDice(state)
  win = await openSettings()
  await view(win, 'campaign', { campaignId: a, tab: 'players' })
  assert.deepEqual(switches(), [], state)
  await win.close()
}
console.log("ok - 0.32.0: the Players tab shows each character's read-only mark, its state, label and own icon (a keyboard, a lock, a crossed-out player) for a player who may, one needing Make Manual Rolls, and none, only while it's effectively on; it takes focus, opening its tooltip as hovering does; no switch, nothing coming soon")

// A choice saved while Manual Dice was on is kept once it isn't, shown as saved, but counts as off.
manualDice('off')
win = await openSettings()
await view(win, 'campaign', { campaignId: a, tab: 'actions' })
assert.equal(allow().checked, true)
assert.equal(allow().disabled, true)
tick(win, 'campaign.attacks')
posts.splice(0)
await save(win)
await settle(); await settle()
assert.deepEqual(settings.get('campaigns').map(({ id, manualDice, attacks }) => [id, manualDice, attacks]), [[a, true, true], [b, false, false]])
assert.equal(hellosNow().Erebor.manualDice, false)
console.log('ok - 0.26.0: a choice saved while Manual Dice was on is kept, and told as off, once it is off')

// The hello in each case: on only with the choice, Manual Dice active, and players' rolls made.
const told = async () => { posts.splice(0); announce(); await settle(); await settle(); return hellosNow() }
for (const state of ['missing', 'inactive', 'off']) {
  manualDice(state)
  assert.deepEqual(await told(), {
    Erebor: { manualDice: false, characters: [['thorin', false]] },
    Mirkwood: { manualDice: false, characters: [['vex', false]] },
  }, state)
}
manualDice('active')
assert.equal((await told()).Erebor.manualDice, true)
Object.assign(diceStatus, { ready: false, reason: 'self-test' })
assert.equal((await told()).Erebor.manualDice, false, "players' rolls can't be made here")
Object.assign(diceStatus, { ready: true, reason: null })
const campaigns = settings.get('campaigns')
settings.set('campaigns', campaigns.map(c => (c.id === a) ? { ...c, rolls: false } : c))
assert.equal((await told()).Erebor.manualDice, false, 'Players roll in the app off')
settings.set('campaigns', campaigns.map(c => (c.id === a) ? { ...c, manualDice: false } : c))
assert.equal((await told()).Erebor.manualDice, false, 'not allowed')
settings.set('campaigns', campaigns)
console.log("ok - 0.26.0: the hello's features.rolls.manualDice is true only with the choice, Manual Dice active and players' rolls made; every character's manualDice is false")

// Manual Dice switched on or off in its own settings sends the hellos again, while a campaign
// allows it; another setting, or none allowing it, sends nothing.
for (const [hook, state, expected] of [['updateSetting', 'off', false], ['createSetting', 'active', true]]) {
  posts.splice(0)
  manualDice(state)
  await Hooks.callAll(hook, { key: 'manual-dice.enabled', value: state === 'active' })
  await settle(); await settle()
  assert.equal(hellosNow().Erebor?.manualDice, expected, hook)
}
posts.splice(0)
await Hooks.callAll('updateSetting', { key: 'dnd5e.criticalDamageMaxDice', value: true })
await settle()
assert.deepEqual(hellosNow(), {}, 'another setting')
settings.set('campaigns', campaigns.map(c => ({ ...c, manualDice: false })))
await Hooks.callAll('updateSetting', { key: 'manual-dice.enabled', value: false })
await settle()
assert.deepEqual(hellosNow(), {}, 'no campaign allows it')
settings.set('campaigns', campaigns)
console.log('ok - 0.26.0: Manual Dice switched on or off sends the hellos again while a campaign allows it, and not otherwise')

// ---- Module 0.31.0 (its contract §4.2, §4.7.5) ----
// Hit/miss and save results in the app: a choice nested under Chat messages, disabled while chat is
// off, saved as the string chosen.
win = await openSettings()
await view(win, 'general')
const results = () => find(win, '[name="chatResults"]')
assert.ok(results().closest('.form-group').classList.contains('sending-stone-nested'), 'nested')
assert.equal(results().closest('fieldset').querySelector('[name="chatEvents"]') !== null, true, 'beside Chat messages')
assert.equal(find(win, 'label[for="sending-stone-results"]').textContent.trim(), 'SENDINGSTONE.Config.General.Results')
assert.deepEqual([...results().options].map(option => [option.value, option.textContent.trim(), option.selected]), [
  ['foundry', 'SENDINGSTONE.Config.General.ResultsFoundry', true], ['always', 'SENDINGSTONE.Config.General.ResultsAlways', false],
], 'Follow first, chosen')
assert.equal(results().closest('.form-group').querySelector('.hint').textContent.trim(), 'SENDINGSTONE.Config.General.ResultsHint')
const chatOn = settings.get('chatEvents') === true
if (chatOn) tick(win, 'chatEvents', false)
assert.equal(results().disabled, true, 'disabled while chat is off')
tick(win, 'chatEvents')
assert.equal(results().disabled, false, 'enabled with it')
const generalDirty = () => find(win, '[data-dirty]').dataset.dirty
tick(win, 'chatEvents', chatOn)
tick(win, 'chatEvents')
const select = results()
select.value = 'always'
select.dispatchEvent(new select.ownerDocument.defaultView.Event('change', { bubbles: true }))
assert.equal(generalDirty(), 'true', 'an unsaved change')
await save(win)
assert.equal(settings.get('chatResults'), 'always', 'saved as the string chosen')
win = await openSettings()
await view(win, 'general')
assert.equal(results().value, 'always', 'shown as saved')
tick(win, 'chatEvents', false)
assert.equal(results().disabled, true)
await win.close()
settings.set('chatEvents', chatOn)
settings.set('chatResults', 'foundry')
console.log("ok - 0.31.0: Hit/miss and save results in the app is a choice nested under Chat messages, disabled while chat is off, an unsaved change once chosen, saved as the string chosen")

// Players move items and coins: its own fieldset on the Player actions tab, saved with the campaign.
win = await openSettings()
await view(win, 'campaign', { campaignId: a, tab: 'actions' })
const transfers = find(win, 'fieldset.sending-stone-transfers')
assert.equal(transfers.querySelector('legend').textContent.trim(), 'SENDINGSTONE.Config.Actions.Transfers')
assert.equal(transfers.querySelector('[name="campaign.transfers"]').checked, false)
tick(win, 'campaign.transfers')
await save(win)
assert.equal(settings.get('campaigns').find(c => c.id === a).transfers, true, 'saved')
assert.equal(settings.get('campaigns').find(c => c.id === b).transfers, false, "the other's as it was")
settings.set('campaigns', settings.get('campaigns').map(c => ({ ...c, transfers: false })))
console.log("ok - 0.31.0: Players move items and coins has its own fieldset on the Player actions tab, and saves with its campaign")

// Module 0.38.0 (round 0.38.0 §D8.3): Dishes from the Magical Recipe Book, its own fieldset on the
// Player actions tab between Items and coins and Companions, not greyed by the rolls, saved with its
// campaign.
win = await openSettings()
await view(win, 'campaign', { campaignId: a, tab: 'actions' })
const dishes = find(win, 'fieldset.sending-stone-dishes')
assert.equal(dishes.querySelector('legend').textContent.trim(), 'SENDINGSTONE.Config.Actions.Dishes')
assert.equal(dishes.querySelector('label').textContent.trim(), 'SENDINGSTONE.Config.Actions.DishesPlayers')
assert.equal(dishes.querySelector('.hint').textContent.trim(), 'SENDINGSTONE.Config.Actions.DishesHint')
const order = [...win.element.querySelectorAll('fieldset')].map(each => each.className)
assert.deepEqual(order.slice(order.indexOf('sending-stone-transfers'), order.indexOf('sending-stone-transfers') + 3),
  ['sending-stone-transfers', 'sending-stone-dishes', 'sending-stone-companions'], 'between Items and coins and Companions')
assert.equal(find(win, '[name="campaign.dishes"]').checked, false)
assert.equal(find(win, '[name="campaign.dishes"]').disabled, false, 'whatever the rolls')
tick(win, 'campaign.dishes')
await save(win)
assert.equal(settings.get('campaigns').find(c => c.id === a).dishes, true, 'saved')
assert.equal(settings.get('campaigns').find(c => c.id === b).dishes, false, "the other's as it was")
settings.set('campaigns', settings.get('campaigns').map(c => ({ ...c, dishes: false })))
console.log("ok - 0.38.0: Dishes from the Magical Recipe Book has its own fieldset on the Player actions tab, between Items and coins and Companions, and saves with its campaign")

// Module 0.36.0 (round 0.36.0 §6.12): Companions' initiative, its own fieldset on the Player actions
// tab after Items and coins, a choice never disabled, saved with its campaign; a new campaign's its
// own roll; the field in the campaigns setting's schema.
win = await openSettings()
await view(win, 'campaign', { campaignId: a, tab: 'actions' })
const companions = find(win, 'fieldset.sending-stone-companions')
assert.equal(companions.querySelector('legend').textContent.trim(), 'SENDINGSTONE.Config.Actions.Companions')
const fieldsets = [...win.element.querySelectorAll('fieldset')].map(each => each.className)
assert.ok(fieldsets.indexOf('sending-stone-companions') > fieldsets.indexOf('sending-stone-transfers'), 'after Items and coins')
const initiative = () => find(win, 'select[name="campaign.companionInitiative"]')
assert.equal(companions.querySelector('label').textContent.trim(), 'SENDINGSTONE.Config.Actions.CompanionInitiative')
assert.deepEqual([...initiative().options].map(option => [option.value, option.textContent.trim(), option.selected]), [
  ['own', 'SENDINGSTONE.Config.Actions.CompanionInitiativeOwn', true],
  ['after', 'SENDINGSTONE.Config.Actions.CompanionInitiativeAfter', false],
])
assert.equal(companions.querySelector('.hint').textContent.trim(), 'SENDINGSTONE.Config.Actions.CompanionInitiativeHint')
const rollsOn = find(win, '[name="campaign.rolls"]').checked
for (const on of [!rollsOn, rollsOn]) {
  tick(win, 'campaign.rolls', on)
  assert.equal(initiative().disabled, false, `never disabled, rolls ${on ? 'on' : 'off'}`)
}
type(win, 'campaign.companionInitiative', 'after')
await save(win)
assert.equal(settings.get('campaigns').find(c => c.id === a).companionInitiative, 'after', 'saved as the choice')
assert.equal(settings.get('campaigns').find(c => c.id === b).companionInitiative, 'own', "the other's as it was")
win = await openSettings()
await view(win, 'campaign', { campaignId: a, tab: 'actions' })
assert.equal(initiative().value, 'after', 'shown as saved')
const kept = settings.get('campaigns')
await click(win, '[data-action="addCampaign"]')
type(win, 'campaign.title', 'Rohan')
await save(win)
assert.equal(settings.get('campaigns').find(c => c.title === 'Rohan').companionInitiative, 'own', "a new campaign's its own roll")
settings.set('campaigns', kept.map(c => ({ ...c, companionInitiative: 'own' })))
{
  const { registered } = await import('./stub.mjs')
  const { fields } = registered.get('campaigns').type.element
  assert.ok(fields.companionInitiative instanceof foundry.data.fields.StringField, 'a StringField')
  assert.deepEqual([fields.companionInitiative.choices, fields.companionInitiative.initial, fields.companionInitiative.blank], [['own', 'after'], 'own', false])
}
const en = JSON.parse((await import('node:fs')).readFileSync(`${MODULE}/lang/en.json`, 'utf8')).SENDINGSTONE.Config.Actions
assert.deepEqual([en.Companions, en.CompanionInitiative, en.CompanionInitiativeOwn, en.CompanionInitiativeAfter], ['Companions', "Companions' initiative", 'Its own roll', 'Right after its character'])
console.log("ok - 0.36.0: Companions' initiative has its own fieldset on the Player actions tab after Items and coins, a choice of Its own roll, selected for a campaign saved before, and Right after its character, with its hint, never disabled; saved for its campaign alone as the choice, a new campaign's its own roll, a StringField in the schema")
