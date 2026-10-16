/**
 * Overflow geometry for one horizontally scrollable table frame. Kept apart
 * from the component so the decision is testable without a DOM: which sides of
 * a scrollport still hide content is arithmetic on three numbers.
 */

/** Sides of the frame that hide content. */
export type TableEdges = 'none' | 'left' | 'right' | 'both'

/** One scroller's geometry, as read from the DOM. */
export interface TableEdgeMetrics {
  /** Current horizontal scroll offset. */
  scrollLeft: number
  /** Full scrollable width, including the hidden part. */
  scrollWidth: number
  /** Visible width of the scrollport. */
  clientWidth: number
}

/**
 * Sub-pixel slack. Engines round scroll offsets and can report a fraction of a
 * pixel of remaining travel on a table that is visually at its end, which would
 * leave a shadow painted over content the reader can already see.
 */
const EDGE_EPSILON_PX = 1

/**
 * Which sides of a scrollport hide content.
 * @param metrics - the scroller's current geometry.
 * @returns `right` or `left` at one end, `both` in the middle, `none` when the
 * content fits or the scrollport sits exactly at an end.
 */
export function resolveTableEdges(metrics: TableEdgeMetrics): TableEdges {
  const travel = metrics.scrollWidth - metrics.clientWidth
  if (travel <= EDGE_EPSILON_PX) return 'none'
  const atStart = metrics.scrollLeft <= EDGE_EPSILON_PX
  const atEnd = metrics.scrollLeft >= travel - EDGE_EPSILON_PX
  if (atStart && atEnd) return 'none'
  if (atStart) return 'right'
  if (atEnd) return 'left'
  return 'both'
}
