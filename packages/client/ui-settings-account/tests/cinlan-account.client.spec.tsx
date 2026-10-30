// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CinlanAccountSection, type CinlanAccountSectionProps } from '../src/client/CinlanAccountSection.tsx'
import { en, zh } from '../src/client/cinlan-locales.ts'

afterEach(cleanup)
function mount(copy: typeof en | typeof zh = en, signedIn = false) {
  const props = {
    t: (key: keyof typeof en) => copy[key],
    useState: () => ({ state: { signedIn, inFlight: false }, failed: false }),
    refresh: vi.fn(async () => {}), signIn: vi.fn(async () => 'authorized' as const),
    cancelSignIn: vi.fn(), signOut: vi.fn(async () => {}),
  }
  const view = render(<CinlanAccountSection {...props as CinlanAccountSectionProps} />)
  return { props, view }
}
it.each([en, zh])('describes Cinlan account access without promising file sharing', (copy) => {
  const { view } = mount(copy)
  expect(screen.getByText(copy.scopeNote)).toBeTruthy()
  expect(screen.getByRole('button', { name: copy.signIn })).toBeTruthy()
  expect(view.container.textContent).not.toMatch(/Artifact sharing|Cinlan IDE Relay|IDE Mobile|Sub2API/u)
  expect(view.container.textContent).toMatchSnapshot()
})
it('retains the sign-in dialog and sign-out operations', async () => {
  const { props, view } = mount()
  fireEvent.click(screen.getByRole('button', { name: en.signIn }))
  expect(screen.getByRole('dialog', { name: en.dialogTitle })).toBeTruthy()
  expect(props.signIn).not.toHaveBeenCalled()
  view.unmount()
  const authorized = mount(en, true)
  fireEvent.click(screen.getByRole('button', { name: en.signOut }))
  await waitFor(() => { expect(authorized.props.signOut).toHaveBeenCalledOnce() })
})
