const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, readFile, rm, access } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { validateTilix, buildTilixLaunch, runScriptWindowsTilix } = require('../src/windows-tilix.cjs');
const request = { executionPath: '/home/sami', scriptCode: 'echo hello', parameters: [] };

test('Tilix validates Linux directories, distributions, and argument limits', () => {
  assert.equal(validateTilix(request).shell, 'bash');
  for (const directory of ['relative', 'C:\\Projects', '/tmp\0bad']) assert.throws(() => validateTilix({ ...request, executionPath: directory }));
  assert.throws(() => validateTilix({ ...request, distribution: '--help' }));
  assert.throws(() => validateTilix({ ...request, parameters: ['bad\0argument'] }));
});
test('WSL launch selects a distribution and keeps source out of command arguments', () => {
  const launch = buildTilixLaunch({ ...request, distribution: 'Ubuntu', scriptCode: 'echo hello\r\n' }, 'test-id');
  assert.deepEqual(launch.args.slice(0, 5), ['--distribution', 'Ubuntu', '--exec', '/bin/bash', '-c']);
  assert.equal(launch.script, 'echo hello\n');
  assert.ok(!launch.args.includes('echo hello\r\n'));
  assert.match(launch.args.at(-1), /terminal\.sh/);
});
test('forced Windows Tilix rejects other platforms', { skip: process.platform === 'win32' }, async () => {
  await assert.rejects(runScriptWindowsTilix(request), /only on Windows/);
});

function executeLaunch(launch, env) {
  return new Promise((resolve, reject) => {
    const start = launch.args.indexOf('--exec') + 1;
    const child = spawn(launch.args[start], launch.args.slice(start + 1), { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
    child.stdin.end(launch.script);
  });
}
test('Linux launcher preserves special arguments and cleans up after terminal completion', { skip: process.platform === 'win32' }, async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'vola-tilix-test-'));
  const id = randomUUID();
  const linuxFolder = `/tmp/volacrm-tilix-${id}`;
  try {
    const bin = path.join(folder, 'bin'); await mkdir(bin);
    await writeFile(path.join(bin, 'dbus-run-session'), '#!/bin/sh\n[ "$1" = "--" ] && shift\nexec "$@"\n', { mode: 0o700 });
    // Simulate only the Tilix boundary; the real launcher and wrapper run unchanged.
    await writeFile(path.join(bin, 'tilix'), '#!/bin/bash\nfor arg in "$@"; do\n case "$arg" in --command=*) command=${arg#--command=};; esac\ndone\n{ sleep 1; printf "\\n"; } | /bin/sh -c "$command"\n', { mode: 0o700 });
    const output = path.join(folder, 'arguments');
    const injected = path.join(folder, 'INJECTED');
    const parameters = [output, "spaces and 'quotes'", `$(touch ${injected}); echo bad`, 'line\nbreak', 'Türkçe'];
    const launch = buildTilixLaunch({ executionPath: folder, scriptCode: 'output=$1\nshift\nprintf "%s\\0" "$@" > "$output"\n', parameters }, id);
    const result = await executeLaunch(launch, { ...process.env, DISPLAY: ':fake', PATH: `${bin}:${process.env.PATH}` });
    assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /VOLA_TILIX_STARTED/);
    const actual = (await readFile(output)).toString().split('\0').slice(0, -1);
    assert.deepEqual(actual, parameters.slice(1));
    await assert.rejects(access(injected));
    await new Promise(resolve => setTimeout(resolve, 1200));
    await assert.rejects(access(linuxFolder));
  } finally { await rm(folder, { recursive: true, force: true }); await rm(linuxFolder, { recursive: true, force: true }); }
});
test('Linux launcher reports missing WSL GUI support before staging code', { skip: process.platform === 'win32' }, async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'vola-tilix-test-'));
  try {
    await writeFile(path.join(folder, 'tilix'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    const result = await executeLaunch(buildTilixLaunch(request), { ...process.env, DISPLAY: '', WAYLAND_DISPLAY: '', PATH: `${folder}:${process.env.PATH}` });
    assert.equal(result.code, 1); assert.match(result.stderr, /GUI support is unavailable/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
