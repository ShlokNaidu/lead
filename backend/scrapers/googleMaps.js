import puppeteer from "puppeteer";

import config from "../config.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNavigationTimeout(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("navigation timeout");
}

function normalizeNavigationTimeout(timeoutMs) {
  const parsed = Number(timeoutMs);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    // Puppeteer uses timeout: 0 to disable the navigation timeout.
    return 0;
  }

  return parsed;
}

const MIN_LEAD_NAVIGATION_TIMEOUT_MS = 20 * 60 * 1000;

async function gotoWithRetry(page, url, { timeoutMs, retries = 0, waitUntil = "domcontentloaded" }) {
  let lastError = null;
  const navigationTimeoutMs = normalizeNavigationTimeout(timeoutMs);

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await page.goto(url, {
        waitUntil,
        timeout: navigationTimeoutMs,
      });
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt >= retries;
      if (isLastAttempt || !isNavigationTimeout(error)) {
        throw error;
      }

      console.warn(
        `[maps] Navigation timeout for ${url} (attempt ${attempt + 1}/${retries + 1}), retrying...`,
      );
    }
  }

  throw lastError || new Error("Navigation failed");
}

async function extractResultCards(page) {
  await page.waitForSelector("div[role='feed']", { timeout: 0 });

  const cards = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll("a.hfpxzc"));

    return anchors.slice(0, 20).map((anchor) => {
      const container = anchor.closest("div.Nv2PK");
      const name =
        container?.querySelector("div.qBF1Pd")?.textContent?.trim() || "";
      const ratingText =
        container?.querySelector("span.MW4etd")?.textContent?.trim() || "0";
      const reviewsText =
        container?.querySelector("span.UY7F9")?.textContent?.trim() || "0";
      const address =
        container?.querySelector("div.W4Efsd:nth-child(2)")?.textContent?.trim() ||
        "";

      const rating = Number(ratingText.replace(/[^\d.]/g, "")) || 0;
      const reviewCount = Number(reviewsText.replace(/[^\d]/g, "")) || 0;

      return {
        name,
        address,
        rating,
        reviewCount,
        googleMapsUrl: anchor.href,
      };
    });
  });

  return cards.filter((item) => item.name);
}

async function enrichLead(page, lead) {
  try {
    const leadNavigationTimeoutMs = Math.max(
      normalizeNavigationTimeout(config.mapsDetailTimeoutMs),
      MIN_LEAD_NAVIGATION_TIMEOUT_MS,
    );

    await gotoWithRetry(page, lead.googleMapsUrl, {
      waitUntil: "domcontentloaded",
      timeoutMs: leadNavigationTimeoutMs,
      retries: 0,
    });
    await sleep(1200);

    const detail = await page.evaluate(() => {
      const websiteAnchor = document.querySelector("a[data-item-id='authority']");
      const phoneButton = document.querySelector("button[data-item-id^='phone:tel:']");
      const cityText =
        document
          .querySelector("button[data-item-id='address']")
          ?.textContent?.trim() || "";

      return {
        website: websiteAnchor?.href || "",
        phone: phoneButton?.getAttribute("data-item-id")?.replace("phone:tel:", "") || "",
        cityText,
      };
    });

    return {
      ...lead,
      website: detail.website,
      phone: detail.phone,
      cityHint: detail.cityText,
    };
  } catch (error) {
    console.warn(`[maps] Failed to enrich ${lead.name}:`, error.message);
    return lead;
  }
}

export async function scrapeGoogleMapsLeads({ query, city, maxResults }) {
  const safeQuery = query || "restaurants";
  const safeCity = city || "";
  const limit = Math.min(maxResults || config.maxLeadsPerRun, config.maxLeadsPerRun);

  let browser;
  try {
    console.log(`[maps] Searching leads for ${safeQuery} in ${safeCity}`);

    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setUserAgent(config.userAgent);
    await page.setDefaultNavigationTimeout(0);

    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(
      `${safeQuery} ${safeCity}`
    )}`;

    await gotoWithRetry(page, searchUrl, {
      waitUntil: "domcontentloaded",
      timeoutMs: 0,
      retries: 0,
    });

    await sleep(config.scrapeDelay);

    const rawLeads = await extractResultCards(page);
    const selected = rawLeads.slice(0, limit);

    const enriched = [];
    for (const lead of selected) {
      const withDetails = await enrichLead(page, lead);
      enriched.push({
        ...withDetails,
        city: safeCity || withDetails.cityHint || "Unknown",
        source: "google_maps",
      });
      await sleep(500);
    }

    return {
      ok: true,
      error: null,
      data: enriched,
    };
  } catch (error) {
    console.error("[maps] Failed to scrape Google Maps:", error.message);
    return {
      ok: false,
      error: error.message,
      data: [],
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {
        console.warn("[maps] Browser close failed");
      });
    }
  }
}
