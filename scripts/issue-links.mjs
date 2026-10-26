import { ISSUES, MODULE_ID } from "./constants.mjs";

/**
 * Links to the module's own issue forms on GitHub, since module 0.39.0, from the settings window and
 * the Help menu that any user may open: the bug form with this game's module, Foundry and system
 * versions filled in, as its fields are named, which saves typing them; the feature form as it is.
 * Never anything else of the world's: no campaign, title, address, secret or user.
 * @returns {{bug: string, feature: string}}
 */
export function issueLinks() {
  const bug = new URLSearchParams({ template: "bug_report.yml" });
  const version = game.modules.get(MODULE_ID)?.version;
  if ( version ) bug.set("module-version", version);
  if ( game.version ) bug.set("foundry-version", game.version);
  const system = [game.system?.title, game.system?.version].filter(Boolean).join(" ");
  if ( system ) bug.set("system-version", system);
  const feature = new URLSearchParams({ template: "feature_request.yml" });
  return { bug: `${ISSUES}?${bug}`, feature: `${ISSUES}?${feature}` };
}
