// dnd5e's concentration, and the chat cards that ask for saving throws, for the harnesses and
// end-to-end runs: Actor5e with concentration (the concentration getter, challengeConcentration,
// rollConcentration and a targeted endConcentration, ported from dnd5e 5.3.3's actor.mjs, with its
// concentration effects as active-effect.mjs makes them, since module 0.29.0); a save activity's
// card and a Gamemaster's request, as dnd5e's templates render them; and Midi-QOL's own
// concentration card. Since module 0.41.0, a companion's concentration check and card too
// (`withConcentrationChecks`, `concentrationCardOf`). Import after dice-core.mjs, whose Sets have
// Foundry's find and reduce.
import { Actor5e } from './actor5e.mjs'

/** How many concentration effects have been made, for their ids. */
let concentrations = 0

/**
 * A concentration effect, as dnd5e 5.3.3's createConcentrationEffectData makes it
 * (active-effect.mjs:693-722): the Concentrating status, the item it's on in `flags.dnd5e.item`, with
 * the item's source data where the item isn't on the actor (as a spell scroll spent to cast it), and
 * Foundry's `_stats.createdTime`. Deleted as Foundry deletes one: gone from its actor's effects, then
 * the deleteActiveEffect hook, which every client runs.
 */
export class ConcentrationEffect {
  constructor(actor, { name, item = null, createdTime = Date.now() }) {
    this.id = `conc${String(++concentrations).padStart(12, '0')}`
    this.documentName = 'ActiveEffect'
    this.parent = actor
    this.uuid = `${actor.uuid}.ActiveEffect.${this.id}`
    this.name = `Concentrating: ${name}`
    this.statuses = new Set(['concentrating'])
    this.flags = { dnd5e: { item: item ?? undefined } }
    this._stats = { createdTime }
    /** The item's name, for the harness's record of what was ended. */
    this.itemName = name
  }

  getFlag(scope, key) { return foundry.utils.getProperty(this.flags?.[scope] ?? {}, key) }

  async delete() {
    const index = this.parent.effects.indexOf(this)
    if (index < 0) throw new Error(`ActiveEffect ${this.id} does not exist`)
    this.parent.effects.splice(index, 1)
    await Hooks.callAll('deleteActiveEffect', this, {}, game.user?.id)
    return this
  }
}

/**
 * An item as dnd5e prepares one from its source data, as far as its name goes: an item not yet
 * identified takes its unidentified name (data/item/templates/identifiable.mjs:57-60).
 */
class PreparedItem {
  constructor(data, { parent } = {}) {
    this._id = data._id
    this.id = data._id
    this.parent = parent
    this.documentName = 'Item'
    this.system = foundry.utils.deepClone(data.system ?? {})
    const unidentified = this.system.unidentified?.name
    this.name = ((this.system.identified === false) && unidentified) ? unidentified : data.name
  }
}

/** Foundry's embedded collection, as far as these actors use one: by id, iterating its documents. */
class Items extends Map {
  *[Symbol.iterator]() { yield* this.values() }
  get contents() { return [...this.values()] }
  find(fn) { return this.contents.find(fn) }
  filter(fn) { return this.contents.filter(fn) }
  some(fn) { return this.contents.some(fn) }
}

/** A dnd5e actor that can concentrate: dnd5e 5.3.3's concentration, ported from its actor.mjs. */
export class Character extends Actor5e {
  constructor({ concentration = 'con', ...data }) {
    super(data)
    this.documentName = 'Actor'
    this.system.attributes.concentration = {
      ability: concentration, limit: 1, roll: { mode: 0, max: null, min: null }, bonuses: { save: '' },
    }
    this.effects = []
    this.items = new Items()
    /** The concentration this actor ended, in order, by the item's name. */
    this.ended = []
  }

  get isOwner() { return true }

  /** actor.mjs:183-205: the items this actor concentrates on, as prepared, and the effects; none at limit 0. */
  get concentration() {
    const concentration = { items: new Set(), effects: new Set() }
    const limit = this.system.attributes?.concentration?.limit ?? 0
    if (!limit) return concentration
    for (const effect of this.effects) {
      if (!effect.statuses?.has('concentrating')) continue
      const data = effect.getFlag?.('dnd5e', 'item')
      concentration.effects.add(effect)
      if (data) {
        let item = this.items.get(data.id)
        if (!item && data.data && (typeof data.data === 'object')) item = new PreparedItem(data.data, { parent: this })
        if (item) concentration.items.add(item)
      }
    }
    return concentration
  }

  /**
   * Start concentrating on a spell, as casting it would: on the item of that name, if it's given,
   * as it's on the actor; with `data`, as one no longer on the actor, its source kept on the effect.
   */
  concentrateOn(name, { id = name.toLowerCase().replace(/\W+/g, '-'), data, createdTime } = {}) {
    if (!data && !this.items.has(id)) {
      this.items.set(id, { id, _id: id, name, type: 'spell', documentName: 'Item', uuid: `${this.uuid}.Item.${id}`, system: {} })
    }
    const item = { type: 'spell', id, uuid: `${this.uuid}.Item.${id}`, data }
    const effect = new ConcentrationEffect(this, { name, item, createdTime })
    this.effects.push(effect)
    return effect
  }

  /** actor.mjs:1065-1108: one concentration, by its effect, its effect's id or its item; all with none. */
  async endConcentration(target) {
    let effect
    const { effects } = this.concentration
    if (!target) {
      return effects.reduce(async (acc, effect) => {
        acc = await acc
        return acc.concat(await this.endConcentration(effect))
      }, [])
    }
    if (typeof target === 'string') effect = effects.find(e => e.id === target)
    else if (target instanceof ConcentrationEffect) effect = effects.has(target) ? target : null
    else if (target?.documentName === 'Item') {
      effect = effects.find(e => {
        const data = e.getFlag('dnd5e', 'item') ?? {}
        return (data.id === target._id) || (data.data?._id === target._id)
      })
    }
    if (!effect) return []
    if (Hooks.call('dnd5e.preEndConcentration', this, effect) === false) return []
    await effect.delete()
    this.ended.push(effect.itemName)
    Hooks.callAll('dnd5e.endConcentration', this, effect)
    return [effect]
  }

  async challengeConcentration({ dc = 10, ability = null } = {}) {
    if (!this.concentration.effects.size) return null
    const dataset = { action: 'concentration', dc }
    if (ability in CONFIG.DND5E.abilities) dataset.ability = ability
    return ChatMessage.implementation.create({
      content: requestCardHtml([{
        dataset: { ...dataset, type: 'concentration', visbility: 'all' },
        buttonLabel: `DC ${dc} Concentration`, hiddenLabel: 'Concentration',
      }]),
      // Foundry stores the users whispered to by id.
      whisper: game.users.filter(user => user.isGM || this.testUserPermission(user, 'OWNER')).map(user => user.id),
      speaker: ChatMessage.implementation.getSpeaker({ actor: this }),
    })
  }

  async rollConcentration(config = {}, dialog = {}, message = {}) {
    if (!this.isOwner) return null
    const conc = this.system.attributes?.concentration
    const parts = []
    const options = {
      advantage: conc.roll.mode === CONFIG.Dice.D20Roll.ADV_MODE.ADVANTAGE,
      disadvantage: conc.roll.mode === CONFIG.Dice.D20Roll.ADV_MODE.DISADVANTAGE,
      maximum: conc.roll.max,
      minimum: conc.roll.min,
    }
    if (conc.bonuses.save) parts.push(conc.bonuses.save)
    const rollConfig = foundry.utils.mergeObject({
      ability: (conc.ability in CONFIG.DND5E.abilities) ? conc.ability : CONFIG.DND5E.defaultAbilities.concentration,
      isConcentration: true,
      target: 10,
    }, config)
    rollConfig.hookNames = [...(config.hookNames ?? []), 'concentration']
    rollConfig.rolls = [
      CONFIG.Dice.D20Roll.mergeConfigs({ parts, data: {}, options }, config.rolls?.shift()),
    ].concat(config.rolls ?? [])
    const dialogConfig = foundry.utils.mergeObject({ options: { window: { title: 'Concentration' } } }, dialog)
    const messageConfig = foundry.utils.deepClone(message)
    const rolls = await this.rollSavingThrow(rollConfig, dialogConfig, messageConfig)
    if (!rolls?.length) return null
    Hooks.callAll('dnd5e.rollConcentration', rolls, { subject: this })
    Hooks.callAll('dnd5e.rollConcentrationV2', rolls, { subject: this })
    return rolls
  }
}

/**
 * dnd5e's concentration card for any actor concentrating, as Character#challengeConcentration posts
 * one (actor.mjs:1119-1148), since module 0.41.0 for a companion's: a token's creature's or a linked
 * NPC's, made by token-core.mjs, whose concentration effects are activity5e.mjs's equip()'s. Not
 * wrapped by midi-saves.mjs, so dnd5e's card whatever Midi's Concentration Check says. Null where it
 * concentrates on nothing.
 */
export async function concentrationCardOf(actor, { dc = 10, ability = null } = {}) {
  if (!actor.concentration?.effects?.size) return null
  const dataset = { action: 'concentration', dc }
  if (ability in CONFIG.DND5E.abilities) dataset.ability = ability
  return ChatMessage.implementation.create({
    content: requestCardHtml([{
      dataset: { ...dataset, type: 'concentration', visbility: 'all' },
      buttonLabel: `DC ${dc} Concentration`, hiddenLabel: 'Concentration',
    }]),
    whisper: game.users.filter(user => user.isGM || actor.testUserPermission(user, 'OWNER')).map(user => user.id),
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
  })
}

/**
 * Give an actor dnd5e's concentration check, as Character has it, since module 0.41.0: its
 * concentration's ability, limit and roll, and rollConcentration; for a companion's world actor made
 * by token-core.mjs, its tokens' creatures too, as core makes each from it.
 */
export function withConcentrationChecks(actor, { ability = 'con' } = {}) {
  const give = each => {
    each.system.attributes.concentration = { ability, limit: 1, roll: { mode: 0, max: null, min: null }, bonuses: { save: '' } }
    Object.defineProperty(each, 'isOwner', { configurable: true, value: true })
    each.rollConcentration = Character.prototype.rollConcentration
    return each
  }
  give(actor)
  if (typeof actor.make === 'function') {
    const make = actor.make
    actor.make = () => give(make())
  }
  return actor
}

// dnd5e's dataset helper: each key in kebab case, as a data attribute.
const attributes = dataset => Object.entries(dataset).filter(([, value]) => value !== undefined)
  .map(([key, value]) => `data-${key.replace(/[A-Z]+(?![a-z])|[A-Z]/g, (a, b) => (b ? '-' : '') + a.toLowerCase())}="${String(value).replaceAll('"', '&quot;')}"`)
  .join(' ')

/** dnd5e's roll-request-card.hbs. */
export const requestCardHtml = buttons => `<div class="chat-card request-card">
    <div class="card-buttons">
        ${buttons.map(({ dataset, buttonLabel, hiddenLabel }) => `<button ${attributes(dataset)}>
            <span class="visible-dc">${buttonLabel}</span>
            <span class="hidden-dc">${hiddenLabel}</span>
        </button>`).join('\n        ')}
    </div>
</div>`

/**
 * A save activity's card, as dnd5e's activity-card.hbs renders it, with its usage flags; and any
 * others given, as Midi-QOL's workflow card has its own.
 */
export async function saveCard({ by, item, dc, abilities = ['dex'], targets = [], whisper = [], author = 'gm', flags = {} }) {
  const buttons = abilities.map(ability => ({
    dataset: { dc, ability, action: 'rollSave', visibility: 'all' },
    label: `<span class="visible-dc">DC ${dc} ${ability.toUpperCase()}</span>
          <span class="hidden-dc">${ability.toUpperCase()} Saving Throw</span>`,
  })).concat([{ dataset: { action: 'rollDamage' }, label: 'Damage' }])
  return ChatMessage.create({
    author,
    content: `<div class="chat-card activation-card">
    <section class="card-header description collapsible">
        <header class="summary">
            <img class="gold-icon" src="${item.img}" alt="${item.name}">
            <div class="name-stacked border"><span class="title">${item.name}</span></div>
        </header>
    </section>
    <div class="card-buttons">
        ${buttons.map(({ dataset, label }) => `<button type="button" ${attributes(dataset)}>
            <i class="fa-solid fa-shield-heart" inert></i> <span>${label}</span>
        </button>`).join('\n        ')}
    </div>
</div>`,
    speaker: ChatMessage.getSpeaker({ actor: by }),
    whisper,
    flags: {
      dnd5e: {
        messageType: 'usage',
        activity: { type: 'save', id: 'save', uuid: `${item.uuid}.Activity.save` },
        item: { type: 'spell', id: item.id, uuid: item.uuid },
        targets: targets.map(target => ({ name: target.name, img: target.img, uuid: target.uuid, ac: 15 })),
      },
      ...flags,
    },
  })
}

/**
 * A request the Gamemaster posts from an enricher, as dnd5e's handlePostRequest makes it; with
 * hideDC, from a link whose author hid its DC, which keeps it on its buttons, marked so, and labels
 * them without it either way.
 */
export async function requestCard({ type = 'save', abilities = [], dc, hideDC = false, whisper = [], author = 'gm' }) {
  const hidden = hideDC ? { hideDC: 'true' } : {}
  const buttons = (type === 'save')
    ? abilities.map(ability => ({ type, ability, dc, ...hidden, format: 'long' }))
    : [{ type, ...(abilities[0] && { ability: abilities[0] }), dc, ...hidden, format: 'short' }]
  return ChatMessage.create({
    author,
    content: requestCardHtml(buttons.map(dataset => ({
      dataset: { ...dataset, action: 'rollRequest', visibility: 'all' },
      buttonLabel: `${hideDC ? '' : `DC ${dc} `}${dataset.ability ?? 'Concentration'}`, hiddenLabel: dataset.ability ?? 'Concentration',
    }))),
    flavor: 'Roll Request',
    speaker: { actor: null, alias: game.users.get(author).name },
    whisper,
  })
}

/** Midi-QOL's own concentration card, in its "chat" mode: no button, and Midi rolls it. */
export async function midiConcentrationCard(actor, dc) {
  return ChatMessage.create({
    content: `<div class="dnd5e chat-card request-card" data-action="concentration" data-dc="${dc}" data-type="midi-concentration">
      <div><span class="visible-dc">DC ${dc} Concentration Roll</span></div>
      <div><span class="hidden-dc">Concentration Roll</span></div>
      </div>`,
    whisper: game.users.filter(user => user.isGM || actor.testUserPermission(user, 'OWNER')).map(user => user.id),
    speaker: ChatMessage.getSpeaker({ actor }),
  })
}

/** Delete a message, as Foundry does: then its deletion hook. */
export async function deleteMessage(message) {
  await message.delete()
  await Hooks.callAll('deleteChatMessage', message, {}, 'gm')
}
