// Sanity-check the committed runtime artifacts against the manifest.
import { readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const failures = []

for (const path of [manifest.main, manifest.exports['./client'], manifest.dsh.bundle.patch]) {
  try { await stat(resolve(root, path)) } catch { failures.push(`missing ${path}`) }
}

const client = await readFile(resolve(root, 'lib/client.js'), 'utf8')
if (!client.includes(`window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}`)) {
  failures.push('lib/client.js does not register a factory under the package name')
}
if (/^\s*(import|export)\s/m.test(client)) failures.push('lib/client.js contains ESM syntax')
for (const match of client.matchAll(/require\("([^"]+)"\)/g)) {
  if (!/^(react|react\/jsx-runtime|react-dom|react-dom\/client|@deepseek-ai\/(cordis|dsh-client-store|dsh-client-ui-slots|dsh-client-ui-primitives|dsh-client-ui-dockkit)|zod|@tanstack\/react-virtual)$/.test(match[1])) {
    failures.push(`lib/client.js requires non-platform module ${match[1]}`)
  }
}

const host = await readFile(resolve(root, 'lib/index.js'), 'utf8')
for (const match of host.matchAll(/from\s+"([^"]+)"/g)) {
  if (match[1].startsWith('.')) failures.push(`lib/index.js keeps relative import ${match[1]}`)
}

const patch = await readFile(resolve(root, manifest.dsh.bundle.patch), 'utf8')
if (!patch.includes(`name: ${manifest.name}`)) failures.push('cordis.patch.yml row does not name the package')

if (failures.length > 0) {
  console.error(failures.map(f => `✗ ${f}`).join('\n'))
  process.exit(1)
}
console.log('✓ artifacts consistent with package.json')
