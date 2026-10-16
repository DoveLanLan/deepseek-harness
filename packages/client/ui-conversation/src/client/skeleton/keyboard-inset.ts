/**
 * Soft-keyboard clearance for the composer: the part of the layout viewport an
 * open on-screen keyboard covers, published as a CSS custom property the
 * composer's bottom clearance reads. The layout viewport keeps its full height
 * while the visual viewport shrinks, so nothing in CSS can express this
 * measurement; the property is written straight onto the element instead of
 * passing through React state.
 */
import { isTouchPointer } from '../pointing.ts'

/** The property the composer's bottom clearance reads; absent means zero. */
const INSET_PROPERTY = '--dsh-composer-keyboard-inset'

/**
 * Publish the height an open soft keyboard covers on the composer root.
 * Devices that can hover install no listener: without an on-screen keyboard
 * the inset is always zero.
 * @param root - the composer root that carries the clearance property.
 * @returns the listener cleanup, or undefined when this device has no soft keyboard.
 */
export function installKeyboardInset(root: HTMLElement | null): (() => void) | undefined {
  const viewport = window.visualViewport
  // A render environment without the visual viewport (jsdom) reports no
  // listener surface; nothing there can open a soft keyboard either.
  if (root === null || viewport?.addEventListener === undefined || !isTouchPointer()) return undefined

  const publish = (): void => {
    // offsetTop covers the browser pushing the visual viewport down over a
    // scrolled layout viewport; a non-positive remainder covers nothing.
    const covered = window.innerHeight - viewport.height - viewport.offsetTop
    if (covered <= 0) {
      root.style.removeProperty(INSET_PROPERTY)
      return
    }
    root.style.setProperty(INSET_PROPERTY, `${String(Math.round(covered))}px`)
  }

  viewport.addEventListener('resize', publish)
  viewport.addEventListener('scroll', publish)
  publish()
  return () => {
    viewport.removeEventListener('resize', publish)
    viewport.removeEventListener('scroll', publish)
    root.style.removeProperty(INSET_PROPERTY)
  }
}
