const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

// config.json はアプリ本体と同じ場所に置く「ポータブル設定」として扱う。
// URLだけを変えたい場合(デプロイし直した等)、アプリを再ビルドせずこのファイルを
// 書き換えるだけで済むようにする。存在しなければ config.example.json から複製する。
const CONFIG_PATH = path.join(app.getAppPath(), 'config.json');
const CONFIG_EXAMPLE_PATH = path.join(app.getAppPath(), 'config.example.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.copyFileSync(CONFIG_EXAMPLE_PATH, CONFIG_PATH);
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

function postJson(urlString, bodyObj) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlString);
    } catch (e) {
      reject(new Error('config.json の apiBaseUrl が不正なURLです: ' + urlString));
      return;
    }
    const payload = JSON.stringify(bodyObj);
    const client = url.protocol === 'http:' ? http : https;
    const req = client.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'http:' ? 80 : 443),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          // GASのWebアプリはJSONのContent-Typeでも受け付けるが、リダイレクト経由でも
          // 崩れないよう text/plain で送り、GAS側の e.postData.contents をJSONとしてパースさせる
          'Content-Type': 'text/plain;charset=utf-8',
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res) => {
        // GAS Web App はリダイレクト(302)を返すことがあるため追従する
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          postJson(res.headers.location, bodyObj).then(resolve, reject);
          return;
        }
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('サーバーからの応答を解析できませんでした: ' + data.slice(0, 200)));
          }
        });
      }
    );
    req.on('error', (err) => {
      reject(new Error('APIサーバーへの接続に失敗しました: ' + err.message));
    });
    req.write(payload);
    req.end();
  });
}

let config;

function createWindow() {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  config = loadConfig();

  ipcMain.handle('api-call', async (event, { action, payload }) => {
    try {
      return await postJson(config.apiBaseUrl, Object.assign({ action }, payload || {}));
    } catch (err) {
      return { success: false, error: { code: 'CLIENT_ERROR', message: err.message } };
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
