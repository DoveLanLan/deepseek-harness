/**
 * Normal column geometry: the right column shrinks, then loses its track,
 * before the center drops below its minimum. The sidebar never concedes here;
 * AppFrame supplies its effective preference after responsive collapse.
 */

/** Resolved widths for one frame. */
export interface Columns { sidebar: number; center: number; rightbar: number }

/** Center width protected while the normal right column is open. */
export const CENTER_MIN = 400
/** Sidebar drag clamp floor. */
export const SIDEBAR_MIN = 264
/** Sidebar drag clamp ceiling. */
export const SIDEBAR_MAX = 420
/** Sidebar width before any user drag. */
export const SIDEBAR_DEFAULT = 280
/** Closed-sidebar rail: a 24px icon column between 16px horizontal paddings. */
export const SIDEBAR_COLLAPSED = 56
/** Viewport width below which the sidebar auto-collapses to the rail (deepsuite
 * LG breakpoint); a manual toggle below it opens the overlay drawer instead of
 * taking a track, so the center is never squeezed (stores.ts narrowExpanded). */
export const SIDEBAR_AUTO_COLLAPSE = 1024
/** Narrow drawer: percentage of the frame the overlay may cover. */
export const SIDEBAR_DRAWER_PERCENT = 88
/** Narrow drawer: absolute ceiling in px (28rem), so the overlay stays a panel
 * rather than covering a whole tablet frame. */
export const SIDEBAR_DRAWER_MAX = 448
/** The `min(percentage, ceiling)` width the drawer stylesheet consumes
 * (AppFrame.module.css) and {@link drawerWidth} resolves for the occupant. */
export const SIDEBAR_DRAWER_WIDTH = `min(${SIDEBAR_DRAWER_PERCENT}%, ${SIDEBAR_DRAWER_MAX}px)`
/** Right column drag clamp floor. */
export const RIGHTBAR_MIN = 300
/** Maximum normal right panel width as a fraction of the frame. */
export const RIGHTBAR_MAX_RATIO = 0.7
/** First-open right panel preference as a fraction of the frame. */
export const RIGHTBAR_DEFAULT_RATIO = 0.45

/**
 * Clamp a panel width into its contract range.
 * @param px - requested width.
 * @param min - range lower bound.
 * @param max - range upper bound.
 * @returns the clamped width.
 */
export function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)))
}

/**
 * Resolve the narrow drawer's covering width: the smaller of the frame
 * fraction and the absolute ceiling, floored so the occupant never claims more
 * than the `min()` width its stylesheet resolved (SIDEBAR_DRAWER_WIDTH).
 * @param viewport - frame width in px.
 * @returns the covered width in px.
 */
export function drawerWidth(viewport: number): number {
  return Math.min(Math.floor(viewport * SIDEBAR_DRAWER_PERCENT / 100), SIDEBAR_DRAWER_MAX)
}

/**
 * Solve the three column widths for one viewport frame.
 * @param viewport - available frame width in px.
 * @param sidebar - sidebar width preference in px (0 = closed).
 * @param rightbar - requested right panel width in px (0 = no track).
 * @param collapsedWidth - track width of the closed sidebar; the default keeps
 *   the icon rail, 0 hides the column entirely (macOS desktop).
 * @returns actual widths after shrinking or removing the right track; only
 *   without that track may the center fall below its minimum, down to zero.
 */
export function computeColumns(viewport: number, sidebar: number, rightbar: number, collapsedWidth = SIDEBAR_COLLAPSED): Columns {
  const s = sidebar === 0 ? collapsedWidth : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX)
  const available = viewport - s - CENTER_MIN
  const r = rightbar === 0 || available < RIGHTBAR_MIN
    ? 0
    : Math.min(available, clampWidth(rightbar, RIGHTBAR_MIN, viewport * RIGHTBAR_MAX_RATIO))
  return { sidebar: s, center: Math.max(0, viewport - s - r), rightbar: r }
}
