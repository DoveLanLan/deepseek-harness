/** Hover capability gating and touch target sizes; jsdom has no media matching or layout. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function sheet(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/client/${name}`, import.meta.url)), 'utf8')
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

/** Declarations of one exact selector in a rule of a sheet or block body. */
function declarations(selector: string, rules: string): string | undefined {
  for (const [, list = '', found = ''] of rules.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (list.split(',').map(value => value.trim()).includes(selector)) return found
  }
  return undefined
}

describe('changed-files hover capability', () => {
  const css = sheet('ChangedFiles.module.css')
  const hover = blocks('@media (hover: hover) {', css)
  const rest = unconditional(css)

  it('swaps the counts for the preview label only where hover can swap them back', () => {
    // The label names a gesture a touch device cannot perform; its counts are
    // the turn's primary state, so they stay on screen there (skill 2.2, 6.1).
    expect(declarations('.header:hover .statCounts', hover)).toContain('display: none')
    expect(declarations('.header:hover .previewHint', hover)).toContain('display: inline')
    expect(rest).not.toContain('.header:hover .statCounts')
    expect(rest).not.toContain('.header:hover .previewHint')
    expect(declarations('.previewHint', rest)).toContain('display: none')
  })

  it('keeps the keyboard swap unconditional', () => {
    expect(declarations('.header:focus-visible .statCounts', rest)).toContain('display: none')
    expect(declarations('.header:focus-visible .previewHint', rest)).toContain('display: inline')
  })

  it('leaves the header hover fill and the row/toggle fills ungated', () => {
    // Fills on always-visible controls are feedback, not reveals.
    expect(declarations('button.header:hover:not(:disabled)', rest)).toContain('background: var(--changes-hover)')
    expect(declarations('.row:hover:not(:disabled)', rest)).toContain('background: var(--dsw-alias-interactive-bg-hover)')
  })
})

describe('delivery card hover capability', () => {
  const css = sheet('Deliverables.module.css')
  const hover = blocks('@media (hover: hover) {', css)

  it('keeps the description line without hover', () => {
    expect(declarations(".file:hover .description:not([role='status']) .secondaryText", hover))
      .toContain('display: none')
    expect(declarations(".file:hover .description:not([role='status']) .previewHint", hover))
      .toContain('display: inline')

    const rest = unconditional(css)
    expect(rest).not.toContain('.file:hover .description')
    expect(declarations('.file:hover', rest)).toContain('background: var(--deliverable-hover)')
  })
})

describe('deliverable touch targets', () => {
  it('raises the changed-files rows and fold control', () => {
    const coarse = blocks('@media (pointer: coarse) {', sheet('ChangedFiles.module.css'))
    expect(declarations('.row', coarse)).toContain('min-height: 44px')
    expect(declarations('.toggle', coarse)).toContain('min-height: 44px')
  })

  it('raises the delivery fold control', () => {
    expect(declarations('.toggle', blocks('@media (pointer: coarse) {', sheet('Deliverables.module.css'))))
      .toContain('min-height: 44px')
  })

  it('raises the review header controls without resizing their glyphs', () => {
    const coarse = blocks('@media (pointer: coarse) {', sheet('ReviewTab.module.css'))
    for (const selector of ['.tool', '.selectorButton']) {
      expect(declarations(selector, coarse)).toContain('min-width: 44px')
      expect(declarations(selector, coarse)).toContain('min-height: 44px')
    }
    expect(declarations('.tool svg', unconditional(sheet('ReviewTab.module.css')))).toContain('width: 15px')
  })

  it('grows the comparison header to hold them', () => {
    const coarse = blocks('@media (pointer: coarse) {', sheet('FileDiff.module.css'))
    expect(declarations('.header', coarse)).toContain('min-height: 44px')
    expect(declarations('.header', coarse)).toContain('height: auto')
  })
})
