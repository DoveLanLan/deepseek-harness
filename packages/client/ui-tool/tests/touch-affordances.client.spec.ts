/** Hover capability gating, touch target sizes, and narrow-row degradation; jsdom has no media or container matching. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const TOOL_ROW = '../src/client/tool/components/ToolRow.module.css'
const BASH_ROW = '../src/client/tool/toolviews/bash-sample.module.css'
const ROWS = [
  ['ToolRow', TOOL_ROW],
  ['BashRow', BASH_ROW],
] as const
/** The one narrow-row threshold both tool sheets share. */
const NARROW_ROW = '@container (max-width: 360px) {'

function sheet(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
}

/**
 * Body of one at-rule block, by brace matching.
 * @param header - the at-rule header including its opening brace.
 * @param rules - text starting at that header.
 * @returns the block body, or undefined when the header never opens one.
 */
function body(header: string, rules: string): string | undefined {
  const from = header.length - 1
  let depth = 0
  for (let at = from; at < rules.length; at += 1) {
    if (rules[at] === '{') depth += 1
    else if (rules[at] === '}') {
      depth -= 1
      if (depth === 0) return rules.slice(from + 1, at)
    }
  }
  return undefined
}

/**
 * Concatenated bodies of every block with one at-rule header.
 * @param header - the at-rule header including its opening brace.
 * @param rules - the sheet or fragment to scan.
 * @returns the joined bodies, empty when the sheet has no such block.
 */
function blocks(header: string, rules: string): string {
  const found: string[] = []
  let from = 0
  for (;;) {
    const start = rules.indexOf(header, from)
    if (start === -1) return found.join('\n')
    const block = body(header, rules.slice(start))
    if (block === undefined) return found.join('\n')
    found.push(block)
    from = start + header.length + block.length + 1
  }
}

/** The sheet's rules with every at-rule block and comment removed. */
function unconditional(rules: string): string {
  const source = rules.replace(/\/\*[\s\S]*?\*\//g, ' ')
  let kept = ''
  let at = 0
  for (;;) {
    const match = /@[a-z-]+[^{}]*\{/.exec(source.slice(at))
    if (match === null) return kept + source.slice(at)
    const [header = ''] = match
    const start = at + match.index
    kept += source.slice(at, start)
    const block = body(header, source.slice(start))
    if (block === undefined) return kept + source.slice(start)
    at = start + header.length + block.length + 1
  }
}

/** Declarations of one exact selector inside a sheet or block body. */
function declarations(selector: string, rules: string): string | undefined {
  for (const [, list = '', found = ''] of rules.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (list.split(',').map(value => value.trim()).includes(selector)) return found
  }
  return undefined
}

describe('ToolRow hover capability', () => {
  const css = sheet(TOOL_ROW)
  const hover = blocks('@media (hover: hover) {', css)
  const rest = unconditional(css)

  it('hides the Inspect pill only where hover can reveal it again', () => {
    // The pill is the transcript row's only path to a tool call's full record:
    // opacity 0 on a device without hover leaves it permanently unreachable
    // (skill 6.1, 6.2).
    expect(declarations('.inspectButton', hover)).toContain('opacity: 0')
    expect(declarations('.root:hover .inspectButton', hover)).toContain('opacity: 1')
    expect(declarations('.inspectButton', rest)).not.toContain('opacity: 0')
    expect(rest).not.toContain('.root:hover .inspectButton')
  })

  it('keeps the keyboard reveal unconditional', () => {
    expect(declarations('.inspectButton:focus-visible', rest)).toContain('opacity: 1')
  })
})

describe('bash row hover capability', () => {
  const css = sheet(BASH_ROW)
  const hover = blocks('@media (hover: hover) {', css)
  const rest = unconditional(css)

  it('keeps the Inspect pill visible without hover', () => {
    expect(declarations('.inspectButton', hover)).toContain('opacity: 0')
    expect(declarations('.card:hover .inspectButton', hover)).toContain('opacity: 1')
    expect(declarations('.inspectButton:focus-visible', rest)).toContain('opacity: 1')
    expect(declarations('.inspectButton', rest)).not.toContain('opacity: 0')
    expect(rest).not.toContain('.card:hover .inspectButton')
  })

  it('states the expansion with a held chevron instead of a hover preview', () => {
    // The pointer preview crossfades the glyph; a tap must not leave the swap
    // behind, and touch needs the same statement without a hover to trigger it.
    expect(declarations('.root:hover .iconIdle', hover)).toContain('opacity: 0')
    expect(declarations('.root:hover .chevronHover', hover)).toContain('opacity: 1')

    const none = blocks('@media (hover: none) {', css)
    expect(declarations('.iconIdle', none)).toContain('display: none')
    expect(declarations('.chevronHover', none)).toContain('opacity: 1')

    expect(rest).not.toContain('.root:hover .iconIdle')
    expect(rest).not.toContain('.root:hover .chevronHover')
  })

  it('leaves the row text color hover feedback ungated', () => {
    // A color shift on an always-visible row is feedback, not a reveal of
    // content or an action; it stays out of the capability query.
    expect(declarations('.root:hover', rest)).toContain('color: var(--dsw-alias-label-secondary)')
  })
})

describe('tool card touch targets', () => {
  it.each([
    [TOOL_ROW, ['.row', '.inspectButton']],
    [BASH_ROW, ['.root[data-expandable]', '.inspectButton']],
    ['../src/client/tool/components/ToolDetails.module.css', ['.group > summary', '.unchanged summary']],
  ] as const)('%s raises the controls to 44px on coarse pointers', (path, selectors) => {
    const coarse = blocks('@media (pointer: coarse) {', sheet(path))
    for (const selector of selectors) {
      expect(declarations(selector, coarse)).toContain('min-height: 44px')
    }
    // The hit area grows; the glyphs and labels keep their sizes.
    const properties = [...coarse.matchAll(/([a-z-]+)\s*:/g)].map(match => match[1] ?? '')
    expect(properties).not.toContain('width')
    expect(properties).not.toContain('height')
  })
})

describe('narrow-row degradation', () => {
  /** Declarations of one selector, failing when the fragment has no such rule. */
  function rule(selector: string, rules: string): string {
    const found = declarations(selector, rules)
    if (found === undefined) throw new Error(`No \`${selector}\` rule in the fragment`)
    return found
  }

  it.each(ROWS)('%s sizes the row itself as the query container', (_name, path) => {
    // The row's own width, not the viewport, decides the degradation: the
    // transcript column is narrower than the frame on every narrow layout.
    expect(rule('.root', unconditional(sheet(path)))).toContain('container-type: inline-size')
    // A container query cannot read a custom property, so the shared threshold
    // is a literal in each sheet; exactly one query per sheet keeps them equal.
    expect(sheet(path).match(/@container/g)).toHaveLength(1)
    expect(blocks(NARROW_ROW, sheet(path))).not.toBe('')
  })

  it.each(ROWS)('%s sheds only the kind label and its separator', (_name, path) => {
    const narrow = blocks(NARROW_ROW, sheet(path))
    // Clipped, not `display: none`: the label leaves the flex line but stays in
    // the row's accessible name.
    expect(rule('.title', narrow)).toContain('position: absolute')
    expect(rule('.title', narrow)).toContain('clip: rect(0 0 0 0)')
    expect(rule('.sep', narrow)).toContain('display: none')
    // The primary text, its count suffixes, the diff totals, the file link, and
    // every state or error carriage keep their width unconditionally (skill 3.2).
    expect(narrow).not.toMatch(
      /\.(summary|summarySuffix|diffStat|fileLink|errorSummary|stoppedSummary|inspectButton|row)\b/,
    )
  })

  it.each(ROWS)('%s leaves the wide row untouched', (_name, path) => {
    const rest = unconditional(sheet(path))
    expect(rule('.title', rest)).not.toContain('position: absolute')
    expect(rule('.sep', rest)).not.toContain('display: none')
  })
})
