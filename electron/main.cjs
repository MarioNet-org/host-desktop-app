const { app, BrowserWindow, ipcMain, session, dialog, desktopCapturer } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { loadApiUrl } = require('./auth.cjs');
const { PersistentAuth: AuthClient } = require('./persistent-auth.cjs');
const { SessionStore } = require('./session-store.cjs');
const { HostService } = require("./host.cjs");
app.setName("MarioNet Host");
app.setAppUserModelId("com.marionet.host");
let host;

const root = path.join(__dirname, "..");
const entry = path.join(root, "dist", "index.html");
const devUrl = app.isPackaged ? undefined : process.env.MARIONET_DEV_URL;
const configPath = app.isPackaged
  ? path.join(process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath("exe")), "marionet.env")
  : path.join(root, ".env");
if (devUrl && devUrl !== "http://127.0.0.1:5174")
  throw new Error("Invalid development URL");
let window;
let auth;
let exiting = false;
let captureWindow;
let captureReady;
let resolveCaptureReady;

function trusted(event) {
  return (
    window &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame.url ===
      (devUrl ? `${devUrl}/` : pathToFileURL(entry).href)
  );
}

function createWindow() {
  window = new BrowserWindow({
    width: 1400,
    height: 850,
    minWidth: 920,
    minHeight: 640,
    title: "MarioNet Host",
    frame: false,
    backgroundColor: "#171727",
    show: false,
    autoHideMenuBar: true,
    icon: path.join(root, "build", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.once("ready-to-show", () => window.show());
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(entry);
}

function createCaptureWindow() {
  if (captureWindow && !captureWindow.isDestroyed()) return captureReady;
  captureReady = new Promise((resolve, reject) => {
    resolveCaptureReady = resolve;
    captureWindow = new BrowserWindow({
      show: false,
      webPreferences: { preload: path.join(__dirname, 'capture-preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: false, webSecurity: true },
    });
    captureWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    captureWindow.webContents.on('will-navigate', event => event.preventDefault());
    captureWindow.once('closed', () => { captureWindow = null; captureReady = null; resolveCaptureReady = null; });
    captureWindow.webContents.once('did-fail-load', (_event, _code, description) => reject(new Error(description)));
    void captureWindow.loadFile(path.join(__dirname, 'capture.html'));
  });
  return captureReady;
}

async function startCapture(connection) {
  console.info('Host main starting capture', connection?.id);
  await createCaptureWindow();
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
  if (!sources[0]) throw new Error('SCREEN_SOURCE_UNAVAILABLE');
  console.info('Host main capture source selected', sources[0].id);
  if (captureWindow && !captureWindow.isDestroyed()) captureWindow.webContents.send('capture:start', { connection, sourceId: sources[0].id });
}

function stopCapture(connectionId) {
  if (captureWindow && !captureWindow.isDestroyed()) captureWindow.webContents.send('capture:stop', connectionId);
}

void app.whenReady().then(async () => {
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  try {
    auth = new AuthClient(loadApiUrl(configPath), {
      onExpired: () => {
        host?.stop();
        if (window && !window.isDestroyed())
          window.webContents.send("auth:expired");
      },
    });
  } catch {
    dialog.showErrorBox(
      "MarioNet 설정 오류",
      "서버 주소를 확인해주세요. MARIONET_SERVER_URL에는 HTTPS 주소 또는 로컬 HTTP 주소를 설정해야 합니다.",
    );
    app.quit();
    return;
  }
  auth.store = new SessionStore(path.join(app.getPath('userData'), 'sessions'), auth.origin, require('electron').safeStorage);
  try { await auth.restore(); } catch { dialog.showErrorBox('로그인 정보 오류', '저장된 로그인 정보를 읽지 못했어요. OS 계정과 저장소 권한을 확인해주세요.'); app.quit(); return; }
  ipcMain.handle('auth:verification', (event, resend) => trusted(event) && typeof resend === 'boolean' ? auth.verification(resend) : { ok: false, code: 'UNTRUSTED' });
  const capturePermission = webContents => webContents === captureWindow?.webContents;
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => callback(capturePermission(webContents) && permission === 'media'));
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => capturePermission(webContents) && permission === 'media');
  ipcMain.handle("auth:signin", (event, input) =>
    trusted(event) ? auth.signin(input) : { ok: false, code: "UNTRUSTED" },
  );
  ipcMain.handle("auth:signup", (event, input) =>
    trusted(event) ? auth.signup(input) : { ok: false, code: "UNTRUSTED" },
  );
  ipcMain.handle("auth:state", (event) =>
    trusted(event) ? auth.state() : null,
  );
  ipcMain.handle("auth:signout", (event) =>
    trusted(event)
      ? host.busy
        ? { ok: false, code: "BUSY" }
        : (host.stop(), auth.signout())
      : { ok: false, code: "UNTRUSTED" },
  );
  host = new HostService(
    auth,
    path.join(app.getPath("userData"), "hosts"),
    require("electron").safeStorage,
  );
  host.onConnection = connection => {
    if (connection?.status === 'ACCEPTED') void startCapture(connection).catch(error => console.error('Host capture start failed', connection.id, error));
    if (['CLOSED', 'REJECTED', 'EXPIRED'].includes(connection?.status)) stopCapture(connection.id);
  };
  host.onSignal = signal => { if (captureWindow && !captureWindow.isDestroyed()) captureWindow.webContents.send('capture:signal', signal); };
  ipcMain.on('capture:ready', event => { if (event.sender === captureWindow?.webContents) resolveCaptureReady?.(); });
  ipcMain.on('capture:signal', (event, signal) => { if (event.sender === captureWindow?.webContents && signal && typeof signal === 'object') void host.sendSignal(signal).catch(error => console.error('Host capture signal failed', error)); });
  for (const operation of ["state", "register", "rename", "allow"]) {
    ipcMain.handle(`host:${operation}`, async (event, input) => {
      if (!trusted(event)) return { ok: false, code: "UNTRUSTED" };
      return host.run(operation, input);
    });
  }
  ipcMain.on("window:minimize", (event) => {
    if (trusted(event)) window.minimize();
  });
  ipcMain.on("window:maximize", (event) => {
    if (trusted(event))
      window.isMaximized() ? window.unmaximize() : window.maximize();
  });
  ipcMain.on("window:close", (event) => {
    if (trusted(event)) window.close();
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (exiting || !auth) return;
  event.preventDefault();
  exiting = true;
  host?.stop();
  captureWindow?.destroy();
  void auth.dispose().finally(() => app.quit());
});

