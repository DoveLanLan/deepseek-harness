# @local/dsh-provider-usage

Adds **usage-limit** and **token** queries to provider cards in the Web GUI's
Models settings. Each supported provider's card gains one row whose button opens
a dialog with:

- that provider's rolling quota windows — 5-hour, weekly, and monthly — showing
  the remaining share, a progress bar colored by how much is left, the used
  percentage, and when each window resets;
- the account's token totals — month-to-date and lifetime — under a
  `Token 用量` section, on its own request so a slow lifetime walk never holds
  the windows back.

A Refresh button re-reads both. The providers themselves are ordinary profile
configuration (routes in an `llm-pi-ai` row); this bundle only adds the query
surface beside them.

## How it works

| Half | Role |
|---|---|
| `host.js` (Host) | Registers the authenticated Fetch route `GET /api/provider-quota?provider=<id>` on Connection's shared `/api` channel and dispatches to a per-provider source. `tokens=1` selects the token projection. The configured provider ids are the complete set it serves, so the route cannot reach an unconfigured vendor. |
| `client.js` (browser) | Registers one entry in the `settings.models.provider-card` slot under the `llm-pi-ai` settings namespace — one cell serves every pi-ai card, so a second plugin cannot register the same key — and renders a row only for the providers it serves. Requires `react` and `react-dom` from the shared browser module table. |

Credentials never reach the browser: the route is same-origin, authenticated by
Connection, and returns percentages, reset times, token counts, and a plan label
only.

## Sources

### clinepass — Cline account API

```http
GET https://api.cline.bot/api/v1/users/me/plan/usage-limits     # windows
GET https://api.cline.bot/api/v1/users/{id}/usages/daily?startDate=&endDate=   # tokens
Authorization: Bearer <API key>
```

Read with the credential reference the provider itself sends (`llm-pi-ai`'s
`apiKeyEnv`), resolved per query so a rotated key reaches the next query without
a restart.

Month-to-date is one request. The lifetime total walks the same per-day aggregate
endpoint in ranges of at most 30 days, because the API refuses 32 days or more;
four ranges are in flight at once behind a 30-second ceiling. Where the walk
starts depends on the block: `tokensSince` bounds it to the account's own
history, and without that it falls back to 24 whole calendar months, because the
API reports no account creation date.

A chunk that does not answer makes the total a lower bound and the dialog marks it
`≥`. A finished walk is cached for six hours, so a refresh re-reads the month but
reuses the walk; a walk that ended with an unreadable chunk is cached for two
minutes instead, and a walk the caller abandoned — the dialog closing mid-request
— is not cached at all, since its empty total is not a fact about the account. The row-level
`/usages` ledger is deliberately not used: it silently caps at 200 rows per page
and would under-report a busy account without saying so.

### volces — ARK Coding Plan snapshot and platform tokens

```sh
arkcli usage plan --product coding-plan --format json     # windows
arkcli usage stats --start <YYYY-MM-DD> --end <YYYY-MM-DD> --format json   # tokens
```

`arkcli` owns the Volcengine login, so this plugin stores no Volcengine
credential; a lapsed login is reported with the command that fixes it. One-time
setup:

```sh
npm i -g @volcengine/ark-cli
arkcli auth login volc-sso          # browser SSO; creates the profile set
```

Window labels are `session` (the 5-hour window), `weekly`, and `monthly`, with
percentages only — the backend returns no absolute allowance, so none is shown. A
window without `reset_at` means no reset is scheduled, which the dialog renders
as an imminent reset (matching the Volcengine console).

**Token caveat:** ARK meters Coding Plan consumption as a share of an allowance,
and `arkcli` filters those rows out of `usage stats`; the CLI also refuses
`--mine` for a root login. The token section therefore reports the *platform
pay-as-you-go* measurement and says so in the dialog — for a Coding Plan-only
account it is zero, which is the honest answer rather than a wrong one. The
lifetime figure walks `tokensSince` in spans of at most 30 days and is cached for
six hours.

## Configuration

```yaml
- insert:
    - id: provider-usage
      name: '@local/dsh-provider-usage'
      config:
        clinepass:
          credentialRef: HEWEILI_API_KEY
          # baseUrl: https://api.cline.bot    # optional; Cline's public API origin
          # tokensSince: '2026-09-01'         # optional; bounds the lifetime walk, which otherwise covers 24 months
        volces:
          command: arkcli                     # optional; absolute path when not on PATH
          product: coding-plan                # optional; agent-plan, coding-plan, or a *-team variant
          tokensSince: '2026-09-01'           # optional; lifetime token scope for the ARK walk
          # timeoutMs: 30000                  # optional; ceiling on one arkcli run
```

A provider with no block still shows its row and reports `NO_SOURCE` when
queried. A malformed block fails at load rather than at query time.

## HTTP surface

```
GET /api/provider-quota?provider=<clinepass|volces>          # quota windows
GET /api/provider-quota?provider=<clinepass|volces>&tokens=1 # token totals
```

```json
{
  "ok": true,
  "provider": "clinepass",
  "fetchedAt": "2026-10-14T07:26:13.000Z",
  "windows": [
    { "id": "five_hour", "percentUsed": 2, "resetsAt": "2026-10-14T12:01:05Z", "resetsSoon": false },
    { "id": "weekly", "percentUsed": 14, "resetsAt": "2026-10-19T01:15:21Z", "resetsSoon": false },
    { "id": "monthly", "percentUsed": 31, "resetsAt": "2026-10-18T07:52:02Z", "resetsSoon": false }
  ],
  "plan": null
}
```

```json
{
  "ok": true,
  "provider": "clinepass",
  "fetchedAt": "2026-10-14T07:26:13.000Z",
  "tokens": { "monthToDate": 677545391, "lifetime": 812759407, "lifetimePartial": false, "since": null }
}
```

Failures answer `{ ok: false, code, error }` with `code` one of `NO_SOURCE`,
`NO_TOKENS`, `NO_KEY`, `AUTH`, `RATE_LIMITED`, `ARKCLI_MISSING`,
`NOT_LOGGED_IN`, `NO_SUBSCRIPTION`, or `UPSTREAM`; the dialog turns each into an
actionable hint.

## Verification

```sh
node --check host.js
node smoke.mjs                                     # mounts the Host half against a stub context and calls both projections
node smoke.mjs 'provider=volces&tokens=1'
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:3080/api/provider-quota?provider=volces'
```

The curl answers `401` because Connection authenticates the whole `/api` channel
before routing, so an unauthenticated request cannot distinguish an existing
route from a missing one; it only proves the fence. The route's own behavior is
verified in the page: **Settings → Models → \<provider\> → 查询额度**. Escape, the
mask, and the close button dismiss the dialog, Tab stays inside it, and focus
returns to the trigger.

## Windows

The bundle is plain ESM with no native dependency, so it runs unchanged on
Windows. The one platform difference is how `arkcli` starts: npm installs it
there as an `arkcli.cmd` shim, which Node refuses to execute without a shell, so
the plugin runs the command through `cmd.exe` on `win32` and expects `arkcli` on
`PATH` (or `config.volces.command` set to the full path). A missing command is
reported as `ARKCLI_MISSING` on both platforms: Windows reaches it through
cmd.exe's own "not recognized" message rather than `ENOENT`.

```powershell
npm i -g @volcengine/ark-cli
arkcli auth login volc-sso     # browser SSO; creates the profile set
arkcli usage plan --product coding-plan --format json   # sanity check
```

Nothing else in the bundle is platform-specific: the Cline source is HTTPS, and
the credentials for it live in `%USERPROFILE%\.dsh\.credentials.yaml`.

## Editing this bundle

The Host half is imported once per process: replacing the *file* behind a loaded
package does not change the running module generation, and re-installing the same
package name does not either. A change to `host.js` therefore needs a profile
restart — or a **package rename** (name and directory), which is what produced
`provider-usage` from its `provider-quota` predecessor and what made the change
live without restarting. The browser half has no such constraint: it is fetched
on each page load.

## Limitations

- Rows appear only for the route ids this bundle serves; renaming a provider in
  the profile removes its button.
- The dialog reads the vendor live on every open; only the lifetime token walks
  are cached (six hours complete, two minutes partial, never when abandoned).
- The ARK 5-hour window has no scheduled reset, so it always renders as an
  imminent reset.
- ARK token totals cover platform pay-as-you-go usage, not Coding Plan quota.
- Reset countdowns are computed when the dialog renders, so a dialog left open
  does not tick; Refresh re-reads the values.
