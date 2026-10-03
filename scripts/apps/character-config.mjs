import { MODULE_ID, SETTINGS } from "../constants.mjs";
import { connectedIds } from "../config.mjs";
import { candidateActors, playerOwners } from "../characters.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * A Gamemaster-only dialog for choosing which player characters are connected to the listener.
 * @extends ApplicationV2
 * @mixes HandlebarsApplication
 */
export default class CharacterConfig extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @inheritDoc */
  static DEFAULT_OPTIONS = {
    id: "sending-stone-characters",
    tag: "form",
    window: {
      contentClasses: ["standard-form"],
      icon: "fa-solid fa-users",
      title: "SENDINGSTONE.Characters.Title"
    },
    position: { width: 520 },
    form: {
      closeOnSubmit: true,
      handler: CharacterConfig.#onSubmit
    }
  };

  /** @override */
  static PARTS = {
    characters: {
      template: `modules/${MODULE_ID}/templates/character-config.hbs`,
      scrollable: [".sending-stone-character-list"]
    },
    footer: {
      template: "templates/generic/form-footer.hbs"
    }
  };

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(_options = {}) {
    const connected = connectedIds();
    const none = game.i18n.localize("SENDINGSTONE.Characters.NoOwner");
    return {
      characters: candidateActors().map(actor => ({
        id: actor.id,
        name: actor.name,
        img: actor.img,
        owners: playerOwners(actor).map(user => user.name).join(", ") || none,
        connected: connected.has(actor.id)
      })),
      buttons: [
        {
          type: "submit",
          icon: "fa-solid fa-floppy-disk",
          label: "SENDINGSTONE.Characters.Submit"
        }
      ]
    };
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /**
   * Persist the ticked characters. Each checkbox is named for its actor's id.
   *
   * The selection is replaced rather than merged, so a connected actor that has since been deleted
   * or is no longer a player character drops out the next time this is saved.
   * @this {CharacterConfig}
   * @param {SubmitEvent} _event          The originating form submission event.
   * @param {HTMLFormElement} _form       The submitted form element.
   * @param {FormDataExtended} formData   Processed data for the submitted form.
   * @returns {Promise<void>}
   */
  static async #onSubmit(_event, _form, formData) {
    const ids = Object.entries(formData.object)
      .filter(([id, checked]) => (checked === true) && game.actors.has(id))
      .map(([id]) => id);
    await game.settings.set(MODULE_ID, SETTINGS.CHARACTERS, ids);
    ui.notifications.info("SENDINGSTONE.Characters.Saved", { localize: true });
  }
}
