/**
 * Decisive end-to-end check: load the Host half through a real Cordis Context
 * while the harness runtime interception is installed for the LIVE web profile,
 * then call the registered route and read the MCP projection.
 *
 * This exercises the exact condition the page runs under: the plugin performs
 * its own `await import('@deepseek-ai/dsh-app-boot')` from inside the linked
 * bundle directory.
 */
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const CLI_ANCHOR = 'D:/ProgramFiles/HarnessProject/deepseek-harness/apps/cli/package.json'
const LINKED_DIR = 'D:/ProgramFiles/HarnessProject/deepseek-harness/local/dsh-settings-inventory'

const requireCli = createRequire(CLI_ANCHOR)
const boot = await import(pathToFileURL(requireCli.resolve('@deepseek-ai/dsh-app-boot')).href)
const { Context } = await import(pathToFileURL(requireCli.resolve('@deepseek-ai/cordis')).href)

// The live web profile, composed exactly as boot composes it.
const profile = boot.loadProfile('dsh-settings-inventory', 'web', CLI_ANCHOR)
const resolution = await boot.createRuntimeResolution({ installAnchor: CLI_ANCHOR, profile })
const launcher = {
  name: 'web', dir: profile.dir, patchPath: profile.patchPath, installAnchor: CLI_ANCHOR,
  home: 'C:\\Users\\Administrator\\.dsh', startedBundles: [], overlays: [],
  telemetryDisabledEnv: undefined, cwd: process.cwd(),
}

const ctx = new Context()
// Install the real interception the way the boot plugin does.
ctx.plugin(boot.PluginPackages, { resolution })
await new Promise(r => setTimeout(r, 100))

// The three services the Host half reads.
ctx.provide('loader', { entries: () => [] })
ctx.provide('profileContext', launcher)
const routes = new Map()
ctx.provide('connection', {
  fetch: {
    register(route) {
      routes.set(route.path, route)
      return Promise.resolve(() => { routes.delete(route.path) })
    },
  },
})

// Load the plugin the way the Loader does: by URL, from the profile's base URL.
const pluginUrl = pathToFileURL(join(profile.dir, 'node_modules/@local/dsh-settings-inventory/index.js')).href
const plugin = await import(pluginUrl)
ctx.plugin(plugin)
await new Promise(r => setTimeout(r, 100))

const route = routes.get('/api/dsh-inventory')
if (route === undefined) {
  console.log('FAIL: route not registered')
  process.exit(1)
}
console.log('route registered:', route.path, route.methods)

const response = await route.fetch(new Request('http://dsh.internal/api/dsh-inventory?endpoint=mcp'))
const body = await response.json()
console.log('\nHTTP', response.status)
console.log('otherProfilesUnavailable =', JSON.stringify(body.otherProfilesUnavailable ?? null))
console.log('unreadableProfiles        =', JSON.stringify(body.unreadableProfiles ?? []))
console.log('\nservers:')
for (const s of body.servers) {
  console.log(`  ${s.serverName.padEnd(12)} origin=${s.origin.padEnd(14)} profile=${String(s.originLabel).padEnd(10)} cmd=${s.command}`)
}

const names = body.servers.map(s => s.serverName)
console.log('\n=== ASSERTIONS ===')
const pass = (label, ok) => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
pass('x64dbg present', names.includes('x64dbg'))
pass('idalib present', names.includes('idalib'))
pass('other-profile reader did NOT fail', body.otherProfilesUnavailable === null || body.otherProfilesUnavailable === undefined)
pass('no unreadable profiles', (body.unreadableProfiles ?? []).length === 0)

ctx.fiber.dispose()
