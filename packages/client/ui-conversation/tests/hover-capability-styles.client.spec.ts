/**
 * Pointer-capability gating as CSS text. jsdom evaluates no media query, so
 * these read the sheets directly: every rule that reveals something or leaves a
 * fill behind on hover sits inside `@media (hover: hover)`, and the states that
 * are not hover gestures (open, dragging, focus-visible) stay outside it.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

/** Strip comments and collapse whitespace, so selectors compare literally. */
const flat = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ')

/**
 * Split a sheet into its `@media (hover: hover)` bodies and the remainder.
 * @param css - the stylesheet text.
 * @returns the gated bodies joined, and everything the gates do not cover.
 */
function splitHoverGates(css: string): { gated: string; rest: string } {
  const bodies: string[] = []
  let rest = flat(css)
  let index = rest.indexOf('@media (hover: hover)')
  while (index !== -1) {
    const open = rest.indexOf('{', index)
    let depth = 0
    let end = open
    for (; end < rest.length; end += 1) {
      if (rest[end] === '{') depth += 1
      else if (rest[end] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    bodies.push(rest.slice(open + 1, end))
    rest = `${rest.slice(0, index)}${rest.slice(end + 1)}`
    index = rest.indexOf('@media (hover: hover)')
  }
  return { gated: bodies.join(' '), rest }
}

/** Match a selector that starts its own rule. */
function startsRule(selector: string): RegExp {
  return new RegExp(`(?:^|[;{}])\\s*${selector.replace(/[.[\]():*+^$\\]/g, '\\$&')}\\s*\\{`)
}

const CONVERSATION = '../src/client'
const CHAT = '../../ui-chat/src/client'

/** Hover rules that must not survive a tap, per sheet. */
const GATED: [string, string[]][] = [
  [`${CONVERSATION}/skeleton/InputBar.module.css`, [
    '.cardWorkspaceTrigger:hover::after',
    '.add:hover:not(:disabled)',
    '.select:hover:not(:disabled)',
    '.primary:hover:not(:disabled)',
  ]],
  [`${CONVERSATION}/skeleton/ConversationRoot.module.css`, [
    'button.crumb:hover',
    '.widthHandle:hover::after',
  ]],
  [`${CONVERSATION}/skeleton/ContextMeter.module.css`, ['.trigger:hover']],
  [`${CONVERSATION}/skeleton/HeroShell.module.css`, ['.workspace:not(:disabled):hover']],
  [`${CONVERSATION}/queue/QueueDock.module.css`, ['.action:hover:not(:disabled)']],
  [`${CONVERSATION}/settings/EnterBehaviorRow.module.css`, ['.selector:hover']],
  [`${CHAT}/chat/ChatView.module.css`, ['.toBottom:hover']],
  [`${CHAT}/chat/MessageIconActions.module.css`, ['.action:hover', '.action[data-unavailable]:hover']],
  [`${CHAT}/chat/MessageItem.module.css`, [
    '.compactionRow:has(.compactionBody) .compactionButton:hover',
    '.compactionButton:hover',
    '.compactionButton:not(:disabled):hover',
    '.compactionButton:not(:disabled):hover .compactionContextIcon',
    '.compactionButton:not(:disabled):hover .compactionDisclosureIcon',
    '.retrySummary:hover',
  ]],
  [`${CHAT}/chat/StatsPills.module.css`, ['button.pill:hover']],
  [`${CHAT}/chat/TurnProcessNodeView.module.css`, ['.root:hover:not(:disabled)']],
  [`${CHAT}/chat/TurnTriggerNodeView.module.css`, ['.root:hover', '.header:hover']],
  [`${CHAT}/chat/TurnUsagePanel.module.css`, ['.trigger:hover']],
  [`${CHAT}/chat/ChatGroupSeat.module.css`, ['.title:hover', '.title:hover .activityIcon', '.title:hover .chevron']],
  [`${CHAT}/settings/PreferenceRow.module.css`, ['.selector:hover']],
]

describe('hover-capability gating', () => {
  it.each(GATED)('gates the hover rules of %s', (path, selectors) => {
    const { gated, rest } = splitHoverGates(read(path))
    for (const selector of selectors) {
      expect(startsRule(selector).test(gated), `${selector} is not gated`).toBe(true)
      expect(rest, `${selector} leaks out of the gate`).not.toContain(selector)
    }
  })

  it('keeps the states that are not hover gestures outside the gate', () => {
    const handle = splitHoverGates(read(`${CONVERSATION}/skeleton/ConversationRoot.module.css`)).rest
    // Dragging owns the width-handle glow on every device.
    expect(startsRule('.widthHandle[data-dragging]::after').test(handle)).toBe(true)

    const toggle = splitHoverGates(read(`${CHAT}/chat/MessageItem.module.css`)).rest
    // Keyboard focus still cross-fades the compaction toggle's glyph, and
    // devices without hover keep the disclosure chevron visible.
    expect(startsRule('.compactionButton:not(:disabled):focus-visible .compactionDisclosureIcon').test(toggle)).toBe(true)
    expect(toggle).toContain('@media (hover: none)')

    const group = splitHoverGates(read(`${CHAT}/chat/ChatGroupSeat.module.css`)).rest
    expect(startsRule('.title:focus-visible .chevron').test(group)).toBe(true)
  })
})
