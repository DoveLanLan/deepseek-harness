/** Shared model fields and actions for both adapter catalog editors. */

import type { ReactNode } from 'react'
import {
  IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconLoadingOutlineRegular,
  IconTrashOutlineRegular, IconUnplugOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'
import type { ModelsKey } from './locales.ts'
import { ModelInputTypes } from './ModelInputTypes.tsx'
import { ModelReasoningEfforts } from './ModelReasoningEfforts.tsx'
import styles from './ModelsSection.module.css'

/** A capacity's editable text and adapter-specific inherited hint. */
interface CapacityInput {
  value: string
  placeholder: string
  onChange: (value: string) => void
  onBlur?: () => void
}

/** Connectivity checkout state and action for one model row. */
export interface ModelRowTest {
  /** Current checkout state for this row's model. */
  state: 'idle' | 'testing' | 'ok' | 'failed'
  /** Exact model id the checkout ran against. */
  model: string
  /** Round-trip seconds once the checkout answered; 0 until then. */
  seconds: number
  /** Host diagnostic for a failed checkout. */
  message?: string
  /** Whether the checkout cannot run right now. */
  disabled: boolean
  /** Localized reason the checkout is unavailable. */
  disabledLabel?: string
  /** Run the checkout. */
  run: () => void
}

/**
 * Fill one localized template's placeholders. The dictionary owns the
 * sentence; this only substitutes the row's own facts into it.
 * @param template - localized copy carrying zero or more {name} placeholders.
 * @param values - replacement per placeholder name.
 * @returns the copy with every supplied placeholder replaced.
 */
function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  let text = template
  for (const [name, value] of Object.entries(values)) {
    text = text.replace('{' + name + '}', value)
  }
  return text
}

/**
 * The row's own account of its checkout: what is running, what answered, or
 * why it failed.
 * @param test - current checkout state for the row.
 * @param t - section copy lookup.
 * @returns the localized status line.
 */
function testStatusText(test: ModelRowTest, t: (key: ModelsKey) => string): string {
  if (test.state === 'testing') return fillTemplate(t('testingModel'), { model: test.model })
  if (test.state === 'ok') {
    return fillTemplate(t('modelTestOk'), { model: test.model, seconds: test.seconds.toFixed(1) })
  }
  if (test.message === undefined || test.message.length === 0) {
    return fillTemplate(t('modelTestFailedWithoutReason'), { model: test.model })
  }
  return fillTemplate(t('modelTestFailed'), { model: test.model, reason: test.message })
}

/** Adapter-owned data and actions for one model row. */
interface ModelRowProps {
  model: DeepSeekModelDraft
  position: number
  inputField: 'inputModalities' | 'input'
  inputFallback?: readonly string[] | undefined
  inputLoading?: boolean
  /** Levels the row's `reasoningEfforts` may declare; absent or empty shows no reasoning control. */
  reasoningLevels?: readonly string[] | undefined
  expanded: boolean
  disabled: boolean
  t: (key: ModelsKey) => string
  contextWindow: CapacityInput
  maxTokens: CapacityInput
  onFieldChange: (field: 'id' | 'name', value: string | undefined) => void
  onIdBlur?: (value: string) => void
  onChange: (model: DeepSeekModelDraft) => void
  onToggle: () => void
  onRemove: () => void
  /** Connectivity checkout wiring; omitted when the owning editor cannot run one. */
  test?: ModelRowTest | undefined
}

/**
 * Render consistent model identity, capacity, and input-type controls.
 * @param props - drafted fields and their owning editor's actions.
 * @returns one expandable model entry.
 */
export function ModelRow(props: ModelRowProps): ReactNode {
  const { model, position, t, disabled } = props
  return (
    <div className={styles['modelEntry']}>
      <div className={styles['modelRow']}>
        {(['id', 'name'] as const).map(field => (
          <input
            key={field}
            className={styles['input']}
            type="text"
            value={typeof model[field] === 'string' ? model[field] : ''}
            placeholder={t(field === 'id' ? 'modelId' : 'modelName')}
            aria-label={`${t(field === 'id' ? 'modelId' : 'modelName')} ${String(position)}`}
            disabled={disabled}
            onChange={(event) => {
              const value = event.target.value
              props.onFieldChange(field, field === 'name' && value === '' ? undefined : value)
            }}
            onBlur={field === 'id' ? event => props.onIdBlur?.(event.target.value) : undefined}
          />
        ))}
        <button
          type="button"
          className={styles['iconButton']}
          aria-label={`${t('modelAdvanced')} ${String(position)}`}
          aria-expanded={props.expanded}
          title={t('modelAdvanced')}
          onClick={props.onToggle}
        >
          {props.expanded ? <IconChevronDownOutlineRegular /> : <IconChevronRightOutlineRegular />}
        </button>
        <button
          type="button"
          className={`${styles['iconButton']} ${styles['iconButtonDanger']}`}
          aria-label={`${t('removeModel')} ${String(position)}`}
          title={t('removeModel')}
          disabled={disabled}
          onClick={props.onRemove}
        >
          <IconTrashOutlineRegular size={14} />
        </button>
        {props.test === undefined
          ? null
          : (
            <button
              type="button"
              className={styles['iconButton']}
              aria-label={t('testModel') + ' ' + String(position)}
              title={props.test.disabled ? (props.test.disabledLabel ?? t('testModel')) : t('testModel')}
              disabled={disabled || props.test.disabled || props.test.state === 'testing'}
              onClick={props.test.run}
            >
              {props.test.state === 'testing'
                ? <IconLoadingOutlineRegular size={14} className={styles['modelTestSpinning']} />
                : <IconUnplugOutlineRegular size={14} />}
            </button>
          )}
      </div>
      {props.test === undefined || props.test.state === 'idle'
        ? null
        : (
          <p className={styles['modelTestStatus']} role="status">{testStatusText(props.test, t)}</p>
        )}
      {props.expanded
        ? (
          <div className={styles['modelAdvanced']}>
            {(['contextWindow', 'maxTokens'] as const).map(field => (
              <label className={styles['modelField']} key={field}>
                <span className={styles['modelFieldLabel']}>{t(field)}</span>
                <input
                  className={styles['input']}
                  type="text"
                  inputMode="numeric"
                  value={props[field].value}
                  placeholder={props[field].placeholder}
                  aria-label={`${t(field)} ${String(position)}`}
                  disabled={disabled}
                  onChange={(event) => { props[field].onChange(event.target.value) }}
                  onBlur={props[field].onBlur}
                />
              </label>
            ))}
            <ModelInputTypes
              model={model} field={props.inputField} position={position}
              fallback={props.inputFallback} disabled={disabled || props.inputLoading === true} t={t} onChange={props.onChange}
            />
            {props.reasoningLevels !== undefined && props.reasoningLevels.length > 0
              ? (
                <ModelReasoningEfforts
                  model={model} levels={props.reasoningLevels} position={position} disabled={disabled} t={t} onChange={props.onChange}
                />
              )
              : null}
          </div>
        )
        : null}
    </div>
  )
}
