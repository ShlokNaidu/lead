const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || data.message || "API request failed");
  }

  return data;
}

export function fetchLeads(filters = {}) {
  const params = new URLSearchParams();

  if (filters.stage) params.set("stage", filters.stage);
  if (filters.city) params.set("city", filters.city);
  if (filters.minScore) params.set("minScore", String(filters.minScore));

  const query = params.toString() ? `?${params.toString()}` : "";
  return request(`/leads${query}`);
}

export function fetchLeadStats() {
  return request("/leads/stats");
}

export function fetchLeadById(id) {
  return request(`/leads/${id}`);
}

export function updateLeadStage(id, payload) {
  return request(`/leads/${id}/stage`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function updateLeadWhatsappStatus(id, payload) {
  return request(`/leads/${id}/whatsapp-status`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteLead(id) {
  return request(`/leads/${id}`, { method: "DELETE" });
}

export function runPipeline(payload) {
  return request("/pipeline/run", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchPipelineStatus() {
  return request("/pipeline/status");
}

export function fetchCitySuggestions(query, limit = 10) {
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  if (limit) params.set("limit", String(limit));

  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request(`/cities/suggest${suffix}`);
}
