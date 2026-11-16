/**
 * Which generation of dnd5e the world runs: 5 or 6, by the first number of the system's version.
 *
 * Three things ask it that have nothing else in common: damage on its own (command-alone.mjs), a
 * plain roll of the dice tray (command-plain.mjs), and whether dishes are taken here
 * (dish-effects.mjs). So it's in a file of its own, a leaf importing nothing, as midi-economy.mjs
 * is: kept in any one of the three, the other two would import that file for this alone.
 */

/**
 * dnd5e's generation, as its version's first number has it: 5 for 5.3.3, 6 for 6.0.5.
 * @returns {number}
 */
export function dnd5eGeneration() {
  return Number.parseInt(String(game.system.version ?? ""));
}
