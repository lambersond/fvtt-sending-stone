// A stand-in for Foundry's ApplicationV2 with HandlebarsApplicationMixin, and FormDataExtended,
// enough to draw the module's settings window (module 0.24.0) from its real templates, in jsdom,
// and use it as the Gamemaster would: open a section, type, tick, click its buttons and save.
// Import it after stub.mjs and before any of the module's scripts: settings-window.mjs reads these
// classes once, as it's first imported.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { JSDOM } from 'jsdom'
import './stub.mjs'

const MODULE = process.env.MODULE_DIR
const Handlebars = createRequire(import.meta.url)('handlebars').create()
const { window } = new JSDOM('<!doctype html><html><body></body></html>')
export const { document } = window
// jsdom lays nothing out, so it has no scrolling to do.
window.Element.prototype.scrollTo ??= function () {}

// Foundry's {{localize}}, and its templates by their path under modules/.
Handlebars.registerHelper('localize', key => game.i18n.localize(key))
const sources = new Map()
const source = path => {
  if (!sources.has(path)) sources.set(path, readFileSync(path.replace(/^modules\/sending-stone\//, `${MODULE}/`), 'utf8'))
  return sources.get(path)
}
const compiled = new Map()
const template = path => {
  if (!compiled.has(path)) compiled.set(path, Handlebars.compile(source(path)))
  return compiled.get(path)
}

// Foundry's game.modules is a Collection, which can be filtered.
game.modules.filter ??= function (fn) { return [...this.values()].filter(fn) }

/**
 * As Foundry's: the named, enabled fields of a form, flat, a checkbox as whether it's ticked, a
 * radio as the value ticked, anything else as its value.
 */
class FormDataExtended {
  constructor(form) {
    this.object = {}
    for (const field of form.elements) {
      if (!field.name || field.disabled) continue
      if (field.type === 'checkbox') this.object[field.name] = field.checked
      else if (field.type === 'radio') { if (field.checked) this.object[field.name] = field.value }
      else this.object[field.name] = field.value
    }
  }
}

/**
 * As Foundry's ApplicationV2 is drawn by HandlebarsApplicationMixin: each part from its template,
 * in the window's content, every part again on each render; _onFirstRender once, then _onRender;
 * a click on [data-action] calls that action with the app as `this`; submitting the form calls its
 * handler, closing the window after unless the handler threw, which Foundry shows as an error.
 */
class ApplicationV2 {
  constructor(options = {}) {
    this.options = { ...this.constructor.DEFAULT_OPTIONS, ...options }
    this.element = null
    this.rendered = false
    this.renders = 0
    // What the latest click or submission set off, for the harness to wait on.
    this.pending = Promise.resolve()
  }

  async render() {
    const context = await this._prepareContext({})
    const first = !this.element
    if (first) {
      const { id, tag = 'div' } = this.options
      this.element = document.createElement(tag)
      this.element.id = id
      this.element.className = 'application'
      this.element.innerHTML = '<section class="window-content"></section>'
      document.body.append(this.element)
      this.element.addEventListener('click', event => this.#onClick(event))
      this.element.addEventListener('submit', event => this.#onSubmit(event))
    }
    const content = this.element.querySelector('.window-content')
    for (const [part, { template: path, templates = [] }] of Object.entries(this.constructor.PARTS)) {
      for (const partial of templates) Handlebars.registerPartial(partial, source(partial))
      const holder = document.createElement('template')
      holder.innerHTML = template(path)(context).trim()
      const drawn = holder.content.firstElementChild
      drawn.dataset.applicationPart = part
      const before = content.querySelector(`:scope > [data-application-part="${part}"]`)
      if (before) before.replaceWith(drawn)
      else content.append(drawn)
    }
    this.renders++
    if (first) await this._onFirstRender(context, {})
    await this._onRender(context, {})
    this.rendered = true
    return this
  }

  async _prepareContext() { return {} }
  async _onFirstRender() {}
  async _onRender() {}
  _onClose() {}

  async close(options = {}) {
    this.element?.remove()
    this._onClose(options)
    this.rendered = false
    return this
  }

  #onClick(event) {
    const target = event.target.closest('[data-action]')
    const handler = target && this.options.actions?.[target.dataset.action]
    if (handler) this.pending = Promise.resolve(handler.call(this, event, target))
  }

  #onSubmit(event) {
    event.preventDefault()
    const { handler, closeOnSubmit } = this.options.form ?? {}
    this.pending = (async () => {
      try {
        await handler?.call(this, event, this.element, new FormDataExtended(this.element))
      } catch (err) {
        ui.notifications.error?.(err.message)
        throw err
      }
      if (closeOnSubmit) await this.close({ submitted: true })
    })()
  }
}

foundry.applications.api.ApplicationV2 = ApplicationV2
foundry.applications.api.HandlebarsApplicationMixin = Base => class extends Base {}
foundry.applications.ux.FormDataExtended = FormDataExtended

/* -------------------------------------------- */
/*  Using the window, as the Gamemaster would   */
/* -------------------------------------------- */

/** The settings window, opened from Configure Settings. */
export async function openSettings() {
  const { default: SettingsWindow } = await import(`${MODULE}/scripts/apps/settings-window.mjs`)
  return new SettingsWindow().render()
}

/** The one element a selector finds in the window, or a failure saying it isn't there. */
export function find(app, selector) {
  const element = app.element.querySelector(selector)
  if (!element) throw new Error(`No ${selector} in the settings window`)
  return element
}

/** Click a button, and wait for what it does. */
export async function click(app, selector) {
  const button = typeof selector === 'string' ? find(app, selector) : selector
  button.click()
  await app.pending
  return button
}

/** Open a section down the side: "general", "modules", "roster", or a campaign by its id at a tab. */
export async function view(app, section, { campaignId, tab } = {}) {
  if (section === 'campaign') {
    await click(app, `nav.sending-stone-nav [data-action="view"][data-campaign-id="${campaignId}"]`)
    if (tab) await click(app, `.sending-stone-tabs [data-tab="${tab}"]`)
  }
  else await click(app, `nav.sending-stone-nav [data-action="view"][data-section="${section}"]`)
}

/** Type into a field, as each key is pressed and as it's left. */
export function type(app, name, value) {
  const field = find(app, `[name="${name}"]`)
  field.value = value
  field.dispatchEvent(new window.Event('input', { bubbles: true }))
  field.dispatchEvent(new window.Event('change', { bubbles: true }))
  return field
}

/** Tick a checkbox, or untick it. */
export function tick(app, name, checked = true) {
  const box = find(app, `[name="${name}"]`)
  if (box.disabled) throw new Error(`${name} can't be ticked: it's disabled`)
  box.checked = checked
  box.dispatchEvent(new window.Event('change', { bubbles: true }))
  return box
}

/** Save Changes, as its button does: rejects with what the window threw, which leaves it open. */
export async function save(app) {
  await click(app, 'button[type="submit"]')
}
