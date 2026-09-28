# @local/dsh-settings-inventory

Two read-only pages inside the Harness Web **Settings** panel:

| Page | What it shows |
|---|---|
| **Skills** | Every skill the deployment makes visible, merged by name, with the group(s) that expose each one |
| **MCP servers** | Every MCP server reachable from this deployment: those this profile mounts, those a preset declares, and those configured in other profiles |

Both are registered into `settings.section`, so they appear in the settings
navigation beside General, Models, and Plugins. Nothing on either page writes:
the bundle adds no tool, no prompt section, and no settings namespace.

**The MCP page reports other profiles but does not activate them.** A server
configured in a different profile is listed with a `Not mounted` tag and the
profile it comes from, and this deployment's tools are unchanged by its presence.
That distinction is the point of the page: a reader asking what this harness has
installed otherwise sees an empty list whenever their servers happen to live in
another profile — which is the common case, since a server usable against a GUI
debugger usually belongs to whichever profile the reader set it up in.

## Install / uninstall

Installed into the `web` profile as a bundle:

```
plugin_manager install_bundle <this directory>
```

The profile's `package.json` then links this directory and lists
`@local/dsh-settings-inventory` in `dsh.profile.bundles`. Remove it with
`plugin_manager remove_bundle @local/dsh-settings-inventory`.

## Where the facts come from

The Host half reads live services at request time; nothing is cached, because a
profile patch, a bundle install, or a skill directory can change between two
openings of the panel.

**Skills** — `ctx.skills` is a layered registry. The global layer is read with
`snapshot()`, then each usable preset's standing scope is leased with
`ctx.agentPresets.acquireScope(id)` and read with `list({ scope })`, and the lease
is disposed afterwards. This matters in the shipped `web` profile: its host
`skill-filesystem` row is disabled, so the global layer holds nothing and every
skill arrives through a preset scope. A broken preset is skipped and reported;
its scope cannot be leased.

The project directory is passed as `cwd` because the filesystem provider skips
its `project-dsh` and `project-agents` roots without one — omitting it would
silently hide project-local skills.

A skill name carries no scope identity, and shadowing is resolved per read, so
one row records every scope that exposes that name rather than repeating it.

**MCP servers** — one `@deepseek-ai/dsh-mcp-client` row is one server, read from
three sources:

1. **Mounted** — `ctx.loader.entries()` reaches the running composition and its
   declared config: `serverName`, `transport`, `command`/`args` or `url`, and the
   names of `env`/`header` entries.
2. **Preset** — `ctx.agentPresets.compositionInventory()` reports a row's module,
   entry id, and enablement but not its config, so those rows name their owner
   preset instead of inventing detail.
3. **Other profiles** — every other profile directory under the Harness home.

The other-profile scan reuses the launcher's own readers rather than
reimplementing the YAML dialect and layer order: `loadProfileDirectory` (each
installed bundle's patch plus the profile's own layer), `readProfilePatches` (the
home layer), then `composeEntries` (inserts and id-targeted overrides). It
therefore sees exactly the rows boot would, and mounts nothing.
A profile that cannot be composed is reported with its reason and does not
affect the others; a directory with no `package.json` is not a profile and is
skipped.

**A `--patch` overlay is not carried into another profile.** An overlay belongs
to the process it launched, so `overlays` is emptied for the foreign composition
rather than inherited from `profileContext`. Copying it would attribute this
launch's rows to a profile that never had them — the opposite of what a page
whose job is telling profiles apart should report.

A profile's own `cordis.patch.yml` **is** read, so a server configured there is
listed like any other. A server named only by a launch overlay is not listed for
any other profile, and is not listed at all unless this profile mounts it.

A server this profile already mounts is reported once, as a mounted row.

Tool names come from `ctx.tools.schemas()` per scope, keyed back to servers
through the `mcp__<serverName>__<rawName>` convention, deduplicated across scopes.
Only a mounted server has tools here, so an unmounted row says so rather than
claiming no tool is registered.

### What is deliberately withheld

Secret values never cross the wire: a stdio server's `env` and an HTTP server's
`headers` are reported by **key name only**, so the page can say a server
receives credentials without the value leaving the Host process. A `!!js` config
value is rendered as its expression source rather than evaluated, because the
declared value is what the profile patch actually holds. `disabled: !!js` is
likewise never evaluated for a profile that is not mounted — evaluation can throw
on a context the profile does not have.

Only an allow-listed field set is projected; the declared `config` is never
passed through wholesale, because a literal secret in any other key would then
reach the browser.

A `command` with arguments, and a `url`, are shown verbatim. A credential inlined
in argv (`--token=…`) or in a query string therefore *is* visible, on this page
and in the patch file it comes from.

### Runtime dependencies

The Host half imports `@deepseek-ai/dsh-app-boot` (the launcher's profile
readers) and reads `ctx.profileContext` for the Harness home.

**The manifest must declare `@deepseek-ai/dsh-app-boot` in `peerDependencies`.**
A linked bundle's imports are routed to the installation copy by the runtime
interception only for the packages that bundle's *own* manifest declares as
peers (`routeLinked` in `app-boot`'s resolver). Without the declaration the
import falls through to native resolution, which cannot see the Harness
packages from a workspace directory, and the reader fails with
`ERR_MODULE_NOT_FOUND`. That failure is now reported on the page instead of
collapsing into an empty server list. `workspace:*` resolves to the running
runtime version, and `verify-package-dependencies` treats a `@deepseek-ai/dsh-*`
peer as the compatibility edge it already is.

A bare `createRequire` from the bundle directory does not see those packages
either, so a resolution probe run outside a booted profile is not evidence about
what the plugin can import. `probe-e2e.mjs` is the decisive check: it installs
the real interception for the live profile, loads the Host half through a Cordis
context, calls the route, and asserts both servers appear.

Without `profileContext` (a composition booted outside the launcher) the
other-profile scan reports nothing and the mounted rows still render.

## Transport

The Host half registers one authenticated Fetch route, `/api/dsh-inventory`,
through `ctx.connection.fetch`. Connection's shared channel applies the
Host/Origin fence and browser authentication before the handler runs, the same
policy `/api/file` uses. The browser half reads it with a plain same-origin
`fetch` and needs no Cordis service for that.

`GET /api/dsh-inventory?endpoint=skills&cwd=<dir>` and
`?endpoint=mcp`; an unknown endpoint answers 404, a failed projection 500.

Connection's `rpc.handle` seam is the alternative, but it registers its HTTP
route through the *caller's* context and therefore additionally requires that
context to inject `webServer`; the Fetch registry owns its own route bookkeeping
and does not.

## Files

```
package.json               bundle manifest: dsh.bundle.patch + dsh.client
cordis.patch.yml           inserts the one Host row
index.js                   Host half: the three projections and the route
client.js                  browser half: the two Settings sections
smoke-host.mjs             Host-half checks against stubbed services and a fixture home
smoke.mjs                  browser-half checks: registration and rendering
probe-e2e.mjs              decisive check: the real interception, real profile, real route
fixture-mcp-server.mjs     stdio MCP server used to verify the MCP page
verify-mcp.overlay.yml     `--patch` overlay mounting that fixture
```

`client.js` is a built artifact in the `window.__ModuleLoader__.load` format: the
modules node half serves it into the boot graph from the manifest's `./client`
export. It requests only `react` from the shared module table and writes its own
controls against theme tokens, so it loads no Harness Client package.

## Verifying

```sh
# Host half: assertions over both projections, the error paths, and disposal
node --import tsx/esm smoke-host.mjs

# Browser half: slot registration, dictionaries, and every render branch
node smoke.mjs

# Decisive: the real runtime interception, the live web profile, the real route.
# Prints both servers from the desktop profile, or the exact import failure.
node probe-e2e.mjs
```

`probe-e2e.mjs` is the check that matters for the cross-profile read, because it
is the only one that runs the plugin's own `await import` under the interception
the live process installs. Do not substitute a shell HTTP request for it: every
`/api/*` path answers 401 before route matching, including paths that are not
registered, so a 401 proves nothing about whether this route exists.

End-to-end against a real server, boot a second instance so the running one is
untouched:

```sh
dsh --profile web --patch local/dsh-settings-inventory/verify-mcp.overlay.yml \
  --port 0 --no-open
```

Then exchange the printed launch token for a browser session (visit `/?token=…`)
and read `/api/dsh-inventory?endpoint=skills&cwd=<dir>`.
