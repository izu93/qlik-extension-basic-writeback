import React, { useState } from "react";
import { getColumns, getRows } from "../utils/hypercubeUtils"; // Extract columns and rows from Qlik hypercube
import { getPagedRows } from "../utils/paginationUtils"; // Handle table pagination logic
import { sortRows } from "../utils/sortUtils"; // Handle client-side sorting functionality

/**
 * WritebackTable: Main table component for Qlik extension
 * - Displays paginated data from Qlik hypercube (100 rows per page)
 * - Supports client-side sorting by clicking column headers
 * - Features scrollable table body with aligned columns
 * - Falls back to Qlik property panel sorting when no client sort applied
 *
 * @param {Object} layout - Qlik layout object containing hypercube data
 * @param {number} pageSize - Number of rows to display per page (default: 100)
 */
export default function WritebackTable({ layout, pageSize = 100 }) {
  // Pagination state - tracks current page number
  const [page, setPage] = useState(0);

  // Sorting state - tracks which column to sort by (null = use Qlik sorting)
  const [sortBy, setSortBy] = useState(null);

  // Sort direction state - true for ascending, false for descending
  const [sortDir, setSortDir] = useState(true);

  // Extract table structure and data from Qlik layout object
  const columns = getColumns(layout); // Get column headers from dimensions + measures
  const rows = getRows(layout); // Get data matrix from hypercube

  // Show helpful message if no data configuration exists
  if (!columns.length) {
    return (
      <div style={{ padding: 24, color: "#666" }}>
        No data yet.
        <br />
        Add a dimension and a measure.
      </div>
    );
  }

  // Apply sorting - client sort overrides Qlik property panel sort
  const displayRows = sortRows(rows, sortBy, sortDir);

  // Apply pagination to sorted data
  const { pagedRows, totalPages } = getPagedRows(displayRows, page, pageSize);

  /**
   * Handle column header click for sorting
   * - Toggle direction if same column clicked again
   * - Set ascending sort for new column selection
   * - Reset to first page when sorting changes
   */
  function handleHeaderClick(idx) {
    if (sortBy === idx) {
      setSortDir((prev) => !prev); // Toggle sort direction
    } else {
      setSortBy(idx); // Set new sort column
      setSortDir(true); // Default to ascending
    }
    setPage(0); // Reset pagination to first page
  }

  /**
   * Reset sorting to use Qlik property panel order
   * - Clears client-side sort override
   * - Returns to first page
   */
  function resetSort() {
    setSortBy(null);
    setSortDir(true);
    setPage(0);
  }

  /**
   * Navigate to specific page with bounds checking
   * - Ensures page number stays within valid range
   */
  function gotoPage(newPage) {
    setPage(Math.max(0, Math.min(totalPages - 1, newPage)));
  }

  // Calculate column widths for alignment
  const columnWidths = {
    DATE: "120px",
    COACH_ID: "100px",
    COACH_NAME: "150px",
    SWIMMER_ID: "120px",
    SWIMMER_NAME: "150px",
    "avg(TIME)": "120px",
  };

  return (
    <div style={{ width: "100%", height: "100%" }}>
      {/* Single table with scrollable container */}
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: "4px",
          overflow: "hidden",
          backgroundColor: "white",
          height: "600px", // Fixed container height
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Scrollable table container */}
        <div
          style={{
            flex: 1,
            overflow: "auto",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              tableLayout: "fixed", // Fixed layout for consistent column widths
            }}
          >
            {/* Table header with sticky positioning */}
            <thead>
              <tr
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 10,
                  backgroundColor: "#f8f9fa",
                }}
              >
                {/* Render clickable column headers with sort indicators */}
                {columns.map((c, idx) => (
                  <th
                    key={c}
                    style={{
                      cursor: "pointer",
                      userSelect: "none",
                      padding: "12px 8px",
                      backgroundColor: "#f8f9fa",
                      border: "1px solid #dee2e6",
                      borderTop: "none",
                      fontWeight: "600",
                      fontSize: "14px",
                      color: "#495057",
                      width: columnWidths[c] || "120px", // Set fixed width
                      textAlign: "left",
                      boxShadow: "0 2px 2px -1px rgba(0, 0, 0, 0.1)", // Shadow for sticky header
                    }}
                    onClick={() => handleHeaderClick(idx)}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <span>{c}</span>
                      {/* Show sort direction arrow for active column */}
                      {sortBy === idx && (
                        <span style={{ color: "#007acc", fontSize: "12px" }}>
                          {sortDir ? "▲" : "▼"}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            {/* Table body with data rows */}
            <tbody>
              {pagedRows.map((row, i) => (
                <tr
                  key={i}
                  style={{
                    borderBottom: "1px solid #eee",
                    backgroundColor: i % 2 === 0 ? "#ffffff" : "#f9f9f9", // Alternating row colors
                    transition: "background-color 0.2s",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor = "#e3f2fd")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor =
                      i % 2 === 0 ? "#ffffff" : "#f9f9f9")
                  }
                >
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      style={{
                        padding: "8px",
                        border: "1px solid #eee",
                        borderTop: "none",
                        fontSize: "13px",
                        width: columnWidths[columns[j]] || "120px", // Match header width
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={cell.qText} // Show full text on hover
                    >
                      {cell.qText}{" "}
                      {/* Display formatted text value from Qlik */}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination and sorting controls */}
      <div
        style={{
          marginTop: 16,
          padding: "12px 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          borderTop: "1px solid #eee",
        }}
      >
        {/* Left side - Reset sort button */}
        <div>
          {sortBy !== null && (
            <button
              onClick={resetSort}
              style={{
                fontWeight: "500",
                padding: "6px 12px",
                backgroundColor: "#6c757d",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              Reset Sort
            </button>
          )}
        </div>

        {/* Center - Pagination controls */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <button
            onClick={() => gotoPage(page - 1)}
            disabled={page === 0}
            style={{
              padding: "6px 12px",
              backgroundColor: page === 0 ? "#e9ecef" : "#007acc",
              color: page === 0 ? "#6c757d" : "white",
              border: "none",
              borderRadius: "4px",
              cursor: page === 0 ? "not-allowed" : "pointer",
              fontSize: "12px",
            }}
          >
            Previous
          </button>

          <span
            style={{
              fontWeight: "500",
              fontSize: "14px",
              color: "#495057",
              margin: "0 8px",
            }}
          >
            Page {page + 1} of {totalPages}
          </span>

          <button
            onClick={() => gotoPage(page + 1)}
            disabled={page >= totalPages - 1}
            style={{
              padding: "6px 12px",
              backgroundColor: page >= totalPages - 1 ? "#e9ecef" : "#007acc",
              color: page >= totalPages - 1 ? "#6c757d" : "white",
              border: "none",
              borderRadius: "4px",
              cursor: page >= totalPages - 1 ? "not-allowed" : "pointer",
              fontSize: "12px",
            }}
          >
            Next
          </button>
        </div>

        {/* Right side - Row count and info */}
        <div
          style={{
            fontSize: 12,
            color: "#6c757d",
            textAlign: "right",
          }}
        >
          <div>
            Showing {pagedRows.length} of {displayRows.length} rows
          </div>
          <div style={{ fontSize: 11, marginTop: 2 }}>
            Click column headers to sort
          </div>
        </div>
      </div>
    </div>
  );
}
