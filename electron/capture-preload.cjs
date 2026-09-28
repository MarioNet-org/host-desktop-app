const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('marioNetCapture', {
  ready: () => ipcRenderer.send('capture:ready'),
  signal: signal => ipcRenderer.send('capture:signal', signal),
  onStart: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('capture:start', listener); return () => ipcRenderer.removeListener('capture:start', listener); },
  onStop: callback => { const listener = (_event, id) => callback(id); ipcRenderer.on('capture:stop', listener); return () => ipcRenderer.removeListener('capture:stop', listener); },
  onSignal: callback => { const listener = (_event, signal) => callback(signal); ipcRenderer.on('capture:signal', listener); return () => ipcRenderer.removeListener('capture:signal', listener); },
});
