import { exec } from "child_process";

import config from "../config.js";

function runCommand(command, timeoutMs) {
  return new Promise((resolve, reject) => {
    exec(
      command,
      {
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024 * 20,
      },
      (error, stdout, stderr) => {
        if (error) {
          return reject(new Error(stderr || error.message));
        }
        resolve(stdout);
      }
    );
  });
}

function toScore(value) {
  if (typeof value !== "number") return null;
  return Math.round(value * 100);
}

export async function runLighthouseAudit(url) {
  if (!url) {
    return { ok: false, error: "Missing URL", data: null };
  }

  try {
    console.log(`[lighthouse] Auditing ${url}`);

    const command = [
      "npx lighthouse",
      `\"${url}\"`,
      "--output=json",
      "--output-path=stdout",
      "--quiet",
      "--chrome-flags=\"--headless --no-sandbox --disable-gpu\"",
      `--max-wait-for-load=${config.lighthouseTimeout}`,
    ].join(" ");

    const stdout = await runCommand(command, config.lighthouseTimeout + 15000);
    const report = JSON.parse(stdout);

    const data = {
      performanceScore: toScore(
        report?.categories?.performance?.score ?? null
      ),
      accessibilityScore: toScore(
        report?.categories?.accessibility?.score ?? null
      ),
      bestPracticesScore: toScore(
        report?.categories?.["best-practices"]?.score ?? null
      ),
      seoScore: toScore(report?.categories?.seo?.score ?? null),
      fcp:
        report?.audits?.["first-contentful-paint"]?.numericValue ?? null,
      lcp:
        report?.audits?.["largest-contentful-paint"]?.numericValue ?? null,
      cls:
        report?.audits?.["cumulative-layout-shift"]?.numericValue ?? null,
      tbt: report?.audits?.["total-blocking-time"]?.numericValue ?? null,
      auditedAt: new Date(),
    };

    return { ok: true, error: null, data };
  } catch (error) {
    console.error("[lighthouse] Audit failed:", error.message);
    return { ok: false, error: error.message, data: null };
  }
}
