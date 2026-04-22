import type { LaunchOptions } from "playwright";

/**
 * Default Chromium flags for Linux containers (Railway, Docker, k8s).
 * Without these, Chromium often exits immediately (sandbox / /dev/shm).
 */
export function chromiumLaunchOptions(): LaunchOptions {
  return {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  };
}
