/**
 * AppFrame.module.css shell contract as CSS text. jsdom has no layout and no
 * env(), so the declarations behind the mobile shell are pinned here: the
 * narrow overlay drawer's geometry, and the safe-area inset that holds the
 * shell clear of the status bar and the landscape cutout. Every inset the sheet
 * consumes carries a 0px fallback, which is what keeps desktop browsers and
 * Electron at their current geometry — and the bottom inset must stay
 * unconsumed, because the composer sits against it.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const sheet = readFileSync(fileURLToPath(new URL('../src/client/AppFrame.module.css', import.meta.url)), 'utf8')
const source = sheet.replace(/\/\*[\s\S]*?\*\//g, ' ')

/**
 * Declarations of one rule, comments removed.
 * @param selector - the rule's selector text as written in the sheet.
 * @returns trimmed declarations, or a thrown error when the rule is absent.
 */
function declarations(selector: string): string[] {
  const pattern = new RegExp(`(?:^|[{}])\\s*${selector.replace(/[.[\]():*+^$\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`)
  const rule = pattern.exec(source)
  if (rule === null) throw new Error(`AppFrame.module.css has no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

describe('AppFrame.module.css shell frame', () => {
  it('fits the safe-area inset inside the frame box that hosts the column tracks', () => {
    expect(declarations('.frame')).toEqual(expect.arrayContaining([
      'height: 100%',
      'min-width: 0',
      'box-sizing: border-box',
      'overflow: hidden',
      'padding-top: var(--dsh-safe-area-top, 0px)',
      'padding-right: var(--dsh-safe-area-right, 0px)',
      'padding-left: var(--dsh-safe-area-left, 0px)',
    ]))
  })

  it('composes the Windows caption band with the top inset', () => {
    expect(declarations(':global([data-windows-titlebar]) .frame')).toEqual(expect.arrayContaining([
      'padding-top: calc(var(--dsh-windows-titlebar-height) + var(--dsh-safe-area-top, 0px))',
    ]))
  })

  it('leaves the bottom inset to the surface that sits against it', () => {
    // The composer owns the home-indicator gutter; insetting the shell too
    // would reserve it twice.
    expect(source).not.toContain('--dsh-safe-area-bottom')
  })

  it('reads every inset it consumes with a 0px fallback', () => {
    const references = [...source.matchAll(/var\((--dsh-safe-area-[a-z]+)([^)]*)\)/g)]
    expect(references.length).toBeGreaterThan(0)
    for (const [, name, fallback] of references) {
      expect(fallback?.replace(/\s+/g, ' ').trim(), name).toBe(', 0px')
    }
  })
})

describe('AppFrame.module.css narrow drawer', () => {
  it('floats the open sidebar over the columns with the published width expression', () => {
    expect(declarations('.frame[data-sidebar-drawer] .sidebarCol')).toEqual(expect.arrayContaining([
      'position: absolute',
      'top: 0',
      'bottom: 0',
      'left: 0',
      'width: var(--dsh-sidebar-drawer-width)',
      'min-width: 0',
      'border: 0',
      'box-shadow: var(--dsw-elevation-panel)',
    ]))
  })

  it('covers the frame with the dismissal surface', () => {
    expect(declarations('.drawerScrim')).toEqual(expect.arrayContaining([
      'position: absolute',
      'inset: 0',
    ]))
  })
})
