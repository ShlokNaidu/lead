import React from "react";

function channelLabel(value) {
  if (!value) return "N/A";
  const normalized = String(value).toLowerCase();
  if (normalized === "instagram_dm") return "Instagram DM";
  if (normalized === "cold_email") return "Cold Email";
  return value;
}

function OutreachBox({ outreach }) {
  if (!outreach) {
    return <p className="empty-muted">No outreach generated yet.</p>;
  }

  const topProblems = Array.isArray(outreach.topProblemsDetailed)
    ? outreach.topProblemsDetailed
    : [];

  return (
    <div className="outreach-box">
      <div className="outreach-meta">
        <p>
          <strong>Recommended channel:</strong> {channelLabel(outreach.recommendedChannel)}
        </p>
        <p>
          <strong>Reason:</strong> {outreach.channelReason || "N/A"}
        </p>
      </div>

      {typeof outreach.quickScore10 === "number" ? (
        <div className="outreach-analysis-block">
          <p>
            <strong>Overall Opportunity Score:</strong> {outreach.quickScore10}/10
          </p>
          <p>
            <strong>Reason:</strong> {outreach.quickScoreReason || "N/A"}
          </p>
        </div>
      ) : null}

      {topProblems.length > 0 ? (
        <div className="outreach-analysis-block">
          <strong>Top 3 Problems</strong>
          <div className="outreach-problems-grid">
            {topProblems.map((problem, index) => (
              <div key={`${problem.title || "problem"}-${index}`} className="outreach-problem-item">
                <p>
                  <strong>#{index + 1} - {problem.title || "Untitled"}</strong>
                </p>
                <p>
                  <strong>What:</strong> {problem.what || "N/A"}
                </p>
                <p>
                  <strong>Who it loses:</strong> {problem.whoItLoses || "N/A"}
                </p>
                <p>
                  <strong>Revenue impact:</strong> {problem.revenueImpact || "N/A"}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <p className="outreach-message">{outreach.outreachMessage || "No message generated."}</p>
      <p className="outreach-hook">
        <strong>Follow-up hook:</strong> {outreach.followUpHook || "N/A"}
      </p>

      {outreach.detailedAnalysis ? (
        <details className="outreach-report-wrap">
          <summary>Detailed AI Report</summary>
          <pre className="outreach-report">{outreach.detailedAnalysis}</pre>
        </details>
      ) : null}
    </div>
  );
}

export default OutreachBox;
