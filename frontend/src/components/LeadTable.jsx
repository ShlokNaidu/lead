import React from "react";
import { Link } from "react-router-dom";

import ScoreBar from "./ScoreBar.jsx";
import StatusBadge from "./StatusBadge.jsx";
import WhatsappStatusBadge from "./WhatsappStatusBadge.jsx";

function inferWhatsappStatus(lead) {
  const explicit = lead?.websiteSnapshot?.whatsappStatus;
  if (explicit) return explicit;
  if (lead?.websiteSnapshot?.whatsappLink) return "confirmed";
  if (lead?.phone) return "likely";
  return "unknown";
}

function LeadTable({ leads = [], onDelete }) {
  if (!leads.length) {
    return <p className="empty-muted">No leads found for current filters.</p>;
  }

  return (
    <div className="table-wrap">
      <table className="lead-table">
        <thead>
          <tr>
            <th>Restaurant</th>
            <th>City</th>
            <th>Stage</th>
            <th>Opportunity</th>
            <th>Website</th>
            <th>WhatsApp</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr key={lead._id}>
              <td>
                <p className="cell-main">{lead.name}</p>
                <p className="cell-sub">{lead.phone || "No phone"}</p>
              </td>
              <td>{lead.city}</td>
              <td>
                <StatusBadge stage={lead.stage} />
              </td>
              <td>
                <ScoreBar score={lead.opportunityScore} />
              </td>
              <td>
                {lead.website ? (
                  <a className="inline-link" href={lead.website} target="_blank" rel="noreferrer">
                    Visit
                  </a>
                ) : (
                  "N/A"
                )}
              </td>
              <td>
                <WhatsappStatusBadge status={inferWhatsappStatus(lead)} />
              </td>
              <td>
                <div className="row-actions">
                  <Link className="btn btn-ghost" to={`/lead/${lead._id}`}>
                    Open
                  </Link>
                  <button
                    className="btn btn-danger"
                    type="button"
                    onClick={() => onDelete(lead)}
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default LeadTable;
