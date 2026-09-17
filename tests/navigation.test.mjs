/**
 * The fence, exercised without Electron and without a display.
 *
 * Every case here is a real address from the live flow, not an invented
 * one: the sign-in page, the Supabase authorize endpoint, the Google
 * identifier page the measurement on 18 Sep 2026 actually landed on, and
 * the portal surfaces this app must NOT carry.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const nav = require('../src/navigation.js')

test('the one page it exists to show is allowed, either spelling', () => {
  // The site runs with cleanUrls, so it redirects `.html` to the bare
  // name mid-flight. The first probe run on 18 Sep 2026 died exactly here:
  // the app asked for /connections.html, the site answered 308
  // /connections, and the fence steered its own destination away.
  assert.equal(nav.classify('https://deploy.supadupa.nz/connections').action, 'allow')
  assert.equal(nav.classify('https://deploy.supadupa.nz/connections.html').action, 'allow')
  assert.equal(nav.classify('https://deploy.supadupa.nz/connections/').action, 'allow')
})

test('the sign-in page is allowed, either spelling', () => {
  assert.equal(nav.classify('https://deploy.supadupa.nz/index.html').action, 'allow')
  assert.equal(nav.classify('https://deploy.supadupa.nz/index').action, 'allow')
})

test('the landing bounce is allowed, fragment and all', () => {
  // Google's answer comes back to `/` with the session in the fragment,
  // and index.html is the only thing that reads it. Steering this would
  // throw the sign-in away one step from the end.
  const url = 'https://deploy.supadupa.nz/#access_token=abc&expires_in=3600&token_type=bearer'
  assert.equal(nav.classify(url).action, 'allow')
})

test('the rest of the portal is steered back to the connections page', () => {
  for (const path of [
    '/portal.html', '/people.html', '/admin.html', '/kanban-preview.html', '/reconnect.html',
    // and the same pages in the clean-URL spelling the site actually serves
    '/portal', '/people', '/admin', '/reconnect'
  ]) {
    const verdict = nav.classify('https://deploy.supadupa.nz' + path)
    assert.equal(verdict.action, 'steer', path + ' should be steered')
    assert.equal(verdict.to, nav.START_URL)
  }
})

test('page assets are never steered', () => {
  for (const path of ['/logo.png', '/vendor/supabase-js.umd.js', '/portal-capture.js']) {
    assert.equal(nav.classify('https://deploy.supadupa.nz' + path).action, 'allow', path)
  }
})

test('Supabase auth stays in the window', () => {
  const url = 'https://jalhgjnotvsvdezczoor.supabase.co/auth/v1/authorize?provider=google' +
    '&redirect_to=https%3A%2F%2Fdeploy.supadupa.nz%2F'
  assert.equal(nav.classify(url).action, 'allow')
})

test('the Supabase OAuth callback stays in the window', () => {
  assert.equal(
    nav.classify('https://jalhgjnotvsvdezczoor.supabase.co/auth/v1/callback?code=x&state=y').action,
    'allow'
  )
})

test("Google's own sign-in stays in the window", () => {
  const measured = 'https://accounts.google.com/v3/signin/identifier?flowName=GeneralOAuthFlow' +
    '&client_id=521713219476-etpr1ct3qq14arb1v5srm4qardbgdpik.apps.googleusercontent.com'
  assert.equal(nav.classify(measured).action, 'allow')
  assert.equal(nav.classify('https://accounts.youtube.com/accounts/SetSID').action, 'allow')
})

test("Microsoft's sign-in stays in the window", () => {
  assert.equal(nav.classify('https://login.microsoftonline.com/common/oauth2/v2.0/authorize').action, 'allow')
})

test('anywhere else goes to the real browser', () => {
  for (const url of [
    'https://support.google.com/accounts/answer/12345',
    'https://policies.google.com/privacy',
    'https://example.com/'
  ]) {
    assert.equal(nav.classify(url).action, 'external', url)
  }
})

test('a non-http scheme goes nowhere at all', () => {
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'supadupa://open', 'mailto:sam@supadupa.nz']) {
    assert.equal(nav.classify(url).action, 'block', url)
  }
})

test('about:blank is allowed so a fresh window can exist', () => {
  assert.equal(nav.classify('about:blank').action, 'allow')
  assert.equal(nav.classify('').action, 'allow')
})

test('the user agent never says Electron', () => {
  // The whole reason the string exists. Measured 18 Sep 2026: with
  // `Electron` present Google served flowName=GeneralOAuthLite; without
  // it, flowName=GeneralOAuthFlow.
  for (const platform of ['darwin', 'win32', 'linux']) {
    const ua = nav.chromeUserAgent('140.0.7339.207', platform)
    assert.ok(!/electron/i.test(ua), platform + ': ' + ua)
    assert.match(ua, /Chrome\/140\.0\.7339\.207 Safari\/537\.36$/)
  }
  assert.match(nav.chromeUserAgent('140.0.0.0', 'darwin'), /Macintosh; Intel Mac OS X 10_15_7/)
})

test('the start url is the connections page, canonically spelled', () => {
  // Canonical means no 308 on launch — one fewer moving part in the one
  // navigation that must always work.
  assert.equal(nav.START_URL, 'https://deploy.supadupa.nz/connections')
  assert.equal(nav.classify(nav.START_URL).action, 'allow')
})
