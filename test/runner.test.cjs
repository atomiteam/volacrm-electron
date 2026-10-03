const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tmpdir } = require('node:os');
const { runScript, validate } = require('../src/runner.cjs');
const windows = process.platform === 'win32';
const request = code => ({ executionPath: tmpdir(), scriptCode: code, parameters: [], shell: windows ? 'powershell' : 'sh' });
test('validation rejects invalid paths, arguments and shells', () => {
  assert.throws(() => validate({ ...request('echo hi'), executionPath: 'relative' }));
  assert.throws(() => validate({ ...request('echo hi'), parameters: ['\0'] }));
  assert.throws(() => validate({ ...request('echo hi'), shell: 'arbitrary-command' }));
});
test('streams stdout and stderr and returns exit status', async () => {
  const chunks = [];
  const code = windows ? '[Console]::Out.WriteLine("hello"); [Console]::Error.WriteLine("problem"); exit 7' : 'echo hello; echo problem >&2; exit 7';
  const result = await runScript(request(code), chunk => chunks.push(chunk));
  assert.equal(result.exitCode, 7);
  assert.match(result.stdout, /hello/); assert.match(result.stderr, /problem/);
  assert.ok(chunks.some(c => c.stream === 'stdout')); assert.ok(chunks.some(c => c.stream === 'stderr'));
});
test('arguments remain data instead of shell commands', async () => {
  const parameter = 'hello; echo INJECTED';
  const code = windows ? '[Console]::Out.WriteLine($args[0])' : 'printf "%s" "$1"';
  const result = await runScript({ ...request(code), parameters: [parameter] }, () => {});
  assert.equal(result.stdout.trim(), parameter);
});
test('timeout terminates script', async () => {
  const result = await runScript({ ...request(windows ? 'Start-Sleep -Seconds 30' : 'sleep 30'), timeoutMs: 1000 }, () => {});
  assert.equal(result.timedOut, true);
});
test('cancellation terminates script', async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 500);
  try {
    const result = await runScript(request(windows ? 'Start-Sleep -Seconds 30' : 'sleep 30'), () => {}, controller.signal);
    assert.equal(result.cancelled, true);
  } finally { clearTimeout(timer); }
});
