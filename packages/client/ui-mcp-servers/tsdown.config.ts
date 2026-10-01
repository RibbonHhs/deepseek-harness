import { clientBundle } from '../tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-client-ui-mcp-servers',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)