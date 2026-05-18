import type { Hooks, Plugin } from "@opencode-ai/plugin"

const ENV_VAR_RE = /^([A-Za-z_][A-Za-z0-9_]*=[^\s]* +)*/
const OPERATOR_RE = /(\s*(?:&&|\|\||;)\s*|\s&\s?)/

async function snipCommand(command: string, shouldWrap: (cmd: string) => Promise<boolean>): Promise<string> {
  const envPrefix = (command.match(ENV_VAR_RE) ?? [""])[0]
  const bareCmd = command.slice(envPrefix.length).trim()
  if (!bareCmd) return command
  if (bareCmd.startsWith("snip ")) return command
  if (await shouldWrap(bareCmd)) {
    return `${envPrefix}snip run -- ${bareCmd}`
  }
  return command
}

async function processSegment(segment: string, shouldWrap: (cmd: string) => Promise<boolean>): Promise<string> {
  const parts = segment.split(OPERATOR_RE)
  if (parts.length === 1) {
    return await snipCommand(segment, shouldWrap)
  }
  const results = await Promise.all(
    parts.map((part) =>
      OPERATOR_RE.test(part) ? part : snipCommand(part, shouldWrap)
    )
  )
  return results.join("")
}

export function createToolExecuteBefore(shouldWrap: (cmd: string) => Promise<boolean>) {
  return async (input: Parameters<NonNullable<Hooks["tool.execute.before"]>>[0], output: Parameters<NonNullable<Hooks["tool.execute.before"]>>[1]) => {
    try {
      if (input.tool !== "bash") return

      const command = output.args.command
      if (!command || typeof command !== "string") return
      if (command.startsWith("snip ")) return

      // Split by pipes outside quotes (single |, not ||)
      const pipeSegments: string[] = []
      let current = ''
      let inSingleQuote = false
      let inDoubleQuote = false

      for (let i = 0; i < command.length; i++) {
        const char = command[i]

        if (char === "'" && !inDoubleQuote) {
          inSingleQuote = !inSingleQuote
          current += char
        } else if (char === '"' && !inSingleQuote) {
          inDoubleQuote = !inDoubleQuote
          current += char
        } else if (char === '|' && !inSingleQuote && !inDoubleQuote) {
          if (command[i + 1] === '|') {
            current += '||'
            i++
            continue
          }
          pipeSegments.push(current)
          pipeSegments.push('|')
          current = ''
        } else {
          current += char
        }
      }
      pipeSegments.push(current)

      if (pipeSegments.length <= 1) {
        const segment = command.trim()
        if (!segment) return
        output.args.command = await processSegment(segment, shouldWrap)
        return
      }

      const commands: string[] = []
      for (const part of pipeSegments) {
        if (part === '|') continue
        const trimmed = part.trim()
        if (!trimmed) continue
        commands.push(await processSegment(trimmed, shouldWrap))
      }
      output.args.command = commands.join(" | ")
    } catch {
      // leave command unmodified on any unexpected error
    }
  }
}

export async function hasSnipSubcommands($: any): Promise<boolean> {
  try {
    await $`snip check -- ls`.nothrow().quiet()
    return true
  } catch {
    return false
  }
}

export const SnipPlugin: Plugin = async ({ $, client }) => {
  try {
    await $`which snip`.quiet()
  } catch {
    await client.log({ level: "warn", message: "[snip] snip binary not found in PATH — plugin disabled" }).catch(() => {})
    return {}
  }

  if (!(await hasSnipSubcommands($))) {
    await client.log({ level: "warn",
      message: "[snip] snip >= 0.16.0 required (snip check/run subcommands missing) — plugin disabled"
    }).catch(() => {})
    return {}
  }

  const shouldWrap = async (cmd: string): Promise<boolean> => {
    try {
      const words = cmd.split(/\s+/)
      const result = await $`snip check -- ${words}`.nothrow().quiet()
      return result.exitCode === 0
    } catch (err) {
      await client.log({ level: "warn", message: `[snip] snip check failed for ${cmd}`, extra: { error: String(err) } }).catch(() => {})
      return false
    }
  }

  return {
    "tool.execute.before": createToolExecuteBefore(shouldWrap),
  }
}

export default SnipPlugin