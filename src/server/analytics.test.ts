import { describe, expect, test } from "bun:test"
import { KannaAnalyticsReporter, getLaunchAnalyticsProperties } from "./analytics"

const originalLogAnalytics = process.env.KANNA_LOG_ANALYTICS

function restoreAnalyticsLoggingEnv() {
  if (originalLogAnalytics === undefined) {
    delete process.env.KANNA_LOG_ANALYTICS
    return
  }
  process.env.KANNA_LOG_ANALYTICS = originalLogAnalytics
}

describe("getLaunchAnalyticsProperties", () => {
  test("expands launch flags into app_launch properties", () => {
    expect(getLaunchAnalyticsProperties({
      port: 4000,
      host: "0.0.0.0",
      openBrowser: false,
      share: "quick",
      password: "secret",
      strictPort: true,
    })).toEqual({
      custom_port_enabled: true,
      no_open_enabled: true,
      password_enabled: true,
      strict_port_enabled: true,
      remote_enabled: true,
      host_enabled: false,
      share_quick_enabled: true,
      share_token_enabled: false,
    })
  })
})

describe("KannaAnalyticsReporter", () => {
  test("never posts analytics events even when the setting is enabled", async () => {
    let called = false
    const reporter = new KannaAnalyticsReporter({
      currentVersion: "0.33.9",
      environment: "prod",
      settings: {
        getState: () => ({
          analyticsEnabled: true,
          analyticsUserId: "anon_123",
          warning: null,
          filePathDisplay: "~/.kanna/data/settings.json",
        }),
      },
      fetchImpl: async () => {
        called = true
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      },
    })

    reporter.track("message_sent")
    await (reporter as any).queue

    expect(called).toBe(false)
  })

  test("skips requests when analytics is disabled", async () => {
    let called = false
    const reporter = new KannaAnalyticsReporter({
      currentVersion: "0.33.9",
      environment: "prod",
      settings: {
        getState: () => ({
          analyticsEnabled: false,
          analyticsUserId: "anon_123",
          warning: null,
          filePathDisplay: "~/.kanna/data/settings.json",
        }),
      },
      fetchImpl: async () => {
        called = true
        return new Response(null, { status: 200 })
      },
    })

    reporter.track("message_sent")
    await (reporter as any).queue

    expect(called).toBe(false)
  })

  test("does not warn when analytics request logging is disabled", async () => {
    const originalWarn = console.warn
    const warnings: unknown[][] = []
    console.warn = (...args: unknown[]) => {
      warnings.push(args)
    }
    delete process.env.KANNA_LOG_ANALYTICS

    try {
      const reporter = new KannaAnalyticsReporter({
        currentVersion: "0.33.9",
        environment: "dev",
        settings: {
          getState: () => ({
            analyticsEnabled: true,
            analyticsUserId: "anon_123",
            warning: null,
            filePathDisplay: "~/.kanna/data/settings.json",
          }),
        },
        fetchImpl: async () => new Response(JSON.stringify({ error: "bad request" }), { status: 400 }),
      })

      reporter.track("message_sent")
      await (reporter as any).queue

      expect(warnings).toHaveLength(0)
    } finally {
      console.warn = originalWarn
      restoreAnalyticsLoggingEnv()
    }
  })

  test("logs local suppression when analytics request logging is enabled", async () => {
    const originalLog = console.log
    const logs: unknown[][] = []
    console.log = (...args: unknown[]) => {
      logs.push(args)
    }
    process.env.KANNA_LOG_ANALYTICS = "1"

    try {
      const reporter = new KannaAnalyticsReporter({
        currentVersion: "0.33.9",
        environment: "dev",
        settings: {
          getState: () => ({
            analyticsEnabled: true,
            analyticsUserId: "anon_123",
            warning: null,
            filePathDisplay: "~/.kanna/data/settings.json",
          }),
        },
      })

      reporter.track("message_sent")
      await (reporter as any).queue

      expect(logs).toHaveLength(1)
      expect(logs[0]?.[0]).toBe("[remote-kanna/analytics] Analytics disabled; event not sent:")
      expect(logs[0]?.[1]).toBe("message_sent")
    } finally {
      console.log = originalLog
      restoreAnalyticsLoggingEnv()
    }
  })

  test("does not log when analytics request logging is disabled and the request succeeds", async () => {
    const originalLog = console.log
    const logs: unknown[][] = []
    console.log = (...args: unknown[]) => {
      logs.push(args)
    }
    delete process.env.KANNA_LOG_ANALYTICS

    try {
      const reporter = new KannaAnalyticsReporter({
        currentVersion: "0.33.9",
        environment: "prod",
        settings: {
          getState: () => ({
            analyticsEnabled: true,
            analyticsUserId: "anon_123",
            warning: null,
            filePathDisplay: "~/.kanna/data/settings.json",
          }),
        },
      })

      reporter.track("message_sent")
      await (reporter as any).queue

      expect(logs).toHaveLength(0)
    } finally {
      console.log = originalLog
      restoreAnalyticsLoggingEnv()
    }
  })
})
