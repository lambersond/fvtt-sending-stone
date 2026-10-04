import { EVENTS, MODULE_ID, SETTINGS, STATUS_HOOK } from "../constants.mjs";
import { eventsUrl, getDestination, getSecret, isMixedContent, parseDestination } from "../config.mjs";
import { buildEnvelope, deliver, DeliveryError, status } from "../transport.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * A Gamemaster-only dialog for the destination and shared secret, which can test the connection
 * with the values as typed, before anything is saved.
 * @extends ApplicationV2
 * @mixes HandlebarsApplication
 */
export default class ConnectionConfig extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @inheritDoc */
  static DEFAULT_OPTIONS = {
    id: "sending-stone-connection",
    tag: "form",
    window: {
      contentClasses: ["standard-form"],
      icon: "fa-solid fa-tower-broadcast",
      title: "SENDINGSTONE.Connection.Title"
    },
    position: { width: 560 },
    form: {
      closeOnSubmit: true,
      handler: ConnectionConfig.#onSubmit
    },
    actions: {
      test: ConnectionConfig.#onTest
    }
  };

  /** @override */
  static PARTS = {
    connection: {
      template: `modules/${MODULE_ID}/templates/connection-config.hbs`
    },
    footer: {
      template: "templates/generic/form-footer.hbs"
    }
  };

  /**
   * The id of this dialog's delivery status hook, while it is registered.
   * @type {number|null}
   */
  #statusHook = null;

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(_options = {}) {
    return {
      destination: getDestination(),
      endpoint: ConnectionConfig.#describeEndpoint(getDestination()),
      secret: getSecret(),
      bridge: ConnectionConfig.#describeBridge(),
      status: ConnectionConfig.#describeStatus(),
      statusState: status.state,
      buttons: [
        {
          type: "button",
          action: "test",
          icon: "fa-solid fa-satellite-dish",
          label: "SENDINGSTONE.Connection.Test"
        },
        {
          type: "submit",
          icon: "fa-solid fa-floppy-disk",
          label: "SENDINGSTONE.Connection.Submit"
        }
      ]
    };
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // Show where events will go as the destination is typed.
    const input = this.element.querySelector("[name=destination]");
    const endpoint = this.element.querySelector("[data-endpoint]");
    input?.addEventListener("input", () => {
      endpoint.textContent = ConnectionConfig.#describeEndpoint(input.value);
    });
  }

  /** @inheritDoc */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    // Updated in place rather than by re-rendering, which would discard anything typed but unsaved.
    this.#statusHook = Hooks.on(STATUS_HOOK, () => {
      const element = this.element?.querySelector("[data-delivery-status]");
      if ( !element ) return;
      element.textContent = ConnectionConfig.#describeStatus();
      element.dataset.state = status.state;
    });
  }

  /** @inheritDoc */
  _onClose(options) {
    super._onClose(options);
    if ( this.#statusHook !== null ) Hooks.off(STATUS_HOOK, this.#statusHook);
    this.#statusHook = null;
  }

  /* -------------------------------------------- */

  /**
   * Where events go for a destination as typed.
   * @param {string} destination
   * @returns {string}
   */
  static #describeEndpoint(destination) {
    const parsed = parseDestination(destination);
    if ( !parsed ) return game.i18n.localize("SENDINGSTONE.Connection.EndpointNone");
    return game.i18n.format("SENDINGSTONE.Connection.Endpoint", { url: eventsUrl(parsed) });
  }

  /**
   * Which browser events are sent from.
   * @returns {string}
   */
  static #describeBridge() {
    const gm = game.users.activeGM;
    if ( !gm ) return game.i18n.localize("SENDINGSTONE.Connection.BridgeNone");
    if ( gm.isSelf ) return game.i18n.localize("SENDINGSTONE.Connection.BridgeSelf");
    return game.i18n.format("SENDINGSTONE.Connection.BridgeOther", { name: gm.name });
  }

  /**
   * How deliveries from this browser have gone.
   * @returns {string}
   */
  static #describeStatus() {
    const time = timestamp => new Date(timestamp).toLocaleTimeString(game.i18n.lang);
    const counts = { delivered: status.delivered, dropped: status.dropped };
    switch ( status.state ) {
      case "ok":
        return game.i18n.format("SENDINGSTONE.Connection.StatusOk", { ...counts, time: time(status.lastDelivered) });
      case "error":
        return game.i18n.format("SENDINGSTONE.Connection.StatusError", {
          ...counts,
          time: time(status.lastError.at),
          error: status.lastError.message
        });
      default:
        return game.i18n.localize("SENDINGSTONE.Connection.StatusIdle");
    }
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /**
   * Read the destination and secret as currently typed.
   * @returns {{destination: string, secret: string}}
   */
  #readForm() {
    const value = name => String(this.element.querySelector(`[name="${name}"]`)?.value ?? "").trim();
    return { destination: value("destination"), secret: value("secret") };
  }

  /* -------------------------------------------- */

  /**
   * Post a ping to the destination as typed and report the outcome in the dialog.
   * @this {ConnectionConfig}
   * @param {PointerEvent} event   The originating click event.
   * @param {HTMLButtonElement} target   The test button.
   * @returns {Promise<void>}
   */
  static async #onTest(event, target) {
    event.preventDefault();
    const output = this.element.querySelector("[data-test-result]");
    const report = (state, message) => {
      output.dataset.state = state;
      output.textContent = message;
    };

    const { destination, secret } = this.#readForm();
    const parsed = parseDestination(destination);
    if ( !parsed ) return report("error", game.i18n.localize("SENDINGSTONE.Error.InvalidDestination"));

    target.disabled = true;
    report("pending", game.i18n.localize("SENDINGSTONE.Connection.Testing"));
    try {
      const envelope = buildEnvelope(EVENTS.PING, { userId: game.user.id, name: game.user.name }, { sequenced: false });
      const result = await deliver(envelope, { destination, secret });
      report("ok", game.i18n.format("SENDINGSTONE.Connection.TestOk", result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const lines = [game.i18n.format("SENDINGSTONE.Connection.TestFailed", { error: message })];

      // The browser hides why a request failed outright, so list what usually causes it.
      if ( (err instanceof DeliveryError) && (err.status === null) ) {
        if ( isMixedContent(parsed) ) lines.push(game.i18n.localize("SENDINGSTONE.Connection.HintMixedContent"));
        lines.push(game.i18n.localize("SENDINGSTONE.Connection.HintNetwork"));
      }
      else if ( [401, 403].includes(err?.status) ) {
        lines.push(game.i18n.localize("SENDINGSTONE.Connection.HintAuth"));
      }
      else if ( err?.status === 404 ) {
        lines.push(game.i18n.localize("SENDINGSTONE.Connection.HintNotSetUp"));
      }
      report("error", lines.join("\n"));
    } finally {
      target.disabled = false;
    }
  }

  /* -------------------------------------------- */

  /**
   * Persist the destination for the world and the secret for this browser. Only the destination's
   * origin is stored: the path events go to under it is fixed.
   * @this {ConnectionConfig}
   * @param {SubmitEvent} _event          The originating form submission event.
   * @param {HTMLFormElement} _form       The submitted form element.
   * @param {FormDataExtended} formData   Processed data for the submitted form.
   * @returns {Promise<void>}
   */
  static async #onSubmit(_event, _form, formData) {
    const destination = String(formData.object.destination ?? "").trim();
    const secret = String(formData.object.secret ?? "").trim();
    const parsed = parseDestination(destination);

    // Thrown rather than notified, so that the dialog stays open with what was typed.
    if ( destination && !parsed ) throw new Error(game.i18n.localize("SENDINGSTONE.Error.InvalidDestination"));

    await game.settings.set(MODULE_ID, SETTINGS.SECRET, secret);
    await game.settings.set(MODULE_ID, SETTINGS.DESTINATION, parsed?.origin ?? "");
    ui.notifications.info("SENDINGSTONE.Connection.Saved", { localize: true });

    if ( parsed && isMixedContent(parsed) ) {
      ui.notifications.warn("SENDINGSTONE.Connection.HintMixedContent", { localize: true });
    }
  }
}
