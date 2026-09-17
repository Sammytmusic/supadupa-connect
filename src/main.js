'use strict'

/**
 * main.js — the whole application.
 *
 * One window, one page, one job: let a client sign in with Google so their
 * credential reaches SupaDupa. See navigation.js for the fence around that
 * window and for what was measured about Google and user agents.
 *
 * Nothing in this app talks to a database, holds a secret, or knows who is
 * using it. The session lives where a browser's would — in the app's own
 * persistent partition — and every credential that matters is sealed on
 * the server, exactly as it is for the website.
 */

const { app, BrowserWindow, session, shell, dialog, Menu } = require('electron')
const path = require('path')
const nav = require('./navigation')

/* ── Single instance ──────────────────────────────────────────────────────
 * Two copies of a sign-in window is a way to lose a half-finished sign-in.
 * A second launch raises the first window instead. */
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', function () {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
}

/** The one persistent session, so a sign-in survives quitting the app. */
const PARTITION = 'persist:supadupa-connect'

let mainWindow = null

/* ═══════════════════════════════════════════════════════════════════════
 *  THE WINDOW
 * ═══════════════════════════════════════════════════════════════════════ */

function createWindow () {
  const ses = session.fromPartition(PARTITION)

  // The user agent, every request, before anything loads. See the long
  // note in navigation.js: the word `Electron` in this string demotes
  // Google's sign-in to its cut-down flow.
  ses.setUserAgent(nav.chromeUserAgent(process.versions.chrome, process.platform), 'en-US,en')

  mainWindow = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 560,
    minHeight: 560,
    show: false,
    title: 'SupaDupa',
    // The portal's navy, so the window never flashes white before the
    // page paints. Same value as public/connections.html's --navy.
    backgroundColor: '#2C3E50',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // A remote page draws in this window, so it gets no preload, no
      // bridge and no Node. There is nothing for it to reach.
      webviewTag: false,
      spellcheck: false
    }
  })

  // No application menu on Windows/Linux — there is nothing in it this app
  // needs, and an Edit menu on a sign-in window is just noise. macOS keeps
  // its menu because copy/paste and ⌘Q live there.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)

  applyFence(mainWindow)

  mainWindow.once('ready-to-show', function () {
    // Honoured by the acceptance spec so a test never draws a window on
    // somebody's screen. A person launching the app never sets it.
    if (process.env.SUPADUPA_CONNECT_HEADLESS === '1') return
    mainWindow.show()
  })

  mainWindow.on('closed', function () { mainWindow = null })

  load()
}

/**
 * Load the one page, and say something human if the site cannot be reached.
 *
 * ERR_ABORTED (-3) is NOT a failure and must never show the offline page.
 * Measured by the live probe on 18 Sep 2026: with no session yet,
 * connections.html does exactly what it is written to do —
 *
 *   supadupa-web/public/connections.html:  bail('index.html')
 *     → function bail (where) { window.location.replace(where) }
 *
 * — which replaces the navigation that is still in flight, so loadURL's
 * promise REJECTS with ERR_ABORTED even though the sign-in page is now
 * loading perfectly. Treating that as an error painted "We couldn't reach
 * SupaDupa" over a working sign-in, every single launch, for every person
 * who was not already signed in. Which is everybody, the first time.
 */
function load () {
  mainWindow.loadURL(nav.START_URL).catch(function (err) {
    const code = err && (err.errno !== undefined ? err.errno : err.code)
    if (code === -3 || String(code) === 'ERR_ABORTED') return
    showOffline()
  })
}

function showOffline () {
  if (!mainWindow) return
  mainWindow.loadFile(path.join(__dirname, 'offline.html'))
}

/* ═══════════════════════════════════════════════════════════════════════
 *  THE FENCE
 * ═══════════════════════════════════════════════════════════════════════ */

function applyFence (win) {
  const wc = win.webContents

  // A navigation the page starts itself (a link, a redirect, a
  // window.location assignment).
  wc.on('will-navigate', function (event, url) {
    const verdict = nav.classify(url)
    if (verdict.action === 'allow') return
    event.preventDefault()
    if (verdict.action === 'steer') wc.loadURL(verdict.to)
    else if (verdict.action === 'external') shell.openExternal(url)
  })

  // A redirect that happens after the navigation has been allowed to
  // start — this is the one that catches index.html's walk to portal.html
  // when it arrives as a server or history redirect rather than a click.
  wc.on('will-redirect', function (event, url) {
    const verdict = nav.classify(url)
    if (verdict.action === 'steer') {
      event.preventDefault()
      wc.loadURL(verdict.to)
    } else if (verdict.action === 'external') {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  // A same-document navigation (history.pushState / a hash change) never
  // fires will-navigate, and the portal's own walk to portal.html can
  // arrive this way. Checked after the fact and steered back.
  wc.on('did-navigate-in-page', function (_event, url, isMainFrame) {
    if (!isMainFrame) return
    const verdict = nav.classify(url)
    if (verdict.action === 'steer') wc.loadURL(verdict.to)
  })

  // target=_blank and window.open. Google's sign-in does not use them, so
  // anything arriving here is an ordinary outbound link.
  wc.setWindowOpenHandler(function (details) {
    const verdict = nav.classify(details.url)
    if (verdict.action === 'external' || verdict.action === 'allow') {
      shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  // The site being down, or a laptop with no wifi, should say so in words
  // rather than showing Chromium's dinosaur inside a branded window.
  wc.on('did-fail-load', function (_e, errorCode, _desc, validatedURL, isMainFrame) {
    if (!isMainFrame) return
    if (errorCode === -3) return // ERR_ABORTED — a navigation we cancelled
    if (validatedURL && validatedURL.startsWith('file://')) return
    showOffline()
  })

  // This app asks for nothing — no camera, no microphone, no location, no
  // notifications. Refusing every request is the whole policy.
  session.fromPartition(PARTITION).setPermissionRequestHandler(
    function (_wc, _permission, callback) { callback(false) }
  )
}

/* ═══════════════════════════════════════════════════════════════════════
 *  UPDATES — "like Claude Cowork gets updated"
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * electron-updater against this repo's GitHub Releases. A new version is
 * downloaded in the background and installed when the person agrees; they
 * never go and fetch an installer again.
 *
 * Wrapped in a try/catch and behind a dev check on purpose: an update
 * channel that throws on a machine it cannot reach must never be the
 * reason a sign-in window fails to open. The point of the app is the
 * sign-in; updating is a convenience on top of it.
 */
function startUpdates () {
  if (!app.isPackaged) return            // a dev run has no version to update
  if (process.env.SUPADUPA_CONNECT_NO_UPDATE === '1') return

  let autoUpdater
  try {
    autoUpdater = require('electron-updater').autoUpdater
  } catch (err) {
    console.warn('update channel unavailable:', err && err.message)
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null

  autoUpdater.on('error', function (err) {
    // Never a dialog. A failed update check is not the person's problem.
    console.warn('update check failed:', err && err.message)
  })

  autoUpdater.on('update-downloaded', function (info) {
    if (!mainWindow) return
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'SupaDupa',
      message: 'A new version of SupaDupa is ready.',
      detail: 'Version ' + (info && info.version ? info.version : '') +
        ' will be installed when you restart.'
    }).then(function (res) {
      if (res.response === 0) autoUpdater.quitAndInstall()
    })
  })

  const check = function () {
    autoUpdater.checkForUpdates().catch(function () { /* handled above */ })
  }
  check()
  // Six-hourly, so a copy left open for days still catches up.
  setInterval(check, 6 * 60 * 60 * 1000)
}

/* ═══════════════════════════════════════════════════════════════════════
 *  LIFECYCLE
 * ═══════════════════════════════════════════════════════════════════════ */

if (gotTheLock) {
  app.whenReady().then(function () {
    createWindow()
    startUpdates()

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit()
  })
}
