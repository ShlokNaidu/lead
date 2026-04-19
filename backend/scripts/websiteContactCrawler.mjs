import fs from "node:fs/promises";
import path from "node:path";

import * as cheerio from "cheerio";
import mongoose from "mongoose";
import puppeteer from "puppeteer";

import config from "../config.js";
import Lead from "../models/Lead.js";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const WHATSAPP_RE = /(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|whatsapp\.com\/send)/i;
const SOCIAL_RE = /(instagram|facebook|tripadvisor|tiktok|x\.com|twitter|youtube|linkedin)/i;

function parseArgs(argv) {
  const args = {
    url: "",
    urls: "",
    fromDb: false,
    limit: 10,
    out: "",
  };

  for (const token of argv) {
    if (token === "--from-db") {
      args.fromDb = true;
      continue;
    }

    if (token.startsWith("--url=")) {
      args.url = token.slice("--url=".length).trim();
      continue;
    }

    if (token.startsWith("--urls=")) {
      args.urls = token.slice("--urls=".length).trim();
      continue;
    }

    if (token.startsWith("--limit=")) {
      const raw = Number(token.slice("--limit=".length));
      if (!Number.isNaN(raw) && raw > 0) {
        args.limit = Math.floor(raw);
      }
      continue;
    }

    if (token.startsWith("--out=")) {
      args.out = token.slice("--out=".length).trim();
    }
  }

  return args;
}

function normalizeUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const safe = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    return new URL(safe).toString();
  } catch (_error) {
    return "";
  }
}

function toAbsoluteUrl(href, baseUrl) {
  if (!href) return "";
  try {
    return new URL(href, baseUrl).toString();
  } catch (_error) {
    return "";
  }
}

function cleanEmail(value) {
  return String(value || "")
    .trim()
    .replace(/^mailto:/i, "")
    .replace(/[),.;:\]}>]+$/g, "")
    .toLowerCase();
}

function extractEmailsFromString(text) {
  const matches = String(text || "").match(EMAIL_RE) || [];
  return matches.map(cleanEmail).filter(Boolean);
}

function collectEmails($, html) {
  const mailtoEmails = $("a[href^='mailto:']")
    .map((_i, el) => cleanEmail($(el).attr("href")))
    .get()
    .filter(Boolean);

  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const textEmails = extractEmailsFromString(bodyText);
  const htmlEmails = extractEmailsFromString(html);

  return [...new Set([...mailtoEmails, ...textEmails, ...htmlEmails])];
}

function collectWhatsappLinks($, baseUrl) {
  const rawLinks = $("a")
    .map((_i, el) => String($(el).attr("href") || ""))
    .get();

  const links = rawLinks
    .map((href) => toAbsoluteUrl(href, baseUrl))
    .filter(Boolean)
    .filter((href) => WHATSAPP_RE.test(href));

  return [...new Set(links)];
}

function collectSocialLinks($, baseUrl) {
  const rawLinks = $("a")
    .map((_i, el) => String($(el).attr("href") || ""))
    .get();

  const links = rawLinks
    .map((href) => toAbsoluteUrl(href, baseUrl))
    .filter(Boolean)
    .filter((href) => SOCIAL_RE.test(href));

  return [...new Set(links)];
}

function collectContactAboutCandidates($, baseUrl) {
  let baseHost = "";
  try {
    baseHost = new URL(baseUrl).hostname.toLowerCase();
  } catch (_error) {
    return [];
  }

  const rawLinks = $("a")
    .map((_i, el) => String($(el).attr("href") || ""))
    .get();

  const candidates = rawLinks
    .map((href) => toAbsoluteUrl(href, baseUrl))
    .filter(Boolean)
    .filter((href) => {
      try {
        const parsed = new URL(href);
        const sameHost = parsed.hostname.toLowerCase() === baseHost;
        const pathName = parsed.pathname.toLowerCase();
        const isContactAbout =
          pathName.includes("contact") ||
          pathName.includes("about") ||
          pathName.includes("about-us") ||
          pathName.includes("contact-us");
        return sameHost && isContactAbout;
      } catch (_error) {
        return false;
      }
    });

  return [...new Set(candidates)].slice(0, 4);
}

function defaultCrawlTargets(baseUrl) {
  const candidates = [
    baseUrl,
    toAbsoluteUrl("/contact", baseUrl),
    toAbsoluteUrl("/about", baseUrl),
    toAbsoluteUrl("/contact-us", baseUrl),
    toAbsoluteUrl("/about-us", baseUrl),
  ].filter(Boolean);

  return [...new Set(candidates)];
}

async function openAndRead(page, url) {
  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 25000,
    });

    const html = await page.content();

    return {
      ok: true,
      url,
      status: response ? response.status() : null,
      finalUrl: page.url(),
      html,
    };
  } catch (error) {
    return {
      ok: false,
      url,
      status: null,
      finalUrl: "",
      html: "",
      error: error.message,
    };
  }
}

async function crawlWebsite(browser, website) {
  const normalized = normalizeUrl(website);
  if (!normalized) {
    return {
      ok: false,
      error: "Invalid URL",
      pages: [],
      emails: [],
      whatsappLinks: [],
      socialLinks: [],
    };
  }

  const page = await browser.newPage();
  await page.setUserAgent(config.userAgent);

  const baseRead = await openAndRead(page, normalized);

  let visitTargets = defaultCrawlTargets(normalized);
  if (baseRead.ok) {
    const $ = cheerio.load(baseRead.html);
    const discovered = collectContactAboutCandidates($, normalized);
    visitTargets = [...new Set([...visitTargets, ...discovered])];
  }

  const pages = [];
  const emails = new Set();
  const whatsappLinks = new Set();
  const socialLinks = new Set();

  for (const target of visitTargets) {
    const readResult = target === normalized ? baseRead : await openAndRead(page, target);

    pages.push({
      url: readResult.url,
      status: readResult.status,
      finalUrl: readResult.finalUrl,
      ok: readResult.ok,
      error: readResult.ok ? "" : readResult.error || "Unknown error",
    });

    if (!readResult.ok) {
      continue;
    }

    const $ = cheerio.load(readResult.html);

    for (const email of collectEmails($, readResult.html)) {
      emails.add(email);
    }

    for (const link of collectWhatsappLinks($, readResult.url)) {
      whatsappLinks.add(link);
    }

    for (const link of collectSocialLinks($, readResult.url)) {
      socialLinks.add(link);
    }
  }

  await page.close();

  return {
    ok: true,
    error: "",
    pages,
    emails: [...emails],
    whatsappLinks: [...whatsappLinks],
    socialLinks: [...socialLinks],
  };
}

async function loadTargets(args) {
  if (args.url) {
    return [
      {
        id: "manual-1",
        name: "Manual URL",
        city: "",
        website: args.url,
      },
    ];
  }

  if (args.urls) {
    return args.urls
      .split(",")
      .map((value, index) => value.trim())
      .filter(Boolean)
      .map((website, index) => ({
        id: `manual-${index + 1}`,
        name: `Manual URL ${index + 1}`,
        city: "",
        website,
      }));
  }

  if (!args.fromDb) {
    throw new Error("Provide --url, --urls, or --from-db");
  }

  await mongoose.connect(config.mongoUri);

  const leads = await Lead.find(
    { website: { $exists: true, $ne: "" } },
    { name: 1, city: 1, website: 1 }
  )
    .sort({ updatedAt: -1 })
    .limit(args.limit)
    .lean();

  return leads.map((lead) => ({
    id: String(lead._id),
    name: lead.name || "",
    city: lead.city || "",
    website: lead.website || "",
  }));
}

function buildOutputPath(rawOut) {
  if (rawOut) {
    return path.resolve(rawOut);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve(`reports/website-contact-crawl-${stamp}.json`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const targets = await loadTargets(args);

  if (!targets.length) {
    throw new Error("No targets found to crawl");
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const results = [];

  try {
    for (const target of targets) {
      // eslint-disable-next-line no-console
      console.log(`[crawl] ${target.name} -> ${target.website}`);

      // eslint-disable-next-line no-await-in-loop
      const crawl = await crawlWebsite(browser, target.website);

      results.push({
        id: target.id,
        name: target.name,
        city: target.city,
        website: target.website,
        crawl,
      });
    }
  } finally {
    await browser.close();
  }

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  const summary = {
    scanned: results.length,
    withEmail: results.filter((r) => r.crawl.emails.length > 0).length,
    withWhatsapp: results.filter((r) => r.crawl.whatsappLinks.length > 0).length,
    withSocials: results.filter((r) => r.crawl.socialLinks.length > 0).length,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    mode: args.fromDb ? "from-db" : "manual",
    summary,
    results,
  };

  const outPath = buildOutputPath(args.out);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf8");

  // eslint-disable-next-line no-console
  console.log("[crawl] Completed");
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));
  // eslint-disable-next-line no-console
  console.log(`[crawl] Report: ${outPath}`);
}

main().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error("[crawl] Failed:", error.message || error);

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  process.exit(1);
});
