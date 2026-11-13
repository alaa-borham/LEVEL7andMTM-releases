'use strict';
// LEVEL7 CAD MTM Admin: the page's only way to the program (no Node in the page)
const { contextBridge, ipcRenderer } = require('electron');
const call = (name, arg) => ipcRenderer.invoke(name, arg).then(r => { if (!r.ok) throw new Error(r.error); return r.value; });
contextBridge.exposeInMainWorld('admin', Object.freeze({
  state: () => call('state'),
  pickKey: () => call('pickKey'),
  openKey: passphrase => call('openKey', { passphrase }),
  setToken: token => call('setToken', { token }),
  saveUsers: list => call('saveUsers', { list }),
  hash: (name, password) => call('hash', password === undefined ? { name } : { name, password }),
  published: () => call('published'),
  publish: anyway => call('publish', { anyway: !!anyway }),
  setRequireDevice: on => call('setRequireDevice', { on: !!on }),
  releases: () => call('releases'),
  approve: version => call('approve', { version }),
  appReleases: app => call('appReleases', { app }),
  appApprove: (app, version) => call('appApprove', { app, version }),
  selfUpdate: () => call('selfUpdate'),
  selfUpdateInstall: () => call('selfUpdateInstall')
}));
