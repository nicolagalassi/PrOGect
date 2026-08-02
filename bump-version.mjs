#!/usr/bin/env node
// Bumps PrOGect's version. The version lives in TWO places that must never drift:
//   1. the userscript header  // @version <v>   (what Tampermonkey reads)
//   2. the runtime literal    let pgVersion = "<v>"   (what the UI shows: menu entry, footer)
// This writes both and then re-reads the file to prove they match.
//
//   node bump-version.mjs 0.3.0-v13     set an explicit version
//   node bump-version.mjs patch|minor   bump the numeric part, keeping the -v13 suffix
//   node bump-version.mjs              print the current version

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = join(dirname(fileURLToPath(import.meta.url)), 'PrOGect.user.js');
const HEADER = /^(\/\/ @version\s+)(\S+)\s*$/m;
const LITERAL = /^(let pgVersion = ")([^"]+)(")/m;

const src = await readFile(FILE, 'utf8');
const header = src.match(HEADER);
const literal = src.match(LITERAL);
if (!header || !literal) {
  console.error('cannot find both version sites in PrOGect.user.js - aborting rather than half-writing');
  process.exit(1);
}
if (header[2] !== literal[2]) {
  console.error(`the two version sites already disagree: header=${header[2]} literal=${literal[2]}`);
  console.error('pass an explicit version to reconcile them.');
}

const arg = process.argv[2];
if (!arg) {
  console.log(`current: ${header[2]}${header[2] === literal[2] ? '' : `  (literal: ${literal[2]} - OUT OF SYNC)`}`);
  process.exit(0);
}

let next = arg;
if (arg === 'patch' || arg === 'minor' || arg === 'major') {
  const m = header[2].match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!m) {
    console.error(`cannot ${arg}-bump "${header[2]}": expected MAJOR.MINOR.PATCH[-suffix]`);
    process.exit(1);
  }
  let [, MA, MI, PA, suffix] = m;
  if (arg === 'major') { MA = +MA + 1; MI = 0; PA = 0; }
  else if (arg === 'minor') { MI = +MI + 1; PA = 0; }
  else PA = +PA + 1;
  next = `${MA}.${MI}.${PA}${suffix}`;
}

const out = src.replace(HEADER, `$1${next}`).replace(LITERAL, `$1${next}$3`);
await writeFile(FILE, out);

// prove it: re-read from disk, never trust the in-memory string
const check = await readFile(FILE, 'utf8');
const h = check.match(HEADER)?.[2];
const l = check.match(LITERAL)?.[2];
if (h !== next || l !== next) {
  console.error(`write did not take: header=${h} literal=${l} expected=${next}`);
  process.exit(1);
}

// A stray backtick inside a GM_addStyle(`...`) block silently ENDS the CSS template literal: every
// rule after it vanishes while the file still parses, so `node --check` stays green and the breakage
// only shows up in the browser as unstyled UI. It has bitten this project twice, both times from a
// comment quoting a CSS declaration in backticks. Cheap to detect, so check it on every release.
const cssBlocks = [...check.matchAll(/GM_addStyle\(\s*`/g)];
let openBlocks = 0;
for (const m of cssBlocks) {
  let i = m.index + m[0].length;
  while (i < check.length) {
    if (check[i] === '\\') { i += 2; continue; }
    if (check[i] === '`') break;
    i++;
  }
  if (i >= check.length) openBlocks++;
}
if (openBlocks) {
  console.error(`${openBlocks} GM_addStyle block(s) never close - a stray backtick is truncating the CSS.`);
  process.exit(1);
}
console.log(`css: ${cssBlocks.length} GM_addStyle blocks, all closed`);
console.log(`${header[2]} -> ${next}  (header + pgVersion both updated)`);
console.log('next: add a CHANGELOG.md entry, then commit and push.');
