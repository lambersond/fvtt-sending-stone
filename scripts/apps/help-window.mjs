import { MODULE_ID } from "../constants.mjs";
import { issueLinks } from "../issue-links.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The module's links to its bug and feature forms on GitHub, since 0.39.0, opened from Configure
 * Settings › Sending Stone by any user: players have no Sending Stone window of their own, so this is
 * their way to them. Gamemasters have the same links at the end of the settings window's side list.
 * @extends ApplicationV2
 * @mixes HandlebarsApplication
 */
export default class HelpWindow extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @inheritDoc */
  static DEFAULT_OPTIONS = {
    id: "sending-stone-help",
    window: {
      icon: "fa-solid fa-bug",
      title: "SENDINGSTONE.Help.Title"
    },
    position: { width: 420 }
  };

  /** @override */
  static PARTS = {
    content: {
      template: `modules/${MODULE_ID}/templates/help.hbs`
    }
  };

  /** @override */
  async _prepareContext() {
    return { links: issueLinks() };
  }
}
