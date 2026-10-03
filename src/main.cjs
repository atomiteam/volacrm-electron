const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { runScript, validate } = require('./runner.cjs');
const APP_URL = 'https://app.volacrm.com';
const CONSOLE_URL = pathToFileURL(path.join(__dirname, 'console.html')).href;
let mainWindow;
let consoleWindow;
let active;
let quitting = false;

function options() {
  return { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true };
}
function trusted(event) {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) throw new Error('Only the main frame may execute scripts.');
  const remote = mainWindow && event.sender === mainWindow.webContents && new URL(frame.url).origin === APP_URL;
  const local = consoleWindow && event.sender === consoleWindow.webContents && frame.url === CONSOLE_URL;
  if (!remote && !local) throw new Error('Script access denied for this page.');
}
function external(url) {
  try { if (['https:', 'http:'].includes(new URL(url).protocol)) void shell.openExternal(url); } catch {}
}
function lockWindow(window, local = false) {
  window.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('will-navigate', (event, url) => {
    if (local || new URL(url).origin !== APP_URL) { event.preventDefault(); if (!local) external(url); }
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
}
function openConsole() {
  if (consoleWindow && !consoleWindow.isDestroyed()) return consoleWindow.focus();
  consoleWindow = new BrowserWindow({ width: 1000, height: 780, title: 'VolaCRM — Script Console', webPreferences: options() });
  lockWindow(consoleWindow, true);
  consoleWindow.loadFile(path.join(__dirname, 'console.html'));
  consoleWindow.on('closed', () => { consoleWindow = null; });
}
function broadcast(data) {
  for (const window of [mainWindow, consoleWindow]) {
    if (!window || window.isDestroyed()) continue;
    const url = window.webContents.getURL();
    if (url === CONSOLE_URL || url.startsWith(APP_URL + '/')) window.webContents.send('script:output', data);
  }
}
ipcMain.handle('script:execute', async (event, request) => {
  trusted(event);
  if (active) throw new Error('Another script is running or awaiting approval.');
  const input = validate(request);
  const executionId = randomUUID();
  const controller = new AbortController();
  active = { controller, executionId };
  try {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const approval = await dialog.showMessageBox(owner, {
      type: 'warning', title: 'Run local script?',
      message: 'This script will run on your computer with your user permissions.',
      detail: `Shell: ${input.shell}\nWorking directory: ${input.executionPath}\nParameters: ${JSON.stringify(input.parameters)}\n\n${input.scriptCode}`,
      buttons: ['Cancel', 'Run script'], defaultId: 0, cancelId: 0, noLink: true
    });
    if (approval.response !== 1 || controller.signal.aborted) throw new Error('Execution cancelled.');
    trusted(event);
    const result = await runScript(input, data => broadcast({ executionId, ...data }), controller.signal);
    return { executionId, ...result };
  } finally { active = null; }
});
ipcMain.handle('script:stop', event => { trusted(event); active?.controller.abort(); return Boolean(active); });
app.whenReady().then(() => {
  mainWindow = new BrowserWindow({ width: 1400, height: 950, title: 'VolaCRM Desktop', webPreferences: options() });
  lockWindow(mainWindow);
  mainWindow.loadURL(APP_URL);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'VolaCRM', submenu: [{ label: 'Script Console', accelerator: 'CmdOrCtrl+Shift+S', click: openConsole }, { type: 'separator' }, { role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] }
  ]));
  mainWindow.on('closed', () => { mainWindow = null; consoleWindow?.close(); app.quit(); });
});
app.on('before-quit', event => {
  if (active && !quitting) { event.preventDefault(); active.controller.abort(); quitting = true; setTimeout(() => app.quit(), 1500); }
});
app.on('window-all-closed', () => app.quit());
