/* The window's only way out.  CommonJS because a sandboxed preload cannot be
   an ES module.  Results come back as { ok, value } or { ok: false, error }
   and are unwrapped here, so the page sees ordinary promises.  An engine's
   own failure (a reply with ok: false and a `code`) is a value, not an
   error: the window reads its code (docs/engine-protocol.md 2). */
const { contextBridge, ipcRenderer } = require('electron');

const unwrap = (r) => {
  if (r && r.ok === false && r.error && typeof r.error === 'object') {
    const e = new Error(r.error.message);
    e.name = r.error.name;
    throw e;
  }
  return r && r.ok === true && 'value' in r ? r.value : r;
};

contextBridge.exposeInMainWorld('app', {
  call: (cmd, params) => ipcRenderer.invoke('sim:call', cmd, params ?? {}).then(unwrap),
  stop: () => ipcRenderer.invoke('sim:stop').then(unwrap),
  check: (source) => ipcRenderer.invoke('sim:check', source).then(unwrap),
  engineState: () => ipcRenderer.invoke('sim:state'),
  onConsole: (listener) => ipcRenderer.on('sim:console', (_e, text) => listener(text)),
  onInput: (listener) => ipcRenderer.on('sim:input', (_e, pc) => listener(pc)),
  onCrashed: (listener) => ipcRenderer.on('sim:crashed', (_e, message, cause, restarted) => listener(message, cause, restarted)),
  onEngineState: (listener) => ipcRenderer.on('sim:state', (_e, state, detail) => listener(state, detail)),
  openFile: () => ipcRenderer.invoke('file:open').then(unwrap),
  saveFile: (file) => ipcRenderer.invoke('file:save', file).then(unwrap),
  about: () => ipcRenderer.invoke('about:info'),
  license: (i) => ipcRenderer.invoke('about:license', i).then(unwrap),
  openCredits: () => ipcRenderer.invoke('about:openCredits').then(unwrap),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  setOverlay: (patch) => ipcRenderer.invoke('win:overlay', patch),
});
