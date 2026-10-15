/**
 * Host-half smoke test: mount the plugin against a stub context and call its
 * route directly, so the projection can be exercised without a running profile
 * (whose loaded module generation is fixed for the life of the process).
 *
 * Run from this directory: `node smoke.mjs`
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { apply } from './host.js'

/** The Cline key this deployment stores, read without printing it. */
function clineKey() {
  const store = readFileSync(`${homedir()}/.dsh/.credentials.yaml`, 'utf8')
  return /^\s*HEWEILI_API_KEY:\s*(\S+)\s*$/m.exec(store)?.[1]
}

let route
const key = clineKey()
const ctx = {
  effect: (mount) => {
    mount()
    return () => {}
  },
  connection: { fetch: { register: (registered) => { route = registered; return () => {} } } },
  credentials: { resolve: async ref => (ref === 'HEWEILI_API_KEY' && key !== undefined ? { value: key } : undefined) },
}

apply(ctx, {
  clinepass: { credentialRef: 'HEWEILI_API_KEY', tokensSince: '2026-09-01' },
  volces: { command: 'arkcli', product: 'coding-plan', tokensSince: '2026-09-01' },
})

for (const query of process.argv.slice(2).length > 0 ? process.argv.slice(2) : [
  'provider=clinepass',
  'provider=volces',
  'provider=clinepass&tokens=1',
  'provider=volces&tokens=1',
  'provider=nope&tokens=1',
]) {
  const started = Date.now()
  const response = await route.fetch(new Request(`http://127.0.0.1/api/provider-quota?${query}`))
  const body = await response.json()
  console.log(`${String(Date.now() - started).padStart(6)}ms  ${response.status}  ${query}`)
  console.log(`        ${JSON.stringify(body).slice(0, 400)}`)
}
