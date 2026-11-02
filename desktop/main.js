'use strict';
/* Molecule の Mac アプリ（Electron）。Web 版と同じ index.html をそのまま表示する。 */
const { app, BrowserWindow, Menu, shell, nativeTheme } = require('electron');
const path = require('path');

app.setName('Molecule');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Molecule',
    titleBarStyle: 'hiddenInset',             // 信号ボタンだけを残し、内容をウィンドウ上端まで広げる
    trafficLightPosition: { x: 32, y: 43 },  // サイドバーの左上に収める
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#05060a' : '#eef1f8',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  win.loadFile(path.join(__dirname, '..', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // PubChem や Wikidata へのリンクは既定のブラウザで開く
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); }
  });
  return win;
}

function buildMenu() {
  const send = (js) => () => BrowserWindow.getFocusedWindow()?.webContents.executeJavaScript(js).catch(() => {});
  const template = [
    {
      label: 'Molecule',
      submenu: [
        { role: 'about', label: 'Molecule について' },
        { type: 'separator' },
        { role: 'services', label: 'サービス' },
        { type: 'separator' },
        { role: 'hide', label: 'Molecule を隠す' },
        { role: 'hideOthers', label: 'ほかを隠す' },
        { role: 'unhide', label: 'すべてを表示' },
        { type: 'separator' },
        { role: 'quit', label: 'Molecule を終了' }
      ]
    },
    {
      label: 'ファイル',
      submenu: [
        { label: '新しい分子', accelerator: 'CmdOrCtrl+N', click: send("document.querySelector('.tab[data-tab=build]').click(); document.querySelector('#bNew').click()") },
        { label: '検索', accelerator: 'CmdOrCtrl+F', click: send("document.querySelector('#q').focus()") },
        { type: 'separator' },
        { label: '画像を保存…', accelerator: 'CmdOrCtrl+S', click: send("document.querySelector('#cShot').click()") },
        { type: 'separator' },
        { role: 'close', label: 'ウインドウを閉じる' }
      ]
    },
    {
      label: '編集',
      submenu: [
        { label: '取り消す', accelerator: 'CmdOrCtrl+Z', click: send("document.activeElement?.matches('input') ? document.execCommand('undo') : document.querySelector('#bUndo').click()") },
        { label: 'やり直す', accelerator: 'Shift+CmdOrCtrl+Z', click: send("document.activeElement?.matches('input') ? document.execCommand('redo') : document.querySelector('#bRedo').click()") },
        { type: 'separator' },
        { role: 'cut', label: 'カット' },
        { role: 'copy', label: 'コピー' },
        { role: 'paste', label: 'ペースト' },
        { role: 'selectAll', label: 'すべてを選択' }
      ]
    },
    {
      label: '表示',
      submenu: [
        { label: '全体を表示', accelerator: 'CmdOrCtrl+0', click: send("document.querySelector('#cReset').click()") },
        { label: '拡大', accelerator: 'CmdOrCtrl+Plus', click: send("document.querySelector('#cZoomIn').click()") },
        { label: '縮小', accelerator: 'CmdOrCtrl+-', click: send("document.querySelector('#cZoomOut').click()") },
        { label: '自動回転', accelerator: 'CmdOrCtrl+R', click: send("document.querySelector('#cSpin').click()") },
        { type: 'separator' },
        { label: '表示タブ', accelerator: 'CmdOrCtrl+1', click: send("document.querySelector('.tab[data-tab=view]').click()") },
        { label: '計測タブ', accelerator: 'CmdOrCtrl+2', click: send("document.querySelector('.tab[data-tab=measure]').click()") },
        { label: '立体タブ', accelerator: 'CmdOrCtrl+3', click: send("document.querySelector('.tab[data-tab=stereo]').click()") },
        { label: '作成タブ', accelerator: 'CmdOrCtrl+4', click: send("document.querySelector('.tab[data-tab=build]').click()") },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'フルスクリーンにする' },
        { role: 'reload', label: '再読み込み', accelerator: 'Shift+CmdOrCtrl+R' }
      ]
    },
    {
      role: 'window',
      label: 'ウインドウ',
      submenu: [
        { role: 'minimize', label: 'しまう' },
        { role: 'zoom', label: '拡大／縮小' },
        { type: 'separator' },
        { role: 'front', label: 'すべてを手前に移動' }
      ]
    },
    {
      role: 'help',
      label: 'ヘルプ',
      submenu: [
        { label: 'Molecule の Web 版', click: () => shell.openExternal('https://401t.github.io/molecule/') },
        { label: 'ソースコード（GitHub）', click: () => shell.openExternal('https://github.com/401T/molecule') }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.setAboutPanelOptions({
  applicationName: 'Molecule',
  applicationVersion: app.getVersion(),
  copyright: '構造: PubChem ／ 和名: Wikidata ／ 立体化学: OpenChemLib ／ 描画: 3Dmol.js',
  website: 'https://401t.github.io/molecule/'
});

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
