// Let Node exit with the module's repeating timer still set, as a browser tab would be closed.
const setInterval = globalThis.setInterval
globalThis.setInterval = (...args) => setInterval(...args).unref()
