// @vitest-environment jsdom
/**
 * Soft-keyboard clearance at the DOM boundary: the composer publishes the
 * covered height the visual viewport reports, keeps it current on resize and
 * scroll, and leaves a hovering pointer completely alone.
 */
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { installKeyboardInset } from '../src/client/skeleton/keyboard-inset.ts'

type Listener = () => void

/** A visual viewport whose height and offset the test drives. */
function fakeViewport() {
  const listeners = new Map<string, Set<Listener>>()
  const viewport = {
    height: 800,
    offsetTop: 0,
    addEventListener: (type: string, listener: Listener): void => {
      const set = listeners.get(type) ?? new Set<Listener>()
      set.add(listener)
      listeners.set(type, set)
    },
    removeEventListener: (type: string, listener: Listener): void => {
      listeners.get(type)?.delete(listener)
    },
  }
  return {
    viewport,
    fire: (type: string): void => {
      for (const listener of listeners.get(type) ?? []) listener()
    },
    count: (type: string): number => listeners.get(type)?.size ?? 0,
  }
}

/** Install `window.visualViewport` and the pointer query for one test. */
function stubWindow(touch: boolean, visualViewport: unknown): void {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: touch && query === '(hover: none)' })))
  vi.stubGlobal('innerHeight', 800)
  vi.stubGlobal('visualViewport', visualViewport)
}

afterEach(() => { vi.unstubAllGlobals() })

describe('composer keyboard inset', () => {
  it('publishes the covered height and follows the viewport', () => {
    const { viewport, fire, count } = fakeViewport()
    stubWindow(true, viewport)
    const root = document.createElement('div')
    onTestFinished(() => { root.remove() })

    const uninstall = installKeyboardInset(root)
    expect(count('resize')).toBe(1)
    expect(count('scroll')).toBe(1)
    expect(root.style.getPropertyValue('--dsh-composer-keyboard-inset')).toBe('')

    viewport.height = 480
    fire('resize')
    expect(root.style.getPropertyValue('--dsh-composer-keyboard-inset')).toBe('320px')

    viewport.offsetTop = 20
    fire('scroll')
    expect(root.style.getPropertyValue('--dsh-composer-keyboard-inset')).toBe('300px')

    uninstall?.()
    expect(count('resize')).toBe(0)
    expect(count('scroll')).toBe(0)
    expect(root.style.getPropertyValue('--dsh-composer-keyboard-inset')).toBe('')
  })

  it('clears the property when nothing is covered', () => {
    const { viewport, fire } = fakeViewport()
    stubWindow(true, viewport)
    const root = document.createElement('div')
    onTestFinished(() => { root.remove() })

    const uninstall = installKeyboardInset(root)
    viewport.height = 480
    fire('resize')
    expect(root.style.getPropertyValue('--dsh-composer-keyboard-inset')).toBe('320px')
    viewport.height = 800
    fire('resize')
    expect(root.style.getPropertyValue('--dsh-composer-keyboard-inset')).toBe('')
    uninstall?.()
  })

  it('installs nothing where a pointer can hover', () => {
    const { viewport, count } = fakeViewport()
    stubWindow(false, viewport)
    const root = document.createElement('div')
    onTestFinished(() => { root.remove() })

    expect(installKeyboardInset(root)).toBeUndefined()
    expect(count('resize')).toBe(0)
    expect(count('scroll')).toBe(0)
  })

  it('installs nothing without a visual viewport or a root', () => {
    stubWindow(true, undefined)
    const root = document.createElement('div')
    onTestFinished(() => { root.remove() })
    expect(installKeyboardInset(root)).toBeUndefined()

    vi.stubGlobal('visualViewport', null)
    expect(installKeyboardInset(root)).toBeUndefined()
    expect(installKeyboardInset(null)).toBeUndefined()
  })
})
