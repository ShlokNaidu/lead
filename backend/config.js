import dotenv from "dotenv";

dotenv.config();

const config = {
  port: Number(process.env.PORT) || 5000,
  mongoUri:
    process.env.MONGO_URI || "mongodb://localhost:27017/restaurant_mvp",
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  geminiMaxTokens: 1200,
  scrapeDelay: 2000,
  maxLeadsPerRun: 10,
  lighthouseTimeout: 30000,
  mapsSearchTimeoutMs: Number(process.env.MAPS_SEARCH_TIMEOUT_MS) || 30000,
  mapsDetailTimeoutMs: Number(process.env.MAPS_DETAIL_TIMEOUT_MS) || 15000,
  mapsDetailRetries: Number(process.env.MAPS_DETAIL_RETRIES) || 1,
  speedCriticalThreshold: 50,
  speedSlowThreshold: 70,
  websiteDeepCrawlEnabled:
    process.env.WEBSITE_DEEP_CRAWL_ENABLED !== "false",
  websiteDeepCrawlMaxPages: Number(process.env.WEBSITE_DEEP_CRAWL_MAX_PAGES) || 4,
  userAgent:
    process.env.USER_AGENT ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

export default config;
