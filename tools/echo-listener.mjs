#!/usr/bin/env node
/**
 * A stand-in listener for developing against Sending Stone before the real one exists.
 *
 * Prints every event it receives, and answers the browser's CORS preflight the way any listener
 * must. Needs Node 18 or later and nothing else:
 *
 *   node tools/echo-listener.mjs
 *   PORT=9000 SECRET=hunter2 node tools/echo-listener.mjs
 *
 * Then set the module's listener URL to http://localhost:8787/events (any path is accepted).
 */
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8787);
const SECRET = process.env.SECRET ?? "";
const VERBOSE = process.env.QUIET !== "1";

/** The last sequence number seen from each bridge session, to spot missed events. */
const sequences = new Map();

/** Recently seen envelope ids, to spot retried duplicates. */
const seen = new Set();

/**
 * Allow the Foundry page, whatever origin it is served from, to post here.
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 */
function allowCors(request, response) {
  response.setHeader("Access-Control-Allow-Origin", request.headers.origin ?? "*");
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Access-Control-Max-Age", "600");

  // Chromium asks before a public page may reach a private address such as localhost.
  if ( request.headers["access-control-request-private-network"] === "true" ) {
    response.setHeader("Access-Control-Allow-Private-Network", "true");
  }
}

/**
 * Print one envelope.
 * @param {object} envelope
 */
function print(envelope) {
  const { session, sequence, type, id, time } = envelope;
  const label = sequence === null ? "--" : `#${sequence}`;

  // A retry whose earlier attempt arrived but whose answer was lost. A real listener should
  // acknowledge it again and do nothing else.
  if ( seen.has(id) ) {
    console.log(`\n[${time}] ${session} ${label} ${type}  (duplicate, ignored)`);
    return;
  }
  seen.add(id);
  if ( seen.size > 1000 ) seen.delete(seen.values().next().value);

  const notes = [];
  if ( sequence !== null ) {
    const last = sequences.get(session);
    if ( (last !== undefined) && (sequence !== last + 1) ) notes.push(`gap: expected #${last + 1}`);
    sequences.set(session, sequence);
  }

  console.log(`\n[${time}] ${session} ${label} ${type}${notes.length ? `  (${notes.join(", ")})` : ""}`);
  if ( VERBOSE ) console.log(JSON.stringify(envelope.data, null, 2));
}

const server = createServer((request, response) => {
  allowCors(request, response);
  if ( request.method === "OPTIONS" ) return response.writeHead(204).end();
  if ( request.method !== "POST" ) return response.writeHead(405, { Allow: "POST, OPTIONS" }).end();
  if ( SECRET && (request.headers.authorization !== `Bearer ${SECRET}`) ) {
    console.warn("\nRejected a request with a missing or wrong secret.");
    return response.writeHead(401).end();
  }

  let body = "";
  request.setEncoding("utf8");
  request.on("data", chunk => body += chunk);
  request.on("end", () => {
    let envelope;
    try {
      envelope = JSON.parse(body);
    } catch {
      return response.writeHead(400).end();
    }
    print(envelope);
    response.writeHead(204).end();
  });
});

server.listen(PORT, () => {
  console.log(`Sending Stone echo listener on http://localhost:${PORT}/events`);
  if ( SECRET ) console.log("Requiring the shared secret from SECRET.");
});
