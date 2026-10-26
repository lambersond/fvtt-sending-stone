// Dishes from the Magical Recipe Book (module 0.38.0, its contract D§8.1), for the harness and the
// app's e2e (through e2e/fvtt): a character's Active Effects as Foundry v14 keeps them, created and
// deleted through the actor and each firing its hook, as every client hears of them; what dnd5e
// makes of a dish effect's changes on a character's hit points, traits and senses, worked out
// again after each change, as dnd5e prepares an actor again; world time; a chat card drawn for a
// Gamemaster or a player; chat messages deleted as core deletes them, a cleared log's among them;
// dnd5e's rest hook; and since module 0.39.0, a DialogV2 drawn as core draws one, its content copied
// or adopted (drawnDialogs). Written from dnd5e's behaviour and Foundry's, not ported; built on
// dnd5e-cards.mjs's Character (its `effects`, a list), as concentration.mjs builds its sheets.
// Import after stub.mjs and dice-core.mjs.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { JSDOM } from 'jsdom'

const Handlebars = createRequire(import.meta.url)('handlebars').create()
const { getProperty, setProperty } = foundry.utils

/** Where the module under test is, as the harness and the e2e name it: this checkout unless said otherwise. */
const moduleDir = () => process.env.MODULE || process.env.MODULE_DIR || new URL('../..', import.meta.url).pathname.replace(/\/$/, '')

/** Every effect created, with its data as the module gave it, and the actor it was made on. */
export const created = []

/**
 * What's held: the next create the harness asks to hold, waiting until it's let go, as a slow
 * server would keep one Gamemaster's create behind another's.
 */
const holds = []

/** A flat change, `{"a.b": 1}`, or a nested one, as the paths it sets. */
function flatten(object, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(object ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && (typeof value === 'object') && !Array.isArray(value) && !(value instanceof Set) && (value.constructor === Object)) {
      flatten(value, path, out)
    } else out[path] = value
  }
  return out
}

/** A turn of the event loop, as a server's round trip takes at least. */
const turn = () => new Promise(resolve => setImmediate(resolve))

let effectIds = 0

/**
 * An Active Effect on a character, as Foundry v14 keeps one: its source as created, and what's
 * prepared from it; `start` its own field; `_stats.createdTime` when it was made; expired once
 * core says so (`duration.expired`), and then suppressed, as core's expiry action `update` leaves
 * it. Updated and deleted as Foundry does, each firing its hook.
 */
export class DishEffect {
  constructor(actor, data) {
    this.id = `dishfx${String(++effectIds).padStart(10, '0')}`
    this._id = this.id
    this.parent = actor
    this.documentName = 'ActiveEffect'
    this._source = structuredClone({ ...data, _id: this.id })
    this._stats = { createdTime: Date.now() }
    this.prepare()
  }

  get uuid() { return `${this.parent.uuid}.ActiveEffect.${this.id}` }
  get isSuppressed() { return this.duration?.expired === true }
  get isTemporary() { return true }
  get active() { return !this.disabled && !this.isSuppressed }

  prepare() {
    const source = this._source
    Object.assign(this, {
      name: source.name, type: source.type ?? 'base', img: source.img ?? null, description: source.description ?? '',
      origin: source.origin ?? null, transfer: source.transfer === true, disabled: source.disabled === true,
      statuses: new Set(source.statuses ?? []), start: structuredClone(source.start ?? null),
      duration: { expired: false, ...structuredClone(source.duration ?? {}) },
      system: structuredClone(source.system ?? {}), flags: structuredClone(source.flags ?? {}),
    })
  }

  getFlag(scope, key) { return getProperty(this.flags?.[scope] ?? {}, key) }
  toObject() { return structuredClone(this._source) }

  /** As Foundry's: the source changed, prepared again, the actor too, then every client's hook. */
  async update(changes) {
    const port = portOf(this.parent)
    if (port) port.updates++
    for (const [path, value] of Object.entries(flatten(changes))) setProperty(this._source, path, value)
    this.prepare()
    prepare(this.parent)
    await Hooks.callAll('updateActiveEffect', this, foundry.utils.expandObject(flatten(changes)), {}, game.user?.id)
    return this
  }

  async delete() {
    await this.parent.deleteEmbeddedDocuments('ActiveEffect', [this.id])
    return this
  }
}

/** Each character given dishes, and what the harness may read and switch of it. */
const ports = new WeakMap()
const portOf = actor => ports.get(actor) ?? null

/**
 * What dnd5e prepares of a character from its source and its effects' changes, as far as a dish
 * reaches: its temporary maximum hit points added to, its maximum with them (never below 0), its
 * hit points never above that, as dnd5e clamps them down but never up (D5
 * data/actor/templates/attributes.mjs:360-361); its damage resistances, vulnerabilities and
 * condition immunities added to; and its senses' ranges, the larger kept. An effect suppressed or
 * disabled adds nothing.
 */
function prepare(actor) {
  const port = portOf(actor)
  if (!port) return
  const { source } = port
  const changes = actor.effects.filter(effect => effect.active !== false && !effect.disabled && !effect.isSuppressed)
    .flatMap(effect => effect.system?.changes ?? [])
  const sum = key => changes.filter(change => (change.key === key) && (change.type === 'add'))
    .reduce((total, change) => total + Number(change.value), 0)
  const hp = actor.system.attributes.hp
  hp.max = source.hp.max
  hp.temp = source.hp.temp
  hp.tempmax = source.hp.tempmax + sum('system.attributes.hp.tempmax')
  hp.effectiveMax = Math.max(hp.max + hp.tempmax, 0)
  hp.value = Math.min(source.hp.value, hp.effectiveMax)
  for (const trait of ['ci', 'dr', 'dv']) {
    const added = changes.filter(change => (change.key === `system.traits.${trait}.value`) && (change.type === 'add')).map(change => change.value)
    actor.system.traits[trait].value = new Set([...source.traits[trait], ...added])
  }
  const ranges = { ...source.senses.ranges }
  for (const change of changes) {
    const sense = /^system\.attributes\.senses\.ranges\.(\w+)$/.exec(change.key)?.[1]
    if (sense && (change.type === 'upgrade')) ranges[sense] = Math.max(Number(ranges[sense] ?? 0), Number(change.value))
  }
  actor.system.attributes.senses = { units: source.senses.units, ranges }
  actor.system.attributes.exhaustion = source.exhaustion
}

/**
 * Give a character what a dish needs (round 0.38.0 D§8.1): its hit points (`value`, `max`,
 * `tempmax`, `effectiveMax`), exhaustion, damage resistances, vulnerabilities and condition
 * immunities as Sets, and senses, kept as a source and prepared from it and its effects; its effects
 * created and deleted through `createEmbeddedDocuments` and `deleteEmbeddedDocuments`, each firing
 * createActiveEffect or deleteActiveEffect, a delete of an id it doesn't hold throwing before it
 * deletes anything, as Foundry's does and as ConcentrationEffect.delete does (dnd5e-cards.mjs); and
 * `update(changes)` setting what it changes, hit points and exhaustion into the source, then firing
 * updateActor. Its effects are what the module's sheet lists, where nothing else says so.
 * @param {object} actor   A Character of dnd5e-cards.mjs's, or one built on it.
 * @param {object} [options]
 * @returns {{faults: {throwOnCreate: boolean}, creates: number, updates: number, actorUpdates: number,
 *   log: {op: string, id: string, held: number}[], source: object}}   What the harness may read and
 *   switch: `faults.throwOnCreate` makes the next creates on this actor throw; `creates` and `updates`
 *   count its effects' creates and updates, and `actorUpdates` its own; `log` each create and delete,
 *   with how many dish effects it then held.
 */
export function withDishes(actor, { hp, exhaustion = 0, ci = [], dr = [], dv = [], senses = { units: 'ft', ranges: {} } } = {}) {
  const given = hp ?? actor.system.attributes.hp ?? { value: 30, max: 40 }
  const port = {
    faults: { throwOnCreate: false }, creates: 0, updates: 0, actorUpdates: 0, log: [],
    source: {
      hp: { value: given.value ?? 30, max: given.max ?? 40, tempmax: given.tempmax ?? 0, temp: given.temp ?? 0 },
      exhaustion, traits: { ci: new Set(ci), dr: new Set(dr), dv: new Set(dv) },
      senses: { units: senses.units ?? 'ft', ranges: { ...(senses.ranges ?? {}) } },
    },
  }
  ports.set(actor, port)
  actor.effects ??= []
  actor.system.attributes.hp = { ...given }
  actor.system.traits ??= {}
  for (const trait of ['ci', 'dr', 'dv']) actor.system.traits[trait] = { ...(actor.system.traits[trait] ?? {}), value: new Set() }
  actor.allApplicableEffects ??= function* () { yield* actor.effects }
  const dishesHeld = () => actor.effects.filter(effect => effect.getFlag?.('sending-stone', 'dish')).length

  actor.createEmbeddedDocuments = async function (type, list = []) {
    if (type !== 'ActiveEffect') throw new Error(`No ${type} here`)
    const made = []
    for (const data of list) {
      port.creates++
      if (port.faults.throwOnCreate) throw new Error(`${actor.name}'s effect could not be created`)
      const hold = holds.find(each => !each.taken && each.when(data, actor))
      if (hold) { hold.taken = true; await hold.until }
      await turn()
      const effect = new DishEffect(actor, data)
      actor.effects.push(effect)
      prepare(actor)
      port.log.push({ op: 'create', id: effect.id, held: dishesHeld() })
      await Hooks.callAll('createActiveEffect', effect, {}, game.user?.id)
      made.push(effect)
    }
    return made
  }

  actor.deleteEmbeddedDocuments = async function (type, ids = []) {
    if (type !== 'ActiveEffect') throw new Error(`No ${type} here`)
    for (const id of ids) {
      if (!actor.effects.some(effect => effect.id === id)) throw new Error(`ActiveEffect ${id} does not exist`)
    }
    await turn()
    const gone = []
    for (const id of ids) {
      const index = actor.effects.findIndex(effect => effect.id === id)
      if (index < 0) continue
      const [effect] = actor.effects.splice(index, 1)
      gone.push(effect)
    }
    prepare(actor)
    for (const effect of gone) {
      port.log.push({ op: 'delete', id: effect.id, held: dishesHeld() })
      await Hooks.callAll('deleteActiveEffect', effect, {}, game.user?.id)
    }
    return gone
  }

  actor.update = async function (changes) {
    port.actorUpdates++
    for (const [path, value] of Object.entries(flatten(changes))) {
      const hit = /^system\.attributes\.hp\.(value|max|tempmax|temp)$/.exec(path)
      if (hit) port.source.hp[hit[1]] = value
      else if (path === 'system.attributes.exhaustion') port.source.exhaustion = value
      else setProperty(actor, path, value)
    }
    prepare(actor)
    await Hooks.callAll('updateActor', actor, foundry.utils.expandObject(flatten(changes)), {}, game.user?.id)
    return actor
  }

  prepare(actor)
  return port
}

/** The port of a character given dishes, as withDishes returned it. */
export const dishPort = portOf

/**
 * Hold the next effect create this matches, until let go: as one Gamemaster's create landing after
 * another's.
 * @param {(data: object, actor: object) => boolean} when
 * @returns {{release: () => void, readonly held: boolean}}
 */
export function holdCreate(when) {
  let release
  const hold = { when, taken: false, until: new Promise(resolve => { release = resolve }) }
  holds.push(hold)
  return { release: () => { release(); holds.splice(holds.indexOf(hold), 1) }, get held() { return hold.taken } }
}

/** dnd5e's keys, as `CONFIG.DND5E` holds them, for what a dish's changes name (D5 config.mjs). */
const TABLES = {
  abilities: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(key => [key, { label: key.toUpperCase(), abbreviation: key }])),
  skills: Object.fromEntries([
    ['acr', 'dex'], ['ani', 'wis'], ['arc', 'int'], ['ath', 'str'], ['dec', 'cha'], ['his', 'int'], ['ins', 'wis'], ['itm', 'cha'],
    ['inv', 'int'], ['med', 'wis'], ['nat', 'int'], ['prc', 'wis'], ['prf', 'cha'], ['per', 'cha'], ['rel', 'int'], ['slt', 'dex'],
    ['ste', 'dex'], ['sur', 'wis'],
  ].map(([key, ability]) => [key, { label: key, ability }])),
  damageTypes: Object.fromEntries(['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison',
    'psychic', 'radiant', 'slashing', 'thunder'].map(key => [key, { label: key.charAt(0).toUpperCase() + key.slice(1) }])),
  conditionTypes: Object.fromEntries(['blinded', 'charmed', 'deafened', 'exhaustion', 'frightened', 'grappled', 'incapacitated',
    'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious']
    .map(key => [key, { label: key, ...(key === 'exhaustion' && { levels: 6 }) }])),
  senses: { blindsight: 'DND5E.SenseBlindsight', darkvision: 'DND5E.SenseDarkvision', tremorsense: 'DND5E.SenseTremorsense', truesight: 'DND5E.SenseTruesight' },
}

/** dnd5e's units of length, by how many feet each is (D5 config.mjs:2526-2556). */
const LENGTHS = { ft: 1, mi: 5280, m: 10 / 3, km: 10000 / 3 }

/**
 * Put in place what the module's dish code calls on Foundry and dnd5e (round 0.38.0 D§8.1):
 * `ActiveEffect.implementation.create(data, { parent })`, recording `data`, onto the parent's own
 * create; `getEffectStart()`, the world time now and no combat; `game.time`, from 0 unless set;
 * Foundry's `escapeHTML`; `renderTemplate`, the module's own templates from its folder; dnd5e's
 * `convertLength`; and dnd5e's tables of abilities, skills, damage types, conditions (exhaustion's 6
 * levels) and senses, each key added where the world hasn't one.
 * @returns {void}
 */
export function installDishCore() {
  globalThis.ActiveEffect = {
    implementation: {
      async create(data, { parent } = {}) {
        created.push({ data: structuredClone(data), actor: parent })
        const [effect] = await parent.createEmbeddedDocuments('ActiveEffect', [data])
        return effect
      },
      getEffectStart() {
        return { time: game.time.worldTime, combat: null, combatant: null, initiative: null, round: null, turn: null }
      },
    },
  }
  game.time ??= {}
  game.time.worldTime ??= 0
  foundry.utils.escapeHTML ??= value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[ch])
  foundry.applications ??= {}
  const render = foundry.applications.handlebars?.renderTemplate
  foundry.applications.handlebars = {
    ...foundry.applications.handlebars,
    async renderTemplate(path, data) {
      const own = /^modules\/sending-stone\//
      if (!own.test(String(path)) && render) return render(path, data)
      return Handlebars.compile(readFileSync(String(path).replace(own, `${moduleDir()}/`), 'utf8'))(data)
    },
  }
  globalThis.dnd5e ??= {}
  dnd5e.utils ??= {}
  dnd5e.utils.convertLength ??= (value, from, to) => ((from === to) ? value : value * (LENGTHS[from] ?? 1) / (LENGTHS[to] ?? 1))
  CONFIG.DND5E ??= {}
  for (const [table, entries] of Object.entries(TABLES)) CONFIG.DND5E[table] = { ...entries, ...(CONFIG.DND5E[table] ?? {}) }
  CONFIG.DND5E.conditionTypes.exhaustion = { ...CONFIG.DND5E.conditionTypes.exhaustion, levels: 6 }
}

/**
 * Move world time, as the Gamemaster does, and tell every client, as core does.
 * @param {number} seconds
 * @returns {Promise<void>}
 */
export async function setWorldTime(seconds) {
  const delta = seconds - (game.time.worldTime ?? 0)
  game.time.worldTime = seconds
  await Hooks.callAll('updateWorldTime', seconds, delta, {}, game.user?.id)
}

/** A document to draw cards in: the run's own, where it has one, so its HTMLElement is theirs. */
const own = new JSDOM('').window.document
const drawing = () => ((typeof globalThis.document?.createElement === 'function') ? globalThis.document : own)

/**
 * Draw a chat card as a client's chat log does, and fire dnd5e's hook with its element, as dnd5e
 * does once it's drawn (D5 documents/chat-message.mjs:135-142): as a Gamemaster's client, or a
 * player's.
 * @param {object} message
 * @param {object} [options]
 * @param {boolean} [options.asGm]   Whose client: a Gamemaster's, or else a player's.
 * @returns {Promise<HTMLElement>}
 */
export async function renderCard(message, { asGm = true } = {}) {
  const html = drawing().createElement('li')
  html.className = 'chat-message message'
  html.innerHTML = `<header class="message-header"><span class="message-metadata"><time>now</time></span></header><div class="message-content">${message.content ?? ''}</div>`
  const viewer = game.users.find(user => user.isGM === asGm)
  const was = Object.getOwnPropertyDescriptor(game, 'user')
  Object.defineProperty(game, 'user', { configurable: true, get: () => viewer })
  try {
    await Hooks.callAll('dnd5e.renderChatMessage', message, html)
  } finally {
    Object.defineProperty(game, 'user', was)
  }
  return html
}

/**
 * Delete chat messages as core does: each gone from the chat log, then each one's hook, with
 * `deleteAll` where the whole log is cleared, as Clear Chat Log does.
 * @param {object[]} messages
 * @param {object} [options]
 * @param {boolean} [options.deleteAll]
 * @returns {Promise<void>}
 */
export async function deleteCards(messages, { deleteAll = false } = {}) {
  for (const message of messages) game.messages.delete(message.id)
  for (const message of messages) {
    message.deleted = true
    await Hooks.callAll('deleteChatMessage', message, deleteAll ? { deleteAll: true } : {}, game.user?.id)
  }
}

/**
 * A rest completed, as dnd5e says once its own update is made (D5 documents/actor/actor.mjs:2314,
 * :2332): the update applied to the character, then the hook.
 * @param {object} actor
 * @param {object} result   `{updateData}`, as dnd5e builds it.
 * @returns {Promise<void>}
 */
export async function restCompleted(actor, result) {
  if (result?.updateData && Object.keys(result.updateData).length) await actor.update(result.updateData)
  await Hooks.callAll('dnd5e.restCompleted', actor, result, {})
}

/**
 * Foundry's DialogV2 as core draws one (round 0.39.0 §2.9, the map's §6.1) [core, unverified]: its own
 * `<dialog>` holding a form, the content in it, a footer of submit buttons, each `[data-action]`, the
 * default one autofocused; a click on an enabled button calls its callback with (event, button,
 * dialog), hands what it returns, or else its action, to `submit(result, dialog)`, then closes; a
 * disabled one does nothing, as the browser has it; closing fires `close`. With `mode: "copy"` the
 * content is drawn from a copy of its HTML, the element handed to it never in the page; with
 * `"adopt"`, the element itself is put in the form. Which v14 does is unverified, so the dish
 * dialog is checked under both.
 * @param {object} [options]
 * @param {"copy"|"adopt"} [options.mode]
 * @returns {{DialogV2: Function, opened: object[]}}   The class to install, and each dialog made.
 */
export function drawnDialogs({ mode = 'copy' } = {}) {
  const opened = []
  class DialogV2 {
    constructor(options) {
      this.options = { ...options, buttons: Object.fromEntries((options.buttons ?? []).map(each => [each.action, each])) }
      this.listeners = {}
      this.element = null
      this.closed = false
      opened.push(this)
    }

    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn) }

    async render() {
      const made = drawing()
      const element = made.createElement('dialog')
      const form = made.createElement('form')
      form.className = 'dialog-form standard-form'
      const { content } = this.options
      const Element = made.defaultView?.HTMLElement ?? globalThis.HTMLElement
      if ((mode === 'adopt') && (content instanceof Element)) {
        content.classList.add('dialog-content', 'standard-form')
        form.append(content)
      } else {
        const div = made.createElement('div')
        div.className = 'dialog-content standard-form'
        div.innerHTML = (content instanceof Element) ? content.outerHTML : String(content ?? '')
        form.append(div)
      }
      const footer = made.createElement('footer')
      footer.className = 'form-footer'
      for (const each of Object.values(this.options.buttons)) {
        const button = made.createElement('button')
        Object.assign(button, { type: 'submit', textContent: each.label, autofocus: each.default === true })
        button.dataset.action = each.action
        footer.append(button)
      }
      form.append(footer)
      element.append(form)
      element.addEventListener('click', event => {
        const target = event.target.closest?.('button[data-action]')
        if (!target) return
        event.preventDefault()
        void this.clickButton(event, target)
      })
      made.body.append(element)
      this.element = element
      return this
    }

    async clickButton(event, target) {
      const button = this.options.buttons[target.dataset.action]
      const result = (await button?.callback?.(event, target, this)) ?? button?.action
      await this.options.submit?.(result, this)
      return this.close()
    }

    async close() {
      if (this.closed) return this
      this.closed = true
      this.element?.remove()
      for (const fn of this.listeners.close ?? []) fn()
      return this
    }
  }
  return { DialogV2, opened }
}
