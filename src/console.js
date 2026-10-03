const $ = id => document.getElementById(id);
let outputText = '';
function append(text, stream = 'stdout') {
  outputText += text;
  const span = document.createElement('span');
  span.textContent = text;
  span.className = stream;
  $('output').append(span);
  $('output').scrollTop = $('output').scrollHeight;
}
window.volaDesktop.onScriptOutput(event => append(event.text, event.stream));
const windows = navigator.userAgent.includes('Windows');
if (!windows) $('mode').querySelector('[value="tilix"]').disabled = true;
let previousMode = 'console';
$('mode').onchange = () => {
  const tilix = $('mode').value === 'tilix';
  $('distribution-label').hidden = !tilix;
  $('shell').disabled = tilix;
  $('timeout').disabled = tilix;
  $('mode-hint').textContent = tilix
    ? 'Use a WSL Linux directory and Bash code. Output and input are in Tilix. Press Enter there after completion to close. Stop/timeout do not control a launched terminal.'
    : 'Output appears below. Stop and timeout apply to the script.';
  $('directory').placeholder = tilix ? '/home/sami/projects or /mnt/c/projects' : 'C:\\Users\\your-name or /home/your-name';
  if (tilix && previousMode !== 'tilix' && $('code').value === 'Write-Output "Hello from VolaCRM"\nWrite-Output "Parameter: $($args[0])"') $('code').value = 'printf "Hello from VolaCRM\\nParameter: %s\\n" "$1"';
  previousMode = $('mode').value;
};
if (!navigator.userAgent.includes('Windows')) {
  $('shell').value = 'bash';
  $('code').value = 'printf "Hello from VolaCRM\\nParameter: %s\\n" "$1"';
}
$('run').onclick = async () => {
  $('run').disabled = true;
  $('stop').disabled = false;
  $('status').textContent = 'Awaiting approval / running…';
  try {
    const tilix = $('mode').value === 'tilix';
    const request = { executionPath: $('directory').value, scriptCode: $('code').value, parameters: JSON.parse($('parameters').value), ...(tilix ? { distribution: $('distribution').value } : { shell: $('shell').value, timeoutMs: Number($('timeout').value) * 1000 }) };
    const result = tilix ? await window.volaDesktop.runScriptWindowsTilix(request) : await window.volaDesktop.executeScript(request);
    $('status').textContent = result.launched ? 'Launched in Tilix — output and controls are in the terminal' : result.timedOut ? 'Timed out' : result.cancelled ? 'Stopped' : `Finished — exit code ${result.exitCode}`;
    if (result.outputTruncated) append('\n[Output limited to 2 MB]\n', 'stderr');
  } catch (error) { $('status').textContent = 'Execution failed'; append(error.message + '\n', 'stderr'); }
  finally { $('run').disabled = false; $('stop').disabled = true; }
};
$('stop').onclick = () => window.volaDesktop.stopScript();
$('clear').onclick = () => { $('output').replaceChildren(); outputText = ''; };
$('save').onclick = () => {
  const url = URL.createObjectURL(new Blob([outputText], { type: 'text/plain' }));
  const link = document.createElement('a'); link.href = url; link.download = 'volacrm-script.log'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
