/**
 * The table edge affordance decision. A shadow may only appear on a side that
 * actually hides content: claiming hidden columns on a table that fits is worse
 * than showing nothing, and leaving a shadow on a side the reader has already
 * scrolled to reads as a broken control. Only geometry separates those cases,
 * so the arithmetic is pinned here.
 */
import { describe, expect, it } from 'vitest'
import { resolveTableEdges } from '../src/markdown/table-edges.ts'

/** A scrollport 300px wide whose content is `content` px wide, scrolled by `offset`. */
function viewport(content: number, offset: number): { scrollLeft: number; scrollWidth: number; clientWidth: number } {
  return { scrollLeft: offset, scrollWidth: content, clientWidth: 300 }
}

describe('resolveTableEdges', () => {
  it('reports nothing when the table fits', () => {
    expect(resolveTableEdges(viewport(300, 0))).toBe('none')
    expect(resolveTableEdges(viewport(120, 0))).toBe('none')
  })

  it('reports the right side only before any travel', () => {
    expect(resolveTableEdges(viewport(900, 0))).toBe('right')
  })

  it('reports the left side only at the end of the travel', () => {
    expect(resolveTableEdges(viewport(900, 600))).toBe('left')
  })

  it('reports both sides in the middle of the travel', () => {
    expect(resolveTableEdges(viewport(900, 250))).toBe('both')
  })

  it('absorbs sub-pixel scroll offsets at either end', () => {
    // Engines round scroll offsets; a fraction of a pixel of reported travel
    // must not leave a shadow over content the reader can already see.
    expect(resolveTableEdges(viewport(900, 0.5))).toBe('right')
    expect(resolveTableEdges(viewport(900, 599.5))).toBe('left')
    expect(resolveTableEdges(viewport(900, 600.5))).toBe('left')
  })

  it('treats sub-pixel overflow as fitting', () => {
    expect(resolveTableEdges(viewport(300.5, 0))).toBe('none')
    expect(resolveTableEdges(viewport(301, 0))).toBe('none')
  })

  it('reports nothing when an overscrolled offset lands past the end', () => {
    // Elastic overscroll can report an offset beyond the travel; the frame is
    // still at its end, so only the left side hides content.
    expect(resolveTableEdges(viewport(900, 700))).toBe('left')
  })
})
