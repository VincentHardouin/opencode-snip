import { execFile } from "node:child_process"
import { Plugin } from "@opencode/plugin"

// OpenCode's `cmd` shell escapes double quotes before handing a command to
// cmd.exe, so a quoted launcher path arrives as \"C:\...\snip.exe\" and fails
// with "is not recognized". Quoting is only needed when the path contains
// whitespace or a cmd metacharacter, so drop it otherwise. Only cmd has this
// problem, and only launchers at the start of a command segment are rewritten:
// argument text must stay untouched.
const QUOTED_LAUNCHER = /(^|&&|\|\||[|;])(\s*)"([^"\r\n]+)"(?=\s+run --\s)/g
const NEEDS_QUOTES = /[\s&|<>^()%!]/

export function unquoteLauncher(command: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32") return command
  return command.replace(QUOTED_LAUNCHER, (match, separator: string, space: string, launcher: string) =>
    NEEDS_QUOTES.test(launcher) ? match : `${separator}${space}${launcher}`,
  )
}

// Delegates to `snip hook` (Claude Code PreToolUse format) so the rewrite rules
// stay in snip: only filtered commands are wrapped, pipes/redirects/heredocs and
// command substitutions are left raw. Any failure leaves the command untouched.
export function rewrite(command: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = execFile("snip", ["hook"], { timeout: 2000, windowsHide: true }, (error, stdout) => {
      if (error || !stdout.trim()) return resolve(undefined)
      try {
        const rewritten = JSON.parse(stdout).hookSpecificOutput?.updatedInput?.command
        resolve(typeof rewritten === "string" ? unquoteLauncher(rewritten) : undefined)
      } catch {
        resolve(undefined)
      }
    })
    child.stdin?.on("error", () => {})
    child.stdin?.end(JSON.stringify({ tool_name: "Bash", tool_input: { command } }))
  })
}

export const toolExecuteBefore = async (event: { tool: string; input: unknown }) => {
  if (event.tool !== "shell") return

  const input = event.input as { command?: unknown } | undefined
  const command = input?.command
  if (!command || typeof command !== "string") return

  const rewritten = await rewrite(command)
  if (rewritten) event.input = { ...input, command: rewritten }
}

// `snip hook` emits `[runner|env ...] "<snip>"[ --plugin-config ...] run -- <command>`.
// Keep the runner prefix, strip env assignments, and unwrap one snip layer so
// rules and saved approvals match the command the shell scanner checks.
const SNIP_RUN = /^(.*?)(?:"(?:[^"\\]|\\.)*[\\/]snip(?:\.exe)?"|"snip(?:\.exe)?"|(?:[^\s"']*[\\/])?snip(?:\.exe)?)(?:\s+--plugin-config\s+(?:"(?:[^"\\]|\\.)*"|\S+))?\s+(?:run\s+)?--\s+([\s\S]+)$/
const ENV_PREFIX = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+)\s+)*/

function unwrapSnip(resource: string): string | undefined {
  const match = SNIP_RUN.exec(resource)
  return match ? `${match[1].replace(ENV_PREFIX, "")}${match[2]}` : undefined
}

type Assert = (input: {
  sessionID: string
  action: string
  resources: string[]
  save: string[]
  source?: { type: "tool"; messageID: string; id: string }
}) => Promise<void>

export const SnipPlugin = Plugin.define({
  id: "opencode-snip",
  async setup(ctx) {
    // Probes `snip hook` rather than the binary alone: a snip without the hook
    // subcommand would otherwise leave every command unfiltered silently.
    if (!(await rewrite("git status"))) {
      console.warn("[snip] snip hook unavailable (binary missing or too old) — plugin disabled")
      return
    }
    const assert = (ctx.permission as typeof ctx.permission & { assert: Assert }).assert
    const tools = await ctx.tool.hook("execute.before", toolExecuteBefore)
    // Permissions are checked after `execute.before` rewrites the command, so
    // rules would match the snip wrapper. Re-check the unwrapped command and
    // settle the original decision, keeping rules and saved approvals intact.
    const permissions = await ctx.permission.hook("evaluate", async (event) => {
      if (event.action !== "shell") return
      const unwrapped = event.resources.map(unwrapSnip)
      if (unwrapped.every((command) => command === undefined)) return
      // Mixed commands keep their unwrapped segments in the re-check.
      const commands = unwrapped.map((command, index) => command ?? event.resources[index])
      try {
        await assert({
          sessionID: event.sessionID,
          action: event.action,
          resources: commands,
          save: commands.map((command) => `${command} *`),
          ...(event.source ? { source: event.source } : {}),
        })
        event.effect = "allow"
      } catch (error) {
        event.effect = "deny"
        event.message = error instanceof Error ? error.message : String(error)
      }
    })
    return async () => {
      await tools.dispose()
      await permissions.dispose()
    }
  },
})

export default SnipPlugin
