// Node loader hooks for texts.mjs: the module's sheet-links.mjs, wherever the module imports it, is
// wrapped so that a description the harness made up (a fixture, by its hash, in
// globalThis.textFixtures) is found as the fixture says, and any other hash as the real findLink
// finds it. Everything else sheet-links.mjs exports is its own, from one copy of it.

const PREFIX = 'texts-links:'

export async function resolve(specifier, context, next) {
  if (specifier.startsWith(PREFIX)) return { url: specifier, shortCircuit: true }
  const resolved = await next(specifier, context)
  if (resolved.url.endsWith('/scripts/sheet-links.mjs')) return { url: `${PREFIX}${resolved.url}`, shortCircuit: true }
  return resolved
}

export async function load(url, context, next) {
  if (!url.startsWith(PREFIX)) return next(url, context)
  const real = JSON.stringify(`${url.slice(PREFIX.length)}?real`)
  return {
    format: 'module',
    shortCircuit: true,
    source: `export * from ${real}
import { findLink as realFindLink } from ${real}
export async function findLink(actor, hash, n, options) {
  const fixture = globalThis.textFixtures?.get(hash)
  return fixture ? fixture(actor, n) : realFindLink(actor, hash, n, options)
}
`,
  }
}
