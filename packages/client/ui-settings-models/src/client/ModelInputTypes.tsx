/** Input capability controls shared by the existing model-row editors. */

import type { ReactNode } from 'react'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'
import type { ModelsKey } from './locales.ts'
import styles from './ModelsSection.module.css'

interface ModelInputTypesProps {
  model: DeepSeekModelDraft
  /** DeepSeek and pi-ai use different configuration keys for the same choices. */
  field: 'inputModalities' | 'input'
  position: number
  disabled: boolean
  /** Installed model or provider capabilities when the row inherits its inputs. */
  fallback?: readonly string[] | undefined
  t: (key: ModelsKey) => string
  onChange: (model: DeepSeekModelDraft) => void
}

/**
 * Edit a nonempty set of model input types without changing other row fields.
 * @param props - effective row, inherited capabilities, and row replacement action.
 * @returns the input-type selector inside an existing model field.
 */
export function ModelInputTypes({ model, field, position, disabled, fallback, t, onChange }: ModelInputTypesProps): ReactNode {
  const declared = model[field]
  const selected = Array.isArray(declared) && declared.length > 0 ? declared : fallback ?? ['text']
  const value = selected.includes('image') ? selected.includes('text') ? 'text,image' : 'image' : 'text'
  return (
    <label className={styles['modelField']}>
      <span className={styles['modelFieldLabel']}>{t('modelInputTypes')}</span>
      <select
        className={`${styles['input']} ${styles['selectInput']}`}
        value={value}
        aria-label={`${t('modelInputTypes')} ${String(position)}`}
        disabled={disabled}
        onChange={(event) => {
          const input = event.target.value.split(',')
          const next = { ...model, [field]: input }
          // DeepSeek rejects image request limits on a text-only model.
          if (field === 'inputModalities' && !input.includes('image')) {
            Reflect.deleteProperty(next, 'imagePixelBudget')
            Reflect.deleteProperty(next, 'imageMaxBytes')
          }
          onChange(next)
        }}
      >
        <option value="text">{t('modelInputText')}</option>
        <option value="text,image">{t('modelInputTextImage')}</option>
        <option value="image">{t('modelInputImage')}</option>
      </select>
    </label>
  )
}
