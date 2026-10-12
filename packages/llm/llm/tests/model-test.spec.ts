/** The model connectivity checkout reports every outcome as a result, never as a throw. */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

class ScriptedAdapter extends LlmAdapter {
  lastOptions: GenerateOptions | undefined

  constructor(private readonly script: readonly StreamChunk[] = []) {
    super()
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.lastOptions = options
    yield * this.script
  }
}

class ThrowingAdapter extends LlmAdapter {
  stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('upstream exploded')
  }
}

async function harness(adapter: LlmAdapter): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['test-provider'], adapter)
  return ctx
}

const STOP: StreamChunk = { type: 'finish', reason: { kind: 'stop' } }

describe('LlmRuntime.testModel', () => {
  it('reports ok and sends one trivial user turn when the model answers', async () => {
    const adapter = new ScriptedAdapter([STOP])
    const ctx = await harness(adapter)
    const signal = new AbortController().signal

    await expect(ctx.llm.testModel('test-provider', 'test-model', signal)).resolves.toEqual({ ok: true })
    expect(adapter.lastOptions?.provider).toBe('test-provider')
    expect(adapter.lastOptions?.model).toBe('test-model')
    expect(adapter.lastOptions?.maxTokens).toBe(64)
    expect(adapter.lastOptions?.signal).toBe(signal)
    expect(adapter.lastOptions?.messages).toHaveLength(1)
    expect(adapter.lastOptions?.messages[0]).toMatchObject({
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'Reply with the single word: pong' }],
    })
  })

  it('reports the adapter failure message on an error finish', async () => {
    const ctx = await harness(new ScriptedAdapter([
      { type: 'finish', reason: { kind: 'error', failure: { message: 'route refused', code: 'UPSTREAM' } } },
    ]))

    await expect(ctx.llm.testModel('test-provider', 'test-model')).resolves.toEqual({
      ok: false,
      message: 'route refused',
    })
  })

  it('reports the failure message on an aborted finish', async () => {
    const ctx = await harness(new ScriptedAdapter([
      { type: 'finish', reason: { kind: 'aborted', failure: { message: 'cancelled by caller', code: 'ABORTED' } } },
    ]))

    await expect(ctx.llm.testModel('test-provider', 'test-model')).resolves.toEqual({
      ok: false,
      message: 'cancelled by caller',
    })
  })

  it('reports a provider stream that ends without a finish chunk', async () => {
    const ctx = await harness(new ScriptedAdapter())

    await expect(ctx.llm.testModel('test-provider', 'test-model')).resolves.toEqual({
      ok: false,
      message: 'The model stream ended without a response',
    })
  })

  it('reports an adapter throw as a failed checkout', async () => {
    const ctx = await harness(new ThrowingAdapter())

    await expect(ctx.llm.testModel('test-provider', 'test-model')).resolves.toEqual({
      ok: false,
      message: 'upstream exploded',
    })
  })

  it('reports an unregistered route instead of throwing', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)

    const result = await ctx.llm.testModel('missing-provider', 'test-model')
    expect(result.ok).toBe(false)
  })
})

describe('LlmRuntime.remoteTestModel', () => {
  it('returns the checkout result through the Remote carrier', async () => {
    const ctx = await harness(new ScriptedAdapter([STOP]))

    await expect(ctx.llm.remoteTestModel('test-provider', 'test-model', new AbortController().signal))
      .resolves.toEqual({ ok: true })
  })

  it('carries a refused checkout as the same result', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)

    const result = await ctx.llm.remoteTestModel('missing-provider', 'test-model', new AbortController().signal)
    expect(result.ok).toBe(false)
  })
})
