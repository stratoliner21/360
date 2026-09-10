const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { pathToFileURL } = require('url');

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

// 画面コード(index.html / renderer.js / styles.css)の自動更新まわり。
// Electron本体(exe)やこのファイル・preload.jsは更新対象に含めない。
const PATCHED_APP_DIR = path.join(app.getPath('userData'), 'patched-app');
const LOCAL_VERSION_FILE = path.join(app.getPath('userData'), 'app-content-version.txt');
const PATCHABLE_FILES = ['index.html', 'renderer.js', 'styles.css'];

function readLocalVersion() {
  try {
    return fs.readFileSync(LOCAL_VERSION_FILE, 'utf8').trim();
  } catch (e) {
    return '0.0.0';
  }
}

// 単純なセマンティックバージョン比較(x.y.z形式のみ想定)。remoteがlocalより新しければtrue。
function isNewerVersion(remote, local) {
  const toParts = (v) => String(v).split('.').map((n) => parseInt(n, 10) || 0);
  const r = toParts(remote);
  const l = toParts(local);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] || 0;
    const lv = l[i] || 0;
    if (rv !== lv) return rv > lv;
  }
  return false;
}

function resolveIndexPath() {
  const patchedIndex = path.join(PATCHED_APP_DIR, 'index.html');
  return fs.existsSync(patchedIndex) ? patchedIndex : path.join(__dirname, 'index.html');
}

// loadFile はアプリのルートからの相対パスしか想定していないため、userData配下の
// パッチ済みファイル(絶対パス)も確実に読めるよう file:// URL 経由で読み込む。
function loadHtmlFile(win, absolutePath) {
  return win.loadURL(pathToFileURL(absolutePath).toString());
}

async function setSplashStatus(win, message) {
  const safe = JSON.stringify(message);
  await win.webContents.executeJavaScript(
    'document.getElementById("status").textContent = ' + safe + ';'
  ).catch(() => {});
}

// 起動のたびにAPI経由でDrive上の更新パッチを確認し、新しければ適用する。
// オフライン等でチェックに失敗した場合は、既存(パッチ済み、無ければ同梱)のまま起動する。
async function checkAndApplyUpdate(win) {
  const localVersion = readLocalVersion();
  let statusMessage;
  try {
    const res = await postJson(config.apiBaseUrl, { action: 'getAppUpdate' });
    if (!res.success) {
      statusMessage = '更新確認をスキップしました';
    } else if (isNewerVersion(res.version, localVersion)) {
      fs.mkdirSync(PATCHED_APP_DIR, { recursive: true });
      PATCHABLE_FILES.forEach((name) => {
        if (typeof res.files[name] === 'string') {
          fs.writeFileSync(path.join(PATCHED_APP_DIR, name), res.files[name], 'utf8');
        }
      });
      fs.writeFileSync(LOCAL_VERSION_FILE, res.version, 'utf8');
      statusMessage = '更新しました(v' + res.version + ')';
    } else {
      statusMessage = '最新版です(v' + localVersion + ')';
    }
  } catch (err) {
    statusMessage = '更新確認をスキップしました(オフラインの可能性があります)';
  }
  await setSplashStatus(win, statusMessage);
  await new Promise((resolve) => setTimeout(resolve, 1200));
}

async function createWindow() {
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

  await loadHtmlFile(win, path.join(__dirname, 'splash.html'));
  await checkAndApplyUpdate(win);
  await loadHtmlFile(win, resolveIndexPath());
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
