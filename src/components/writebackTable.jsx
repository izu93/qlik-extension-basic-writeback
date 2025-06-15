import React, { useState } from "react";
// Import hypercube data utilities (column and row extraction)
import { getColumns, getRows } from "../utils/hypercubeUtils";
// Import pagination utility to slice rows into pages
import { getPagedRows } from "../utils/paginationUtils";

// The main WritebackTable component for rendering paginated hypercube tables
export default function WritebackTable({ layout, pageSize = 25 }) {
  // React state for the current page index (starting at 0)
  const [page, setPage] = useState(0);

  // Get the columns (header labels) and data rows from Qlik hypercube
  const columns = getColumns(layout);
  const rows = getRows(layout);

  // Defensive: if no columns are defined, show a prompt to the user
  if (!columns.length) {
    return (
      <div style={{ padding: 24, color: "#666" }}>
        No data yet.
        <br />
        Add a dimension and a measure.
      </div>
    );
  }

  // Use utility to get only the current page of rows and total number of pages
  const { pagedRows, totalPages } = getPagedRows(rows, page, pageSize);

  // Handler to safely navigate pages, preventing overflow/underflow
  function gotoPage(newPage) {
    setPage(Math.max(0, Math.min(totalPages - 1, newPage)));
  }

  // Render the table and simple pagination controls
  return (
    <div>
      {/* Table rendering */}
      <table border="1">
        <thead>
          <tr>
            {/* Render header columns */}
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Render paged rows; each cell shows qText */}
          {pagedRows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell.qText}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {/* Pagination controls */}
      <div
        style={{
          marginTop: 8,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <button onClick={() => gotoPage(page - 1)} disabled={page === 0}>
          Prev
        </button>
        <span>
          Page {page + 1} of {totalPages}
        </span>
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
