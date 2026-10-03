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
if (!navigator.userAgent.includes('Windows')) {
  $('shell').value = 'bash';
  $('code').value = 'printf "Hello from VolaCRM\\nParameter: %s\\n" "$1"';
}
$('run').onclick = async () => {
  $('run').disabled = true;
  $('stop').disabled = false;
  $('status').textContent = 'Awaiting approval / running…';
  try {
    const result = await window.volaDesktop.executeScript({ executionPath: $('directory').value, scriptCode: $('code').value, parameters: JSON.parse($('parameters').value), shell: $('shell').value, timeoutMs: Number($('timeout').value) * 1000 });
    $('status').textContent = result.timedOut ? 'Timed out' : result.cancelled ? 'Stopped' : `Finished — exit code ${result.exitCode}`;
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
