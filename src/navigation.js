'use strict'

/**
 * navigation.js — WHERE THIS WINDOW IS ALLOWED TO GO, and nothing else.
 *
 * ZERO IMPORTS on purpose. Every rule below is a pure function of a URL
 * string, so the whole policy can be exercised by `node --test` without
 * starting Electron, on a machine with no display.
 *
 * ── WHAT THIS APP IS ────────────────────────────────────────────────────
 * It is ONE PAGE of the SupaDupa client portal — the connections page, the
 * one a client signs into with Google so their Google Workspace credential
 * reaches us. Nothing else from the portal comes with it: no documents, no
 * plan, no people list, no admin.
 *
 * The page is not reimplemented here. The app loads the LIVE page at
 * deploy.supadupa.nz, which means the sign-in, the PKCE round trip, the
 * sealing and the hand-off all keep working exactly as they do in a
 * browser, and a fix to the website is a fix to this app. What this file
 * adds is the fence: which addresses may draw inside the window, which get
 * pushed back to the one page, and which are handed to the real browser.
 *
 * ── THE STEER, AND WHY IT EXISTS ────────────────────────────────────────
 * The website's own sign-in lands on the full portal:
 *
 *   public/index.html:315   window.location.href = 'portal.html'
 *   public/index.html:386   redirectTo: window.location.origin + '/'
 *
 * So a completed Google sign-in comes back to `/`, index.html sees the
 * session and walks to portal.html — the whole portal. This app wants the
 * connections page and only the connections page, and the website must not
 * be modified to get it (Theo signs in through those same files every
 * week). So the steer happens HERE, in the app: any portal page that is not
 * the sign-in, the landing bounce or the connections page is redirected to
 * the connections page. The website is untouched.
 *
 * `/` is deliberately NOT steered: Google's answer comes back to it with
 * the session in the URL fragment, and index.html is the thing that reads
 * that fragment. Steering `/` would throw the sign-in away at the last step.
 */

/** The live site. One constant, referred to everywhere. */
const SITE_ORIGIN = 'https://deploy.supadupa.nz'

/**
 * The one page this app exists to show.
 *
 * Extensionless, because the site is served with Vercel's `cleanUrls: true`
 * (supadupa-web/vercel.json) — `/connections.html` answers with a 308 to
 * `/connections`. Asking for the canonical address saves the redirect, and
 * the redirect is what the first probe run on 18 Sep 2026 tripped over:
 * the app asked for `/connections.html`, the site bounced it to
 * `/connections`, and this file — which only knew the `.html` spelling —
 * read its own destination as a portal page it does not carry and steered
 * it back, forever. Hence `normalisePortalPath` below.
 */
const START_URL = SITE_ORIGIN + '/connections'

/**
 * Hosts allowed to draw inside the window.
 *
 * Deliberately short. The portal itself, the auth service that issues the
 * session, and the two identity providers a client actually signs in with.
 * Everything else goes to the real browser, where the person can see the
 * address bar and the padlock.
 */
const IN_WINDOW_HOSTS = [
  'deploy.supadupa.nz',
  // Supabase Auth — where the sign-in starts and where Google's code is
  // redeemed (public/index.html:386, redirect_uri .../auth/v1/callback).
  'jalhgjnotvsvdezczoor.supabase.co',
  // Google's own sign-in. accounts.youtube.com and the two consent hosts
  // are part of the same walk and appear mid-flow.
  'accounts.google.com',
  'accounts.youtube.com',
  'myaccount.google.com',
  'ssl.gstatic.com',
  'www.gstatic.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  // Microsoft, for the OneDrive half of the same connections page. Present
  // because the page can render it, not because this client uses it.
  'login.microsoftonline.com',
  'login.live.com'
]

/**
 * Portal paths that are allowed to stay as they are, in their CANONICAL
 * (extensionless) spelling — see `normalisePortalPath`, which folds the
 * `.html` spelling onto these before the comparison.
 *
 *   /             — the landing bounce that reads Google's answer
 *   /index        — the sign-in page itself
 *   /connections  — the page this app IS
 *
 * Everything else under deploy.supadupa.nz is a portal surface this app
 * does not carry, and is steered back to the connections page.
 */
const KEPT_PORTAL_PATHS = ['/', '/index', '/connections']

/** File extensions that are page assets, never navigations to police. */
const ASSET_RE = /\.(png|jpe?g|gif|svg|ico|css|js|mjs|woff2?|ttf|map|json)$/i

/**
 * One spelling for a portal page.
 *
 * The site runs with `cleanUrls: true`, so every page has two addresses
 * that mean the same thing — `/connections` and `/connections.html`, and
 * `/` and `/index.html` — and the site redirects between them mid-flight.
 * Both spellings fold to the canonical one here so the fence can never
 * find itself refusing the very page it just asked for.
 */
function normalisePortalPath (path) {
  let p = path.replace(/\/+$/, '') || '/'
  if (p.endsWith('.html')) p = p.slice(0, -'.html'.length)
  if (p === '' || p === '/index') return p === '' ? '/' : p
  return p
}

function hostOf (url) {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return { host: u.hostname.toLowerCase(), path: u.pathname, url: u }
  } catch {
    return null
  }
}

/**
 * What should happen when the window is asked to go to `url`.
 *
 * Returns one of:
 *   { action: 'allow' }                 — let it navigate
 *   { action: 'steer', to: '<url>' }    — cancel, go to the connections page
 *   { action: 'external' }              — cancel, open in the real browser
 *   { action: 'block' }                 — cancel, go nowhere (non-http schemes)
 */
function classify (url) {
  // about:blank is what a freshly created window reports before it loads
  // anything; refusing it would break the window before it exists.
  if (!url || url === 'about:blank') return { action: 'allow' }

  const parsed = hostOf(url)
  // Anything that is not http(s) — a custom scheme, a file: path, a
  // javascript: URL — never navigates this window and never leaves it
  // either. Silently going nowhere is the only safe answer.
  if (!parsed) return { action: 'block' }

  const { host, path } = parsed

  if (host === 'deploy.supadupa.nz') {
    if (ASSET_RE.test(path)) return { action: 'allow' }
    if (KEPT_PORTAL_PATHS.indexOf(normalisePortalPath(path)) !== -1) return { action: 'allow' }
    // A portal surface this app does not carry — portal.html, people.html,
    // admin.html, anything added later. Back to the one page.
    return { action: 'steer', to: START_URL }
  }

  if (IN_WINDOW_HOSTS.indexOf(host) !== -1) return { action: 'allow' }

  // A link to somewhere else entirely — Google's help pages, a privacy
  // policy, an email address someone made clickable. The real browser.
  return { action: 'external' }
}

/**
 * The user agent this app presents.
 *
 * MEASURED, 18 Sep 2026, against the live Supabase→Google sign-in URL with
 * two user agents and nothing else different:
 *
 *   ...Chrome/140.0.0.0 Electron/38.0.0 Safari/537.36
 *        → accounts.google.com/v3/signin/identifier?...flowName=GeneralOAuthLite
 *   ...Chrome/140.0.0.0 Safari/537.36
 *        → accounts.google.com/v3/signin/identifier?...flowName=GeneralOAuthFlow
 *
 * Neither was refused outright — there was no `disallowed_useragent` in
 * either response — but the word `Electron` in the string is enough for
 * Google to drop the sign-in into its cut-down "Lite" flow, which is the
 * one that goes on to refuse a password with "this browser or app may not
 * be secure". So the string carries no `Electron`.
 *
 * This is the same call the personal app already makes for its own Google
 * surfaces, quoted from the real file rather than recalled:
 *
 *   calmode-v2/src/main/index.ts:1345
 *     googleSession.setUserAgent(googleChromeUserAgent(), 'en-US,en')
 *   calmode-v2/src/main/lib/google-links.ts:51-57
 *     'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
 *     `AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
 *
 * `chromeVersion` is passed in (process.versions.chrome) so the string
 * always matches the Chromium actually doing the rendering — a UA claiming
 * a version the engine does not have is its own kind of tell.
 */
function chromeUserAgent (chromeVersion, platform) {
  const chrome = chromeVersion || '140.0.0.0'
  const os = platform === 'win32'
    ? 'Windows NT 10.0; Win64; x64'
    : platform === 'linux'
      ? 'X11; Linux x86_64'
      : 'Macintosh; Intel Mac OS X 10_15_7'
  return 'Mozilla/5.0 (' + os + ') AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/' + chrome + ' Safari/537.36'
}

module.exports = {
  SITE_ORIGIN,
  START_URL,
  IN_WINDOW_HOSTS,
  KEPT_PORTAL_PATHS,
  normalisePortalPath,
  classify,
  chromeUserAgent
}
