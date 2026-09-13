import { fileURLToPath } from 'node:url'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from '../../vitest.shared.ts'

const root = fileURLToPath(new URL('../..', import.meta.url))

function source(packageName: string): string {
  return fileURLToPath(new URL(`./${packageName}/src/index.ts`, import.meta.url))
}

export default defineConfig({
  root,
  plugins: [
    tsconfigPaths({ projects: [fileURLToPath(new URL('../../tsconfig.base.json', import.meta.url))] }),
    standardDecoratorPlugin(),
  ],
  resolve: {
    alias: [
      { find: /^@deepseek-ai\/dsh-browser$/, replacement: source('browser') },
      { find: /^@deepseek-ai\/dsh-browser-cinlan$/, replacement: source('browser-cinlan') },
      { find: /^@deepseek-ai\/dsh-browser-playwright$/, replacement: source('browser-playwright') },
      { find: /^@deepseek-ai\/dsh-tool-browser-element-capture$/, replacement: source('tool-browser-element-capture') },
      { find: /^@deepseek-ai\/dsh-tool-browser$/, replacement: source('tool-browser') },
      { find: /^@deepseek-ai\/dsh-browser-permission-policy$/, replacement: source('browser-permission-policy') },
    ],
  },
  test: {
    pool: 'forks',
    execArgv: vitestExecArgv,
    include: ['packages/browser/*/tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/browser/*/src/**/*.ts'],
      thresholds: {
        perFile: true,
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
      reporter: ['text'],
    },
  },
})
