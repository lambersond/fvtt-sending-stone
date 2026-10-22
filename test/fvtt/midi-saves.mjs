// A stand-in for Midi-QOL 13's saving throws, as far as a module asking them in the app meets them,
// modelled on Midi-QOL's v13 source (read as text, never run) and put on midi-fake.mjs's
// workflow: WorkflowState_WaitForSaves (Workflow.ts:2405-2445), checkSaves (6395-6600) with its
// sequential loop and awaited midi-qol.preTargetSave, buildSaveDetailsForTarget (6266-6366),
// determineRollTypeAndAction (5509-5598), determineTargetRollSettings (5283-5334),
// queueTargetSaveRoll (6007-6072) and its branches: A friendly (5043-5064), B-D Monk's TokenBar,
// Flash Rolls and Epic Rolls batched after the loop (6512-6524), E the chat request
// (createPlayerChatSaveRequest 5820-5935, requestPCSave utils.ts:946-989, processSaveRoll
// 6770-6799), F the standard socket roll (createStandardSaveRoll 5940-6001, GMAction.rollAbility
// GMAction.ts:809-1013) on this, the Gamemaster's, client or on a player's client, with or
// without its dialog, which is open there as dnd5e's roll dialog is, and which Midi's Player Save
// Timeout rolls without (984-1011); processTargetSaveResult (6077-6176) as far as the DC, DEX
// cover and the saves and failed saves go; postCheckSaves; RollComplete. Its roll wrapper doRollAbility
// (patching.ts:1514-1735) as far as the DC, the concentration redirect, advantage and the
// speaker's token go. Concentration in "chat" mode (patching.ts:2772-2806, utils.ts:9384-9408,
// Hooks.ts:414-424, GMAction.ts:799-807) and "item" mode (utils.ts:8412-8512), and Midi's
// dnd5e.rollConcentration hook (Hooks.ts:1888-1915). OverTime turn workflows from a
// flags.midi-qol.OverTime spec (utils.ts:1896-2016, 2077-2103, 2194-2295) with RollComplete's
// removal (Hooks.ts:578-635). Install after midi-fake.mjs's installMidi.
//
// What can't be had from the source is invented and marked so: how Midi works out advantage and
// auto-results from flags (here, from `midiSaves.advantage`, the same before and as it rolls, and
// for saves and concentration checks from the actor's own Midi flags, each read as set), and
// socketlib (a call to this user runs here; one to a player's client is that client's, rolling on
// the same actors once it answers).

import { midi } from './midi-fake.mjs'

/** What Midi did, and what the harness tells it. */
export const midiSaves = {
  /** Calls of Midi's own queueTargetSaveRoll, the module's wrapper aside, each its options. */
  queued: [],
  /** socketlib calls to another user's client, each { handler, userId, data, answer }. */
  sockets: [],
  /** Batched requests sent to another module after the loop: { module, gm, player }. */
  batches: [],
  /** Midi's chat request cards. */
  requestCards: [],
  /** Invented: what Midi works out from flags for each actor, by ability or skill key. */
  advantage: new Map(),
  /** Each token's cover bonus to a DEX save, by token id. */
  cover: new Map(),
  /** Midi's concentration rolls for its chat card: { actorId, via }. */
  concentrationRolls: [],
  /** The socket calls whose roll dialog Midi's timer rolled without, on the player's client. */
  dialogTimeouts: [],
  /** OverTime effects Midi expired: { actorId, effect, reason }. */
  expired: [],
  /** Errors checkSaves caught, as Midi records them. */
  errors: [],
  /** The rolls each finished workflow processed: { workflow, results }. */
  processed: [],
  /** Installed modules, as Midi's installedModules has them. */
  modules: new Set(),
}

/** Midi's settings for saves, with its defaults (settings.ts:135, 172, 215-216, 231-232). */
Object.assign(midi.settings, {
  autoCheckSaves: 'none',
  playerRollSaves: 'none',
  rollNPCLinkedSaves: 'auto',
  rollNPCSaves: 'auto',
  playerSaveTimeout: 0,
  doConcentrationCheck: 'chat',
  removeConcentration: true,
  preferredGM: '',
  allowUseMacro: false,
  gmAutoFastForward: [],
})
const settings = midi.settings

/** The modifier tracker's results, as Midi reads them (patching.ts:1615, 1647-1648). Invented class. */
export class RollModifierTracker {
  constructor({ willFail = false, willSucceed = false } = {}) { this.modifiers = { willFail, willSucceed } }
}

/** GMAction.ts:410-418 */
function preferredActiveGM() {
  if (settings.preferredGM) {
    const preferred = game.users.get(settings.preferredGM)
    if (preferred?.active) return preferred
  }
  return game.users.activeGM ?? null
}

/** utils.ts:6081-6101, with the stand-in's owners for ownership. */
function playerForActor(actor) {
  if (!actor) return undefined
  const players = game.users.filter(user => !user.isGM)
  const owns = user => actor.testUserPermission?.(user, 'OWNER')
  let user
  if (actor.hasPlayerOwner) user = players.find(u => (u.character?.id === actor.id) && u.active)
  user ??= players.find(p => p.active && owns(p))
  user ??= players.find(p => p.character?.id === actor.id)
  user ??= players.find(p => owns(p))
  user ??= preferredActiveGM() ?? undefined
  return user
}

/** utils.ts:7193-7212: each handler awaited in turn. */
async function asyncHooksCallAll(name, ...args) {
  await Hooks.callAll(name, ...args)
  return true
}

/**
 * utils.ts:6800-6837: one of Midi's flags on an actor, from its effects' changes or else as set,
 * each evaluated as a condition (invented: true, a number above 0, or "true"; its evalCondition
 * isn't to be had).
 */
function evalAllConditions(actor, flag) {
  const condition = value => (value === true) || (Number(value) > 0) || (String(value).trim().toLowerCase() === 'true')
  const changes = (actor?.appliedEffects ?? []).flatMap(effect => effect.system?.changes ?? []).filter(change => change.key === flag)
  if (changes.length) return changes.some(change => condition(change.value))
  const value = foundry.utils.getProperty(actor ?? {}, flag)
  return (value === undefined) ? false : condition(value)
}

/** utils.ts:6630-6660, as far as these use it. */
function createConditionData({ actor, workflow } = {}) {
  return { actor: actor?.getRollData?.() ?? {}, workflow }
}

/**
 * patching.ts:1873-1949 and 2047-2064: Midi's flags on an actor for a save, and for a
 * concentration check those for concentration besides, with dnd5e's roll modes for them (invented
 * as computeAdvantageFlags isn't to be had: a "no" flag cancels the advantage the flags give).
 * Null where none applies.
 */
function flagModes(actor, rollType, ability) {
  if (!['save', 'concentration'].includes(rollType)) return null
  const save = ['all', 'save.all', `save.${ability}`]
  const kinds = { advantage: [...save, 'ability.all'], noAdvantage: [...save] }
  if (rollType === 'concentration') { kinds.advantage.push('concentration'); kinds.noAdvantage.push('concentration') }
  const on = (kind, list) => list.some(name => evalAllConditions(actor, `flags.midi-qol.${kind}.${name}`))
  const modes = [actor.system?.abilities?.[ability]?.save?.roll?.mode]
  if (rollType === 'concentration') modes.push(actor.system?.attributes?.concentration?.roll?.mode)
  const flaggedAdv = on('advantage', kinds.advantage) && !on('noAdvantage', kinds.noAdvantage)
  const flaggedDis = on('disadvantage', kinds.advantage) && !on('noDisadvantage', kinds.noAdvantage)
  if (!flaggedAdv && !flaggedDis) return null
  return { hasAdvantage: flaggedAdv || modes.some(m => Number(m) > 0), hasDisadvantage: flaggedDis || modes.some(m => Number(m) < 0) }
}

/** settings.ts:2041-2047 */
function shouldDisplaySaveDC(actor) {
  const visibility = game.settings.get('dnd5e', 'challengeVisibility')
  if (visibility === 'none') return false
  if (visibility === 'all') return true
  return !actor || actor.hasPlayerOwner
}

/* -------------------------------------------- */
/*  socketlib                                   */
/* -------------------------------------------- */

/** GMAction.ts:799-807 */
async function rollConcentration(data) {
  const actor = fromUuidSync(data.actorUuid)
  if (!actor) return {}
  return actor.rollConcentration({ target: data.target, legacy: false }, {}, { create: data.create, whisper: data.whisper, rollMode: data.rollMode })
}

/** GMAction.ts:809-1013: as Midi rolls a save on the client it's asked of. */
async function rollAbility({ saveDetails: sd, displayOptions: disp }) {
  const ability = sd.rollAbilities?.[0]
  const skill = sd.rollSkills?.[0]
  const actor = fromUuidSync(sd.actorUuid)
  if (!actor) return {}
  const midiOptions = {
    workflowId: sd.workflowId, rollAbilities: sd.rollAbilities, rollSkills: sd.rollSkills, rollTools: sd.rollTools,
    advantageByChoice: sd.advantageByChoice, recomputeAdvantage: true,
    target: (disp?.showTargetDC !== false) ? sd.rollDC : undefined,
    isMagicSave: sd.isMagicSave, saveItemUuid: sd.saveItemUuid, isConcentrationCheck: sd.isConcentrationCheck,
    workflowOptions: sd.workflowOptions, itemCardUuid: sd.itemCardUuid, advantage: sd.advantage, disadvantage: sd.disadvantage,
  }
  const config = { midiOptions, advantage: sd.advantage, disadvantage: sd.disadvantage, workflowOptions: sd.workflowOptions }
  if (ability) config.ability = ability
  if (skill) config.skill = skill
  const dialog = { configure: !(disp?.fastForward ?? false) }
  const message = { create: disp?.chatMessage ?? true, rollMode: disp?.rollMode }
  const perform = () => {
    if (sd.rollType === 'save') return actor.rollSavingThrow(config, dialog, message)
    if (sd.rollType === 'check') return actor.rollAbilityCheck(config, dialog, message)
    if (sd.rollType === 'skill') return actor.rollSkill(config, dialog, message)
    return Promise.resolve(undefined)
  }
  return new Promise(resolve => {
    let settled = false
    let timer
    const settle = result => { if (settled) return; settled = true; clearTimeout(timer); resolve(result ?? {}) }
    if (settings.playerSaveTimeout > 0) {
      timer = setTimeout(() => { dialog.configure = false; perform().then(settle, () => settle()) }, settings.playerSaveTimeout * 1000)
    }
    perform().then(settle, () => settle())
  })
}

const handlers = { rollAbility, rollConcentration }

let dialogs = 0

/**
 * GMAction.ts:984-1011 on a player's client, with its dialog: dnd5e's roll dialog opens there, an
 * application whose config is the roll's, its subject the actor and Midi's options with it
 * (roll-configuration-dialog.mjs:20-27, 416-423); closed unrolled, it gives dnd5e no rolls, so the
 * roll is none and Midi's request settles empty (:401-403, actor.mjs:1537). With Midi's Player Save
 * Timeout, Midi's timer there rolls the save without the dialog, which stays open, and posts it
 * (GMAction.ts:1006-1010). `answer()` is the player rolling in the dialog.
 */
function playerDialog(call, data, resolve) {
  const sd = data.saveDetails
  const instances = globalThis.foundry.applications.instances
  let settled = false
  let timer
  const settle = result => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    call.result = result ?? {}
    resolve(result ?? {})
  }
  const roll = () => handlers.rollAbility({ ...data, displayOptions: { ...data.displayOptions, fastForward: true } })
  const dialog = {
    id: `roll-configuration-${++dialogs}`,
    config: { subject: fromUuidSync(sd.actorUuid), midiOptions: { workflowId: sd.workflowId, rollAbilities: sd.rollAbilities } },
    closed: false,
    async close() {
      if (dialog.closed) return
      dialog.closed = true
      instances.delete(dialog.id)
      settle(null)
    },
  }
  instances.set(dialog.id, dialog)
  call.dialog = dialog
  if (settings.playerSaveTimeout > 0) {
    timer = setTimeout(async () => {
      midiSaves.dialogTimeouts.push(call)
      settle(await roll())
    }, settings.playerSaveTimeout * 1000)
  }
  call.answer = async given => {
    if (call.answered || dialog.closed) return
    call.answered = true
    dialog.closed = true
    instances.delete(dialog.id)
    const result = given ?? await roll()
    settle(result)
  }
}

/**
 * socketlib, as Midi calls it: on this client for its own user (inference: socketlib runs a call
 * to oneself here); on a player's for anyone else, which answers once the harness says so,
 * `answer()`, rolling then as that client would, or with what's given. A player's roll dialog is
 * modelled as their client has it.
 */
const socket = {
  executeAsUser(handler, userId, data) {
    if (userId === game.user.id) return handlers[handler](data)
    return new Promise(resolve => {
      const call = { handler, userId, data, answered: false }
      midiSaves.sockets.push(call)
      if ((handler === 'rollAbility') && !data.displayOptions?.fastForward) return playerDialog(call, data, resolve)
      call.answer = async given => {
        if (call.answered) return
        call.answered = true
        const result = given ?? await handlers[handler]({ ...data, displayOptions: { ...data.displayOptions, fastForward: true } })
        call.result = result
        resolve(result)
      }
      // A player's client with no dialog to show rolls at once (Workflow.ts:5992-5995).
      if (handler === 'rollAbility') void call.answer()
    })
  },
  executeAsGM(handler, data) { return handlers[handler](data) },
}

/* -------------------------------------------- */
/*  The workflow's saves                        */
/* -------------------------------------------- */

const saves = {
  /** Workflow.ts:2405-2445, from where saves are checked; then what the stand-in workflow does. */
  async WorkflowState_WaitForSaves() {
    this.saveRequests ??= {}
    this.saveTimeouts ??= {}
    this.failedSaves = new Set(this.hitTargets)
    this.saves = new Set()
    if (!this.saveActivity) return this.WorkflowState_AllRollsComplete
    if (settings.autoCheckSaves !== 'none') {
      await this.callMidiHooks('midi-qol.preCheckSaves')
      if (this.aborted) return this.WorkflowState_Abort
      const hook = Hooks.on('renderChatMessageHTML', this.processSaveRoll.bind(this))
      try {
        const saveDisplay = ((this.activity.saveDisplay ?? 'default') === 'default') ? settings.autoCheckSaves : this.activity.saveDisplay
        await this.checkSaves(saveDisplay !== 'allShow')
      } catch (err) {
        midiSaves.errors.push(err)
        console.error('midi-qol | checkSaves error', err)
      } finally {
        Hooks.off('renderChatMessageHTML', hook)
      }
      await this.callMidiHooks('midi-qol.postCheckSaves')
      if (this.aborted) return this.WorkflowState_Abort
    }
    return this.WorkflowState_AllRollsComplete
  },

  /** Workflow.ts:3418, where the roll completes: then cleanup. */
  async WorkflowState_RollFinished() {
    await this.callMidiHooks('midi-qol.RollComplete')
    return this.WorkflowState_Cleanup
  },

  /** Workflow.ts:3929-3935 */
  async callMidiHooks(...names) {
    for (const name of names) await asyncHooksCallAll(name, this)
  },

  /** Workflow.ts:5509-5598 */
  determineRollTypeAndAction() {
    let rollAction; let rollType; let flagRollType
    let rollAbilities = []; let rollSkills = []; const rollTools = []
    const activity = this.saveActivity
    if (activity?.save) {
      rollType = 'save'; flagRollType = 'save'
      rollAbilities = (activity.save.ability instanceof Set) ? Array.from(activity.save.ability) : (activity.save.ability ? [activity.save.ability] : [])
      rollAction = CONFIG.Actor.documentClass.prototype.rollSavingThrow
    } else if (activity?.check) {
      const associated = Array.from(activity.check.associated ?? [])
      if (!associated.length) {
        rollType = 'check'; flagRollType = 'check'
        if (activity.check.ability) rollAbilities = [activity.check.ability]
        rollAction = CONFIG.Actor.documentClass.prototype.rollAbilityCheck
      } else {
        const skills = associated.filter(id => !!CONFIG.DND5E.skills[id])
        if (skills.length && (skills.length === associated.length)) {
          rollType = 'skill'; flagRollType = 'skill'; rollSkills = skills
          const ability = activity.getAbility?.(skills[0]) ?? activity.check.ability ?? CONFIG.DND5E.skills[skills[0]]?.ability
          if (ability) rollAbilities = [ability]
          rollAction = CONFIG.Actor.documentClass.prototype.rollSkill
        } else {
          rollType = 'tool'; flagRollType = 'tool'; rollTools.push(...associated)
          const ability = activity.getAbility?.(associated[0]) ?? CONFIG.DND5E.tools?.[associated[0]]?.ability
          if (ability) rollAbilities = [ability]
          rollAction = CONFIG.Actor.documentClass.prototype.rollToolCheck
        }
      }
    }
    return { rollAction, rollType, rollAbilities, rollSkills, rollTools, flagRollType }
  },

  /** Workflow.ts:6266-6366, with Midi's flags read from midiSaves.advantage (invented). */
  async buildSaveDetailsForTarget(target, { rollDC, rollType, rollAbilities, rollSkills, rollTools, isMagicSave, actorDisposition }) {
    const saveDetails = {
      actorUuid: target.actor?.uuid ?? '', advantage: undefined, disadvantage: undefined, modifierTracker: undefined,
      isMagicSave: !!isMagicSave, isFriendly: target.document?.disposition === actorDisposition, isConcentrationCheck: undefined,
      rollDC: rollDC ?? 0, saveItemUuid: this.saveItem?.uuid ?? '', workflowId: this.id, itemCardUuid: this.itemCardUuid ?? '',
      workflowOptions: this.workflowOptions, rollType: rollType ?? 'save', rollAbilities, rollSkills, rollTools,
      itemId: this.saveActivity?.item?.id ?? '',
    }
    const flags = midiSaves.advantage.get(target.actor?.id) ?? {}
    const abilityId = this.saveActivity.save?.ability?.first?.() ?? [...(this.saveActivity.save?.ability ?? [])][0] ?? this.saveActivity.check?.ability ?? ''
    const own = flags[abilityId]
    // Worked out as a plain save's, a concentration check's too (6305-6316).
    const flagged = (rollType === 'save') ? flagModes(target.actor, 'save', abilityId) : null
    saveDetails.modifierTracker = own?.tracker ?? new RollModifierTracker()
    saveDetails.advantage = (flagged?.hasAdvantage || own?.hasAdvantage) ? true : own?.hasAdvantage
    saveDetails.disadvantage = (flagged?.hasDisadvantage || own?.hasDisadvantage) ? true : own?.hasDisadvantage
    saveDetails.isConcentrationCheck = this.item.flags?.['midi-qol']?.isConcentrationCheck
    if ((rollAbilities.length > 1) || (rollSkills.length > 1)) {
      const keys = (rollAbilities.length > 1) ? rollAbilities : rollSkills
      saveDetails.advantageByChoice = Object.fromEntries(keys.map(key => [key, {
        hasAdvantage: flags[key]?.hasAdvantage, hasDisadvantage: flags[key]?.hasDisadvantage,
        tracker: flags[key]?.tracker ?? new RollModifierTracker(),
      }]))
    }
    return saveDetails
  },

  /** Workflow.ts:5283-5334 */
  determineTargetRollSettings(target, flagRollType, simulate) {
    let player = playerForActor(target.actor)
    if (!player || !player.active) player = preferredActiveGM()
    let showRollDialog = !player?.isGM && ['noneDialogPublic', 'noneDialogPrivate', 'noneDialogSelf', 'noneDialogBlind'].includes(settings.playerRollSaves)
    let GMprompt; let gmMonksTB; let gmFlashTB; let gmRER
    const playerChat = !player?.isGM && settings.playerRollSaves === 'chat'
    if (player?.isGM) {
      const linked = target.document?.isLinked ?? true
      const setting = linked ? settings.rollNPCLinkedSaves : settings.rollNPCSaves
      gmMonksTB = (flagRollType !== 'tool') && midiSaves.modules.has('monks-tokenbar') && (setting === 'mtb')
      gmFlashTB = midiSaves.modules.has('flash-rolls-5e') && (setting === 'ftb')
      gmRER = midiSaves.modules.has('epic-rolls-5e') && (setting === 'rer')
      GMprompt = setting
      showRollDialog = GMprompt === 'autoDialog'
      if (simulate) { gmMonksTB = false; gmFlashTB = false; GMprompt = false; gmRER = false; showRollDialog = false }
    }
    return { player: player ?? undefined, showRollDialog, GMprompt, gmMonksTB, gmFlashTB, gmRER, playerChat }
  },

  /** Workflow.ts:6239-6241, the player's module flags. */
  computeModuleIntegrationSettings(simulate, flagRollType) {
    const on = (module, value) => !simulate && midiSaves.modules.has(module) && (settings.playerRollSaves === value)
    return {
      flags: { playerMonksTB: (flagRollType !== 'tool') && on('monks-tokenbar', 'mtb'), playerFlashTB: on('flash-rolls-5e', 'ftb'), playerEpicRolls: on('epic-rolls-5e', 'rer') },
      requests: { monks: { player: [], gm: [] }, flash: { player: [], gm: [] }, epic: { player: [], gm: [] } },
    }
  },

  /** Workflow.ts:5043-5064 */
  getFriendlyTargetRoll(saveDetails) {
    if (!saveDetails.isFriendly) return null
    const autoFail = game.i18n.localize('midi-qol.autoFailFriendly').toLowerCase()
    if (this.item.system?.description?.value?.toLowerCase().includes(autoFail) || (this.activity.friendlySave === 'friendlyFail')) {
      return new CONFIG.Dice.BasicRoll('-1').evaluate()
    }
    if (this.activity.friendlySave === 'friendlySuccess') return new CONFIG.Dice.BasicRoll('99').evaluate()
    return null
  },

  /** Workflow.ts:5820-5935 */
  createPlayerChatSaveRequest(target, player, saveDetails, rollType, rollAbilities, rollSkills, rollTools, rollDC, showRoll, GMprompt, isMagicSave, rollAction) {
    const requestId = target?.id ?? foundry.utils.randomID()
    const promise = new Promise(resolve => {
      this.saveRequests[requestId] = resolve
      if (settings.playerSaveTimeout > 0) {
        this.saveTimeouts[requestId] = setTimeout(async () => {
          if (!this.saveRequests[requestId]) return
          delete this.saveRequests[requestId]
          delete this.saveTimeouts[requestId]
          const showTargetDC = (settings.autoCheckSaves !== 'whisper') && shouldDisplaySaveDC(this.actor)
          const config = {
            target: showTargetDC ? rollDC : undefined, ability: rollAbilities[0], skill: rollSkills[0],
            midiOptions: {
              workflowId: this.id, itemCardUuid: this.itemCardUuid, advantage: saveDetails.advantage, disadvantage: saveDetails.disadvantage,
              mapKeys: false, fastForward: true, recomputeAdvantage: true, saveItemUuid: this.saveItem?.uuid,
              isConcentrationCheck: saveDetails.isConcentrationCheck, workflowOptions: saveDetails.workflowOptions,
              rollAbilities, rollSkills, rollTools, advantageByChoice: saveDetails.advantageByChoice,
            },
          }
          midiSaves.timeoutRolls = (midiSaves.timeoutRolls ?? 0) + 1
          resolve(await rollAction.bind(target.actor)(config, { ability: rollAbilities[0], skill: rollSkills[0] }, { create: showRoll }))
        }, (settings.playerSaveTimeout || 1) * 1000)
      }
    })
    // utils.ts:946-989: plain text, whispered, no flags, buttons or speaker.
    const dcText = shouldDisplaySaveDC(target.actor) ? ` DC ${rollDC}` : ''
    const requestCard = ChatMessage.create({ content: ` ${target.actor.name}${dcText} ${rollAbilities[0] ?? rollSkills[0]} ${rollType} - ${this.item.name})`, whisper: [player.id] })
    requestCard.then(card => midiSaves.requestCards.push(card))
    return { promise, requestCard }
  },

  /** Workflow.ts:5940-6001 */
  createStandardSaveRoll(target, saveDetails, whisper, showRoll, showRollDialog, simulate) {
    if ((saveDetails.rollType === 'save') && !saveDetails.rollAbilities?.length) return Promise.resolve(null)
    let owner = playerForActor(target.actor)
    if (!owner?.isGM && owner?.active) showRoll = true
    if (!owner?.active) owner = preferredActiveGM()
    owner ??= game.user
    let rollMode = ((this.activity.midiProperties?.rollMode ?? 'default') !== 'default') ? this.activity.midiProperties.rollMode : (whisper ? 'gm' : 'public')
    if (!owner.isGM && ((this.activity.midiProperties?.rollMode ?? 'default') === 'default')) {
      rollMode = { noneDialogPublic: 'public', nonePublic: 'public', noneDialogPrivate: 'gm', none: 'gm', noneDialogSelf: 'self', noneDialogBlind: 'blind' }[settings.playerRollSaves] ?? rollMode
    }
    const showTargetDC = owner.isGM || ((settings.autoCheckSaves !== 'whisper') && shouldDisplaySaveDC(this.actor))
    return socket.executeAsUser('rollAbility', owner.id, {
      saveDetails, displayOptions: { fastForward: simulate || !showRollDialog, chatMessage: showRoll, rollMode, showTargetDC },
    })
  },

  /** Workflow.ts:6007-6072, Midi's own: counted, for the harness to see whether it was asked. */
  queueTargetSaveRoll(options) {
    midiSaves.queued.push(options)
    // A request that fails, as an older Midi's could (GMAction.ts:994-999): for the harness to see
    // what's given for it.
    if (midiSaves.rejectNext) {
      midiSaves.rejectNext = false
      return { promise: Promise.reject(new Error('The roll failed')), requestCard: undefined }
    }
    const { target, saveDetails, rollInfo, isMagicSave, displayOptions, playerInfo, moduleFlags, moduleRequests } = options
    const { type: rollType, abilities: rollAbilities, skills: rollSkills, tools: rollTools, action: rollAction } = rollInfo
    const { whisper, showRoll, showRollDialog, simulate } = displayOptions
    const { player, GMprompt, playerChat } = playerInfo
    const { playerMonksTB, playerFlashTB, playerEpicRolls, gmMonksTB, gmFlashTB, gmRER } = moduleFlags
    const friendlyRoll = this.getFriendlyTargetRoll(saveDetails)
    if (friendlyRoll) return { promise: friendlyRoll, requestCard: undefined }
    const batched = (module, key, list) => {
      const promise = new Promise(resolve => { this.saveRequests[key] = resolve })
      list.push({ target, saveDetails, module, key })
      return { promise, requestCard: undefined }
    }
    if ((!player?.isGM && playerMonksTB) || (player?.isGM && gmMonksTB)) return batched('monks', target.id ?? foundry.utils.randomID(), player?.isGM ? moduleRequests.monks.gm : moduleRequests.monks.player)
    if ((!player?.isGM && playerFlashTB) || (player?.isGM && gmFlashTB)) return batched('flash', target.actor?.uuid, player?.isGM ? moduleRequests.flash.gm : moduleRequests.flash.player)
    if ((!player?.isGM && playerEpicRolls) || (player?.isGM && gmRER)) return batched('epic', target.actor?.uuid, player?.isGM ? moduleRequests.epic.gm : moduleRequests.epic.player)
    if ((player?.active && playerChat) || (player?.isGM && (GMprompt === 'none'))) {
      return this.createPlayerChatSaveRequest(target, player, saveDetails, rollType, rollAbilities, rollSkills, rollTools, saveDetails.rollDC, showRoll, GMprompt, isMagicSave, rollAction)
    }
    return { promise: this.createStandardSaveRoll(target, saveDetails, whisper, showRoll, showRollDialog, simulate), requestCard: undefined }
  },

  /** Workflow.ts:6077-6176, as far as the DC, DEX cover and the saves go. */
  async processTargetSaveResult(target, result, { rollDC, rollAbility }) {
    let total = result.reduce((sum, roll) => sum + roll.total, 0)
    const cover = (rollAbility === 'dex') ? (midiSaves.cover.get(target.id) ?? 0) : 0
    total += cover
    let resultDC = rollDC ?? 0
    if (Number.isNumeric(result[0]?.options?.target)) resultDC = result[0].options.target
    const saved = total >= resultDC
    if (saved) { this.saves.add(target); this.failedSaves.delete(target) } else { this.failedSaves.add(target); this.saves.delete(target) }
    ;(this.saveTotals ??= new Map()).set(target.id, { total, dc: resultDC, ability: rollAbility, cover })
  },

  /**
   * Workflow.ts:6405-6431: what checkSaves works out once for all its targets; null where it asks
   * none.
   */
  saveContext(whisper = false, simulate = false) {
    const allHitTargets = new Set([...this.hitTargets, ...(this.hitTargetsEC ?? [])])
    if (!this.saveActivity || !allHitTargets.size) return null
    const rollDC = this.saveActivity.save?.dc.value ?? this.saveActivity.check?.dc.value
    this.saveDC = rollDC
    const { rollAction, rollType, rollAbilities, rollSkills, rollTools, flagRollType } = this.determineRollTypeAndAction()
    if (!rollAction) return null
    if ((rollType === 'save') && !rollAbilities.length) return null
    const { flags: moduleFlags, requests: moduleRequests } = this.computeModuleIntegrationSettings(simulate, flagRollType)
    const saveDisplay = ((this.activity.saveDisplay ?? 'default') === 'default') ? settings.autoCheckSaves : this.activity.saveDisplay
    const actorDisposition = this.token?.document?.disposition ?? ((this.actor.type === 'npc') ? -1 : 1)
    return {
      allHitTargets, rollDC, rollAction, rollType, rollAbilities, rollSkills, rollTools, flagRollType, moduleFlags,
      moduleRequests, saveDisplay, isMagicSave: this.item.type === 'spell', actorDisposition, whisper, simulate,
    }
  },

  /** Workflow.ts:6437-6501: a target's save details, its roller, preTargetSave, and what's queued. */
  async targetSaveOptions(target, context) {
    const { rollDC, rollType, rollAbilities, rollSkills, rollTools, flagRollType, rollAction, isMagicSave, actorDisposition, whisper, simulate } = context
    const showRoll = !simulate && (context.saveDisplay === 'allShow')
    const saveDetails = await this.buildSaveDetailsForTarget(target, { rollDC, rollType, rollAbilities, rollSkills, rollTools, flagRollType, isMagicSave, actorDisposition })
    const { player, showRollDialog, GMprompt, gmMonksTB, gmFlashTB, gmRER, playerChat } = this.determineTargetRollSettings(target, flagRollType, simulate)
    this.saveDetails = saveDetails
    this.targetSaveDetails[target.document?.uuid ?? target.id] = saveDetails
    await asyncHooksCallAll('midi-qol.preTargetSave', target, this, saveDetails)
    return {
      target, saveDetails,
      rollInfo: { type: rollType ?? 'save', abilities: rollAbilities, skills: rollSkills, tools: rollTools, action: rollAction },
      isMagicSave, displayOptions: { whisper, showRoll, showRollDialog, simulate },
      playerInfo: { player, GMprompt: (typeof GMprompt === 'string') ? GMprompt : 'none', playerChat },
      moduleFlags: { ...context.moduleFlags, gmMonksTB: gmMonksTB ?? false, gmFlashTB: gmFlashTB ?? false, gmRER: gmRER ?? false },
      moduleRequests: context.moduleRequests,
    }
  },

  /** Workflow.ts:6395-6600 */
  async checkSaves(whisper = false, simulate = false) {
    this.targetSaveDetails = {}
    const context = this.saveContext(whisper, simulate)
    if (!context) return
    const { allHitTargets, rollDC, rollAbilities, rollType, moduleRequests } = context
    const requestCards = []
    const promises = []
    try {
      for (const target of allHitTargets) {
        if (!target?.actor) continue
        const { promise, requestCard } = this.queueTargetSaveRoll(await this.targetSaveOptions(target, context))
        if (promise) promises.push(promise)
        if (requestCard) requestCards.push(requestCard)
      }
    } catch (err) {
      midiSaves.errors.push(err)
      console.warn(err)
    }
    // Workflow.ts:6512-6524: the other modules' batches go once every target is asked.
    for (const module of ['monks', 'flash', 'epic']) {
      const { player, gm } = moduleRequests[module]
      if (player.length || gm.length) midiSaves.batches.push({ module, player, gm, workflow: this })
    }
    const rawResults = await Promise.all(promises)
    ;(await Promise.all(requestCards)).forEach(card => card?.delete())
    const results = rawResults.map(r => ((r instanceof Roll) ? [r] : (Array.isArray(r) ? r : [])))
    this.saveResults = results.flat()
    const processContext = { rollDC, rollAbility: rollAbilities[0], rollType }
    let i = 0
    for (const target of allHitTargets) {
      if (!target.actor) continue
      if (!results[i]?.[0] || (results[i][0].total === undefined)) results[i] = [await new CONFIG.Dice.D20Roll('1').evaluate()]
      const chosen = results[i][0]?.options?.midiChosenId
      if (chosen) processContext.rollAbility = chosen
      await this.processTargetSaveResult(target, results[i], processContext)
      i++
    }
    midiSaves.processed.push({ workflow: this, results })
  },

  /** Workflow.ts:6770-6799 */
  processSaveRoll(message) {
    if (!this.saveRequests) return true
    const requestId = message?.speaker?.token
    if (!requestId) return true
    if (!this.saveRequests[requestId] || (message.flags?.dnd5e?.messageType !== 'roll')) return true
    clearTimeout(this.saveTimeouts[requestId])
    const handler = this.saveRequests[requestId]
    delete this.saveRequests[requestId]
    delete this.saveTimeouts[requestId]
    handler(message.rolls[0])
    return true
  },
}

/* -------------------------------------------- */
/*  Midi's roll wrapper                         */
/* -------------------------------------------- */

/**
 * patching.ts:1514-1735, as far as a save's DC, the concentration redirect, advantage and the
 * message's speaker go. Advantage is Midi's recomputed one (invented: from midiSaves.advantage for
 * the ability or skill rolled, as before asking), or else what it's given; Midi posts the message
 * with the token for the speaker, here by naming it on the message.
 */
function doRollAbility(rollType) {
  return async function (wrapped, config = {}, dialog = {}, message = {}) {
    // patching.ts:1050-1061: the Gamemaster's dialog is skipped where Midi fast-forwards their
    // rolls of the kind, and the caller didn't say.
    if ((dialog.configure === undefined) && game.user.isGM && (settings.gmAutoFastForward ?? []).includes(rollType)) dialog.configure = false
    if (config.midiOptions?.target) config.target = config.midiOptions.target
    if (config.midiOptions?.isConcentrationCheck) {
      foundry.utils.setProperty(message, 'data.flags.midi-qol.isConcentrationCheck', true)
      config.midiOptions.isConcentrationCheck = false
      return this.rollConcentration(config, dialog, message)
    }
    const options = config.midiOptions
    // 1594-1601, 1612-1621: Midi's flags, recomputed for any roll it isn't given advantage for, a
    // concentration check's as one.
    const effective = ((rollType === 'save') && config.hookNames?.includes('concentration')) ? 'concentration' : rollType
    const ability = (effective === 'concentration') ? (this.system.attributes?.concentration?.ability || config.ability || 'con') : config.ability
    const flagged = (options?.recomputeAdvantage || !options) ? flagModes(this, effective, ability) : null
    if (flagged) {
      config.advantage = flagged.hasAdvantage || config.advantage
      config.disadvantage = flagged.hasDisadvantage || config.disadvantage
    }
    if (options) {
      const key = (rollType === 'skill') ? config.skill : config.ability
      const flags = midiSaves.advantage.get(this.id)?.[key]
      if (options.recomputeAdvantage && flags) {
        config.advantage = flags.hasAdvantage
        config.disadvantage = flags.hasDisadvantage
      } else if (!flagged) {
        if (options.advantage !== undefined) config.advantage = options.advantage
        if (options.disadvantage !== undefined) config.disadvantage = options.disadvantage
      }
      const workflow = options.workflowId ? MidiQOL.Workflow.getWorkflow(options.workflowId) : null
      const card = workflow?.chatCard?.id
      if (card) foundry.utils.setProperty(message, 'data.flags.dnd5e.originatingMessage', card)
      foundry.utils.setProperty(message, 'data.flags.midi-qol.rollMidiOptions', true)
    }
    message.data ??= {}
    message.data.speaker = ChatMessage.getSpeaker({ actor: this, token: this.token })
    const result = await wrapped(config, dialog, message)
    if (!result) return result
    const several = (options?.rollAbilities?.length > 1) || (options?.rollSkills?.length > 1)
    if (several) result.forEach(roll => { roll.options.midiChosenId = (rollType === 'skill') ? config.skill : config.ability })
    return result
  }
}

/* -------------------------------------------- */
/*  Concentration                               */
/* -------------------------------------------- */

/** patching.ts:2772-2806: Midi's own card in "chat" mode, whispered to the owners. */
async function challengeConcentration(wrapped, { dc = 10, ability = null } = {}) {
  if (settings.doConcentrationCheck === 'chatOnly') return wrapped({ dc, ability })
  if (!this.concentration.effects.size) return null
  if (settings.doConcentrationCheck !== 'chat') return undefined
  return ChatMessage.implementation.create({
    content: `<div class="dnd5e chat-card request-card" data-action="concentration" data-dc="${dc}" data-type="midi-concentration">
      <div><span class="visible-dc">DC ${dc} Concentration Roll</span></div>
      <div><span class="hidden-dc">Concentration Roll</span></div>
      </div>`,
    whisper: game.users.filter(user => user.isGM || this.testUserPermission(user, 'OWNER')).map(user => user.id),
    speaker: ChatMessage.implementation.getSpeaker({ actor: this }),
  })
}

/** utils.ts:9384-9408, on the preferred active Gamemaster's render of the card. */
async function processConcentrationRequestMessage(message, html) {
  if (settings.doConcentrationCheck !== 'chat') return
  const found = html.querySelectorAll('[data-action=concentration]')
  const rolled = foundry.utils.getProperty(message, 'flags.midi-qol.concentrationRolled')
  if (rolled || (preferredActiveGM()?.id !== game.user.id)) return
  if (found.length !== 1) return
  const { action, dc, type } = found[0].dataset
  if ((action !== 'concentration') || (type !== 'midi-concentration')) return
  const actor = game.actors.get(message.speaker?.actor)
  if (!actor) return
  await message.setFlag('midi-qol', 'concentrationRolled', true)
  const user = playerForActor(actor)
  if (user?.active) {
    midiSaves.concentrationRolls.push({ actorId: actor.id, via: 'socket', userId: user.id })
    socket.executeAsUser('rollConcentration', user.id, { actorUuid: actor.uuid, target: Number(dc), create: true, rollMode: 'gm' })
  } else {
    midiSaves.concentrationRolls.push({ actorId: actor.id, via: 'gm' })
    actor.rollConcentration({ legacy: false, target: Number(dc) }, {}, { create: true, rollMode: 'gm' })
  }
}

/** Hooks.ts:1888-1915 */
function onRollConcentration(rolls, { subject }) {
  const failed = rolls.some(roll => roll.isFailure)
  if (settings.doConcentrationCheck === 'item') return
  if (settings.removeConcentration && failed) subject.endConcentration()
}

/* -------------------------------------------- */
/*  Workflows the harness starts                */
/* -------------------------------------------- */

/**
 * A workflow at its saves, as a use by an NPC or the Gamemaster would reach them: its activity's
 * save or check at the targets' tokens, its item card posted.
 */
export async function saveWorkflow({ actor, item, activity, targets, workflowOptions = {}, token = null, card = true, cls = null }) {
  const Workflow = cls ?? MidiQOL.Workflow
  const workflow = new Workflow(actor, activity, { workflowOptions })
  workflow._item = item
  workflow._token = token
  workflow.hitTargets = new Set(targets)
  workflow.targets = new Set(targets)
  workflow.saveRequests = {}
  workflow.saveTimeouts = {}
  if (card) {
    const message = await ChatMessage.create({
      content: `<div class="midi-qol-item-card">${item.name}</div>`, speaker: ChatMessage.getSpeaker({ actor }),
      flags: { 'midi-qol': { messageType: 'attack' }, dnd5e: { messageType: 'usage', item: { id: item.id } } },
    })
    workflow.id = message.uuid
    workflow.itemCardUuid = message.uuid
    workflow.chatCard = message
  }
  Workflow.addWorkflow(workflow)
  return workflow
}

/** Run a workflow's saves through to its end, as Midi's states do. */
export async function runSaves(workflow) {
  await workflow.performState(workflow.WorkflowState_WaitForSaves, {})
  return workflow
}

/** A save activity, as dnd5e's data has it. */
export const saveActivity = ({ item, abilities, dc, id = 'save', ...rest }) => ({
  id, uuid: `${item.uuid}.Activity.${id}`, type: 'save', item, saveDisplay: 'default',
  save: { ability: new Set(abilities), dc: { value: dc } }, target: {}, ...rest,
})

/** A check activity, with the skills it checks, if any: Midi's skill check. */
export const checkActivity = ({ item, ability = '', associated = [], dc, id = 'check', ...rest }) => ({
  id, uuid: `${item.uuid}.Activity.${id}`, type: 'check', item, saveDisplay: 'default',
  check: { ability, associated: new Set(associated), dc: { value: dc } }, target: {},
  getAbility(key) { return this.check.ability || CONFIG.DND5E.skills[key]?.ability || CONFIG.DND5E.tools?.[key]?.ability || null },
  ...rest,
})

/** utils.ts:8412-8512: concentration in "item" mode, a synthetic save item's workflow at the character. */
export async function itemConcentrationCheck(actor, token, dc) {
  const item = { id: 'concentration', name: `Concentration Check: ${[...actor.concentration.items].map(i => i.name).join(', ')}`, type: 'feat', uuid: `Actor.${actor.id}.Item.concentration`, flags: { 'midi-qol': { isConcentrationCheck: true } }, system: {} }
  const activity = saveActivity({ item, abilities: [actor.system.attributes.concentration.ability ?? 'con'], dc })
  const workflow = await saveWorkflow({ actor, item, activity, targets: [token] })
  await runSaves(workflow)
  // utils.ts:8473-8480: its macro ends concentration for those failed, Midi checking saves.
  if (settings.autoCheckSaves !== 'none') for (const failed of workflow.failedSaves) await failed.actor.endConcentration()
  return workflow
}

/** utils.ts:1896-2016: what an OverTime spec says, as far as a turn save goes. */
function parseOverTime(spec, effectName) {
  const raw = Object.fromEntries((spec.includes('#') ? spec.split('#') : spec.split(',')).map(part => {
    const [key, ...value] = part.trim().split('=')
    return [key.trim(), value.join('=').trim()]
  }))
  const saveAbility = (raw.saveAbility ?? '').split('|').map(s => s.trim().toLowerCase())
  return {
    turn: (raw.turn === 'end') ? 'end' : 'start',
    label: (raw.label ?? raw.name ?? effectName).replace(/"/g, ''),
    rollType: (raw.rollType ?? (saveAbility[0] ? 'save' : 'damage')).split('|')[0].trim().toLowerCase(),
    saveAbility,
    saveDC: raw.saveDC ? Number(raw.saveDC) : -1,
  }
}

/** Effects RollComplete expires on a save, by the synthetic activity's uuid (Hooks.ts:578-635). */
const overTimeToDelete = {}

/**
 * utils.ts:2194-2295: at a turn edge, an OverTime effect's synthetic item used at its bearer's
 * token, through a normal workflow, its save, check or skill (buildRollActivityData, 2077-2103).
 */
export async function overTimeTurn(actor, token, effect, { start = true } = {}) {
  const change = effect.changes.find(c => c.key.startsWith('flags.midi-qol.OverTime'))
  const details = parseOverTime(change.value, effect.name)
  if ((details.turn === 'start') !== start) return null
  const item = { id: `ot-${effect.id}`, name: details.label, type: 'feat', uuid: `Actor.${actor.id}.Item.ot-${effect.id}`, flags: { 'midi-qol': { syntheticItem: true } }, system: {} }
  let activity
  if (details.rollType === 'save') activity = saveActivity({ item, abilities: details.saveAbility, dc: details.saveDC, id: 'overtime' })
  else if (details.rollType === 'check') activity = checkActivity({ item, ability: details.saveAbility[0], dc: details.saveDC, id: 'overtime' })
  else activity = checkActivity({ item, associated: details.saveAbility, dc: details.saveDC, id: 'overtime' })
  // Default: one save removes it (utils.ts:1980-1984).
  overTimeToDelete[activity.uuid] = { effect, actor }
  const workflow = await saveWorkflow({
    actor, item, activity, targets: [token],
    workflowOptions: { targetConfirmation: 'none', isOverTime: true, overTimeEffectUuid: effect.uuid },
  })
  await runSaves(workflow)
  return workflow
}

/** Hooks.ts:578-635: one save, with no counts, expires the effect. */
function onRollComplete(workflow) {
  const entry = overTimeToDelete[workflow.activity.uuid]
  if (!entry) return
  delete overTimeToDelete[workflow.activity.uuid]
  if (workflow.saves.size === 1) {
    entry.actor.effects = entry.actor.effects.filter(effect => effect !== entry.effect)
    midiSaves.expired.push({ actorId: entry.actor.id, effect: entry.effect.name, reason: 'midi-qol:overTime' })
  }
}

/* -------------------------------------------- */

/** Wrap a method, as Midi's libWrapper registrations do. */
function wrapMethod(target, name, wrapper) {
  const original = target[name]
  target[name] = function (...args) { return wrapper.call(this, original.bind(this), ...args) }
}

/**
 * Put Midi's saves on midi-fake's workflow and its API, its concentration on dnd5e's actors, and the
 * chat log's rendering of each message on this client. `actorClasses`: the actor prototypes to wrap
 * the rolls of, outermost first.
 */
export function installMidiSaves({ actorClasses, concentrationClass }) {
  const { Workflow } = MidiQOL
  // Midi names the roll a save request makes by the actor class's own method (Workflow.ts:5535-5587).
  CONFIG.Actor ??= {}
  CONFIG.Actor.documentClass ??= actorClasses.at(-1)
  for (const [name, fn] of Object.entries(saves)) Workflow.prototype[name] = fn
  for (const [name, get] of Object.entries({
    saveActivity() { return this._saveActivity ?? (((this.activity?.save || this.activity?.check)) ? this.activity : undefined) },
    item() { return this._item ?? this.activity?.item },
    saveItem() { return this.item },
    token() { return this._token ?? null },
    itemCardId() { return this.chatCard?.id },
    hasSave() { return !!this.saveActivity },
  })) Object.defineProperty(Workflow.prototype, name, { configurable: true, get, set(value) { this[`_${name}`] = value } })
  // Workflow.ts:8713-8744
  class DummyWorkflow extends Workflow {
    async simulateSave(targets) {
      this.hitTargets = new Set(targets)
      this.saveRequests ??= {}
      this.saveTimeouts ??= {}
      await this.checkSaves(true, true)
      return this
    }
  }
  Object.assign(MidiQOL, {
    DummyWorkflow,
    playerFor: target => playerForActor(target?.actor),
    playerForActor,
    socket: () => socket,
    evalAllConditions,
    createConditionData,
  })
  for (const cls of actorClasses) {
    for (const [method, type] of [['rollSavingThrow', 'save'], ['rollAbilityCheck', 'check'], ['rollSkill', 'skill']]) {
      if (Object.hasOwn(cls.prototype, method)) wrapMethod(cls.prototype, method, doRollAbility(type))
    }
  }
  if (concentrationClass) wrapMethod(concentrationClass.prototype, 'challengeConcentration', challengeConcentration)
  Hooks.on('dnd5e.rollConcentration', onRollConcentration)
  Hooks.on('midi-qol.RollComplete', onRollComplete)
  // The chat log renders each message as it's made (inference: as Foundry renders them).
  Hooks.on('createChatMessage', message => {
    const html = new DOMParser().parseFromString(`<div>${message.content ?? ''}</div>`, 'text/html').body.firstElementChild
    Hooks.callAll('renderChatMessageHTML', message, html, {})
  })
  Hooks.on('renderChatMessageHTML', processConcentrationRequestMessage)
  return { DummyWorkflow }
}
