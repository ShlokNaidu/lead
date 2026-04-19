import puppeteer from "puppeteer";
import * as cheerio from "cheerio";

import config from "../config.js";

const SOCIAL_HOST_RE = /(instagram|facebook|tripadvisor|tiktok|x\.com|twitter|youtube|linkedin)/i;
const CONTACT_ABOUT_HINT_RE = /(contact|about|about-us|contact-us)/i;

function normalizeUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
    return new URL(url).toString();
  } catch (_error) {
    return "";
  }
}

function extractEmails(text) {
  const matches = String(text || "").match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  return [...new Set(matches.map((email) => String(email).toLowerCase()))];
}

function extractFirstPhone(text) {
  const match = text.match(/(\+?\d[\d\s().-]{7,}\d)/);
  return match ? match[0].trim() : "";
}

function toWhatsappPhoneCandidate(value) {
  if (!value) return "";
  const digits = String(value).replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return "";
  return `+${digits}`;
}

function buildWhatsappCheckLink(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return "";
  return `https://wa.me/${digits}`;
}

function extractWhatsappPhoneFromLink(link) {
  if (!link) return "";

  try {
    const parsed = new URL(link);
    const host = parsed.hostname.toLowerCase();

    if (host.includes("wa.me")) {
      const pathValue = decodeURIComponent(parsed.pathname || "").replace(/^\//, "");
      return toWhatsappPhoneCandidate(pathValue);
    }

    if (host.includes("whatsapp.com")) {
      const queryPhone = parsed.searchParams.get("phone") || "";
      return toWhatsappPhoneCandidate(queryPhone);
    }
  } catch (_error) {
    return "";
  }

  return "";
}

function inferWhatsappStatus({ whatsappLink, phone }) {
  if (whatsappLink) return "confirmed";
  if (phone) return "likely";
  return "unknown";
}

function toAbsoluteUrl(href, baseUrl) {
  if (!href) return "";
  try {
    return new URL(href, baseUrl).toString();
  } catch (_error) {
    return "";
  }
}

function buildDeepCrawlTargets(baseUrl, resolvedLinks = [], maxPages = 4) {
  const defaults = [
    toAbsoluteUrl("/contact", baseUrl),
    toAbsoluteUrl("/about", baseUrl),
    toAbsoluteUrl("/contact-us", baseUrl),
    toAbsoluteUrl("/about-us", baseUrl),
  ].filter(Boolean);

  let host = "";
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch (_error) {
    host = "";
  }

  const discovered = resolvedLinks.filter((href) => {
    if (!CONTACT_ABOUT_HINT_RE.test(href)) {
      return false;
    }

    try {
      const parsed = new URL(href);
      return parsed.hostname.toLowerCase() === host;
    } catch (_error) {
      return false;
    }
  });

  return [...new Set([...defaults, ...discovered])]
    .filter((href) => href !== baseUrl)
    .slice(0, maxPages);
}

async function loadPage(page, url) {
  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: config.lighthouseTimeout,
    });

    const html = await page.content();

    return {
      ok: true,
      status: response ? response.status() : null,
      finalUrl: page.url(),
      html,
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      finalUrl: "",
      html: "",
      error: error.message,
    };
  }
}

function canonicalizeSocialUrl(rawUrl) {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized) return "";

  try {
    const parsed = new URL(normalized);
    const hostname = parsed.hostname.toLowerCase();
    const segments = parsed.pathname.split("/").filter(Boolean);

    if (hostname.includes("facebook.com")) {
      const blockedRoots = new Set([
        "login",
        "recover",
        "photo",
        "share",
        "sharer.php",
        "plugins",
        "dialog",
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

      if (!segments.length) return "";

      return `https://www.facebook.com/${segments.join("/")}/`;
    }

    if (hostname.includes("instagram.com")) {
      const blockedRoots = new Set(["p", "reel", "reels", "stories", "explore", "accounts"]);
      if (!segments.length || blockedRoots.has(segments[0].toLowerCase())) {
        return "";
      }
      return `https://www.instagram.com/${segments[0]}/`;
    }

    if (hostname.includes("tripadvisor.")) {
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    }

    if (hostname.includes("tiktok.com")) {
      if (!segments.length || !segments[0].startsWith("@")) {
        return "";
      }
      return `https://www.tiktok.com/${segments[0]}`;
    }

    if (hostname.includes("x.com") || hostname.includes("twitter.com")) {
      const blockedRoots = new Set(["home", "explore", "search", "i", "share"]);
      if (!segments.length || blockedRoots.has(segments[0].toLowerCase())) {
        return "";
      }
      return `https://x.com/${segments[0]}`;
    }

    if (hostname.includes("youtube.com")) {
      if (!segments.length) return "";
      const root = segments[0].toLowerCase();
      if (root === "@" && segments[1]) {
        return `https://www.youtube.com/@${segments[1]}`;
      }
      if (root.startsWith("@")) {
        return `https://www.youtube.com/${segments[0]}`;
      }
      if ((root === "channel" || root === "c" || root === "user") && segments[1]) {
        return `https://www.youtube.com/${root}/${segments[1]}`;
      }
      return "";
    }

    if (hostname.includes("linkedin.com")) {
      if (segments.length >= 2 && (segments[0] === "company" || segments[0] === "in")) {
        return `https://www.linkedin.com/${segments[0]}/${segments[1]}`;
      }
      return "";
    }

    return "";
  } catch (_error) {
    return "";
  }
}

export async function scrapeWebsite(websiteUrl, options = {}) {
  const normalizedUrl = normalizeUrl(websiteUrl);

  if (!normalizedUrl) {
    return {
      ok: false,
      error: "Invalid website URL",
      data: null,
    };
  }

  let browser;
  try {
    console.log(`[website] Scraping ${normalizedUrl}`);
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setUserAgent(config.userAgent);
    await page.setDefaultNavigationTimeout(config.lighthouseTimeout);

    const start = Date.now();
    const homePage = await loadPage(page, normalizedUrl);
    if (!homePage.ok) {
      throw new Error(homePage.error || "Failed to open website homepage");
    }

    const html = homePage.html;
    const loadTimeMs = Date.now() - start;

    const $ = cheerio.load(html);

    const title = $("title").first().text().trim();
    const description =
      $("meta[name='description']").attr("content")?.trim() || "";

    const bodyText = $("body").text().replace(/\s+/g, " ").trim();
    const links = $("a")
      .map((_i, el) => $(el).attr("href"))
      .get()
      .filter(Boolean)
      .map((href) => String(href));

    const resolvedLinks = links
      .map((href) => toAbsoluteUrl(href, homePage.finalUrl || normalizedUrl))
      .filter(Boolean);

    const emails = new Set([
      ...extractEmails(bodyText),
      ...extractEmails(html),
    ]);

    const allSocialLinks = new Set(
      resolvedLinks
        .filter((href) => SOCIAL_HOST_RE.test(href))
        .map((href) => canonicalizeSocialUrl(href))
        .filter(Boolean)
    );

    const allWhatsappLinks = new Set(
      resolvedLinks.filter((href) =>
        /(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|whatsapp\.com\/send)/i.test(href)
      )
    );

    let resolvedPhone = extractFirstPhone(bodyText);
    const deepCrawlEnabled =
      typeof options.deepCrawlEnabled === "boolean"
        ? options.deepCrawlEnabled
        : config.websiteDeepCrawlEnabled !== false;
    const deepCrawlMaxPages = Math.max(
      0,
      Number(options.deepCrawlMaxPages) || Number(config.websiteDeepCrawlMaxPages) || 4,
    );

    let hasMenuPage = links.some((href) => href.toLowerCase().includes("menu"));
    let hasReservationFlow =
      links.some((href) => href.toLowerCase().includes("reserv")) ||
      bodyText.toLowerCase().includes("book a table") ||
      bodyText.toLowerCase().includes("reservation");
    let hasOnlineOrdering =
      bodyText.toLowerCase().includes("order online") ||
      bodyText.toLowerCase().includes("delivery") ||
      links.some((href) => href.toLowerCase().includes("order"));

    if (deepCrawlEnabled) {
      const deepTargets = buildDeepCrawlTargets(
        homePage.finalUrl || normalizedUrl,
        resolvedLinks,
        deepCrawlMaxPages,
      );

      for (const target of deepTargets) {
        // eslint-disable-next-line no-await-in-loop
        const deepPage = await loadPage(page, target);
        if (!deepPage.ok) {
          continue;
        }

        const deep$ = cheerio.load(deepPage.html);
        const deepBody = deep$("body").text().replace(/\s+/g, " ").trim();
        const deepLinks = deep$("a")
          .map((_i, el) => deep$(el).attr("href"))
          .get()
          .filter(Boolean)
          .map((href) => String(href));
        const deepResolvedLinks = deepLinks
          .map((href) => toAbsoluteUrl(href, deepPage.finalUrl || target))
          .filter(Boolean);

        for (const email of [...extractEmails(deepBody), ...extractEmails(deepPage.html)]) {
          emails.add(email);
        }

        if (!resolvedPhone) {
          resolvedPhone = extractFirstPhone(deepBody);
        }

        deepResolvedLinks
          .filter((href) => SOCIAL_HOST_RE.test(href))
          .map((href) => canonicalizeSocialUrl(href))
          .filter(Boolean)
          .forEach((href) => allSocialLinks.add(href));

        deepResolvedLinks
          .filter((href) =>
            /(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|whatsapp\.com\/send)/i.test(href)
          )
          .forEach((href) => allWhatsappLinks.add(href));

        hasMenuPage = hasMenuPage || deepLinks.some((href) => href.toLowerCase().includes("menu"));
        hasReservationFlow =
          hasReservationFlow ||
          deepLinks.some((href) => href.toLowerCase().includes("reserv")) ||
          deepBody.toLowerCase().includes("book a table") ||
          deepBody.toLowerCase().includes("reservation");
        hasOnlineOrdering =
          hasOnlineOrdering ||
          deepBody.toLowerCase().includes("order online") ||
          deepBody.toLowerCase().includes("delivery") ||
          deepLinks.some((href) => href.toLowerCase().includes("order"));
      }
    }

    const whatsappLink = [...allWhatsappLinks][0] || "";
    const email = [...emails][0] || "";
    const phone = resolvedPhone;
    const socialLinks = [...allSocialLinks];

    const absoluteLinks = resolvedLinks
      .filter((href) => href.startsWith("http"))
      .slice(0, 20);

    const linkCheckPage = await browser.newPage();
    await linkCheckPage.setUserAgent(config.userAgent);
    await linkCheckPage.setDefaultNavigationTimeout(10000);

    let brokenLinks = 0;
    for (const href of absoluteLinks) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await linkCheckPage.goto(href, {
          waitUntil: "domcontentloaded",
          timeout: 10000,
        });
        if (!response || response.status() >= 400) {
          brokenLinks += 1;
        }
      } catch (_error) {
        brokenLinks += 1;
      }
    }

    await linkCheckPage.close().catch(() => {
      console.warn("[website] Link-check page close failed");
    });

    const whatsappPhone =
      extractWhatsappPhoneFromLink(whatsappLink) || toWhatsappPhoneCandidate(phone);
    const whatsappCheckLink = buildWhatsappCheckLink(whatsappPhone);
    const whatsappStatus = inferWhatsappStatus({
      whatsappLink,
      phone: whatsappPhone || phone,
    });

    const data = {
      url: normalizedUrl,
      title,
      description,
      loadTimeMs,
      hasMenuPage,
      hasReservationFlow,
      hasOnlineOrdering,
      whatsappLink,
      whatsappPhone,
      whatsappCheckLink,
      whatsappStatus,
      socialLinks: [...new Set(socialLinks)],
      brokenLinks,
      email,
      phone,
    };

    return { ok: true, error: null, data };
  } catch (error) {
    console.error("[website] Failed to scrape website:", error.message);
    return {
      ok: false,
      error: error.message,
      data: null,
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {
        console.warn("[website] Browser close failed");
      });
    }
  }
}
