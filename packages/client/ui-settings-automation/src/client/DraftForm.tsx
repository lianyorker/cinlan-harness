/** Task inputs use Host-provided resource choices and keep unsaved values on failure. */
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DraftFormProps } from './types.ts'
import { ScheduleFields } from './ScheduleFields.tsx'
import css from './AutomationSettings.module.css'

/**
 * Render a local task draft; only the parent submit callback performs a mutation.
 * @param props - editable fields, actual catalog choices, and plain callbacks.
 * @returns the revision-fenced draft form.
 */
export function DraftForm({ fields, catalog, disabled, pending, onChange, onSave, onDiscard, t }: DraftFormProps): ReactNode {
  const modelKey = (provider: string, model: string) => JSON.stringify([provider, model])
  const selectedModel = modelKey(fields.model.provider, fields.model.model)
  const unavailableOption = (value: string, exists: boolean): ReactNode => value !== '' && !exists
    ? <option value={value} disabled>{t('retainedChoice', { value })}</option> : null
  return <form className={css.form} onSubmit={(event) => { event.preventDefault(); onSave() }}>
    <fieldset className={css.fields} disabled={disabled}>
      <div className={css.field}>
        <label htmlFor="automation-title">{t('taskTitle')}</label>
        <Input id="automation-title" className={clsx(css.input)} required value={fields.title}
          onChange={(event) => { onChange({ ...fields, title: event.currentTarget.value }) }} />
      </div>
      <div className={css.field}>
        <label htmlFor="automation-prompt">{t('prompt')}</label>
        <textarea id="automation-prompt" className={css.textarea} required value={fields.prompt}
          onChange={(event) => { onChange({ ...fields, prompt: event.currentTarget.value }) }} />
      </div>
      <div className={css.grid}>
        <div className={css.field}>
          <label htmlFor="automation-workspace">{t('workspace')}</label>
          <select id="automation-workspace" className={css.select} required value={fields.workspaceId} onChange={(event) => {
            const choice = catalog.workspaces.find(item => item.id === event.currentTarget.value)
            if (choice) onChange({ ...fields, workspaceId: choice.id })
          }}>
            <option value="" disabled>{t('choose')}</option>
            {unavailableOption(fields.workspaceId, catalog.workspaces.some(item => item.id === fields.workspaceId))}
            {catalog.workspaces.map(item => <option key={item.id} value={item.id} disabled={item.availability !== 'ready'}>{item.title}</option>)}
          </select>
        </div>
        <div className={css.field}>
          <label htmlFor="automation-agent">{t('agent')}</label>
          <select id="automation-agent" className={css.select} required value={fields.agentPresetId}
            onChange={(event) => { onChange({ ...fields, agentPresetId: event.currentTarget.value }) }}>
            <option value="" disabled>{t('choose')}</option>
            {unavailableOption(fields.agentPresetId, catalog.agentPresets.some(item => item.id === fields.agentPresetId))}
            {catalog.agentPresets.map(item => <option key={item.id} value={item.id} disabled={item.availability !== 'ready'}>{item.name ?? item.id}</option>)}
          </select>
        </div>
        <div className={css.field}>
          <label htmlFor="automation-model">{t('model')}</label>
          <select id="automation-model" className={css.select} required value={selectedModel} onChange={(event) => {
            const choice = catalog.models.find(item => modelKey(item.provider, item.id) === event.currentTarget.value)
            if (choice) onChange({ ...fields, model: { provider: choice.provider, model: choice.id } })
          }}>
            <option value="" disabled>{t('choose')}</option>
            {unavailableOption(selectedModel, catalog.models.some(item => modelKey(item.provider, item.id) === selectedModel))}
            {catalog.models.map(item => <option key={modelKey(item.provider, item.id)} value={modelKey(item.provider, item.id)}
              disabled={item.availability !== 'ready' && item.availability !== 'unlisted'}>{item.provider} / {item.name ?? item.id}</option>)}
          </select>
        </div>
        <div className={css.field}>
          <label htmlFor="automation-permission">{t('permission')}</label>
          <select id="automation-permission" className={css.select} required value={fields.permissionPresetId}
            onChange={(event) => { onChange({ ...fields, permissionPresetId: event.currentTarget.value }) }}>
            <option value="" disabled>{t('choose')}</option>
            {unavailableOption(fields.permissionPresetId, catalog.permissionPresets.some(item => item.id === fields.permissionPresetId))}
            {catalog.permissionPresets.map(item => <option key={item.id} value={item.id} disabled={item.availability !== 'ready'}>{item.name}</option>)}
          </select>
        </div>
      </div>
      <div className={css.field}>
        <label htmlFor="automation-reasoning">{t('reasoning')}</label>
        <Input id="automation-reasoning" className={clsx(css.input)} value={fields.model.reasoningEffort ?? ''} placeholder={t('noReasoning')}
          onChange={(event) => {
            const value = event.currentTarget.value
            const { provider, model } = fields.model
            onChange({ ...fields, model: value === '' ? { provider, model }
              : { provider, model, reasoningEffort: value as NonNullable<typeof fields.model.reasoningEffort> } })
          }} />
      </div>
      <ScheduleFields t={t} schedule={fields.schedule} onChange={(schedule) => { onChange({ ...fields, schedule }) }} />
    </fieldset>
    <div className={css.actions}>
      <Button type="submit" variant="primary" disabled={disabled}>{t(pending ? 'saving' : 'save')}</Button>
      <Button disabled={pending} onClick={onDiscard}>{t('discard')}</Button>
    </div>
  </form>
}
