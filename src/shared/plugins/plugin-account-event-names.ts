/** Account events ride `accounts.read`, not `events:subscribe`. */
export const PLUGIN_ACCOUNT_EVENT_NAMES = [
  'accounts.usage.changed',
  'accounts.session.moved'
] as const

export type PluginAccountEventName = (typeof PLUGIN_ACCOUNT_EVENT_NAMES)[number]

export function isPluginAccountEventName(event: string): event is PluginAccountEventName {
  return (PLUGIN_ACCOUNT_EVENT_NAMES as readonly string[]).includes(event)
}
