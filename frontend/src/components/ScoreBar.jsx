import React from "react";

function ScoreBar({ score }) {
  const safeScore = Number(score) || 0;

  return (
    <div className="score-wrap" aria-label={`Opportunity score ${safeScore}`}>
      <div className="score-track">
        <div className="score-fill" style={{ width: `${safeScore}%` }} />
      </div>
      <span className="score-value">{safeScore}</span>
    </div>
  );
}

export default ScoreBar;
