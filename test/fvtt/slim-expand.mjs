// The app's side of slim format 1, ported from the 0.22.0 contract (§4) for the harness: a slim
// sheet expanded back to the full shape. It shares nothing with the module's sheet-slim.mjs, so a
// rule broken there shows here as a sheet that doesn't come back.
const ROLLS = ['toHit', 'attackId', 'activity', 'attackModes', 'ammunition', 'save']
const DEFAULTS = {
  spell: { img: null, level: 0, school: null, components: null, materials: null, concentration: false, ritual: false, activation: null, range: null, duration: null, target: null, prepared: null, uses: null, castFrom: null, text: null },
  item: { img: null, quantity: 1, weight: null, price: null, equipped: null, attunement: null, attuned: false, uses: null, rarity: null, properties: [], identified: true, text: null },
  container: { capacity: null, contents: null },
  feature: { img: null, kind: null, requirements: null, activation: null, passive: false, uses: null, text: null },
  entry: { activation: null, activationType: null, range: null, target: null, uses: null, toHit: null, attackId: null, activity: null, attackModes: null, ammunition: null, save: null, damage: [] },
  targets: { self: false, area: false, count: null, perLevel: null, affects: null },
  part: { type: null, healing: false },
}
const GROUPS = {
  spell: ROLLS,
  item: ['activation', 'range', 'target', 'concentration', ...ROLLS],
  feature: ['range', 'target', 'concentration', ...ROLLS],
}
export const ACTION_KEYS = ['name', 'img', 'type', 'activityName', 'activation', 'activationType', 'range', 'target',
  ...ROLLS, 'damage', 'attackArea', 'rollFormula', 'check', 'consumesSlot', 'cast', 'spellId', 'forward', 'activities',
  'uses', 'level', 'castFrom', 'concentration', 'identified', 'consumable', 'enchantments', 'text']

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const list = v => Array.isArray(v) ? v : []
const copy = v => structuredClone(v)

function add(o, kind, group) {
  for (const [k, d] of Object.entries(DEFAULTS[kind])) if (!(k in o)) o[k] = copy(d)
  if (group && 'damage' in o) for (const k of GROUPS[group]) if (!(k in o)) o[k] = k === 'concentration' ? false : null
}

function nested(o, fn) {
  const a = o.activity
  if (isObject(a) && isObject(a.targets)) fn(a.targets, 'targets')
  for (const p of list(o.damage)) if (isObject(p)) fn(p, 'part')
  for (const e of list(o.activities)) if (isObject(e)) { nested(e, fn); fn(e, 'entry') }
}

function rows(sheet) {
  const out = []
  for (const s of list(sheet.spells)) for (const r of list(s.spells)) out.push([r, 'spell'])
  const inv = sheet.inventory ?? {}
  const walk = r => {
    out.push([r, 'item'], [r, 'container'])
    for (const c of list(r.contents)) c?.type === 'container' ? walk(c) : out.push([c, 'item'])
  }
  for (const s of list(inv.sections)) for (const r of list(s.items)) out.push([r, 'item'])
  for (const c of list(inv.containers)) walk(c)
  for (const s of list(sheet.features)) for (const r of list(s.features)) out.push([r, 'feature'])
  return out
}

// A slim sheet expanded: the sheet as given when it has no `slim`, null for a format it doesn't know.
export function expandSheet(raw) {
  if (!isObject(raw) || !('slim' in raw)) return raw
  if (raw.slim !== 1) return null
  const sheet = copy(raw)
  delete sheet.slim
  const fn = (o, kind) => add(o, kind)
  for (const [r, kind] of rows(sheet)) {
    add(r, kind, kind === 'container' ? null : kind)
    if (kind !== 'container') nested(r, fn)
  }
  for (const s of list(sheet.actions)) for (const a of list(s.actions)) nested(a, fn)
  for (const f of list(sheet.favorites)) if (f?.type === 'activity') nested(f, fn)
  const byId = new Map()
  for (const [r, kind] of rows(sheet)) if (kind !== 'container' && !byId.has(r.id)) byId.set(r.id, r)
  for (const s of list(sheet.actions)) {
    s.actions = list(s.actions).flatMap(a => {
      if (a.ref !== true) return [a]
      const row = byId.get(a.id)
      if (!row) return []
      const drop = new Set(Array.isArray(a.drop) ? a.drop : [])
      delete a.ref; delete a.drop
      const full = { id: a.id }
      for (const k of ACTION_KEYS) {
        if (k in a) full[k] = a[k]
        else if (k in row && !drop.has(k)) full[k] = copy(row[k])
      }
      for (const [k, v] of Object.entries(a)) if (!(k in full)) full[k] = v
      return [full]
    })
  }
  return sheet
}
