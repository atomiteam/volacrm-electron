const { spawn } = require('node:child_process');
const { mkdtemp, writeFile, rm, stat } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');

function validate(input) {
  if (!input || typeof input !== 'object') throw new Error('Script request is required.');
  const { executionPath, scriptCode, parameters = [], shell = process.platform === 'win32' ? 'powershell' : 'bash', timeoutMs = 120000 } = input;
  if (typeof executionPath !== 'string' || !path.isAbsolute(executionPath)) throw new Error('executionPath must be an absolute working directory.');
  if (typeof scriptCode !== 'string' || !scriptCode.trim() || Buffer.byteLength(scriptCode) > 262144 || scriptCode.includes('\0')) throw new Error('Provide script code up to 256 KB without null characters.');
  if (!Array.isArray(parameters) || parameters.length > 100 || parameters.some(p => typeof p !== 'string' || p.length > 8192 || p.includes('\0'))) throw new Error('parameters must be an array of up to 100 strings.');
  if (!['powershell', 'pwsh', 'bash', 'sh'].includes(shell)) throw new Error('Unsupported shell.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) throw new Error('Timeout must be between 1 and 600 seconds.');
  return { executionPath, scriptCode, parameters, shell, timeoutMs };
}

async function runScript(request, onOutput, signal) {
  const input = validate(request);
  if (!(await stat(input.executionPath)).isDirectory()) throw new Error('Working directory is not a directory.');
  if (signal?.aborted) throw new Error('Execution cancelled.');
  const folder = await mkdtemp(path.join(tmpdir(), 'volacrm-script-'));
  let child;
  let timer;
  let timedOut = false;
  let cancelled = false;
  const stop = () => {
    if (!child?.pid) return;
    if (process.platform === 'win32') {
      const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      killer.on('error', () => child.kill());
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
  };
  const abort = () => { cancelled = true; stop(); };
  try {
    const powershell = ['powershell', 'pwsh'].includes(input.shell);
    const file = path.join(folder, powershell ? 'script.ps1' : 'script.sh');
    await writeFile(file, powershell ? '\uFEFF' + input.scriptCode : input.scriptCode, { mode: 0o600 });
    if (signal?.aborted) throw new Error('Execution cancelled.');
    const command = input.shell === 'powershell' && process.platform === 'win32'
      ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : input.shell;
    const args = powershell ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, ...input.parameters] : [file, ...input.parameters];
    child = spawn(command, args, { cwd: input.executionPath, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const output = { stdout: '', stderr: '' };
    let bytes = 0;
    let outputTruncated = false;
    for (const stream of ['stdout', 'stderr']) {
      child[stream].setEncoding('utf8');
      child[stream].on('data', text => {
        const remaining = 2 * 1024 * 1024 - bytes;
        if (remaining <= 0) { outputTruncated = true; return; }
        const chunk = Buffer.from(text).subarray(0, remaining).toString('utf8');
        bytes += Buffer.byteLength(chunk);
        outputTruncated ||= chunk !== text;
        output[stream] += chunk;
        onOutput({ stream, text: chunk });
      });
    }
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    timer = setTimeout(() => { timedOut = true; stop(); }, input.timeoutMs);
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode, terminationSignal) => resolve({ exitCode, signal: terminationSignal }));
    });
    return { ...result, ...output, timedOut, cancelled, outputTruncated };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    await rm(folder, { recursive: true, force: true });
  }
}
module.exports = { validate, runScript };
