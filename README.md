# opencode-snip

OpenCode plugin that automatically prefixes shell commands with [snip](https://github.com/edouard-claude/snip) to reduce LLM token consumption by 60-90%.

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
  "plugins": ["opencode-snip@latest"]
}
```

The plugin targets OpenCode v2. On OpenCode v1, use `opencode-snip@2`.

## How It Works

The plugin uses the tool `execute.before` hook to forward each `shell` command to `snip hook`, the same rewrite engine snip uses for Claude Code and other agents (tested with snip v0.25.2):

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
