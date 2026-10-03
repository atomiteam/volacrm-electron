# VolaCRM Desktop

Electron desktop wrapper for https://app.volacrm.com with local shell execution. Windows x64 trial builds include a setup installer and a portable executable. The website remains hosted; internet access is required.

## Try it

Download `volacrm-windows-x64` from a successful **Build Windows bundle** Actions run. Extract the artifact ZIP and run the Portable executable, or install using Setup. Builds are unsigned; Windows may display a publisher warning.

Open **VolaCRM → Script Console** (`Ctrl+Shift+S`). Enter an existing absolute working directory, script code, and parameters as a JSON string array. Click Run script, review the native approval dialog, and approve. Output appears live; Stop cancels the process tree. Save log downloads a text file. This is a noninteractive output console: scripts requiring terminal input are not supported.

## Frontend bridge

The desktop app exposes the following API to the main frame of https://app.volacrm.com. No frontend changes are required to use the standalone Script Console.

```js
const unsubscribe = window.volaDesktop.onScriptOutput(({ executionId, stream, text }) => {
  // Append text using textContent; stream is stdout or stderr.
  console.log(executionId, stream, text);
});
const result = await window.volaDesktop.executeScript({
  executionPath: 'C:\\Users\\your-name', // working directory, not executable
  scriptCode: 'Write-Output "Hello $($args[0])"',
  parameters: ['Sami'],
  shell: 'powershell', // optional: powershell on Windows, bash elsewhere
  timeoutMs: 120000,
});
unsubscribe();
// result: executionId, exitCode, signal, stdout, stderr,
// timedOut, cancelled, outputTruncated
// await window.volaDesktop.stopScript();
```

Parameters are passed as process arguments, never interpolated into source code. Shell choices: Windows PowerShell, separately installed `pwsh`, `bash`, or `sh`. Windows PowerShell scripts use temporary UTF-8 BOM files. Each execution requires native approval; scripts run with the current user's permissions. One execution at a time, 1–600 second timeout, 256 KB script limit, 2 MB combined output limit. Temporary scripts are deleted after execution.

## Development / packaging

Requires Node.js 22 or later. `npm ci`, `npm test`, `npm start`. On Windows: `npm run build:windows`. CI runs on Windows for main pushes, pull requests, and manual workflow dispatch. Artifacts last 30 days; the workflow summary contains the actual download URL.

## Boundaries

Remote content uses sandboxing, context isolation and disabled Node integration. IPC validates the exact approved origin and top-level frame. Other links open in the system browser, with no desktop bridge. Scripts intentionally have local user privileges and are not sandboxed. Never approve untrusted code. No automatic scripts, background service, or terminal input. Signing and auto-update are not configured for this trial.

SSO providers that require leaving app.volacrm.com open in the system browser. If your current login flow requires an external redirect inside the desktop window, it needs a dedicated authentication/deep-link integration before that SSO flow will work.
