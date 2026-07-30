#!/usr/bin/env node
// Local DEV server for PrOGect. Serves PrOGect.user.js fresh from disk on
// every request AND provides a dev feedback loop so you never copy-paste console
// output or manually re-update the script again.
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ DEV ONLY — none of the injected bridge / loader / localhost traffic below   │
// │ is part of the shipped tool. The checked-in PrOGect.user.js stays clean  │
// │ (no eval, no localhost calls, no debug channel). Before submitting the tool │
// │ for toleration you install the PLAIN PrOGect.user.js the normal way and  │
// │ you do NOT ship syl-loader.user.js. See AGENTS.md.                          │
// └───────────────────────────────────────────────────────────────────────────┘
//
// What it does
//   GET  /PrOGect.user.js  -> the script, with a dev @version (file mtime),
//        dev @updateURL/@downloadURL + @connect, and a small injected "dev bridge"
//        prelude (console/error capture + window.sylDump).
//   GET  /__ver               -> current dev version string (manual freshness check).
//   POST /__log               -> append one JSON line to devlog.jsonl.
//   GET  /__log               -> dump devlog.jsonl (handy for a quick curl).
//   GET|POST /__log/clear     -> truncate devlog.jsonl.
//
// Two ways to run the script in the browser (pick one):
//   A) HOT-RELOAD (recommended): install syl-loader.user.js in Tampermonkey ONCE.
//      Then: edit PrOGect.user.js -> save -> reload the OGame tab. The loader
//      re-fetches this server every load, so the tab always runs the latest code.
//      No Tampermonkey update step, ever.
//   B) NATIVE UPDATE: install directly from http://127.0.0.1:7890/PrOGect.user.js
//      and enable "Update automatically" in the script's Tampermonkey settings.
//      Slower (waits for TM's update check), kept as a fallback.
//
// The feedback loop (no more copy-paste)
//   In the page console run e.g.  sylDump('planets', ogl.db.myPlanets)
//   or it auto-captures console.error/warn + uncaught errors. Everything lands in
//   devlog.jsonl next to this file, which the agent reads directly. GM_xmlhttpRequest
//   (extension background context) is used so localhost http from an https page is
//   fine and needs no CORS/TLS — hence @connect 127.0.0.1 on the served build/loader.

import { createServer } from 'node:http';
import { readFile, writeFile, appendFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SCRIPT_NAME = 'PrOGect.user.js';
const LEGACY_NAME = 'ProjectSyl.user.js';   // pre-rename path, still requested by an installed syl-loader
const SCRIPT_PATH = join(ROOT, SCRIPT_NAME);
const LOG_PATH = join(ROOT, 'devlog.jsonl');
const LOG_MAX = 512 * 1024; // truncate the log once it grows past this
const PORT = Number(process.argv[2]) || 7890;
const HOST = '127.0.0.1';

const VERSION_LINE = /^\/\/ @version\s+.+$/m;
const HEADER_END = /^\/\/ ==\/UserScript==$/m;

async function devVersion() {
  const stats = await stat(SCRIPT_PATH);
  // mtime -> strictly increasing, Tampermonkey-comparable, no manual bump.
  return `${stats.mtimeMs.toFixed(0)}-dev`;
}

// The injected dev bridge. Runs inside the userscript scope (has GM_xmlhttpRequest,
// unsafeWindow). Kept dependency-free and defensive so it can never break the app.
function devBridge(ver) {
  return `
/* === PrOGect DEV bridge — injected by dev-server.mjs, NOT in source, NEVER shipped === */
(function(){
  var EP = 'http://${HOST}:${PORT}';
  var DEVVER = ${JSON.stringify(ver)};
  function safe(v){ try{ return typeof v==='string' ? v : JSON.stringify(v); }catch(e){ return String(v); } }
  function post(kind,label,data){ try{ GM_xmlhttpRequest({ method:'POST', url:EP+'/__log', headers:{'Content-Type':'application/json'}, data:JSON.stringify({ t:Date.now(), ver:DEVVER, kind:kind, label:label, data:data }) }); }catch(e){} }
  var g = (typeof unsafeWindow!=='undefined') ? unsafeWindow : window;
  // manual one-liner: sylDump('label', anything) -> lands in devlog.jsonl (no copy-paste)
  g.sylDump = function(label,val){ post('dump', String(label), safe(val)); return '[sent to dev log]'; };
  g.syl = g.syl || {}; g.syl.dump = g.sylDump;
  // auto-capture: uncaught errors + console.error/warn
  window.addEventListener('error', function(e){ post('error','window.error', String(e.message)+' @'+(e.filename||'?')+':'+(e.lineno||'?')); });
  window.addEventListener('unhandledrejection', function(e){ post('error','unhandledrejection', safe(e.reason && e.reason.stack || e.reason)); });
  ['error','warn'].forEach(function(m){ var o=console[m]; console[m]=function(){ try{ post('console.'+m,'',Array.prototype.map.call(arguments,safe).join(' ')); }catch(_){} return o.apply(console,arguments); }; });
  post('boot','dev-bridge','ready');
})();
`;
}

async function buildResponseBody(selfUrl, ver) {
  const source = await readFile(SCRIPT_PATH, 'utf8');
  if (!VERSION_LINE.test(source) || !HEADER_END.test(source)) {
    throw new Error(`${SCRIPT_NAME}: malformed userscript header, cannot patch dev metadata`);
  }
  let out = source.replace(VERSION_LINE, `// @version         ${ver}`);
  // Dev-only header additions (never written to the source file on disk):
  // @connect lets GM_xmlhttpRequest reach the local dev server from the https page;
  // @updateURL/@downloadURL feed Tampermonkey's native-update fallback (path B).
  out = out.replace(
    HEADER_END,
    `// @connect         ${HOST}\n// @connect         localhost\n// @updateURL       ${selfUrl}\n// @downloadURL     ${selfUrl}\n// ==/UserScript==`,
  );
  // Inject the dev bridge right after the script's own 'use strict'; directive so
  // strict mode still applies to the app code below it.
  out = out.replace(`'use strict';`, `'use strict';\n${devBridge(ver)}`);
  return out;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 1e6) b = b.slice(0, 1e6); });
    req.on('end', () => resolve(b));
    req.on('error', () => resolve(b));
  });
}

async function appendLog(line) {
  let size = 0;
  try { size = (await stat(LOG_PATH)).size; } catch { /* no file yet */ }
  if (size > LOG_MAX) await writeFile(LOG_PATH, '');
  await appendFile(LOG_PATH, line.replace(/\r?\n/g, ' ') + '\n');
}

const server = createServer(async (req, res) => {
  const method = req.method || 'GET';
  const path = (req.url || '/').split('?')[0];
  cors(res);
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  try {
    if (path === '/__ver') {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end(await devVersion());
      return;
    }
    if (path === '/__log/clear') {
      await writeFile(LOG_PATH, '');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('cleared\n');
      return;
    }
    if (path === '/__log') {
      if (method === 'POST') {
        const body = await readBody(req);
        await appendLog(body || '{}');
        res.writeHead(204); res.end();
        return;
      }
      let dump = '';
      try { dump = await readFile(LOG_PATH, 'utf8'); } catch { /* empty */ }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(dump);
      return;
    }
    // LEGACY_NAME keeps an already-installed syl-loader working after the PrOGect rename: that loader
    // is installed once in Tampermonkey and still requests the old path, which would otherwise 404.
    if (path === '/' || path === `/${SCRIPT_NAME}` || path === `/${LEGACY_NAME}`) {
      const selfUrl = `http://${HOST}:${PORT}/${SCRIPT_NAME}`;
      const ver = await devVersion();
      const body = await buildResponseBody(selfUrl, ver);
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store, must-revalidate',
      });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found\n');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(String(err?.stack || err) + '\n');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`PrOGect dev server: http://${HOST}:${PORT}/${SCRIPT_NAME}`);
  console.log(`Hot-reload:  install syl-loader.user.js once, then just reload the OGame tab.`);
  console.log(`Dev log:     ${LOG_PATH}  (sylDump('x', val) in console, or GET /__log)`);
});
