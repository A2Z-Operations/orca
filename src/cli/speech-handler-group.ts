import type { HandlerGroup } from './handler-group-manifest'

export const SPEECH_HANDLER_GROUP: HandlerGroup = {
  name: 'speech',
  keys: ['speech openai-key status', 'speech openai-key set', 'speech openai-key clear'],
  load: async () => (await import('./handlers/speech.js')).SPEECH_HANDLERS
}
