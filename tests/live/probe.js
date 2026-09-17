'use strict'
/**
 * tests/live/probe.js — THE ACCEPTANCE RUN, against the real website.
 *
 * `npm run probe` starts the real app entry point's session settings and
 * fence, loads the real connections page, and reports — as one JSON line —
 * what the window actually landed on, what user agent the site saw, and
 * whether pressing "Client login" reaches Google's own sign-in screen.
 *
 * It never shows a window (SUPADUPA_CONNECT_HEADLESS is honoured by
 * main.js, and this probe creates its own hidden window regardless), so it
 * can run on a build box with no display.
 */
const { app, BrowserWindow, session, shell } = require('electron')
const nav = require('../../src/navigation')

app.commandLine.appendSwitch('headless')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('no-sandbox')

const out = { steps: [] }
function step (name, detail) { out.steps.push(Object.assign({ name }, detail)) }

app.whenReady().then(async function () {
  const PARTITION = 'persist:probe'
  const ses = session.fromPartition(PARTITION)
  const ua = nav.chromeUserAgent(process.versions.chrome, 'darwin')
  ses.setUserAgent(ua, 'en-US,en')
  out.userAgent = ua
  out.electronVersion = process.versions.electron
  out.chromeVersion = process.versions.chrome

  const win = new BrowserWindow({
    show: false,
    width: 980,
    height: 760,
    webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false }
  })
  const wc = win.webContents

  // The same fence main.js applies, so the probe measures the shipped
  // behaviour and not a laxer copy of it.
  wc.on('will-navigate', function (event, url) {
    const v = nav.classify(url)
    step('will-navigate', { url: url.slice(0, 120), verdict: v.action })
    if (v.action === 'allow') return
    event.preventDefault()
    if (v.action === 'steer') wc.loadURL(v.to)
    else if (v.action === 'external') void shell
  })
  wc.on('will-redirect', function (event, url) {
    const v = nav.classify(url)
    step('will-redirect', { url: url.slice(0, 120), verdict: v.action })
    if (v.action === 'steer') { event.preventDefault(); wc.loadURL(v.to) }
  })

  try {
    // Same tolerance the app has: the page's own bail to the sign-in
    // aborts this navigation, and an abort is not a failure.
    await wc.loadURL(nav.START_URL).catch(function (err) {
      step('load aborted (expected when signed out)', { message: err && err.message })
    })
    await new Promise(function (r) { setTimeout(r, 4000) })
    out.landedOn = wc.getURL()
    out.title = await wc.executeJavaScript('document.title')

    // No session in a fresh partition, so connections.html bails to the
    // sign-in page. That bounce IS the first thing to verify.
    out.bouncedToSignIn = /\/index(\.html)?$|deploy.supadupa.nz\/?$/.test(out.landedOn)

    // What the site saw.
    out.uaSeenByPage = await wc.executeJavaScript('navigator.userAgent')

    // Press the two buttons a client presses: "Client login", then
    // "Continue with Google".
    const pressed = await wc.executeJavaScript(`
      (function () {
        var btn = document.getElementById('loginBtn')
        if (!btn) return 'no loginBtn'
        btn.click()
        return 'clicked'
      })()
    `)
    step('press login', { result: pressed })
    await new Promise(function (r) { setTimeout(r, 3000) })

    out.loginPanelText = await wc.executeJavaScript(
      "(document.getElementById('login') || {}).innerText || ''"
    )
    const pressedGoogle = await wc.executeJavaScript(`
      (function () {
        var els = Array.prototype.slice.call(document.querySelectorAll('button, a'))
        for (var i = 0; i < els.length; i++) {
          if (/google/i.test(els[i].textContent || '')) { els[i].click(); return els[i].textContent.trim() }
        }
        return 'no google button'
      })()
    `)
    step('press google', { result: pressedGoogle })
    await new Promise(function (r) { setTimeout(r, 6000) })

    out.finalUrl = wc.getURL()
    out.reachedGoogle = /accounts\.google\.com/.test(out.finalUrl)
    out.flowName = (out.finalUrl.match(/flowName=([A-Za-z]+)/) || [])[1] || null
    out.googlePageText = (await wc.executeJavaScript('document.body.innerText'))
      .replace(/\s+/g, ' ').slice(0, 300)
    out.disallowedUserAgent = /disallowed_useragent|browser or app may not be secure/i
      .test(out.googlePageText)

    const png = await wc.capturePage()
    require('fs').writeFileSync(
      process.env.PROBE_SHOT || '/tmp/supadupa-connect-probe.png',
      png.toPNG()
    )
    out.screenshot = process.env.PROBE_SHOT || '/tmp/supadupa-connect-probe.png'
    out.ok = true
  } catch (err) {
    out.ok = false
    out.error = err && err.message
  }

  console.log('PROBE ' + JSON.stringify(out))
  app.exit(out.ok ? 0 : 1)
})
