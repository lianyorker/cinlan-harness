// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { captureInsertionTarget, insertIntoTarget } from '../src/client/insertion-target.ts'

afterEach(() => { document.body.replaceChildren() })

describe('voice insertion targets', () => {
  it('captures a text control selection and inserts without replacing the suffix', () => {
    const input = document.createElement('input')
    input.value = 'before after'
    document.body.append(input)
    input.focus()
    input.setSelectionRange(7, 7)

    const target = captureInsertionTarget()
    expect(target?.kind).toBe('text-control')
    expect(insertIntoTarget(target!, 'new ')).toBe(true)
    expect(input.value).toBe('before new after')
    expect(input.selectionStart).toBe(11)
  })

  it('captures a textarea range and emits an input event for controlled consumers', () => {
    const textarea = document.createElement('textarea')
    textarea.value = 'hello world'
    let inputEvents = 0
    textarea.addEventListener('input', () => { inputEvents += 1 })
    document.body.append(textarea)
    textarea.focus()
    textarea.setSelectionRange(6, 11)

    const target = captureInsertionTarget()
    expect(insertIntoTarget(target!, 'there')).toBe(true)
    expect(textarea.value).toBe('hello there')
    expect(inputEvents).toBe(1)
  })

  it('inserts at the end of a contenteditable surface when no selection exists', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    editor.tabIndex = 0
    editor.textContent = 'hello'
    document.body.append(editor)
    editor.focus()
    const selection = document.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)

    const target = captureInsertionTarget()
    expect(target?.kind).toBe('contenteditable')
    expect(insertIntoTarget(target!, ' world')).toBe(true)
    expect(editor.textContent).toBe('hello world')
  })

  it.each(['', 'plaintext-only'])('captures an editable surface with contenteditable="%s"', (value) => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', value)
    document.body.append(editor)
    editor.focus()

    expect(captureInsertionTarget()?.kind).toBe('contenteditable')
  })

  it('does not capture a surface explicitly marked contenteditable=false', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'false')
    document.body.append(editor)
    editor.focus()

    expect(captureInsertionTarget()).toBeUndefined()
  })

  it('routes text to a focused terminal through its local insertion event', () => {
    const root = document.createElement('div')
    root.dataset.dshTerminalTab = 'tab-1'
    const input = document.createElement('textarea')
    root.append(input)
    document.body.append(root)
    input.focus()
    let received = ''
    root.addEventListener('dsh:voice-insert-text', (event) => {
      const detail = (event as CustomEvent<{ text: string; accept: () => void }>).detail
      received = detail.text
      detail.accept()
    })

    const target = captureInsertionTarget()
    expect(target?.kind).toBe('terminal')
    expect(insertIntoTarget(target!, 'printf hello')).toBe(true)
    expect(received).toBe('printf hello')
  })

  it('refuses stale or read-only targets', () => {
    const input = document.createElement('input')
    input.readOnly = true
    document.body.append(input)
    input.focus()
    const target = captureInsertionTarget()
    expect(target).toBeUndefined()

    input.readOnly = false
    const liveTarget = captureInsertionTarget(input)
    input.remove()
    expect(insertIntoTarget(liveTarget!, 'ignored')).toBe(false)
  })
})
