import React, { useState } from "react";

/**
 * WritebackTable component
 * - Displays Qlik hypercube data as a table
 * - Adds simple client-side pagination (default 25 rows/page)
 */
export default function WritebackTable({ layout, pageSize = 25 }) {
  // React state to track the current page index (starting at 0)
  const [page, setPage] = useState(0);

  // Show a prompt if the table isn't configured with dims/measures yet
  if (!layout.qHyperCube || !layout.qHyperCube.qDimensionInfo.length) {
    return (
      <div style={{ padding: 24, color: "#666" }}>
        No data yet.
        <br />
        Add a dimension and a measure.
      </div>
    );
  }

  // Extract columns (headers) and data rows from Qlik's hypercube structure
  const hc = layout.qHyperCube;
  const columns = [...hc.qDimensionInfo, ...hc.qMeasureInfo].map(
    (f) => f.qFallbackTitle
  );
  const rows = hc.qDataPages[0].qMatrix;

  // Pagination: compute total pages and get only rows for current page
  const totalPages = Math.ceil(rows.length / pageSize);
  const pagedRows = rows.slice(page * pageSize, (page + 1) * pageSize);

  // Navigation logic for Prev/Next buttons
  function gotoPage(newPage) {
    setPage(Math.max(0, Math.min(totalPages - 1, newPage)));
  }

  // Render the paginated table and controls
  return (
    <div>
      <table border="1">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pagedRows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell.qText}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {/* Pagination Controls */}
      <div
        style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 12 }}
      >
        {/* Previous button */}
        <button onClick={() => gotoPage(page - 1)} disabled={page === 0}>
          Prev
        </button>
        {/* Current page indicator */}
        <span>
          Page {page + 1} of {totalPages}
        </span>
        {/* Next button */}
        <button
          onClick={() => gotoPage(page + 1)}
          disabled={page >= totalPages - 1}
        >
          Next
        </button>
      </div>
    </div>
  );
}
