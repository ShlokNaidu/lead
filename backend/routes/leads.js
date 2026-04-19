import express from "express";
import mongoose from "mongoose";

import Lead, { CONTACT_MODES, PIPELINE_STAGES } from "../models/Lead.js";

const router = express.Router();

const WHATSAPP_STATUS_ORDER = {
  unknown: 0,
  likely: 1,
  confirmed: 2,
};

function shouldUpdateWhatsappStatus(currentStatus, nextStatus) {
  const currentRank = WHATSAPP_STATUS_ORDER[currentStatus] ?? 0;
  const nextRank = WHATSAPP_STATUS_ORDER[nextStatus] ?? 0;
  return nextRank > currentRank;
}

function toWhatsappPhoneFromContact(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : "";
}

function buildWhatsappCheckLink(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? `https://wa.me/${digits}` : "";
}

router.get("/", async (req, res) => {
  try {
    const { stage, minScore, city } = req.query;
    const query = {};

    if (stage && PIPELINE_STAGES.includes(stage)) {
      query.stage = stage;
    }

    if (city) {
      query.city = { $regex: city, $options: "i" };
    }

    if (minScore) {
      query.opportunityScore = { $gte: Number(minScore) || 0 };
    }

    const leads = await Lead.find(query).sort({ updatedAt: -1 });

    res.json({
      total: leads.length,
      leads,
    });
  } catch (error) {
    console.error("[leads] GET / failed:", error.message);
    res.status(500).json({ error: "Failed to fetch leads" });
  }
});

router.get("/stats", async (_req, res) => {
  try {
    const total = await Lead.countDocuments();

    const stageBreakdown = await Lead.aggregate([
      { $group: { _id: "$stage", count: { $sum: 1 } } },
    ]);

    const byStage = PIPELINE_STAGES.reduce((acc, stage) => {
      acc[stage] = 0;
      return acc;
    }, {});

    for (const entry of stageBreakdown) {
      byStage[entry._id] = entry.count;
    }

    const scoreStats = await Lead.aggregate([
      { $group: { _id: null, avgScore: { $avg: "$opportunityScore" } } },
    ]);

    const cityStats = await Lead.aggregate([
      { $group: { _id: "$city", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 },
    ]);

    const converted = byStage.converted || 0;
    const conversionRate = total > 0 ? Number(((converted / total) * 100).toFixed(2)) : 0;

    res.json({
      total,
      byStage,
      avgScore: Number((scoreStats[0]?.avgScore || 0).toFixed(2)),
      topCity: cityStats[0]?._id || "N/A",
      conversionRate,
    });
  } catch (error) {
    console.error("[leads] GET /stats failed:", error.message);
    res.status(500).json({ error: "Failed to fetch lead stats" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid lead id" });
    }

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    return res.json(lead);
  } catch (error) {
    console.error("[leads] GET /:id failed:", error.message);
    return res.status(500).json({ error: "Failed to fetch lead" });
  }
});

router.patch("/:id/stage", async (req, res) => {
  try {
    const { id } = req.params;
    const { stage, note = "", nextFollowUpAt, contactMode = "" } = req.body;
    const normalizedContactMode = String(contactMode || "").trim().toLowerCase();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid lead id" });
    }

    if (!stage || !PIPELINE_STAGES.includes(stage)) {
      return res.status(400).json({ error: "Invalid stage value" });
    }

    if (stage === "contacted" && !CONTACT_MODES.includes(normalizedContactMode)) {
      return res.status(400).json({
        error: `Contact mode is required for contacted stage. Allowed: ${CONTACT_MODES.join(", ")}`,
      });
    }

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    lead.stage = stage;

    const stageHistoryEntry = {
      stage,
      note,
      date: new Date(),
    };

    if (stage === "contacted") {
      lead.lastContactedAt = new Date();
      lead.lastContactMode = normalizedContactMode;
      stageHistoryEntry.contactMode = normalizedContactMode;
    }

    lead.stageHistory.push(stageHistoryEntry);

    if (nextFollowUpAt) {
      const parsed = new Date(nextFollowUpAt);
      if (!Number.isNaN(parsed.getTime())) {
        lead.nextFollowUpAt = parsed;
      }
    }

    lead.updatedAt = new Date();

    await lead.save();

    return res.json(lead);
  } catch (error) {
    console.error("[leads] PATCH /:id/stage failed:", error.message);
    return res.status(500).json({ error: "Failed to update stage" });
  }
});

router.patch("/:id/whatsapp-status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, whatsappPhone = "", whatsappLink = "" } = req.body;
    const allowedStatuses = ["unknown", "likely", "confirmed"];

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid lead id" });
    }

    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid WhatsApp status value" });
    }

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const normalizedPhone = whatsappPhone || toWhatsappPhoneFromContact(lead.phone);

    if (normalizedPhone && normalizedPhone !== lead.websiteSnapshot?.whatsappPhone) {
      lead.websiteSnapshot.whatsappPhone = normalizedPhone;
    }

    if (whatsappLink && whatsappLink !== lead.websiteSnapshot?.whatsappLink) {
      lead.websiteSnapshot.whatsappLink = whatsappLink;
    }

    const checkLink = buildWhatsappCheckLink(normalizedPhone);
    if (checkLink && checkLink !== lead.websiteSnapshot?.whatsappCheckLink) {
      lead.websiteSnapshot.whatsappCheckLink = checkLink;
    }

    lead.websiteSnapshot.whatsappStatus = status;
    lead.updatedAt = new Date();

    await lead.save();

    return res.json(lead);
  } catch (error) {
    console.error("[leads] PATCH /:id/whatsapp-status failed:", error.message);
    return res.status(500).json({ error: "Failed to update WhatsApp status" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid lead id" });
    }

    const deleted = await Lead.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ error: "Lead not found" });
    }

    return res.json({ success: true, deletedId: id });
  } catch (error) {
    console.error("[leads] DELETE /:id failed:", error.message);
    return res.status(500).json({ error: "Failed to delete lead" });
  }
});

export default router;
