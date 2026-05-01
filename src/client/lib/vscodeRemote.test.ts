import { describe, expect, it } from "bun:test"
import { getBrowserSshTargetForPath, getVscodeRemoteSshUri } from "./vscodeRemote"

describe("getVscodeRemoteSshUri", () => {
  it("builds a VS Code Remote SSH URL for a remote workspace", () => {
    expect(getVscodeRemoteSshUri(
      { id: "remote:desktop-pc", sshTarget: "ysnock@100.84.223.44" },
      "/home/ysnock/remote-kanna"
    )).toBe("vscode://vscode-remote/ssh-remote+ysnock@100.84.223.44/home/ysnock/remote-kanna")
  })

  it("encodes path segments without escaping path separators", () => {
    expect(getVscodeRemoteSshUri(
      { id: "remote:desktop-pc", sshTarget: "ysnock@100.84.223.44" },
      "/home/ysnock/My Project"
    )).toBe("vscode://vscode-remote/ssh-remote+ysnock@100.84.223.44/home/ysnock/My%20Project")
  })

  it("does not generate SSH links for the local machine", () => {
    expect(getVscodeRemoteSshUri(
      { id: "local" },
      "/home/ysnock/remote-kanna"
    )).toBeNull()
  })

  it("can use a fallback SSH target for server-local workspaces", () => {
    expect(getVscodeRemoteSshUri(
      { id: "local" },
      "/root/remote-kanna",
      { fallbackSshTarget: "root@100.97.44.94" }
    )).toBe("vscode://vscode-remote/ssh-remote+root@100.97.44.94/root/remote-kanna")
  })

  it("infers a browser SSH target from the current host and workspace owner", () => {
    expect(getBrowserSshTargetForPath("/root/remote-kanna", { hostname: "100.97.44.94" })).toBe("root@100.97.44.94")
    expect(getBrowserSshTargetForPath("/home/ysnock/project", { hostname: "100.97.44.94" })).toBe("ysnock@100.97.44.94")
  })
})
