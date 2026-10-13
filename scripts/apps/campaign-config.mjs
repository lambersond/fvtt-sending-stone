import { EVENTS, MODULE_ID, SETTINGS, STATUS_HOOK } from "../constants.mjs";
import { getCampaigns } from "../campaigns.mjs";
import { candidateActors, playerOwners } from "../characters.mjs";
import { attacksUnavailable } from "../command-uses.mjs";
import { getDestination, getSecret, isMixedContent, parseDestination } from "../config.mjs";
import { campaignStatus, describeProblem } from "../delivery-status.mjs";
import { diceStatus } from "../dice-plan.mjs";
import { buildEnvelope, deliver, DeliveryError } from "../transport.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { FormDataExtended } = foundry.applications.ux;

/**
 * A Gamemaster-only dialog for where events go and the campaigns they go to: the Sending Stone
 * app's address, and each campaign's title, secret and player characters, whether its players'
 * rolls, attacks and spells in the app are made here, and whether they're asked there for the saving
 * throws the game asks of them. A campaign's connection can be tested as typed, and each saved
 * campaign says how its posts and fetches are going, as they go, from this page load.
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
    position: { width: 640 },
    form: {
      closeOnSubmit: true,
      handler: CampaignConfig.#onSubmit
    },
    actions: {
      addCampaign: CampaignConfig.#onAddCampaign,
      removeCampaign: CampaignConfig.#onRemoveCampaign,
      testCampaign: CampaignConfig.#onTestCampaign
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
   * The Sending Stone app's address as being edited.
   * @type {string}
   */
  #destination = String(game.settings.get(MODULE_ID, SETTINGS.DESTINATION) ?? "");

  /**
   * The campaigns as being edited, each with the secret this browser holds for it.
   * @type {{id: string, title: string, secret: string, characters: Set<string>, rolls: boolean,
   *   attacks: boolean, prompts: boolean}[]}
   */
  #campaigns = getCampaigns().map(campaign => ({ ...campaign, secret: getSecret(campaign.id) }));

  /**
   * What each campaign's latest test found, by its id, kept for re-rendering.
   * @type {Map<string, {state: string, text: string}>}
   */
  #tests = new Map();

  /**
   * The STATUS_HOOK listener rewriting the campaigns' status while the dialog is open.
   * @type {number|null}
   */
  #statusHook = null;

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
    // Why players' rolls can't be made here, once that's known.
    const rollsUnavailable = (diceStatus.ready || (diceStatus.reason === "pending")) ? null
      : game.i18n.format("SENDINGSTONE.Campaigns.RollsUnavailable", {
        reason: game.i18n.localize(`SENDINGSTONE.Campaigns.RollsReason.${diceStatus.reason}`)
      });
    // How each saved campaign's posts and fetches are going.
    const saved = new Map(getCampaigns().map(campaign => [campaign.id, campaign]));
    // Why players' attacks and spells can't be made here, when their rolls can.
    const attacksReason = rollsUnavailable ? null : attacksUnavailable();
    const attacksUnavailableText = attacksReason && (attacksReason !== "pending")
      ? game.i18n.format("SENDINGSTONE.Campaigns.AttacksUnavailable", {
        reason: game.i18n.localize(`SENDINGSTONE.Campaigns.AttacksReason.${attacksReason}`)
      }) : null;
    return {
      destination: this.#destination,
      rollsUnavailable,
      attacksUnavailable: attacksUnavailableText,
      campaigns: this.#campaigns.map((campaign, index) => ({
        index,
        id: campaign.id,
        title: campaign.title,
        secret: campaign.secret,
        rolls: campaign.rolls,
        attacks: campaign.attacks,
        prompts: campaign.prompts,
        test: this.#tests.get(campaign.id) ?? null,
        status: saved.has(campaign.id) ? campaignStatus(saved.get(campaign.id)) : null,
        legend: campaign.title || game.i18n.localize("SENDINGSTONE.Campaigns.Untitled"),
        // The campaign's own characters first, then the rest, each by name.
        characters: actors
          .map(actor => ({ ...actor, checked: campaign.characters.has(actor.id) }))
          .sort((a, b) => Number(b.checked) - Number(a.checked))
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

  /** @inheritDoc */
  async _onFirstRender(context, options) {
    await super._onFirstRender?.(context, options);
    this.#statusHook = Hooks.on(STATUS_HOOK, () => this.#showStatus());
  }

  /** @inheritDoc */
  _onClose(options) {
    super._onClose?.(options);
    if ( this.#statusHook !== null ) Hooks.off(STATUS_HOOK, this.#statusHook);
    this.#statusHook = null;
  }

  /**
   * Rewrite each saved campaign's status as it now stands, leaving the rest of the form, and what
   * has been typed in it, as it is.
   * @returns {void}
   */
  #showStatus() {
    const saved = new Map(getCampaigns().map(campaign => [campaign.id, campaign]));
    for ( const output of this.element?.querySelectorAll("[data-campaign-status]") ?? [] ) {
      const campaign = saved.get(output.dataset.campaignStatus);
      if ( !campaign ) continue;
      output.replaceChildren(...campaignStatus(campaign).map(({ state, text }) => {
        const line = output.ownerDocument.createElement("span");
        line.dataset.state = state;
        line.textContent = text;
        return line;
      }));
    }
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
    const data = new FormDataExtended(this.element).object;
    this.#destination = String(data.destination ?? "");
    this.#campaigns = CampaignConfig.#readCampaigns(data);
  }

  /**
   * @this {CampaignConfig}
   * @returns {Promise<void>}
   */
  static async #onAddCampaign() {
    this.#keepEdits();
    this.#campaigns.push({
      id: foundry.utils.randomID(), title: "", secret: "", characters: new Set(), rolls: false, attacks: false,
      prompts: false
    });
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
   * Post a connection test for one campaign, with the address, title and secret as typed, and
   * report the outcome under the campaign, where it stays until it's tested again. The app checks
   * that the campaign is set up with it and that the secret is the campaign's.
   * @this {CampaignConfig}
   * @param {PointerEvent} event                The originating click event.
   * @param {HTMLButtonElement} target          The test button, carrying the campaign's index.
   * @returns {Promise<void>}
   */
  static async #onTestCampaign(event, target) {
    event.preventDefault();
    const index = target.dataset.index;
    const value = name => String(this.element.querySelector(`[name="${name}"]`)?.value ?? "").trim();
    const output = this.element.querySelector(`[data-test-result="${index}"]`);
    const id = value(`campaigns.${index}.id`);
    this.#tests.delete(id);
    const report = (state, text) => {
      output.dataset.state = state;
      output.textContent = text;
      if ( state !== "pending" ) this.#tests.set(id, { state, text });
    };

    const destination = value("destination");
    const parsed = parseDestination(destination);
    if ( !parsed ) return report("error", game.i18n.localize("SENDINGSTONE.Error.InvalidDestination"));
    const campaign = { id, title: value(`campaigns.${index}.title`) };
    if ( !campaign.title ) return report("error", game.i18n.localize("SENDINGSTONE.Campaigns.TitleRequired"));
    const secret = value(`campaigns.${index}.secret`);

    target.disabled = true;
    report("pending", game.i18n.localize("SENDINGSTONE.Test.Testing"));
    try {
      const data = { userId: game.user.id, name: game.user.name };
      const envelope = buildEnvelope(EVENTS.PING, data, { campaign, sequenced: false });
      const result = await deliver(envelope, { destination, secret });
      const lines = [game.i18n.format("SENDINGSTONE.Test.Ok", result)];
      // Events go as saved, which this test may not be.
      const saved = getCampaigns().find(c => c.id === id);
      if ( (parsed.origin !== getDestination()) || (saved?.title !== campaign.title) || (getSecret(id) !== secret) ) {
        lines.push(game.i18n.localize("SENDINGSTONE.Test.Unsaved"));
      }
      report("ok", lines.join(" "));
    } catch (err) {
      report("error", CampaignConfig.#describeFailure(err, parsed, campaign));
    } finally {
      target.disabled = false;
    }
  }

  /**
   * Why a connection test failed, and what to do, as the Gamemaster is told when events fail; and
   * for a request that failed outright, what usually causes it.
   * @param {unknown} err                       What the delivery threw.
   * @param {URL} parsed                        The destination tested.
   * @param {{id: string, title: string}} campaign   The campaign tested, as typed.
   * @returns {string}
   */
  static #describeFailure(err, parsed, campaign) {
    const { problem, fix } = describeProblem(err, { campaign, destination: parsed.origin });
    const lines = [`${problem} ${fix}`];
    // The browser hides why a request failed outright, so list what usually causes it.
    if ( (err instanceof DeliveryError) && (err.status === null) && ["unreachable", "timeout"].includes(err.reason) ) {
      const mixed = game.i18n.localize("SENDINGSTONE.Test.HintMixedContent");
      if ( isMixedContent(parsed) && (fix !== mixed) ) lines.push(mixed);
      lines.push(game.i18n.localize("SENDINGSTONE.Test.HintNetwork"));
    }
    return lines.join("\n");
  }

  /**
   * Persist the address and campaigns for the world, and each campaign's secret for this browser.
   * Each field is named for its campaign's position, such as campaigns.0.title, and each character
   * checkbox for its actor, campaigns.0.characters.<id>.
   * @this {CampaignConfig}
   * @param {SubmitEvent} _event          The originating form submission event.
   * @param {HTMLFormElement} _form       The submitted form element.
   * @param {FormDataExtended} formData   Processed data for the submitted form.
   * @returns {Promise<void>}
   */
  static async #onSubmit(_event, _form, formData) {
    const destination = String(formData.object.destination ?? "").trim();
    const parsed = parseDestination(destination);
    const campaigns = CampaignConfig.#readCampaigns(formData.object);

    // Thrown rather than notified, so that the dialog stays open with what was entered. Each
    // campaign is matched to the one set up in the app by its title, so titles must be present
    // and tell campaigns apart.
    if ( destination && !parsed ) throw new Error(game.i18n.localize("SENDINGSTONE.Error.InvalidDestination"));
    if ( campaigns.some(campaign => !campaign.title) ) {
      throw new Error(game.i18n.localize("SENDINGSTONE.Campaigns.TitleRequired"));
    }
    const titles = new Set(campaigns.map(campaign => campaign.title.toLocaleLowerCase(game.i18n.lang)));
    if ( titles.size < campaigns.length ) throw new Error(game.i18n.localize("SENDINGSTONE.Campaigns.TitleTaken"));

    // Secrets first: the other two each tell every campaign afresh, which needs them.
    const secrets = Object.fromEntries(campaigns.filter(campaign => campaign.secret)
      .map(campaign => [campaign.id, campaign.secret]));
    await game.settings.set(MODULE_ID, SETTINGS.CAMPAIGN_SECRETS, secrets);
    await game.settings.set(MODULE_ID, SETTINGS.DESTINATION, parsed?.origin ?? "");
    await game.settings.set(MODULE_ID, SETTINGS.CAMPAIGNS, campaigns.map(campaign => ({
      id: campaign.id,
      title: campaign.title,
      characters: Array.from(campaign.characters),
      rolls: campaign.rolls,
      attacks: campaign.attacks,
      prompts: campaign.prompts
    })));
    ui.notifications.info("SENDINGSTONE.Campaigns.Saved", { localize: true });
    if ( parsed && isMixedContent(parsed) ) {
      ui.notifications.warn("SENDINGSTONE.Test.HintMixedContent", { localize: true });
    }
  }

  /**
   * Read the campaigns from the form's flat data, in the order they are listed. Characters that no
   * longer exist drop out.
   * @param {object} data   Flat form data, keyed by field name.
   * @returns {{id: string, title: string, secret: string, characters: Set<string>, rolls: boolean,
   *   attacks: boolean, prompts: boolean}[]}
   */
  static #readCampaigns(data) {
    const { campaigns = {} } = foundry.utils.expandObject(data);
    return Object.entries(campaigns)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, campaign]) => ({
        id: campaign.id,
        title: String(campaign.title ?? "").trim(),
        secret: String(campaign.secret ?? "").trim(),
        characters: new Set(Object.entries(campaign.characters ?? {})
          .filter(([id, checked]) => (checked === true) && game.actors.has(id))
          .map(([id]) => id)),
        rolls: campaign.rolls === true,
        attacks: campaign.attacks === true,
        prompts: campaign.prompts === true
      }));
  }
}
