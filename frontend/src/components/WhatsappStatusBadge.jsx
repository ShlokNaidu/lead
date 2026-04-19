import React from "react";

const statusClassMap = {
  confirmed: "badge-green",
  likely: "badge-amber",
  unknown: "badge-gray",
};

const statusLabelMap = {
  confirmed: "Confirmed",
  likely: "Likely",
  unknown: "Unknown",
};

function normalizeStatus(value) {
  if (!value) return "unknown";

  const normalized = String(value).toLowerCase();
  if (normalized === "confirmed") return "confirmed";
  if (normalized === "likely") return "likely";
  return "unknown";
}

function WhatsappStatusBadge({ status }) {
  const safeStatus = normalizeStatus(status);
  const className = statusClassMap[safeStatus] || "badge-gray";
  const label = statusLabelMap[safeStatus] || "Unknown";

  return <span className={`status-badge ${className}`}>{label}</span>;
}

export default WhatsappStatusBadge;
