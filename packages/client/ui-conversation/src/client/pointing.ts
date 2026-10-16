/**
 * Pointer-capability facts the client adapts to. The composer's touch
 * adaptations — the safe input font size, Enter-as-line-break, and the
 * soft-keyboard clearance — read the same media query as their CSS half, so
 * the behavior and the presentation cannot drift apart.
 */

/**
 * Whether the primary pointing device cannot hover.
 * @returns true when the device reports no hover capability.
 */
export function isTouchPointer(): boolean {
  // A non-browser render environment (jsdom, an old engine) has no query
  // surface; the desktop gesture is the answer there.
  return typeof window.matchMedia === 'function' && window.matchMedia('(hover: none)').matches
}
