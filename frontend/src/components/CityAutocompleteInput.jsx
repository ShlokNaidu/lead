import React from "react";
import { useEffect, useId, useState } from "react";

import { fetchCitySuggestions } from "../api/client.js";

function CityAutocompleteInput({ value, onChange, placeholder = "", disabled = false }) {
  const listId = useId();
  const [suggestions, setSuggestions] = useState([]);

  useEffect(() => {
    const query = String(value || "").trim();

    if (!query) {
      setSuggestions([]);
      return;
    }

    let active = true;

    const timer = setTimeout(async () => {
      try {
        const data = await fetchCitySuggestions(query, 12);
        if (!active) return;
        setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
      } catch (_error) {
        if (!active) return;
        setSuggestions([]);
      }
    }, 180);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [value]);

  return (
    <>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        list={listId}
        autoComplete="off"
      />
      <datalist id={listId}>
        {suggestions.map((city) => (
          <option key={city} value={city} />
        ))}
      </datalist>
    </>
  );
}

export default CityAutocompleteInput;
