import express from "express";
import allCities from "all-the-cities";

const router = express.Router();

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const seen = new Set();
const cityRows = [];

for (const city of allCities) {
  const name = String(city?.name || "").trim();
  if (!name) continue;

  const searchKey = normalizeText(name);
  if (!searchKey || seen.has(searchKey)) continue;

  seen.add(searchKey);
  cityRows.push({ name, searchKey });
}

cityRows.sort((a, b) => a.name.localeCompare(b.name));

router.get("/suggest", (req, res) => {
  try {
    const query = String(req.query.query || "").trim();
    const normalizedQuery = normalizeText(query);
    const rawLimit = Number(req.query.limit);
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 10, 1), 25);

    if (!normalizedQuery) {
      return res.json({ query, suggestions: [] });
    }

    const startsWith = [];
    const contains = [];

    for (const row of cityRows) {
      if (row.searchKey.startsWith(normalizedQuery)) {
        startsWith.push(row.name);
      } else if (row.searchKey.includes(normalizedQuery)) {
        contains.push(row.name);
      }

      if (startsWith.length >= limit && contains.length >= limit) {
        break;
      }
    }

    const suggestions = [...startsWith, ...contains].slice(0, limit);

    return res.json({
      query,
      suggestions,
    });
  } catch (error) {
    console.error("[cities] GET /suggest failed:", error.message);
    return res.status(500).json({ error: "Failed to fetch city suggestions" });
  }
});

export default router;
