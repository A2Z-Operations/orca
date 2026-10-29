/** Commands that act only on this machine: dispatch ignores --environment / --pairing-code for them, and help does not offer them. */
export function ignoresRemoteSelection(commandPath: readonly string[]): boolean {
  return (
    // Account policies belong to the target runtime; other account commands stay local.
    (commandPath[0] === 'account' &&
      commandPath[1] !== 'auto-switch' &&
      commandPath[1] !== 'session-mover' &&
      commandPath[1] !== 'auth-proxy' &&
      commandPath[1] !== 'pool' &&
      commandPath[1] !== 'moves') ||
    commandPath[0] === 'artifacts' ||
    commandPath[0] === 'environment' ||
    // Paired servers come from the local store; routing SSH lookup would mix two machines in one list.
    commandPath.join(' ') === 'host list' ||
    commandPath[0] === 'serve' ||
    (commandPath[0] === 'agent' && commandPath[1] !== 'launch') ||
    commandPath[0] === 'job' ||
    commandPath[0] === 'vm' ||
    commandPath[0] === 'agent-context' ||
    commandPath[0] === 'profile'
  )
}
