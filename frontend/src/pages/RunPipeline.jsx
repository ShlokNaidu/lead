import React from "react";
import { useEffect, useState } from "react";

import { fetchPipelineStatus, runPipeline } from "../api/client.js";
import CityAutocompleteInput from "../components/CityAutocompleteInput.jsx";

function RunPipeline() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [result, setResult] = useState(null);
  const [form, setForm] = useState({
    query: "restaurants",
    city: "",
    maxResults: 10,
    deepCrawlEnabled: true,
  });

  useEffect(() => {
    let isSubscribed = true;

    async function syncPipelineStatus() {
      try {
        const status = await fetchPipelineStatus();

        if (!isSubscribed) return;

        const isRunning = Boolean(status?.running);
        setLoading(isRunning);

        if (isRunning) {
          const query = status.query || "restaurants";
          const city = status.city ? ` in ${status.city}` : "";
          setStatusMessage(`Pipeline is running for ${query}${city}.`);
          return;
        }

        setStatusMessage("");
      } catch (_statusError) {
        if (!isSubscribed) return;
      }
    }

    syncPipelineStatus();
    const pollId = setInterval(syncPipelineStatus, 2500);

    return () => {
      isSubscribed = false;
      clearInterval(pollId);
    };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setStatusMessage("Pipeline started. This can take a few minutes.");
    setResult(null);

    try {
      const data = await runPipeline({
        query: form.query,
        city: form.city,
        maxResults: Number(form.maxResults),
        deepCrawlEnabled: Boolean(form.deepCrawlEnabled),
      });
      setResult(data);
      setStatusMessage("");
    } catch (runError) {
      setError(runError.message || "Pipeline run failed.");
      setStatusMessage("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="page-grid">
      <div className="section-header">
        <h2>Run Pipeline</h2>
        <p>Scrape, audit, score, and generate outreach in one flow.</p>
      </div>

      <article className="panel">
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Search Query
            <input
              type="text"
              value={form.query}
              onChange={(e) => setForm((prev) => ({ ...prev, query: e.target.value }))}
              placeholder="restaurants"
              disabled={loading}
              required
            />
          </label>

          <label>
            City
            <CityAutocompleteInput
              value={form.city}
              onChange={(city) => setForm((prev) => ({ ...prev, city }))}
              placeholder="e.g. Austin"
              disabled={loading}
            />
          </label>

          <label>
            Max Leads Per Run
            <input
              type="number"
              min="1"
              max="10"
              value={form.maxResults}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, maxResults: e.target.value }))
              }
              disabled={loading}
              required
            />
          </label>

          <label>
            <span>Deep Website Crawl (contact/about pages)</span>
            <input
              type="checkbox"
              checked={form.deepCrawlEnabled}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, deepCrawlEnabled: e.target.checked }))
              }
              disabled={loading}
            />
          </label>

          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? "Running..." : "Start Pipeline"}
          </button>
        </form>
      </article>

      {statusMessage ? <p className="empty-muted">{statusMessage}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {result ? (
        <article className="panel">
          <h3>Run Result</h3>
          <div className="detail-grid">
            <p>
              <strong>Discovered:</strong> {result.stats?.discovered ?? 0}
            </p>
            <p>
              <strong>Processed:</strong> {result.stats?.processed ?? 0}
            </p>
            <p>
              <strong>Saved:</strong> {result.stats?.saved ?? 0}
            </p>
            <p>
              <strong>Skipped (already exists):</strong> {result.stats?.skippedExisting ?? 0}
            </p>
            <p>
              <strong>Qualified:</strong> {result.stats?.qualified ?? 0}
            </p>
            <p>
              <strong>Failed:</strong> {result.stats?.failed ?? 0}
            </p>
          </div>

          {(result.stats?.errors || []).length > 0 ? (
            <div>
              <h4>Errors</h4>
              <ul className="issue-list">
                {result.stats.errors.map((item, index) => (
                  <li key={`${item.lead}-${index}`}>
                    {item.lead}: {item.error}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}

export default RunPipeline;
