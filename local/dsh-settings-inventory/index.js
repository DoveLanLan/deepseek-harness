/**
 * Read-only Host half of the Settings inventory pages: projects the skills this
 * deployment makes visible, and the MCP servers its composition mounts, onto one
 * authenticated RPC channel the browser half reads.
 *
 * Every fact is read at call time from live services (`ctx.skills`,
 * `ctx.agentPresets`, `ctx.loader`, `ctx.tools`); nothing is cached, because a
 * profile patch, a bundle install, or a skill directory can change any of it
 * between two openings of the Settings panel.
 *
 * Two planes carry the facts, and the projection keeps them apart:
 * `ctx.loader.entries()` reaches the profile plane, while a preset's rows live in
 * its own Loader tree — deliberately detached from the owner entry's subtree — so
 * the preset plane is read through `compositionInventory()` and through preset
 * scope leases. A page that reported only one plane would miss the other.
 *
 * Secret-bearing configuration (a stdio server's `env`, an HTTP server's
 * `headers`) never crosses this channel. Only those entries' names travel, so the
 * page can report that a server receives credentials without the value leaving
 * the Host process.
 *
 * @module @local/dsh-settings-inventory
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-settings-inventory'

/**
 * Required services.
 *
 * `connection` supplies the authenticated Fetch-route registry this plugin's one
 * endpoint is mounted on, and `loader` supplies the composition projections. No
 * `webServer`: `connection.fetch.register` owns its own route bookkeeping, unlike
 * `connection.rpc.handle`, which registers an HTTP route through the CALLER's
 * context and therefore additionally requires that context to inject `webServer`.
 */
export const inject = ['loader', 'connection']

/** Authenticated Fetch-route path below `/api`; the browser half fetches it same-origin. */
const ROUTE_PATH = '/api/dsh-inventory'

/** The one module a composed MCP server is built from. */
const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client'

/** Public MCP tool-name prefix: `mcp__<serverName>__<rawName>`. */
const MCP_TOOL_PREFIX = 'mcp__'

/** The scope label a skill visible without any preset scope carries. */
const GLOBAL_SCOPE = '(global)'

/** Fiber states by their numeric value, because the enum is compile-time only. */
const FIBER_PHASE = {
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  4: null,
  5: 'unloading',
}

/**
 * Register the authenticated inventory route. Connection's shared `/api` channel
 * applies the Host/Origin fence and browser authentication before this handler
 * runs, then hands it a Request whose query selects the projection.
 *
 * A GET with the project directory in `cwd` keeps every response JSON without a
 * preflight, and an unknown `endpoint` is refused as a 404.
 *
 * @param ctx - Host context carrying the composition projections.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const query = new URL(request.url).searchParams
      const endpoint = query.get('endpoint')
      const cwd = query.get('cwd')
      const request_ = cwd === null || cwd === '' ? {} : { cwd }
      try {
        if (endpoint === 'skills') return json(await readSkills(ctx, request_, request.signal))
        if (endpoint === 'mcp') return json(await readMcpServers(ctx, request_, request.signal))
        return new Response('unknown inventory endpoint', { status: 404 })
      } catch (error) {
        return json({ error: describeError(error) }, 500)
      }
    },
  }), 'dsh-settings-inventory: authenticated inventory route')
}

/**
 * Answer one projection as non-cacheable JSON.
 * @param value - the JSON-serializable projection.
 * @param status - the HTTP status to answer with.
 * @returns the response.
 */
function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } })
}

// ---- preset scopes ----

/**
 * Visit each usable preset's standing scope once, disposing the lease afterwards.
 * A broken preset has no revision to lease, and `acquireScope` refuses an unknown
 * id; either way the failure is skipped rather than failing the whole page,
 * because the roster already reports it.
 * @param presets - the preset registry service.
 * @param roster - presets to visit.
 * @param visit - receives each preset and its scope key.
 */
async function withPresetScopes(presets, roster, visit) {
  for (const preset of roster) {
    if (preset.broken !== undefined) continue
    let lease
    try {
      lease = await presets.acquireScope(preset.id)
    } catch {
      continue
    }
    try {
      await visit(preset, lease.key)
    } finally {
      await lease[Symbol.asyncDispose]()
    }
  }
}

// ---- skills ----

/**
 * Project the visible skill catalog across the global layer and every live preset
 * scope. One skill name may be visible through several presets; the row records
 * every scope exposing it instead of repeating the skill, because the registry
 * resolves shadowing per read and a name carries no scope identity of its own.
 *
 * `cwd` is optional but load-bearing: without it the filesystem provider skips the
 * project-local roots entirely, so project skills would silently vanish.
 *
 * @param ctx - Host context carrying the optional skill and preset registries.
 * @param request - the validated request, carrying the project directory when the page has one.
 * @param signal - caller lifetime, forwarded to every discovery read.
 * @returns the catalog projection, or an unavailable marker when no registry is composed.
 */
async function readSkills(ctx, request, signal) {
  const registry = ctx.get('skills')
  if (registry === undefined) {
    return {
      available: false,
      reason: 'no skill registry is composed: no row mounts @deepseek-ai/dsh-skill',
      cwd: request.cwd ?? null,
      scopes: [],
      entries: [],
    }
  }

  const presets = ctx.get('agentPresets')
  const roster = presets === undefined ? [] : await presets.list()
  const scopes = roster.map(preset => ({
    id: preset.id,
    name: preset.name ?? null,
    broken: preset.broken ?? null,
  }))

  const byName = new Map()
  const record = (skill, scopeId) => {
    const existing = byName.get(skill.name)
    if (existing !== undefined) {
      if (!existing.scopeIds.includes(scopeId)) existing.scopeIds.push(scopeId)
      return
    }
    byName.set(skill.name, {
      name: skill.name,
      description: skill.description,
      whenToUse: skill.whenToUse ?? null,
      path: skill.path ?? null,
      source: skill.source,
      provider: skill.provider,
      modelInvocable: skill.invocation.modelInvocable,
      userInvocable: skill.invocation.userInvocable,
      scopeIds: [scopeId],
    })
  }

  const global = await registry.snapshot({ ...request, signal })
  for (const skill of global.skills) record(skill, GLOBAL_SCOPE)

  if (presets !== undefined) {
    await withPresetScopes(presets, roster, async (preset, key) => {
      const skills = await registry.list({ ...request, scope: key, signal })
      for (const skill of skills) record(skill, preset.id)
    })
  }

  return {
    available: true,
    cwd: request.cwd ?? null,
    complete: global.complete,
    scopes,
    entries: [...byName.values()].sort((left, right) => compare(left.name, right.name)),
  }
}

// ---- MCP servers ----

/**
 * Project every MCP server reachable from this deployment, from three sources.
 *
 * 1. **Mounted** — the running composition (`ctx.loader.entries()`), which is what
 *    this profile can actually call, carrying its declared config.
 * 2. **Preset** — rows a preset's composition declares, read through the
 *    composition inventory, which reports a row's module, entry id, and
 *    enablement but not its config.
 * 3. **Other profiles** — rows configured in any other profile in this Harness
 *    home. These are NOT active here, and the rows say so, because "installed
 *    but not running in this profile" is exactly the fact a reader needs.
 *
 * The other-profile scan reads each profile the way the launcher composes it —
 * `loadProfileDirectory` (installed bundle layers plus the profile's own patch)
 * then `readProfilePatches` (adding the home layer and launch overlays) then
 * `composeEntries` — so it sees the same rows boot would, without mounting any
 * of it. A profile that cannot be read is reported, never fatal: one broken
 * profile must not hide the others.
 *
 * A `!!js` config value is reported as its expression source: the declared value
 * is what the patch file says, and evaluating a deployment expression here would
 * report a fact the file does not hold.
 *
 * @param ctx - Host context carrying the Loader, the optional tool registry, and the launcher profile facts.
 * @param request - the validated request; servers are deployment-wide.
 * @param signal - caller lifetime for the preset scope reads.
 * @returns the server projection, mounted rows first.
 */
async function readMcpServers(ctx, request, signal) {
  void request
  const toolNames = await mcpToolNames(ctx, signal)
  const servers = []
  const mountedNames = new Set()

  for (const entry of ctx.loader.entries()) {
    if (entry.options.group) continue
    if (entry.options.name !== MCP_CLIENT_MODULE) continue
    const config = isRecord(entry.options.config) ? entry.options.config : {}
    const serverName = text(config.serverName)
    mountedNames.add(serverName)
    servers.push({
      origin: 'profile',
      originLabel: null,
      entryId: entry.id,
      serverName: serverName === '' ? '(unnamed)' : serverName,
      transport: text(config.transport),
      enabled: !entry.disabled,
      // A profile row is enabled or disabled outright; the empty condition keeps
      // every plane's rows the same shape so the page reads one field.
      conditional: '',
      condition: '',
      phase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state] ?? null,
      command: compactCommand(config),
      url: config.transport === 'streamable-http' ? text(config.url) : '',
      envNames: Object.keys(isRecord(config.env) ? config.env : {}).sort(compare),
      headerNames: Object.keys(isRecord(config.headers) ? config.headers : {}).sort(compare),
      toolCallTimeoutMs: typeof config.toolCallTimeoutMs === 'number' ? config.toolCallTimeoutMs : null,
      failOnStartupError: config.failOnStartupError === true,
      tools: [],
    })
  }

  const others = await readOtherProfileServers(ctx)
  for (const server of others.servers) {
    // A server this profile already mounts is one row, not two: the mounted row
    // is the authoritative one, and its own tools are attached below.
    if (mountedNames.has(server.serverName)) continue
    servers.push(server)
  }
  const presets = ctx.get('agentPresets')
  if (presets !== undefined) {
    for (const composition of await presets.compositionInventory()) {
      for (const row of composition.rows) {
        if (row.moduleName !== MCP_CLIENT_MODULE) continue
        servers.push({
          origin: 'preset',
          originLabel: composition.name ?? composition.id,
          entryId: row.entryId,
          serverName: row.entryId ?? '(unnamed)',
          transport: '',
          enabled: row.enabled !== false,
          conditional: row.enabled === 'conditional' ? row.condition ?? '' : '',
          condition: row.enabled === 'conditional' ? row.condition ?? '' : '',
          phase: null,
          command: '',
          url: '',
          envNames: [],
          headerNames: [],
          toolCallTimeoutMs: null,
          failOnStartupError: false,
          tools: [],
        })
      }
    }
  }

  // Tool names are only meaningful for a server the current composition actually
  // activated, and they are keyed by `serverName`, so they attach to profile rows.
  for (const server of servers) {
    if (server.origin !== 'profile') continue
    server.tools = toolNames.get(server.serverName) ?? []
  }

  return {
    available: true,
    servers,
    unreadableProfiles: others.unreadable,
    otherProfilesUnavailable: others.unavailable ?? null,
  }
}

// ---- other profiles ----

/**
 * Read the MCP servers every OTHER profile in this Harness home composes.
 *
 * The launcher's own readers are reused rather than reimplementing the YAML
 * dialect and layer order, so this sees exactly the rows boot would:
 * `loadProfileDirectory` resolves each installed bundle's patch plus the
 * profile's own layer, `readProfilePatches` adds the home layer and launch
 * overlays, and `composeEntries` applies inserts and id-targeted overrides.
 * Nothing mounts; these are pure reads.
 *
 * One unreadable profile yields a diagnostic entry and does not affect the rest.
 *
 * @param ctx - Host context carrying the launcher profile facts.
 * @returns configured server rows and the names of profiles that could not be read.
 */
async function readOtherProfileServers(ctx) {
  const launcher = ctx.get('profileContext')
  const home = launcher?.home
  if (launcher === undefined || home === undefined) return { servers: [], unreadable: [] }

  let modules
  let paths
  try {
    modules = await import('@deepseek-ai/dsh-app-boot')
    paths = await import('node:path')
  } catch (error) {
    // The launcher's profile readers are reachable only through the Harness
    // runtime resolution, which routes a linked bundle's imports only for the
    // packages its own manifest declares as peers. Without them this read
    // cannot run, and reporting nothing would silently contradict the page's
    // promise, so the failure travels to the reader.
    return {
      servers: [],
      unreadable: [],
      unavailable: describeError(error),
    }
  }

  const files = await import('node:fs')
  const profilesDir = paths.join(home, modules.PROFILES_DIR)
  const servers = []
  const unreadable = []
  let candidates
  try {
    candidates = files.readdirSync(profilesDir, { withFileTypes: true })
  } catch (error) {
    // A Harness home with no profiles directory holds no other profile, which
    // is a fact about the home rather than a server list this page owes.
    if (error?.code === 'ENOENT') return { servers: [], unreadable: [] }
    return { servers: [], unreadable: [], unavailable: describeError(error) }
  }

  for (const candidate of candidates) {
    if (!candidate.isDirectory() || candidate.name === launcher.name) continue
    const dir = paths.join(profilesDir, candidate.name)
    // A directory without a manifest is not a profile; skip it silently.
    if (!files.existsSync(paths.join(dir, 'package.json'))) continue

    // A launch overlay belongs to the process this plugin runs in, not to the
    // profile being read: carrying `overlays` over from the launcher would
    // attribute this launch's `--patch` rows to a different profile, which is
    // exactly the wrong answer for a page whose job is telling profiles apart.
    const context = {
      ...launcher,
      name: candidate.name,
      dir,
      patchPath: paths.join(dir, modules.PROFILE_PATCH_FILENAME),
      overlays: [],
    }
    let rows
    try {
      const loaded = modules.loadProfileDirectory('dsh-settings-inventory', dir, launcher.installAnchor)
      rows = modules.composeEntries(modules.readProfilePatches('dsh-settings-inventory', context, loaded))
    } catch (error) {
      // A profile that cannot be composed is reported with its reason rather
      // than failing the whole page; the other profiles still render.
      unreadable.push({ name: candidate.name, reason: describeError(error) })
      continue
    }

    for (const row of rows) {
      if (row.group === true) continue
      if (row.name !== MCP_CLIENT_MODULE) continue
      const config = isRecord(row.config) ? row.config : {}
      const serverName = text(config.serverName)
      servers.push({
        origin: 'other-profile',
        originLabel: candidate.name,
        entryId: typeof row.id === 'string' ? row.id : null,
        serverName: serverName === '' ? '(unnamed)' : serverName,
        transport: text(config.transport),
        enabled: row.disabled !== true,
        conditional: '',
        condition: '',
        phase: null,
        command: compactCommand(config),
        url: config.transport === 'streamable-http' ? text(config.url) : '',
        envNames: Object.keys(isRecord(config.env) ? config.env : {}).sort(compare),
        headerNames: Object.keys(isRecord(config.headers) ? config.headers : {}).sort(compare),
        toolCallTimeoutMs: typeof config.toolCallTimeoutMs === 'number' ? config.toolCallTimeoutMs : null,
        failOnStartupError: config.failOnStartupError === true,
        tools: [],
      })
    }
  }
  return { servers, unreadable }
}

/**
 * Collect the model-facing tool names MCP servers contribute, keyed by
 * `serverName`. The global layer and every preset scope are read, because an MCP
 * client row may be mounted by the profile or by a preset's composition.
 *
 * A name is recorded once regardless of how many scopes expose it: the same
 * composed server appears in every preset scope that inherits it, and the page
 * reports which tools a server offers, not how many scopes see them.
 * @param ctx - Host context carrying the optional tool and preset registries.
 * @param signal - caller lifetime for the preset scope reads.
 * @returns tool names per server name.
 */
async function mcpToolNames(ctx, signal) {
  const found = new Map()
  const tools = ctx.get('tools')
  if (tools === undefined) return found
  const collect = (scope) => {
    for (const name of mcpToolNamesIn(tools, scope)) {
      const separator = name.indexOf('__', MCP_TOOL_PREFIX.length)
      if (separator === -1) continue
      const serverName = name.slice(MCP_TOOL_PREFIX.length, separator)
      let names = found.get(serverName)
      if (names === undefined) {
        names = new Set()
        found.set(serverName, names)
      }
      names.add(name)
    }
  }
  collect(undefined)
  const presets = ctx.get('agentPresets')
  if (presets !== undefined) {
    const roster = await presets.list()
    await withPresetScopes(presets, roster, async (_preset, key) => {
      signal?.throwIfAborted()
      collect(key)
    })
  }
  const sorted = new Map()
  for (const [serverName, names] of found) sorted.set(serverName, [...names].sort(compare))
  return sorted
}

/**
 * Read one scope's MCP tool names from the tool registry.
 * @param tools - the tool registry service.
 * @param scope - the scope to read, or undefined for the global layer.
 * @returns the MCP tool names in that scope.
 */
function mcpToolNamesIn(tools, scope) {
  let schemas
  try {
    schemas = tools.schemas(scope)
  } catch {
    // A registry that cannot answer for this scope reports no tools rather than
    // failing the whole page.
    return []
  }
  return schemas
    .map(schema => schema?.name)
    .filter(name => typeof name === 'string' && name.startsWith(MCP_TOOL_PREFIX))
}

/**
 * Render a stdio server's launch as one display line.
 * @param config - the row's declared config.
 * @returns the command with its arguments, or an empty string for another transport.
 */
function compactCommand(config) {
  if (config.transport !== 'stdio') return ''
  const parts = [text(config.command)]
  if (Array.isArray(config.args)) parts.push(...config.args.map(text))
  return parts.filter(part => part !== '').join(' ')
}

// ---- shared value rendering ----

/**
 * Render one declared config value as display text. A Loader `!!js` node keeps its
 * expression source instead of being evaluated.
 * @param value - the declared value.
 * @returns display text, never `undefined`.
 */
function text(value) {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (isJsExpr(value)) return `!!js ${value.__jsExpr}`
  if (Array.isArray(value)) return value.map(text).filter(part => part !== '').join(' ')
  if (value === null || value === undefined) return ''
  return JSON.stringify(value)
}

/**
 * Whether a declared value is a serialized Loader JavaScript expression.
 * @param value - the declared value.
 * @returns whether the value carries the expression marker.
 */
function isJsExpr(value) {
  return isRecord(value) && typeof value.__jsExpr === 'string'
}

/**
 * Narrow a value to a plain record.
 * @param value - the value to test.
 * @returns whether the value is a non-array, non-null object.
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Compare two strings by code point, so every projection orders identically.
 * @param left - first string.
 * @param right - second string.
 * @returns negative, zero, or positive.
 */
function compare(left, right) {
  if (left < right) return -1
  return left > right ? 1 : 0
}

/**
 * Render a thrown value as one line for the RPC failure envelope.
 * @param error - the thrown value.
 * @returns the message when available, else the string form.
 */
function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}
