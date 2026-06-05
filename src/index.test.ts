import { describe, it, expect, beforeEach } from "vitest"
import { toolExecuteBefore } from "./index"

describe("toolExecuteBefore", () => {
  let mockInput: { tool: string; sessionID: string; callID: string }
  let mockOutput: { args: { command: string } }

  beforeEach(() => {
    mockInput = { tool: "bash", sessionID: "s", callID: "c" }
    mockOutput = { args: { command: "" } }
  })

  it("should prefix simple command with snip", async () => {
    mockOutput.args.command = "go test ./..."
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip go test ./...")
  })

  it("should handle command with one env var prefix", async () => {
    mockOutput.args.command = "CGO_ENABLED=0 go test ./..."
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("CGO_ENABLED=0 snip go test ./...")
  })

  it("should handle command with multiple env var prefixes", async () => {
    mockOutput.args.command = "CGO_ENABLED=0 GOOS=linux go test ./..."
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("CGO_ENABLED=0 GOOS=linux snip go test ./...")
  })

  it("should handle command with &&", async () => {
    mockOutput.args.command = "go test && go build"
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip go test && snip go build")
  })

  it("should handle command with |", async () => {
    mockOutput.args.command = "git log | head"
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip git log | head")
  })

  it("should handle command with ;", async () => {
    mockOutput.args.command = "go test; go build"
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip go test; snip go build")
  })

  it("should handle command with ||", async () => {
    mockOutput.args.command = "test -f foo.txt || echo missing"
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip test -f foo.txt || snip echo missing")
  })

  it("should handle command with &", async () => {
    mockOutput.args.command = "sleep 1 & sleep 2 &"
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip sleep 1 & snip sleep 2 &")
  })

  it("should handle mixed operators", async () => {
    mockOutput.args.command = "go test && go build; go run"
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip go test && snip go build; snip go run")
  })

  it("should handle env vars with operators", async () => {
    mockOutput.args.command = "FOO=bar go test && go build"
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("FOO=bar snip go test && snip go build")
  })

  it("should not double prefix already prefixed command", async () => {
    mockOutput.args.command = "snip go test"
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip go test")
  })

  it("should not modify non-bash tool calls", async () => {
    mockInput.tool = "read"
    mockOutput.args.command = "go test"
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("go test")
  })

  describe("unproxyable shell builtins", () => {
    it("should skip cd", async () => {
      mockOutput.args.command = "cd /tmp"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("cd /tmp")
    })

    it("should skip source", async () => {
      mockOutput.args.command = "source ~/.bashrc"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("source ~/.bashrc")
    })

    it("should skip . (dot)", async () => {
      mockOutput.args.command = ". ./env.sh"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe(". ./env.sh")
    })

    it("should skip export", async () => {
      mockOutput.args.command = "export FOO=bar"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("export FOO=bar")
    })

    it("should skip alias", async () => {
      mockOutput.args.command = 'alias ll="ls -la"'
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe('alias ll="ls -la"')
    })

    it("should skip unset", async () => {
      mockOutput.args.command = "unset VAR"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("unset VAR")
    })

    it("should skip export with env var prefix", async () => {
      mockOutput.args.command = "CGO_ENABLED=0 export FOO=bar"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("CGO_ENABLED=0 export FOO=bar")
    })

    it("should skip cd but snip chained command", async () => {
      mockOutput.args.command = "cd /tmp && ls"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("cd /tmp && snip ls")
    })
  })

  describe("redirections with &", () => {
    it("should not break 2>&1 redirection", async () => {
      mockOutput.args.command = "find / -name \"*.log\" 2>&1"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip find / -name \"*.log\" 2>&1")
    })

    it("should not break 1>&2 redirection", async () => {
      mockOutput.args.command = "cmd 1>&2"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip cmd 1>&2")
    })

    it("should handle 2>&1 with pipe", async () => {
      mockOutput.args.command = "find / -name \"*.log\" 2>&1 | grep error"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip find / -name \"*.log\" 2>&1 | grep error")
    })

    it("should handle 2>&1 with chained commands", async () => {
      mockOutput.args.command = "cmd1 2>&1 && cmd2"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip cmd1 2>&1 && snip cmd2")
    })
  })

  describe("pipe expressions with quotes", () => {
    it("should not split pipes inside single quotes", async () => {
      mockOutput.args.command = "cat file.json | jq '.content | .text'"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip cat file.json | jq '.content | .text'")
    })

    it("should not split pipes inside double quotes", async () => {
      mockOutput.args.command = 'cat file.json | jq ".content | .text"'
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe('snip cat file.json | jq ".content | .text"')
    })

    it("should handle jq with fromjson", async () => {
      mockOutput.args.command = "cat file.json | jq '.content[0].text | fromjson'"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip cat file.json | jq '.content[0].text | fromjson'")
    })

    it("should handle multiple pipes in jq", async () => {
      mockOutput.args.command = "cat file.json | jq '.a | .b | .c'"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip cat file.json | jq '.a | .b | .c'")
    })

    it("should handle pipe with || operator", async () => {
      mockOutput.args.command = "cmd1 || cmd2"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip cmd1 || snip cmd2")
    })

    it("should handle mixed quotes and pipes", async () => {
      mockOutput.args.command = 'echo "hello | world" | cat'
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe('snip echo "hello | world" | cat')
    })
  })

  describe("PowerShell support", () => {
    it("should skip PowerShell env var assignment", async () => {
      mockOutput.args.command = "$env:CI='true'"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("$env:CI='true'")
    })

    it("should skip PowerShell variable assignment", async () => {
      mockOutput.args.command = "$x = 1"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("$x = 1")
    })

    it("should skip Write-Output cmdlet", async () => {
      mockOutput.args.command = "Write-Output 'hello'"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("Write-Output 'hello'")
    })

    it("should skip Get-ChildItem cmdlet", async () => {
      mockOutput.args.command = "Get-ChildItem ."
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("Get-ChildItem .")
    })

    it("should skip Remove-Item cmdlet", async () => {
      mockOutput.args.command = "Remove-Item -Recurse -Force dir"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("Remove-Item -Recurse -Force dir")
    })

    it("should skip ForEach-Object cmdlet (camelCase verb)", async () => {
      mockOutput.args.command = "ForEach-Object { $_.Name }"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("ForEach-Object { $_.Name }")
    })

    it("should skip ConvertTo-Json cmdlet (camelCase verb)", async () => {
      mockOutput.args.command = "ConvertTo-Json -Depth 5"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("ConvertTo-Json -Depth 5")
    })

    it("should skip PowerShell call operator (&)", async () => {
      mockOutput.args.command = "& 'C:\\Program Files\\tool.exe'"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("& 'C:\\Program Files\\tool.exe'")
    })

    it("should skip PowerShell splatting (@args)", async () => {
      mockOutput.args.command = "@args"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("@args")
    })

    it("should skip PowerShell array literal (@())", async () => {
      mockOutput.args.command = '@("a","b")'
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe('@("a","b")')
    })

    it("should skip env var but snip chained command", async () => {
      mockOutput.args.command = "$env:CI='true'; git log -1"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("$env:CI='true'; snip git log -1")
    })

    it("should skip cmdlet but snip chained command", async () => {
      mockOutput.args.command = "Write-Output 'test'; git log -1"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("Write-Output 'test'; snip git log -1")
    })

    it("should handle mixed PowerShell env vars and commands", async () => {
      mockOutput.args.command = "$env:CI='true'; $env:GIT_PAGER='cat'; cd 'C:\\Projects'; git log -1"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("$env:CI='true'; $env:GIT_PAGER='cat'; cd 'C:\\Projects'; snip git log -1")
    })
  })

  describe("newline splitting", () => {
    it("should split and snip commands separated by newlines", async () => {
      mockOutput.args.command = "git log\ngit status"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip git log\nsnip git status")
    })

    it("should handle newline after unproxyable command", async () => {
      mockOutput.args.command = "cd /tmp\ngit log"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("cd /tmp\nsnip git log")
    })

    it("should handle mixed newlines and operators", async () => {
      mockOutput.args.command = "cd /tmp\ngit log && git status"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("cd /tmp\nsnip git log && snip git status")
    })

    it("should handle pipe within newline-separated commands", async () => {
      mockOutput.args.command = "cd /tmp\ngit log | head"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("cd /tmp\nsnip git log | head")
    })

    it("should handle PowerShell prelude with newlines", async () => {
      mockOutput.args.command = "$env:CI='true'; cd 'C:\\Projects'\ngit show abc123"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("$env:CI='true'; cd 'C:\\Projects'\nsnip git show abc123")
    })
  })

  describe("heredoc safety", () => {
    it("should not split heredoc body on newlines", async () => {
      mockOutput.args.command = "cat <<EOF\nhello world\nEOF"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip cat <<EOF\nhello world\nEOF")
    })

    it("should not split heredoc with quoted delimiter", async () => {
      mockOutput.args.command = "cat <<'EOF'\nhello world\nEOF"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip cat <<'EOF'\nhello world\nEOF")
    })

    it("should still split operators when heredoc is present", async () => {
      mockOutput.args.command = "cat <<EOF\ndata\nEOF && echo done"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip cat <<EOF\ndata\nEOF && snip echo done")
    })
  })
})