import React from "react";

function IssueList({ issues = [] }) {
  if (!issues.length) {
    return <p className="empty-muted">No major issues detected.</p>;
  }

  return (
    <ul className="issue-list">
      {issues.map((issue, index) => (
        <li key={`${issue}-${index}`} className="issue-item">
          {issue}
        </li>
      ))}
    </ul>
  );
}

export default IssueList;
