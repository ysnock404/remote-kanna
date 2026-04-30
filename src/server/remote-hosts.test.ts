import { describe, expect, test } from "bun:test"
import { getRemoteNodeDiscoveryScript, parseRemoteDiscoveryOutput } from "./remote-hosts"

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
})
