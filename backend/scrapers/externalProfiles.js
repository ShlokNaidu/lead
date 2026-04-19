import * as cheerio from "cheerio";
import puppeteer from "puppeteer";

import config from "../config.js";

const FACEBOOK_HOST_RE = /facebook\.com/i;
const TRIPADVISOR_HOST_RE = /tripadvisor\./i;

function normalizeUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const safe = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
    return new URL(safe).toString();
  } catch (_error) {
    return "";
  }
}

function cleanContactValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeContactText(value) {
  return String(value || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s*@\s*/g, "@")
    .replace(/\s*\.\s*/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeEmailCandidate(value) {
  const cleaned = cleanContactValue(value).replace(/^mailto:/i, "").split(/[?#&\s]/)[0];
  if (!cleaned.includes("@")) return "";

  const [localRaw, domainRaw] = cleaned.split("@");
  const local = (localRaw || "").match(/^[A-Za-z0-9._%+-]+/)?.[0] || "";
  const domain = (domainRaw || "").match(/^[A-Za-z0-9.-]+?\.[a-z]{2,}(?=[^a-z]|$)/)?.[0] || "";

  if (!local || !domain) return "";
  return `${local}@${domain}`.toLowerCase();
}

function extractFirstEmail(text) {
  if (!text) return "";
  const normalized = normalizeContactText(text);
  const match = normalized.match(
    /(?<![A-Za-z0-9._%+-])([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})(?![A-Za-z0-9.-])/,
  );
  return match ? sanitizeEmailCandidate(match[0]) : "";
}

function extractFirstPhone(text) {
  if (!text) return "";

  const matches = text.matchAll(/(\+?\d[\d\s().-]{6,}\d)/g);

  for (const match of matches) {
    const candidate = cleanContactValue(match[0]);
    const digits = candidate.replace(/\D/g, "");
    const hasPhoneFormatting = /[+\s()-]/.test(candidate);
    const isIpLike = /^\d{1,3}(\.\d{1,3}){3}$/.test(candidate);
    const hasDotSeparator = candidate.includes(".");
    const startsWithPlus = candidate.startsWith("+");
    const parts = candidate
      .replace(/^\+/, "")
      .split(/[\s-]+/)
      .map((part) => part.replace(/[()]/g, ""))
      .filter(Boolean);
    const hasOversizedPart = parts.length > 1 && parts.some((part) => part.length > 4);
    const index = typeof match.index === "number" ? match.index : 0;
    const context = text
      .slice(Math.max(0, index - 32), Math.min(text.length, index + candidate.length + 32))
      .toLowerCase();
    const hasContactContext = /(phone|call|contact|whatsapp|tel|reservation|book)/i.test(
      context,
    );

    if (isIpLike) {
      continue;
    }

    if (hasDotSeparator) {
      continue;
    }

    // Reject plain numeric IDs/timestamps that often appear in script-heavy pages.
    if (!hasPhoneFormatting) {
      continue;
    }

    if (!hasContactContext && !startsWithPlus) {
      continue;
    }

    if (hasOversizedPart) {
      continue;
    }

    // E.164 max is 15 digits; values beyond that are typically IDs, not phone numbers.
    if (digits.length >= 8 && digits.length <= 15) {
      return candidate;
    }
  }

  return "";
}

function hasContacts(contacts) {
  return Boolean(contacts?.email || contacts?.phone);
}

async function fetchHtmlOnce(url) {
  const timeoutMs = Math.min(Math.max(config.lighthouseTimeout || 30000, 8000), 45000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": config.userAgent,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtml(url) {
  try {
    return await fetchHtmlOnce(url);
  } catch (primaryError) {
    const proxyUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, "")}`;
    try {
      return await fetchHtmlOnce(proxyUrl);
    } catch (proxyError) {
      throw new Error(`${primaryError.message}; proxy failed: ${proxyError.message}`);
    }
  }
}

function decodeDuckDuckGoResultLink(rawHref) {
  if (!rawHref) return "";

  const normalizedHref = rawHref.startsWith("//")
    ? `https:${rawHref}`
    : rawHref.startsWith("/")
      ? `https://duckduckgo.com${rawHref}`
      : rawHref;

  if (!normalizedHref.startsWith("http")) return "";

  try {
    const parsed = new URL(normalizedHref);

    if (parsed.hostname.includes("duckduckgo.com") && parsed.pathname.startsWith("/l/")) {
      const target = parsed.searchParams.get("uddg");
      return target ? decodeURIComponent(target) : "";
    }

    if (parsed.hostname.includes("duckduckgo.com")) {
      return "";
    }

    return normalizedHref;
  } catch (_error) {
    return "";
  }
}

function isPlatformUrl(url, platform) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (platform === "facebook") {
      return FACEBOOK_HOST_RE.test(hostname);
    }
    return TRIPADVISOR_HOST_RE.test(hostname);
  } catch (_error) {
    return false;
  }
}

function extractFacebookUrlFromLoginLink(url) {
  if (!url) return "";

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    if (!host.includes("facebook.com") || !path.startsWith("/login/")) {
      return "";
    }

    const nextParam = parsed.searchParams.get("next") || "";
    if (!nextParam) return "";

    const decoded = decodeURIComponent(nextParam);
    return normalizeUrl(decoded);
  } catch (_error) {
    return "";
  }
}

function canonicalizeFacebookProfileUrl(rawUrl) {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized) return "";

  const loginResolved = extractFacebookUrlFromLoginLink(normalized);
  if (loginResolved) {
    return canonicalizeFacebookProfileUrl(loginResolved);
  }

  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();

    if (!host.includes("facebook.com")) {
      return "";
    }

    const segments = parsed.pathname.split("/").filter(Boolean);
    const blockedRoots = new Set([
      "login",
      "recover",
      "photo",
      "share",
      "sharer.php",
      "plugins",
      "dialog",
      "help",
      "privacy",
      "terms",
    ]);
    const blockedSuffixes = new Set([
      "followers",
      "following",
      "about",
      "photos",
      "reels_tab",
      "videos",
      "reviews",
      "posts",
    ]);

    if (!segments.length || blockedRoots.has(segments[0].toLowerCase())) {
      return "";
    }

    while (segments.length && blockedSuffixes.has(segments[segments.length - 1].toLowerCase())) {
      segments.pop();
    }

    if (!segments.length) {
      return "";
    }

    return `https://www.facebook.com/${segments.join("/")}/`;
  } catch (_error) {
    return "";
  }
}

async function discoverProfileUrl({ name, city, platform }) {
  const query = `${name || ""} ${city || ""} ${platform}`.trim();
  if (!query) return "";

  try {
    const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const html = await fetchHtml(searchUrl);
    const $ = cheerio.load(html);

    const candidateLinks = [
      ...$("a.result__a")
        .map((_idx, el) => $(el).attr("href"))
        .get(),
      ...$("a")
        .map((_idx, el) => $(el).attr("href"))
        .get(),
    ]
      .filter(Boolean)
      .map((href) => decodeDuckDuckGoResultLink(String(href)))
      .map((href) => normalizeUrl(href))
      .filter(Boolean);

    return candidateLinks.find((link) => isPlatformUrl(link, platform)) || "";
  } catch (error) {
    console.warn(`[profiles] Failed to discover ${platform} link:`, error.message);
    return "";
  }
}

function collectContactsFromHtml(html, renderedText = "") {
  const $ = cheerio.load(html);

  const allLinks = $("a")
    .map((_idx, el) => $(el).attr("href"))
    .get()
    .filter(Boolean)
    .map((href) => String(href));

  const mailToEmail = allLinks
    .filter((href) => href.toLowerCase().startsWith("mailto:"))
    .map((href) => sanitizeEmailCandidate(String(href)))
    .find(Boolean);

  const telPhone = allLinks
    .filter((href) => href.toLowerCase().startsWith("tel:"))
    .map((href) => cleanContactValue(href.replace(/^tel:/i, "").split("?")[0]))
    .find(Boolean);

  const pageText = normalizeContactText(`${$("body").text()} ${renderedText}`);
  const htmlText = normalizeContactText(html);

  return {
    email: mailToEmail || extractFirstEmail(pageText) || extractFirstEmail(htmlText),
    phone: telPhone || extractFirstPhone(pageText),
  };
}

async function scrapeProfileWithBrowser(url, platform) {
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setUserAgent(config.userAgent);
    await page.setDefaultNavigationTimeout(Math.min(config.lighthouseTimeout || 30000, 35000));

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: Math.min(config.lighthouseTimeout || 30000, 35000),
    });

    const html = await page.content();
    const renderedText = await page.evaluate(() => {
      if (!document || !document.body) return "";
      return document.body.innerText || "";
    });
    const contacts = collectContactsFromHtml(html, renderedText);

    return {
      ok: true,
      error: null,
      contacts,
      source: "browser",
    };
  } catch (error) {
    console.warn(`[profiles] Browser fallback failed for ${platform}:`, error.message);
    return {
      ok: false,
      error: error.message,
      contacts: { email: "", phone: "" },
      source: "browser",
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {
        console.warn("[profiles] Browser close failed");
      });
    }
  }
}

async function scrapeProfile(url, platform) {
  if (!url) {
    return {
      ok: false,
      error: "No profile URL",
      data: {
        platform,
        url: "",
        email: "",
        phone: "",
        scrapedAt: null,
      },
    };
  }

  let fetchError = null;

  try {
    const html = await fetchHtml(url);
    const contacts = collectContactsFromHtml(html);

    if (hasContacts(contacts)) {
      return {
        ok: true,
        error: null,
        data: {
          platform,
          url,
          email: contacts.email,
          phone: contacts.phone,
          scrapedAt: new Date().toISOString(),
        },
      };
    }

    const browserFallback = await scrapeProfileWithBrowser(url, platform);

    if (browserFallback.ok && hasContacts(browserFallback.contacts)) {
      return {
        ok: true,
        error: null,
        data: {
          platform,
          url,
          email: browserFallback.contacts.email,
          phone: browserFallback.contacts.phone,
          scrapedAt: new Date().toISOString(),
        },
      };
    }

    return {
      ok: true,
      error: browserFallback.ok ? null : browserFallback.error,
      data: {
        platform,
        url,
        email: contacts.email,
        phone: contacts.phone,
        scrapedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    fetchError = error.message;
    console.warn(`[profiles] Failed to scrape ${platform} profile via HTTP:`, fetchError);

    const browserFallback = await scrapeProfileWithBrowser(url, platform);

    if (browserFallback.ok) {
      return {
        ok: true,
        error: null,
        data: {
          platform,
          url,
          email: browserFallback.contacts.email,
          phone: browserFallback.contacts.phone,
          scrapedAt: new Date().toISOString(),
        },
      };
    }

    return {
      ok: false,
      error: `${fetchError}; browser failed: ${browserFallback.error}`,
      data: {
        platform,
        url,
        email: "",
        phone: "",
        scrapedAt: new Date().toISOString(),
      },
    };
  }
}

export async function scrapeExternalProfiles({ name, city, socialLinks = [] }) {
  const normalizedSocialLinks = [...new Set((socialLinks || []).map(normalizeUrl).filter(Boolean))];

  const facebookCandidates = normalizedSocialLinks
    .filter((link) => FACEBOOK_HOST_RE.test(link))
    .map((link) => canonicalizeFacebookProfileUrl(link))
    .filter(Boolean);

  let facebookUrl = facebookCandidates[0] || "";
  let tripadvisorUrl =
    normalizedSocialLinks.find((link) => TRIPADVISOR_HOST_RE.test(link)) || "";

  if (!facebookUrl) {
    const discoveredFacebookUrl = await discoverProfileUrl({
      name,
      city,
      platform: "facebook",
    });
    facebookUrl = canonicalizeFacebookProfileUrl(discoveredFacebookUrl);
  }

  if (!tripadvisorUrl) {
    tripadvisorUrl = await discoverProfileUrl({ name, city, platform: "tripadvisor" });
  }

  const [facebookResult, tripadvisorResult] = await Promise.all([
    scrapeProfile(facebookUrl, "facebook"),
    scrapeProfile(tripadvisorUrl, "tripadvisor"),
  ]);

  const facebook = facebookResult.data;
  const tripadvisor = tripadvisorResult.data;

  return {
    ok: true,
    error: null,
    data: {
      email: facebook.email || tripadvisor.email || "",
      phone: facebook.phone || tripadvisor.phone || "",
      facebook,
      tripadvisor,
    },
  };
}
