const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('marioNet', {
  verification: (resend = false) => ipcRenderer.invoke('auth:verification', resend),
  signin: (credentials) => ipcRenderer.invoke('auth:signin', credentials),
  signup: (credentials) => ipcRenderer.invoke('auth:signup', credentials),
  getSession: () => ipcRenderer.invoke('auth:state'),
  signout: () => ipcRenderer.invoke('auth:signout'),
  hostState: () => ipcRenderer.invoke('host:state'),
  registerHost: () => ipcRenderer.invoke('host:register'),
  renameHost: name => ipcRenderer.invoke('host:rename', name),
  allowHost: allow => ipcRenderer.invoke('host:allow', allow),
  onExpired: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('auth:expired', listener);
    return () => ipcRenderer.removeListener('auth:expired', listener);
  },
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
});


