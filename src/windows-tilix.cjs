const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { validate } = require('./runner.cjs');

function validateTilix(request) {
  if (!request || typeof request.executionPath !== 'string' || !path.posix.isAbsolute(request.executionPath) || request.executionPath.includes('\0')) {
    throw new Error('Tilix executionPath must be an absolute WSL Linux directory, such as /home/sami or /mnt/c/projects.');
  }
  // Reuse code/argument limits without interpreting the Linux path as a Windows path.
  const common = validate({ ...request, executionPath: path.resolve('.'), shell: 'bash' });
  const distribution = request.distribution ?? '';
  if (typeof distribution !== 'string' || distribution.length > 128 || /[\0\r\n]/.test(distribution) || distribution.startsWith('-')) throw new Error('Invalid WSL distribution name.');
  return { ...common, executionPath: request.executionPath, distribution };
}
function quote(value) { return "'" + value.replaceAll("'", "'\\''") + "'"; }

const wrapper = `#!/bin/bash
folder=$1
directory=$2
shift 2
trap 'rm -rf -- "$folder"' EXIT
cd -- "$directory" || exit 1
touch "$folder/started"
bash "$folder/script.sh" "$@"
result=$?
printf '\\nProcess finished — exit code: %s\\n' "$result"
read -r -p 'Press Enter to close this terminal… ' _
exit "$result"
`;

const launcher = `set -eu
folder=$1
directory=$2
terminal_command=$3
command -v tilix >/dev/null || { echo 'Tilix is not installed in the selected WSL distribution. Install it with sudo apt install tilix.' >&2; exit 1; }
[ -n "\${DISPLAY:-}\${WAYLAND_DISPLAY:-}" ] || { echo 'WSL GUI support is unavailable. Install/update WSL 2 with WSLg.' >&2; exit 1; }
[ -d "$directory" ] || { echo 'The WSL working directory does not exist.' >&2; exit 1; }
umask 077
mkdir -- "$folder"
trap 'rm -rf -- "$folder"' EXIT
cat > "$folder/script.sh"
cat > "$folder/terminal.sh" <<'VOLA_TERMINAL_WRAPPER'
${wrapper}VOLA_TERMINAL_WRAPPER
terminal=(tilix --new-process --working-directory="$directory" --title='VolaCRM Script' --command="$terminal_command")
if [ -z "\${DBUS_SESSION_BUS_ADDRESS:-}" ] && command -v dbus-run-session >/dev/null; then terminal=(dbus-run-session -- "\${terminal[@]}"); fi
nohup "\${terminal[@]}" > "$folder/launch.log" 2>&1 < /dev/null &
terminal_pid=$!
for ((attempt=0;attempt<150;attempt++)); do
  if [ -f "$folder/started" ]; then trap - EXIT; printf 'VOLA_TILIX_STARTED\\n'; exit 0; fi
  if ! kill -0 "$terminal_pid" 2>/dev/null; then cat "$folder/launch.log" >&2; rm -rf -- "$folder"; exit 1; fi
  sleep 0.1
done
echo 'Tilix did not start a terminal within 15 seconds. Check WSLg and the Tilix installation.' >&2
kill "$terminal_pid" 2>/dev/null || true
cat "$folder/launch.log" >&2
rm -rf -- "$folder"
exit 1
`;

function buildTilixLaunch(request, id = randomUUID()) {
  const input = validateTilix(request);
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('Invalid execution ID.');
  const folder = `/tmp/volacrm-tilix-${id}`;
  // GLib parses Tilix's command string. POSIX single quoting preserves every argument.
  const terminalCommand = ['/bin/bash', `${folder}/terminal.sh`, folder, input.executionPath, ...input.parameters].map(quote).join(' ');
  const args = [...(input.distribution ? ['--distribution', input.distribution] : []), '--exec', '/bin/bash', '-c', launcher, 'volacrm-tilix', folder, input.executionPath, terminalCommand];
  return { input, args, script: input.scriptCode.replace(/\r\n/g, '\n') };
}

async function runScriptWindowsTilix(request, signal) {
  if (process.platform !== 'win32') throw new Error('runScriptWindowsTilix is available only on Windows with WSL.');
  if (signal?.aborted) throw new Error('Execution cancelled.');
  const launch = buildTilixLaunch(request);
  const command = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
  return new Promise((resolve, reject) => {
    const child = spawn(command, launch.args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let error;
    const stop = () => { error = new Error('Tilix launch cancelled.'); child.kill(); };
    const timer = setTimeout(() => { error = new Error('WSL launch timed out. Verify WSL is installed and the selected distribution starts.'); child.kill(); }, 25000);
    signal?.addEventListener('abort', stop, { once: true });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', text => { stdout = (stdout + text).slice(-32768); });
    child.stderr.on('data', text => { stderr = (stderr + text).slice(-32768); });
    child.stdin.on('error', () => {});
    child.on('error', cause => { error = new Error(`Cannot start WSL: ${cause.message}`); });
    child.once('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', stop);
      if (error) return reject(error);
      if (code !== 0 || !stdout.includes('VOLA_TILIX_STARTED')) return reject(new Error(stderr.trim() || stdout.trim() || 'Tilix failed to start.'));
      resolve({ launched: true, outputLocation: 'tilix', distribution: launch.input.distribution || 'default', exitCode: null });
    });
    if (signal?.aborted) stop();
    child.stdin.end(launch.script);
  });
}
module.exports = { validateTilix, buildTilixLaunch, runScriptWindowsTilix };
