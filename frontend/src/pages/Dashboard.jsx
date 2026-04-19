import React from "react";
import { useEffect, useMemo, useState } from "react";

import { deleteLead, fetchLeads, fetchLeadStats } from "../api/client.js";
import CityAutocompleteInput from "../components/CityAutocompleteInput.jsx";
import LeadTable from "../components/LeadTable.jsx";

const stageOptions = [
  "",
  "discovered",
  "qualified",
  "contacted",
  "responded",
  "negotiating",
  "converted",
  "lost",
  "ignored",
];

const DASHBOARD_FILTERS_STORAGE_KEY = "dashboardFilters";
const DEFAULT_FILTERS = { stage: "", city: "", minScore: "" };

function loadStoredFilters() {
  if (typeof window === "undefined") {
    return DEFAULT_FILTERS;
  }

  try {
    const raw = window.sessionStorage.getItem(DASHBOARD_FILTERS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_FILTERS;
    }

    const parsed = JSON.parse(raw);

    return {
      stage: typeof parsed?.stage === "string" ? parsed.stage : "",
      city: typeof parsed?.city === "string" ? parsed.city : "",
      minScore: typeof parsed?.minScore === "string" ? parsed.minScore : "",
    };
  } catch (_error) {
    return DEFAULT_FILTERS;
  }
}

function Dashboard() {
  const [leads, setLeads] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState(loadStoredFilters);

  const byStageEntries = useMemo(() => {
    if (!stats?.byStage) return [];
    return Object.entries(stats.byStage);
  }, [stats]);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [leadData, statsData] = await Promise.all([
        fetchLeads(filters),
        fetchLeadStats(),
      ]);

      setLeads(leadData.leads || []);
      setStats(statsData);
    } catch (loadError) {
      setError(loadError.message || "Failed to load dashboard data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(
      DASHBOARD_FILTERS_STORAGE_KEY,
      JSON.stringify(filters)
    );
  }, [filters]);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.stage, filters.city, filters.minScore]);

  async function handleDelete(lead) {
    if (!lead?._id) {
      return;
    }

    const leadName = lead.name || "this lead";
    const confirmed = window.confirm(
      `Delete ${leadName}? This action cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    try {
      await deleteLead(lead._id);
      await loadData();
    } catch (deleteError) {
      setError(deleteError.message || "Failed to delete lead.");
    }
  }

  return (
    <section className="page-grid">
      <div className="section-header">
        <h2>Pipeline Dashboard</h2>
        <p>Track every restaurant from discovery to conversion.</p>
      </div>

      <div className="card-grid">
        <article className="metric-card">
          <p>Total Leads</p>
          <h3>{stats?.total ?? 0}</h3>
        </article>
        <article className="metric-card">
          <p>Average Opportunity Score</p>
          <h3>{stats?.avgScore ?? 0}</h3>
        </article>
        <article className="metric-card">
          <p>Top City</p>
          <h3>{stats?.topCity ?? "N/A"}</h3>
        </article>
        <article className="metric-card">
          <p>Conversion Rate</p>
          <h3>{stats?.conversionRate ?? 0}%</h3>
        </article>
      </div>

      <article className="panel">
        <h3>Pipeline Breakdown</h3>
        <div className="pipeline-grid">
          {byStageEntries.map(([stage, count]) => (
            <div key={stage} className="pipeline-item">
              <p className="pipeline-stage">{stage}</p>
              <strong>{count}</strong>
            </div>
          ))}
        </div>
      </article>

      <article className="panel">
        <h3>Filters</h3>
        <div className="filter-row">
          <label>
            Stage
            <select
              value={filters.stage}
              onChange={(e) => setFilters((prev) => ({ ...prev, stage: e.target.value }))}
            >
              {stageOptions.map((stage) => (
                <option key={stage || "all"} value={stage}>
                  {stage || "All stages"}
                </option>
              ))}
            </select>
          </label>

          <label>
            City
            <CityAutocompleteInput
              value={filters.city}
              onChange={(city) => setFilters((prev) => ({ ...prev, city }))}
              placeholder="e.g. Miami"
            />
          </label>

          <label>
            Min Score
            <input
              type="number"
              min="0"
              max="100"
              value={filters.minScore}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, minScore: e.target.value }))
              }
              placeholder="0"
            />
          </label>
        </div>
      </article>

      <article className="panel">
        <div className="section-row">
          <h3>Leads</h3>
          <button className="btn btn-ghost" onClick={loadData}>
            Refresh
          </button>
        </div>

        {loading ? <p>Loading...</p> : <LeadTable leads={leads} onDelete={handleDelete} />}
        {error ? <p className="error-text">{error}</p> : null}
      </article>
    </section>
  );
}

export default Dashboard;
