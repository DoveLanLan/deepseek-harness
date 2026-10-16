import { describe, expect, it } from 'vitest'
import { clampWidth, computeColumns, drawerWidth, SIDEBAR_DRAWER_MAX, SIDEBAR_DRAWER_WIDTH } from '../src/client/columns.ts'

describe('clampWidth', () => {
  it('clamps into the range and rounds', () => {
    expect(clampWidth(250.4, 240, 420)).toBe(250)
    expect(clampWidth(100, 240, 420)).toBe(240)
    expect(clampWidth(9999, 240, 420)).toBe(420)
  })
})

describe('drawerWidth', () => {
  it('covers the frame fraction and stops at the ceiling', () => {
    expect(drawerWidth(390)).toBe(343)
    expect(drawerWidth(500)).toBe(440)
    expect(drawerWidth(1023)).toBe(SIDEBAR_DRAWER_MAX)
    expect(drawerWidth(1920)).toBe(SIDEBAR_DRAWER_MAX)
  })

  it('never claims more than the width expression its stylesheet resolves', () => {
    expect(SIDEBAR_DRAWER_WIDTH).toBe('min(88%, 448px)')
    for (const viewport of [320, 390, 393, 509, 511, 1023]) {
      expect(drawerWidth(viewport)).toBeLessThanOrEqual(Math.min(viewport * 0.88, SIDEBAR_DRAWER_MAX))
    }
  })
})

describe('computeColumns', () => {
  it('gives each edge column its preference when the center has enough room', () => {
    expect(computeColumns(1920, 280, 864)).toEqual({ sidebar: 280, center: 776, rightbar: 864 })
  })

  it('keeps only the left rail when both panels are closed', () => {
    expect(computeColumns(1920, 0, 0)).toEqual({ sidebar: 56, center: 1864, rightbar: 0 })
  })

  it('clamps sidebar preferences and limits the right panel to 70% of the frame', () => {
    expect(computeColumns(3000, 9999, 9999)).toEqual({ sidebar: 420, center: 480, rightbar: 2100 })
    expect(computeColumns(1920, 1, 1)).toEqual({ sidebar: 264, center: 1356, rightbar: 300 })
  })

  it.each([
    [1300, 280, 620, 400],
    [1100, 280, 420, 400],
    [1120, 420, 300, 400],
    [1119, 420, 0, 699],
    [1024, 420, 0, 604],
    [756, 0, 300, 400],
    [755, 0, 0, 699],
    [455, 0, 0, 399],
    [20, 0, 0, 0],
  ])('solves frame %i and sidebar %i to right %i and center %i', (viewport, sidebar, rightbar, center) => {
    expect(computeColumns(viewport, sidebar, 864)).toEqual({ sidebar: sidebar || 56, center, rightbar })
  })

  it('does not reduce the wide sidebar to keep a normal right panel open', () => {
    expect(computeColumns(1024, 420, 500)).toEqual({ sidebar: 420, center: 604, rightbar: 0 })
  })

  it('restores a still-open preference when the frame widens', () => {
    expect(computeColumns(1100, 280, 864).rightbar).toBe(420)
    expect(computeColumns(1920, 280, 864).rightbar).toBe(864)
  })

  it('leaves a closed right track closed when the frame widens', () => {
    expect(computeColumns(755, 0, 0).rightbar).toBe(0)
    expect(computeColumns(1920, 0, 0).rightbar).toBe(0)
  })
})
