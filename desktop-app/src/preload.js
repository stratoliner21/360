const { contextBridge, ipcRenderer } = require('electron');

// レンダラーには生のネットワークアクセスを与えず、決められたAPI呼び出しだけを許可する
contextBridge.exposeInMainWorld('api', {
  call(action, payload) {
    return ipcRenderer.invoke('api-call', { action, payload });
  }
});
