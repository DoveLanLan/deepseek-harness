/**
 * Local smoke check for the browser half. It executes client.js against a loader
 * sink and a React stub whose `useState`/`useEffect` are real enough to drive a
 * component through its loading, ready, failure, and empty branches.
 *
 * The stub the factory receives through `require('react')` is the same object the
 * components close over, so the harness must drive THAT one: a module-level render
 * frame holds the ordered hook slots, and `renderToTree` swaps the frame per
 * component invocation.
 *
 * Development-only; not shipped.
 */
import { readFileSync } from 'node:fs'

let handoff
globalThis.window = { __ModuleLoader__: { load(registration) { handoff = registration } } }
const styleTags = []
globalThis.document = {
  createElement: () => ({ dataset: {}, remove() {}, style: {}, textContent: '' }),
  head: { appendChild(tag) { styleTags.push(tag) } },
}

/** The frame for the component currently rendering: its hook slots and pending effects. */
let frame = { hooks: [], cursor: 0, effects: [] }

const ReactStub = {
  createElement(type, props, ...children) {
    if (typeof type === 'function') {
      // A child component renders inside its own frame; the parent's frame is
      // restored afterwards so hook order per component stays independent.
      const parent = frame
      const child = { hooks: [], cursor: 0, effects: [] }
      frame = child
      try {
        const element = type({ ...(props ?? {}), children })
        parent.effects.push(...child.effects.map(effect => ({ ...effect, frame: child })))
        return element
      } finally {
        frame = parent
      }
    }
    return { type, props: props ?? {}, children }
  },
  Fragment: 'Fragment',
  useState(initial) {
    const slot = frame.cursor++
    if (frame.hooks[slot] === undefined) {
      frame.hooks[slot] = { value: typeof initial === 'function' ? initial() : initial }
    }
    const self = frame.hooks[slot]
    return [self.value, (next) => {
      const value = typeof next === 'function' ? next(self.value) : next
      if (!Object.is(value, self.value)) { self.value = value; self.changed = true }
    }]
  },
  useEffect(callback) {
    const slot = frame.cursor++
    frame.effects.push({ slot, callback })
  },
}

const effects = []
const registered = []
const dicts = []

const ctx = {
  effect(callback, label) {
    const dispose = callback()
    effects.push({ label, dispose })
    return dispose
  },
  locale: {
    bind: () => (key, params) => params === undefined
      ? key
      : `${key}(${Object.entries(params).map(([k, v]) => `${k}=${String(v)}`).join(',')})`,
    register(ns, locale, dict) { dicts.push({ ns, locale, dict }); return () => {} },
  },
  connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
  slots: { inject(name, callback) { callback() }, register(options, component) { registered.push({ options, component }) } },
}

// The browser half reads one authenticated route through the page's own fetch.
const fetched = []
globalThis.fetch = async (url) => {
  fetched.push(String(url))
  return {
    ok: true,
    status: 200,
    json: async () => ({ available: true, cwd: null, complete: true, scopes: [], entries: [], servers: [] }),
  }
}

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
new Function('require', 'window', source)(
  (id) => { if (id === 'react') return ReactStub; throw new Error(`unexpected require ${id}`) },
  globalThis.window,
)
const plugin = handoff.factory((id) => { if (id === 'react') return ReactStub; throw new Error(`unexpected require ${id}`) })
plugin.apply(ctx)

/**
 * Mount one page component: render, flush its effects, settle their promises,
 * then re-render as many times as the state churn requires.
 * @returns the settled element tree.
 */
async function mount(component, props) {
  const instance = { hooks: [], cursor: 0, effects: [] }
  const draw = () => {
    instance.cursor = 0
    instance.effects = []
    frame = instance
    return component({ ...props })
  }
  let tree = draw()
  for (let pass = 0; pass < 6; pass += 1) {
    const pending = instance.effects
    if (pending.length === 0) break
    for (const effect of pending) effect.callback()
    await new Promise(resolve => setTimeout(resolve, 0))
    tree = draw()
  }
  return tree
}

/** Flatten a rendered element tree into readable lines. */
function outline(node, depth = 0, out = []) {
  if (node === null || node === undefined || typeof node === 'string') {
    if (typeof node === 'string' && node !== '') out.push(`${'  '.repeat(depth)}“${node}”`)
    return out
  }
  if (Array.isArray(node)) { for (const child of node) outline(child, depth, out); return out }
  const name = typeof node.type === 'string' ? node.type : String(node.type?.name ?? 'Component')
  const own = (node.children ?? []).filter(child => typeof child === 'string' && child !== '').join(' ')
  out.push(`${'  '.repeat(depth)}${name}${own ? ` · ${own}` : ''}`)
  outline(node.children, depth + 1, out)
  return out
}

console.log('style tags:', styleTags.length)
console.log('dicts:', dicts.map(entry => `${entry.ns}/${entry.locale}(${Object.keys(entry.dict).length})`).join(' '))
console.log('sections:', registered.map(entry =>
  `${entry.options.id}@${String(entry.options.order)} label=${entry.options.label()} locale=${entry.options.locale}`).join(' | '))

const skillsPage = registered.find(entry => entry.options.id === 'skills-inventory').component
const mcpPage = registered.find(entry => entry.options.id === 'mcp-inventory').component
const t = (key, params) => params === undefined
  ? key
  : `${key}(${Object.entries(params).map(([k, v]) => `${k}=${String(v)}`).join(',')})`

const skillsValue = {
  available: true,
  cwd: 'D:\\work',
  complete: false,
  scopes: [{ id: 'standard', name: 'Standard', broken: null }, { id: 'broken-one', name: null, broken: 'boom' }],
  entries: [
    {
      name: 'agent-experience', description: 'Write discoverable tool definitions.',
      whenToUse: 'When writing a tool.', path: 'D:\\work\\.agents\\skills\\agent-experience\\SKILL.md',
      source: 'project-agents', provider: 'filesystem', modelInvocable: true, userInvocable: true,
      scopeIds: ['(global)', 'standard'],
    },
    {
      name: 'dsh-badge', description: 'Badge skill.', whenToUse: null, path: null,
      source: 'bundled', provider: 'dsh-badge', modelInvocable: true, userInvocable: false,
      scopeIds: ['standard'],
    },
  ],
}
const mcpValue = {
  available: true,
  servers: [
    {
      origin: 'profile', originLabel: null, entryId: 'memory', serverName: 'memory',
      transport: 'stdio', enabled: true, conditional: '', condition: '', phase: 'active',
      command: 'node server.js --port 1',
      url: '', envNames: ['API_KEY'], headerNames: [], toolCallTimeoutMs: 60000,
      failOnStartupError: true, tools: ['mcp__memory__search', 'mcp__memory__store'],
    },
    {
      origin: 'preset', originLabel: 'Cordis', entryId: 'mcp-docs', serverName: 'mcp-docs',
      transport: '', enabled: true, conditional: "ctx.get('x')", condition: "ctx.get('x')",
      phase: null,
      command: '', url: '', envNames: [], headerNames: [], toolCallTimeoutMs: null,
      failOnStartupError: false, tools: [],
    },
    {
      origin: 'other-profile', originLabel: 'desktop', entryId: 'mcp-idalib', serverName: 'idalib',
      transport: 'stdio', enabled: true, conditional: '', condition: '', phase: null,
      command: 'idalib-mcp.exe --stdio', url: '', envNames: [], headerNames: [],
      toolCallTimeoutMs: 600000, failOnStartupError: false, tools: [],
    },
  ],
  unreadableProfiles: [{ name: 'broken-profile', reason: 'bad patch' }],
  otherProfilesUnavailable: null,
}

const skillsFace = {
  t,
  load: async () => skillsValue,
  useWorkspaces: selector => selector({ items: [{ workspaceId: 'w1', path: 'D:\\work' }] }),
}
const mcpFace = { t, load: async () => mcpValue }

console.log('\n=== skills page (data + incomplete + broken preset) ===')
console.log(outline(await mount(skillsPage, skillsFace)).join('\n'))
console.log('\n=== mcp page (profile + preset rows) ===')
console.log(outline(await mount(mcpPage, mcpFace)).join('\n'))

console.log('\n=== skills page, no project open ===')
console.log(outline(await mount(skillsPage, {
  ...skillsFace,
  useWorkspaces: selector => selector({ items: [] }),
})).slice(0, 4).join('\n'))

console.log('\n=== skills page, empty catalog ===')
console.log(outline(await mount(skillsPage, {
  ...skillsFace,
  load: async () => ({ available: true, cwd: null, complete: true, scopes: [], entries: [] }),
})).slice(-3).join('\n'))

console.log('\n=== skills page, no registry composed ===')
console.log(outline(await mount(skillsPage, {
  ...skillsFace,
  load: async () => ({ available: false, reason: 'no skill registry is composed', cwd: null, scopes: [], entries: [] }),
})).join('\n'))

console.log('\n=== mcp page, empty ===')
console.log(outline(await mount(mcpPage, {
  t,
  load: async () => ({ available: true, servers: [] }),
})).slice(-3).join('\n'))

// The distinct case that produced the original defect: the other-profile reader
// could not run at all, so an empty server list must NOT read as "none exist".
console.log('\n=== mcp page, other-profile reader unavailable ===')
console.log(outline(await mount(mcpPage, {
  t,
  load: async () => ({
    available: true, servers: [],
    unreadableProfiles: [], otherProfilesUnavailable: "Cannot find package '@deepseek-ai/dsh-app-boot'",
  }),
})).join('\n'))

const recorded = []
console.log('\n=== failure branch ===')
{
  const instance = { hooks: [], cursor: 0, effects: [] }
  frame = instance
  const first = skillsPage({ ...skillsFace, load: async () => { throw new Error('nope') } })
  recorded.push(outline(first)[0])
  for (const effect of instance.effects) effect.callback()
  await new Promise(resolve => setTimeout(resolve, 0))
  instance.cursor = 0
  instance.effects = []
  frame = instance
  const second = skillsPage({ ...skillsFace, load: async () => { throw new Error('nope') } })
  console.log(outline(second).join('\n'))
}

console.log('\nno projects opened renders:', recorded.join(' / '))

for (const effect of [...effects].reverse()) {
  if (typeof effect.dispose === 'function') effect.dispose()
}
console.log('disposed effects:', effects.length)
console.log('OK')
