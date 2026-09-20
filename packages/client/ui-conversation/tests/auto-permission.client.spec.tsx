// @vitest-environment jsdom
/** The composer requires explicit current-session Auto risk acknowledgement. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { PermissionSelect } from '../src/client/skeleton/PermissionSelect.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

describe('Auto permission confirmation', () => {
  it('keeps the command unsent until acknowledged and confirmed', () => {
    const command = vi.fn().mockResolvedValue(true)
    const messages = new Map(Object.entries(en))
    const view = render(<PermissionSelect
      value={{ options: [
        { value: 'workspace-write', name: 'workspace-write' },
        { value: 'auto', name: 'auto' },
      ], currentValue: 'workspace-write' }}
      locked={false}
      command={command}
      t={(key) => {
        const message = messages.get(key)
        if (message === undefined) throw new Error(`Unregistered test locale key: ${key}`)
        return message
      }}
    />)
    fireEvent.click(view.getByRole('button', { name: /Access mode/ }))
    fireEvent.click(view.getByRole('menuitem', { name: 'Auto review (EXP)' }))
    expect(view.getByRole('dialog').textContent).toContain(en['access.auto.confirm.description'])
    expect(command).not.toHaveBeenCalled()
    const enable = view.getByRole('button', { name: en['access.auto.confirm.enable'] })
    expect((enable as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(view.getByRole('checkbox'))
    fireEvent.click(enable)
    expect(command).toHaveBeenCalledExactlyOnceWith('/permission auto')
  })
})
