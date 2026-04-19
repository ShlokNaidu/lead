import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { jsonrepair } from "jsonrepair";

import config from "../config.js";

const genAI = config.geminiApiKey
  ? new GoogleGenerativeAI(config.geminiApiKey)
  : null;

const OUTREACH_JSON_SHAPE = `{
  "quickScore10": number,
  "quickScoreReason": "...",
  "opportunityScore": number,
  "topProblemsDetailed": [
    {
      "title": "...",
      "what": "...",
      "whoItLoses": "...",
      "revenueImpact": "..."
    }
  ],
  "recommendedChannel": "instagram_dm | cold_email",
  "channelReason": "...",
  "outreachMessage": "...",
  "followUpHook": "..."
}`;

const TOP_PROBLEM_SCHEMA = {
  type: SchemaType.OBJECT,
  required: ["title", "what", "whoItLoses", "revenueImpact"],
  properties: {
    title: { type: SchemaType.STRING },
    what: { type: SchemaType.STRING },
    whoItLoses: { type: SchemaType.STRING },
    revenueImpact: { type: SchemaType.STRING },
  },
};

const OUTREACH_RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  required: [
    "quickScore10",
    "quickScoreReason",
    "opportunityScore",
    "topProblemsDetailed",
    "recommendedChannel",
    "channelReason",
    "outreachMessage",
    "followUpHook",
  ],
  properties: {
    quickScore10: { type: SchemaType.NUMBER },
    quickScoreReason: { type: SchemaType.STRING },
    opportunityScore: { type: SchemaType.NUMBER },
    topProblemsDetailed: {
      type: SchemaType.ARRAY,
      items: TOP_PROBLEM_SCHEMA,
    },
    recommendedChannel: { type: SchemaType.STRING },
    channelReason: { type: SchemaType.STRING },
    outreachMessage: { type: SchemaType.STRING },
    followUpHook: { type: SchemaType.STRING },
  },
};

function truncateText(value, maxLength = 220) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.length > maxLength
    ? `${trimmed.slice(0, maxLength - 3)}...`
    : trimmed;
}

function toCleanString(value, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function toScore100(value, fallback = 50) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const normalized = numeric <= 10 ? numeric * 10 : numeric;
  return Math.max(0, Math.min(100, Math.round(normalized)));
}

function toScore10(value, fallback = 5) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const normalized = numeric > 10 ? numeric / 10 : numeric;
  return Math.max(1, Math.min(10, Math.round(normalized)));
}

function normalizeChannel(value, fallback = "cold_email") {
  const raw = toCleanString(value, fallback).toLowerCase();

  if (/(instagram|insta|dm)/i.test(raw)) {
    return "instagram_dm";
  }

  if (/(email|mail)/i.test(raw)) {
    return "cold_email";
  }

  return fallback;
}

function parseGeminiJson(text) {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const candidates = [cleaned];
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(cleaned.slice(firstBrace, lastBrace + 1));
  }

  let lastError = null;

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      try {
        const repaired = jsonrepair(candidate);
        return JSON.parse(repaired);
      } catch (repairError) {
        lastError = repairError;
      }
    }
  }

  throw lastError || new Error("Gemini response did not contain valid JSON");
}

function extractInstagramInfo(socialLinks = []) {
  const instagramUrl = (socialLinks || []).find((link) => /instagram\.com/i.test(link)) || "";

  if (!instagramUrl) {
    return { instagramUrl: "", instagramHandle: "" };
  }

  try {
    const parsed = new URL(instagramUrl);
    const handle = parsed.pathname.replace(/^\/+/, "").split("/")[0];
    return {
      instagramUrl,
      instagramHandle: handle ? `@${handle}` : "",
    };
  } catch (_error) {
    return {
      instagramUrl,
      instagramHandle: "",
    };
  }
}

function isSocialWebsite(url) {
  const value = toCleanString(url).toLowerCase();
  return /(instagram\.com|facebook\.com|tripadvisor\.|tiktok\.com|x\.com|twitter\.com)/i.test(value);
}

function collectOutreachSocialLinks(lead) {
  const links = [
    ...(lead?.websiteSnapshot?.socialLinks || []),
  ];

  if (isSocialWebsite(lead?.website)) {
    links.push(lead.website);
  }

  if (lead?.externalProfiles?.facebook?.url) {
    links.push(lead.externalProfiles.facebook.url);
  }

  if (lead?.externalProfiles?.tripadvisor?.url) {
    links.push(lead.externalProfiles.tripadvisor.url);
  }

  return [...new Set(links.map((link) => toCleanString(link)).filter(Boolean))];
}

function inferFallbackChannel(snapshot) {
  const hasEmail = Boolean(snapshot.email);
  const hasInstagram = Boolean(snapshot.instagramHandle || snapshot.instagramUrl);

  if (!hasEmail && hasInstagram) return "instagram_dm";
  if (hasEmail) return "cold_email";
  if (hasInstagram) return "instagram_dm";
  return "cold_email";
}

function normalizeProblemDetails(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;

  const cleaned = value
    .map((item) => ({
      title: toCleanString(item?.title),
      what: toCleanString(item?.what),
      whoItLoses: toCleanString(item?.whoItLoses),
      revenueImpact: toCleanString(item?.revenueImpact),
    }))
    .filter(
      (item) => item.title && item.what && item.whoItLoses && item.revenueImpact
    );

  return cleaned.length > 0 ? cleaned.slice(0, 3) : fallback;
}

function ensureColdEmailShape(message, restaurantName, city) {
  const trimmed = toCleanString(message);
  const hasSubject = /^subject\s*:/im.test(trimmed);
  const safeName = toCleanString(restaurantName, "your restaurant");
  const safeCity = toCleanString(city, "your city");

  if (!trimmed) {
    return `Subject: Small conversion leak for ${safeName}\n\nQuick note from someone who studies local restaurant funnels in ${safeCity}: your mobile path to booking/order likely loses high-intent diners in the first few seconds. If useful, I can share a compact before/after benchmark from similar restaurants nearby. Would you like me to send it?`;
  }

  if (hasSubject) {
    return trimmed;
  }

  return `Subject: Quick note for ${safeName}\n\n${trimmed}`;
}

function composeDetailedAnalysis(normalized) {
  const problemLines = normalized.topProblemsDetailed
    .slice(0, 3)
    .map(
      (problem, index) =>
        `#${index + 1} - ${problem.title}\nWhat: ${problem.what}\nWho it loses: ${problem.whoItLoses}\nRevenue impact: ${problem.revenueImpact}`,
    )
    .join("\n\n");

  const channelLabel =
    normalized.recommendedChannel === "instagram_dm" ? "Instagram DM" : "Cold Email";

  return [
    "[QUICK SCORE]",
    `Overall Opportunity Score: ${normalized.quickScore10}/10`,
    `Reason: ${normalized.quickScoreReason}`,
    "",
    "[TOP 3 PROBLEMS]",
    problemLines || "No strong issues detected.",
    "",
    "[RECOMMENDED CHANNEL]",
    channelLabel,
    `Why: ${normalized.channelReason}`,
    "",
    "[OUTREACH MESSAGE]",
    normalized.outreachMessage,
    "",
    "[FOLLOW-UP HOOK]",
    `If they reply positively, your next message should mention: ${normalized.followUpHook}`,
  ].join("\n");
}

function buildLeadSnapshot(lead, issues) {
  const socialLinks = collectOutreachSocialLinks(lead);
  const instagram = extractInstagramInfo(socialLinks);
  const whatsappLink = toCleanString(lead?.websiteSnapshot?.whatsappLink);
  const hasWhatsApp =
    Boolean(whatsappLink) ||
    socialLinks.some((link) => /(whatsapp|wa\.me)/i.test(String(link)));

  return {
    name: toCleanString(lead?.name, "Unknown restaurant"),
    city: toCleanString(lead?.city, "Unknown city"),
    country: toCleanString(lead?.country, "Unknown"),
    rating: Number.isFinite(Number(lead?.rating)) ? Number(lead.rating) : null,
    reviewCount: Number.isFinite(Number(lead?.reviewCount))
      ? Number(lead.reviewCount)
      : null,
    websiteUrl: toCleanString(lead?.website),
    email: toCleanString(lead?.email),
    phone: toCleanString(lead?.phone),
    instagramUrl: instagram.instagramUrl,
    instagramHandle: instagram.instagramHandle,
    instagramFollowers: null,
    daysSinceLastPost: null,
    mobileSpeed: lead?.audit?.performanceScore ?? null,
    desktopSpeed: null,
    hasOnlineMenu: Boolean(lead?.websiteSnapshot?.hasMenuPage),
    menuType: lead?.websiteSnapshot?.hasMenuPage ? "menu-page-detected" : "no menu",
    hasOnlineBooking: Boolean(lead?.websiteSnapshot?.hasReservationFlow),
    hasOnlineOrdering: Boolean(lead?.websiteSnapshot?.hasOnlineOrdering),
    hasWhatsAppButton: hasWhatsApp,
    whatsappLink,
    websiteLanguage: "Unknown",
    primaryTouristArea: null,
    issues: Array.isArray(issues) ? issues : [],
  };
}

function buildFallback(lead, issues) {
  const snapshot = buildLeadSnapshot(lead, issues);
  const recommendedChannel = inferFallbackChannel(snapshot);
  const quickScore10 = toScore10(lead?.opportunityScore, 6);
  const opportunityScore = quickScore10 * 10;

  const topProblemsDetailed = (snapshot.issues || [])
    .slice(0, 3)
    .map((problem, index) => ({
      title: `Priority gap ${index + 1}`,
      what: toCleanString(problem, "Key conversion blocker detected."),
      whoItLoses: "high-intent local diners",
      revenueImpact: "estimated 8-15 lost visits per week",
    }));

  const fallbackMessage =
    recommendedChannel === "instagram_dm"
      ? `${snapshot.name} has strong local demand, but your current digital path likely drops ready-to-book diners before they act. I can share one concrete fix that usually lifts bookings quickly for similar places in ${snapshot.city}. Want me to send that quick breakdown here?`
      : `Subject: Quick conversion leak at ${snapshot.name}\n\nYour local reputation is strong, but the current booking/order path likely causes mobile drop-off before intent turns into reservations. I can share one focused benchmark from restaurants in ${snapshot.city} that improved this quickly without changing their brand voice. Want me to send the short comparison?`;

  const normalized = {
    quickScore10,
    quickScoreReason:
      "Fallback audit generated because model output could not be parsed consistently.",
    opportunityScore,
    topProblemsDetailed: topProblemsDetailed.length
      ? topProblemsDetailed
      : [
          {
            title: "Conversion path friction",
            what: "The digital path has preventable friction during menu/booking decisions.",
            whoItLoses: "mobile and late-intent diners",
            revenueImpact: "estimated 10-20 lost visits per week",
          },
        ],
    recommendedChannel,
    channelReason:
      recommendedChannel === "instagram_dm"
        ? "Instagram is the most reachable active channel when direct email signals are weak."
        : "Email is available and supports a clearer context-rich first touch.",
    outreachMessage: recommendedChannel === "cold_email"
      ? ensureColdEmailShape(fallbackMessage, snapshot.name, snapshot.city)
      : fallbackMessage,
    followUpHook:
      "a competitor comparison showing one fix and the booking lift trend over 30 days",
  };

  return {
    ...normalized,
    topProblems: normalized.topProblemsDetailed.map((item) => item.title),
    scoreReason: normalized.quickScoreReason,
    detailedAnalysis: composeDetailedAnalysis(normalized),
  };
}

function normalizeOutreachPayload(payload, lead, issues) {
  const snapshot = buildLeadSnapshot(lead, issues);
  const fallback = buildFallback(lead, issues);
  const strictFallbackChannel = inferFallbackChannel(snapshot);

  const recommendedChannel = normalizeChannel(
    payload?.recommendedChannel,
    strictFallbackChannel,
  );

  const enforcedChannel =
    !snapshot.email && (snapshot.instagramHandle || snapshot.instagramUrl)
      ? "instagram_dm"
      : recommendedChannel;

  const quickScore10 = toScore10(
    payload?.quickScore10,
    fallback.quickScore10,
  );

  const opportunityScore = toScore100(
    payload?.opportunityScore,
    quickScore10 * 10,
  );

  const topProblemsDetailed = normalizeProblemDetails(
    payload?.topProblemsDetailed,
    fallback.topProblemsDetailed,
  );

  const outreachMessageRaw = toCleanString(payload?.outreachMessage, fallback.outreachMessage);
  const outreachMessage =
    recommendedChannel === "cold_email"
      ? ensureColdEmailShape(outreachMessageRaw, snapshot.name, snapshot.city)
      : outreachMessageRaw;

  const normalized = {
    quickScore10,
    quickScoreReason: toCleanString(payload?.quickScoreReason, fallback.quickScoreReason),
    opportunityScore,
    topProblemsDetailed,
    recommendedChannel: enforcedChannel,
    channelReason:
      enforcedChannel !== recommendedChannel
        ? fallback.channelReason
        : toCleanString(payload?.channelReason, fallback.channelReason),
    outreachMessage,
    followUpHook: toCleanString(payload?.followUpHook, fallback.followUpHook),
  };

  return {
    ...normalized,
    topProblems: normalized.topProblemsDetailed.map((item) => item.title),
    scoreReason: normalized.quickScoreReason,
    detailedAnalysis: composeDetailedAnalysis(normalized),
  };
}

function buildOutreachPrompt(lead, issues, previousInvalidResponse = "") {
  const snapshot = buildLeadSnapshot(lead, issues);

  const retryBlock = previousInvalidResponse
    ? `\nPrevious attempt returned invalid JSON. Regenerate and return VALID JSON only.\nPrevious invalid response:\n${truncateText(previousInvalidResponse, 1400)}\n`
    : "";

  const issueLines = snapshot.issues.length
    ? snapshot.issues.map((item) => `- ${item}`).join("\n")
    : "- No issues provided";

  const toYesNo = (value) => (value ? "yes" : "no");

  return `
SYSTEM ROLE:
You are a restaurant digital growth consultant with expertise in conversion optimization, mobile UX, and local business psychology. You think in terms of lost revenue, not broken code.

CONTEXT:
You are analyzing a restaurant or cafe's online presence to identify specific problems that are costing them customers RIGHT NOW. Your output has two parts: (1) a structured analysis, and (2) a personalized outreach message.
${retryBlock}
INPUT DATA:
Restaurant Name: ${snapshot.name}
City / Country: ${snapshot.city}, ${snapshot.country}
Google Maps Rating: ${snapshot.rating ?? "Unknown"} / 5.0
Total Google Reviews: ${snapshot.reviewCount ?? "Unknown"}
Website URL: ${snapshot.websiteUrl || "Unknown"}
Instagram Handle: ${snapshot.instagramHandle || "Unknown"}
Instagram Followers: ${snapshot.instagramFollowers ?? "Unknown"}
Last Instagram Post: ${snapshot.daysSinceLastPost ?? "Unknown"} days ago
PageSpeed Score (Mobile): ${snapshot.mobileSpeed ?? "Unknown"}/100
PageSpeed Score (Desktop): ${snapshot.desktopSpeed ?? "Unknown"}/100
Has Online Menu: ${toYesNo(snapshot.hasOnlineMenu)}
Menu Type: ${snapshot.menuType}
Has Online Booking/Reservation: ${toYesNo(snapshot.hasOnlineBooking)}
Has Online Ordering: ${toYesNo(snapshot.hasOnlineOrdering)}
Has WhatsApp Button: ${toYesNo(snapshot.hasWhatsAppButton)}
Website Language: ${snapshot.websiteLanguage}
Primary Tourist Area: ${snapshot.primaryTouristArea ?? "Unknown"}
Issues Detected:
${issueLines}

STRICT RULES:
- Rank issues by highest revenue impact and keep only top 3.
- If mobile speed is below 50, make it #1 unless booking/menu is completely missing.
- Every problem must connect to real customer behavior and estimated lost visits per week.
- Recommended channel MUST be one of: instagram_dm, cold_email.
- If no email is available but Instagram exists, prefer instagram_dm.
- For cold_email, outreachMessage must include a Subject line and be 70-110 words.
- For instagram_dm, outreachMessage must be 45-65 words, conversational, and no bullet points.
- Avoid words: agency, portfolio, packages, solutions.
- Do not start with "Hi, I noticed".

Return JSON only (no markdown), with this exact shape:
${OUTREACH_JSON_SHAPE}
`;
}

export async function generateOutreach(lead, issues) {
  try {
    if (!genAI) {
      console.warn("[ai] GEMINI_API_KEY missing. Using fallback outreach.");
      return buildFallback(lead, issues);
    }

    const model = genAI.getGenerativeModel({
      model: config.geminiModel,
      generationConfig: {
        maxOutputTokens: config.geminiMaxTokens,
        temperature: 0.45,
        responseMimeType: "application/json",
        responseSchema: OUTREACH_RESPONSE_SCHEMA,
      },
    });

    const prompt = buildOutreachPrompt(lead, issues);
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    try {
      const parsed = parseGeminiJson(text);
      return normalizeOutreachPayload(parsed, lead, issues);
    } catch (error) {
      console.warn("[ai] Invalid JSON from Gemini (attempt 1):", error.message);

      try {
        const retryPrompt = buildOutreachPrompt(lead, issues, text);
        const retryResult = await model.generateContent(retryPrompt);
        const retryText = retryResult.response.text();
        const parsedRetry = parseGeminiJson(retryText);
        return normalizeOutreachPayload(parsedRetry, lead, issues);
      } catch (retryError) {
        console.error("[ai] Invalid JSON from Gemini after retry:", retryError.message);
        return buildFallback(lead, issues);
      }
    }
  } catch (error) {
    console.error("[ai] Outreach generation failed:", error.message);
    return buildFallback(lead, issues);
  }
}
