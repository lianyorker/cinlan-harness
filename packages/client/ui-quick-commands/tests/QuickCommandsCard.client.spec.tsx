// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type {
  QuickCommand,
  QuickCommandDraft,
  QuickCommandHostId,
  QuickCommandId,
  QuickCommandWireResult,
} from '@deepseek-ai/dsh-api-terminal-quick-commands-controller/types'
import { QuickCommandsCard, type QuickCommandsCardInjected, type QuickCommandsCardProps } from '../src/client/QuickCommandsCard.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
})

const t = makeTranslate(zh, commonZh)

function createMockInjected(initialCommands: QuickCommand[] = []): QuickCommandsCardInjected {
  let commands = [...initialCommands]
  return {
    list: vi.fn(async () => ({ commands, hosts: ['local' as QuickCommandHostId] })),
    create: vi.fn(async (draft: QuickCommandDraft): Promise<QuickCommandWireResult> => {
      const created: QuickCommand = {
        id: `cmd-${Date.now()}` as QuickCommandId,
        hostId: draft.hostId,
        name: draft.name,
        command: draft.command,
        ...(draft.description !== undefined ? { description: draft.description } : {}),
        ...(draft.cwd !== undefined ? { cwd: draft.cwd } : {}),
        confirm: draft.confirm ?? false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      commands.push(created)
      return { ok: true, value: created }
    }),
    update: vi.fn(async (id: string, draft: QuickCommandDraft): Promise<QuickCommandWireResult> => {
      const index = commands.findIndex(c => c.id === id)
      if (index === -1) return { ok: false, reason: 'unknown-command' }
      const updated: QuickCommand = {
        id: id as QuickCommandId,
        hostId: draft.hostId,
        name: draft.name,
        command: draft.command,
        ...(draft.description !== undefined ? { description: draft.description } : {}),
        ...(draft.cwd !== undefined ? { cwd: draft.cwd } : {}),
        confirm: draft.confirm ?? false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      commands[index] = updated
      return { ok: true, value: updated }
    }),
    remove: vi.fn(async (id: string): Promise<QuickCommandWireResult> => {
      commands = commands.filter(c => c.id !== id)
      return { ok: true }
    }),
  }
}

function renderCard(injected: QuickCommandsCardInjected) {
  const props = { t, ...injected } as unknown as QuickCommandsCardProps
  return render(<QuickCommandsCard {...props} />)
}

describe('QuickCommandsCard', () => {
  it('renders loading state initially then displays empty message when no commands exist', async () => {
    const injected = createMockInjected([])
    renderCard(injected)

    expect(screen.getByRole('status').textContent).toBe(zh.loading)

    await waitFor(() => {
      expect(screen.getByText(zh.empty)).toBeTruthy()
    })
    expect(screen.getByRole('heading', { name: zh.listTitle })).toBeTruthy()
    expect(injected.list).toHaveBeenCalledOnce()
  })

  it('renders existing commands with their details', async () => {
    const sampleCommand: QuickCommand = {
      id: 'cmd-1' as QuickCommandId,
      hostId: 'local' as QuickCommandHostId,
      name: 'Build Project',
      command: 'pnpm run build',
      description: 'Compiles packages',
      confirm: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const injected = createMockInjected([sampleCommand])
    renderCard(injected)

    await waitFor(() => {
      expect(screen.getByText('Build Project')).toBeTruthy()
    })
    expect(screen.getByText('pnpm run build')).toBeTruthy()
    expect(screen.getByText('Compiles packages')).toBeTruthy()
  })

  it('creates a new command through the draft form', async () => {
    const injected = createMockInjected([])
    renderCard(injected)

    await waitFor(() => {
      expect(screen.getByText(zh.empty)).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: zh.create }))

    const editor = screen.getByTestId('quick-command-editor')
    expect(editor).toBeTruthy()

    const nameInput = screen.getByPlaceholderText(zh.namePlaceholder)
    const cmdInput = screen.getByPlaceholderText(zh.commandPlaceholder)

    fireEvent.change(nameInput, { target: { value: 'Test Suite' } })
    fireEvent.change(cmdInput, { target: { value: 'pnpm test' } })

    fireEvent.click(screen.getByRole('button', { name: zh.save }))

    await waitFor(() => {
      expect(injected.create).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Test Suite',
        command: 'pnpm test',
      }))
    })

    await waitFor(() => {
      expect(screen.getByText('Test Suite')).toBeTruthy()
      expect(screen.getByText('pnpm test')).toBeTruthy()
    })
  })

  it('edits an existing command', async () => {
    const sampleCommand: QuickCommand = {
      id: 'cmd-edit' as QuickCommandId,
      hostId: 'local' as QuickCommandHostId,
      name: 'Old Name',
      command: 'echo old',
      confirm: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const injected = createMockInjected([sampleCommand])
    renderCard(injected)

    await waitFor(() => {
      expect(screen.getByText('Old Name')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: zh.edit }))

    const nameInput = screen.getByPlaceholderText(zh.namePlaceholder)
    fireEvent.change(nameInput, { target: { value: 'Updated Name' } })

    fireEvent.click(screen.getByRole('button', { name: zh.save }))

    await waitFor(() => {
      expect(injected.update).toHaveBeenCalledWith('cmd-edit', expect.objectContaining({
        name: 'Updated Name',
        command: 'echo old',
      }))
    })

    await waitFor(() => {
      expect(screen.getByText('Updated Name')).toBeTruthy()
    })
  })

  it('handles deletion flow with confirmation and cancellation', async () => {
    const sampleCommand: QuickCommand = {
      id: 'cmd-del' as QuickCommandId,
      hostId: 'local' as QuickCommandHostId,
      name: 'To Delete',
      command: 'rm -rf tmp',
      confirm: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const injected = createMockInjected([sampleCommand])
    renderCard(injected)

    await waitFor(() => {
      expect(screen.getByText('To Delete')).toBeTruthy()
    })

    // Click delete to trigger confirmation prompt
    fireEvent.click(screen.getByRole('button', { name: zh.delete }))

    expect(screen.getByRole('button', { name: zh.deleteConfirmAction })).toBeTruthy()

    // Cancel deletion
    fireEvent.click(screen.getByRole('button', { name: zh.deleteCancel }))
    expect(screen.queryByRole('button', { name: zh.deleteConfirmAction })).toBeNull()

    // Click delete again and confirm
    fireEvent.click(screen.getByRole('button', { name: zh.delete }))
    fireEvent.click(screen.getByRole('button', { name: zh.deleteConfirmAction }))

    await waitFor(() => {
      expect(injected.remove).toHaveBeenCalledWith('cmd-del')
    })

    await waitFor(() => {
      expect(screen.getByText(zh.empty)).toBeTruthy()
    })
  })

  it('displays error alert when list fails', async () => {
    const injected = createMockInjected()
    injected.list = vi.fn().mockRejectedValue(new Error('Network error'))

    renderCard(injected)

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Network error')
    })
  })
})
