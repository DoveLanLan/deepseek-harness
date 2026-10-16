/**
 * Mobile-platform stylesheet contract, asserted against the CSS text on disk:
 * mobile-platform.css owns the two mobile-browser floors the layout cannot
 * express on its own — the editable-region font-size floor that keeps iOS
 * Safari from zooming the page on focus, and the safe-area insets that hold the
 * fixed-height shell clear of the cutout and home indicator — and it defines
 * both on `:root` so every consumer inherits them.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseRules, varReferences } from './stylesheet-scan.ts'

/** Editable-region floor token; the 16px value is the iOS focus-zoom threshold. */
const INPUT_FLOOR = '--dsh-input-font-size-safe'

/** Safe-area side to the `env()` variable it mirrors. */
const SAFE_AREA_INSETS = {
  top: 'safe-area-inset-top',
  right: 'safe-area-inset-right',
  bottom: 'safe-area-inset-bottom',
  left: 'safe-area-inset-left',
} as const

const sheetPath = fileURLToPath(new URL('../src/styles/mobile-platform.css', import.meta.url))
const rules = parseRules(readFileSync(sheetPath, 'utf8'))
const rootRule = rules.find(rule => rule.selectors.includes(':root'))
const declarations = new Map(rootRule?.declarations ?? [])

describe('mobile-platform.css platform floors', () => {
  it('pins the editable-region floor at 16px on :root', () => {
    // Below 16px iOS Safari zooms the focused field, and the whole page with
    // it; a scaled value would reintroduce that zoom for the default 14px
    // content size, so the token holds the raw threshold.
    const value = declarations.get(INPUT_FLOOR)
    expect(value).toBe('16px')
    expect(varReferences(value ?? '')).toEqual([])
  })

  it('derives every safe-area inset from its env() variable with a 0px fallback', () => {
    // The fallback keeps desktop browsers and Electron at their current
    // geometry, so consumers apply the tokens without a capability query.
    for (const [side, variable] of Object.entries(SAFE_AREA_INSETS)) {
      expect(declarations.get(`--dsh-safe-area-${side}`), side).toBe(`env(${variable}, 0px)`)
    }
  })
})
