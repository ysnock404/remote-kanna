import { PROD_SERVER_PORT } from "../shared/ports"
import type { ShareMode } from "../shared/share"
import { isTokenShareMode } from "../shared/share"

export interface LaunchAnalyticsOptions {
  port: number
  host: string
  openBrowser: boolean
  share: ShareMode
  password: string | null
  strictPort: boolean
}

type AnalyticsEnvironment = "dev" | "prod"
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

function isAnalyticsLoggingEnabled() {
  return process.env.KANNA_LOG_ANALYTICS === "1"
}

export interface AnalyticsReporter {
  track: (eventName: string, properties?: Record<string, unknown>) => void
  trackLaunch: (options: LaunchAnalyticsOptions) => void
}

interface AnalyticsSettings {
  getState: () => {
    analyticsEnabled: boolean
    analyticsUserId: string
  }
}

export class KannaAnalyticsReporter implements AnalyticsReporter {
  private readonly settings: AnalyticsSettings
  private readonly currentVersion: string
  private readonly environment: AnalyticsEnvironment
  readonly queue = Promise.resolve()

  constructor(args: {
    settings: AnalyticsSettings
    currentVersion: string
    environment: AnalyticsEnvironment
    endpoint?: string
    fetchImpl?: FetchLike
  }) {
    this.settings = args.settings
    this.currentVersion = args.currentVersion
    this.environment = args.environment
  }

  track(eventName: string, properties?: Record<string, unknown>) {
    const { analyticsEnabled } = this.settings.getState()
    if (!analyticsEnabled) {
      return
    }

    if (isAnalyticsLoggingEnabled()) {
      console.log("[remote-kanna/analytics] Analytics disabled; event not sent:", eventName, {
        current_version: this.currentVersion,
        environment: this.environment,
        ...(properties ?? {}),
      })
    }
  }

  trackLaunch(options: LaunchAnalyticsOptions) {
    this.track("app_launch", getLaunchAnalyticsProperties(options))
  }
}

export function getLaunchAnalyticsProperties(options: LaunchAnalyticsOptions) {
  return {
    custom_port_enabled: options.port !== PROD_SERVER_PORT,
    no_open_enabled: !options.openBrowser,
    password_enabled: Boolean(options.password),
    strict_port_enabled: options.strictPort,
    remote_enabled: options.host === "0.0.0.0",
    host_enabled: options.host !== "0.0.0.0" && options.host !== "127.0.0.1" && options.host !== "localhost",
    share_quick_enabled: options.share === "quick",
    share_token_enabled: isTokenShareMode(options.share),
  }
}

export const NoopAnalyticsReporter: AnalyticsReporter = {
  track: () => {},
  trackLaunch: () => {},
}
