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
import { saveWritebackData, testSaveConnection } from "../utils/saveService";
import { loadWritebackData, testReadConnection } from "../utils/readService";

/**
 * WritebackTable: Enhanced with Writeback functionality - Defaults to Selection Mode
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

  // Selection states
  const [selectedCells, setSelectedCells] = useState(new Set());
  const [qlikSelections, setQlikSelections] = useState(new Set());
  const [isApplyingSelection, setIsApplyingSelection] = useState(false);

  // Writeback states
  const [editedData, setEditedData] = useState({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [writebackMode, setWritebackMode] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [isLoadingWriteback, setIsLoadingWriteback] = useState(false);

  // Mode toggle state: always default to selection
  const [currentMode, setCurrentMode] = useState("selection");

  // Adding new row state
  const [addingRow, setAddingRow] = useState(false);
  const [newRowData, setNewRowData] = useState({});

  const columns = getColumns(layout);
  const rows = getRows(layout);

  // Configuration for writeback columns - detect what type of view this is
  const writebackConfig = {
    // Athlete View columns
    "MY NOTES": {
      type: "text",
      placeholder: "Enter your notes...",
      defaultValue: "",
      view: "athlete",
    },
    "COACH FEEDBACK": {
      type: "text",
      placeholder: "Coach feedback...",
      defaultValue: "",
      view: "athlete",
      readOnly: true, // Athletes can't edit coach feedback
    },
    // Coach View columns
    "ATHLETE NOTES": {
      type: "text",
      placeholder: "Athlete notes...",
      defaultValue: "",
      view: "coach",
      readOnly: true, // Coaches can't edit athlete notes
    },
    "COACH STRATEGY": {
      type: "text",
      placeholder: "Enter coaching strategy...",
      defaultValue: "",
      view: "coach",
    },
  };

  // Detect which writeback columns are present in the actual data
  const writebackColumnsPresent = columns.filter((col) =>
    Object.keys(writebackConfig).includes(col)
  );

  // Determine view type based on present columns
  const isAthleteView = writebackColumnsPresent.some(
    (col) => writebackConfig[col].view === "athlete"
  );
  const isCoachView = writebackColumnsPresent.some(
    (col) => writebackConfig[col].view === "coach"
  );

  // Auto-enable writeback mode if writeback columns are detected
  useEffect(() => {
    if (writebackColumnsPresent.length > 0) {
      setWritebackMode(true);
    }
  }, [writebackColumnsPresent.length]);

  // Load existing writeback data on mount and when layout changes
  useEffect(() => {
    async function loadExistingWritebackData() {
      if (writebackColumnsPresent.length > 0 && layout) {
        setIsLoadingWriteback(true);

        try {
          const existingData = await loadWritebackData(layout, app);
          if (existingData && Object.keys(existingData).length > 0) {
            setEditedData(existingData);
            console.log(
              `Loaded ${
                Object.keys(existingData).length
              } writeback values from automation`
            );
          }
        } catch (error) {
          console.error("Failed to load existing writeback data:", error);
        } finally {
          setIsLoadingWriteback(false);
        }
      }
    }

    loadExistingWritebackData();
  }, [layout?.qInfo?.qId, writebackColumnsPresent.length]); // Reload when app ID or writeback columns change

  if (!columns.length) {
    return (
      <div style={{ padding: 24, color: "#666" }}>
        No data yet.
        <br />
        Add a dimension and a measure.
        <br />
        <div
          style={{
            marginTop: 16,
            padding: 12,
            backgroundColor: "#f8f9fa",
            borderRadius: 4,
            fontSize: 13,
          }}
        >
          <strong>Writeback Columns:</strong>
          <br />
          <strong>Athlete View:</strong> Add "MY NOTES" and "COACH FEEDBACK" as
          dimensions
          <br />
          <strong>Coach View:</strong> Add "ATHLETE NOTES" and "COACH STRATEGY"
          as dimensions
        </div>
      </div>
    );
  }

  // Writeback functionality
  const getRowId = (row, index) => {
    // Create a unique identifier using multiple columns + row index to ensure uniqueness
    const uniqueParts = [];

    // Add first few column values to make it more unique
    if (row && row.length > 0) {
      // Use DATE + EVENT + TIME for uniqueness (or first 3 columns if available)
      for (let i = 0; i < Math.min(3, row.length); i++) {
        if (row[i] && row[i].qText) {
          uniqueParts.push(row[i].qText);
        }
      }
    }

    // Always include the actual row index as final fallback for uniqueness
    uniqueParts.push(`row-${index}`);

    return uniqueParts.join("|");
  };

  const updateEditedData = (rowId, field, value) => {
    const key = `${rowId}-${field}`;
    setEditedData((prev) => ({
      ...prev,
      [key]: value,
    }));
    setHasUnsavedChanges(true);
  };

  const getEditedValue = (rowId, field) => {
    const key = `${rowId}-${field}`;
    return editedData[key] || writebackConfig[field]?.defaultValue || "";
  };

  const saveAllChanges = async () => {
    if (!hasUnsavedChanges || Object.keys(editedData).length === 0) {
      return;
    }

    setIsSaving(true);
    setSaveStatus(null);

    try {
      const result = await saveWritebackData(editedData, layout, app);

      setSaveStatus({
        success: true,
        message: result.message,
        fileName: result.fileName,
        changeCount: result.changeCount,
        timestamp: result.timestamp,
      });

      setHasUnsavedChanges(false);
      setEditedData({});
    } catch (error) {
      console.error("Error saving changes:", error);

      setSaveStatus({
        success: false,
        message: error.message,
        timestamp: new Date().toISOString(),
      });

      // Don't clear the edited data on error so user can retry
    } finally {
      setIsSaving(false);
    }
  };

  const clearAllChanges = () => {
    setEditedData({});
    setHasUnsavedChanges(false);
    setSaveStatus(null);
  };

  // Handle manual mode changes (when user clicks mode buttons)
  const handleModeChange = (newMode) => {
    setCurrentMode(newMode);
    // When switching to selection mode, exit multi-select if active
    if (newMode === "selection" && selectionMode) {
      setSelectionMode(false);
    }
  };

  // Render writeback cell based on configuration
  const renderWritebackCell = (rowId, field, config) => {
    const value = getEditedValue(rowId, field);
    const isDisabled = config.readOnly || currentMode !== "edit"; // Disable if read-only OR not in edit mode

    if (config.type === "text") {
      return (
        <input
          type="text"
          value={value}
          onChange={(e) => updateEditedData(rowId, field, e.target.value)}
          placeholder={config.placeholder}
          readOnly={isDisabled}
          disabled={currentMode !== "edit"} // Fully disable in non-edit mode
          style={{
            width: "100%",
            padding: "6px 8px",
            border: "1px solid #ddd",
            borderRadius: "4px",
            fontSize: "13px",
            backgroundColor: isDisabled ? "#f8f9fa" : "white",
            color: isDisabled ? "#6c757d" : "#495057",
            cursor: isDisabled ? "not-allowed" : "text",
            boxSizing: "border-box",
            opacity: currentMode !== "edit" ? 0.6 : 1, // Visual indication when mode disabled
          }}
        />
      );
    } else if (config.type === "dropdown") {
      return (
        <select
          value={value}
          onChange={(e) => updateEditedData(rowId, field, e.target.value)}
          disabled={isDisabled}
          style={{
            width: "100%",
            padding: "6px 8px",
            border: "1px solid #ddd",
            borderRadius: "4px",
            fontSize: "13px",
            backgroundColor: isDisabled ? "#f8f9fa" : "white",
            cursor: isDisabled ? "not-allowed" : "pointer",
            boxSizing: "border-box",
            opacity: currentMode !== "edit" ? 0.6 : 1,
          }}
        >
          {config.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }

    return <span>{value}</span>;
  };

  // Check if a column is a writeback column
  const isWritebackColumn = (columnName) => {
    return Object.keys(writebackConfig).includes(columnName);
  };

  /**
   * Toggle individual cell selection (LOCAL ONLY - no immediate Qlik selection)
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
  }

  // Cell clicks should respect current mode
  async function onCellClick(columnIndex, cellValue, row, pageRowIndex) {
    // In edit mode, don't allow cell selection (focus on writeback editing)
    if (currentMode === "edit") {
      return;
    }

    // In selection mode, only allow selection if not in multi-select checkbox mode
    if (currentMode === "selection" && selectionMode) {
      return; // Don't do immediate selections in multi-select checkbox mode
    }

    // Regular immediate selection for selection mode
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

  // Apply batch cell selections only when button is clicked
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
        setSelectionMode(false); // Exit multi-select checkbox mode but stay in Select mode
      }
    } catch (error) {
      console.error("Error applying cell selections:", error);
    } finally {
      setTimeout(() => {
        setIsApplyingSelection(false);
      }, 100);
    }
  }

  // Clear all selections
  async function onClearAllSelections() {
    setIsApplyingSelection(true);

    try {
      const success = await clearAllQlikSelections(app, model, selections);
      if (success) {
        setSelectedRows(clearLocalSelections());
        setSelectionMode(false); // Exit multi-select checkbox mode but stay in Select mode
      }
    } catch (error) {
      console.error("Error clearing selections:", error);
    } finally {
      setTimeout(() => {
        setIsApplyingSelection(false);
      }, 100);
    }
  }

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

  // Update column widths to include writeback columns
  const columnWidths = {
    DATE: "120px",
    EVENT: "140px",
    TIME: "100px",
    TARGET: "100px",
    DIFF: "100px",
    PHASE: "120px",
    FOCUS: "140px",
    "MY NOTES": "200px",
    "COACH FEEDBACK": "200px",
    "ATHLETE NOTES": "200px",
    "COACH STRATEGY": "200px",
  };

  function handleHeaderClick(idx) {
    if (sortBy === idx) {
      setSortDir((prev) => !prev);
    } else {
      setSortBy(idx);
      setSortDir(true);
    }
    setPage(0);
  }

  function resetSort() {
    setSortBy(null);
    setSortDir(true);
    setPage(0);
  }

  function gotoPage(newPage) {
    setPage(Math.max(0, Math.min(totalPages - 1, newPage)));
  }

  const handleSaveNewRow = () => {
    // Simple validation (require swimmer/event/date/time at least)
    if (
      !newRowData["SWIMMER_NAME"] ||
      !newRowData["EVENT"] ||
      !newRowData["DATE"] ||
      !newRowData["TIME"]
    ) {
      alert("Please fill out all required fields.");
      return;
    }
    const newRowId = `new-${Date.now()}`;
    columns.forEach((col) => {
      setEditedData((prev) => ({
        ...prev,
        [`${newRowId}-${col}`]: newRowData[col] || "",
      }));
    });
    setHasUnsavedChanges(true);
    setAddingRow(false);
    setNewRowData({});
  };

  return (
    <div style={{ width: "100%", height: "100%" }}>
      {/* Mode Toggle & Controls */}
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
        {/* Left side: Mode info and status */}
        <div
          style={{
            fontSize: "14px",
            color: "#495057",
            display: "flex",
            alignItems: "center",
            gap: "16px",
          }}
        >
          {/* Mode Toggle - only show if writeback columns are present */}
          {writebackColumnsPresent.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  fontSize: "12px",
                  color: "#6c757d",
                  fontWeight: "500",
                }}
              >
                Mode:
              </span>
              <button
                onClick={() => handleModeChange("edit")}
                style={{
                  padding: "4px 8px",
                  backgroundColor:
                    currentMode === "edit" ? "#007acc" : "#e9ecef",
                  color: currentMode === "edit" ? "white" : "#6c757d",
                  border: "none",
                  borderRadius: "3px",
                  cursor: "pointer",
                  fontSize: "11px",
                  fontWeight: "500",
                }}
              >
                ✏️ Edit
              </button>
              <button
                onClick={() => handleModeChange("selection")}
                style={{
                  padding: "4px 8px",
                  backgroundColor:
                    currentMode === "selection" ? "#007acc" : "#e9ecef",
                  color: currentMode === "selection" ? "white" : "#6c757d",
                  border: "none",
                  borderRadius: "3px",
                  cursor: "pointer",
                  fontSize: "11px",
                  fontWeight: "500",
                }}
              >
                Select
              </button>
            </div>
          )}

          {/* Status information based on current mode */}
          {currentMode === "edit" && writebackColumnsPresent.length > 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              {/* View Type Indicator */}
              <span
                style={{
                  padding: "2px 8px",
                  backgroundColor: isAthleteView
                    ? "#e3f2fd"
                    : isCoachView
                    ? "#f3e5f5"
                    : "#f5f5f5",
                  color: isAthleteView
                    ? "#1976d2"
                    : isCoachView
                    ? "#7b1fa2"
                    : "#666",
                  borderRadius: "12px",
                  fontSize: "11px",
                  fontWeight: "500",
                }}
              >
                {isAthleteView && isCoachView
                  ? "Mixed View"
                  : isAthleteView
                  ? "👤 Athlete View"
                  : isCoachView
                  ? "🏃‍♂️ Coach View"
                  : "Standard View"}
              </span>

              {/* Writeback Status */}
              <span>
                {isLoadingWriteback ? (
                  <span style={{ color: "#007acc" }}>
                    Loading existing data...
                  </span>
                ) : hasUnsavedChanges ? (
                  <span style={{ color: "#dc3545", fontWeight: "500" }}>
                    <strong>{Object.keys(editedData).length}</strong> unsaved
                    changes
                  </span>
                ) : saveStatus?.success ? (
                  <span style={{ color: "#28a745" }}>
                    Saved to {saveStatus.fileName}
                  </span>
                ) : saveStatus && !saveStatus.success ? (
                  <span style={{ color: "#dc3545" }}>
                    Save failed: {saveStatus.message}
                  </span>
                ) : (
                  <span style={{ color: "#28a745" }}>All changes saved</span>
                )}
              </span>

              {/* Writeback Columns Info */}
              <span style={{ fontSize: "12px", color: "#6c757d" }}>
                Writeback: {writebackColumnsPresent.join(", ")}
              </span>
            </div>
          ) : currentMode === "selection" ? (
            <div>
              {selectedCells.size > 0 ? (
                <span>
                  <strong>{selectedCells.size}</strong> dimension values
                  selected for batch operation
                </span>
              ) : (
                <span>
                  Click dimension cells to select • Use checkboxes for batch
                  operations
                </span>
              )}
            </div>
          ) : (
            <span>Add writeback columns as dimensions for editing</span>
          )}
        </div>

        {/* Right side: Mode-specific controls */}
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {/* Loading indicators */}
          {isApplyingSelection && (
            <span style={{ fontSize: "12px", color: "#007acc" }}>
              Applying selection...
            </span>
          )}

          {isSaving && (
            <span style={{ fontSize: "12px", color: "#28a745" }}>
              Saving changes...
            </span>
          )}

          {isLoadingWriteback && (
            <span style={{ fontSize: "12px", color: "#007acc" }}>
              Loading writeback data...
            </span>
          )}

          {/* Edit Mode Controls */}
          {currentMode === "edit" && writebackColumnsPresent.length > 0 && (
            <>
              <button
                onClick={saveAllChanges}
                disabled={!hasUnsavedChanges || isSaving || isLoadingWriteback}
                style={{
                  padding: "6px 12px",
                  backgroundColor:
                    !hasUnsavedChanges || isSaving || isLoadingWriteback
                      ? "#6c757d"
                      : "#28a745",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor:
                    !hasUnsavedChanges || isSaving || isLoadingWriteback
                      ? "not-allowed"
                      : "pointer",
                  fontSize: "12px",
                  fontWeight: "500",
                }}
                title={
                  isLoadingWriteback
                    ? "Loading existing writeback data..."
                    : saveStatus?.success
                    ? `Last saved: ${saveStatus.fileName} (${saveStatus.changeCount} changes)`
                    : saveStatus && !saveStatus.success
                    ? `Save failed: ${saveStatus.message}`
                    : hasUnsavedChanges
                    ? `Save ${
                        Object.keys(editedData).length
                      } changes to Qlik Automation`
                    : "No changes to save"
                }
              >
                {isLoadingWriteback
                  ? "Loading..."
                  : isSaving
                  ? "Saving..."
                  : hasUnsavedChanges
                  ? `Save Changes (${Object.keys(editedData).length})`
                  : "No Changes"}
              </button>

              <button
                onClick={clearAllChanges}
                disabled={!hasUnsavedChanges || isSaving || isLoadingWriteback}
                style={{
                  padding: "6px 12px",
                  backgroundColor: "#dc3545",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor:
                    !hasUnsavedChanges || isSaving || isLoadingWriteback
                      ? "not-allowed"
                      : "pointer",
                  fontSize: "12px",
                }}
              >
                Clear Changes
              </button>
            </>
          )}

          {/* Selection Mode Controls */}
          {currentMode === "selection" && (
            <>
              {selectedCells.size > 0 && (
                <>
                  <button
                    onClick={onApplyCellSelections}
                    disabled={isApplyingSelection}
                    style={{
                      padding: "6px 12px",
                      backgroundColor: isApplyingSelection
                        ? "#6c757d"
                        : "#28a745",
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
                {selectionMode ? "Exit Multi Select" : "Multi Select"}
              </button>
            </>
          )}
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
        <button
          onClick={() => setAddingRow(true)}
          disabled={addingRow}
          style={{
            margin: "12px 0",
            background: "#16c784",
            color: "#fff",
            padding: "8px 18px",
            border: "none",
            borderRadius: "5px",
            fontWeight: 600,
            fontSize: "15px",
            cursor: "pointer",
          }}
        >
          + Add Entry
        </button>
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
                      cursor: isWritebackColumn(c) ? "default" : "pointer",
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
                    onClick={() =>
                      !isWritebackColumn(c) && handleHeaderClick(idx)
                    }
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
                        {isWritebackColumn(c) &&
                          !writebackConfig[c].readOnly && (
                            <span
                              style={{
                                fontSize: "10px",
                                color: "#28a745",
                                marginLeft: "4px",
                              }}
                            >
                              ✏️
                            </span>
                          )}
                      </span>
                      {sortBy === idx && !isWritebackColumn(c) && (
                        <span style={{ color: "#007acc", fontSize: "12px" }}>
                          {sortDir ? "▲" : "▼"}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
                {/* ACTIONS column header */}
                <th
                  style={{
                    minWidth: 90,
                    backgroundColor: "#f8f9fa",
                    border: "1px solid #dee2e6",
                    borderTop: "none",
                    fontWeight: "600",
                    fontSize: "14px",
                    color: "#495057",
                    textAlign: "left",
                    boxShadow: "0 2px 2px -1px rgba(0, 0, 0, 0.1)",
                  }}
                >
                  ACTIONS
                </th>
              </tr>
            </thead>

            <tbody>
              {addingRow && (
                <tr style={{ background: "#e7f9f1" }}>
                  {columns.map((col) => (
                    <td key={col}>
                      {["SWIMMER_NAME", "EVENT", "PHASE", "FOCUS"].includes(
                        col
                      ) ? (
                        <select
                          value={newRowData[col] || ""}
                          onChange={(e) =>
                            setNewRowData({
                              ...newRowData,
                              [col]: e.target.value,
                            })
                          }
                          style={{ width: "100%" }}
                        >
                          <option value="">Select</option>
                          {/* Example options - in a real app fetch unique values from Qlik if desired */}
                          {getOptionsForColumn(col).map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : col === "DATE" ? (
                        <input
                          type="date"
                          value={newRowData[col] || ""}
                          onChange={(e) =>
                            setNewRowData({
                              ...newRowData,
                              [col]: e.target.value,
                            })
                          }
                          style={{ width: "100%" }}
                        />
                      ) : (
                        <input
                          type="text"
                          value={newRowData[col] || ""}
                          onChange={(e) =>
                            setNewRowData({
                              ...newRowData,
                              [col]: e.target.value,
                            })
                          }
                          placeholder={col}
                          style={{ width: "100%" }}
                        />
                      )}
                    </td>
                  ))}
                  <td>
                    <button
                      onClick={handleSaveNewRow}
                      style={{ color: "green" }}
                    >
                      💾
                    </button>
                    <button
                      onClick={() => {
                        setAddingRow(false);
                        setNewRowData({});
                      }}
                      style={{ color: "red" }}
                    >
                      ✖️
                    </button>
                  </td>
                </tr>
              )}

              {pagedRows.map((row, i) => {
                const actualRowIndex = pageStartIndex + i;
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
                      const columnName = columns[j];
                      const cellKey = `${i}-${j}-${cell.qText}-${cell.qElemNumber}`;
                      const isCellSelected = selectedCells.has(cellKey);

                      // Check if this cell value is selected anywhere in this dimension
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

                      // Check if this is a writeback column
                      const isWriteback = isWritebackColumn(columnName);
                      const rowId = getRowId(row, actualRowIndex);

                      return (
                        <td
                          key={j}
                          style={{
                            padding: "8px",
                            border: "1px solid #eee",
                            borderTop: "none",
                            fontSize: "13px",
                            width: columnWidths[columnName] || "120px",
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                            cursor: isWriteback
                              ? "default"
                              : currentMode === "edit"
                              ? "default"
                              : currentMode === "selection" &&
                                isColumnSelectable(j, layout) &&
                                !selectionMode
                              ? "pointer"
                              : "default",
                            backgroundColor:
                              isValueSelected && currentMode === "selection"
                                ? "#d4edda"
                                : isWriteback
                                ? writebackConfig[columnName].readOnly
                                  ? "#f8f9fa"
                                  : "#fff8e1"
                                : currentMode === "selection" &&
                                  isColumnSelectable(j, layout) &&
                                  !isWriteback
                                ? "rgba(0, 123, 204, 0.05)"
                                : "transparent",
                          }}
                          title={
                            isWriteback
                              ? `${columnName} ${
                                  writebackConfig[columnName].readOnly
                                    ? "(Read-only)"
                                    : "(Editable)"
                                }`
                              : cell.qText
                          }
                          onClick={() =>
                            !isWriteback && onCellClick(j, cell, row, i)
                          }
                        >
                          {isWriteback ? (
                            // Render writeback input
                            renderWritebackCell(
                              rowId,
                              columnName,
                              writebackConfig[columnName]
                            )
                          ) : (
                            // Render regular cell
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                                justifyContent: "space-between",
                              }}
                            >
                              <span style={{ flex: 1 }}>{cell.qText}</span>

                              {currentMode === "selection" &&
                                selectionMode &&
                                isColumnSelectable(j, layout) && (
                                  <input
                                    type="checkbox"
                                    checked={isValueSelected}
                                    onChange={(e) => {
                                      e.stopPropagation();
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
                          )}
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
            {currentMode === "edit" && writebackColumnsPresent.length > 0 ? (
              <span>
                ✏️ = Editable •
                {hasUnsavedChanges && (
                  <span style={{ color: "#dc3545", marginLeft: "8px" }}>
                    {Object.keys(editedData).length} unsaved changes
                  </span>
                )}
                {!hasUnsavedChanges && (
                  <span style={{ color: "#28a745", marginLeft: "8px" }}>
                    All saved
                  </span>
                )}
              </span>
            ) : currentMode === "selection" ? (
              <span>
                Click dimension cells to select • Use checkboxes for batch
                operations
                {pageSelectionCount > 0 && (
                  <span style={{ color: "#007acc", marginLeft: "8px" }}>
                    • {pageSelectionCount} selected on page
                  </span>
                )}
              </span>
            ) : (
              <span>Add writeback columns as dimensions for editing</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function getOptionsForColumn(col) {
  if (col === "SWIMMER_NAME")
    return ["Sarah Johnson", "Alex Rodriguez", "Olivia Brown", "Michael Chen"];
  if (col === "EVENT")
    return [
      "50m Freestyle",
      "100m Freestyle",
      "200m Freestyle",
      "Butterfly",
      "Backstroke",
    ];
  if (col === "PHASE")
    return [
      "Base Training",
      "Peak",
      "Competition",
      "Build",
      "SP",
      "TE",
      "CO",
      "PE",
      "ST",
    ];
  if (col === "FOCUS")
    return [
      "Technique",
      "Race Prep",
      "Stroke Count",
      "Pacing Strategy",
      "Underwaters",
      "Speed",
      "Pace Control",
    ];
  return [];
}
