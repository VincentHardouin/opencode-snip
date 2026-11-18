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

// Allow-always must save the same prefix the shell tool saves, or the saved rule
// would only cover this exact command. Mirrors opencode's prefix rules
// (packages/core/src/shell/parse.ts), which plugins cannot import yet; drop this
// table for an import once opencode exports them.
const ARITY: Record<string, number> = {
  cat: 1,
  cd: 1,
  chmod: 1,
  chown: 1,
  cp: 1,
  echo: 1,
  env: 1,
  export: 1,
  grep: 1,
  kill: 1,
  killall: 1,
  ln: 1,
  ls: 1,
  mkdir: 1,
  mv: 1,
  ps: 1,
  pwd: 1,
  rm: 1,
  rmdir: 1,
  sleep: 1,
  source: 1,
  tail: 1,
  touch: 1,
  unset: 1,
  which: 1,
  aws: 3,
  az: 3,
  bazel: 2,
  brew: 2,
  bun: 2,
  "bun run": 3,
  "bun x": 3,
  cargo: 2,
  "cargo add": 3,
  "cargo run": 3,
  cdk: 2,
  cf: 2,
  cmake: 2,
  composer: 2,
  consul: 2,
  "consul kv": 3,
  crictl: 2,
  deno: 2,
  "deno task": 3,
  doctl: 3,
  docker: 2,
  "docker builder": 3,
  "docker compose": 3,
  "docker container": 3,
  "docker image": 3,
  "docker network": 3,
  "docker volume": 3,
  eksctl: 2,
  "eksctl create": 3,
  firebase: 2,
  flyctl: 2,
  gcloud: 3,
  gh: 3,
  git: 2,
  "git config": 3,
  "git remote": 3,
  "git stash": 3,
  go: 2,
  gradle: 2,
  helm: 2,
  heroku: 2,
  hugo: 2,
  ip: 2,
  "ip addr": 3,
  "ip link": 3,
  "ip netns": 3,
  "ip route": 3,
  kind: 2,
  "kind create": 3,
  kubectl: 2,
  "kubectl kustomize": 3,
  "kubectl rollout": 3,
  kustomize: 2,
  make: 2,
  mc: 2,
  "mc admin": 3,
  minikube: 2,
  mongosh: 2,
  mysql: 2,
  mvn: 2,
  ng: 2,
  npm: 2,
  "npm exec": 3,
  "npm init": 3,
  "npm run": 3,
  "npm view": 3,
  npx: 2,
  nvm: 2,
  nx: 2,
  openssl: 2,
  "openssl req": 3,
  "openssl x509": 3,
  pip: 2,
  pipenv: 2,
  pnpm: 2,
  "pnpm dlx": 3,
  "pnpm exec": 3,
  "pnpm run": 3,
  poetry: 2,
  podman: 2,
  "podman container": 3,
  "podman image": 3,
  psql: 2,
  pulumi: 2,
  "pulumi stack": 3,
  python: 2,
  pyenv: 2,
  rake: 2,
  rbenv: 2,
  "redis-cli": 2,
  rustup: 2,
  serverless: 2,
  sfdx: 3,
  skaffold: 2,
  sls: 2,
  sst: 2,
  swift: 2,
  systemctl: 2,
  terraform: 2,
  "terraform workspace": 3,
  tmux: 2,
  turbo: 2,
  ufw: 2,
  vault: 2,
  "vault auth": 3,
  "vault kv": 3,
  vercel: 2,
  volta: 2,
  wp: 2,
  yarn: 2,
  "yarn dlx": 3,
  "yarn run": 3,
}
const PREFIX_LENGTH = Math.max(...Object.values(ARITY))

function prefix(words: string[]) {
  for (let length = Math.min(words.length, PREFIX_LENGTH); length > 0; length--) {
    const arity = ARITY[words.slice(0, length).join(" ")]
    if (arity !== undefined) return words.slice(0, arity)
  }
  return words.slice(0, 1)
}

export function savePattern(command: string): string {
  return `${prefix(command.trim().split(/\s+/)).join(" ")} *`
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
          save: commands.map(savePattern),
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
