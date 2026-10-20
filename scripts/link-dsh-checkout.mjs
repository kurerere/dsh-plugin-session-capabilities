// Dev helper: resolve this plugin's dsh devDependencies from a local
// deepseek-harness checkout instead of npm, so typecheck runs against the
// exact sources you will boot with `pnpm dsh --profile web --patch`.
//
//   node scripts/link-dsh-checkout.mjs /path/to/deepseek-harness
//
// Requires `pnpm install && pnpm run build` in the checkout (published type
// entries live under lib/types). Creates node_modules/<name> symlinks only.

import { readdir, readFile, mkdir, rm, symlink, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(process.argv[2] ?? process.env.DSH_REPO ?? '../deepseek-harness')
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const wanted = new Set(Object.keys(manifest.devDependencies))

async function exists(path) {
  try { await stat(path); return true } catch { return false }
}

/** name → directory for every workspace package in the checkout. */
const located = new Map()
for (const group of ['vendor', 'packages', 'apps']) {
  const base = join(repo, group)
  if (!await exists(base)) continue
  for (const a of await readdir(base, { withFileTypes: true })) {
    if (!a.isDirectory()) continue
    const candidates = group === 'packages'
      ? (await readdir(join(base, a.name), { withFileTypes: true })).filter(d => d.isDirectory()).map(d => join(base, a.name, d.name))
      : [join(base, a.name)]
    for (const dir of candidates) {
      try {
        const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
        if (typeof pkg.name === 'string') located.set(pkg.name, dir)
      } catch { /* not a package */ }
    }
  }
}

/** Fall back to the checkout's virtual store for packages pnpm did not hoist to the root. */
async function fromPnpmStore(name) {
  const store = join(repo, 'node_modules', '.pnpm')
  if (!await exists(store)) return undefined
  const prefix = `${name.replace('/', '+')}@`
  const hits = (await readdir(store)).filter(dir => dir.startsWith(prefix)).sort()
  for (const dir of hits.reverse()) {
    const candidate = join(store, dir, 'node_modules', name)
    if (await exists(candidate)) return candidate
  }
  return undefined
}

let linked = 0
for (const name of wanted) {
  let target = located.get(name)
  // Third-party tooling (react, typescript, esbuild, @types/*) comes from the checkout's root install.
  if (target === undefined && await exists(join(repo, 'node_modules', name))) target = join(repo, 'node_modules', name)
  if (target === undefined) target = await fromPnpmStore(name)
  if (target === undefined) {
    console.warn(`! ${name}: not found in ${repo}`)
    continue
  }
  const link = join(root, 'node_modules', name)
  await mkdir(dirname(link), { recursive: true })
  await rm(link, { recursive: true, force: true })
  await symlink(target, link, 'dir')
  linked += 1
}
// tsc / esbuild binaries for `pnpm run typecheck` / `build` without an npm install.
await mkdir(join(root, 'node_modules', '.bin'), { recursive: true })
for (const [bin, rel] of [['tsc', 'typescript/bin/tsc'], ['esbuild', 'esbuild/bin/esbuild']]) {
  const link = join(root, 'node_modules', '.bin', bin)
  await rm(link, { force: true })
  await symlink(join(root, 'node_modules', rel), link)
}
console.log(`linked ${linked}/${wanted.size} devDependencies from ${repo}`)
