/**
 * Paying in coins, since module 0.48.0: what a character is left with when more of a coin is taken
 * away than it holds, a larger coin broken for it, the change given back, and smaller coins paying
 * where no larger one is left. One rule, read by two commands: coins taken away from a character
 * (command-coins.mjs) and a character's coins handed out (command-transfers.mjs). So it stands apart
 * from both, below them, importing nothing and writing nothing: it reads dnd5e's coins and an
 * actor's, works in whole coins on plain objects, and says what update would make it so
 * (`takenCoins`, `coinUpdate`), which the commands then write.
 *
 * Not dnd5e's own deduction (`CurrencyManager.getActorCurrencyUpdates`), which divides in floating
 * point, isn't the same in dnd5e 5 and 6, and writes the whole of a character's prepared coins, so
 * under dnd5e 6 would drop the fraction of a coin it stores.
 *
 * The rule, as `payCoins` makes it, each step a function of its own:
 *   1. Coins are paid from the largest paid to the smallest.
 *   2. Each is paid from its own coins first (`payOwn`).
 *   3. What's still owed is refused where other coins may not pay, or of a coin with no rate.
 *   4. Larger coins are broken first, the nearest first, as few as cover it (`breakLarger`).
 *   5. The change from the last one broken comes back in the fewest coins (`giveChange`), never in a
 *      coin of NEVER_CHANGE unless that's the coin paid.
 *   6. What no larger coin covers is paid in smaller coins, the largest first (`paySmaller`).
 *   7. Anything still owed is refused: the coins together are worth too little.
 */

/**
 * The coins change never comes back in, unless it's the coin being paid: electrum, which many
 * tables leave out of play.
 * @type {readonly string[]}
 */
export const NEVER_CHANGE = Object.freeze(["ep"]);

/**
 * How far from a whole number a coin's worth in another may be and still count as one: dnd5e's
 * rates are fractions, 0.1 for platinum, so 1 ÷ 0.1 isn't exactly 10.
 * @type {number}
 */
const NEARLY = 1e-6;

/**
 * A coin's rate: how many of it make one gp, as dnd5e's configuration has it.
 * @typedef {object} CoinRate
 * @property {string} key          The coin, such as "gp".
 * @property {number} conversion   How many make one gp: 0.1 for pp, 10 for sp.
 */

/**
 * dnd5e's coins that have a rate, the largest coin first: those of `CONFIG.DND5E.currencies` whose
 * `conversion` is a number above 0. A coin with none, as a world's own may have, isn't among them,
 * so it's never broken, never pays for another and never comes back as change.
 * @returns {CoinRate[]}
 */
export function coinRates() {
  return Object.entries(CONFIG.DND5E?.currencies ?? {})
    .filter(([, coin]) => Number.isFinite(coin?.conversion) && (coin.conversion > 0))
    .map(([key, coin]) => ({ key, conversion: coin.conversion }))
    .sort((a, b) => a.conversion - b.conversion);
}

/**
 * The whole coins an actor holds, of each of dnd5e's coins: the fewer of what its sheet shows and
 * what it stores, rounded down, never below none. dnd5e 6 stores a fraction of a coin and shows it
 * rounded down; a coin an effect adds to on the sheet is no more than is stored.
 * @param {Actor} actor
 * @returns {Record<string, number>}
 */
export function heldCoins(actor) {
  const number = value => (Number.isFinite(value) ? value : 0);
  return Object.fromEntries(Object.keys(CONFIG.DND5E?.currencies ?? {}).map(key => {
    const shown = number(actor?.system?.currency?.[key]);
    const stored = number(actor?._source?.system?.currency?.[key]);
    return [key, Math.max(Math.floor(Math.min(shown, stored)), 0)];
  }));
}

/**
 * A ratio as a whole number of 1 or more, or null where it isn't one, within NEARLY.
 * @param {number} ratio
 * @returns {number|null}
 */
function whole(ratio) {
  const n = Math.round(ratio);
  return ((n >= 1) && (Math.abs(ratio - n) < NEARLY)) ? n : null;
}

/**
 * Pay coins out of those held: what's left, and which of the coins held went beyond those asked
 * for; or that they're worth too little, `short`. Read alone: `held` isn't changed, and a refusal
 * leaves nothing half paid.
 *
 * `used` is the holder's own coins that went beyond those asked for: of each coin, what was held
 * less what's left less what was paid of it, where that's above none. So a platinum broken for gold
 * that was then broken again for silver is 1 pp used, never the gold, which was never held.
 * @param {Record<string, number>} held   Whole coins held, by key, as `heldCoins` reads them.
 * @param {Record<string, number>} pay    Whole coins to pay, by key, each 1 or more.
 * @param {CoinRate[]} rates              As `coinRates` has them, the largest coin first.
 * @param {object} [options]
 * @param {boolean} [options.change]      May other coins pay for a coin there are too few of? Where
 *                                        not, more of a coin than is held is refused.
 * @returns {{refusal: "short"}|{left: Record<string, number>, used: Record<string, number>}}
 */
export function payCoins(held, pay, rates, { change=true }={}) {
  const left = { ...held };
  const rateOf = key => rates.find(rate => rate.key === key)?.conversion ?? null;
  // Step 1: from the largest coin paid to the smallest; a coin with no rate first, which only its
  // own coins pay.
  const order = Object.keys(pay).sort((a, b) => (rateOf(a) ?? -1) - (rateOf(b) ?? -1));
  for ( const coin of order ) {
    let owed = payOwn(left, coin, pay[coin]);
    if ( !owed ) continue;
    const mine = rateOf(coin);
    if ( !change || (mine === null) ) return { refusal: "short" };
    const broken = breakLarger(left, owed, mine, rates);
    owed = (broken.owed < 0) ? giveChange(left, -broken.owed, coin, mine, broken.last, rates) : broken.owed;
    if ( owed > 0 ) owed = paySmaller(left, owed, mine, rates);
    if ( owed > 0 ) return { refusal: "short" };
  }
  const used = {};
  for ( const key of Object.keys(held) ) {
    const n = (held[key] ?? 0) - (left[key] ?? 0) - (pay[key] ?? 0);
    if ( n > 0 ) used[key] = n;
  }
  return { left, used };
}

/**
 * Step 2: pay a coin from its own coins, as many as there are.
 * @param {Record<string, number>} left   The coins left, which this takes from.
 * @param {string} coin
 * @param {number} n                      How many to pay.
 * @returns {number}                      How many are still owed.
 */
function payOwn(left, coin, n) {
  const own = Math.min(left[coin] ?? 0, n);
  left[coin] = (left[coin] ?? 0) - own;
  return n - own;
}

/**
 * Step 4: break larger coins for what's owed of a coin, the nearest larger coin first, of each as
 * few as cover it, or all there are. Only a coin worth a whole number of the coin paid is broken.
 * @param {Record<string, number>} left   The coins left, which this takes from.
 * @param {number} owed                   How many of the coin paid are owed.
 * @param {number} mine                   The rate of the coin paid.
 * @param {CoinRate[]} rates
 * @returns {{owed: number, last: number|null}}   What's still owed, below none where the last coin
 *                                        broken was worth more, and that coin's rate.
 */
function breakLarger(left, owed, mine, rates) {
  const larger = rates.filter(({ key, conversion }) => (conversion < mine) && whole(mine / conversion)
    && ((left[key] ?? 0) >= 1)).sort((a, b) => b.conversion - a.conversion);
  let last = null;
  for ( const { key, conversion } of larger ) {
    const worth = whole(mine / conversion);
    const count = Math.min(left[key], Math.ceil(owed / worth));
    left[key] -= count;
    owed -= count * worth;
    last = conversion;
    if ( owed <= 0 ) break;
  }
  return { owed, last };
}

/**
 * Step 5: give back the change from the last coin broken, in the fewest coins: from the largest coin
 * below the one broken down to the coin paid, never in a coin of NEVER_CHANGE unless it's the coin
 * paid, nor in one the coin paid doesn't divide evenly.
 * @param {Record<string, number>} left   The coins left, which this adds to.
 * @param {number} due                    The change due, counted in the coin paid.
 * @param {string} coin                   The coin paid.
 * @param {number} mine                   Its rate.
 * @param {number} last                   The rate of the last coin broken.
 * @param {CoinRate[]} rates
 * @returns {number}                      What's still owed: none.
 */
function giveChange(left, due, coin, mine, last, rates) {
  for ( const { key, conversion } of rates ) {
    if ( (conversion <= last) || (conversion > mine) ) continue;
    if ( (key !== coin) && NEVER_CHANGE.includes(key) ) continue;
    const worth = whole(mine / conversion);
    if ( !worth ) continue;
    const count = Math.floor(due / worth);
    left[key] = (left[key] ?? 0) + count;
    due -= count * worth;
  }
  return 0;
}

/**
 * Step 6: pay what no larger coin covers in smaller coins, the largest of them first, as many of
 * each as fit. Counted in the smallest coin with a rate, in whole numbers; a coin that isn't worth a
 * whole number of those pays nothing, and what's owed of one that isn't stays owed.
 * @param {Record<string, number>} left   The coins left, which this takes from.
 * @param {number} owed                   How many of the coin paid are owed.
 * @param {number} mine                   The rate of the coin paid.
 * @param {CoinRate[]} rates
 * @returns {number}                      What's still owed, in the smallest coin: none where paid.
 */
function paySmaller(left, owed, mine, rates) {
  const smallest = Math.max(...rates.map(rate => rate.conversion));
  const unitOf = conversion => whole(smallest / conversion);
  if ( unitOf(mine) === null ) return owed;
  let due = owed * unitOf(mine);
  for ( const { key, conversion } of rates ) {
    if ( conversion <= mine ) continue;
    const unit = unitOf(conversion);
    if ( !unit || !((left[key] ?? 0) >= 1) ) continue;
    const count = Math.min(left[key], Math.floor(due / unit));
    left[key] -= count;
    due -= count * unit;
    if ( !due ) break;
  }
  return due;
}

/* -------------------------------------------- */
/*  An actor's coins                            */
/* -------------------------------------------- */

/**
 * How an actor's coins change when so many are taken away, paid out of the whole coins it holds as
 * `payCoins` pays them, at dnd5e's rates; or that they can't be paid.
 * @param {Actor} actor
 * @param {Record<string, number>} pay   Whole coins to take away, by key, each 1 or more.
 * @param {object} [options]
 * @param {boolean} [options.change]     May its other coins pay where it's short of one?
 * @returns {{refusal: "short"}|{by: Record<string, number>, used: Record<string, number>}}
 *   `by` is by how many each coin that changes goes up, or below none, down, and `used` which of
 *   its coins went beyond those asked for, each in dnd5e's order.
 */
export function takenCoins(actor, pay, { change=true }={}) {
  const held = heldCoins(actor);
  const paid = payCoins(held, pay, coinRates(), { change });
  if ( paid.refusal ) return { refusal: paid.refusal };
  const by = {};
  for ( const [key, left] of Object.entries(paid.left) ) {
    if ( left !== (held[key] ?? 0) ) by[key] = left - (held[key] ?? 0);
  }
  return { by, used: paid.used };
}

/**
 * The update that changes an actor's coins by so many each: only those coins, each from what the
 * actor stores, one it has no key for starting at none, so the fraction of a coin dnd5e 6 stores
 * stays: 10.5 gp less 10 leaves 0.5.
 * @param {Actor} actor
 * @param {Record<string, number>} by   By how many each coin goes up, or below none, down.
 * @returns {Record<string, number>}    Each coin's path and what it's then stored as.
 */
export function coinUpdate(actor, by) {
  const stored = actor?._source?.system?.currency ?? {};
  return Object.fromEntries(Object.entries(by).map(([key, n]) => [`system.currency.${key}`, (stored[key] ?? 0) + n]));
}
