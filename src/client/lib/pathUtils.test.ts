import { describe, expect, test } from "bun:test"
import { parseLocalFileLink } from "./pathUtils"

describe("parseLocalFileLink", () => {
  test("parses an absolute file path with a line fragment", () => {
    expect(parseLocalFileLink("/Users/jake/Projects/kanna/src/app.ts#L12")).toEqual({
      path: "/Users/jake/Projects/kanna/src/app.ts",
      line: 12,
      column: undefined,
    })
  })

  test("parses an absolute file path without a fragment", () => {
    expect(parseLocalFileLink("/Users/jake/Projects/kanna/src/app.ts")).toEqual({
      path: "/Users/jake/Projects/kanna/src/app.ts",
    })
  })

  test("does not treat web links as local file links", () => {
    expect(parseLocalFileLink("https://example.com")).toBeNull()
  })
})
