/**
 * Heuristics for YamX `YamX ›` direct shell lines — when to run offline fix / agent recovery.
 */

/** User hit Ctrl+C (cooperative stop); not a "failed command" to diagnose. */
export function isDirectShellUserCancelled(result: string): boolean {
  return /\bstopped by user\b/i.test(result);
}

export function isDirectShellFailure(result: string): boolean {
  if (isDirectShellUserCancelled(result)) return false;
  return /\(exit\s+[1-9]\d*|timed out after|Spawn error:|Error:|not recognized as an internal or external command|command not found|No such file or directory|cannot find the path|bad option|fatal:|Traceback|TypeError|SyntaxError|ReferenceError/i.test(
    result
  );
}

/**
 * Matches the many shapes of "this program does not exist on this machine".
 * Used to separate "nothing ran" failures (safe to auto-correct) from
 * failures where a real program already ran and produced output.
 */
const COMMAND_NOT_FOUND_RE = new RegExp(
  [
    'is not recognized as an internal or external command', // cmd.exe
    'is not recognized as the name of a cmdlet', // PowerShell
    'CommandNotFoundException',
    'command not found', // bash/zsh/sudo/…
    'Unknown command', // kubectl and similar CLIs
    ':\\s*not found', // some minimal shells
  ].join('|'),
  'i'
);

/** True when the failure clearly means the program itself was not found. */
export function isCommandNotFoundFailure(result: string): boolean {
  if (isDirectShellUserCancelled(result)) return false;
  return COMMAND_NOT_FOUND_RE.test(result);
}

/**
 * Best-effort extraction of the missing program name from a failure output,
 * across cmd.exe, PowerShell, bash, zsh and common CLI wrappers.
 * Returns the executable base name, or null when nothing useful is found.
 */
export function extractMissingCommandToken(result: string): string | null {
  if (!result || isDirectShellUserCancelled(result)) return null;
  const candidates: (string | undefined)[] = [
    // cmd.exe: 'foo bar' is not recognized as an internal or external command
    /'([^']{1,200}?)'\s+is not recognized/i.exec(result)?.[1],
    // PowerShell: foo : The term 'foo' is not recognized as the name of a cmdlet…
    /The term '([^']{1,200}?)' is not recognized/i.exec(result)?.[1],
    // bash/zsh: bash: foo: command not found · zsh: command not found: foo · sudo: foo: command not found
    /([A-Za-z0-9_][\w.\-]{0,60}):\s*command not found/i.exec(result)?.[1],
    /(?:^|[:\s])command not found:?\s*([^\s'"]{1,120})/im.exec(result)?.[1],
    // kubectl and friends: error: unknown command "foo"
    /unknown command ["']?([A-Za-z0-9_][\w.\-]{0,60})/i.exec(result)?.[1],
    /([A-Za-z0-9_][\w.\-]{0,60}):\s*(?:Unknown command|not found)/i.exec(result)?.[1],
  ];
  for (const raw of candidates) {
    const token = raw?.trim().replace(/^["']+|["']+$/g, '');
    if (!token) continue;
    // Keep the executable name even when the shell echoed an invoked path.
    const base = token.split(/[\\/]/).pop()?.trim() || token;
    if (!base || !/[A-Za-z0-9_]/.test(base)) continue;
    return base;
  }
  return null;
}
