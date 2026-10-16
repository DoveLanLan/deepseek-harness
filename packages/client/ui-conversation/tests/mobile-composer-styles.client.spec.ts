/**
 * The composer's pointer-capability adaptations as CSS text. jsdom evaluates no
 * media query and has no layout, so these read the declarations the touch input
 * floor, its line box, the matching scrollport cap, and the composer's bottom
 * clearance depend on — and that the desktop pair stays on the Settings
 * preference.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Read one sheet with its comments stripped and whitespace collapsed, so
 * declarations and selectors compare literally. */
const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/client/skeleton/${name}`, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')

/** Return the body of the at-rule starting at `header`, braces balanced. */
function block(css: string, header: string): string {
  const start = css.indexOf(header)
  expect(start, `missing ${header}`).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    else if (css[index] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, index)
    }
  }
  throw new Error(`unterminated ${header}`)
}

/** Return the first rule body for a selector that starts its own rule. */
function rule(css: string, selector: string): string {
  const pattern = new RegExp(`(?:^|[;{}])\\s*${selector.replace(/[.[\]():*+^$\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`)
  const match = pattern.exec(css)
  expect(match, `missing ${selector} rule`).not.toBeNull()
  return match?.[1] ?? ''
}

describe('composer input size on devices without hover', () => {
  const inputBar = read('InputBar.module.css')
  const touch = block(inputBar, '@media (hover: none)')

  it('leaves the desktop card on the Settings font-size preference', () => {
    const card = rule(inputBar, '.card')
    expect(card).toContain('font-size: var(--dsh-content-font-size, 14px)')
    expect(card).toContain('line-height: calc(24px + var(--dsh-content-font-delta, 0px))')
  })

  it('floors the draft at the safe input size without capping a larger preference', () => {
    const card = rule(touch, '.card')
    expect(card).toContain(
      'font-size: max(var(--dsh-content-font-size, 14px), var(--dsh-input-font-size-safe, 16px))',
    )
  })

  it('keeps the 10px leading at whichever size wins the floor', () => {
    const card = rule(touch, '.card')
    expect(card).toContain('line-height: calc( 24px + max(var(--dsh-content-font-delta, 0px),')
    expect(card).toContain('calc(var(--dsh-input-font-size-safe, 16px) - 14px)')
  })

  it('raises the composer scrollport cap to the same 14 lines', () => {
    const root = read('ConversationRoot.module.css')
    expect(rule(root, '.composerSeat')).toContain('--dsh-composer-text-max-height: 336px')
    expect(rule(block(root, '@media (hover: none)'), '.composerSeat'))
      .toContain('--dsh-composer-text-max-height: 364px')
    // 14 lines x the 26px safe line box.
    expect(14 * 26).toBe(364)
  })
})

describe('composer bottom clearance', () => {
  const inputBar = read('InputBar.module.css')

  it('adds the safe area and the soft-keyboard inset to the seat pad', () => {
    const root = rule(inputBar, '.root')
    expect(root).toContain('padding: 0 var(--dsh-composer-side-clearance) calc(')
    expect(root).toContain('4px + max(var(--dsh-safe-area-bottom, 0px), var(--dsh-composer-keyboard-inset, 0px))')
  })

  it('keeps the same clearance in the hero composer', () => {
    expect(rule(inputBar, '.hero'))
      .toContain('max( var(--dsh-safe-area-bottom, 0px), var(--dsh-composer-keyboard-inset, 0px) )')
  })
})

describe('conversation column adaptation', () => {
  const root = read('ConversationRoot.module.css')
  const narrow = block(root, '@container (max-width: 560px)')

  it('queries the header container instead of the viewport', () => {
    expect(rule(root, '.header')).toContain('container-type: inline-size')
    expect(root).not.toMatch(/@media \(max-width/)
  })

  it('wraps the action area below a full-width title', () => {
    expect(rule(narrow, '.titleRow')).toContain('flex-wrap: wrap')
    expect(rule(narrow, '.titleCluster')).toContain('flex: 1 1 100%')
    expect(rule(narrow, '.headerActions')).toContain('margin-left: auto')
    expect(rule(narrow, '.crumb')).toContain('max-width: 100cqw')
  })

  it('gives min-width back along the column width chain', () => {
    for (const selector of ['.body', '.viewArea', '.scrollBody', '.composerStack', '.composerSeat', '.titleRow']) {
      expect(rule(root, selector), selector).toContain('min-width: 0')
    }
  })
})
