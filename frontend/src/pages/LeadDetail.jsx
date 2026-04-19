import React from "react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
  fetchLeadById,
  updateLeadStage,
  updateLeadWhatsappStatus,
} from "../api/client.js";
import IssueList from "../components/IssueList.jsx";
import OutreachBox from "../components/OutreachBox.jsx";
import ScoreBar from "../components/ScoreBar.jsx";
import StatusBadge from "../components/StatusBadge.jsx";

const stageOptions = [
  "discovered",
  "qualified",
  "contacted",
  "responded",
  "negotiating",
  "converted",
  "lost",
  "ignored",
];

const contactModeOptions = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
  { value: "call", label: "Phone Call" },
  { value: "instagram_dm", label: "Instagram DM" },
  { value: "facebook_dm", label: "Facebook DM" },
  { value: "visit", label: "In-person Visit" },
  { value: "other", label: "Other" },
];

function formatDate(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString();
}

function formatWhatsappStatus(value) {
  if (!value) return "Unknown";
  if (value === "confirmed") return "Confirmed";
  if (value === "likely") return "Likely";
  return "Unknown";
}

function formatContactMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  const entry = contactModeOptions.find((option) => option.value === mode);
  return entry ? entry.label : "N/A";
}

function toWhatsappPhoneFromContact(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : "";
}

function buildWhatsappCheckLink(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? `https://wa.me/${digits}` : "";
}

function canonicalizeSocialUrl(rawUrl) {
  if (!rawUrl) return "";

  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    const segments = parsed.pathname.split("/").filter(Boolean);

    if (hostname.includes("facebook.com")) {
      const blockedRoots = new Set(["login", "recover", "photo", "share", "sharer.php"]);
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

    return "";
  } catch (_error) {
    return "";
  }
}

function isSocialUrl(url) {
  return Boolean(canonicalizeSocialUrl(url));
}

function socialPlatformName(url) {
  if (!url) return "Social";

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes("facebook.com")) return "Facebook";
    if (hostname.includes("instagram.com")) return "Instagram";
    if (hostname.includes("tripadvisor.")) return "Tripadvisor";
    if (hostname.includes("tiktok.com")) return "TikTok";
    if (hostname.includes("x.com") || hostname.includes("twitter.com")) return "X";
    return "Social";
  } catch (_error) {
    return "Social";
  }
}

function LeadDetail() {
  const { id } = useParams();
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [updatingWhatsapp, setUpdatingWhatsapp] = useState(false);
  const [form, setForm] = useState({
    stage: "",
    contactMode: "whatsapp",
    note: "",
    nextFollowUpAt: "",
  });

  async function loadLead() {
    setLoading(true);
    setError("");
    try {
      const data = await fetchLeadById(id);
      setLead(data);
      setForm((prev) => ({
        ...prev,
        stage: data.stage || "discovered",
        contactMode: data.lastContactMode || prev.contactMode || "whatsapp",
      }));
    } catch (loadError) {
      setError(loadError.message || "Failed to load lead.");
    } finally {
      setLoading(false);
    }
  }

  function handleStageChange(nextStage) {
    setForm((prev) => ({
      ...prev,
      stage: nextStage,
      contactMode:
        nextStage === "contacted"
          ? prev.contactMode || lead?.lastContactMode || "whatsapp"
          : prev.contactMode,
    }));
  }

  useEffect(() => {
    loadLead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleStageUpdate(event) {
    event.preventDefault();
    setMessage("");
    setError("");

    try {
      if (form.stage === "contacted" && !form.contactMode) {
        setError("Please select how you contacted this lead.");
        return;
      }

      const payload = {
        stage: form.stage,
        note: form.note,
      };

      if (form.stage === "contacted") {
        payload.contactMode = form.contactMode;
      }

      if (form.nextFollowUpAt) {
        payload.nextFollowUpAt = form.nextFollowUpAt;
      }

      const updated = await updateLeadStage(id, payload);
      setLead(updated);
      setMessage("Stage updated successfully.");
      setForm((prev) => ({ ...prev, note: "" }));
    } catch (updateError) {
      setError(updateError.message || "Failed to update stage.");
    }
  }

  async function handleConfirmWhatsapp() {
    setMessage("");
    setError("");
    setUpdatingWhatsapp(true);

    try {
      const payload = {
        status: "confirmed",
        whatsappPhone,
        whatsappLink,
      };

      const updated = await updateLeadWhatsappStatus(id, payload);
      setLead(updated);
      setMessage("WhatsApp status updated to confirmed.");
    } catch (updateError) {
      setError(updateError.message || "Failed to update WhatsApp status.");
    } finally {
      setUpdatingWhatsapp(false);
    }
  }

  if (loading) {
    return <p>Loading lead details...</p>;
  }

  if (!lead) {
    return (
      <section className="panel">
        <p>Lead not found.</p>
        <Link className="btn btn-ghost" to="/dashboard">
          Back to dashboard
        </Link>
      </section>
    );
  }

  const fallbackWhatsappPhone = toWhatsappPhoneFromContact(lead.phone);
  const whatsappLink = lead.websiteSnapshot?.whatsappLink || "";
  const whatsappPhone = lead.websiteSnapshot?.whatsappPhone || fallbackWhatsappPhone || "";
  const whatsappCheckLink =
    lead.websiteSnapshot?.whatsappCheckLink || buildWhatsappCheckLink(whatsappPhone);
  const whatsappStatus = lead.websiteSnapshot?.whatsappStatus || (whatsappPhone ? "likely" : "unknown");
  const websiteUrl = lead.website || "";
  const websiteSocialUrl = canonicalizeSocialUrl(websiteUrl);
  const websiteIsSocial = Boolean(websiteSocialUrl);
  const displayWebsite = websiteIsSocial ? "" : websiteUrl;
  const socialLinks = [
    ...(websiteIsSocial ? [websiteSocialUrl] : []),
    ...(lead.websiteSnapshot?.socialLinks || []),
    lead.externalProfiles?.facebook?.url || "",
    lead.externalProfiles?.tripadvisor?.url || "",
  ]
    .map((url) => canonicalizeSocialUrl(url))
    .filter(Boolean)
    .filter((url, index, arr) => arr.indexOf(url) === index);
  const displayEmail =
    lead.email ||
    lead.externalProfiles?.facebook?.email ||
    lead.externalProfiles?.tripadvisor?.email ||
    "N/A";
  const latestContactMode =
    lead.lastContactMode ||
    [...(lead.stageHistory || [])].reverse().find((entry) => entry.stage === "contacted")
      ?.contactMode ||
    "";

  return (
    <section className="page-grid">
      <div className="section-row">
        <h2>{lead.name}</h2>
        <div className="section-row-actions">
          <Link className="btn btn-ghost" to="/dashboard">
            Back to Dashboard
          </Link>
          <StatusBadge stage={lead.stage} />
        </div>
      </div>

      <article className="panel">
        <h3>Lead Snapshot</h3>
        <div className="detail-grid">
          <p>
            <strong>City:</strong> {lead.city}
          </p>
          <p>
            <strong>Website:</strong>{" "}
            {displayWebsite ? (
              <a className="inline-link" href={displayWebsite} target="_blank" rel="noreferrer">
                {displayWebsite}
              </a>
            ) : (
              "N/A"
            )}
          </p>
          <p>
            <strong>Phone:</strong> {lead.phone || "N/A"}
          </p>
          <p>
            <strong>Email:</strong> {displayEmail}
          </p>
          <p>
            <strong>WhatsApp:</strong>{" "}
            {whatsappLink ? (
              <a
                className="inline-link"
                href={whatsappLink}
                target="_blank"
                rel="noreferrer"
              >
                Open chat
              </a>
            ) : whatsappCheckLink ? (
              <a
                className="inline-link"
                href={whatsappCheckLink}
                target="_blank"
                rel="noreferrer"
              >
                Check on WhatsApp
              </a>
            ) : (
              "N/A"
            )}
          </p>
          <p>
            <strong>WhatsApp Number:</strong> {whatsappPhone || "N/A"}
          </p>
          <p>
            <strong>WhatsApp Status:</strong>{" "}
            {formatWhatsappStatus(whatsappStatus)}
          </p>
          {whatsappStatus !== "confirmed" ? (
            <p className="whatsapp-manual-actions">
              <button
                className="btn btn-primary"
                type="button"
                onClick={handleConfirmWhatsapp}
                disabled={updatingWhatsapp}
              >
                {updatingWhatsapp ? "Updating..." : "I Confirmed WhatsApp Exists"}
              </button>
            </p>
          ) : null}
          <p>
            <strong>Last Contacted:</strong> {formatDate(lead.lastContactedAt)}
          </p>
          <p>
            <strong>Contact Mode:</strong> {formatContactMode(latestContactMode)}
          </p>
          <p>
            <strong>Next Follow-Up:</strong> {formatDate(lead.nextFollowUpAt)}
          </p>
        </div>

        <div className="score-panel">
          <h4>Opportunity Score</h4>
          <ScoreBar score={lead.opportunityScore} />
          <p>{lead.scoreReason || "No score reason available."}</p>
        </div>
      </article>

      <article className="panel">
        <h3>Socials</h3>
        {socialLinks.length > 0 ? (
          <div className="social-links-list">
            {socialLinks.map((url) => (
              <div key={url} className="social-link-item">
                <p className="social-link-label">{socialPlatformName(url)}</p>
                <a className="inline-link" href={url} target="_blank" rel="noreferrer">
                  {url}
                </a>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-muted">No social links available.</p>
        )}
      </article>

      <article className="panel">
        <h3>Detected Issues</h3>
        <IssueList issues={lead.detectedIssues || []} />
      </article>

      <article className="panel">
        <h3>Generated Outreach</h3>
        <OutreachBox outreach={lead.outreach} />
      </article>

      <article className="panel">
        <h3>Stage Timeline</h3>
        <div className="timeline">
          {(lead.stageHistory || []).map((entry, index) => (
            <div key={`${entry.stage}-${entry.date}-${index}`} className="timeline-item">
              <div className="timeline-dot" />
              <div>
                <p className="timeline-stage">{entry.stage}</p>
                <p className="timeline-date">{formatDate(entry.date)}</p>
                {entry.contactMode ? (
                  <p className="timeline-meta">Via {formatContactMode(entry.contactMode)}</p>
                ) : null}
                {entry.note ? <p>{entry.note}</p> : null}
              </div>
            </div>
          ))}
        </div>
      </article>

      <article className="panel">
        <h3>Update Stage</h3>
        <form className="form-grid stage-update-form" onSubmit={handleStageUpdate}>
          <label>
            Stage
            <select
              value={form.stage}
              onChange={(e) => handleStageChange(e.target.value)}
              required
            >
              {stageOptions.map((stage) => (
                <option key={stage} value={stage}>
                  {stage}
                </option>
              ))}
            </select>
          </label>

          {form.stage === "contacted" ? (
            <label>
              Contact Mode
              <select
                value={form.contactMode}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, contactMode: e.target.value }))
                }
                required
              >
                {contactModeOptions.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label>
            Note
            <textarea
              value={form.note}
              onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
              placeholder="Optional context for this stage move"
            />
          </label>

          <label>
            Next Follow-Up Date
            <input
              type="datetime-local"
              value={form.nextFollowUpAt}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, nextFollowUpAt: e.target.value }))
              }
            />
          </label>

          <button className="btn btn-primary" type="submit">
            Save Stage Update
          </button>
        </form>

        {message ? <p className="success-text">{message}</p> : null}
        {error ? <p className="error-text">{error}</p> : null}
      </article>
    </section>
  );
}

export default LeadDetail;
