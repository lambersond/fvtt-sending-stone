// Node loader hooks: lets dnd5e 5.3.3's real dice classes load outside Foundry, with stand-ins
// for the roll dialogs and keybinding helpers they import. The dnd5e checkout is only read.

const STUBS = {
  'roll-configuration-dialog.mjs':
    'export default class RollConfigurationDialog { static async configure() { (globalThis.__dialogs ??= []).push("roll"); return [] } }',
  'd20-configuration-dialog.mjs':
    'export default class D20RollConfigurationDialog { static async configure() { (globalThis.__dialogs ??= []).push("d20"); return [] } }',
  'damage-configuration-dialog.mjs':
    'export default class DamageRollConfigurationDialog { static async configure() { (globalThis.__dialogs ??= []).push("damage"); return [] } }',
  'utils.mjs': 'export function areKeysPressed() { return false }',
}

export async function resolve(specifier, context, next) {
  const name = specifier.split('/').at(-1)
  if (context.parentURL?.includes('/module/dice/') && Object.hasOwn(STUBS, name)) {
    return { url: `stub:${name}`, shortCircuit: true }
  }
  return next(specifier, context)
}

export async function load(url, context, next) {
  if (url.startsWith('stub:')) {
    return { format: 'module', source: STUBS[url.slice(5)], shortCircuit: true }
  }
  return next(url, context)
}
