# SupaDupa Connect

The SupaDupa client sign-in, as a desktop app. One window, one page: a
client opens it, signs in with Google, and their credential reaches
SupaDupa. Nothing else.

Built for Phil, 18 September 2026. It is not specific to him — whoever
signs in sees their own connections and nobody else's, because the portal
already works that way.

## What it actually is

It is the **connections page of the SupaDupa client portal**
(`deploy.supadupa.nz/connections`) in an Electron window, plus a fence
around that window.

The page is **not** reimplemented here, on purpose:

* the sign-in, the PKCE round trip, the sealing of the credential and the
  hand-off to the office box all keep working exactly as they do in a
  browser, because they *are* the browser flow;
* a fix to the website is a fix to this app, with no new release;
* no secret ever comes near this repository. The app holds no client
  secret, no service key and no token. The only identifier it carries is
  the one every visitor to the website already receives.

Theo's own sign-in is untouched. Not one file of the website was changed
to build this.

## What the app adds

**A fence** (`src/navigation.js`) — the policy for where the window may go,
as pure functions with no imports, so all of it is exercised by `npm test`
on a machine with no display:

* the connections page, the sign-in page and the landing bounce may draw;
* every other portal surface — the plan, the documents, the people list,
  the admin page — is steered back to the connections page, so none of the
  portal comes along;
* Google's and Microsoft's own sign-in hosts may draw, because that is the
  sign-in;
* anything else opens in the real browser, where the person can see the
  address bar;
* anything that is not `http(s)` goes nowhere at all.

**A user agent with no `Electron` in it.** Measured against the live
Supabase → Google sign-in on 18 Sep 2026, two user agents, nothing else
different:

| user agent | what Google served |
|---|---|
| `…Chrome/140.0.0.0 Electron/38.0.0 Safari/537.36` | `flowName=GeneralOAuthLite` |
| `…Chrome/140.0.0.0 Safari/537.36` | `flowName=GeneralOAuthFlow` |

Neither was refused outright, but "Lite" is the cut-down flow that goes on
to refuse a password with *this browser or app may not be secure*. The
shipped string therefore carries no `Electron`, and reports the Chromium
version actually doing the rendering. This is the same call the personal
app makes for its own Google surfaces
(`calmode-v2/src/main/index.ts:1345`).

**An update channel.** `electron-updater` against this repo's GitHub
Releases: the app checks on launch and every six hours, downloads a new
version in the background, and offers a restart. Nobody fetches an
installer twice.

**An offline page** (`src/offline.html`), so flat wifi says so in words
instead of showing Chromium's error page inside a branded window.

## Running and building

```
npm install
npm start            # dev run
npm test             # the fence, 14 cases, no display needed
npm run dist:mac     # package for macOS (arm64 + x64)
npm run repack       # REQUIRED after dist:mac on Linux — see below
npm run probe        # drive the real sign-in and report what happened
npm run probe:update # prove the update channel against the real release
```

### `npm run repack` — do not skip it on Linux

electron-builder packages the `.app` correctly on Linux but its **zip step
flattens every symlink**. Measured on the 1.0.0 build:

```
symlink entries in the builder's zip .............. 0
bytes of the .app on disk ................ 265,852,588
bytes that zip expands to ................ 793,055,926
```

The Electron framework ships three times over — a 315 MB download instead
of 110 MB — and, more seriously, a macOS framework *is* its symlink layout,
so `codesign` would refuse the flattened bundle outright. `npm run repack`
rebuilds the zips with symlinks intact and rewrites `latest-mac.yml` with
the new hashes (get those wrong and every future update silently refuses
itself). On a Mac this step is unnecessary — electron-builder uses `ditto`
there, which keeps symlinks.

### `npm run probe` — the acceptance run

Starts the real app entry point against the real website and reports, as
one JSON line, what the window landed on, what user agent the site saw,
and whether pressing the buttons a client presses reaches Google's sign-in
screen. It never shows a window. Result on 18 Sep 2026:

```
bouncedToSignIn ....... true
uaSeenByPage .......... Mozilla/5.0 (Macintosh…) Chrome/140.0.7339.249 Safari/537.36
reachedGoogle ......... true
flowName .............. GeneralOAuthFlow
disallowedUserAgent ... false
```

with Google's own "Sign in to continue to …" screen rendered in the window.

### `npm run probe:update` — the update channel, proven

Points electron-updater itself at the real GitHub release with the current
version pretended back to 0.9.0, then separately downloads the exact
`latest-mac.yml` a Mac copy fetches and checks every asset it names exists
at the size it claims — a wrong size makes an update refuse itself with no
symptom at all. Result on 18 Sep 2026: release `v1.0.0` resolved, both mac
assets present, both sizes matching to the byte.

## Signing and notarisation — NOT DONE, and why

**The shipped 1.0.0 build is unsigned and un-notarised.** There is no
Developer ID certificate to sign it with. Checked on Sam's Mac on
18 Sep 2026:

```
security find-identity -v -p codesigning
  → 0 valid identities found
```

— the same result a check on 1 Sep 2026 recorded. Signing and notarisation
both need macOS *and* an Apple Developer Program membership; neither
`codesign` nor `notarytool` exists on the Linux box this was built on, and
no certificate exists on the Mac either.

What that means for whoever installs it: macOS will refuse the first
launch with *"SupaDupa Connect" cannot be opened because the developer
cannot be verified*. The way past it is right-click → Open → Open, once.
Every launch after that is normal. That is a real friction and the reason
the certificate matters.

`electron-builder.yml` already has `hardenedRuntime` and the entitlements
on, because notarisation will require them. The whole change, when the
certificate exists:

```yaml
mac:
  identity: "Developer ID Application: <name> (<TEAMID>)"
  notarize:
    teamId: "<TEAMID>"
```

plus `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` in the
environment, and the build run on a Mac or a macOS CI runner.

## Releasing

By hand, which is how 1.0.0 was released:

```
npm version patch
npm run dist:mac && npm run repack
gh release create v<version> dist/*.zip dist/latest-mac.yml
```

`latest-mac.yml` **must** be attached to the release — it is the file
electron-updater reads to find out a new version exists.

A GitHub Actions workflow that does all of this on a `v*` tag — on macOS,
so the symlinks survive and so signing can be switched on in the one place
it can ever work — is written and waiting at `docs/release-workflow.yml`.
It is not active: it has to be copied to `.github/workflows/release.yml`
by someone whose token carries the `workflow` scope, which the token this
repo was created with does not. GitHub rejects the push otherwise:

```
! [remote rejected] refusing to allow an OAuth App to create or update
  workflow `.github/workflows/release.yml` without `workflow` scope
```
