import type { Hooks, Plugin } from "@opencode-ai/plugin"

const ENV_VAR_RE = /^([A-Za-z_][A-Za-z0-9_]*=[^\s]* +)*/
const UNPROXYABLE_COMMANDS = new Set([
  "cd", "source", ".", "export", "alias", "unset", "set", "shopt", "eval", "exec",
])
const OPERATOR_RE = /(\s*(?:&&|\|\||;)\s*|\s&\s?|\r?\n)/
// Same as OPERATOR_RE but without newline splitting. Used when the command
// contains a heredoc (<<DELIM) whose multi-line body must not be split.
const OPERATOR_ONLY_RE = /(\s*(?:&&|\|\||;)\s*|\s&\s?)/

// Heredoc marker: <<DELIM, <<-DELIM, <<'DELIM', <<"DELIM"
const HEREDOC_RE = /<<-?\s*['"]?\w/

// PowerShell: segments starting with these chars are never external commands.
// $  → variable/assignment ($env:CI='true', $x = 1)
// @  → here-string, splat, array (@", @(), @{})
// &  → call operator (& "path\to\exe")
// {  → script block
const POWERSHELL_SKIP_RE = /^[$@&{]/

// PowerShell Verb-Noun cmdlets (e.g. Write-Output, Get-ChildItem, Set-Location).
// These are shell builtins and cannot be exec'd by snip.
const POWERSHELL_CMDLET_RE = /^[A-Z][a-zA-Z]*-[A-Z]/

function findFirstPipe(command: string): number {
  let inSingleQuote = false
  let inDoubleQuote = false
  
  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
    } else if (char === '|' && !inSingleQuote && !inDoubleQuote) {
      if (command[i + 1] === '|' || (i > 0 && command[i - 1] === '|')) {
        i++
        continue
      }
      return i
    }
  }
  
  return -1
}

function snipCommand(command: string): string {
  const envPrefix = (command.match(ENV_VAR_RE) ?? [""])[0]
  const bareCmd = command.slice(envPrefix.length).trim()
  if (!bareCmd) return command
  const firstWord = bareCmd.split(/\s+/)[0]
  if (UNPROXYABLE_COMMANDS.has(firstWord)) return command
  if (POWERSHELL_SKIP_RE.test(bareCmd)) return command
  if (POWERSHELL_CMDLET_RE.test(firstWord)) return command
  return `${envPrefix}snip ${bareCmd}`
}

function snipSegment(segment: string): string {
  const pipeIdx = findFirstPipe(segment)
  if (pipeIdx !== -1) {
    const firstCmd = segment.slice(0, pipeIdx).trimEnd()
    const rest = segment.slice(pipeIdx)
    return snipCommand(firstCmd) + ' ' + rest
  }
  return snipCommand(segment)
}

export const toolExecuteBefore: NonNullable<Hooks["tool.execute.before"]> = async (input, output) => {
  if (input.tool !== "bash") return

  const command = output.args.command
  if (!command || typeof command !== "string") return
  if (command.startsWith("snip ")) return

  const separator = HEREDOC_RE.test(command) ? OPERATOR_ONLY_RE : OPERATOR_RE
  const segments = command.split(separator)

  if (segments.length === 1) {
    output.args.command = snipSegment(command)
    return
  }

  output.args.command = segments
    .map((segment) => separator.test(segment) ? segment : snipSegment(segment))
    .join("")
}

export const SnipPlugin: Plugin = async ({ $ }) => {
  try {
    await $`which snip`.quiet()
  } catch {
    console.warn("[snip] snip binary not found in PATH — plugin disabled")
    return {}
  }

  return {
    "tool.execute.before": toolExecuteBefore,
  }
}

export default SnipPlugin