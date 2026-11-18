// The guard on the scripts' imports. The module's scripts stand in layers, bottom to top, and LAYERS
// below is the one place that says which script is in which; CLAUDE.md, at the repository's root, says
// what each layer is for. A script imports from its own layer or a lower one, and no script reaches
// itself through the scripts it imports. This reads every scripts/**/*.mjs, follows static imports
// (`import … from`, `import "…"`), re-exports (`export … from`) and dynamic imports
// (`import("…")`) alike, and exits 1, naming the script and the line, on:
//
//   - scripts that import one another in a loop, which it prints with one way round it;
//   - an import of a script in a higher layer;
//   - a script that is in no layer, or in two, and a script LAYERS lists that isn't there;
//   - an import it can't follow to one of the module's .mjs scripts: of a file that isn't there
//     or isn't an .mjs, by a path that leaves scripts/, isn't relative or is written with a
//     backslash, or an `import(` holding anything but one plain string in quotes.
//
// Each failure says what to do about it. Where there is none, this prints nothing.
//
// It reads the text, not a syntax tree, so that it needs nothing but Node, and where it can't tell
// it fails. It reads on from every `import` and `export` in a script but those let be below,
// wherever the word stands and whatever stands above it, and takes white space and comments
// between an import's words as JavaScript does. No import that Node 22 reads as one is known to be
// passed over. Four newer spellings, which Node 22 itself refuses, are not read:
// `import defer * as …`, `import source … from`, `import.defer(…)` and `import.source(…)`.
//
// And so text counts that makes no import. These fail though nothing is imported. They are the
// kinds found, by reading this beside a real parser over many thousands of files; others may
// exist. A failure on text that is no import is answered by rewording the text, as the last line
// of every failure says.
//
//   - an import written out in a comment (a line commented out, a JSDoc type's
//     `import("./x.mjs")`, an `@import` tag), in a string, a template or a regular expression, or
//     in prose (`import them from "./x.mjs"`), where the script it names is higher, closes a loop
//     or can't be followed. Not every one is read as an import: not an `import … from`, an
//     `import "…"` or an `export … from` in a string that has its own quotes escaped, nor one
//     commented out over several lines of `//` with its path below its word; an `import(` written
//     in either way fails as the next kind, unless its word is let be;
//   - the word `import` before a bracket that holds anything but one plain string, which is an
//     `import(` that can't be followed: in prose or a message (`can't import (…)`), in a regular
//     expression (`/import(ed)?/`), and as the name a method is declared by;
//   - the word where JavaScript has a property of that name, unless its dot stands directly
//     before it: after a dot on the line above (`tool.`, then `import(…)`), or after a `#`
//     (`this.#import(…)`). It is read as the two above are;
//   - the word before a quote that comes again on its line, read as an import of what stands
//     between the two: the word as the last of a longer string where another string in the same
//     quotes follows (`["no import", "no export"]`, an import of `, `), and the word before an
//     apostrophe where another follows (`the import's path isn't …`, an import of `s path isn`);
//   - the word as the last of a line comment, read with the line below where that begins with a
//     string or a bracket.
//
// Let be: the word with a quote directly before it (`["import", "export"]`,
// `'import "./x.mjs"'`), where JavaScript has no import; `import()` with nothing in it, which
// imports nothing; and a property with its dot directly before it (`tool.import(…)`).
//
// Where a failure names a script's line, it is the line, counted by line feeds, of the word its
// reading began at. That can be in a comment above the import: an import with braces, commented
// out over several lines of `//`, is read with the next import or `export … from` below it that
// has braces, where no other `}` stands between outside a comment or a string, and that one may
// then be named at the line of the word commented out.
//
//   node test/import-layers.mjs              the checkout this file is in
//   node test/import-layers.mjs <dir>        another checkout of the module, the folder holding its
//                                            scripts/ (to prove this on an older tree)
//
// `npm test` runs it before the harnesses. It is not a harness: it is not in fvtt/ nor in
// harness-all.sh, and prints no `name variables oks=N exit=C` line.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// The layers, bottom to top, and every script of the module in one of them: one script to a line, as
// a failure names the line. A new script goes in the lowest layer that holds everything it imports,
// or in a higher one if that says better what it is for; a failure says which layers are open to
// it, or which script to list first. The order inside a layer is for the reader, and means nothing
// here. Where a script's name alone wouldn't tell its layer, a comment says why it is there.
const LAYERS = [
  {
    name: 'Ground',
    files: [
      'constants.mjs',
      'config.mjs',
      'companions.mjs',             // the author's other Foundry modules, not a character's companions
      'campaigns.mjs',
      'dice-plan.mjs',
      'midi-economy.mjs',
      'issue-links.mjs',
      'dnd5e-generation.mjs',
      'bridge-role.mjs',            // which client sends, asked from far below bridge.mjs
      'command-checks.mjs',         // imports only constants.mjs; journals.mjs, below the commands, asks it
    ],
  },
  {
    name: 'The post',
    files: [
      'delivery-status.mjs',
      'transport.mjs',
    ],
  },
  {
    name: 'The game',
    files: [
      'characters.mjs',
      'typed-dice.mjs',             // who may type in a character's dice: it asks characters.mjs whose it is
      'groups.mjs',
      'results.mjs',
      'creature-health.mjs',        // how hurt a creature is, by dnd5e's rule; combat-data.mjs describes it
      'combat-data.mjs',
      'campaign-combats.mjs',
      'dish-effects.mjs',           // what a dish does to the characters it is served to
      'coin-change.mjs',            // imports nothing: the rule of paying in coins, which the coins' commands read
    ],
  },
  {
    name: 'Sheets',
    files: [
      'sheet-values.mjs',
      'sheet-slim.mjs',
      'sheet-details.mjs',
      'sheet-effects.mjs',
      'sheet-effect-dice.mjs',
      'sheet-enchant.mjs',
      'sheet-links.mjs',
      'sheet-rolls.mjs',
      'sheet-features.mjs',
      'sheet-inventory.mjs',
      'sheet-spells.mjs',
      'sheet-texts.mjs',
      'sheet-actions.mjs',
      'sheet-favorites.mjs',
      'sheet-group.mjs',
      'sheet.mjs',
      'wild-shape-effects.mjs',     // which of a form's effects come back; wild-shape.mjs writes them
      'wild-shape.mjs',             // a druid's forms, built on sheet-rolls.mjs; sheet-wild-shape.mjs reads it
      'sheet-wild-shape.mjs',
      'creatures.mjs',              // a character's companions, which creature-sync.mjs tells the app of
    ],
  },
  {
    name: 'What each app was told',
    files: [
      'journals.mjs',
      'tidy-journal.mjs',
      'creature-sync.mjs',
      'creature-initiative.mjs',    // posts nothing: sets companions after their characters, asking creatures.mjs
      'dish-card.mjs',
      'character-sync.mjs',
      'combat.mjs',
      'health-sync.mjs',            // its combatants sent again as their health changes
      'chat-data.mjs',
      'chat.mjs',
      'midi-prompts.mjs',
      'prompts.mjs',
      'heartbeat.mjs',
    ],
  },
  {
    name: 'Commands',
    files: [
      'command-links.mjs',
      'command-rolls.mjs',
      'later-dice.mjs',             // a dice ask's answer is a command, refused as command-rolls.mjs refuses one
      'foundry-settings.mjs',       // it tells why attacks can't be made here, which it asks command-rolls.mjs
      'command-dishes.mjs',
      'command-enchant.mjs',
      'command-notes.mjs',
      'command-plain.mjs',
      'command-texts.mjs',
      'command-charges.mjs',
      'command-concentration.mjs',
      'command-effects.mjs',
      'command-favorites.mjs',
      'command-hit-points.mjs',
      'command-prepare.mjs',
      'command-uses.mjs',
      'command-wildshape.mjs',
      'command-alone.mjs',
      'command-transfers.mjs',
      'command-coins.mjs',
      'command-turn.mjs',
      'commands.mjs',
    ],
  },
  {
    name: 'The bridge and the entry',
    files: [
      'wild-shape-hooks.mjs',       // Wild Shape's hooks and watch, which wait on commands.mjs's queue
      'apps/settings-window.mjs',
      'apps/help-window.mjs',
      'bridge.mjs',
      'settings.mjs',               // registers them: imports both windows and bridge.mjs; config.mjs reads them
      'module.mjs',
    ],
  },
]

const SELF = fileURLToPath(import.meta.url)
// The module to check: the checkout this file is in, or the one given.
const ROOT = resolve(process.argv[2] ?? join(dirname(SELF), '..'))
const SCRIPTS = join(ROOT, 'scripts')
// How a failure names this file and a script: from the module's root, as an editor opens them.
const GUARD = relative(join(dirname(SELF), '..'), SELF).split(sep).join('/')
const shown = file => `scripts/${file}`
const describe = layer => `layer ${layer + 1} (${LAYERS[layer].name})`

// ---- Reading a script's imports ----

// How an import is written, as text. Each of the four patterns takes the word alone, `import` or
// `export`, and looks ahead of it for the rest. So every such word in a script is read from, each
// on its own: what one reading took in is read again from the next word, and what stands above a
// word, a regular expression or a string or a comment left open, changes nothing of how it is read.
//
// Only what stands directly before a word says whether it is the word at all: WORD keeps the end of
// a longer name (`reimport`) and a property (`tool.import`) from being read as one, and after three
// dots it is no property (`...import("./a.mjs")`). Nor is it the word directly after a quote
// (`"import"`): JavaScript has no import there, where a string begins or has just ended. A name's
// letters are JavaScript's (ID), and any may be written as an escape (`\u0061`). Between an
// import's words white space and comments may stand (GAP), or nothing, as `import{a}from"./a.mjs"`
// has none. A comment is read as JavaScript reads one, to its line's end or to its `*/`. What
// braces hold is taken a piece at a time: a comment, a string or an escape whole, so that a brace
// in one doesn't close them, and anything else by the letter. And a backslash in a string takes the
// next letter with it, a line's end among them. A path may be empty (`import ""`): JavaScript reads
// that as an import, and it is refused as a path that isn't relative.
//
// A line comment can't stop short of its line's end, nor a block comment run past its first `*/`
// (one that has none runs to the script's end, once); and a piece in braces, once taken, is not
// taken another way (a look ahead finds it and a reference back takes it, as JavaScript has no
// other way to say so). So a list is cut into its pieces one way only. Time can still grow as the
// square of the text. Three ways are known, none near what a contributor writes. Every word reads
// on as far as its own comment or list runs, so thousands of them in one script that each run on
// to its end take as many passes over it. A quote in braces that nothing closes on its line is
// read to the line's end and then taken by the letter, and so is every escaped quote after it
// (`\"`): a line of them 100 KB long takes seconds. And a reading's line is counted from the
// script's top each time: some ten thousand readings in one script take seconds too.
const ID = String.raw`[\p{ID_Continue}$\u200c\u200d]`
const WORD = String.raw`(?<!${ID})(?<!(?<!\.\.)\.)(?<!["'])`
const ESCAPE = String.raw`\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]+\}`
const NAME = String.raw`(?:${ID}|${ESCAPE})+`
const ESCAPED = String.raw`\\(?:\r\n|[\s\S])`
const STRING = String.raw`"(?:${ESCAPED}|[^"\\\n\r])*"|'(?:${ESCAPED}|[^'\\\n\r])*'`
const IN_LINE = String.raw`[^\n\r\u2028\u2029]`
const COMMENT = String.raw`/\*(?:[^*]|\*(?!/))*(?:\*/|$)|//${IN_LINE}*(?!${IN_LINE})`
const GAP = String.raw`(?:\s|${COMMENT})`
const BRACES = String.raw`\{(?:(?=(?<piece>${COMMENT}|${STRING}|${ESCAPE}|[^}]))\k<piece>)*\}`
const QUOTED = String.raw`(?<quote>["'])(?<specifier>(?:${ESCAPED}|(?!\k<quote>)[^\\\n\r])*)\k<quote>`
const CLAUSE = String.raw`(?:${NAME}${GAP}*,${GAP}*)?(?:${BRACES}|\*${GAP}*as${GAP}+${NAME}|${NAME})`
const EXPORTED = String.raw`\*(?:${GAP}*as(?:${GAP}+${NAME}|${GAP}*(?:${STRING})))?|${BRACES}`
const FROM = String.raw`${GAP}*from${GAP}*${QUOTED}`
const STATIC = new RegExp(String.raw`${WORD}import(?=(?:${GAP}+|(?=[{*]))${CLAUSE}${FROM})`, 'gu')
const BARE = new RegExp(String.raw`${WORD}import(?=${GAP}*${QUOTED})`, 'gu')
const REEXPORT = new RegExp(String.raw`${WORD}export(?=${GAP}*(?:${EXPORTED})${FROM})`, 'gu')
// An `import(`, and what it holds if that is nothing, or one plain string.
const DYNAMIC = new RegExp(String.raw`${WORD}import(?=${GAP}*\((?:(?<nothing>\s*\))|${GAP}*${QUOTED}${GAP}*\))?)`, 'gu')

/**
 * Every .mjs under a directory, as paths from SCRIPTS with forward slashes, sorted.
 * @param {string} dir
 * @returns {string[]}
 */
function scriptsIn(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return scriptsIn(path)
    return entry.name.endsWith('.mjs') ? [relative(SCRIPTS, path).split(sep).join('/')] : []
  }).sort()
}

/**
 * What a script's text imports: each import as what it names, where its word stands and how it is
 * written, in the order the words stand in; and where each `import(` stands that holds something
 * other than one plain string.
 * @param {string} text
 * @returns {{found: {specifier: string, index: number, how: string}[], unfollowed: number[]}}
 */
function importsIn(text) {
  const found = []
  const unfollowed = []
  const note = (how, match) => found.push({ specifier: match.groups.specifier, index: match.index, how })
  for (const match of text.matchAll(STATIC)) note('import', match)
  for (const match of text.matchAll(BARE)) note('import', match)
  for (const match of text.matchAll(REEXPORT)) note('export … from', match)
  for (const match of text.matchAll(DYNAMIC)) {
    // `import()` with nothing in it imports nothing: a comment may say it, and a method that takes
    // nothing is declared so.
    if (match.groups.nothing !== undefined) continue
    if (match.groups.specifier !== undefined) note('import()', match)
    else unfollowed.push(match.index)
  }
  found.sort((a, b) => a.index - b.index)
  return { found, unfollowed }
}

if (!existsSync(SCRIPTS)) {
  console.error(`${SCRIPTS} isn't there: give the module's root, the folder that holds scripts/`)
  process.exit(2)
}
const files = scriptsIn(SCRIPTS)
const known = new Set(files)
/**
 * Each script, the scripts it imports, and its first import of each.
 * @type {Map<string, Map<string, {line: number, how: string}>>}
 */
const imports = new Map(files.map(file => [file, new Map()]))
// What can't be followed to a script. A Set: what is to be said twice of one line is said once.
const unread = new Set()

for (const file of files) {
  const text = readFileSync(join(SCRIPTS, file), 'utf8')
  const lineOf = index => text.slice(0, index).split('\n').length
  const { found, unfollowed } = importsIn(text)
  for (const { specifier, index, how } of found) {
    const line = lineOf(index)
    const target = posix.join(posix.dirname(file), specifier)
    const refuse = why => unread.add(`${shown(file)}:${line} imports ${specifier || 'an empty path'}${why}`)
    const ownOnly = 'a script imports only the module\'s own scripts'
    if (specifier.includes('\\')) {
      refuse(', a path written with a backslash, which this doesn\'t read as JavaScript would: write it out plainly')
    } else if (!/^\.\.?\//.test(specifier)) {
      refuse(`: ${ownOnly}, each by a relative path, which this can follow`)
    } else if (known.has(target)) {
      if (!imports.get(file).has(target)) imports.get(file).set(target, { line, how })
    } else if (target.startsWith('../')) {
      refuse(`, by a path that leaves scripts/: ${ownOnly}, each by a path that stays in scripts/`)
    } else if (existsSync(join(SCRIPTS, target))) {
      refuse(`, which is not an .mjs script: ${ownOnly}, and this reads only .mjs files, so it could see`
        + ' no loop through another')
    } else {
      refuse(', which isn\'t there: correct the path, or add the script and list it in LAYERS')
    }
  }
  for (const index of unfollowed) {
    unread.add(`${shown(file)}:${lineOf(index)} has an import( with something other than one plain string in it,`
      + ' which can\'t be followed: name the script in plain quotes. If this is prose, in a comment or a string, or a'
      + ' method\'s name, reword it, as this reads text')
  }
}

// ---- The layers: every script in one, and none listed that isn't there ----

/**
 * Each listed script and the index of its layer.
 * @type {Map<string, number>}
 */
const layerOf = new Map()
const twice = new Set()
LAYERS.forEach((layer, index) => {
  for (const file of layer.files) {
    if (layerOf.has(file)) twice.add(file)
    else layerOf.set(file, index)
  }
})
// A script listed twice is in neither layer until that is put right.
const placed = file => layerOf.has(file) && !twice.has(file)

/**
 * The lines of this file that hold a script's name in quotes, as `test/import-layers.mjs:41`: the
 * lines that list it in LAYERS, whichever quotes it is in, as nothing else here quotes one.
 * @param {string} file
 * @returns {string[]}
 */
function listedAt(file) {
  const lines = readFileSync(SELF, 'utf8').split('\n')
  const listed = line => ['\'', '"', '`'].some(quote => line.includes(quote + file + quote))
  return lines.flatMap((line, i) => listed(line) ? [`${GUARD}:${i + 1}`] : [])
}

/**
 * Where a script that is in no layer may be listed, by what it imports and what imports it.
 * @param {string} file
 * @returns {{advice: string, open: boolean}}  What to do, and whether any layer can take it as it is.
 */
function whereToList(file) {
  const imported = [...imports.get(file).keys()].filter(other => other !== file)
  const importers = files.filter(other => (other !== file) && imports.get(other).has(file))
  const lowest = Math.max(0, ...imported.filter(placed).map(other => layerOf.get(other)))
  const highest = Math.min(LAYERS.length - 1, ...importers.filter(placed).map(other => layerOf.get(other)))
  if (lowest > highest) {
    const why = `what it imports reaches ${describe(lowest)}, and a script of ${describe(highest)} imports it`
    return { open: false, advice: `no layer can take it as it is: ${why}` }
  }
  // A script with no one layer couldn't be counted above: it is in none yet, or listed twice.
  const state = other => twice.has(other) ? 'listed twice' : 'in no layer yet'
  // One this imports may yet raise its lowest layer: so that one comes first, and a loop of the
  // two before it.
  const first = imported.filter(other => !placed(other))
  if (first.length) {
    const looped = loops.some(group => group.includes(file) && first.some(other => group.includes(other)))
    const settle = first.some(other => twice.has(other)) ? 'put that right' : `list ${first.length > 1 ? 'those' : 'that'}`
    const names = first.map(other => `${other}, ${state(other)}`).join(' and ')
    return { open: true, advice: `it imports ${names}: ${looped ? 'undo the loop it is in' : settle} first, then run this again` }
  }
  const where = `add it to LAYERS in ${GUARD}, in the lowest layer that holds everything it imports, ${describe(lowest)}`
  if (lowest === highest) return { open: true, advice: `${where}: no higher one is open to it` }
  // One that imports this and has no one layer may yet lower its highest layer: until that one has
  // its layer, no higher one is offered.
  const waits = importers.filter(other => !placed(other))
  if (waits.length) {
    const names = waits.map(other => `${other}, ${state(other)}`).join(' and ')
    const which = `${names}, which import${waits.length > 1 ? '' : 's'} it`
    return { open: true, advice: `${where}. Whether a higher one is open waits on ${which}: list this one, then run this again` }
  }
  const upTo = importers.some(placed) ? `, up to ${describe(highest)}, where a script imports it` : ''
  const higher = `or in a higher one if that says better what it is for${upTo}`
  return { open: true, advice: `${where}, ${higher}. CLAUDE.md says what each layer is for` }
}

// The scripts that import one another in a loop, group by group: found here, as where to list a
// new script may wait on one, and said below.
const loops = loopsOf()
const listing = []
// A script no layer can take has an import that reaches up, whichever layer it is put in: the same advice.
let noneOpen = false
for (const file of twice) {
  const lines = listedAt(file).join(' and ')
  listing.push(`LAYERS lists ${file} twice (${lines}): a script is in one layer, so take one of them away`)
}
for (const file of layerOf.keys()) {
  if (known.has(file)) continue
  const line = listedAt(file)[0] ?? GUARD
  listing.push(`${line} lists ${file}, which is no script of the module's: take it off LAYERS, or put the file back`)
}
for (const file of files) {
  if (layerOf.has(file)) continue
  const { advice, open } = whereToList(file)
  if (!open) noneOpen = true
  listing.push(`${shown(file)} is in no layer: ${advice}`)
}

// An import may stay in its layer or go down.
const ups = []
for (const file of files.filter(placed)) {
  for (const [target, { line, how }] of imports.get(file)) {
    if (!placed(target) || (layerOf.get(target) <= layerOf.get(file))) continue
    const layers = `which is in ${describe(layerOf.get(target))}, from ${describe(layerOf.get(file))}`
    ups.push(`${shown(file)}:${line} reaches up: ${how} of ${target}, ${layers}`)
  }
}

// ---- Loops ----

/**
 * The groups of scripts that import one another in a loop, each sorted: Tarjan's strongly connected
 * components of more than one script, and any script that imports itself.
 * @returns {string[][]}
 */
function loopsOf() {
  const order = new Map()
  const low = new Map()
  const stack = []
  const onStack = new Set()
  const loops = []
  function visit(file) {
    order.set(file, order.size)
    low.set(file, order.get(file))
    stack.push(file)
    onStack.add(file)
    for (const target of imports.get(file).keys()) {
      if (!order.has(target)) {
        visit(target)
        low.set(file, Math.min(low.get(file), low.get(target)))
      } else if (onStack.has(target)) {
        low.set(file, Math.min(low.get(file), order.get(target)))
      }
    }
    if (low.get(file) !== order.get(file)) return
    const group = []
    for (;;) {
      const member = stack.pop()
      onStack.delete(member)
      group.push(member)
      if (member === file) break
    }
    if ((group.length > 1) || imports.get(file).has(file)) loops.push(group.sort())
  }
  for (const file of files) if (!order.has(file)) visit(file)
  return loops
}

/**
 * The shortest way round a loop, from one of its scripts back to itself.
 * @param {string[]} group
 * @returns {string[]}  The scripts on the way, each importing the next and the last the first.
 */
function wayRound(group) {
  const inside = new Set(group)
  let best = null
  for (const start of group) {
    // Breadth first from `start`, noting which script each was reached from, until one imports `start`.
    const from = new Map([[start, null]])
    const queue = [start]
    let last = null
    while (queue.length && (last === null)) {
      const file = queue.shift()
      for (const target of imports.get(file).keys()) {
        if (!inside.has(target)) continue
        if (target === start) { last = file; break }
        if (!from.has(target)) { from.set(target, file); queue.push(target) }
      }
    }
    if (last === null) continue
    const path = []
    for (let file = last; file !== null; file = from.get(file)) path.unshift(file)
    if (!best || (path.length < best.length)) best = path
  }
  return best ?? group
}

// ---- Saying what is wrong, and what to do about it ----

const said = []
for (const group of loops) {
  const inside = new Set(group)
  const within = file => [...imports.get(file).keys()].filter(target => inside.has(target)).length
  const count = group.reduce((sum, file) => sum + within(file), 0)
  said.push((group.length === 1)
    ? `${shown(group[0])} imports itself`
    : `${group.length} scripts import one another in a loop, through ${count} imports: ${group.join(' ')}`)
  said.push('  one way round it:')
  const path = wayRound(group)
  path.forEach((file, i) => {
    const target = path[(i + 1) % path.length]
    const { line, how } = imports.get(file).get(target)
    said.push(`    ${shown(file)}:${line}  ${how}  ${target}`)
  })
}
said.push(...ups, ...listing, ...unread)
if (loops.length || ups.length || noneOpen) {
  said.push(
    'What to do about an import that reaches up or closes a loop: move the declaration it imports down, to the',
    'importing script\'s layer or a lower one; or split the script that holds two things, and put each part in its',
    'own layer; or, as a last resort, have module.mjs hand the function down as it loads, which CLAUDE.md calls a',
    'seam. Never import back up, and never write the import as import() to slip past this.')
}
if (said.length) {
  said.push(
    'The rule: a script imports from its own layer or a lower one, and never its way back to itself, by',
    'import, export … from or import(). CLAUDE.md, at the repository\'s root, says what each layer is for.',
    'If an import named here is only written in a comment, a JSDoc type or a string, reword it there: this reads text.')
  console.error(said.join('\n'))
  process.exit(1)
}
