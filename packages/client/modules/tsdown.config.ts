import { clientBundle } from '../tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-client-modules',
  import.meta.dirname,
  ['lib/types/index.js'],
)
