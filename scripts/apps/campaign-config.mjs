import { MODULE_ID, SETTINGS } from "../constants.mjs";
import { getCampaigns } from "../campaigns.mjs";
import { candidateActors, playerOwners } from "../characters.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { FormDataExtended } = foundry.applications.ux;

/**
 * A Gamemaster-only dialog for setting up campaigns: each a title and the player characters in it.
 * Campaigns can be added and removed freely; nothing is saved until the form is submitted.
 * @extends ApplicationV2
 * @mixes HandlebarsApplication
 */
export default class CampaignConfig extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @inheritDoc */
  static DEFAULT_OPTIONS = {
    id: "sending-stone-campaigns",
    tag: "form",
    window: {
      contentClasses: ["standard-form"],
      icon: "fa-solid fa-flag",
      title: "SENDINGSTONE.Campaigns.Title",
      resizable: true
    },
    position: { width: 600 },
    form: {
      closeOnSubmit: true,
      handler: CampaignConfig.#onSubmit
    },
    actions: {
      addCampaign: CampaignConfig.#onAddCampaign,
      removeCampaign: CampaignConfig.#onRemoveCampaign
    }
  };

  /** @override */
  static PARTS = {
    campaigns: {
      template: `modules/${MODULE_ID}/templates/campaign-config.hbs`,
      scrollable: [".sending-stone-campaign-list"]
    },
    footer: {
      template: "templates/generic/form-footer.hbs"
    }
  };

  /**
   * The campaigns as being edited.
   * @type {{id: string, title: string, characters: Set<string>}[]}
   */
  #campaigns = getCampaigns();

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(_options = {}) {
    const none = game.i18n.localize("SENDINGSTONE.Campaigns.NoOwner");
    const actors = candidateActors().map(actor => ({
      id: actor.id,
      name: actor.name,
      img: actor.img,
      owners: playerOwners(actor).map(user => user.name).join(", ") || none
    }));
    return {
      campaigns: this.#campaigns.map((campaign, index) => ({
        index,
        id: campaign.id,
        title: campaign.title,
        legend: campaign.title || game.i18n.localize("SENDINGSTONE.Campaigns.Untitled"),
        characters: actors.map(actor => ({ ...actor, checked: campaign.characters.has(actor.id) }))
      })),
      hasCharacters: actors.length > 0,
      buttons: [
        {
          type: "button",
          action: "addCampaign",
          icon: "fa-solid fa-plus",
          label: "SENDINGSTONE.Campaigns.Add"
        },
        {
          type: "submit",
          icon: "fa-solid fa-floppy-disk",
          label: "SENDINGSTONE.Campaigns.Submit"
        }
      ]
    };
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /**
   * Keep what has been typed and ticked, so that re-rendering after adding or removing a campaign
   * does not lose it.
   * @returns {void}
   */
  #keepEdits() {
    this.#campaigns = CampaignConfig.#readCampaigns(new FormDataExtended(this.element).object);
  }

  /**
   * @this {CampaignConfig}
   * @returns {Promise<void>}
   */
  static async #onAddCampaign() {
    this.#keepEdits();
    this.#campaigns.push({ id: foundry.utils.randomID(), title: "", characters: new Set() });
    await this.render();
    this.element.querySelector(".sending-stone-campaign:last-of-type input[type=text]")?.focus();
  }

  /**
   * @this {CampaignConfig}
   * @param {PointerEvent} _event
   * @param {HTMLButtonElement} target   The remove button, carrying the campaign's index.
   * @returns {Promise<void>}
   */
  static async #onRemoveCampaign(_event, target) {
    this.#keepEdits();
    this.#campaigns.splice(Number(target.dataset.index), 1);
    await this.render();
  }

  /**
   * Persist the campaigns. Each field is named for its campaign's position, such as
   * campaigns.0.title, and each character checkbox for its actor, campaigns.0.characters.<id>.
   * @this {CampaignConfig}
   * @param {SubmitEvent} _event          The originating form submission event.
   * @param {HTMLFormElement} _form       The submitted form element.
   * @param {FormDataExtended} formData   Processed data for the submitted form.
   * @returns {Promise<void>}
   */
  static async #onSubmit(_event, _form, formData) {
    const campaigns = CampaignConfig.#readCampaigns(formData.object);

    // Thrown rather than notified, so that the dialog stays open with what was entered. Players
    // find a campaign by its title, so titles must be present and tell campaigns apart.
    if ( campaigns.some(campaign => !campaign.title) ) {
      throw new Error(game.i18n.localize("SENDINGSTONE.Campaigns.TitleRequired"));
    }
    const titles = new Set(campaigns.map(campaign => campaign.title.toLocaleLowerCase(game.i18n.lang)));
    if ( titles.size < campaigns.length ) throw new Error(game.i18n.localize("SENDINGSTONE.Campaigns.TitleTaken"));

    await game.settings.set(MODULE_ID, SETTINGS.CAMPAIGNS, campaigns.map(campaign => ({
      id: campaign.id,
      title: campaign.title,
      characters: Array.from(campaign.characters)
    })));
    ui.notifications.info("SENDINGSTONE.Campaigns.Saved", { localize: true });
  }

  /**
   * Read the campaigns from the form's flat data, in the order they are listed. Characters that no
   * longer exist drop out.
   * @param {object} data   Flat form data, keyed by field name.
   * @returns {{id: string, title: string, characters: Set<string>}[]}
   */
  static #readCampaigns(data) {
    const { campaigns = {} } = foundry.utils.expandObject(data);
    return Object.entries(campaigns)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, campaign]) => ({
        id: campaign.id,
        title: String(campaign.title ?? "").trim(),
        characters: new Set(Object.entries(campaign.characters ?? {})
          .filter(([id, checked]) => (checked === true) && game.actors.has(id))
          .map(([id]) => id))
      }));
  }
}
