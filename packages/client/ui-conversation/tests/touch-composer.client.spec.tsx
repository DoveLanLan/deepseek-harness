// @vitest-environment jsdom
/**
 * The composer's no-hover behavior at the DOM boundary: the shared capability
 * probe reads the pointer query, a plain Enter keeps its line break there
 * (an on-screen keyboard has no Shift key) while Ctrl+Enter still submits,
 * and a hovering pointer keeps the desktop gesture.
 */
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { $createParagraphNode, $createTextNode, $getRoot, createEditor, KEY_ENTER_COMMAND } from 'lexical'
import { registerPlainText } from '@lexical/plain-text'
import { isTouchPointer } from '../src/client/pointing.ts'
import { registerComposerKeymap } from '../src/client/input/editor/keymap.ts'
import type { ComposerKeymapHandlers } from '../src/client/input/editor/keymap.ts'

/** Point the capability probe at one pointer-query outcome. */
function stubPointer(touch: boolean): void {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: touch && query === '(hover: none)' })))
}

afterEach(() => { vi.unstubAllGlobals() })

/** Mount the keymap over a plain-text editor holding one drafted paragraph. */
function bench(options: { arbitrate?: ComposerKeymapHandlers['arbitrate'] } = {}) {
  const editor = createEditor({ namespace: 'touch-composer', onError: (error) => { throw error } })
  const root = document.createElement('div')
  root.contentEditable = 'true'
  document.body.appendChild(root)
  onTestFinished(() => { editor.setRootElement(null); root.remove() })
  editor.setRootElement(root)
  onTestFinished(registerPlainText(editor))
  const submit = vi.fn()
  const arbitrate = vi.fn<ComposerKeymapHandlers['arbitrate']>(options.arbitrate ?? (() => 'pass'))
  onTestFinished(registerComposerKeymap(editor, {
    arbitrate,
    space: () => false,
    dismissPopup: () => {},
    canSubmit: () => true,
    enterInsertsBreak: isTouchPointer,
    submit,
    intakeFiles: () => {},
    pasteText: () => {},
  }))
  editor.update(() => {
    const paragraph = $createParagraphNode().append($createTextNode('unsent draft'))
    $getRoot().append(paragraph)
    paragraph.selectEnd()
  }, { discrete: true })
  return { editor, root, submit, arbitrate }
}

describe('composer pointer capability', () => {
  it('reads the no-hover pointer query', () => {
    stubPointer(true)
    expect(isTouchPointer()).toBe(true)
    stubPointer(false)
    expect(isTouchPointer()).toBe(false)
  })

  it('answers with the desktop gesture where no query surface exists', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(isTouchPointer()).toBe(false)
  })
})

describe('composer Enter on a device without hover', () => {
  it('keeps the line break instead of submitting', async () => {
    stubPointer(true)
    const { editor, root, submit } = bench()
    fireEvent.keyDown(root, { key: 'Enter' })
    expect(submit).not.toHaveBeenCalled()
    // The fallback's insertion commits on the next microtask.
    await Promise.resolve()
    const text = editor.getEditorState().read(() => $getRoot().getTextContent())
    expect(text).toContain('unsent draft')
    expect(text).toContain('\n')
  })

  it('keeps Ctrl+Enter submitting the accelerated way', () => {
    stubPointer(true)
    const { root, submit } = bench()
    fireEvent.keyDown(root, { key: 'Enter', ctrlKey: true })
    expect(submit).toHaveBeenCalledWith(true)
  })

  it('keeps a synthesized Enter (no DOM event) on the submit gesture', () => {
    stubPointer(true)
    const { editor, submit } = bench()
    editor.dispatchCommand(KEY_ENTER_COMMAND, null)
    expect(submit).toHaveBeenCalledWith(false)
  })

  it('lets an open menu take the Enter before the line break', () => {
    stubPointer(true)
    const { root, submit, arbitrate } = bench({ arbitrate: () => 'pick-highlighted' })
    fireEvent.keyDown(root, { key: 'Enter' })
    expect(arbitrate).toHaveBeenCalledWith('enter', false)
    expect(submit).not.toHaveBeenCalled()
  })
})

describe('composer Enter where a pointer can hover', () => {
  it('submits a plain Enter as before', () => {
    stubPointer(false)
    const { root, submit } = bench()
    fireEvent.keyDown(root, { key: 'Enter' })
    expect(submit).toHaveBeenCalledWith(false)
  })

  it('submits Cmd+Enter the accelerated way as before', () => {
    stubPointer(false)
    const { root, submit } = bench()
    fireEvent.keyDown(root, { key: 'Enter', metaKey: true })
    expect(submit).toHaveBeenCalledWith(true)
  })
})
