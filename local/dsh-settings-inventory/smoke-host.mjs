/**
 * Local smoke check for the Host half of the settings inventory bundle. It
 * executes index.js, registers the plugin against a Cordis context carrying
 * stubbed Loader/skills/presets/tools services, then calls both RPC projections
 * and checks the emitted rows against the facts those stubs published.
 *
 * This is the only way to exercise the projection without a live Host, because
 * the real services are process-global and a bare context carries none of them.
 *
 * Development-only; not shipped.
 */
import { readFileSync } from 'node:fs'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'

// ---- fixture home ----
//
// `loadProfileDirectory` is the launcher's own reader, so the cross-profile path
// needs a real on-disk home: professional-grade fixtures here would only test
// this harness, and the reader is production code.
const fixtureHome = mkdtempSync(join(tmpdir(), 'dsh-inventory-smoke-'))
function writeProfile(name, patchBody) {
  const dir = join(fixtureHome, 'profiles', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `dsh-profile-${name}`, private: true, dependencies: {}, dsh: { profile: { bundles: [] } } }, null, 2))
  writeFileSync(join(dir, 'cordis.patch.yml'), patchBody)
  return dir
}
writeProfile('this-profile', '# the profile under test; carries no MCP row\n[]\n')
writeProfile('other-toolbox', [
  '# another profile: two MCP servers, one disabled',
  '- insert:',
  '    - id: mcp-remote-one',
  '      name: \'@deepseek-ai/dsh-mcp-client\'',
  '      config:',
  '        serverName: remoteone',
  '        transport: stdio',
  '        command: node',
  '        args: [ server.js ]',
  '        env:',
  '          REMOTE_KEY: placeholder',
  '        toolCallTimeoutMs: 45000',
  '        failOnStartupError: true',
  '    - id: mcp-remote-two',
  '      name: \'@deepseek-ai/dsh-mcp-client\'',
  '      disabled: true',
  '      config:',
  '        serverName: remotetwo',
  '        transport: streamable-http',
  '        url: https://remote.example/mcp',
  '',
].join('\n'))
// A malformed profile must be contained, not fatal.
writeProfile('broken-profile', '- insert:\n  - id: [unclosed\n')
// A directory with no manifest is not a profile and must be skipped silently.
mkdirSync(join(fixtureHome, 'profiles', 'not-a-profile'), { recursive: true })

const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8')
const plugin = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`)
}

console.log('exports:', Object.keys(plugin).sort().join(','))
console.log('name:', plugin.name, '| inject:', JSON.stringify(plugin.inject))

// ---- stub services ----

/**
 * Loader entries: one enabled MCP stdio server, one disabled HTTP server, plus noise.
 *
 * Shaped like the real `Entry`: `id` is a getter over `options.id`, and
 * `disabled` is an inherited getter. Modelling both matters, because the
 * projection reads `entry.id` and `entry.disabled`, not the raw options.
 */
function entry(options, { disabled = false, fiber } = {}) {
  return {
    options,
    get id() { return options.id },
    get disabled() { return disabled },
    ...(fiber === undefined ? {} : { fiber }),
  }
}

const entries = [
  entry({ id: 'ui-theme', name: '@deepseek-ai/dsh-client-ui-theme' }),
  entry({
    id: 'mcp-memory',
    name: '@deepseek-ai/dsh-mcp-client',
    config: {
      transport: 'stdio',
      serverName: 'memory',
      command: 'node',
      args: ['server.js', '--port', '1'],
      env: { MEMORY_API_KEY: '!!js ctx.get("k")', OTHER: 'x' },
      toolCallTimeoutMs: 60000,
      failOnStartupError: true,
    },
  }, { fiber: { state: 2 } }),
  entry({
    id: 'mcp-docs',
    name: '@deepseek-ai/dsh-mcp-client',
    config: { transport: 'streamable-http', serverName: 'docs', url: 'https://docs.example/mcp', headers: { Authorization: 'Bearer x' } },
  }, { disabled: true }),
  entry({ id: 'some-group', name: 'cordis:group', group: true }),
  entry({
    id: 'mcp-broken',
    name: '@deepseek-ai/dsh-mcp-client',
    config: { transport: 'stdio', serverName: 42 },
  }),
]

const skillCalls = []
const globalSkills = [
  {
    name: 'dsh-badge', description: 'Badge skill.', invocation: { modelInvocable: true, userInvocable: true },
    source: 'bundled', provider: 'dsh-badge',
  },
]
/** Per-scope catalogs: the Cordis preset contributes three authoring skills. */
const scopedSkills = {
  standard: [{
    name: 'dsh-badge', description: 'Badge skill.', invocation: { modelInvocable: true, userInvocable: true },
    source: 'bundled', provider: 'dsh-badge',
  }],
  cordis: [
    {
      name: 'cordis-plugin-development', description: 'Develop plugins.',
      whenToUse: 'When writing a plugin.', path: 'D:\\p\\SKILL.md',
      invocation: { modelInvocable: true, userInvocable: true }, source: 'custom', provider: 'filesystem',
    },
    {
      name: 'editing-cordis-compositions', description: 'Edit compositions.',
      invocation: { modelInvocable: false, userInvocable: true }, source: 'custom', provider: 'filesystem',
    },
  ],
}

const skillRegistry = {
  async snapshot(options) {
    skillCalls.push({ kind: 'snapshot', scope: options.scope === undefined ? null : 'scoped', cwd: options.cwd })
    return { skills: globalSkills, complete: true }
  },
  async list(options) {
    skillCalls.push({ kind: 'list', scope: options.scope === undefined ? null : 'scoped', cwd: options.cwd })
    if (options.scope === undefined) return globalSkills
    // Keyed by the scope the registry was handed, so each preset reads its own
    // layer the way the real registry merges global + that scope's chain.
    const id = String(options.scope.id).replace('scope:', '')
    return [...globalSkills, ...(scopedSkills[id] ?? [])]
  },
}

const acquired = []
const presets = {
  async list() {
    return [
      { id: 'standard', name: 'Standard', order: 1 },
      { id: 'cordis', name: 'Cordis', order: 4 },
      { id: 'broken-one', broken: 'row failed', order: 5 },
    ]
  },
  async acquireScope(id) {
    if (id === 'broken-one') throw new Error('agent-preset/invalid')
    acquired.push(id)
    return {
      key: { id: `scope:${id}` },
      async [Symbol.asyncDispose]() { acquired.push(`dispose:${id}`) },
    }
  },
  async compositionInventory() {
    return [{
      id: 'cordis', name: 'Cordis', isDefault: false,
      rows: [
        { entryId: 'mcp-preset-docs', moduleName: '@deepseek-ai/dsh-mcp-client', enabled: true, fiberState: 2 },
        { entryId: 'cond', moduleName: '@deepseek-ai/dsh-mcp-client', enabled: 'conditional', condition: "ctx.get('x')" },
        { entryId: 'other', moduleName: '@deepseek-ai/dsh-tool-web', enabled: true },
      ],
    }]
  },
}

const toolSchemas = [
  { name: 'mcp__memory__search' },
  { name: 'mcp__memory__store' },
  { name: 'mcp__docs__read' },
  { name: 'read' },
  { name: 'mcp__malformed' },
]
// The same composed server appears in every preset scope, so a scoped read
// repeats its tools; the projection must report each name once.
const scopedToolSchemas = [
  { name: 'mcp__memory__search' },
  { name: 'mcp__memory__store' },
  { name: 'read' },
]

// ---- register and call ----

// The Host half registers one authenticated Fetch route; this records it so the
// harness can invoke the handler directly with a synthesized Request.
const root = new Context()
const routes = new Map()
root.provide('loader', { entries() { return entries } })
root.provide('skills', skillRegistry)
root.provide('agentPresets', presets)
root.provide('tools', { schemas(scope) { return scope === undefined ? toolSchemas : scopedToolSchemas } })
root.provide('connection', {
  fetch: {
    register(route) {
      routes.set(route.path, route)
      return Promise.resolve(() => { routes.delete(route.path) })
    },
  },
})
// Without `home` the cross-profile reader returns nothing, which is the correct
// behaviour for a composition booted outside a launcher. Point it at a fixture
// home so the other-profile path is exercised rather than silently skipped.
root.provide('profileContext', {
  name: 'this-profile', dir: join(fixtureHome, 'profiles', 'this-profile'),
  patchPath: join(fixtureHome, 'profiles', 'this-profile', 'cordis.patch.yml'),
  installAnchor: join(fixtureHome, 'anchor', 'package.json'),
  startedBundles: [], cwd: process.cwd(), home: fixtureHome,
  overlays: [], telemetryDisabledEnv: undefined,
})

const fiber = root.plugin(plugin)
await new Promise(resolve => setTimeout(resolve, 50))

console.log('\nroutes:', [...routes.keys()].join(','))
const route = routes.get('/api/dsh-inventory')
check('exactly one route registered', routes.size, 1)
check('route accepts GET', route.methods, ['GET'])
check('route buffers no body', route.requestBody, 'buffered')

/** Invoke the registered route the way Connection's shared channel would. */
const call = async (endpoint, cwd) => {
  const query = new URLSearchParams({ endpoint })
  if (cwd !== undefined) query.set('cwd', cwd)
  const response = await route.fetch(new Request(`http://dsh.internal/api/dsh-inventory?${query.toString()}`))
  return { status: response.status, body: response.status === 200 ? await response.json() : await response.text() }
}

// ---- skills projection ----

const skills = await call('skills', 'D:\\work')
console.log('\n--- skills ---')
check('skills HTTP 200', skills.status, 200)
const skillsValue = skills.body
check('skills available', skillsValue.available, true)
check('skills cwd echoed', skillsValue.cwd, 'D:\\work')
check('skills complete', skillsValue.complete, true)
check('each usable preset leased then disposed, broken one skipped', acquired,
  ['standard', 'dispose:standard', 'cordis', 'dispose:cordis'])
check('scopes', skillsValue.scopes, [
  { id: 'standard', name: 'Standard', broken: null },
  { id: 'cordis', name: 'Cordis', broken: null },
  { id: 'broken-one', name: null, broken: 'row failed' },
])
check('merged names sorted', skillsValue.entries.map(entry => entry.name), [
  'cordis-plugin-development', 'dsh-badge', 'editing-cordis-compositions',
])
const badge = skillsValue.entries.find(entry => entry.name === 'dsh-badge')
// A global-layer skill is visible in every scope, so the row records each one.
check('badge is one row carrying every scope that exposes it', badge.scopeIds, ['(global)', 'standard', 'cordis'])
const pluginDev = skillsValue.entries.find(entry => entry.name === 'cordis-plugin-development')
check('plugin skill scope', pluginDev.scopeIds, ['cordis'])
check('plugin skill path', pluginDev.path, 'D:\\p\\SKILL.md')
check('plugin skill whenToUse', pluginDev.whenToUse, 'When writing a plugin.')
const editing = skillsValue.entries.find(entry => entry.name === 'editing-cordis-compositions')
check('model-invocable false survives', editing.modelInvocable, false)
check('user-invocable true survives', editing.userInvocable, true)
console.log('skill calls:', JSON.stringify(skillCalls))

// ---- mcp projection ----

const mcp = await call('mcp')
console.log('\n--- mcp ---')
check('mcp HTTP 200', mcp.status, 200)
const mcpValue = mcp.body
const profileRows = mcpValue.servers.filter(row => row.origin === 'profile')
const presetRows = mcpValue.servers.filter(row => row.origin === 'preset')
check('group row skipped', profileRows.some(row => row.entryId === 'some-group'), false)
check('profile rows', profileRows.map(row => row.entryId), ['mcp-memory', 'mcp-docs', 'mcp-broken'])
check('preset rows', presetRows.map(row => row.entryId), ['mcp-preset-docs', 'cond'])

const memory = profileRows[0]
check('memory serverName', memory.serverName, 'memory')
check('memory transport', memory.transport, 'stdio')
check('memory enabled', memory.enabled, true)
check('memory phase active', memory.phase, 'active')
check('memory command', memory.command, 'node server.js --port 1')
check('memory env names only (values withheld)', memory.envNames, ['MEMORY_API_KEY', 'OTHER'])
check('memory url empty for stdio', memory.url, '')
check('memory timeout', memory.toolCallTimeoutMs, 60000)
check('memory failOnStartupError', memory.failOnStartupError, true)
check('memory tools attached', memory.tools, ['mcp__memory__search', 'mcp__memory__store'])
check('tools deduped across scopes', memory.tools.length, new Set(memory.tools).size)

const docs = profileRows[1]
check('docs disabled', docs.enabled, false)
check('docs transport', docs.transport, 'streamable-http')
check('docs url', docs.url, 'https://docs.example/mcp')
check('docs header names only', docs.headerNames, ['Authorization'])
check('docs command empty for http', docs.command, '')
check('docs tools attached by serverName', docs.tools, ['mcp__docs__read'])

const broken = profileRows[2]
// A malformed declared value is reported verbatim: the page shows what the file
// says, and the reader can see the config is wrong. Only a missing name falls
// back to a placeholder.
check('numeric serverName reported verbatim', broken.serverName, '42')
check('broken row still listed', broken.enabled, true)

const presetRow = presetRows[0]
check('preset row origin label', presetRow.originLabel, 'Cordis')
check('preset row has no invented config', [presetRow.transport, presetRow.command, presetRow.url], ['', '', ''])
check('preset row condition empty when plain enabled', presetRow.condition, '')
const condRow = presetRows[1]
check('conditional preset row', condRow.conditional, "ctx.get('x')")
check('conditional preset row enabled stays true (not a literal disable)', condRow.enabled, true)

// ---- other profiles ----

console.log('\n--- other profiles ---')
const otherRows = mcpValue.servers.filter(row => row.origin === 'other-profile')
check('other-profile servers found', otherRows.map(row => row.serverName), ['remoteone', 'remotetwo'])
check('the active profile is not scanned twice', otherRows.some(row => row.originLabel === 'this-profile'), false)
check('a directory without a manifest is skipped', otherRows.some(row => row.originLabel === 'not-a-profile'), false)
check('a malformed profile is contained, not fatal',
  (mcpValue.unreadableProfiles ?? []).map(entry => entry.name), ['broken-profile'])
check('a malformed profile reports why it could not be read',
  typeof (mcpValue.unreadableProfiles ?? [])[0]?.reason === 'string'
    && (mcpValue.unreadableProfiles ?? [])[0].reason.length > 0, true)
check('the other-profile reader ran, so it reports no launch failure', mcpValue.otherProfilesUnavailable, null)

const remoteOne = otherRows[0]
check('other-profile origin label', remoteOne.originLabel, 'other-toolbox')
check('other-profile command', remoteOne.command, 'node server.js')
check('other-profile env names only', remoteOne.envNames, ['REMOTE_KEY'])
check('other-profile env values withheld', JSON.stringify(remoteOne).includes('placeholder'), false)
check('other-profile has no tools', remoteOne.tools, [])
check('other-profile timeout', remoteOne.toolCallTimeoutMs, 45000)
check('other-profile failOnStartupError', remoteOne.failOnStartupError, true)

const remoteTwo = otherRows[1]
check('disabled other-profile row reported disabled', remoteTwo.enabled, false)
check('other-profile http url', remoteTwo.url, 'https://remote.example/mcp')

// A server mounted here must not also appear as an other-profile row.
check('mounted servers are not duplicated as other-profile rows',
  otherRows.some(row => row.serverName === 'memory' || row.serverName === 'docs'), false)

// A composition without the launcher facts reports no other-profile rows rather
// than failing: booting outside a launcher is a supported composition.
const bareRoot = new Context()
const bareRoutes = new Map()
bareRoot.provide('loader', { entries() { return entries } })
bareRoot.provide('connection', { fetch: { register(r) { bareRoutes.set(r.path, r); return Promise.resolve(() => {}) } } })
bareRoot.provide('tools', { schemas() { return [] } })
const bareFiber = bareRoot.plugin(plugin)
await new Promise(resolve => setTimeout(resolve, 50))
const bareRoute = bareRoutes.get('/api/dsh-inventory')
const bareMcp = await (await bareRoute.fetch(new Request('http://dsh.internal/api/dsh-inventory?endpoint=mcp'))).json()
check('without launcher facts, mounted rows still report', bareMcp.servers.length, 3)
check('without launcher facts, no other-profile rows', bareMcp.servers.filter(r => r.origin === 'other-profile').length, 0)
// Booting outside a launcher is a supported composition and is NOT a failure:
// the reader is simply absent, so the page has nothing to warn about.
check('without launcher facts, the reader is not reported as failed', bareMcp.otherProfilesUnavailable, null)
await bareFiber.dispose()

// A home whose profiles directory cannot be listed must say so. Regression for
// the defect where the reader's import failed and the catch returned an empty
// list, which the page rendered as "no server is configured anywhere".
const unreadableHome = mkdtempSync(join(tmpdir(), 'dsh-inventory-unreadable-'))
// A regular FILE where the profiles directory belongs makes readdirSync throw
// ENOTDIR, which is not the ENOENT of a genuinely profile-less home.
writeFileSync(join(unreadableHome, 'profiles'), 'not a directory\n')
const unreadableHomeRoot = new Context()
const unreadableHomeRoutes = new Map()
unreadableHomeRoot.provide('loader', { entries() { return entries } })
unreadableHomeRoot.provide('connection', {
  fetch: { register(r) { unreadableHomeRoutes.set(r.path, r); return Promise.resolve(() => {}) } },
})
unreadableHomeRoot.provide('tools', { schemas() { return [] } })
unreadableHomeRoot.provide('profileContext', {
  name: 'this-profile', dir: join(unreadableHome, 'profiles', 'this-profile'),
  patchPath: join(unreadableHome, 'profiles', 'this-profile', 'cordis.patch.yml'),
  installAnchor: join(unreadableHome, 'anchor', 'package.json'),
  startedBundles: [], cwd: process.cwd(), home: unreadableHome,
  overlays: [], telemetryDisabledEnv: undefined,
})
const unreadableHomeFiber = unreadableHomeRoot.plugin(plugin)
await new Promise(resolve => setTimeout(resolve, 50))
const unreadableRoute = unreadableHomeRoutes.get('/api/dsh-inventory')
const unreadableBody = await (await unreadableRoute.fetch(
  new Request('http://dsh.internal/api/dsh-inventory?endpoint=mcp'))).json()
check('an unreadable other-profile read is reported, never silently empty',
  typeof unreadableBody.otherProfilesUnavailable === 'string'
    && unreadableBody.otherProfilesUnavailable.length > 0, true)
await unreadableHomeFiber.dispose()
rmSync(unreadableHome, { recursive: true, force: true })

// A launch overlay belongs to THIS process, never to another profile being read.
// Regression for `{ ...launcher }` carrying `overlays` into a foreign profile's
// composition, which would attribute this launch's --patch rows to that profile.
const overlayRoot = new Context()
const overlayRoutes = new Map()
overlayRoot.provide('loader', { entries() { return entries } })
overlayRoot.provide('connection', {
  fetch: { register(r) { overlayRoutes.set(r.path, r); return Promise.resolve(() => {}) } },
})
overlayRoot.provide('tools', { schemas() { return [] } })
overlayRoot.provide('profileContext', {
  name: 'this-profile', dir: join(fixtureHome, 'profiles', 'this-profile'),
  patchPath: join(fixtureHome, 'profiles', 'this-profile', 'cordis.patch.yml'),
  installAnchor: join(fixtureHome, 'anchor', 'package.json'),
  startedBundles: [], cwd: process.cwd(), home: fixtureHome,
  // A launch overlay that would add an MCP row if it leaked into other profiles.
  overlays: [{
    insert: [{
      id: 'mcp-launch-overlay',
      name: '@deepseek-ai/dsh-mcp-client',
      config: { serverName: 'leaked-overlay', transport: 'stdio', command: 'leak' },
    }],
  }],
  telemetryDisabledEnv: undefined,
})
const overlayFiber = overlayRoot.plugin(plugin)
await new Promise(resolve => setTimeout(resolve, 50))
const overlayRoute = overlayRoutes.get('/api/dsh-inventory')
const overlayBody = await (await overlayRoute.fetch(
  new Request('http://dsh.internal/api/dsh-inventory?endpoint=mcp'))).json()
check("this launch's overlay is not attributed to another profile",
  overlayBody.servers.some(server => server.serverName === 'leaked-overlay'), false)
await overlayFiber.dispose()

// ---- error paths ----

console.log('\n--- error paths ---')
const unknown = await call('unknown')
check('unknown endpoint is 404', unknown.status, 404)
check('unknown endpoint names the problem', unknown.body, 'unknown inventory endpoint')
check('missing endpoint is 404', (await call('')).status, 404)
const noCwd = await call('skills')
check('skills without cwd still answers', noCwd.status, 200)
check('skills without cwd reports no project roots', noCwd.body.cwd, null)
const percentCwd = await call('skills', 'D:/work with spaces')
check('cwd round-trips through the query string', percentCwd.body.cwd, 'D:/work with spaces')

// A failing skill registry answers 500, which the page reports with its retry.
const failingRoot = new Context()
const failingRoutes = new Map()
failingRoot.provide('loader', { entries() { return entries } })
failingRoot.provide('connection', {
  fetch: { register(r) { failingRoutes.set(r.path, r); return Promise.resolve(() => {}) } },
})
failingRoot.provide('skills', {
  async snapshot() { throw new Error('provider exploded') },
  async list() { return [] },
})
await failingRoot.plugin(plugin)
await new Promise(resolve => setTimeout(resolve, 50))
const failingRoute = failingRoutes.get('/api/dsh-inventory')
const failingResponse = await failingRoute.fetch(new Request('http://dsh.internal/api/dsh-inventory?endpoint=skills'))
check('a failing registry answers 500', failingResponse.status, 500)
check('the 500 carries the reason', (await failingResponse.json()).error, 'provider exploded')
await failingRoot.stop?.()

// ---- disposal ----

console.log('\n--- disposal ---')
await fiber.dispose()
check('route removed on dispose', routes.size, 0)
rmSync(fixtureHome, { recursive: true, force: true })
check('fixture home removed', existsSync(fixtureHome), false)

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`}`)
process.exitCode = failures === 0 ? 0 : 1
