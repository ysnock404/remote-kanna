import { describe, expect, test } from "bun:test"
import { getRemoteCmdTerminalCommand, getRemoteCodexAppServerCommand, getRemoteNodeCommand, getRemoteNodeDiscoveryScript, getRemotePosixCommand, parseRemoteDiscoveryOutput } from "./remote-hosts"

describe("remote hosts", () => {
  test("parses JSON remote discovery rows", () => {
    const projects = parseRemoteDiscoveryOutput(JSON.stringify([
      {
        localPath: "/c/Users/ysnock/Projects/alpha",
        title: "alpha",
        modifiedAt: 10,
      },
      {
        localPath: "",
        title: "ignored",
        modifiedAt: 20,
      },
    ]))

    expect(projects).toEqual([
      {
        localPath: "/c/Users/ysnock/Projects/alpha",
        title: "alpha",
        modifiedAt: 10,
      },
    ])
  })

  test("parses legacy newline remote discovery output", () => {
    const projects = parseRemoteDiscoveryOutput("/tmp/project-a\n/tmp/project-b\n")

    expect(projects.map((project) => ({
      localPath: project.localPath,
      title: project.title,
    }))).toEqual([
      {
        localPath: "/tmp/project-a",
        title: "project-a",
      },
      {
        localPath: "/tmp/project-b",
        title: "project-b",
      },
    ])
  })

  test("builds a node discovery script that reads Claude and Codex metadata before root fallback", () => {
    const script = getRemoteNodeDiscoveryScript(["~/Projects"])

    expect(script).toContain(".claude.json")
    expect(script).toContain(".codex")
    expect(script).toContain("~/Projects")
    expect(script).toContain("scanProjectRoot")
  })

  test("builds a remote Codex command that can find nvm-installed Codex", () => {
    const command = getRemoteCodexAppServerCommand("~/Projects/demo")

    expect(command).toContain("cd $HOME'/Projects/demo' || exit")
    expect(command).toContain("command -v codex >/dev/null 2>&1")
    expect(command).toContain("$HOME/.nvm/nvm.sh")
    expect(command).toContain("find \"$HOME/.nvm/versions/node\"")
    expect(command).toContain("exec codex app-server")
  })

  test("builds a remote Node command that can find nvm-installed Node", () => {
    const command = getRemoteNodeCommand("node -e 'console.log(1)'")

    expect(command).toContain("command -v node >/dev/null 2>&1")
    expect(command).toContain("$HOME/.nvm/nvm.sh")
    expect(command).toContain("find \"$HOME/.nvm/versions/node\" -path \"*/bin/node\"")
    expect(command).toContain("node -e 'console.log(1)'")
  })

  test("builds a cmd terminal command from Git Bash style Windows paths", () => {
    expect(getRemoteCmdTerminalCommand("/c/Workspace/Project One")).toBe("cd /d \"C:/Workspace/Project One\" && cmd.exe /Q /K")
    expect(getRemoteCmdTerminalCommand("~/Desktop")).toBe("cd /d \"%USERPROFILE%/Desktop\" && cmd.exe /Q /K")
  })

  test("wraps POSIX commands for cmd-backed Windows hosts", () => {
    const command = getRemotePosixCommand({
      id: "desktop-pc",
      label: "Desktop",
      sshTarget: "ysnock@100.84.223.44",
      enabled: true,
      projectRoots: [],
      codexEnabled: true,
      claudeEnabled: true,
      terminalShell: "cmd",
    }, "command -v node >/dev/null 2>&1")

    expect(command).toContain("powershell -NoLogo -NoProfile -NonInteractive -EncodedCommand")
  })
})
