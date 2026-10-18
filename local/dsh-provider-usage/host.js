/**
 * Host half of the provider quota popup: the one authenticated Fetch route the
 * browser half reads provider usage windows from.
 *
 * Each configured provider is one *source* — a named function that reaches that
 * vendor's quota data and projects it onto the shared window shape. The browser
 * never sees credentials or CLI invocations; it asks for a provider id and gets
 * percentages and reset times.
 *
 * Sources:
 * - `clinepass` reads Cline's `/users/me/plan/usage-limits` with the API-key
 *   reference the provider itself uses, resolved per query so a rotated key
 *   reaches the next query without a restart.
 * - `volces` reads the ARK Coding Plan snapshot by running `arkcli usage plan`,
 *   which owns its own SSO login and token refresh. The plugin stores no
 *   Volcengine credential.
 *
 * Every window is normalized here because the values are untrusted: a percentage
 * outside 0–100 or a missing field must not reach the browser as a broken
 * progress bar.
 *
 * @module @local/dsh-provider-quota
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-provider-quota'

/**
 * Required services: `credentials` resolves the Cline reference on each query,
 * and `connection` mounts the authenticated route on the shared `/api` channel,
 * which applies the Host/Origin fence and browser authentication before the
 * handler runs.
 */
export const inject = ['credentials', 'connection']

/** Authenticated Fetch-route path below `/api`; the browser half fetches it same-origin. */
const ROUTE_PATH = '/api/provider-quota'

/** Cline's public API origin, used when the clinepass block configures no `baseUrl`. */
const DEFAULT_CLINE_BASE_URL = 'https://api.cline.bot'

/** Ceiling on one upstream call, so a stalled vendor API cannot hold the route open. */
const REQUEST_TIMEOUT_MS = 20_000

/** Fallback ceiling on one `arkcli` run; the block's `timeoutMs` overrides it. */
const DEFAULT_ARKCLI_TIMEOUT_MS = 30_000

/** Output cap for one `arkcli` run, large enough for a four-SKU quota snapshot. */
const ARKCLI_MAX_OUTPUT_BYTES = 4 * 1024 * 1024

/** Display order of the known windows; an unknown window sorts last and keeps its place among peers. */
const WINDOW_ORDER = { five_hour: 0, weekly: 1, monthly: 2 }

/** Window ids each source reports, keyed by the vendor's own period label. */
const CLINE_WINDOW_IDS = { five_hour: 'five_hour', weekly: 'weekly', monthly: 'monthly' }
const ARK_WINDOW_IDS = { session: 'five_hour', five_hour: 'five_hour', weekly: 'weekly', monthly: 'monthly' }

/** How long a walked lifetime total is trusted; the walk costs one read per chunk. */
const TOKEN_CACHE_TTL_MS = 6 * 60 * 60 * 1000

/** How long a walk that left part of the history unread is trusted, so a later open can complete it. */
const TOKEN_PARTIAL_CACHE_TTL_MS = 2 * 60 * 1000

/** How far back the Cline lifetime walk reaches when the block names no `tokensSince`. */
const CLINE_LIFETIME_MONTHS = 24

/** Ceiling on one lifetime walk; chunks that do not finish make the total a partial one. */
const TOKEN_WALK_TIMEOUT_MS = 30_000

/** How many lifetime chunks are read at once. */
const TOKEN_WALK_CONCURRENCY = 4

/** Longest range one daily read may span: Cline refuses 32 days, ARK's stats endpoint 31. */
const MAX_RANGE_DAYS = 30

/** Walked lifetime totals by provider id, so a later open reuses a walk instead of repeating it. */
const lifetimeCache = new Map()

const run = promisify(execFile)

/** One failed quota read, carrying the code the browser maps to a hint. */
class QuotaError extends Error {
  /**
   * @param message - what failed, in the vendor's or the tool's own terms.
   * @param code - the browser-facing reason: `AUTH`, `RATE_LIMITED`, `NO_KEY`, `ARKCLI_MISSING`, `NOT_LOGGED_IN`, `NO_SUBSCRIPTION`, or `UPSTREAM`.
   */
  constructor(message, code) {
    super(message)
    this.name = 'QuotaError'
    this.code = code
  }
}

/**
 * Register the authenticated quota route.
 *
 * The configured provider ids are the complete set this route serves: a request
 * for any other id is refused, so the route cannot be used to reach an
 * unconfigured vendor.
 *
 * @param ctx - Host context carrying the credential service and route registry.
 * @param config - this row's configuration, keyed by provider id.
 * @throws {TypeError} when a configured block is malformed.
 */
export function apply(ctx, config) {
  const sources = configuredSources(config)
  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: request => route(ctx, sources, request),
  }), 'dsh-provider-quota: authenticated quota route')
}

/**
 * Read this row's provider blocks.
 * @param config - the row configuration.
 * @returns one source per configured provider.
 * @throws {TypeError} when a block is present but malformed.
 */
function configuredSources(config) {
  const blocks = config === null || typeof config !== 'object' ? {} : config
  const sources = new Map()
  if (blocks.clinepass !== undefined) sources.set('clinepass', clinepassSource(blocks.clinepass))
  if (blocks.volces !== undefined) sources.set('volces', volcesSource(blocks.volces))
  if (sources.size === 0) {
    throw new TypeError('dsh-provider-quota: configure at least one provider block (clinepass, volces)')
  }
  return sources
}

/**
 * Build the clinepass source from its block.
 * @param block - the `clinepass` configuration.
 * @returns the source.
 * @throws {TypeError} when `credentialRef` is absent or empty.
 */
function clinepassSource(block) {
  const format = (message) => `dsh-provider-quota: config.clinepass.${message}`
  if (block === null || typeof block !== 'object') throw new TypeError(format('must be a mapping'))
  const credentialRef = block.credentialRef
  if (typeof credentialRef !== 'string' || credentialRef.trim() === '') {
    throw new TypeError(format('credentialRef must name the credential holding the Cline API key'))
  }
  const tokensSince = block.tokensSince === undefined ? undefined : isoDate(block.tokensSince, format('tokensSince'))
  const settings = {
    credentialRef: credentialRef.trim(),
    baseUrl: absoluteOrigin(block.baseUrl, DEFAULT_CLINE_BASE_URL, format('baseUrl')),
    tokensSince,
  }
  return {
    read: (ctx, signal) => readClineQuota(ctx, settings, signal),
    readTokens: (ctx, signal) => readClineTokens(ctx, settings, signal),
  }
}

/**
 * Build the volces source from its block.
 * @param block - the `volces` configuration.
 * @returns the source.
 * @throws {TypeError} when a configured value has the wrong type.
 */
function volcesSource(block) {
  const format = (message) => `dsh-provider-quota: config.volces.${message}`
  if (block === null || typeof block !== 'object') throw new TypeError(format('must be a mapping'))
  const command = optionalText(block.command, 'arkcli', format('command'))
  const product = optionalText(block.product, 'coding-plan', format('product'))
  const timeoutMs = block.timeoutMs === undefined ? DEFAULT_ARKCLI_TIMEOUT_MS : block.timeoutMs
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError(format('timeoutMs must be a positive number of milliseconds'))
  }
  const tokensSince = block.tokensSince === undefined ? undefined : isoDate(block.tokensSince, format('tokensSince'))
  const settings = { command, product, timeoutMs, tokensSince }
  return {
    read: (_ctx, signal) => readVolcesQuota(settings, signal),
    readTokens: (_ctx, signal) => readVolcesTokens(settings, signal),
  }
}

/**
 * Validate one `YYYY-MM-DD` date.
 * @param value - the configured value.
 * @param label - the diagnostic label naming the field.
 * @returns the date as written.
 * @throws {TypeError} when it is not a calendar date.
 */
function isoDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw new TypeError(`${label} must be a YYYY-MM-DD date`)
  }
  const parsed = new Date(`${value.trim()}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`${label} "${value}" is not a calendar date`)
  return value.trim()
}

/**
 * Answer this row's configuration for one provider id.
 * @param value - a configured string.
 * @param fallback - the value to use when it is absent.
 * @param label - the diagnostic label naming the field.
 * @returns the configured or fallback value.
 * @throws {TypeError} when a present value is not a non-empty string.
 */
function optionalText(value, fallback, label) {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`)
  return value.trim()
}

/**
 * Answer one concrete origin, or the fallback when unset.
 * @param value - the configured URL.
 * @param fallback - the origin to use when unset.
 * @param label - the diagnostic label naming the field.
 * @returns the origin.
 * @throws {TypeError} when a present value is not an absolute URL.
 */
function absoluteOrigin(value, fallback, label) {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be an absolute URL when set`)
  try {
    return new URL(value.trim()).origin
  } catch {
    // A value that is not an absolute URL cannot address the vendor at all,
    // which is a load-time misconfiguration rather than a per-query failure.
    throw new TypeError(`${label} "${value}" is not an absolute URL`)
  }
}

/**
 * Route one request to its provider's source.
 * @param ctx - Host context carrying the credential service.
 * @param sources - the configured sources by provider id.
 * @param request - the authenticated browser request.
 * @returns the JSON response for the browser half.
 */
async function route(ctx, sources, request) {
  const params = new URL(request.url).searchParams
  const provider = params.get('provider') ?? ''
  const source = sources.get(provider)
  if (source === undefined) {
    return json({
      ok: false,
      code: 'NO_SOURCE',
      error: `no quota source is configured for provider "${provider}"`,
      providers: [...sources.keys()],
    }, 404)
  }
  const wantsTokens = params.get('tokens') === '1'
  if (wantsTokens && source.readTokens === undefined) {
    return json({
      ok: false,
      provider,
      code: 'NO_TOKENS',
      error: `provider "${provider}" has no token source`,
    }, 404)
  }
  const deadline = AbortSignal.any([request.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS + DEFAULT_ARKCLI_TIMEOUT_MS)])
  try {
    if (wantsTokens) {
      const tokens = await source.readTokens(ctx, deadline)
      return json({ ok: true, provider, fetchedAt: new Date().toISOString(), tokens })
    }
    const read = await source.read(ctx, deadline)
    return json({ ok: true, provider, fetchedAt: new Date().toISOString(), ...read })
  } catch (error) {
    return json({
      ok: false,
      provider,
      code: error instanceof QuotaError ? error.code : 'UPSTREAM',
      error: describeError(error),
    }, 502)
  }
}

/**
 * Read the Cline account's token totals.
 *
 * The month-to-date figure comes from the per-day aggregate endpoint. The
 * lifetime figure walks that same endpoint month by month rather than reading
 * the row-level ledger, because the ledger silently caps at 200 rows per page
 * and would under-report a busy account without saying so.
 *
 * @param ctx - Host context carrying the credential service.
 * @param settings - the resolved clinepass settings.
 * @param signal - abort signal bounding the call.
 * @returns the token projection.
 * @throws {QuotaError} when the credential is absent or Cline refuses the call.
 */
async function readClineTokens(ctx, settings, signal) {
  const credential = await ctx.credentials.resolve(settings.credentialRef)
  if (credential === undefined) {
    throw new QuotaError(`credential ${settings.credentialRef} is not configured in this deployment`, 'NO_KEY')
  }
  const key = credential.value
  const me = await clineGet(settings.baseUrl, '/api/v1/users/me', key, signal)
  const accountId = readString(me, 'id')
  if (accountId === undefined) throw new QuotaError('Cline did not report an account id for this key', 'UPSTREAM')
  const day = new Date().toISOString().slice(0, 10)
  const monthToDate = await clineDailyTokens(settings.baseUrl, accountId, key, `${day.slice(0, 7)}-01`, day, signal)
  // A configured start bounds the walk to the account's own history; without one
  // the walk falls back to whole calendar months, because the API reports no
  // account creation date.
  const scoped = settings.tokensSince !== undefined && settings.tokensSince <= day
  const lifetime = await cachedLifetime('clinepass', signal, async deadline => walkChunks(
    scoped ? dayChunks(settings.tokensSince, day) : monthChunks(CLINE_LIFETIME_MONTHS),
    deadline,
    chunk => clineDailyTokens(settings.baseUrl, accountId, key, chunk.start, chunk.end, deadline),
  ))
  return {
    monthToDate,
    lifetime: lifetime.value,
    lifetimePartial: lifetime.partial,
    since: scoped ? settings.tokensSince : null,
  }
}

/**
 * Sum one Cline daily-aggregate range.
 * @param baseUrl - Cline API origin.
 * @param accountId - the account whose days are read.
 * @param apiKey - the resolved API key.
 * @param startDate - inclusive first day, `YYYY-MM-DD`.
 * @param endDate - inclusive last day, `YYYY-MM-DD`.
 * @param signal - abort signal bounding the call.
 * @returns the summed tokens for the range.
 * @throws {QuotaError} when Cline refuses the call.
 */
async function clineDailyTokens(baseUrl, accountId, apiKey, startDate, endDate, signal) {
  const query = `?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`
  const payload = await clineGet(
    baseUrl,
    `/api/v1/users/${encodeURIComponent(accountId)}/usages/daily${query}`,
    apiKey,
    signal,
  )
  const items = payload !== null && typeof payload === 'object' && Array.isArray(payload.items) ? payload.items : []
  let total = 0
  for (const item of items) {
    // `totalTokens` is absent on some rows, which report the two halves instead.
    total += readNumber(item, 'totalTokens') ?? ((readNumber(item, 'promptTokens') ?? 0) + (readNumber(item, 'completionTokens') ?? 0))
  }
  return total
}

/**
 * Read the ARK token totals through `arkcli`.
 *
 * Coding Plan consumption is metered as a share of an allowance rather than in
 * tokens, and arkcli filters those rows out of `usage stats`; this reads the
 * platform pay-as-you-go measurement, which is the only token figure ARK
 * publishes, and reports an empty range as zero rather than as an error.
 *
 * @param settings - the resolved volces settings.
 * @param signal - abort signal bounding the call.
 * @returns the token projection.
 * @throws {QuotaError} when arkcli is missing or refuses.
 */
async function readVolcesTokens(settings, signal) {
  const today = new Date().toISOString().slice(0, 10)
  const monthToDate = await arkStatsTokens(settings, `${today.slice(0, 7)}-01`, today, signal)
  if (settings.tokensSince === undefined || settings.tokensSince > today) {
    return { monthToDate, lifetime: null, lifetimePartial: false, since: null, platformOnly: true }
  }
  const lifetime = await cachedLifetime('volces', signal, async deadline => walkChunks(
    dayChunks(settings.tokensSince, today),
    deadline,
    chunk => arkStatsTokens(settings, chunk.start, chunk.end, deadline),
  ))
  return {
    monthToDate,
    lifetime: lifetime.value,
    lifetimePartial: lifetime.partial,
    since: settings.tokensSince,
    // ARK meters Coding Plan use as a share of an allowance, so this figure is
    // the platform pay-as-you-go measurement rather than plan consumption.
    platformOnly: true,
  }
}

/**
 * Sum one ARK `usage stats` range.
 * @param settings - the resolved volces settings.
 * @param start - inclusive first day, `YYYY-MM-DD`.
 * @param end - inclusive last day, `YYYY-MM-DD`.
 * @param signal - abort signal bounding the run.
 * @returns the summed `TotalTokens` for the range.
 * @throws {QuotaError} when arkcli is missing or refuses.
 */
async function arkStatsTokens(settings, start, end, signal) {
  const args = ['usage', 'stats', '--start', start, '--end', end, '--format', 'json']
  const stdout = await runArkcli(settings, args, signal)
  const parsed = parseJson(stdout)
  const totals = parsed !== null && typeof parsed === 'object' ? parsed.totals : undefined
  // Arkcli renders metric totals as decimal strings.
  const raw = totals !== null && typeof totals === 'object' ? totals.TotalTokens : undefined
  const value = typeof raw === 'string' ? Number(raw) : raw
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Read the Cline account's usage windows.
 * @param ctx - Host context carrying the credential service.
 * @param settings - the resolved clinepass settings.
 * @param signal - abort signal bounding the call.
 * @returns the provider-neutral projection.
 * @throws {QuotaError} when the credential is absent or Cline refuses the call.
 */
async function readClineQuota(ctx, settings, signal) {
  const credential = await ctx.credentials.resolve(settings.credentialRef)
  if (credential === undefined) {
    throw new QuotaError(`credential ${settings.credentialRef} is not configured in this deployment`, 'NO_KEY')
  }
  const payload = await clineGet(settings.baseUrl, '/api/v1/users/me/plan/usage-limits', credential.value, signal)
  const raw = payload !== null && typeof payload === 'object' && Array.isArray(payload.limits) ? payload.limits : []
  const windows = raw.map(limit => ({
    id: CLINE_WINDOW_IDS[readString(limit, 'type') ?? ''] ?? readString(limit, 'type'),
    percentUsed: clampPercent(readNumber(limit, 'percentUsed')),
    resetsAt: readString(limit, 'resetsAt') ?? null,
    resetsSoon: false,
  })).filter(window => typeof window.id === 'string' && window.id !== '')
  return { windows: sortWindows(windows), plan: null }
}

/**
 * Run one `arkcli` command and return its stdout.
 *
 * arkcli owns the Volcengine login, so the failure modes worth naming are the
 * tool being absent and the login having lapsed; both carry their own remedy.
 * @param settings - the resolved volces settings.
 * @param args - the command's arguments.
 * @param signal - abort signal bounding the run.
 * @returns the captured stdout.
 * @throws {QuotaError} when arkcli is missing, times out, or refuses.
 */
async function runArkcli(settings, args, signal) {
  try {
    const result = await run(settings.command, args, {
      timeout: settings.timeoutMs,
      maxBuffer: ARKCLI_MAX_OUTPUT_BYTES,
      signal,
      // npm installs `arkcli` as a `.cmd` shim on Windows, which Node refuses to
      // execute without a shell; cmd.exe resolves it through PATHEXT, so the
      // command must be on PATH there (or be given as a full path).
      shell: process.platform === 'win32',
      windowsHide: true,
      env: {
        ...process.env,
        // arkcli's own agent-attribution protocol, which also freezes the run to
        // the installed version instead of checking for updates mid-query.
        ARKCLI_NO_UPDATE_NOTIFIER: '1',
        ARKCLI_CALLER_TYPE: 'ai_agent',
        ARKCLI_CALLER_NAME: 'deepseek-harness',
        ARKCLI_SKILL_NAME: 'arkcli-usage',
      },
    })
    return result.stdout
  } catch (error) {
    throw new QuotaError(describeArkcliFailure(error, settings), arkcliFailureCode(error))
  }
}

/**
 * Walk a lifetime total, reusing a recent walk.
 *
 * The walk costs one read per chunk, so it is cached: an account's all-time
 * total does not move enough between two openings of the dialog to justify
 * repeating it, and a refresh still re-reads the month-to-date figure.
 * @param provider - the provider id the walk belongs to.
 * @param signal - abort signal bounding the walk.
 * @param walk - the walk itself, given its own deadline.
 * @returns the total, whether part of it was unreadable, and whether it came from cache.
 */
async function cachedLifetime(provider, signal, walk) {
  const hit = lifetimeCache.get(provider)
  if (hit !== undefined && Date.now() - hit.at < hit.ttl) {
    return { value: hit.value, partial: hit.partial, cached: true }
  }
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(TOKEN_WALK_TIMEOUT_MS)])
  const result = await walk(deadline)
  // A walk the caller abandoned is not a fact about the account: caching its
  // empty total would pin a wrong lower bound for hours. A walk that finished
  // with an unreadable chunk is cached briefly instead, so the next open can
  // complete it.
  if (result.aborted !== true) {
    lifetimeCache.set(provider, {
      value: result.value,
      partial: result.partial,
      at: Date.now(),
      ttl: result.partial ? TOKEN_PARTIAL_CACHE_TTL_MS : TOKEN_CACHE_TTL_MS,
    })
  }
  return { value: result.value, partial: result.partial, cached: false }
}

/**
 * Read every chunk, a few at a time, summing what succeeded.
 * @param chunks - the ranges to read.
 * @param signal - abort signal bounding the whole walk.
 * @param read - reads one chunk's tokens.
 * @returns the summed total, whether any chunk was unreadable, and whether the caller abandoned the walk.
 */
async function walkChunks(chunks, signal, read) {
  let value = 0
  let partial = false
  let next = 0
  const worker = async () => {
    while (next < chunks.length) {
      const chunk = chunks[next]
      next += 1
      if (signal.aborted) {
        partial = true
        continue
      }
      try {
        // The sum must be read after the await: `value += await read(chunk)` reads
        // `value` before suspending, so two workers resolving together would each
        // write the same stale sum and lose one chunk's contribution.
        const added = await read(chunk)
        value += added
      } catch {
        // One unreadable chunk makes the total a lower bound rather than a
        // failure: the rest of the history is still worth showing.
        partial = true
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(TOKEN_WALK_CONCURRENCY, chunks.length) }, worker))
  return { value, partial, aborted: signal.aborted }
}

/**
 * Split the last whole months into one range per calendar month.
 * @param months - how many months back the walk reaches.
 * @returns the ranges, oldest first.
 */
function monthChunks(months) {
  const today = new Date()
  const chunks = []
  for (let back = months - 1; back >= 0; back -= 1) {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1))
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
    chunks.push({ start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) })
  }
  return chunks
}

/**
 * Split a date range into ranges the ARK stats API accepts.
 * @param since - inclusive first day, `YYYY-MM-DD`.
 * @param until - inclusive last day, `YYYY-MM-DD`.
 * @returns the ranges, oldest first, each at most {@link MAX_RANGE_DAYS} days.
 */
function dayChunks(since, until) {
  const chunks = []
  let cursor = new Date(`${since}T00:00:00Z`)
  const last = new Date(`${until}T00:00:00Z`)
  while (cursor <= last) {
    const end = new Date(Math.min(cursor.getTime() + (MAX_RANGE_DAYS - 1) * 86_400_000, last.getTime()))
    chunks.push({ start: cursor.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) })
    cursor = new Date(end.getTime() + 86_400_000)
  }
  return chunks
}

/**
 * Read the ARK Coding Plan snapshot through `arkcli`.
 *
 * arkcli owns the Volcengine login, so the failure modes worth naming are the
 * tool being absent and the login having lapsed; both carry their own remedy.
 * @param settings - the resolved volces settings.
 * @param signal - abort signal bounding the run.
 * @returns the provider-neutral projection.
 * @throws {QuotaError} when arkcli is missing, refuses, or reports no subscription.
 */
async function readVolcesQuota(settings, signal) {
  const stdout = await runArkcli(settings, ['usage', 'plan', '--product', settings.product, '--format', 'json'], signal)
  const parsed = parseJson(stdout)
  const items = parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.items) ? parsed.items : []
  const item = items.find(entry => readString(entry, 'product') === settings.product) ?? items[0]
  if (item === undefined || typeof item !== 'object') {
    throw new QuotaError(`${settings.command} returned no plan for this account`, 'UPSTREAM')
  }
  const bucketError = readString(item, 'error')
  if (bucketError !== undefined) throw new QuotaError(bucketError, 'UPSTREAM')
  if (item.subscribed === false) {
    throw new QuotaError(`this account has no active ${settings.product} subscription`, 'NO_SUBSCRIPTION')
  }
  const periods = Array.isArray(item.periods) ? item.periods : []
  const windows = periods.map(period => ({
    id: ARK_WINDOW_IDS[readString(period, 'label') ?? ''] ?? readString(period, 'label'),
    percentUsed: clampPercent(readNumber(period, 'percent')),
    resetsAt: readString(period, 'reset_at') ?? null,
    // arkcli omits `reset_at` for a window with no scheduled reset, which the
    // console renders as an imminent reset rather than an unknown one.
    resetsSoon: readString(period, 'reset_at') === undefined,
  })).filter(window => typeof window.id === 'string' && window.id !== '')
  const tier = readString(item, 'tier')
  const viewer = parsed !== null && typeof parsed === 'object' ? parsed.viewer : undefined
  return {
    windows: sortWindows(windows),
    plan: {
      product: readString(item, 'product') ?? settings.product,
      tier: tier ?? null,
      account: readString(viewer, 'user_name') ?? readString(viewer, 'account_id') ?? null,
      periodEnd: null,
    },
  }
}

/**
 * Name why an `arkcli` run failed, in terms the caller can act on.
 * @param error - the rejected execFile error.
 * @param settings - the resolved volces settings.
 * @returns the diagnostic message.
 */
function describeArkcliFailure(error, settings) {
  const stderr = error !== null && typeof error === 'object' ? readText(error, 'stderr') : undefined
  if (error !== null && typeof error === 'object' && error.code === 'ENOENT') {
    return `${settings.command} was not found on PATH; install it with "npm i -g @volcengine/ark-cli"`
      + ' or point config.volces.command at its absolute path'
  }
  if (missingCommandReported(stderr ?? '')) {
    return `${settings.command} was not found; install it with "npm i -g @volcengine/ark-cli"`
      + ' or point config.volces.command at its absolute path'
  }
  if (error !== null && typeof error === 'object' && error.killed === true) {
    return `${settings.command} did not finish within ${String(settings.timeoutMs)}ms`
  }
  const detail = arkcliFailureDetail(stderr)
  return detail !== undefined ? `${settings.command} failed: ${detail}` : describeError(error)
}

/**
 * Classify an `arkcli` failure for the browser's hint.
 * @param error - the rejected execFile error.
 * @returns the browser-facing reason code.
 */
function arkcliFailureCode(error) {
  if (error !== null && typeof error === 'object' && error.code === 'ENOENT') return 'ARKCLI_MISSING'
  const stderr = error !== null && typeof error === 'object' ? readText(error, 'stderr') ?? '' : ''
  if (missingCommandReported(stderr)) return 'ARKCLI_MISSING'
  return /not logged in|unauthenticated|请先登录|auth login|token.*expired/i.test(stderr) ? 'NOT_LOGGED_IN' : 'UPSTREAM'
}

/**
 * Whether a shell reported that the command itself does not exist.
 *
 * Only Windows reaches this: the npm shim there is a `.cmd` file, so the run
 * goes through cmd.exe, which answers a missing tool with its own message and an
 * ordinary exit code rather than ENOENT.
 * @param stderr - the captured standard error.
 * @returns true when the shell could not find the command.
 */
function missingCommandReported(stderr) {
  return /is not recognized as an internal or external command|不是内部或外部命令/i.test(stderr)
}

/**
 * Read arkcli's own diagnosis out of a refused run.
 *
 * arkcli answers a refused command with a JSON envelope on standard error, so
 * the report's last physical line is only the closing brace. The envelope's
 * `error.message` names the remedy; anything else falls back to that last line.
 * @param stderr - the captured standard error.
 * @returns the diagnosis, or undefined when the report carries none.
 */
function arkcliFailureDetail(stderr) {
  const text = typeof stderr === 'string' ? stderr.trim() : ''
  if (text === '') return undefined
  const parsed = parseJson(text)
  const message = readString(parsed !== null && typeof parsed === 'object' ? parsed.error : undefined, 'message')
  return message ?? text.split('\n').at(-1)
}

/**
 * Read one string member of an object.
 * @param value - the object, which may be anything.
 * @param field - the member name.
 * @returns the member when it is a string.
 */
function readText(value, field) {
  const member = value[field]
  return typeof member === 'string' ? member : undefined
}

/**
 * Call one Cline endpoint and unwrap its envelope.
 * @param baseUrl - Cline API origin.
 * @param path - endpoint path below that origin.
 * @param apiKey - the resolved API key, sent as a bearer token.
 * @param signal - abort signal bounding the call.
 * @returns the unwrapped payload, or undefined for an empty body.
 * @throws {QuotaError} when Cline refuses the call.
 */
async function clineGet(baseUrl, path, apiKey, signal) {
  const response = await fetch(new URL(path, baseUrl), {
    method: 'GET',
    headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
    signal,
  })
  const text = await response.text()
  const parsed = parseJson(text)
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403
      ? 'AUTH'
      : response.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM'
    throw new QuotaError(envelopeError(parsed) ?? `Cline answered ${response.status}`, code)
  }
  if (parsed !== null && typeof parsed === 'object' && typeof parsed.success === 'boolean') {
    if (!parsed.success) throw new QuotaError(envelopeError(parsed) ?? 'Cline refused the request', 'UPSTREAM')
    return parsed.data
  }
  return parsed
}

/**
 * Order windows for display, leaving unknown ids after the known ones.
 * @param windows - the normalized windows.
 * @returns the sorted copy.
 */
function sortWindows(windows) {
  return windows.sort((left, right) => (WINDOW_ORDER[left.id] ?? 100) - (WINDOW_ORDER[right.id] ?? 100))
}

/**
 * Constrain a reported percentage to the range a progress bar can render.
 * @param value - the reported percentage, or undefined.
 * @returns a finite percentage within 0–100, and 0 when the vendor reported none.
 */
function clampPercent(value) {
  if (value === undefined || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

/**
 * Parse a command's stdout or a response body, treating non-JSON as absent
 * rather than fatal: the caller reports the exit status or HTTP status instead.
 * @param text - the text to parse.
 * @returns the parsed value, or undefined when it is empty or not JSON.
 */
function parseJson(text) {
  if (typeof text !== 'string' || text.trim() === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    // Not JSON: the caller reports the status that came with it.
    return undefined
  }
}

/**
 * Read Cline's own error text out of an envelope.
 * @param parsed - the parsed body.
 * @returns the message, or undefined when the body carries none.
 */
function envelopeError(parsed) {
  if (parsed === null || typeof parsed !== 'object') return undefined
  return readString(parsed, 'error')
}

/**
 * Read a non-empty string field from an untrusted payload.
 * @param value - the payload, which may be anything.
 * @param field - the field name.
 * @returns the field when it is a non-empty string.
 */
function readString(value, field) {
  const member = value !== null && typeof value === 'object' ? value[field] : undefined
  return typeof member === 'string' && member !== '' ? member : undefined
}

/**
 * Read a finite number field from an untrusted payload.
 * @param value - the payload, which may be anything.
 * @param field - the field name.
 * @returns the field when it is a finite number.
 */
function readNumber(value, field) {
  const member = value !== null && typeof value === 'object' ? value[field] : undefined
  return typeof member === 'number' && Number.isFinite(member) ? member : undefined
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

/**
 * Describe a thrown value for the browser.
 * @param error - the thrown value.
 * @returns a message naming the failure.
 */
function describeError(error) {
  if (error instanceof Error && error.message !== '') return error.message
  return String(error)
}
