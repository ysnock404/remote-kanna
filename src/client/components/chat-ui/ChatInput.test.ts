import { describe, expect, test } from "bun:test"
import { willExceedAttachmentLimit } from "./ChatInput"

describe("willExceedAttachmentLimit", () => {
  test("rejects a batch that would push the composer above the total attachment limit", () => {
    expect(willExceedAttachmentLimit({
      currentAttachmentCount: 7,
      queuedAttachmentCount: 1,
      incomingAttachmentCount: 3,
    })).toBe(true)
  })

  test("allows a batch that exactly reaches the total attachment limit", () => {
    expect(willExceedAttachmentLimit({
      currentAttachmentCount: 7,
      queuedAttachmentCount: 1,
      incomingAttachmentCount: 2,
    })).toBe(false)
  })
})
