// @vitest-environment jsdom
/** A model row's checkout reports its own outcome, and an unsaved route offers none. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ModelListEditor } from '../src/client/ModelListEditor.tsx'
import { createModelsOperations } from '../src/client/operations.ts'
import type { ModelDiscoveryOutcome, ModelsOperations, ModelTestOutcome } from '../src/client/operations.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

type EditorProps = Parameters<typeof ModelListEditor>[0]

function operations(testModel: ModelsOperations['testModel']): ModelsOperations {
  return {
    testModel,
    discoverModels: vi.fn((): Promise<ModelDiscoveryOutcome> => Promise.resolve({ kind: 'found', models: [] })),
    describeCredential: vi.fn(),
    storeCredential: vi.fn(),
    removeCredential: vi.fn(),
    writeSettings: vi.fn(),
  }
}

function renderEditor(
  testModel: ModelsOperations['testModel'],
  options: {
    models?: EditorProps['models']
    saved?: boolean
  } = {},
): void {
  const saved = options.saved ?? true
  render(<ModelListEditor
    models={options.models ?? [{ id: 'luna' }]}
    onChange={vi.fn()}
    probe={{ settingsNs: 'llm-pi-ai', ...saved ? { provider: 'commandcode' } : {} }}
    disabled={false}
    t={key => en[key]}
    onBusyChange={() => {}}
    operations={operations(testModel)}
  />)
}

const TEST_BUTTON = en.testModel + ' 1'
/** The unplug prong: the glyph an idle row shows before any request runs. */
const UNPLUG_PATH = 'M12.667 3.333 14.667 1.333'
/** The open ring an in-flight row shows instead; asserted by its arc command. */
const SPINNER_ARC = 'M12.596 12.596'

function checkoutGlyph(): string {
  return screen.getByRole('button', { name: TEST_BUTTON }).querySelector('path')?.getAttribute('d') ?? ''
}

it('reports the model and its round trip once the checkout answers', async () => {
  const pending = Promise.withResolvers<ModelTestOutcome>()
  const testModel = vi.fn(() => pending.promise)
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000)
  try {
    renderEditor(testModel)
    fireEvent.click(screen.getByRole('button', { name: TEST_BUTTON }))
    expect(testModel).toHaveBeenCalledExactlyOnceWith('commandcode', 'luna')
    expect(screen.getByRole('status').textContent).toBe('Testing luna…')

    clock.mockReturnValue(3_400)
    await act(async () => { pending.resolve({ kind: 'ok' }) })
    expect(screen.getByRole('status').textContent).toBe('luna answered in 2.4s')
  } finally {
    clock.mockRestore()
  }
})

it('swaps the checkout glyph for a spinner while the request is in flight', async () => {
  const pending = Promise.withResolvers<ModelTestOutcome>()
  renderEditor(() => pending.promise)

  expect(checkoutGlyph()).toBe(UNPLUG_PATH)
  fireEvent.click(screen.getByRole('button', { name: TEST_BUTTON }))
  expect(checkoutGlyph()).toContain(SPINNER_ARC)

  await act(async () => { pending.resolve({ kind: 'ok' }) })
  expect(checkoutGlyph()).toBe(UNPLUG_PATH)
})

it('reports the Host diagnostic when the checkout refuses', async () => {
  renderEditor(() => Promise.resolve({ kind: 'refused', message: 'no credential for this route' }))

  fireEvent.click(screen.getByRole('button', { name: TEST_BUTTON }))
  await waitFor(() => {
    expect(screen.getByRole('status').textContent).toBe('luna failed: no credential for this route')
  })
})

it('reports a failure the Host left unexplained', async () => {
  renderEditor(() => Promise.resolve({ kind: 'refused', message: '' }))

  fireEvent.click(screen.getByRole('button', { name: TEST_BUTTON }))
  await waitFor(() => { expect(screen.getByRole('status').textContent).toBe('luna failed') })
})

it('reports a rejected transport failure and a rejected non-Error value', async () => {
  const testModel = vi.fn<ModelsOperations['testModel']>()
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce('gateway down')
  renderEditor(testModel)
  const button = screen.getByRole('button', { name: TEST_BUTTON })

  fireEvent.click(button)
  await waitFor(() => { expect(screen.getByRole('status').textContent).toBe('luna failed: offline') })

  fireEvent.click(button)
  await waitFor(() => { expect(screen.getByRole('status').textContent).toBe('luna failed: gateway down') })
})

it('offers no checkout before the provider route is saved', () => {
  renderEditor(vi.fn(), { saved: false })
  expect(screen.queryByRole('button', { name: TEST_BUTTON })).toBeNull()
})

it('disables the checkout for a row without a model id', () => {
  renderEditor(vi.fn(), { models: [{}] })
  const button = screen.getByRole<HTMLButtonElement>('button', { name: TEST_BUTTON })
  expect(button.disabled).toBe(true)
  expect(button.title).toBe(en.testModelUnavailable)
})

it('maps the Host checkout answer onto the row outcome', async () => {
  const llm = {
    testModel: vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { ok: true } })
      .mockResolvedValueOnce({ ok: true, value: { ok: false, message: 'refused upstream' } })
      .mockResolvedValueOnce({ ok: false, error: { message: 'carrier refused' } }),
  }
  const ctx = Object.assign(new Context(), { remote: { llm } }) as never
  const operations = createModelsOperations(ctx)

  await expect(operations.testModel('commandcode', 'luna')).resolves.toEqual({ kind: 'ok' })
  await expect(operations.testModel('commandcode', 'luna')).resolves.toEqual({
    kind: 'refused',
    message: 'refused upstream',
  })
  await expect(operations.testModel('commandcode', 'luna')).resolves.toEqual({
    kind: 'refused',
    message: 'carrier refused',
  })
  expect(llm.testModel).toHaveBeenCalledWith('commandcode', 'luna')
})
