import React, { useState, useEffect } from "react";
import { getColumns, getRows } from "../utils/hypercubeUtils";
import { getPagedRows } from "../utils/paginationUtils";
import { sortRows } from "../utils/sortUtils";
import {
  handleCellClick,
  applyBatchSelections,
  clearAllQlikSelections,
  toggleRowSelection,
  clearLocalSelections,
  selectAllOnPage,
  deselectAllOnPage,
  getPageSelectionCount,
  isPageFullySelected,
  getDimensionCount,
  isColumnSelectable,
  getSelectionSummary,
} from "../utils/selectionUtils";

/**
 * WritebackTable: FIXED VERSION with better selection handling
 */
export default function WritebackTable({
  layout,
  app,
  model,
  selections,
  pageSize = 100,
}) {
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState(null);
  const [sortDir, setSortDir] = useState(true);
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [selectionMode, setSelectionMode] = useState(false);

  // FIXED: Add state to track individual cell selections (dimension values)
  const [selectedCells, setSelectedCells] = useState(new Set());

  // FIXED: Add state to track Qlik selections for visual feedback
  const [qlikSelections, setQlikSelections] = useState(new Set());

  // FIXED: Add loading state for better UX during selections
  const [isApplyingSelection, setIsApplyingSelection] = useState(false);

  const columns = getColumns(layout);
  const rows = getRows(layout);

  if (!columns.length) {
    return (
      <div style={{ padding: 24, color: "#666" }}>
        No data yet.
        <br />
        Add a dimension and a measure.
      </div>
    );
  }

  // FIXED: Optimize layout effect to reduce flickering - don't update qlikSelections for visual feedback
  useEffect(() => {
    // Just let Qlik handle its own selection states, don't track them visually
    // This prevents the green row highlighting after selections
  }, [layout]);

  const displayRows = sortRows(rows, sortBy, sortDir);
  const { pagedRows, totalPages } = getPagedRows(displayRows, page, pageSize);
  const dimensionCount = getDimensionCount(layout);
  const selectionSummary = getSelectionSummary(
    selectedRows,
    displayRows.length
  );
  const pageStartIndex = page * pageSize;
  const pageSelectionCount = getPageSelectionCount(
    selectedRows,
    pageStartIndex,
    pageSize,
    displayRows.length
  );
  const isPageFullySelectedState = isPageFullySelected(
    selectedRows,
    pageStartIndex,
    pageSize,
    displayRows.length
  );

  function handleHeaderClick(idx) {
    if (sortBy === idx) {
      setSortDir((prev) => !prev);
    } else {
      setSortBy(idx);
      setSortDir(true);
    }
    setPage(0);
  }

  /**
   * Toggle individual cell selection (LOCAL ONLY - no immediate Qlik selection)
   * FIXED: When selecting/deselecting, handle all matching values in the same dimension
   */
  function handleCellSelection(rowIndex, columnIndex, cellValue) {
    const cellKey = `${rowIndex}-${columnIndex}-${cellValue.qText}-${cellValue.qElemNumber}`;
    const newSelections = new Set(selectedCells);

    const isCurrentlySelected = newSelections.has(cellKey);

    if (isCurrentlySelected) {
      // Deselect: Remove ALL instances of this value in this dimension
      const keysToRemove = [];
      for (const key of newSelections) {
        const [, keyColIndex, keyText, keyElemNumber] = key.split("-");
        if (
          parseInt(keyColIndex) === columnIndex &&
          keyText === cellValue.qText &&
          keyElemNumber === String(cellValue.qElemNumber)
        ) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => newSelections.delete(key));
    } else {
      // Select: Add ALL instances of this value in this dimension from current page
      pagedRows.forEach((row, i) => {
        if (
          row[columnIndex] &&
          row[columnIndex].qText === cellValue.qText &&
          row[columnIndex].qElemNumber === cellValue.qElemNumber
        ) {
          const keyForThisRow = `${i}-${columnIndex}-${row[columnIndex].qText}-${row[columnIndex].qElemNumber}`;
          newSelections.add(keyForThisRow);
        }
      });
    }

    setSelectedCells(newSelections);
    // FIXED: No immediate Qlik selection - just local state change
  }

  // FIXED: Cell clicks should not trigger immediate selection in selection mode
  async function onCellClick(columnIndex, cellValue, row, pageRowIndex) {
    // FIXED: In selection mode, only allow checkbox interaction, not cell clicks
    if (selectionMode) {
      return; // Don't do immediate selections in selection mode
    }

    // Regular immediate selection for non-selection mode
    try {
      const success = await handleCellClick(
        app,
        layout,
        columnIndex,
        cellValue,
        row,
        model,
        selections,
        pageRowIndex,
        page + 1,
        pageSize
      );

      if (success) {
        console.log("Cell selection completed, waiting for layout update...");
      }
    } catch (error) {
      console.error("Error in cell click:", error);
    }
  }

  // FIXED: Apply batch cell selections only when button is clicked
  async function onApplyCellSelections() {
    setIsApplyingSelection(true);

    try {
      // Group selections by field (dimension)
      const fieldSelections = {};

      selectedCells.forEach((cellKey) => {
        const [rowIndex, columnIndex, cellText, elemNumber] =
          cellKey.split("-");
        const row = pagedRows[parseInt(rowIndex)];
        const colIdx = parseInt(columnIndex);

        if (row && isColumnSelectable(colIdx, layout)) {
          const dimensionInfo = layout.qHyperCube.qDimensionInfo[colIdx];
          const fieldName =
            dimensionInfo?.qGroupFieldDefs?.[0] ||
            dimensionInfo?.qFallbackTitle ||
            dimensionInfo?.cId;

          if (fieldName && row[colIdx]) {
            if (!fieldSelections[fieldName]) {
              fieldSelections[fieldName] = new Set();
            }

            // Use a unique key to avoid duplicates
            const valueKey = `${row[colIdx].qText}|${row[colIdx].qElemNumber}`;
            if (
              !Array.from(fieldSelections[fieldName]).some(
                (v) => `${v.qText}|${v.qElemNumber}` === valueKey
              )
            ) {
              fieldSelections[fieldName].add({
                qText: row[colIdx].qText,
                qElemNumber: row[colIdx].qElemNumber,
                qIsNumeric:
                  !isNaN(row[colIdx].qNum) && row[colIdx].qNum !== null,
                qNumber: isNaN(row[colIdx].qNum) ? undefined : row[colIdx].qNum,
              });
            }
          }
        }
      });

      // Apply selections to each field
      let success = false;
      for (const [fieldName, valueSet] of Object.entries(fieldSelections)) {
        const values = Array.from(valueSet);
        try {
          let field;
          if (typeof app.getField === "function") {
            field = await app.getField(fieldName);
          } else if (typeof app.field === "function") {
            field = await app.field(fieldName);
          }

          if (field && values.length > 0) {
            await field.selectValues(values, false, false);

            success = true;
          }
        } catch (fieldError) {
          console.error(`Failed to select in field ${fieldName}:`, fieldError);
        }
      }

      if (success) {
        setSelectedCells(new Set()); // Clear local selections
        setSelectionMode(false); // Exit selection mode
      }
    } catch (error) {
      console.error("Error applying cell selections:", error);
    } finally {
      setTimeout(() => {
        setIsApplyingSelection(false);
      }, 100);
    }
  }

  // FIXED: Smoother clear all selections
  async function onClearAllSelections() {
    setIsApplyingSelection(true);

    try {
      const success = await clearAllQlikSelections(app, model, selections);
      if (success) {
        setSelectedRows(clearLocalSelections());
        setSelectionMode(false);
        // Don't manually clear qlikSelections - let layout update handle it
      }
    } catch (error) {
      console.error("Error clearing selections:", error);
    } finally {
      // Add a small delay to prevent flashing
      setTimeout(() => {
        setIsApplyingSelection(false);
      }, 100);
    }
  }

  function togglePageSelection() {
    if (isPageFullySelectedState) {
      const newSelections = deselectAllOnPage(
        selectedRows,
        pageStartIndex,
        pageSize,
        displayRows.length
      );
      setSelectedRows(newSelections);
    } else {
      const newSelections = selectAllOnPage(
        selectedRows,
        pageStartIndex,
        pageSize,
        displayRows.length
      );
      setSelectedRows(newSelections);
    }
  }

  function resetSort() {
    setSortBy(null);
    setSortDir(true);
    setPage(0);
  }

  function gotoPage(newPage) {
    setPage(Math.max(0, Math.min(totalPages - 1, newPage)));
  }

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
      {/* Selection controls */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 0",
          marginBottom: "8px",
          borderBottom: "1px solid #eee",
        }}
      >
        <div style={{ fontSize: "14px", color: "#495057" }}>
          {selectedCells.size > 0 ? (
            <span>
              <strong>{selectedCells.size}</strong> dimension values selected
              for batch operation
            </span>
          ) : (
            <span>
              Click dimension cells to select • Use checkboxes in Selection Mode
              for batch operation
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {/* FIXED: Loading indicator */}
          {isApplyingSelection && (
            <span style={{ fontSize: "12px", color: "#007acc" }}>
              Applying selection...
            </span>
          )}

          {selectedCells.size > 0 && (
            <>
              <button
                onClick={onApplyCellSelections}
                disabled={isApplyingSelection}
                style={{
                  padding: "6px 12px",
                  backgroundColor: isApplyingSelection ? "#6c757d" : "#28a745",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: isApplyingSelection ? "not-allowed" : "pointer",
                  fontSize: "12px",
                  fontWeight: "500",
                }}
              >
                {isApplyingSelection
                  ? "Applying..."
                  : `Apply Cell Selections (${selectedCells.size})`}
              </button>
              <button
                onClick={() => setSelectedCells(new Set())}
                disabled={isApplyingSelection}
                style={{
                  padding: "6px 12px",
                  backgroundColor: "#6c757d",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: isApplyingSelection ? "not-allowed" : "pointer",
                  fontSize: "12px",
                }}
              >
                Clear Cell Selections
              </button>
            </>
          )}

          <button
            onClick={() => setSelectionMode(!selectionMode)}
            disabled={isApplyingSelection}
            style={{
              padding: "6px 12px",
              backgroundColor: selectionMode ? "#ffc107" : "#007acc",
              color: selectionMode ? "#000" : "white",
              border: "none",
              borderRadius: "4px",
              cursor: isApplyingSelection ? "not-allowed" : "pointer",
              fontSize: "12px",
            }}
          >
            {selectionMode ? "Exit Selection Mode" : "Selection Mode"}
          </button>

          <button
            onClick={onClearAllSelections}
            disabled={isApplyingSelection}
            style={{
              padding: "6px 12px",
              backgroundColor: isApplyingSelection ? "#6c757d" : "#6c757d", // Changed to grey
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: isApplyingSelection ? "not-allowed" : "pointer",
              fontSize: "12px",
            }}
          >
            {isApplyingSelection ? "Clearing..." : "Clear All"}
          </button>
        </div>
      </div>

      {/* Table container */}
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: "4px",
          overflow: "hidden",
          backgroundColor: "white",
          height: "600px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ flex: 1, overflow: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              tableLayout: "fixed",
            }}
          >
            <thead>
              <tr
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 10,
                  backgroundColor: "#f8f9fa",
                }}
              >
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
                      width: columnWidths[c] || "120px",
                      textAlign: "left",
                      boxShadow: "0 2px 2px -1px rgba(0, 0, 0, 0.1)",
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
                      <span>
                        {c}
                        {isColumnSelectable(idx, layout) && (
                          <span
                            style={{
                              fontSize: "10px",
                              color: "#007acc",
                              marginLeft: "4px",
                            }}
                          >
                            ✓
                          </span>
                        )}
                      </span>
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

            <tbody>
              {pagedRows.map((row, i) => {
                const actualRowIndex = pageStartIndex + i;
                // FIXED: Remove green coloring for Qlik selected rows
                const backgroundColor = i % 2 === 0 ? "#ffffff" : "#f9f9f9";

                return (
                  <tr
                    key={i}
                    style={{
                      borderBottom: "1px solid #eee",
                      backgroundColor,
                      transition: "background-color 0.2s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = "#f0f8ff";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = backgroundColor;
                    }}
                  >
                    {row.map((cell, j) => {
                      const cellKey = `${i}-${j}-${cell.qText}-${cell.qElemNumber}`;
                      const isCellSelected = selectedCells.has(cellKey);

                      // FIXED: Check if this cell value is selected anywhere in this dimension
                      const isValueSelected =
                        isColumnSelectable(j, layout) &&
                        Array.from(selectedCells).some((selectedKey) => {
                          const [
                            ,
                            selectedColIndex,
                            selectedText,
                            selectedElemNumber,
                          ] = selectedKey.split("-");
                          return (
                            parseInt(selectedColIndex) === j &&
                            selectedText === cell.qText &&
                            selectedElemNumber === String(cell.qElemNumber)
                          );
                        });

                      return (
                        <td
                          key={j}
                          style={{
                            padding: "4px 8px",
                            border: "1px solid #eee",
                            borderTop: "none",
                            fontSize: "13px",
                            width: columnWidths[columns[j]] || "120px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            cursor:
                              isColumnSelectable(j, layout) && !selectionMode
                                ? "pointer" // Only show pointer when NOT in selection mode
                                : "default",
                            backgroundColor: isValueSelected
                              ? "#d4edda" // FIXED: Light green for selected values (instead of yellow)
                              : isColumnSelectable(j, layout)
                              ? "rgba(0, 123, 204, 0.05)" // Always highlight dimension columns
                              : "transparent",
                          }}
                          title={cell.qText}
                          onClick={() => onCellClick(j, cell, row, i)}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                              justifyContent: "space-between",
                            }}
                          >
                            <span style={{ flex: 1 }}>{cell.qText}</span>

                            {/* FIXED: Checkbox shows checked if this value is selected anywhere */}
                            {selectionMode && isColumnSelectable(j, layout) && (
                              <input
                                type="checkbox"
                                checked={isValueSelected}
                                onChange={(e) => {
                                  e.stopPropagation(); // Prevent cell click
                                  handleCellSelection(i, j, cell);
                                }}
                                style={{
                                  width: "12px",
                                  height: "12px",
                                  cursor: "pointer",
                                  flexShrink: 0,
                                }}
                                title={`Select all instances of "${cell.qText}" for batch operation`}
                              />
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination controls */}
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

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
            Click dimension cells to select • ✓ = Selectable
            {pageSelectionCount > 0 && (
              <span style={{ color: "#007acc", marginLeft: "8px" }}>
                • {pageSelectionCount} selected on page
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
