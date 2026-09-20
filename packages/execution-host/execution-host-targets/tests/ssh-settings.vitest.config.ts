/** Owner-local browser acceptance using the repository's real Web scaffold. */
import { defineConfig } from 'vitest/config'
import web from '../../../../vitest.web.config.ts'

export default defineConfig({
  ...web,
  test: { ...web.test, include: ['packages/execution-host/execution-host-targets/tests/ssh-settings.e2e.ts'] },
})
