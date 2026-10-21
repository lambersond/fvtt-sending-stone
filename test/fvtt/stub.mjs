// A small stand-in for the parts of Foundry VTT the module touches, so its real scripts can run in
// Node and every post they make can be inspected.
import { JSDOM } from 'jsdom'

class Collection extends Map {
  filter(fn) { return [...this.values()].filter(fn) }
  map(fn) { return [...this.values()].map(fn) }
  some(fn) { return [...this.values()].some(fn) }
  find(fn) { return [...this.values()].find(fn) }
}

const hooks = new Map()
globalThis.Hooks = {
  on(name, fn) { if (!hooks.has(name)) hooks.set(name, []); hooks.get(name).push(fn); return fn },
  once(name, fn) { return this.on(name, fn) },
  off() {},
  async callAll(name, ...args) { for (const fn of hooks.get(name) ?? []) await fn(...args) },
}

// As Foundry's data fields, each keeps what it was built with, under Foundry's names: a field its
// options (`initial`, `blank`), a schema its `fields`, an array its `element`. A harness can then
// check a setting's schema, which in Foundry decides what's kept: a schema drops keys it doesn't
// define. Nothing here cleans a value.
class DataField { constructor(options = {}) { Object.assign(this, options) } }
class SchemaField extends DataField { constructor(fields, options) { super(options); this.fields = fields } }
class ArrayField extends DataField { constructor(element, options) { super(options); this.element = element } }
class SetField extends ArrayField {}
class BooleanField extends DataField {}
class StringField extends DataField {}

let ids = 0
globalThis.foundry = {
  utils: {
    randomID: () => `id${String(++ids).padStart(14, '0')}`,
    debounce: fn => (...args) => fn(...args),
    deepClone: v => structuredClone(v),
    expandObject(flat) {
      const out = {}
      for (const [key, value] of Object.entries(flat)) {
        const parts = key.split('.'); let o = out
        parts.slice(0, -1).forEach(p => { o[p] ??= {}; o = o[p] })
        o[parts.at(-1)] = value
      }
      return out
    },
  },
  data: { fields: { DataField, ArrayField, BooleanField, SchemaField, SetField, StringField } },
  // What a Gamemaster's client wraps for players' rolls; harnesses that roll dice replace it.
  dice: { Roll: class { evaluate() {} }, terms: { DiceTerm: class { _roll() {} } } },
  applications: {
    api: { ApplicationV2: class {}, HandlebarsApplicationMixin: Base => class extends Base {} },
    ux: { FormDataExtended: class {} },
  },
}
globalThis.CONST = {
  CHAT_MESSAGE_STYLES: { OTHER: 0, OOC: 1, IC: 2, EMOTE: 3 }, BASE_DOCUMENT_TYPE: 'base',
  // Foundry's token dispositions (common/constants.mjs).
  TOKEN_DISPOSITIONS: { SECRET: -2, HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1 },
}
globalThis.CONFIG = { Dice: { DamageRoll: class {} } }
globalThis.ui = { notifications: { info() {}, warn(m) { console.log('WARN', m) } } }

const settings = new Map()
const registered = new Map()
export const users = new Collection()
export const actors = new Collection()
export const combats = new Collection()

globalThis.game = {
  ready: true,
  version: '14.365',
  release: { generation: 14 },
  world: { id: 'erebor', title: 'Return to Erebor' },
  system: { id: 'dnd5e', title: 'D&D 5e', version: '5.3.0' },
  modules: new Map([['sending-stone', { version: '0.2.0' }]]),
  documentTypes: { Actor: ['character', 'npc'] },
  i18n: { lang: 'en', localize: k => k, format: (k, d) => `${k} ${JSON.stringify(d)}` },
  users, actors, combats,
  get user() { return users.get('gm') },
  // The roles core gives each permission, as its world setting `core.permissions` makes them: Make
  // Manual Rolls to Trusted Players and above, as Manual Dice's defaults are (its README.md:26).
  permissions: { MANUAL_ROLLS: [2, 3, 4] },
  settings: {
    register(module, key, config) { registered.set(key, config) },
    registerMenu() {},
    get(module, key) { return settings.has(key) ? settings.get(key) : registered.get(key)?.default },
    async set(module, key, value) { settings.set(key, value); await registered.get(key)?.onChange?.(value) },
  },
}

// A user's role (CONST.USER_ROLES: 1 Player, 2 Trusted, 3 Assistant GM, 4 Gamemaster), assigned
// Character and permissions of their own, and whether they have a permission, modelled on core's
// User#hasPermission [core, unverified]: a Gamemaster has every one; else their own, where they
// have it set; else the roles the world's `core.permissions` gives it (module 0.32.0).
export const user = (id, name, isGM = false, role = isGM ? 4 : 1) => {
  const u = {
    id, name, isGM, isActiveGM: isGM, isSelf: isGM, role, character: null, permissions: {},
    hasPermission(p) {
      return this.isGM || ((p in this.permissions) ? (this.permissions[p] === true) : (game.permissions?.[p] ?? []).includes(this.role))
    },
  }
  users.set(id, u)
  return u
}
users.activeGM = undefined

export const actor = (id, name, owners = [], type = 'character', hp = { value: 30, max: 40, temp: 0 }) => {
  const a = {
    id, name, type, uuid: `Actor.${id}`, img: `${id}.webp`,
    hasPlayerOwner: owners.length > 0,
    system: { attributes: { hp } },
    testUserPermission: (u, level) => owners.includes(u.id),
  }
  actors.set(id, a)
  return a
}

export const message = (id, fields = {}) => ({
  id, uuid: `ChatMessage.${id}`, type: 'base', style: 0, timestamp: Date.now(),
  author: users.get('gm'), _source: { author: 'gm' },
  speaker: { actor: null, token: null, scene: null }, speakerActor: null, alias: 'Gamemaster',
  whisper: [], blind: false, title: '', flavor: '', content: '<p>Hi</p>', rolls: [], flags: {}, system: null,
  ...fields,
})

export function combat(id) {
  const c = {
    id, name: '', _source: { scene: 'scene' }, active: true, started: false, round: 0, turn: null,
    combatants: new Collection(),
    get turns() { return [...this.combatants.values()].sort((a, b) => (b.initiative ?? -1) - (a.initiative ?? -1)) },
    get combatant() { return this.turn === null ? null : this.turns[this.turn] },
  }
  combats.set(id, c)
  return c
}

export const combatant = (parent, id, a, fields = {}) => {
  const cb = {
    id, parent, name: a?.name ?? id, img: '', actor: a ?? null, actorId: a?.id ?? null, tokenId: `t-${id}`,
    sceneId: 'scene', _source: { group: null }, initiative: null, isDefeated: false, hidden: false, ...fields,
  }
  parent.combatants.set(id, cb)
  return cb
}

// Every post the module makes.
export const posts = []
globalThis.fetch = async (url, init) => {
  posts.push({ url: String(url), headers: init.headers, envelope: JSON.parse(init.body) })
  return { ok: true, status: 204, statusText: 'No Content' }
}

export const settle = () => new Promise(resolve => setTimeout(resolve, 20))
// What's stored, and each setting as registered (its `type` among them), by key.
export { settings, registered }

// The browser's HTML parser, jsdom's, for the module to read chat cards and to normalise the links
// in descriptions with.
globalThis.DOMParser = new JSDOM('').window.DOMParser
