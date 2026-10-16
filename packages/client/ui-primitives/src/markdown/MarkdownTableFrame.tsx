/**
 * Table overflow frame: the box a hosting layout widens through the
 * `md-table-wide` hook, plus the two edge affordances that say which side of a
 * horizontally scrolled table still hides content.
 *
 * The affordance is measured rather than assumed. A table that fits must show
 * nothing — a five-column table does fit on a wide transcript — and a table
 * scrolled to its end must drop the shadow it has reached; only pixel geometry
 * distinguishes those from a table that is still hiding columns. CSS cannot
 * express it: `overflow-x` is not a style query, and a scroll-state container
 * query has no cross-engine support. The native scrollbar cannot carry it
 * either, because touch engines paint theirs only while the finger moves.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { resolveTableEdges, type TableEdges } from './table-edges.ts'
import css from './MarkdownText.module.css'

/** Props for {@link MarkdownTableFrame}. */
export interface MarkdownTableFrameProps {
  /** The `md-table-wide` breakout hook, or the fill arm. */
  className?: string | undefined
  /** Keyboard scroll entry point, set for tables wide enough to overflow. */
  tabIndex?: number | undefined
  /** The rendered `<table>`. */
  children: ReactNode
}

/**
 * Render one table inside its frame and keep the edge affordances in step with
 * the scroller. Mounted per table by the markdown renderer.
 * @param props - see {@link MarkdownTableFrameProps}.
 * @returns the frame element.
 */
export function MarkdownTableFrame({ className, tabIndex, children }: MarkdownTableFrameProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [edges, setEdges] = useState<TableEdges>('none')

  const measure = useCallback(() => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    setEdges(resolveTableEdges({
      scrollLeft: scroller.scrollLeft,
      scrollWidth: scroller.scrollWidth,
      clientWidth: scroller.clientWidth,
    }))
  }, [])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    measure()
    scroller.addEventListener('scroll', measure, { passive: true })
    // The scroller's own box misses a streaming table whose content grows
    // inside an unchanged scrollport, so the content box is observed too.
    const content = scroller.firstElementChild
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(scroller)
    if (content !== null) observer?.observe(content)
    return () => {
      scroller.removeEventListener('scroll', measure)
      observer?.disconnect()
    }
  }, [measure])

  return (
    <div className={clsx(css.tableFrame, className)} data-table-edges={edges}>
      <div ref={scrollerRef} className={css.tableScroll} tabIndex={tabIndex}>
        {children}
      </div>
      <span className={css.tableEdgeShadow} data-side="left" aria-hidden="true" />
      <span className={css.tableEdgeShadow} data-side="right" aria-hidden="true" />
    </div>
  )
}
