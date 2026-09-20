// @vitest-environment jsdom
/** The composer requires explicit current-session Auto risk acknowledgement. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { PermissionSelect, type PermissionSelectProps } from '../src/client/PermissionSelect.tsx'
import { accessEn as en } from '../src/client/locales.ts'

afterEach(cleanup)

describe('Auto permission confirmation', () => {
  it('keeps the command unsent until acknowledged and confirmed', () => {
    const command = vi.fn().mockResolvedValue(true)
    const messages = new Map(Object.entries(en))
    const view = render(<PermissionSelect
      {...{} as PermissionSelectProps}
      useProjection={(() => ({ currentValue: 'workspace-write' })) as PermissionSelectProps['useProjection']}
      usePermissionCatalog={selector => selector({ value: { options: [
        { value: 'workspace-write', name: 'workspace-write' },
        { value: 'auto', name: 'auto' },
      ] } })}
      locked={false}
      select={preset => command(`/permission ${preset}`)}
      t={(key) => {
        if (key === 'close') return 'Close'
        const message = messages.get(key)
        if (message === undefined) throw new Error(`Unregistered test locale key: ${key}`)
        return message
      }}
    />)
    fireEvent.click(view.getByRole('button', { name: /Access mode/ }))
    fireEvent.click(view.getByRole('menuitem', { name: 'Auto review (EXP)' }))
    expect(view.getByRole('dialog').textContent).toContain(en['auto.confirm.description'])
    expect(command).not.toHaveBeenCalled()
    const enable = view.getByRole('button', { name: en['auto.confirm.enable'] })
    expect((enable as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(view.getByRole('checkbox'))
    fireEvent.click(enable)
    expect(command).toHaveBeenCalledExactlyOnceWith('/permission auto')
  })
})
