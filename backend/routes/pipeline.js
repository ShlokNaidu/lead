import express from "express";

import config from "../config.js";
import Lead from "../models/Lead.js";
import { scrapeGoogleMapsLeads } from "../scrapers/googleMaps.js";
import { scrapeWebsite } from "../scrapers/website.js";
import { scrapeExternalProfiles } from "../scrapers/externalProfiles.js";
import { runLighthouseAudit } from "../auditors/lighthouse.js";
import { detectIssues } from "../auditors/issueDetector.js";
import { generateOutreach } from "../ai/outreach.js";

const router = express.Router();

const pipelineState = {
  running: false,
  startedAt: null,
  query: "",
  city: "",
  maxResults: 0,
  deepCrawlEnabled: null,
  stats: null,
  lastRun: null,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return "";
  return digits;
}

function normalizeWebsite(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${host}${path}`;
  } catch (_error) {
    return "";
  }
}

function buildLeadKeys(lead) {
  const name = normalizeText(lead?.name);
  const city = normalizeText(lead?.city);
  const phone = normalizePhone(lead?.phone);
  const website = normalizeWebsite(lead?.website);

  const keys = [];

  if (name && city) {
    keys.push(`name_city::${name}::${city}`);
  }

  if (name && phone) {
    keys.push(`name_phone::${name}::${phone}`);
  }

  if (name && website) {
    keys.push(`name_website::${name}::${website}`);
  }

  return keys;
}

function buildWhatsappCheckLink(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? `https://wa.me/${digits}` : "";
}

router.get("/status", (_req, res) => {
  return res.json({
    running: pipelineState.running,
    startedAt: pipelineState.startedAt,
    query: pipelineState.query,
    city: pipelineState.city,
    maxResults: pipelineState.maxResults,
    deepCrawlEnabled: pipelineState.deepCrawlEnabled,
    stats: pipelineState.stats,
    lastRun: pipelineState.lastRun,
  });
});

router.post("/run", async (req, res) => {
  const startedAt = new Date();
  const {
    query = "restaurants",
    city = "",
    maxResults,
    deepCrawlEnabled,
  } = req.body || {};
  const normalizedDeepCrawlEnabled =
    typeof deepCrawlEnabled === "boolean"
      ? deepCrawlEnabled
      : config.websiteDeepCrawlEnabled !== false;
  const normalizedMaxResults = Math.min(
    Math.max(Number(maxResults) || config.maxLeadsPerRun, 1),
    config.maxLeadsPerRun,
  );
  const fetchMaxResults = Math.min(
    config.maxLeadsPerRun,
    Math.max(normalizedMaxResults * 2, normalizedMaxResults + 3),
  );

  if (pipelineState.running) {
    return res.status(409).json({
      error: "Pipeline is already running",
      status: {
        running: pipelineState.running,
        startedAt: pipelineState.startedAt,
        query: pipelineState.query,
        city: pipelineState.city,
        maxResults: pipelineState.maxResults,
        deepCrawlEnabled: pipelineState.deepCrawlEnabled,
        stats: pipelineState.stats,
      },
    });
  }

  pipelineState.running = true;
  pipelineState.startedAt = startedAt.toISOString();
  pipelineState.query = query;
  pipelineState.city = city;
  pipelineState.maxResults = normalizedMaxResults;
  pipelineState.deepCrawlEnabled = normalizedDeepCrawlEnabled;
  pipelineState.stats = null;

  try {
    console.log(
      `[pipeline] Run started for query=${query}, city=${city}, deepCrawlEnabled=${normalizedDeepCrawlEnabled}`,
    );

    const mapsResult = await scrapeGoogleMapsLeads({
      query,
      city,
      maxResults: fetchMaxResults,
    });

    if (!mapsResult.ok) {
      console.error("[pipeline] Google Maps scrape failed", mapsResult.error);
      return res.status(500).json({
        error: "Failed to scrape leads from Google Maps",
        details: mapsResult.error,
      });
    }

    const seenCandidateKeys = new Set();
    const candidateLeads = mapsResult.data.filter((lead) => {
      const keys = buildLeadKeys(lead);
      if (!keys.length) return false;
      if (keys.some((key) => seenCandidateKeys.has(key))) return false;
      keys.forEach((key) => seenCandidateKeys.add(key));
      return true;
    });

    const existingLeadRows = await Lead.find(
      {},
      { name: 1, city: 1, phone: 1, website: 1, _id: 0 }
    ).lean();

    const existingLeadKeys = new Set(
      existingLeadRows.flatMap((lead) => buildLeadKeys(lead))
    );

    const nonExistingLeads = candidateLeads.filter(
      (lead) => {
        const keys = buildLeadKeys(lead);
        if (!keys.length) return false;
        if (keys.some((key) => existingLeadKeys.has(key))) {
          return false;
        }

        keys.forEach((key) => existingLeadKeys.add(key));
        return true;
      }
    );

    const leadsToProcess = nonExistingLeads.slice(0, normalizedMaxResults);

    const runStats = {
      requested: normalizedMaxResults,
      sourced: candidateLeads.length,
      discovered: leadsToProcess.length,
      skippedExisting: candidateLeads.length - nonExistingLeads.length,
      shortfall: Math.max(0, normalizedMaxResults - leadsToProcess.length),
      exhaustedAllExisting: nonExistingLeads.length === 0,
      processed: 0,
      saved: 0,
      qualified: 0,
      failed: 0,
      errors: [],
    };

    if (runStats.shortfall > 0) {
      console.warn(
        `[pipeline] Could not find enough fresh leads. requested=${normalizedMaxResults}, availableFresh=${leadsToProcess.length}`,
      );
    }

    pipelineState.stats = runStats;

    if (nonExistingLeads.length === 0) {
      console.log(
        `[pipeline] No fresh leads found for query=${query}, city=${city}. All ${candidateLeads.length} candidates already exist.`,
      );

      pipelineState.lastRun = {
        success: true,
        query,
        city,
        deepCrawlEnabled: normalizedDeepCrawlEnabled,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        stats: runStats,
      };

      return res.json({
        success: true,
        query,
        city,
        deepCrawlEnabled: normalizedDeepCrawlEnabled,
        startedAt,
        finishedAt: new Date(),
        stats: runStats,
      });
    }

    for (const rawLead of leadsToProcess) {
      try {
        console.log(`[pipeline] Processing lead ${rawLead.name}`);

        const websiteResult = rawLead.website
          ? await scrapeWebsite(rawLead.website, {
              deepCrawlEnabled: normalizedDeepCrawlEnabled,
            })
          : { ok: false, data: null, error: "No website found" };

        const websiteSocialLinks = websiteResult.data?.socialLinks || [];
        const hasProfileHints = websiteSocialLinks.some((link) =>
          /(facebook|tripadvisor)/i.test(String(link))
        );
        const missingPrimaryContacts =
          !rawLead.phone && !websiteResult.data?.phone && !websiteResult.data?.email;

        const externalProfilesResult = hasProfileHints || missingPrimaryContacts
          ? await scrapeExternalProfiles({
              name: rawLead.name,
              city: rawLead.city,
              socialLinks: websiteSocialLinks,
            })
          : {
              ok: false,
              error: null,
              data: {
                email: "",
                phone: "",
                facebook: {
                  platform: "facebook",
                  url: "",
                  email: "",
                  phone: "",
                  scrapedAt: null,
                },
                tripadvisor: {
                  platform: "tripadvisor",
                  url: "",
                  email: "",
                  phone: "",
                  scrapedAt: null,
                },
              },
            };

        const externalEmail = externalProfilesResult.data?.email || "";
        const externalPhone = externalProfilesResult.data?.phone || "";
        const resolvedPhone =
          rawLead.phone || websiteResult.data?.phone || externalPhone || "";
        const resolvedWhatsappLink = websiteResult.data?.whatsappLink || "";
        const resolvedPhoneDigits = String(resolvedPhone || "").replace(/\D/g, "");
        const resolvedWhatsappPhone =
          websiteResult.data?.whatsappPhone ||
          (resolvedPhoneDigits.length >= 8 ? `+${resolvedPhoneDigits}` : "");
        const resolvedWhatsappCheckLink =
          websiteResult.data?.whatsappCheckLink || buildWhatsappCheckLink(resolvedWhatsappPhone);
        const resolvedWhatsappStatus = resolvedWhatsappLink
          ? "confirmed"
          : resolvedWhatsappPhone
            ? "likely"
            : "unknown";

        const lighthouseResult = websiteResult.ok
          ? await runLighthouseAudit(websiteResult.data.url)
          : { ok: false, data: null, error: "Skipped audit due to missing website" };

        const issueResult = detectIssues({
          websiteData: websiteResult.data,
          lighthouseData: lighthouseResult.data,
        });

        const aiResult = await generateOutreach(
          {
            ...rawLead,
            websiteSnapshot: websiteResult.data,
            audit: lighthouseResult.data,
            opportunityScore: issueResult.opportunityScore,
            externalProfiles: externalProfilesResult.data,
            email: websiteResult.data?.email || externalEmail || "",
            phone: resolvedPhone,
            whatsappLink: resolvedWhatsappLink,
          },
          issueResult.issues
        );

        const aiScore =
          typeof aiResult.opportunityScore === "number"
            ? aiResult.opportunityScore
            : issueResult.opportunityScore;

        const opportunityScore = Math.max(0, Math.min(100, aiScore));
        const autoQualified = opportunityScore >= 65;
        let stage = "discovered";
        const stageHistory = [{ stage: "discovered", note: "Lead discovered" }];

        if (autoQualified) {
          stage = "qualified";
          stageHistory.push({
            stage: "qualified",
            note: "Auto-qualified by pipeline opportunity scoring",
            date: new Date(),
          });
          runStats.qualified += 1;
        }

        const updateDoc = {
          name: rawLead.name,
          city: rawLead.city,
          address: rawLead.address || "",
          website: rawLead.website || "",
          phone:
            resolvedPhone,
          email: websiteResult.data?.email || externalEmail || "",
          googleMapsUrl: rawLead.googleMapsUrl || "",
          rating: rawLead.rating || 0,
          reviewCount: rawLead.reviewCount || 0,
          websiteSnapshot: {
            title: websiteResult.data?.title || "",
            description: websiteResult.data?.description || "",
            hasMenuPage: Boolean(websiteResult.data?.hasMenuPage),
            hasReservationFlow: Boolean(websiteResult.data?.hasReservationFlow),
            hasOnlineOrdering: Boolean(websiteResult.data?.hasOnlineOrdering),
            whatsappLink: resolvedWhatsappLink,
            whatsappPhone: resolvedWhatsappPhone,
            whatsappCheckLink: resolvedWhatsappCheckLink,
            whatsappStatus: resolvedWhatsappStatus,
            socialLinks: websiteResult.data?.socialLinks || [],
            brokenLinks: websiteResult.data?.brokenLinks || 0,
          },
          externalProfiles: {
            facebook: {
              url: externalProfilesResult.data?.facebook?.url || "",
              email: externalProfilesResult.data?.facebook?.email || "",
              phone: externalProfilesResult.data?.facebook?.phone || "",
              scrapedAt: externalProfilesResult.data?.facebook?.scrapedAt || null,
            },
            tripadvisor: {
              url: externalProfilesResult.data?.tripadvisor?.url || "",
              email: externalProfilesResult.data?.tripadvisor?.email || "",
              phone: externalProfilesResult.data?.tripadvisor?.phone || "",
              scrapedAt: externalProfilesResult.data?.tripadvisor?.scrapedAt || null,
            },
          },
          audit: {
            performanceScore: lighthouseResult.data?.performanceScore ?? null,
            accessibilityScore: lighthouseResult.data?.accessibilityScore ?? null,
            bestPracticesScore: lighthouseResult.data?.bestPracticesScore ?? null,
            seoScore: lighthouseResult.data?.seoScore ?? null,
            firstContentfulPaint: lighthouseResult.data?.fcp ?? null,
            largestContentfulPaint: lighthouseResult.data?.lcp ?? null,
            cumulativeLayoutShift: lighthouseResult.data?.cls ?? null,
            totalBlockingTime: lighthouseResult.data?.tbt ?? null,
            auditedAt: lighthouseResult.data?.auditedAt || null,
          },
          detectedIssues: issueResult.issues,
          opportunityScore,
          scoreReason:
            aiResult.quickScoreReason || aiResult.scoreReason || issueResult.summary,
          outreach: {
            recommendedChannel: aiResult.recommendedChannel || "cold_email",
            channelReason: aiResult.channelReason || "",
            quickScore10:
              typeof aiResult.quickScore10 === "number" ? aiResult.quickScore10 : null,
            quickScoreReason: aiResult.quickScoreReason || "",
            topProblemsDetailed: aiResult.topProblemsDetailed || [],
            outreachMessage: aiResult.outreachMessage || "",
            followUpHook: aiResult.followUpHook || "",
            detailedAnalysis: aiResult.detailedAnalysis || "",
            generatedAt: new Date(),
          },
          stage,
          stageHistory,
          updatedAt: new Date(),
          source: "google_maps",
        };

        const savedLead = await Lead.create(updateDoc);

        if (!savedLead) {
          throw new Error("Lead upsert returned null");
        }

        runStats.processed += 1;
        runStats.saved += 1;

        await sleep(config.scrapeDelay);
      } catch (leadError) {
        if (leadError?.code === 11000) {
          runStats.skippedExisting += 1;
          console.log(`[pipeline] Skipping existing lead ${rawLead?.name || "unknown"}`);
          continue;
        }

        runStats.failed += 1;
        runStats.errors.push({
          lead: rawLead?.name || "unknown",
          error: leadError.message,
        });
        console.error("[pipeline] Lead processing failed:", leadError.message);
      }
    }

    console.log("[pipeline] Run completed", runStats);

    pipelineState.lastRun = {
      success: true,
      query,
      city,
      deepCrawlEnabled: normalizedDeepCrawlEnabled,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      stats: runStats,
    };

    return res.json({
      success: true,
      query,
      city,
      deepCrawlEnabled: normalizedDeepCrawlEnabled,
      startedAt,
      finishedAt: new Date(),
      stats: runStats,
    });
  } catch (error) {
    console.error("[pipeline] Run failed:", error.message);

    pipelineState.lastRun = {
      success: false,
      query,
      city,
      deepCrawlEnabled: normalizedDeepCrawlEnabled,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      stats: pipelineState.stats,
      error: error.message,
    };

    return res.status(500).json({
      success: false,
      error: "Pipeline run failed",
      details: error.message,
    });
  } finally {
    pipelineState.running = false;
    pipelineState.startedAt = null;
    pipelineState.query = "";
    pipelineState.city = "";
    pipelineState.maxResults = 0;
    pipelineState.deepCrawlEnabled = null;
    pipelineState.stats = null;
  }
});

export default router;
