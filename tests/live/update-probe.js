'use strict'
/**
 * tests/live/update-probe.js — PROVE THE UPDATE CHANNEL, against the real feed.
 *
 * A published release and a reachable YAML file are not the same thing as
 * "a later version reaches an installed copy". Two halves are checked here,
 * because they fail for different reasons:
 *
 *  1. THE PROVIDER RESOLVES. electron-updater itself — the same library the
 *     shipped app runs — is pointed at the real GitHub repo with the current
 *     version pretended back to 0.9.0, and asked the question the app asks on
 *     launch. On a Mac it then reads latest-mac.yml; run from Linux it reads
 *     latest-linux.yml and says so, which still proves it found the repo, the
 *     latest release and that release's assets.
 *
 *  2. THE MAC FEED IS REAL. The exact file a Mac copy fetches is downloaded
 *     and parsed, and every asset it names is checked to exist at the size
 *     it claims. A wrong size or a missing asset makes an update refuse
 *     itself silently — the failure mode with no symptom.
 *
 * Nothing is downloaded in full and nothing is installed.
 */
const { app, net } = require('electron')
const { autoUpdater } = require('electron-updater')

app.commandLine.appendSwitch('disable-gpu')

const OWNER = 'Sammytmusic'
const REPO = 'supadupa-connect'
const MAC_FEED = `https://github.com/${OWNER}/${REPO}/releases/latest/download/latest-mac.yml`

function fetchText (url) {
  return net.fetch(url).then(function (r) {
    if (!r.ok) throw new Error(url + ' → HTTP ' + r.status)
    return r.text()
  })
}

function headSize (url) {
  return net.fetch(url, { method: 'HEAD' }).then(function (r) {
    return { status: r.status, size: Number(r.headers.get('content-length')) }
  })
}

app.whenReady().then(async function () {
  const out = { provider: {}, macFeed: {} }

  /* ── 1. the provider ───────────────────────────────────────────────── */
  autoUpdater.autoDownload = false
  autoUpdater.forceDevUpdateConfig = true   // a dev run has no app-update.yml
  autoUpdater.currentVersion = '0.9.0'      // pretend an older copy is installed
  autoUpdater.setFeedURL({ provider: 'github', owner: OWNER, repo: REPO })
  autoUpdater.logger = null
  try {
    const res = await autoUpdater.checkForUpdates()
    out.provider.foundVersion = res && res.updateInfo && res.updateInfo.version
    out.provider.updateAvailable = out.provider.foundVersion !== '0.9.0'
  } catch (err) {
    const msg = String(err && err.message)
    // Expected off macOS: the provider reached the right release and asked
    // for THIS platform's channel file, which a mac-only release has not
    // got. The release tag in the message is the proof it resolved.
    const tag = (msg.match(/releases\/download\/(v[\d.]+)\//) || [])[1]
    out.provider.reachedRelease = tag || null
    out.provider.note = tag
      ? 'ran from ' + process.platform + '; resolved release ' + tag +
        ' and asked for latest-' + (process.platform === 'win32' ? 'win' : process.platform) + '.yml'
      : msg.slice(0, 200)
  }

  /* ── 2. the mac feed ──────────────────────────────────────────────── */
  try {
    const yml = await fetchText(MAC_FEED)
    out.macFeed.version = (yml.match(/^version:\s*(.+)$/m) || [])[1]
    const entries = []
    const re = /- url:\s*(\S+)\s*\n\s*sha512:\s*(\S+)\s*\n\s*size:\s*(\d+)/g
    let m
    while ((m = re.exec(yml))) entries.push({ url: m[1], sha512: m[2], size: Number(m[3]) })
    out.macFeed.assets = []
    for (const e of entries) {
      const dl = `https://github.com/${OWNER}/${REPO}/releases/download/v${out.macFeed.version}/${e.url}`
      const head = await headSize(dl)
      out.macFeed.assets.push({
        url: e.url,
        status: head.status,
        declaredSize: e.size,
        actualSize: head.size,
        sizeMatches: head.size === e.size,
        sha512: e.sha512.slice(0, 12) + '…'
      })
    }
    out.macFeed.allAssetsPresent = out.macFeed.assets.every(function (a) {
      return a.status === 200 && a.sizeMatches
    })
    out.ok = !!out.macFeed.allAssetsPresent &&
      (out.provider.updateAvailable === true || !!out.provider.reachedRelease)
  } catch (err) {
    out.ok = false
    out.error = err && err.message
  }

  console.log('UPDATE ' + JSON.stringify(out, null, 1))
  app.exit(out.ok ? 0 : 1)
})
