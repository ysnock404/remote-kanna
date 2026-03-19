import { describe, expect, test } from "bun:test"
import { easeInOutCubic, interpolateLayout } from "./terminalToggleAnimation"

describe("terminalToggleAnimation", () => {
  test("clamps easing at the ends", () => {
    expect(easeInOutCubic(-1)).toBe(0)
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
    expect(easeInOutCubic(2)).toBe(1)
  })

  test("interpolates panel layouts", () => {
    expect(interpolateLayout([68, 32], [100, 0], 0)).toEqual([68, 32])
    expect(interpolateLayout([68, 32], [100, 0], 1)).toEqual([100, 0])

    const midpoint = interpolateLayout([100, 0], [68, 32], 0.5)
    expect(midpoint[0]).toBeCloseTo(75.18203798328659, 5)
    expect(midpoint[1]).toBeCloseTo(24.817962016713415, 5)
  })
})
