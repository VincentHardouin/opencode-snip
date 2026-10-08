# opencode-snip

OpenCode plugin that automatically prefixes shell commands with [snip](https://github.com/edouard-claude/snip) to reduce LLM token consumption by 60-90%.

## OpenCode V2 port

This fork ports the plugin to the **OpenCode V2 plugin API** — OpenCode V2 rejects V1 hook objects (*"Plugin must export a default definition with an id and a setup function"*), so the V1 `tool.execute.before` (bash) hook is registered as its V2 equivalents instead:

- `ctx.tool.hook("execute.before")` — the only registered hook: rewrites `shell`/`bash` commands before execution (the V2 `ctx.shell.hook("create.before")` hook is not invoked for shell tool executions in OpenCode 2.0.x, so it is not used)

Also supports a `snip.exe` shipped next to the plugin or at the package root (no PATH dependency). The PowerShell `&` prefix is decided from the OpenCode `shell` setting (project config first, then global), falling back to PowerShell on Windows. Every hook is fail-open: on any failure the command runs unchanged.

Install (OpenCode V2):

```jsonc
// ~/.config/opencode/opencode.json
{
  "plugins": ["opencode-snip@git+https://github.com/cpvcristian1/opencode-snip.git"]
}
```

Port of [VincentHardouin/opencode-snip](https://github.com/VincentHardouin/opencode-snip) (MIT).

## What is snip?

[snip](https://github.com/edouard-claude/snip) is a CLI proxy that filters shell output before it reaches your LLM context window.

| Command | Before | After | Savings |
|---------|--------|-------|---------|
| `go test ./...` | 689 tokens | 16 tokens | 97.7% |
| `git log` | 371 tokens | 53 tokens | 85.7% |
| `cargo test` | 591 tokens | 5 tokens | 99.2% |

## Installation

### 1. Install snip

```bash
brew install edouard-claude/tap/snip
# or
go install github.com/edouard-claude/snip/cmd/snip@latest
```

### 2. Configure OpenCode

Add the plugin to your OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-snip@latest"]
}
```

## How It Works

The plugin uses the `tool.execute.before` hook to forward each bash command to `snip hook`, the same rewrite engine snip uses for Claude Code and other agents (tested with snip v0.25.2):

- only commands snip has a filter for are rewritten to `snip run -- <command>`, each segment of `&&`, `||`, `;` chains separately
- commands whose output feeds a pipe or a file redirection, heredocs, shell blocks and command substitutions are left untouched
- if `snip hook` fails, the command runs unchanged

## Development

This package uses [semantic-release](https://semantic-release.gitbook.io/) for automated releases. Commit messages should follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

- `fix:` → patch release
- `feat:` → minor release
- `feat!:`, `fix!:` → major release

## License

MIT
