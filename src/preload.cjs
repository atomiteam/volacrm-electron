const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('volaDesktop', {
  version: '0.2.0',
  executeScript: request => ipcRenderer.invoke('script:execute', request),
  runScript: request => ipcRenderer.invoke('script:execute', request),
  runScriptWindowsTilix: request => ipcRenderer.invoke('script:windows-tilix', request),
  stopScript: () => ipcRenderer.invoke('script:stop'),
  onScriptOutput: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('script:output', listener);
    return () => ipcRenderer.removeListener('script:output', listener);
  }
});
