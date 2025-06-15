import React, { useState } from "react";
import { getColumns, getRows } from "../utils/hypercubeUtils"; // Your hypercube utilities
import { getPagedRows } from "../utils/paginationUtils"; // Your pagination utility
import { sortRows } from "../utils/sortUtils"; // The new sort utility

/**
 * WritebackTable: Renders a paginated and sortable Qlik table.
 * Sorting can be controlled by user header click, or via the Qlik property panel.
 */
export default function WritebackTable({ layout, pageSize = 25 }) {
  // State for page number (pagination)
  const [page, setPage] = useState(0);
  // State for sorting: column index (null = Qlik property panel), and direction
  const [sortBy, setSortBy] = useState(null);
  const [sortDir, setSortDir] = useState(true); // true: ascending, false: descending

  // Extract columns and data rows from layout
  const columns = getColumns(layout);
  const rows = getRows(layout);

  // Defensive UI: Show a helpful message if no dimensions/measures set up
  if (!columns.length) {
    return (
      <div style={{ padding: 24, color: "#666" }}>
        No data yet.
        <br />
        Add a dimension and a measure.
      </div>
    );
  }

  // Use the utility to get the sorted rows (UI sort overrides Qlik panel sort)
  const displayRows = sortRows(rows, sortBy, sortDir);

  // Paginate the sorted rows
  const { pagedRows, totalPages } = getPagedRows(displayRows, page, pageSize);

  // Handler: User clicks table header to sort
  function handleHeaderClick(idx) {
    if (sortBy === idx) {
      // If already sorting by this column, toggle direction
      setSortDir((prev) => !prev);
    } else {
      // If new column, set ascending sort
      setSortBy(idx);
      setSortDir(true);
    }
    setPage(0); // Reset to first page on sort
  }

  // Handler: Reset sort to use Qlik property panel order
  function resetSort() {
    setSortBy(null);
    setSortDir(true);
    setPage(0);
  }

  // Handler: Change pages, clamped to valid range
  function gotoPage(newPage) {
    setPage(Math.max(0, Math.min(totalPages - 1, newPage)));
  }

  return (
    <div>
      {/* Data Table */}
      <table border="1">
        <thead>
          <tr>
            {/* Render table headers with clickable sorting */}
            {columns.map((c, idx) => (
              <th
                key={c}
                style={{ cursor: "pointer", userSelect: "none" }}
                onClick={() => handleHeaderClick(idx)}
              >
                {c}
                {/* If currently sorted by this column, show arrow */}
                {sortBy === idx ? (sortDir ? " ▲" : " ▼") : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Render visible page of rows */}
          {pagedRows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell.qText}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {/* Pagination & Sort Controls */}
      <div
        style={{
          marginTop: 8,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        {/* Reset sort button if user has sorted with the UI */}
        {sortBy !== null && (
          <button onClick={resetSort} style={{ fontWeight: "bold" }}>
            Reset Sort
          </button>
        )}
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
      {/* UI Hint for sorting */}
      <div style={{ fontSize: 12, marginTop: 4, color: "#888" }}>
        <span>
          Sorting follows Qlik property panel unless you click a column header.
        </span>
      </div>
    </div>
  );
}
