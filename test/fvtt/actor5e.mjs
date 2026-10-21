// dnd5e's actor rolls, as far as players' rolls from the app use them: ported from dnd5e 5.3.3's
// Actor5e (module/documents/actor/actor.mjs), with what they don't touch left out (polymorphing,
// travel pace, exhaustion, Diamond Soul). The roll process (config.rolls merging, hook names,
// fast-forwarding, messages) is dnd5e's own D20Roll.build, loaded for real. A character's hit dice
// are dnd5e's own HitDice, over class stand-ins; an NPC's are its own, as dnd5e prepares them.

import { DND5E5 } from './paths.mjs'
const { default: HitDice } = await import(`${DND5E5}/module/documents/actor/hit-dice.mjs`)

const { mergeObject, deepClone } = foundry.utils

/**
 * A class item, as far as hit dice use it: its identifier and levels, and its hit dice, as
 * class.mjs:221-223 prepares them, worked out again once spent.
 */
function classItem(actor, { identifier, denomination, levels, spent = 0 }) {
  return {
    id: identifier, type: 'class', name: identifier, identifier, parent: actor,
    system: {
      levels,
      hd: { denomination, spent, get max() { return levels }, get value() { return Math.max(this.max - this.spent, 0) } },
    },
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) foundry.utils.setProperty(this, path, value)
    },
  }
}

/** A roll mode as dnd5e's AdvantageModeField gives it. */
const modeFlags = mode => ({ advantage: mode > 0, disadvantage: mode < 0 })

/**
 * proficiency.mjs: a proficiency, as dnd5e's Proficiency class gives it, flat (never as dice):
 * the bonus times the multiplier, rounded down unless it says otherwise.
 */
const proficiency = (base, multiplier, roundDown = true) => {
  const flat = (roundDown ? Math.floor : Math.ceil)(multiplier * base)
  return { multiplier, flat, hasProficiency: (base > 0) && (multiplier > 0), term: String(flat) }
}

export class Actor5e {
  constructor({ id, name, owners = [], mods = {}, prof = 3, skills = {}, tools = {}, hp, death, init = {}, flags = {}, bonuses = {}, classes = [], npc = null }) {
    this.id = id
    this.name = name
    this.type = 'character'
    this.uuid = `Actor.${id}`
    this.img = `${id}.webp`
    this.owners = owners
    this.flags = { dnd5e: flags }
    const abilities = {}
    for (const key of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
      abilities[key] = {
        mod: mods[key] ?? 0, value: 10 + 2 * (mods[key] ?? 0),
        check: { roll: { mode: 0 } }, save: { roll: { mode: 0 } },
        checkProf: { hasProficiency: false }, saveProf: { hasProficiency: key === 'con', term: String(prof) },
        bonuses: { check: '', save: '' },
      }
    }
    this.system = {
      abilities,
      // creature.mjs:250-256, 295-299: each with its multiplier as stored (effectValue) and its
      // proficiency, a tool's doubled for Tool Expertise; Jack of All Trades isn't ported.
      skills: Object.fromEntries(Object.entries(skills).map(([key, skill]) => [key, {
        ability: skill.ability, value: skill.value ?? 1, effectValue: skill.value ?? 1, prof: proficiency(prof, skill.value ?? 1),
        roll: { mode: skill.mode ?? 0, max: null, min: null }, bonuses: { check: '' },
      }])),
      tools: Object.fromEntries(Object.entries(tools).map(([key, tool]) => [key, {
        ability: tool.ability, value: tool.value ?? 1, effectValue: tool.value ?? 1,
        prof: proficiency(prof, (((tool.value ?? 1) === 1) && flags.toolExpertise) ? 2 : (tool.value ?? 1)),
        roll: { mode: 0, max: null, min: null }, bonuses: { check: '' },
      }])),
      attributes: {
        prof,
        hp: hp ?? { value: 30, max: 40, temp: 0 },
        death: death ?? { success: 0, failure: 0, roll: { mode: 0 }, bonuses: { save: '' } },
        init: { ability: 'dex', mod: mods.dex ?? 0, prof: { hasProficiency: false }, bonus: 0, roll: { mode: init.mode ?? 0 } },
      },
      bonuses: { abilities: { check: bonuses.check ?? '', save: bonuses.save ?? '', skill: '' } },
    }
    this.hasPlayerOwner = owners.length > 0
    // attributes.mjs:360: what hit points can be healed up to.
    Object.defineProperty(this.system.attributes.hp, 'effectiveMax', {
      configurable: true, get() { return Math.max(this.max + (this.tempmax ?? 0), 0) },
    })
    this._classes = classes.map(cls => classItem(this, cls))
    if (npc) {
      // npc.mjs:212, 355-356, 432-433
      this.type = 'npc'
      this.system.isNPC = true
      this.system.attributes.hd = { ...npc, get value() { return Math.max(0, this.max - this.spent) } }
    } else {
      // character.mjs:161: prepared afresh, as dnd5e prepares it again after each update.
      Object.defineProperty(this.system.attributes, 'hd', { configurable: true, get: () => new HitDice(this) })
    }
  }

  /** actor.mjs:104-107: the actor's classes, by identifier. */
  get classes() { return Object.fromEntries(this._classes.map(cls => [cls.identifier, cls])) }

  /** actor.mjs:789-880, as far as healing goes: no traits change it, and healing isn't inverted. */
  calculateDamage(damages, options = {}) {
    if (Hooks.call('dnd5e.preCalculateDamage', this, damages, options) === false) return false
    return { amount: Math.trunc(damages.reduce((total, d) => total + d.value, 0)), temp: 0, tempMax: 0 }
  }

  testUserPermission(user) { return this.owners.includes(user.id) }
  getFlag(scope, key) { return this.flags?.[scope]?.[key] }
  getRollData() { return { abilities: deepClone(this.system.abilities), prof: this.system.attributes.prof } }
  get isToken() { return false }
  async update(changes) {
    for (const [path, value] of Object.entries(changes)) foundry.utils.setProperty(this, path, value)
  }

  /* -------------------------------------------- */

  async rollSkill(config = {}, dialog = {}, message = {}) {
    if (this.hang) await new Promise(() => {})
    return this.#rollSkillTool('skill', config, dialog, message)
  }

  async rollToolCheck(config = {}, dialog = {}, message = {}) {
    return this.#rollSkillTool('tool', config, dialog, message)
  }

  async #rollSkillTool(type, config = {}, dialog = {}, message = {}) {
    const name = type === 'skill' ? 'Skill' : 'ToolCheck'
    // actor.mjs:1265: a kind of vehicle is a tool too.
    const skillConfig = CONFIG.DND5E.skills[config.skill]
    const toolConfig = CONFIG.DND5E.tools[config.tool] ?? CONFIG.DND5E.vehicleTypes?.[config.tool]
    if (((type === 'skill') && !skillConfig) || ((type === 'tool') && !toolConfig)) {
      return this.rollAbilityCheck(config, dialog, message)
    }
    const relevant = type === 'skill' ? this.system.skills?.[config.skill] : this.system.tools?.[config.tool]
    // actor.mjs:1270, 1276: proficient in both the skill and the tool it's checked using, advantage.
    const alternate = type === 'skill' ? this.system.tools?.[config.tool] : this.system.skills?.[config.skill]
    const abilityId = config.ability ?? relevant?.ability ?? (type === 'skill' ? skillConfig.ability : toolConfig.ability)
    const ability = this.system.abilities?.[abilityId]
    const doubleProf = !!relevant?.prof.hasProficiency && !!alternate?.prof.hasProficiency
    const { advantage, disadvantage } = modeFlags((relevant?.roll.mode ?? 0) + (ability?.check.roll.mode ?? 0) + Number(doubleProf))

    const rollConfig = mergeObject({
      advantage, disadvantage,
      ability: relevant?.ability ?? (type === 'skill' ? skillConfig.ability : toolConfig?.ability),
      halflingLucky: this.getFlag('dnd5e', 'halflingLucky'),
      reliableTalent: (relevant?.value >= 1) && this.getFlag('dnd5e', 'reliableTalent'),
      elvenAccuracy: this.getFlag('dnd5e', 'elvenAccuracy'),
    }, config)
    rollConfig.hookNames = [...(config.hookNames ?? []), type, 'abilityCheck', 'd20Test']
    rollConfig.rolls = [CONFIG.Dice.D20Roll.mergeConfigs({
      options: {
        maximum: Math.min(relevant?.roll.max ?? Infinity, ability?.check.roll.max ?? Infinity),
        minimum: Math.max(relevant?.roll.min ?? -Infinity, ability?.check.roll.min ?? -Infinity),
      },
    }, config.rolls?.shift())].concat(config.rolls ?? [])
    rollConfig.subject = this

    const dialogConfig = mergeObject({
      options: { buildConfig: this._buildSkillToolConfig.bind(this, type), chooseAbility: true },
    }, dialog)
    const label = type === 'skill' ? skillConfig.label : (toolConfig.label ?? toolConfig)
    const messageConfig = mergeObject({
      create: true,
      data: {
        flags: { dnd5e: { messageType: 'roll', roll: { [`${type}Id`]: config[type], type } } },
        flavor: `${label} Check`,
        speaker: ChatMessage.getSpeaker({ actor: this }),
      },
    }, message)

    const rolls = await CONFIG.Dice.D20Roll.build(rollConfig, dialogConfig, messageConfig)
    if (!rolls.length) return null
    Hooks.callAll(`dnd5e.roll${name}`, rolls, { ability: rollConfig.ability, [type]: rollConfig[type], subject: this })
    return rolls
  }

  _buildSkillToolConfig(type, process, config) {
    const relevant = type === 'skill' ? this.system.skills?.[process.skill] : this.system.tools?.[process.tool]
    const abilityId = process.ability
    const ability = this.system.abilities?.[abilityId]
    // actor.mjs:1371: the proficiency of the skill and the tool it's checked using together.
    const prof = this.skillToolProficiency(process)
    const { parts, data } = CONFIG.Dice.D20Roll.constructParts({
      mod: ability?.mod,
      prof: prof.hasProficiency ? prof.term : null,
      [`${config[type]}Bonus`]: relevant?.bonuses?.check,
      extraBonus: process.bonus,
      [`${abilityId}CheckBonus`]: ability?.bonuses?.check,
      [`${type}Bonus`]: this.system.bonuses?.abilities?.[type],
      abilityCheckBonus: this.system.bonuses?.abilities?.check,
    }, { ...this.getRollData() })
    config.parts = [...(config.parts ?? []), ...parts]
    config.data = { ...data, ...(config.data ?? {}) }
    config.data.abilityId = abilityId
  }

  /**
   * common.mjs:234-240 (calculateSkillToolProficiency): the higher of the skill's and the tool's
   * multipliers as stored, whichever has it; for a check with a tool, a proficient one doubled for
   * Tool Expertise (common.mjs:216-221). Jack of All Trades and Remarkable Athlete aren't ported.
   */
  skillToolProficiency({ skill, tool } = {}) {
    let multiplier = Math.max(this.system.skills?.[skill]?.effectValue ?? 0, this.system.tools?.[tool]?.effectValue ?? 0)
    if (tool && (multiplier === 1) && this.flags.dnd5e?.toolExpertise) multiplier = 2
    return proficiency(this.system.attributes.prof, multiplier)
  }

  /* -------------------------------------------- */

  async rollAbilityCheck(config = {}, dialog = {}, message = {}) {
    return this.#rollD20Test('check', config, dialog, message)
  }

  async rollSavingThrow(config = {}, dialog = {}, message = {}) {
    return this.#rollD20Test('save', config, dialog, message)
  }

  async #rollD20Test(type, config = {}, dialog = {}, message = {}) {
    const name = type === 'check' ? 'AbilityCheck' : 'SavingThrow'
    const ability = this.system.abilities?.[config.ability]
    const abilityConfig = CONFIG.DND5E.abilities[config.ability]
    const { parts, data } = CONFIG.Dice.D20Roll.constructParts({
      mod: ability?.mod,
      prof: ability?.[`${type}Prof`].hasProficiency ? ability[`${type}Prof`].term : null,
      [`${config.ability}${type.capitalize()}Bonus`]: ability?.bonuses[type],
      [`${type}Bonus`]: this.system.bonuses?.abilities?.[type],
    }, this.getRollData())
    const options = {
      advantage: ability?.[type]?.roll.mode === CONFIG.Dice.D20Roll.ADV_MODE.ADVANTAGE,
      disadvantage: ability?.[type]?.roll.mode === CONFIG.Dice.D20Roll.ADV_MODE.DISADVANTAGE,
    }
    const rollConfig = mergeObject({ halflingLucky: this.getFlag('dnd5e', 'halflingLucky') }, config)
    rollConfig.hookNames = [...(config.hookNames ?? []), name, 'd20Test']
    rollConfig.rolls = [
      CONFIG.Dice.D20Roll.mergeConfigs({ parts, data, options }, config.rolls?.shift()),
    ].concat(config.rolls ?? [])
    rollConfig.subject = this

    const dialogConfig = deepClone(dialog)
    const messageConfig = mergeObject({
      create: true,
      data: {
        flags: { dnd5e: { messageType: 'roll', roll: { ability: config.ability, type: type === 'check' ? 'ability' : 'save' } } },
        flavor: `${abilityConfig?.label ?? ''} ${type === 'check' ? 'Check' : 'Saving Throw'}`,
        speaker: ChatMessage.getSpeaker({ actor: this }),
      },
    }, message)

    const rolls = await CONFIG.Dice.D20Roll.build(rollConfig, dialogConfig, messageConfig)
    message.rollMode = messageConfig.rollMode
    if (!rolls.length) return null
    Hooks.callAll(`dnd5e.roll${name}`, rolls, { ability: config.ability, subject: this })
    return rolls
  }

  /* -------------------------------------------- */

  async rollDeathSave(config = {}, dialog = {}, message = {}) {
    const death = this.system.attributes?.death
    if ((this.system.attributes.hp.value > 0) || (death.failure >= 3) || (death.success >= 3)) {
      ui.notifications.warn('DND5E.DeathSaveUnnecessary', { localize: true })
      deathWarnings.push(this.id)
      return null
    }
    const parts = []
    const data = {}
    const options = {
      advantage: death.roll.mode === CONFIG.Dice.D20Roll.ADV_MODE.ADVANTAGE,
      disadvantage: death.roll.mode === CONFIG.Dice.D20Roll.ADV_MODE.DISADVANTAGE,
    }
    if (death.bonuses.save) parts.push(death.bonuses.save)

    const rollConfig = mergeObject({ target: 10 }, config)
    rollConfig.hookNames = [...(config.hookNames ?? []), 'deathSave']
    rollConfig.rolls = [
      CONFIG.Dice.D20Roll.mergeConfigs({ parts, data, options }, config.rolls?.shift()),
    ].concat(config.rolls ?? [])

    const dialogConfig = deepClone(dialog)
    const messageConfig = mergeObject({
      data: { flags: { dnd5e: { roll: { type: 'death' } } }, flavor: 'Death Saving Throw' },
    }, message)

    const rolls = await this.rollSavingThrow(rollConfig, dialogConfig, messageConfig)
    if (!rolls?.length) return null

    const details = { subject: this }
    const roll = rolls[0]
    if (roll.total >= (roll.options.target ?? 10)) {
      const successes = (death.success || 0) + 1
      if (roll.isCritical) {
        details.updates = { 'system.attributes.death.success': 0, 'system.attributes.death.failure': 0, 'system.attributes.hp.value': 1 }
        details.chatString = 'DND5E.DeathSaveCriticalSuccess'
      } else if (successes === 3) {
        details.updates = { 'system.attributes.death.success': 0, 'system.attributes.death.failure': 0 }
        details.chatString = 'DND5E.DeathSaveSuccess'
      } else details.updates = { 'system.attributes.death.success': Math.clamp(successes, 0, 3) }
    } else {
      const failures = (death.failure || 0) + (roll.isFumble ? 2 : 1)
      details.updates = { 'system.attributes.death.failure': Math.clamp(failures, 0, 3) }
      if (failures >= 3) details.chatString = 'DND5E.DeathSaveFailure'
    }
    if (Hooks.call('dnd5e.rollDeathSave', rolls, details) === false) return rolls
    if (!foundry.utils.isEmpty(details.updates)) await this.update(details.updates)
    // actor.mjs:1677-1695: the outcome's own message, made without the roll's flags, then the hook
    // that hands it on.
    let resultsMessage
    if (details.chatString) {
      const chatData = { content: details.chatString, speaker: messageConfig.speaker ?? ChatMessage.getSpeaker({ actor: this }) }
      ChatMessage.applyRollMode(chatData, messageConfig.rollMode ?? CONFIG.Dice.BasicRoll.getMessageMode())
      resultsMessage = await ChatMessage.create(chatData)
    }
    Hooks.callAll('dnd5e.postRollDeathSave', rolls, { message: resultsMessage, subject: this })
    return rolls
  }

  /* -------------------------------------------- */

  /** actor.mjs:1931-2038 */
  async rollHitDie(config = {}, dialog = {}, message = {}) {
    let formula
    let oldFormat = false

    let cls = null

    // NPCs only have one denomination
    if (this.system.isNPC) {
      config.denomination = `d${this.system.attributes.hd.denomination}`

      // If no hit dice are available, display an error notification
      if (!this.system.attributes.hd.value) {
        ui.notifications.error(game.i18n.format('DND5E.HitDiceNPCWarn', { name: this.name }))
        return null
      }
    }

    // Otherwise check classes
    else {
      // If no denomination was provided, choose the first available
      if (!config.denomination) {
        cls = this.system.attributes.hd.classes.find(c => c.system.hd.value)
        if (!cls) return null
        config.denomination = cls.system.hd.denomination
      }

      // Otherwise, locate a class (if any) which has an available hit die of the requested denomination
      else cls = this.system.attributes.hd.classes.find(i => {
        return (i.system.hd.denomination === config.denomination) && i.system.hd.value
      })

      // If no class is available, display an error notification
      if (!cls) {
        ui.notifications.error(game.i18n.format('DND5E.HitDiceWarn', { name: this.name, formula: config.denomination }))
        return null
      }
    }
    const rulesVersion = dnd5e.settings.rulesVersion
    const minimumValue = rulesVersion === 'modern' ? 1 : 0
    formula ??= `max(${minimumValue}, 1${config.denomination} + @abilities.con.mod)`
    const rollConfig = foundry.utils.deepClone(config)
    rollConfig.hookNames = [...(config.hookNames ?? []), 'hitDie']
    rollConfig.rolls = [{ parts: [formula], data: this.getRollData() }].concat(config.rolls ?? [])
    rollConfig.subject = this

    const dialogConfig = foundry.utils.mergeObject({
      configure: false,
    }, dialog)

    const flavor = game.i18n.localize('DND5E.HitDiceRoll')
    const messageConfig = foundry.utils.mergeObject({
      rollMode: CONFIG.Dice.BasicRoll.getMessageMode(),
      data: {
        speaker: ChatMessage.implementation.getSpeaker({ actor: this }),
        flavor,
        title: `${flavor}: ${this.name}`,
        'flags.dnd5e.roll': { type: 'hitDie' },
      },
    }, message)

    const rolls = await CONFIG.Dice.BasicRoll.build(rollConfig, dialogConfig, messageConfig)
    if (!rolls.length) return null
    const returnValue = oldFormat && rolls?.length ? rolls[0] : rolls

    const updates = { actor: {}, class: {} }
    if (rollConfig.modifyHitDice !== false) {
      if (cls) updates.class['system.hd.spent'] = cls.system.hd.spent + 1
      else updates.actor['system.attributes.hd.spent'] = this.system.attributes.hd.spent + 1
    }
    const hp = this.system.attributes.hp
    if (rollConfig.modifyHitPoints !== false) {
      const total = rolls.reduce((t, r) => t + r.total, 0)
      const calculated = this.calculateDamage([{ type: 'healing', value: total }], { invertHealing: false })
      const dhp = Math.min(Math.max(0, hp.effectiveMax) - hp.value, calculated ? calculated.amount : total)
      updates.actor['system.attributes.hp.value'] = hp.value + dhp
    }

    if (Hooks.call('dnd5e.rollHitDie', rolls, { subject: this, updates }) === false) return returnValue
    if (Hooks.call('dnd5e.rollHitDieV2', rolls, { subject: this, updates }) === false) return returnValue

    // Perform updates
    if (!foundry.utils.isEmpty(updates.actor)) await this.update(updates.actor)
    if (!foundry.utils.isEmpty(updates.class)) await cls.update(updates.class)

    Hooks.callAll('dnd5e.postRollHitDie', rolls, { subject: this })

    return returnValue
  }

  /* -------------------------------------------- */

  getInitiativeRoll(options = {}) {
    if (this._cachedInitiativeRoll) return this._cachedInitiativeRoll.clone()
    const config = this.getInitiativeRollConfig(options)
    if (!config) return null
    if (config.options?.fixed === undefined) {
      const formula = ['1d20'].concat(config.parts).join(' + ')
      return new CONFIG.Dice.D20Roll(formula, config.data, config.options)
    }
    return new CONFIG.Dice.BasicRoll(String(config.options.fixed), config.data, config.options)
  }

  getInitiativeRollConfig(options = {}) {
    const init = this.system.attributes?.init
    const flags = this.flags.dnd5e ?? {}
    const abilityId = init?.ability || 'dex'
    const ability = this.system.abilities?.[abilityId]
    const { parts, data } = CONFIG.Dice.D20Roll.constructParts({
      mod: init?.mod,
      prof: init.prof.hasProficiency ? init.prof.term : null,
      initiativeBonus: init.bonus,
      [`${abilityId}AbilityCheckBonus`]: ability?.bonuses?.check,
      abilityCheckBonus: this.system.bonuses?.abilities?.check,
    }, this.getRollData())
    const { advantage, disadvantage } = modeFlags(init.roll.mode + (ability?.check.roll.mode ?? 0))
    options = mergeObject({
      advantage, disadvantage,
      fixed: this.fixedInitiative,
      flavor: options.flavor ?? 'Initiative',
      halflingLucky: flags.halflingLucky ?? false,
      maximum: Infinity,
      minimum: -Infinity,
    }, options)
    const rollConfig = { parts, data, options, subject: this }
    Hooks.callAll('dnd5e.preConfigureInitiative', this, rollConfig)
    return rollConfig
  }

  async rollInitiative(options = {}, rollOptions = {}) {
    this._cachedInitiativeRoll ??= this.getInitiativeRoll(rollOptions)
    if (Hooks.call('dnd5e.preRollInitiative', this, this._cachedInitiativeRoll) === false) {
      delete this._cachedInitiativeRoll
      return null
    }
    const combat = await coreRollInitiative.call(this, options)
    const combatants = game.combat?.combatants.filter(c => c.actor?.id === this.id) ?? []
    Hooks.callAll('dnd5e.rollInitiative', this, combatants)
    delete this._cachedInitiativeRoll
    return combat
  }
}

/** Actors dnd5e warned the Gamemaster about, for a death saving throw that wasn't needed. */
export const deathWarnings = []

/** Core's Actor#rollInitiative, as far as dnd5e's override calls it. */
async function coreRollInitiative({ createCombatants = false, rerollInitiative = false, initiativeOptions = {} } = {}) {
  const combat = game.combat
  if (!combat) return null
  const ids = combat.combatants
    .filter(c => (c.actor?.id === this.id) && (rerollInitiative || (c.initiative === null)))
    .map(c => c.id)
  await combat.rollInitiative(ids, initiativeOptions)
  return combat
}

/** Core's Combat#rollInitiative, with dnd5e's Combatant5e#getInitiativeRoll. */
export async function rollCombatInitiative(ids, { messageOptions = {}, messageMode } = {}) {
  for (const id of ids) {
    const combatant = this.combatants.get(id)
    const roll = combatant.actor.getInitiativeRoll()
    await roll.evaluate()
    combatant.initiative = roll.total
    const data = mergeObject({
      speaker: ChatMessage.getSpeaker({ actor: combatant.actor }),
      flavor: `${combatant.name} rolls for Initiative!`,
      flags: { 'core.initiativeRoll': true },
    }, messageOptions)
    await ChatMessage.create({ ...data, rolls: [roll] }, { messageMode: messageMode ?? messageOptions.rollMode })
  }
  return this
}
