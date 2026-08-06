#!/usr/bin/env node
// Confirms that what GitHub serves for the current commit is byte-for-byte what is on disk.
//
// Why this exists as a script: the obvious way to read the published file is the contents API, which
// returns base64 in a `content` field. That field is EMPTY for files over 1 MiB, and the request still
// succeeds - so the check silently starts reporting that every feature is missing while the commit SHA
// matches perfectly. PrOGect.user.js crossed 1 MiB during 0.7.0 and produced exactly that false alarm.
// The raw media type has no such limit (100 MB), so this asks for raw bytes and compares them whole.
//
// Usage: node verify-release.mjs [--remote owner/repo] [--file PrOGect.user.js]

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const arg = (name, fallback) => {
    const i = process.argv.indexOf('--' + name);
    return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const file = arg('file', 'PrOGect.user.js');
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
const text = (cmd, args) => run(cmd, args).toString('utf8').trim();

const local = readFileSync(file);
const head = text('git', ['rev-parse', 'HEAD']);

// the remote repo, taken from the push target rather than assumed
const remote = arg('remote', (() => {
    const url = text('git', ['remote', 'get-url', 'origin']);
    const match = url.match(/github\.com[:/](.+?)(?:\.git)?$/);
    if (!match) throw new Error('cannot read owner/repo from origin: ' + url);
    return match[1];
})());

const fail = message => { console.error('FAIL  ' + message); process.exit(1); };

const remoteHead = text('gh', ['api', `repos/${remote}/git/ref/heads/main`, '-q', '.object.sha']);
if (remoteHead !== head) fail(`local HEAD ${head.slice(0, 8)} is not what main points at (${remoteHead.slice(0, 8)}) - push first`);

const published = run('gh', ['api', `repos/${remote}/contents/${file}?ref=${head}`, '-H', 'Accept: application/vnd.github.raw']);

if (published.length === 0) fail('GitHub returned an empty body - if this ever happens with the raw media type, the file may exceed 100 MB');
if (!published.equals(local)) {
    fail(`published file differs from local: ${published.length} bytes vs ${local.length}`);
}

const version = local.toString('utf8').match(/let pgVersion = "([^"]+)"/)?.[1] || '(no pgVersion)';
console.log(`ok    ${remote}@${head.slice(0, 8)} serves ${file} identical to disk`);
console.log(`ok    ${local.length} bytes, version ${version}`);
if (local.length > 1024 * 1024) console.log('note  over 1 MiB: the contents API returns no content field for this file, only the raw media type works');
