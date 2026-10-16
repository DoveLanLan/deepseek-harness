/**
 * The wide-table scroll contract as CSS text. A ≥4-column table keeps its
 * natural width, so its scroller is the only path to the overflow columns.
 * Three properties must hold: the wrapper rests scrollable wherever the primary
 * input cannot hover (a touch phone has no gesture producing :hover, and
 * Chromium does not match :focus-visible for taps either); the pointer-only
 * resting state stays inside a hover capability query; and the frame, not the
 * scroller, is what a hosting layout widens and what carries the edge
 * affordances. jsdom has no layout, so these read the declarations that encode
 * it.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/markdown/MarkdownText.module.css', import.meta.url)),
  'utf8',
)
const declarationText = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

function escapeSelector(selector: string): string {
  return selector.replace(/[.[\]():*+^$\\]/g, '\\$&')
}

function declarations(source: string, selector: string): string[] {
  const rule = new RegExp(`(?:^|\\})\\s*${escapeSelector(selector)}\\s*\\{([^{}]*)\\}`).exec(source)
  if (rule === null) throw new Error(`MarkdownText.module.css has no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

/** The `@media <query>` block: its full text and its body, so the body can also be removed. */
function mediaBlock(query: string): { raw: string; body: string } {
  const media = new RegExp(`@media\\s*${escapeSelector(query)}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(declarationText)
  if (media === null) throw new Error(`MarkdownText.module.css has no \`@media ${query}\` block`)
  return { raw: media[0], body: media[1] ?? '' }
}

const hoverGate = mediaBlock('(hover: hover)')
/** Everything outside the hover gate: what a non-hovering input actually matches. */
const ungated = declarationText.replace(hoverGate.raw, ' ')

describe('MarkdownText.module.css wide-table scroll gate', () => {
  it('rests the wrapper scrollable, so a table without hover stays reachable', () => {
    expect(declarations(declarationText, '.tableScroll')).toEqual(expect.arrayContaining([
      'overflow-x: auto',
    ]))
  })

  it('gates every md-table-wide resting override behind a hovering primary input', () => {
    // The gate carries the hiding rule, the reveal rule, and the reserved bar
    // height; none of the three may apply to a non-hovering device.
    expect(hoverGate.body).toContain('overflow-x: hidden')
    expect(hoverGate.body).toContain('overflow-x: scroll')
    expect(hoverGate.body).toContain('padding-bottom: var(--dsh-scrollbar-width, 5px)')
    expect(hoverGate.body).toContain('padding-bottom: 0')
  })

  it('leaves no md-table-wide rule outside the gate', () => {
    // With the base `overflow-x: auto` above, this is what makes the no-hover
    // arm scroll at rest; an ungated rule here would silently restore the bug.
    expect(ungated).not.toContain('md-table-wide')
  })

  it('keeps the cell cap independent of the viewport', () => {
    // A `min(30vw, 320px)` clamp shrank the cap to 117px at 390px, turning a
    // wide table into tall narrow tubes instead of letting it scroll. The cap
    // is a fixed reading measure in both cell rules.
    for (const cell of ['.tableScroll th', '.tableScroll td']) {
      const rules = declarations(declarationText, cell)
      expect(rules).toContain('max-width: 320px')
      expect(rules.some(rule => rule.includes('vw'))).toBe(false)
    }
  })
})

describe('MarkdownText.module.css table edge affordances', () => {
  it('anchors the shadows on the frame the breakout widens', () => {
    // The frame is the shadows' containing block; the scroller inside it is
    // what moves, so both edges stay put while the table travels under them.
    // `min-width: 0` is load-bearing: the frame is not a scroll container, so
    // its automatic minimum size would otherwise be the table's min-content
    // width and a wide table would push the transcript sideways.
    expect(declarations(declarationText, '.tableFrame')).toEqual(expect.arrayContaining([
      'position: relative',
      'min-width: 0',
      'max-width: 100%',
    ]))
  })

  it('rests the shadows hidden and pointer-transparent', () => {
    // Measured state alone reveals them: an unmeasured shadow would claim
    // hidden content on a table that fits.
    expect(declarations(declarationText, '.tableEdgeShadow')).toEqual(expect.arrayContaining([
      'position: absolute',
      'pointer-events: none',
      'opacity: 0',
    ]))
  })

  it('reveals a shadow only for the side the frame reports', () => {
    expect(declarationText).toContain(".tableFrame[data-table-edges='left'] .tableEdgeShadow[data-side='left']")
    expect(declarationText).toContain(".tableFrame[data-table-edges='right'] .tableEdgeShadow[data-side='right']")
    expect(declarationText).toContain(".tableFrame[data-table-edges='both'] .tableEdgeShadow")
  })
})
