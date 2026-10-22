// Where the harness finds what it loads but doesn't hold: dnd5e's two pinned releases and the module's
// own older releases. DND5E5_DIR and DND5E6_DIR point at other checkouts of dnd5e (its own layout, the
// root holding module/, lang/ and templates/); unset, they are the copies test/dnd5e.sh fetched by
// pinned SHA into the module's .cache/dnd5e (test/pins.env). The APP repository's e2e reaches this
// folder through its e2e/fvtt link, and these paths stay this checkout's.
import { fileURLToPath } from 'node:url'

const cache = name => fileURLToPath(new URL(`../../.cache/${name}`, import.meta.url))

/** dnd5e 5.3.3's root: `${DND5E5}/module/dice`, `${DND5E5}/lang/en.json`. */
export const DND5E5 = process.env.DND5E5_DIR || cache('dnd5e/release-5.3.3')
/** dnd5e 6.0.5's root. */
export const DND5E6 = process.env.DND5E6_DIR || cache('dnd5e/release-6.0.5')
/** A module release from the module's own history, as test/old-module.sh extracts it: `oldModule('0.29.0')`. */
export const oldModule = version => cache(`module-${version}`)
