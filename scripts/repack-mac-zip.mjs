/**
 * repack-mac-zip.mjs — REBUILD THE MAC ZIPS SO THEY KEEP THEIR SYMLINKS.
 *
 * ── THE DEFECT THIS EXISTS FOR, MEASURED NOT ASSUMED ────────────────────
 * electron-builder packages a macOS .app correctly on Linux — the .app in
 * dist/mac-arm64 has all 14 of its framework symlinks. Its ZIP step on
 * Linux does not: measured on the 1.0.0 build, 18 Sep 2026,
 *
 *   symlink entries in the builder's zip .................. 0
 *   bytes of the .app on disk ................... 265,852,588
 *   bytes the zip expands to .................... 793,055,926
 *
 * — every symlink was replaced by a full copy of what it pointed at, so
 * the Electron framework ships three times over. Two consequences, and the
 * second is the serious one:
 *
 *   1. The download is 315 MB instead of about 95 MB.
 *   2. A macOS framework bundle IS its symlink layout. `codesign` refuses
 *      a framework whose Versions/Current is a directory rather than a
 *      link, so the flattened .app could never be signed or notarised even
 *      once a certificate exists.
 *
 * So the zip is rebuilt here with Info-ZIP's `--symlinks`, which stores a
 * symlink as a symlink, and latest-mac.yml — the file electron-updater
 * reads and whose sha512 it verifies before installing anything — is
 * rewritten to match the new bytes. Getting that hash wrong does not fail
 * loudly; it makes every future update refuse itself.
 *
 * Run after `npm run dist:mac`. On a Mac this script is unnecessary:
 * electron-builder uses `ditto` there, which keeps symlinks.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const DIST = path.join(ROOT, 'dist')
const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'))

/** dist/mac = x64, dist/mac-arm64 = arm64. The suffix matches what
 *  electron-builder names the asset, so latest-mac.yml stays truthful. */
const ARCHES = [
  { dir: 'mac', suffix: '' },
  { dir: 'mac-arm64', suffix: '-arm64' }
]

function sha512b64 (file) {
  return createHash('sha512').update(execFileSync('cat', [file], { maxBuffer: 1 << 30 })).digest('base64')
}

const built = []

for (const { dir, suffix } of ARCHES) {
  const appDir = path.join(DIST, dir)
  if (!existsSync(appDir)) continue
  const app = readdirSync(appDir).find((n) => n.endsWith('.app'))
  if (!app) continue

  // The name electron-builder itself publishes: spaces become dashes,
  // because that is what the GitHub release asset is called and what
  // electron-updater will ask for.
  const asset = `${pkg.productName.replace(/ /g, '-')}-${pkg.version}${suffix}-mac.zip`
  const out = path.join(DIST, asset)
  rmSync(out, { force: true })

  // -r recurse, -y store symlinks AS symlinks, -q quiet, -X drop the
  // extra platform attributes that are meaningless off macOS.
  execFileSync('zip', ['-r', '-y', '-q', '-X', out, app], { cwd: appDir, stdio: 'inherit' })

  const size = statSync(out).size
  built.push({ url: asset, sha512: sha512b64(out), size })
  console.log(`${asset}  ${(size / 1e6).toFixed(1)} MB`)
}

if (!built.length) {
  console.error('No packaged .app found under dist/ — run `npm run dist:mac` first.')
  process.exit(1)
}

// latest-mac.yml, in electron-updater's own shape. x64 first: it is the
// `path` at the bottom, which is the entry an older updater falls back to.
const lines = [
  `version: ${pkg.version}`,
  'files:',
  ...built.flatMap((f) => [
    `  - url: ${f.url}`,
    `    sha512: ${f.sha512}`,
    `    size: ${f.size}`
  ]),
  `path: ${built[0].url}`,
  `sha512: ${built[0].sha512}`,
  `releaseDate: '${new Date().toISOString()}'`,
  ''
]
writeFileSync(path.join(DIST, 'latest-mac.yml'), lines.join('\n'))
console.log('latest-mac.yml rewritten')
