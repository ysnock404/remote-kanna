import { describe, expect, test } from "bun:test"
import { getProjectRequestCommand } from "./projectRequests"

describe("getProjectRequestCommand", () => {
  test("uses project.create for existing paths so missing folders are created", () => {
    expect(getProjectRequestCommand({
      mode: "existing",
      machineId: "remote:desktop-pc",
      localPath: "/root/overwatch-tatical-board",
      title: "overwatch-tatical-board",
    })).toEqual({
      type: "project.create",
      machineId: "remote:desktop-pc",
      localPath: "/root/overwatch-tatical-board",
      title: "overwatch-tatical-board",
    })
  })
})
