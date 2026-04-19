import React from "react";

const stageClassMap = {
  discovered: "badge-gray",
  qualified: "badge-teal",
  contacted: "badge-blue",
  responded: "badge-amber",
  negotiating: "badge-purple",
  converted: "badge-green",
  lost: "badge-red",
  ignored: "badge-slate",
};

function StatusBadge({ stage }) {
  const safeStage = stage || "discovered";
  const className = stageClassMap[safeStage] || "badge-gray";

  return <span className={`status-badge ${className}`}>{safeStage}</span>;
}

export default StatusBadge;
