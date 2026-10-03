const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('volaDesktop', {
  version: '0.1.0',
  executeScript: request => ipcRenderer.invoke('script:execute', request),
  stopScript: () => ipcRenderer.invoke('script:stop'),
  onScriptOutput: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('script:output', listener);
    return () => ipcRenderer.removeListener('script:output', listener);
  }
});
