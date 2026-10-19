import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createToolResultMessage, createUserMessage, ToolCallId, type ToolSchema } from '@deepseek-ai/dsh-llm'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId, SessionSeq, SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import UserQuestionService, {
  isTimedAskUserQuestionSchema,
  type AskUserQuestionAnswer,
  type AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'
// The fold is the projection's own reader of a recorded result, not a service method.
import { foldUserQuestions } from '@deepseek-ai/dsh-user-questions/src/projection.ts'
import * as toolAskUser from '@deepseek-ai/dsh-tool-ask-user'

const testToolSignal = new AbortController().signal

/** The `request/header` event that records the exact tool schemas the model saw. */
function headerEvent(seq: number, tools: ToolSchema[]): SessionEvent {
  return {
    type: 'request/header', seq: SessionSeq(seq), time: seq,
    data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, tools }, reason: 'initial' },
  }
}

/** The `tool/call` event a recorded `ask_user_question` call appends. */
function askedEvent(seq: number, callId: string, argumentsText: string): SessionEvent {
  return {
    type: 'tool/call', seq: SessionSeq(seq), time: seq,
    data: { turn: 1, step: 1, callId: ToolCallId(callId), name: 'ask_user_question', arguments: argumentsText },
  }
}

/** The `tool/result` event that records one rendered result text. */
function resultedEvent(seq: number, callId: string, text: string): SessionEvent {
  return {
    type: 'tool/result', seq: SessionSeq(seq), time: seq,
    data: {
      turn: 1, step: 1,
      message: createToolResultMessage({ callId: ToolCallId(callId), content: [{ type: 'text', text }], isError: false }),
    },
  } as SessionEvent
}

interface QuestionAnswerer {
  ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>
}

function registerQuestionAnswerer(ctx: Context, answerer: QuestionAnswerer): () => void {
  return ctx.on('user-questions/request', request => answerer.ask(request))
}

interface OptionSchemaShape {
  properties: {
    questions: {
      items: {
        properties: {
          options: {
            items: {
              properties: Record<string, { type: string }>
            }
          }
        } & Record<string, unknown>
      }
    }
  }
}

async function setup(config: toolAskUser.Config = { mode: 'timed', timeout: -1 }) {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(toolAskUser, config)
  return ctx
}

function stubAgent(id: string, delegationDepth = 0): Agent {
  const agentId = SessionId(id)
  const agent: Agent = {
    id: agentId,
    options: {},
    session: Session.create(agentId, [], {
      version: SESSION_FORMAT_VERSION, id: agentId, createdAt: 0, isSeeded: false, delegationDepth,
    }),
    inbox: {
      nextTurn: [], nextStep: [], clear() {}, append() {}, prepend() {},
      replace: () => false, remove: () => false, splice: () => [],
    },
    status: 'idle',
    ctx: new Context(),
    send() {}, followup() {}, steer() {}, inject() {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  return agent
}

describe('ask_user_question tool', () => {
  it('keeps the blocking legacy tool when apply receives no config', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(UserQuestionService)

    toolAskUser.apply(ctx)

    const schema = ctx.tools.schemas().find(tool => tool.name === 'ask_user_question')
    expect(schema?.parameters).not.toHaveProperty('properties.timeout')
    expect(schema?.description).toContain('Ask the user a concise question')
  })

  it('registers the timed tool only when the Cordis row opts in', async () => {
    const ctx = await setup({ mode: 'timed' })

    const schema = ctx.tools.schemas().find(tool => tool.name === 'ask_user_question')

    expect(schema?.parameters).toHaveProperty('properties.timeout')
    expect(JSON.stringify(schema)).toContain('pending')
    expect(JSON.stringify(schema)).toContain('Wait seconds for the entire batch (default 120)')
  })

  it('falls back to the 120 second wait when apply receives a row without a timeout', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(UserQuestionService)

    toolAskUser.apply(ctx, { mode: 'timed' })

    expect(JSON.stringify(ctx.tools.schemas().find(tool => tool.name === 'ask_user_question'))).toContain('Wait seconds for the entire batch (default 120)')
  })

  it('returns the answer batch when the Client answers inside the configured wait', async () => {
    const ctx = await setup({ mode: 'timed', timeout: 30 })
    registerQuestionAnswerer(ctx, {
      async ask() {
        return { answers: [{ id: 'continue', selected: ['yes'] }] }
      },
    })
    const agent = { ...stubAgent('timed-in-time'), steer: vi.fn() } as Agent
    ctx.agents.enter(agent, undefined)

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-in-time'),
      name: 'ask_user_question',
      arguments: { questions: [{ id: 'continue', question: 'Continue?' }] },
      agent,
    })

    expect(result).toMatchObject({
      isError: false,
      content: [{ type: 'text', text: '{"answers":[{"id":"continue","selected":["yes"]}]}' }],
    })
    await ctx.fiber.dispose()
  })

  it('describes the configured default timeout to the model', async () => {
    const ctx = await setup({ mode: 'timed', timeout: 45 })

    const schema = ctx.tools.schemas().find(tool => tool.name === 'ask_user_question')

    expect(JSON.stringify(schema)).toContain('Wait seconds for the entire batch (default 45); omit unless the user specifies a duration. Use -1 only when an answer is required before proceeding.')
    expect(JSON.stringify(schema)).not.toContain('Wait seconds for the entire batch (default 120)')
  })

  it('registers a model-facing tool schema', async () => {
    const ctx = await setup()
    const schema = ctx.tools.schemas().find(tool => tool.name === 'ask_user_question')

    expect(schema).toMatchObject({
      name: 'ask_user_question',
      parameters: {
        type: 'object',
        properties: {
          questions: { type: 'array' },
          timeout: { type: 'integer' },
        },
        required: ['questions'],
      },
    })
    const parameters = schema?.parameters as unknown as OptionSchemaShape
    expect(parameters.properties.questions.items.properties).toMatchObject({
      id: { type: 'string' },
      question: { type: 'string' },
      header: { type: 'string' },
      options: { type: 'array' },
      multi_select: { type: 'boolean' },
    })
    expect(parameters.properties.questions.items.properties.options.items.properties).toMatchObject({
      label: { type: 'string' },
      description: { type: 'string' },
    })
    expect(parameters.properties.questions.items.properties.options.items.properties).not.toHaveProperty('value')
    expect(parameters.properties.questions.items.properties.options.items.properties).not.toHaveProperty('recommended')
    expect(parameters.properties.questions.items.properties.options.items.properties).not.toHaveProperty('preview')
    expect(schema?.description).toContain('A submitted skipped question is an answer item with empty selected and no custom')
  })

  it('lets Cordis select the exact legacy blocking tool instead of the timed tool', async () => {
    const ctx = await setup({ mode: 'legacy' })
    const seen: AskUserQuestionRequest[] = []
    const firstAnswerer = registerQuestionAnswerer(ctx, {
      async ask(request) {
        seen.push(request)
        return { answers: [{ id: 'continue', selected: ['yes'] }] }
      },
    })
    const schemas = ctx.tools.schemas().filter(tool => tool.name === 'ask_user_question')

    expect(schemas).toHaveLength(1)
    expect(schemas[0]).toMatchObject({
      description: 'Ask the user a concise question when you need confirmation, a choice, or missing information before proceeding.',
      parameters: { properties: { questions: { description: 'Questions to ask the user before continuing.' } } },
    })
    expect(schemas[0]?.parameters.properties).not.toHaveProperty('timeout')
    // The projection tells the two tools apart by this schema alone, so a
    // legacy Session never folds into a question card or a transcript pill.
    expect(isTimedAskUserQuestionSchema(schemas[0]!)).toBe(false)
    expect(foldUserQuestions([
      headerEvent(0, ctx.tools.schemas()),
      askedEvent(1, 'ask-legacy', '{"questions":[{"id":"continue","question":"Continue?"}]}'),
    ])).toEqual({ active: [], settled: [] })

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-legacy'),
      name: 'ask_user_question',
      arguments: { questions: [{ id: 'continue', question: 'Continue?' }] },
    })
    expect(result).toMatchObject({
      isError: false,
      value: { answers: [{ id: 'continue', selected: ['yes'] }] },
      content: [{ type: 'text', text: '{"answers":[{"id":"continue","selected":["yes"]}]}' }],
    })
    // The legacy request stays unkeyed: its Client card has no tool call row to
    // reopen from, so closing that card still cancels the whole request.
    expect(seen[0]?.wait).toBeUndefined()
    expect(seen[0]?.agent).toBeUndefined()
    expect(seen[0]?.questions).toEqual([{ id: 'continue', question: 'Continue?' }])

    // Every optional field crosses the seam exactly as the original tool
    // carried it, and a custom answer comes back verbatim.
    firstAnswerer()
    registerQuestionAnswerer(ctx, {
      async ask(request) {
        seen.push(request)
        return { answers: [{ id: 'pkg', selected: [], custom: 'bun' }] }
      },
    })
    const agent = stubAgent('legacy-agent')
    ctx.agents.enter(agent, undefined)
    const detailed = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-legacy-detailed'),
      name: 'ask_user_question',
      arguments: { questions: [{
        id: 'pkg', question: 'Which package manager?', header: 'Setup', multi_select: false,
        options: [{ label: 'pnpm (Recommended)', description: 'Workspace default.' }, { label: 'npm' }],
      }] },
      agent,
    })
    expect(seen[1]?.agent).toBe(agent)
    expect(seen[1]?.questions).toEqual([{
      id: 'pkg', question: 'Which package manager?', header: 'Setup', multiSelect: false,
      options: [{ label: 'pnpm (Recommended)', description: 'Workspace default.' }, { label: 'npm' }],
    }])
    expect(detailed).toMatchObject({
      isError: false,
      content: [{ type: 'text', text: '{"answers":[{"id":"pkg","selected":[],"custom":"bun"}]}' }],
    })
  })

  it('asks the registered user-questions provider and projects structured answers to text', async () => {
    const ctx = await setup()
    const seen: AskUserQuestionRequest[] = []
    registerQuestionAnswerer(ctx, {
      async ask(request) {
        seen.push(request)
        return { answers: [{ id: 'pkg', selected: ['pnpm'] }] }
      },
    })

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-1'),
      name: 'ask_user_question',
      arguments: {
        questions: [{
          id: 'pkg',
          question: 'Which package manager should I use?',
          options: [{ label: 'pnpm', description: 'Use pnpm workspaces.' }],
        }],
      },
    })

    expect(result).toMatchObject({
      isError: false,
      content: [{ type: 'text', text: '{"answers":[{"id":"pkg","selected":["pnpm"]}]}' }],
    })
    expect(seen).toMatchObject([{
      questions: [{
        id: 'pkg',
        question: 'Which package manager should I use?',
        options: [{ label: 'pnpm', description: 'Use pnpm workspaces.' }],
      }],
      // Keyed by the call with no deadline: the Client card is reopenable from
      // the tool call row, and the wait itself stays indefinite.
      wait: { callId: 'ask-1' },
    }])
    expect(seen[0]?.wait?.timed).toBeUndefined()
  })

  it('passes recommended option labels through without adding schema fields', async () => {
    const ctx = await setup()
    const seen: AskUserQuestionRequest[] = []
    registerQuestionAnswerer(ctx, {
      async ask(request) {
        seen.push(request)
        return { answers: [{ id: 'pkg', selected: ['pnpm (Recommended)'] }] }
      },
    })

    await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-recommended'),
      name: 'ask_user_question',
      arguments: {
        questions: [{
          id: 'pkg',
          question: 'Which package manager should I use?',
          options: [
            { label: 'pnpm (Recommended)' },
            { label: 'npm' },
          ],
        }],
      },
    })

    expect(seen[0]?.questions[0]?.options).toEqual([
      { label: 'pnpm (Recommended)' },
      { label: 'npm' },
    ])
  })

  it('projects custom answers and multi-select choices', async () => {
    const ctx = await setup()
    registerQuestionAnswerer(ctx, {
      async ask() {
        return {
          answers: [
            { id: 'targets', selected: ['tests', 'docs'], custom: 'release notes' },
            { id: 'labels-only', selected: ['tests'] },
            { id: 'notes', selected: [], custom: 'ship today' },
            { id: 'optional', selected: [] },
          ],
        }
      },
    })

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-multi'),
      name: 'ask_user_question',
      arguments: {
        questions: [
          {
            id: 'targets',
            question: 'What should I update?',
            options: [{ label: 'tests' }, { label: 'docs' }],
            multi_select: true,
          },
          {
            id: 'labels-only',
            question: 'Which labels should I keep?',
            options: [{ label: 'tests' }, { label: 'docs' }],
            multi_select: true,
          },
          { id: 'notes', question: 'Any note?' },
          { id: 'optional', question: 'Anything else?' },
        ],
      },
    })

    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected ask_user_question success')
    expect(result.value).toEqual({
      answers: [
        { id: 'targets', selected: ['tests', 'docs'], custom: 'release notes' },
        { id: 'labels-only', selected: ['tests'] },
        { id: 'notes', selected: [], custom: 'ship today' },
        { id: 'optional', selected: [] },
      ],
    })
    expect(result.content).toEqual([{
      type: 'text',
      text: '{"answers":[{"id":"targets","selected":["tests","docs"],"custom":"release notes"},{"id":"labels-only","selected":["tests"]},{"id":"notes","selected":[],"custom":"ship today"},{"id":"optional","selected":[]}]}',
    }])
  })

  it('passes the tool abort signal to the user-questions request', async () => {
    const ctx = await setup()
    const seen: AskUserQuestionRequest[] = []
    registerQuestionAnswerer(ctx, {
      async ask(request) {
        seen.push(request)
        return { answers: [{ id: 'continue', selected: ['ok'] }] }
      },
    })
    const controller = new AbortController()

    await ctx.tools.execute({
      callId: ToolCallId('ask-2'),
      name: 'ask_user_question',
      arguments: { questions: [{ id: 'continue', question: 'Continue?' }] },
      signal: controller.signal,
    })

    expect(seen[0]?.signal).toBe(controller.signal)
  })

  it('passes optional header and a resumed runtime root through to the user-questions request', async () => {
    const ctx = await setup()
    const seen: AskUserQuestionRequest[] = []
    registerQuestionAnswerer(ctx, {
      async ask(request) {
        seen.push(request)
        return { answers: [{ id: 'continue', selected: ['ok'] }] }
      },
    })
    const agent = stubAgent('resumed-root', 1)
    ctx.agents.enter(agent, undefined)

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-3'),
      name: 'ask_user_question',
      arguments: { questions: [{ id: 'continue', header: 'Confirm', question: 'Continue?' }] },
      agent,
    })

    expect(result.content).toEqual([{ type: 'text', text: '{"answers":[{"id":"continue","selected":["ok"]}]}' }])
    expect(seen[0]).toMatchObject({
      questions: [{ id: 'continue', header: 'Confirm', question: 'Continue?' }],
      agent: { id: agent.id },
    })
  })

  it('reports a pending question when the Client settles the configured deadline', async () => {
    const ctx = await setup({ mode: 'timed', timeout: 1 })
    const seen: AskUserQuestionRequest[] = []
    registerQuestionAnswerer(ctx, {
      ask: (request) => {
        seen.push(request)
        const timedOut = new Error('client countdown ended') as Error & { code: string }
        timedOut.name = 'UserQuestionError'
        timedOut.code = 'ASK_TIMED_OUT'
        return Promise.reject(timedOut)
      },
    })
    const agent = { ...stubAgent('timed-root'), steer: vi.fn() } as Agent
    ctx.agents.enter(agent, undefined)
    const settled = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-timeout'),
      name: 'ask_user_question',
      arguments: { questions: [{ id: 'continue', question: 'Continue?' }] },
      agent,
    })

    expect(seen[0]?.wait?.callId).toBe('ask-timeout')
    expect(seen[0]?.wait?.timed).toBe(true)
    expect(settled).toMatchObject({
      isError: false,
      value: { pending: true, callId: 'ask-timeout' },
    })
    const content = settled.content[0]
    expect(content?.type).toBe('text')
    if (content?.type !== 'text') throw new Error('expected a text tool result')
    // One JSON object, instruction included: the `userQuestions` projection and
    // the Client question row both read this recorded text back as JSON, and a
    // prose prefix would make them read a timed-out call as a closed one.
    const payload: unknown = JSON.parse(content.text)
    expect(payload).toEqual({
      pending: true,
      callId: 'ask-timeout',
      message: expect.stringContaining('This is pending, not a skipped answer.') as string,
    })
    expect(content.text).toContain('No answer batch arrived before the timeout.')
    expect(content.text).toContain('Do not treat this as permission.')
    // The question the model timed out on stays answerable: the projection
    // reads the same recorded text, so this pins the two readings together.
    expect(isTimedAskUserQuestionSchema(ctx.tools.schemas().find(tool => tool.name === 'ask_user_question')!)).toBe(true)
    expect(foldUserQuestions([
      headerEvent(0, ctx.tools.schemas()),
      askedEvent(1, 'ask-timeout', '{"questions":[{"id":"continue","question":"Continue?"}]}'),
      resultedEvent(2, 'ask-timeout', content.text),
    ]).active).toEqual([{
      callId: 'ask-timeout',
      questions: [{ id: 'continue', question: 'Continue?' }],
      state: 'continued',
    }])
    await ctx.fiber.dispose()
  })

  it('holds an unclaimed timed question until the deadline and then reports it pending', async () => {
    vi.useFakeTimers()
    try {
      const ctx = await setup({ mode: 'timed', timeout: 1 })
      const agent = { ...stubAgent('timed-unclaimed'), steer: vi.fn() } as Agent
      ctx.agents.enter(agent, undefined)
      const result = ctx.tools.execute({
        signal: testToolSignal,
        callId: ToolCallId('ask-unclaimed'),
        name: 'ask_user_question',
        arguments: { questions: [{ id: 'continue', question: 'Continue?' }] },
        agent,
      })

      await vi.advanceTimersByTimeAsync(1_000)

      await expect(result).resolves.toMatchObject({ isError: false, value: { pending: true, callId: 'ask-unclaimed' } })
      await ctx.fiber.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('requires a live agent for the timed path', async () => {
    const ctx = await setup({ mode: 'timed' })

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-no-agent'),
      name: 'ask_user_question',
      arguments: { questions: [{ id: 'continue', question: 'Continue?' }] },
    })

    expect(result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Error: timed questions require a live agent' }],
    })
  })

  it.each([0, 1.5, 2_147_484])('rejects invalid timeout %s', async (timeout) => {
    const ctx = await setup({ mode: 'timed', timeout: -1 })

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId(`ask-invalid-${timeout}`),
      name: 'ask_user_question',
      arguments: { questions: [{ id: 'continue', question: 'Continue?' }], timeout },
    })

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ type: 'text' })
    expect(result.content[0]?.type === 'text' ? result.content[0].text : '').toMatch(/timeout.*integer/i)
  })

  it('rejects duplicate question ids before dispatching a timed call', async () => {
    const ctx = await setup({ mode: 'timed', timeout: -1 })
    const answerer = vi.fn(async (): Promise<AskUserQuestionAnswer> => ({ answers: [] }))
    registerQuestionAnswerer(ctx, { ask: answerer })

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-duplicate-ids'),
      name: 'ask_user_question',
      arguments: { questions: [
        { id: 'scope', question: 'Choose a scope.' },
        { id: 'scope', question: 'Confirm the scope.' },
      ], timeout: -1 },
    })

    expect(result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Error: question id "scope" must be unique within this call' }],
    })
    expect(answerer).not.toHaveBeenCalled()
  })

  it('allows separate timed calls to reuse a question id', async () => {
    const ctx = await setup({ mode: 'timed', timeout: -1 })
    const answerer = vi.fn(async (): Promise<AskUserQuestionAnswer> => ({
      answers: [{ id: 'scope', selected: ['Tools'] }],
    }))
    registerQuestionAnswerer(ctx, { ask: answerer })

    for (const callId of ['first-scope', 'second-scope']) {
      const result = await ctx.tools.execute({
        signal: testToolSignal,
        callId: ToolCallId(callId),
        name: 'ask_user_question',
        arguments: { questions: [{ id: 'scope', question: 'Choose a scope.' }], timeout: -1 },
      })
      expect(result.isError).toBe(false)
    }
    expect(answerer).toHaveBeenCalledTimes(2)
  })

  it('returns structured user-questions errors through tool execution', async () => {
    const ctx = await setup()

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-no-provider'),
      name: 'ask_user_question',
      arguments: { questions: [{ id: 'continue', question: 'Continue?' }] },
    })

    expect(result).toMatchObject({
      isError: true,
      error: { info: { name: 'UserQuestionError', code: 'NO_PROVIDER' } },
    })
  })

  it('rejects a live runtime-owned agent with a structured DELEGATED_CALLER error', async () => {
    const ctx = await setup()
    const seen: AskUserQuestionRequest[] = []
    registerQuestionAnswerer(ctx, {
      async ask(request) {
        seen.push(request)
        return { answers: [{ id: 'continue', selected: ['ok'] }] }
      },
    })
    const root = stubAgent('root', 0)
    const child = stubAgent('child', 0)
    ctx.agents.enter(root, undefined)
    ctx.agents.enter(child, root)

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-delegated'),
      name: 'ask_user_question',
      arguments: { questions: [{ id: 'continue', question: 'Continue?' }] },
      agent: child,
    })

    expect(result).toMatchObject({
      isError: true,
      error: { info: { name: 'UserQuestionError', code: 'DELEGATED_CALLER' } },
      content: [{
        type: 'text',
        text: "Error: human interaction is unavailable while the calling agent is owned by another live agent; include the unresolved question or decision in the child agent's final result",
      }],
    })
    expect(seen).toHaveLength(0)
  })

  it('returns a structured error for empty question batches', async () => {
    const ctx = await setup()

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('ask-empty'),
      name: 'ask_user_question',
      arguments: { questions: [] },
    })

    expect(result).toMatchObject({
      isError: true,
      error: { info: { name: 'UserQuestionError', code: 'EMPTY_QUESTIONS' } },
    })
  })

  it('unregisters the tool when its plugin fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(UserQuestionService)
    const fiber = await ctx.plugin(toolAskUser)
    expect(ctx.tools.get('ask_user_question')).toBeDefined()

    await fiber.dispose()

    expect(ctx.tools.get('ask_user_question')).toBeUndefined()
  })
})

describe('ask_user_question recommended fallback', () => {
  type ExecutedQuestion = Awaited<ReturnType<Context['tools']['execute']>>

  /** The one JSON object the tool renders into its model-facing text block. */
  function renderedPayload(result: ExecutedQuestion): unknown {
    const content = result.content[0]
    if (content === undefined || content.type !== 'text') throw new Error('expected a text tool result')
    return JSON.parse(content.text)
  }

  /** Run one timed call no answerer can take, and let its host deadline expire. */
  async function expireUnanswered(
    ctx: Context,
    agent: Agent,
    callId: string,
    questions: readonly Record<string, unknown>[],
  ): Promise<ExecutedQuestion> {
    const execution = ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId(callId),
      name: 'ask_user_question',
      arguments: { questions },
      agent,
    })
    await vi.advanceTimersByTimeAsync(1_000)
    return execution
  }

  const scopeQuestion = [{
    id: 'scope',
    question: 'Which scope?',
    options: [{ label: 'Whole workspace (Recommended)' }, { label: 'This package' }],
  }]

  async function fallbackContext(sessionId: string, afterTimeouts: number) {
    const ctx = await setup({ mode: 'timed', timeout: 1, autoAnswerAfterTimeouts: afterTimeouts })
    const agent = { ...stubAgent(sessionId), steer: vi.fn() } as Agent
    ctx.agents.enter(agent, undefined)
    return { ctx, agent }
  }

  it('answers with the recommended option once consecutive unanswered questions reach the threshold', async () => {
    vi.useFakeTimers()
    try {
      const { ctx, agent } = await fallbackContext('fallback-threshold', 3)

      const first = await expireUnanswered(ctx, agent, 'ask-1', scopeQuestion)
      const second = await expireUnanswered(ctx, agent, 'ask-2', scopeQuestion)
      const third = await expireUnanswered(ctx, agent, 'ask-3', scopeQuestion)
      const fourth = await expireUnanswered(ctx, agent, 'ask-4', scopeQuestion)

      expect(renderedPayload(first)).toMatchObject({ pending: true, callId: 'ask-1' })
      expect(renderedPayload(second)).toMatchObject({ pending: true, callId: 'ask-2' })
      expect(renderedPayload(third)).toEqual({
        answers: [{ id: 'scope', selected: ['Whole workspace (Recommended)'] }],
        autoAnswered: {
          consecutiveTimeouts: 3,
          timeoutSeconds: 1,
          notice: expect.stringContaining('not the user\'s confirmation, approval, or permission') as string,
        },
      })
      // Once latched, the policy answers every later expiry until the user
      // answers one question, so this fourth call answers too.
      expect(renderedPayload(fourth)).toMatchObject({
        answers: [{ id: 'scope', selected: ['Whole workspace (Recommended)'] }],
        autoAnswered: { consecutiveTimeouts: 4, timeoutSeconds: 1 },
      })
      await ctx.fiber.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('takes the marked option, the first option when none is marked, and one option for a multi-select question', async () => {
    vi.useFakeTimers()
    try {
      const { ctx, agent } = await fallbackContext('fallback-options', 1)

      const result = await expireUnanswered(ctx, agent, 'ask-options', [
        { id: 'marked', question: 'Marked?', options: [{ label: 'Second' }, { label: 'Marked（推荐）' }] },
        { id: 'unmarked', question: 'Unmarked?', multi_select: true, options: [{ label: 'Only' }] },
        { id: 'spaced', question: 'Spaced?', options: [{ label: 'Plain (RECOMMENDED) ' }] },
      ])

      expect(renderedPayload(result)).toMatchObject({
        answers: [
          { id: 'marked', selected: ['Marked（推荐）'] },
          { id: 'unmarked', selected: ['Only'] },
          { id: 'spaced', selected: ['Plain (RECOMMENDED) '] },
        ],
      })
      await ctx.fiber.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a question without options pending instead of inventing an answer', async () => {
    vi.useFakeTimers()
    try {
      const { ctx, agent } = await fallbackContext('fallback-no-options', 1)

      const result = await expireUnanswered(ctx, agent, 'ask-free-form', [
        { id: 'free', question: 'What should I name it?' },
      ])

      expect(renderedPayload(result)).toMatchObject({ pending: true, callId: 'ask-free-form' })
      await ctx.fiber.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('ends the run when the user answers inside the window', async () => {
    vi.useFakeTimers()
    try {
      const { ctx, agent } = await fallbackContext('fallback-in-time', 2)

      const expired = await expireUnanswered(ctx, agent, 'ask-expired', scopeQuestion)
      const disposeAnswerer = registerQuestionAnswerer(ctx, {
        ask: async () => ({ answers: [{ id: 'scope', selected: ['This package'] }] }),
      })
      const answered = await ctx.tools.execute({
        signal: testToolSignal,
        callId: ToolCallId('ask-answered'),
        name: 'ask_user_question',
        arguments: { questions: scopeQuestion },
        agent,
      })
      disposeAnswerer()
      const afterReset = await expireUnanswered(ctx, agent, 'ask-after-reset', scopeQuestion)
      const afterSecondExpiry = await expireUnanswered(ctx, agent, 'ask-after-second-expiry', scopeQuestion)

      expect(renderedPayload(expired)).toMatchObject({ pending: true, callId: 'ask-expired' })
      expect(renderedPayload(answered)).toMatchObject({ answers: [{ id: 'scope', selected: ['This package'] }] })
      // The answered question ended the count, so this one expires as the first
      // of a new run instead of answering with the recommended option.
      expect(renderedPayload(afterReset)).toMatchObject({ pending: true, callId: 'ask-after-reset' })
      expect(renderedPayload(afterSecondExpiry)).toMatchObject({
        answers: [{ id: 'scope', selected: ['Whole workspace (Recommended)'] }],
        autoAnswered: { consecutiveTimeouts: 2 },
      })
      await ctx.fiber.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('ends the run when the user answers a continued question later', async () => {
    vi.useFakeTimers()
    try {
      const { ctx, agent } = await fallbackContext('fallback-late-reply', 2)

      const expired = await expireUnanswered(ctx, agent, 'ask-late-1', scopeQuestion)
      const reply = agent.session.append('user/message', createUserMessage({
        source: { kind: 'user-question-reply', callId: ToolCallId('ask-late-1'), outcome: 'answered' },
        content: [{ type: 'text', text: '{"kind":"answer_to_pending_question"}' }],
      }), { surfaceOp: 'append' })
      ctx.emit('session/event', agent.session, reply)
      const afterLateReply = await expireUnanswered(ctx, agent, 'ask-late-2', scopeQuestion)

      expect(renderedPayload(expired)).toMatchObject({ pending: true, callId: 'ask-late-1' })
      expect(renderedPayload(afterLateReply)).toMatchObject({ pending: true, callId: 'ask-late-2' })
      await ctx.fiber.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps another Session\'s replies and events from resetting a tracked run', async () => {
    vi.useFakeTimers()
    try {
      const { ctx, agent } = await fallbackContext('fallback-isolated', 2)
      const other = stubAgent('fallback-other')
      ctx.agents.enter(other, undefined)

      const first = await expireUnanswered(ctx, agent, 'ask-isolated-1', scopeQuestion)
      // None of these belong to the tracked Session's run: a reply naming a
      // question that Session never asked, a plain user message, and an
      // unrelated event type.
      ctx.emit('session/event', other.session, other.session.append('user/message', createUserMessage({
        source: { kind: 'user-question-reply', callId: ToolCallId('ask-other'), outcome: 'answered' },
        content: [{ type: 'text', text: '{"kind":"answer_to_pending_question"}' }],
      }), { surfaceOp: 'append' }))
      ctx.emit('session/event', other.session, other.session.append('user/message', createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'hello' }],
      }), { surfaceOp: 'append' }))
      ctx.emit('session/event', other.session, other.session.append('turn/start', { turn: 1 }))

      const second = await expireUnanswered(ctx, agent, 'ask-isolated-2', scopeQuestion)

      expect(renderedPayload(first)).toMatchObject({ pending: true, callId: 'ask-isolated-1' })
      // The run kept counting through those events, so the second expiry is the
      // one that reaches the threshold.
      expect(renderedPayload(second)).toMatchObject({
        answers: [{ id: 'scope', selected: ['Whole workspace (Recommended)'] }],
        autoAnswered: { consecutiveTimeouts: 2 },
      })
      await ctx.fiber.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('declares the automatic answer to the model only under the policy', async () => {
    const withPolicy = await setup({ mode: 'timed', autoAnswerAfterTimeouts: 3 })
    const withoutPolicy = await setup({ mode: 'timed' })
    const schemaOf = (ctx: Context): string =>
      JSON.stringify(ctx.tools.schemas().find(tool => tool.name === 'ask_user_question'))
    // The output schema rides the definition, not the model-facing parameters.
    const definitionOf = (ctx: Context): string => JSON.stringify(ctx.tools.get('ask_user_question'))

    expect(schemaOf(withPolicy)).toContain('a recommended option can be selected automatically')
    expect(definitionOf(withPolicy)).toContain('autoAnswered')
    expect(schemaOf(withoutPolicy)).not.toContain('selected automatically')
    expect(definitionOf(withoutPolicy)).not.toContain('autoAnswered')

    await withPolicy.fiber.dispose()
    await withoutPolicy.fiber.dispose()
  })

  it('rejects a fallback that could never fire', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(UserQuestionService)

    expect(() => { toolAskUser.apply(ctx, { autoAnswerAfterTimeouts: 3 }) })
      .toThrow(/requires mode: timed/)
    expect(() => { toolAskUser.apply(ctx, { mode: 'timed', timeout: -1, autoAnswerAfterTimeouts: 3 }) })
      .toThrow(/finite timeout on the tool-ask-user row/)
    expect(() => { toolAskUser.apply(ctx, { mode: 'timed', autoAnswerAfterTimeouts: 0 }) })
      .toThrow(/positive integer/)
  })
})
