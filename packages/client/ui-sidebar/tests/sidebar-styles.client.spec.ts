/** Sidebar shell style contracts shared with its slot-owned controls. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/SidebarRoot.module.css', import.meta.url)), 'utf8')

/**
 * Declarations of one exact selector, keyed by property.
 * @param selector - exact selector text.
 * @param rules - the sheet or block body to search.
 * @returns the normalized declarations, or undefined when absent.
 */
function declarations(selector: string, rules: string = css): Map<string, string> | undefined {
  const withoutComments = rules.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    const found = new Map<string, string>()
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
    return found
  }
  return undefined
}

/**
 * Body of one at-rule block, by brace matching.
 * @param header - the at-rule header including its opening brace.
 * @param rules - text starting at that header.
 * @returns the block body, or undefined when the header never opens one.
 */
function atRuleBody(header: string, rules: string): string | undefined {
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
 * @returns the joined bodies, empty when the sheet has no such block.
 */
function blocks(header: string): string {
  const found: string[] = []
  let from = 0
  for (;;) {
    const start = css.indexOf(header, from)
    if (start === -1) return found.join('\n')
    const block = atRuleBody(header, css.slice(start))
    if (block === undefined) return found.join('\n')
    found.push(block)
    from = start + header.length + block.length + 1
  }
}

/** The sheet's rules with every at-rule block and comment removed. */
function unconditional(): string {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  let kept = ''
  let at = 0
  for (;;) {
    const match = /@[a-z-]+[^{}]*\{/.exec(source.slice(at))
    if (match === null) return kept + source.slice(at)
    const [header = ''] = match
    const start = at + match.index
    kept += source.slice(at, start)
    const block = atRuleBody(header, source.slice(start))
    if (block === undefined) return kept + source.slice(start)
    at = start + header.length + block.length + 1
  }
}

describe('SidebarRoot.module.css', () => {
  it('shares and cancels the wide shell trailing padding structurally', () => {
    const root = declarations('.root')
    expect(root?.get('--dsh-sidebar-inline-padding')).toBe('12px')
    expect(root?.get('padding')).toBe('6px var(--dsh-sidebar-inline-padding)')
    expect(declarations('.regionArea')?.get('margin-left')).toBe('-4px')
    expect(declarations('.regionArea')?.get('padding-left')).toBe('4px')
    expect(declarations('.regionArea')?.get('margin-right')).toBe(
      'calc(-1 * var(--dsh-sidebar-inline-padding))',
    )
    expect(declarations('.collapsed .regionArea')?.get('margin-left')).toBe('0')
    expect(declarations('.collapsed .regionArea')?.get('padding-left')).toBe('0')
    expect(declarations('.collapsed .regionArea')?.get('margin-right')).toBe('0')
  })

  it('moves the four upper controls while the settings seat only fades', () => {
    const animation = 'rail-in 150ms var(--ds-ease-in-out) backwards'
    for (const selector of [
      '.railIn .iconButton',
      '.railIn .newSession',
      '.railIn .regionArea',
    ]) {
      expect(declarations(selector)?.get('animation')).toBe(animation)
    }
    expect(declarations('.railIn .footArea')?.get('animation')).toBe(
      'rail-fade-in 150ms var(--ds-ease-in-out) backwards',
    )
    expect(css).toMatch(
      /@keyframes rail-in\s*\{\s*from\s*\{\s*opacity: 0;\s*transform: translateX\(49px\);\s*}\s*}/,
    )
    expect(css).toMatch(/@keyframes rail-fade-in\s*\{\s*from\s*\{\s*opacity: 0;\s*}\s*}/)
  })

  it('gives shell rail controls the same base anchor for their shared translation', () => {
    expect(declarations('.collapsed .logoRow')?.get('justify-content')).toBe('flex-start')
    expect(declarations('.collapsed .newSession')?.get('align-self')).toBe('flex-start')
    expect(declarations('.collapsed .newSession')?.get('width')).toBe('36px')
  })

  it('keeps the slotted brand row at the full artwork height', () => {
    expect(declarations('.brandIdentity')?.get('height')).toBe('24px')
    expect(declarations('.brandName')?.get('height')).toBe('24px')
    expect(declarations('.brandName')?.get('line-height')).toBe('24px')
    expect(declarations('.brandName')?.get('font-size')).toBe('18px')
    expect(declarations('.fallbackBrandName')?.get('font-size')).toBe('17px')
    expect(declarations('.fallbackBrandName')?.get('white-space')).toBe('nowrap')
  })
})

describe('rail hover capability', () => {
  const hover = blocks('@media (hover: hover) {')
  const rest = unconditional()

  it('gates every New Session hover fill on the pointer capability', () => {
    // A tap must not leave a fill behind on a device that cannot hover
    // (skill 6.2), including the collapsed rail's own variant.
    for (const selector of [
      '.newSession:hover',
      ":global([data-platform='darwin']) .newSession:hover",
      ":global([data-platform='darwin']) :global([data-ds-dark-theme]) .newSession:hover",
      '.collapsed .newSession:hover',
    ]) {
      expect(declarations(selector, hover)).toBeDefined()
      expect(rest).not.toContain(selector)
    }
    expect(declarations('.newSession:hover', hover)?.get('background')).toBe('var(--dsw-alias-button-floating-hover)')
    expect(declarations('.collapsed .newSession:hover', hover)?.get('background')).toBe('var(--dsw-alias-interactive-bg-hover)')
  })

  it('keeps the resting fills unconditional', () => {
    expect(declarations('.newSession')?.get('background')).toBe('var(--dsw-alias-button-elevated-fill)')
    expect(declarations(":global([data-platform='darwin']) .newSession")?.get('background')).toBe('rgb(255 255 255 / 0.55)')
    expect(declarations(":global([data-platform='darwin']) :global([data-ds-dark-theme]) .newSession")?.get('background')).toBe('rgb(255 255 255 / 0.15)')
    expect(declarations('.collapsed .newSession')?.get('background')).toBe('transparent')
  })

  it('gates the rail logo swap so a tap cannot strand the swapped glyph', () => {
    expect(declarations('.collapsed .toggle .panelIcon', rest)?.get('display')).toBe('none')
    expect(declarations('.collapsed .toggle:hover .panelIcon', hover)?.get('display')).toBe('inline')
    expect(declarations('.collapsed .toggle:hover .railMark', hover)?.get('display')).toBe('none')
    expect(rest).not.toContain('.collapsed .toggle:hover')
  })

  it('leaves the plain control fills ungated', () => {
    // Fills on always-visible, already-labeled controls are feedback rather
    // than a reveal, so they keep their hover state on every device.
    expect(declarations('.iconButton:hover', rest)?.get('background')).toBe('var(--dsw-alias-interactive-bg-hover)')
    expect(declarations('.panelRow:hover', rest)?.get('background')).toBe('var(--dsw-alias-interactive-bg-hover)')
  })
})
