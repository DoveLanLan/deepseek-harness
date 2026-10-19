/**
 * Opt-in timed `ask_user_question` tool definition.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool, type ToolExecution } from '@deepseek-ai/dsh-tools'
import { TIMED_WAIT_PARAMETER, type TimedDeadlineAnswer } from '@deepseek-ai/dsh-user-questions'
import type {
  AskUserQuestionAnswer, AskUserQuestionAnswerItem, AskUserQuestionRequestEvent,
} from '@deepseek-ai/dsh-user-questions/types'

/**
 * Deadline policy that answers in the user's place with each question's
 * recommended option. The first `afterTimeouts` questions of a Session may
 * expire unanswered; from then on every expiry is answered this way until the
 * user answers a question, which ends both the count and the policy.
 */
export interface RecommendedFallback {
  /** Questions whose foreground wait may expire unanswered before the policy answers. */
  afterTimeouts: number
}

/** One Session's record of consecutive expired waits, owned by the plugin fiber. */
interface UnansweredStreak {
  /** Questions in a row whose foreground wait expired without a user answer. */
  expired: number
  /** Whether `expired` reached the threshold, so later expiries keep answering. */
  latched: boolean
}

/**
 * The conventional recommendation suffix the model appends to the option it
 * recommends. It mirrors the Client's display split, which accepts the English
 * and Chinese forms; a browser half cannot share this Host module.
 */
const RECOMMENDED_SUFFIX = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i

function validateTimeout(timeout: number): number {
  if (timeout !== -1 && (!Number.isInteger(timeout) || timeout < 1 || timeout > 2_147_483)) {
    throw new Error('timeout must be -1 or a positive integer up to 2147483 seconds')
  }
  return timeout
}

function validateRecommendedFallback(recommended: RecommendedFallback, defaultTimeout: number): void {
  if (!Number.isInteger(recommended.afterTimeouts) || recommended.afterTimeouts < 1) {
    throw new Error('autoAnswerAfterTimeouts must be a positive integer count of questions')
  }
  if (defaultTimeout === -1) {
    throw new Error(
      'autoAnswerAfterTimeouts requires a finite timeout on the tool-ask-user row; '
      + 'set a positive number of seconds instead of -1',
    )
  }
}

function validateQuestionIds(questions: readonly { readonly id: string }[]): void {
  const ids = new Set<string>()
  for (const question of questions) {
    if (ids.has(question.id)) throw new Error(`question id ${JSON.stringify(question.id)} must be unique within this call`)
    ids.add(question.id)
  }
}

const description = 'Ask brief, direct, self-contained questions about missing information, preferences, or decisions. '
  + 'Use user-facing terms; assume no knowledge of background work or internal names. '
  + 'Use distinct stable question IDs. A submitted skipped question is an answer item with empty selected and no custom; '
  + 'pending instead means no answer batch arrived before the timeout and the user can still answer.'

const optionsDescription = 'Optional choices to show the user. If you recommend one, put it first and append "(Recommended)" to that label.'

/**
 * Instruction the pending result carries in its `message` field. It is a field
 * of the result value rather than prose beside it because the recorded result
 * text is read back as one JSON object: the `userQuestions` projection decides
 * from it that the call stays answerable, and the Client question row decides
 * from it that the recorded result is the timeout, not an answer batch.
 */
const pendingNotice = 'No answer batch arrived before the timeout. This is pending, not a skipped answer. '
  + 'Continue useful independent work. The user can still answer; their reply will be a user message '
  + 'identified as answer_to_pending_question with this callId and the original questions. '
  + 'Do not treat this as permission.'

/**
 * Instruction the automatically answered result carries in its `notice` field,
 * for the same reason the pending result carries its own text there.
 */
const autoAnsweredNotice = 'No user answer arrived before this timeout, and the user had already left the '
  + 'previous questions unanswered. Each question was answered with its recommended option so work can continue. '
  + 'This is not the user\'s confirmation, approval, or permission: treat it as a default the user can correct, '
  + 'and revisit the decision if they later object.'

interface ToolQuestion {
  readonly id: string
  readonly question: string
  readonly header?: string
  readonly options?: { readonly label: string; readonly description?: string }[]
  readonly multi_select?: boolean
}

interface ToolAnswerResult {
  readonly answers: {
    readonly id: string
    readonly selected: string[]
    readonly custom?: string
  }[]
  /** Present only when no user answer arrived and the recommended options answered instead. */
  readonly autoAnswered?: {
    readonly consecutiveTimeouts: number
    readonly timeoutSeconds: number
    readonly notice: string
  }
}

/**
 * Translate the model schema into the service request without changing ownership.
 * @param questions - Model-supplied questions in tool-schema form.
 * @param exec - Execution context that owns the agent and cancellation signal.
 * @returns The corresponding user-question service request.
 */
function questionRequest(
  questions: readonly ToolQuestion[],
  exec: Pick<ToolExecution, 'agent' | 'signal'>,
): AskUserQuestionRequestEvent {
  return {
    questions: questions.map(question => ({
      id: question.id,
      question: question.question,
      ...question.header !== undefined ? { header: question.header } : {},
      ...question.options !== undefined ? { options: question.options.map(option => ({ ...option })) } : {},
      ...question.multi_select !== undefined ? { multiSelect: question.multi_select } : {},
    })),
    ...exec.agent !== undefined ? { agent: exec.agent } : {},
    signal: exec.signal,
  }
}

/**
 * Copy service-owned answer arrays into the model-facing result.
 * @param result - Answer returned by the user-question service.
 * @returns A detached model-facing answer payload.
 */
function answerResult(result: AskUserQuestionAnswer): ToolAnswerResult {
  return {
    answers: result.answers.map(answer => ({
      id: answer.id,
      selected: [...answer.selected],
      ...answer.custom !== undefined ? { custom: answer.custom } : {},
    })),
  }
}

/**
 * Answer every question with its recommended option, and with the first option
 * when none is marked, which the tool schema asks the model to make the
 * recommended one. A multi-select question takes that single option.
 * @param questions - Questions of the call whose wait expired.
 * @returns One answer item per question in ask order, or undefined when a
 *   question offers no option to select.
 */
function recommendedAnswers(questions: readonly ToolQuestion[]): AskUserQuestionAnswer | undefined {
  const answers: AskUserQuestionAnswerItem[] = []
  for (const question of questions) {
    const options = question.options ?? []
    const chosen = options.find(option => RECOMMENDED_SUFFIX.test(option.label)) ?? options[0]
    if (chosen === undefined) return undefined
    answers.push({ id: question.id, selected: [chosen.label] })
  }
  return { answers }
}

/**
 * Register the opt-in timed tool definition.
 * @param ctx - Agent-scoped context receiving the tool.
 * @param timeout - Default foreground wait in seconds.
 * @param recommended - Deadline policy that answers with the recommended option
 *   after repeated unanswered questions; absent keeps every expiry pending.
 * @throws {Error} When `recommended` is malformed or names a threshold that an
 *   indefinite wait can never reach.
 */
export function registerTimedAskUser(ctx: Context, timeout = 120, recommended?: RecommendedFallback): void {
  const defaultTimeout = validateTimeout(timeout)
  if (recommended !== undefined) validateRecommendedFallback(recommended, defaultTimeout)
  const streaks = new WeakMap<Agent['session'], UnansweredStreak>()
  if (recommended !== undefined) {
    // A late answer admits a user message naming the question it replies to;
    // that is the user answering after the deadline, so the policy stands down.
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'user/message' || event.data.source.kind !== 'user-question-reply') return
      const streak = streaks.get(session)
      if (streak === undefined) return
      streak.expired = 0
      streak.latched = false
    }, { global: true })
  }
  /* jscpd:ignore-start -- The timed schema intentionally shares question fields with the legacy tool. */
  ctx.tools.register(defineTool({
    name: 'ask_user_question',
    description,
    parameters: {
      questions: {
        type: 'array',
        required: true,
        description: 'Questions to ask the user.',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            id: { type: 'string', required: true, description: 'Stable id for this question; echoed in the answer.' },
            question: { type: 'string', required: true, description: 'The specific question to ask the user.' },
            header: {
              type: 'string',
              description: 'Optional short heading for the question, such as "Confirm" or "Choose Mode".',
            },
            options: {
              type: 'array',
              description: recommended === undefined
                ? optionsDescription
                : `${optionsDescription} When the user leaves questions unanswered, a recommended option can be selected automatically.`,
              items: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  label: { type: 'string', required: true, description: 'Short user-facing option label.' },
                  description: { type: 'string', description: 'One sentence explaining the tradeoff or impact.' },
                },
              },
            },
            multi_select: {
              type: 'boolean',
              description: 'Whether the user may select more than one option. Defaults to false.',
            },
          },
        },
      },
      // The `userQuestions` projection reads this parameter's presence out of
      // the logged request header to tell a timed call from a legacy one.
      [TIMED_WAIT_PARAMETER]: {
        type: 'integer',
        description: `Wait seconds for the entire batch (default ${defaultTimeout}); omit unless the user specifies a duration. Use -1 only when an answer is required before proceeding.`,
      },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object', additionalProperties: false,
            properties: {
              pending: {
                type: 'boolean', enum: [true], required: true,
                description: 'True when the foreground wait expired before the user submitted an answer batch. The questions remain answerable; this is not a skipped answer.',
              },
              callId: { type: 'string', required: true, description: 'Tool call whose unanswered questions remain pending.' },
              message: {
                type: 'string', required: true,
                description: 'How to continue while the questions stay answerable.',
              },
            },
          },
          {
            type: 'object', additionalProperties: false,
            properties: {
              answers: {
                type: 'array', required: true,
                description: 'Submitted answer batch with one item per question. A skipped question has empty selected and no custom; unlike pending, the user has completed the batch.',
                items: {
                  type: 'object', additionalProperties: false,
                  properties: {
                    id: { type: 'string', required: true, description: 'Stable question id echoed from the request.' },
                    selected: {
                      type: 'array', required: true, items: { type: 'string' },
                      description: 'Selected option labels. Empty with no custom means the user explicitly skipped this question.',
                    },
                    custom: { type: 'string', description: 'Optional free-form answer; omitted for a skipped question.' },
                  },
                },
              },
              // Declared only under the policy that can produce it, so the
              // schema never advertises an answer the user did not give.
              ...recommended === undefined ? {} : {
                autoAnswered: {
                  type: 'object', additionalProperties: false,
                  description: 'Present only when no user answer arrived and each question was answered with its recommended option instead; absent when the user submitted the batch.',
                  properties: {
                    consecutiveTimeouts: {
                      type: 'integer', required: true,
                      description: 'Questions whose foreground wait expired unanswered in a row, including this call.',
                    },
                    timeoutSeconds: {
                      type: 'integer', required: true,
                      description: 'Foreground wait this call allowed, in seconds.',
                    },
                    notice: {
                      type: 'string', required: true,
                      description: 'How to treat answers the user did not give.',
                    },
                  },
                },
              },
            },
          },
        ],
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const timeout = validateTimeout(args.timeout ?? defaultTimeout)
      validateQuestionIds(args.questions)
      const request = questionRequest(args.questions, exec)
      if (timeout !== -1) {
        if (exec.agent === undefined) throw new Error('timed questions require a live agent')
        const agent = exec.agent
        const streak = recommended === undefined
          ? undefined
          : streaks.get(agent.session) ?? { expired: 0, latched: false }
        if (streak !== undefined) streaks.set(agent.session, streak)
        let autoResult: ToolAnswerResult | undefined
        let deadlineAnswer: TimedDeadlineAnswer | undefined
        if (streak !== undefined && recommended !== undefined) {
          const expired = streak
          const threshold = recommended.afterTimeouts
          deadlineAnswer = () => {
            expired.expired += 1
            const answers = recommendedAnswers(args.questions)
            if (answers === undefined) return undefined
            if (!expired.latched && expired.expired < threshold) return undefined
            expired.latched = true
            autoResult = {
              ...answerResult(answers),
              autoAnswered: {
                consecutiveTimeouts: expired.expired,
                timeoutSeconds: timeout,
                notice: autoAnsweredNotice,
              },
            }
            return answers
          }
        }
        const result = await ctx.userQuestions.askTimed({ ...request, agent }, exec.callId, timeout * 1000, deadlineAnswer)
        if ('pending' in result) return { ...result, message: pendingNotice }
        if (autoResult !== undefined) return autoResult
        // The user answered inside the window, so the run of unanswered
        // questions they were accumulating ends here.
        if (streak !== undefined) {
          streak.expired = 0
          streak.latched = false
        }
        return answerResult(result)
      }
      // `wait` without `timed`: this tool's indefinite form still keys the
      // Client card by call id, so the UI can reopen a closed panel from the
      // tool call. The legacy tool keeps its unkeyed request.
      const result = await ctx.userQuestions.ask({ ...request, wait: { callId: exec.callId } })
      return answerResult(result)
    },
  }))
  /* jscpd:ignore-end */
}
