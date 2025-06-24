import React, { useState, useEffect, useCallback } from "react";
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
import {
  getKeyDimensionsConfig,
  getActiveKeyDimensions,
  generateRowKey,
  createEnhancedRowId,
  validateKeyUniqueness,
  isKeyDimension,
  getKeyDimensionsSummary,
} from "../utils/keyDimensionsUtils";
import {
  getAllColumns,
  getBaseColumns,
  getEnhancedRows,
  isWritebackColumnIndex,
  getWritebackColumnName,
  hasWritebackColumns,
  getWritebackColumnConfig,
  shouldShowModeButtons,
  getBaseColumnCount,
  mapToBaseColumnIndex,
  isColumnSelectable as isDynamicColumnSelectable,
  getBaseDimensionCount,
  isBaseDimension,
} from "../utils/dynamicColumnsUtils";

/**
 * WritebackTable: Dynamic Columns + Key Dimensions Support
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
  const [saveStatus, setSaveStatus] = useState(null);
  const [isLoadingWriteback, setIsLoadingWriteback] = useState(false);

  // Mode toggle state: always default to selection
  const [currentMode, setCurrentMode] = useState("selection");

  // Auto-save timer
  const [autoSaveTimer, setAutoSaveTimer] = useState(null);

  // Use dynamic columns system
  const columns = getAllColumns(layout);
  const baseColumns = getBaseColumns(layout);
  const rows = getEnhancedRows(layout);

  // Get key dimensions configuration (use base columns for key dimensions)
  const keyDimensionsConfig = getKeyDimensionsConfig(layout);
  const activeKeyDimensions = getActiveKeyDimensions(layout, baseColumns);
  const keyDimensionsSummary = getKeyDimensionsSummary(layout, baseColumns);

  // Validate key uniqueness if enabled (use base rows)
  const baseRows = getRows(layout);
  const keyValidation = validateKeyUniqueness(baseRows, layout, baseColumns);

  // Get dynamic writeback configuration from layout
  const writebackConfig = layout?.writebackConfig || {
    enabled: false,
    columns: [],
  };
  const hasActiveWriteback = shouldShowModeButtons(layout);
  const configuredColumns = writebackConfig.columns || [];

  // Create a map of writeback columns for quick lookup
  const writebackColumnMap = new Map();
  configuredColumns.forEach((config) => {
    writebackColumnMap.set(config.columnName, config);
  });

  // Auto-save functionality
  const scheduleAutoSave = useCallback(() => {
    if (writebackConfig.saveMode === "auto" && hasUnsavedChanges) {
      if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
      }

      const delay = (writebackConfig.autoSaveDelay || 2) * 1000;
      const timer = setTimeout(() => {
        saveAllChanges();
      }, delay);

      setAutoSaveTimer(timer);
    }
  }, [
    writebackConfig.saveMode,
    writebackConfig.autoSaveDelay,
    hasUnsavedChanges,
    autoSaveTimer,
  ]);

  // Batch save functionality
  useEffect(() => {
    if (writebackConfig.saveMode === "batch" && hasUnsavedChanges) {
      const interval = (writebackConfig.batchSaveInterval || 5) * 60 * 1000;
      const timer = setInterval(() => {
        if (hasUnsavedChanges) {
          saveAllChanges();
        }
      }, interval);

      return () => clearInterval(timer);
    }
  }, [
    writebackConfig.saveMode,
    writebackConfig.batchSaveInterval,
    hasUnsavedChanges,
  ]);

  // Load existing writeback data on mount and when layout changes
  useEffect(() => {
    async function loadExistingWritebackData() {
      if (hasActiveWriteback && layout) {
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
  }, [layout?.qInfo?.qId, hasActiveWriteback]);

  // Cleanup auto-save timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
      }
    };
  }, [autoSaveTimer]);

  if (!columns.length) {
    return (
      <div style={{ padding: 24, color: "#666" }}>
        No data yet.
        <br />
        Add dimensions and measures to your table.
        <br />
        {!writebackConfig.enabled ? (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              backgroundColor: "#f8f9fa",
              borderRadius: 4,
              fontSize: 13,
            }}
          >
            <strong>Writeback:</strong> Disabled
            <br />
            <em>
              Enable writeback in the property panel to add editable columns.
            </em>
          </div>
        ) : configuredColumns.length === 0 ? (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              backgroundColor: "#fff3cd",
              color: "#856404",
              borderRadius: 4,
              fontSize: 13,
            }}
          >
            <strong>Writeback Enabled:</strong> No columns configured
            <br />
            <em>
              Add writeback columns in the property panel - they will appear
              automatically!
            </em>
          </div>
        ) : (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              backgroundColor: "#d1ecf1",
              color: "#0c5460",
              borderRadius: 4,
              fontSize: 13,
            }}
          >
            <strong>Writeback Ready:</strong> {configuredColumns.length} column
            {configuredColumns.length !== 1 ? "s" : ""} configured
            <br />
            <strong>Columns:</strong>{" "}
            {configuredColumns.map((col) => col.columnName).join(", ")}
            <br />
            <em>
              Writeback columns will appear automatically when you add data!
            </em>
          </div>
        )}
        {/* Key Dimensions Information */}
        {keyDimensionsSummary.hasKeyDimensions && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              backgroundColor: "#e3f2fd",
              color: "#1976d2",
              borderRadius: 4,
              fontSize: 13,
            }}
          >
            <strong>🔑 Key Dimensions:</strong> {keyDimensionsSummary.message}
            <br />
            {!keyValidation.isValid && (
              <div style={{ color: "#d32f2f", marginTop: 4 }}>
                <strong>⚠️ Warning:</strong> {keyValidation.duplicates.length}{" "}
                duplicate key{keyValidation.duplicates.length !== 1 ? "s" : ""}{" "}
                found!
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Writeback functionality with enhanced row ID using key dimensions
  const getRowId = (row, index) => {
    // Use enhanced row ID that combines key dimensions with fallback
    return createEnhancedRowId(row, index, layout, baseColumns);
  };

  const updateEditedData = (rowId, field, value) => {
    const key = `${rowId}-${field}`;
    setEditedData((prev) => ({
      ...prev,
      [key]: value,
    }));
    setHasUnsavedChanges(true);

    // Schedule auto-save if enabled
    scheduleAutoSave();
  };

  const getEditedValue = (rowId, field) => {
    const key = `${rowId}-${field}`;
    const config = writebackColumnMap.get(field);
    return editedData[key] || config?.defaultValue || "";
  };

  const validateField = (value, config) => {
    if (!config.validation) return { isValid: true };

    const validation = config.validation;

    // Required field validation
    if (config.required && (!value || value.trim() === "")) {
      return { isValid: false, message: "This field is required" };
    }

    // Type-specific validation
    switch (config.columnType) {
      case "text":
      case "textarea":
        if (validation.minLength && value.length < validation.minLength) {
          return {
            isValid: false,
            message: `Minimum length is ${validation.minLength}`,
          };
        }
        if (validation.maxLength && value.length > validation.maxLength) {
          return {
            isValid: false,
            message: `Maximum length is ${validation.maxLength}`,
          };
        }
        break;

      case "number":
        const numValue = parseFloat(value);
        if (isNaN(numValue)) {
          return { isValid: false, message: "Please enter a valid number" };
        }
        if (validation.min !== undefined && numValue < validation.min) {
          return {
            isValid: false,
            message: `Minimum value is ${validation.min}`,
          };
        }
        if (validation.max !== undefined && numValue > validation.max) {
          return {
            isValid: false,
            message: `Maximum value is ${validation.max}`,
          };
        }
        break;
    }

    return { isValid: true };
  };

  const saveAllChanges = async () => {
    if (!hasUnsavedChanges || Object.keys(editedData).length === 0) {
      return;
    }

    // Validate all fields if required
    const validationErrors = [];
    Object.entries(editedData).forEach(([key, value]) => {
      const field = key.split("-").pop();
      const config = writebackColumnMap.get(field);
      if (config) {
        const validation = validateField(value, config);
        if (!validation.isValid) {
          validationErrors.push(`${field}: ${validation.message}`);
        }
      }
    });

    if (validationErrors.length > 0) {
      setSaveStatus({
        success: false,
        message: `Validation errors: ${validationErrors.join("; ")}`,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Confirm before save if enabled
    if (writebackConfig.confirmBeforeSave) {
      const confirmed = window.confirm(
        `Save ${Object.keys(editedData).length} changes?`
      );
      if (!confirmed) return;
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

      // Clear auto-save timer
      if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
        setAutoSaveTimer(null);
      }
    } catch (error) {
      console.error("Error saving changes:", error);

      setSaveStatus({
        success: false,
        message: error.message,
        timestamp: new Date().toISOString(),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const clearAllChanges = () => {
    setEditedData({});
    setHasUnsavedChanges(false);
    setSaveStatus(null);

    // Clear auto-save timer
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      setAutoSaveTimer(null);
    }
  };

  const handleModeChange = (newMode) => {
    setCurrentMode(newMode);
    if (newMode === "selection" && selectionMode) {
      setSelectionMode(false);
    }
  };

  // Render writeback cell based on dynamic configuration
  const renderWritebackCell = (rowId, field, config) => {
    const value = getEditedValue(rowId, field);
    const isDisabled = config.readOnly || currentMode !== "edit";
    const validation = validateField(value, config);

    const baseStyle = {
      width: "100%",
      padding: "6px 8px",
      border: `1px solid ${!validation.isValid ? "#dc3545" : "#ddd"}`,
      borderRadius: "4px",
      fontSize: "13px",
      backgroundColor: isDisabled ? "#f8f9fa" : "white",
      color: isDisabled ? "#6c757d" : "#495057",
      cursor: isDisabled ? "not-allowed" : "text",
      boxSizing: "border-box",
      opacity: currentMode !== "edit" ? 0.6 : 1,
    };

    const handleChange = (newValue) => {
      updateEditedData(rowId, field, newValue);
    };

    switch (config.columnType) {
      case "text":
        return (
          <div>
            <input
              type="text"
              value={value}
              onChange={(e) => handleChange(e.target.value)}
              placeholder={config.placeholder}
              readOnly={config.readOnly}
              disabled={currentMode !== "edit"}
              style={baseStyle}
              title={!validation.isValid ? validation.message : undefined}
            />
            {!validation.isValid && (
              <div
                style={{ fontSize: "10px", color: "#dc3545", marginTop: "2px" }}
              >
                {validation.message}
              </div>
            )}
          </div>
        );

      case "textarea":
        return (
          <div>
            <textarea
              value={value}
              onChange={(e) => handleChange(e.target.value)}
              placeholder={config.placeholder}
              readOnly={config.readOnly}
              disabled={currentMode !== "edit"}
              rows={2}
              style={{
                ...baseStyle,
                resize: "vertical",
                minHeight: "40px",
              }}
              title={!validation.isValid ? validation.message : undefined}
            />
            {!validation.isValid && (
              <div
                style={{ fontSize: "10px", color: "#dc3545", marginTop: "2px" }}
              >
                {validation.message}
              </div>
            )}
          </div>
        );

      case "number":
        return (
          <div>
            <input
              type="number"
              value={value}
              onChange={(e) => handleChange(e.target.value)}
              placeholder={config.placeholder}
              readOnly={config.readOnly}
              disabled={currentMode !== "edit"}
              min={config.validation?.min}
              max={config.validation?.max}
              style={baseStyle}
              title={!validation.isValid ? validation.message : undefined}
            />
            {!validation.isValid && (
              <div
                style={{ fontSize: "10px", color: "#dc3545", marginTop: "2px" }}
              >
                {validation.message}
              </div>
            )}
          </div>
        );

      case "dropdown":
        const options = config.dropdownOptions
          ? config.dropdownOptions.split(",").map((opt) => opt.trim())
          : [];
        return (
          <select
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            disabled={isDisabled}
            style={baseStyle}
          >
            <option value="">{config.placeholder || "Select..."}</option>
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        );

      case "date":
        return (
          <input
            type="date"
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            readOnly={config.readOnly}
            disabled={currentMode !== "edit"}
            style={baseStyle}
          />
        );

      case "checkbox":
        return (
          <input
            type="checkbox"
            checked={value === "true" || value === true}
            onChange={(e) => handleChange(e.target.checked)}
            disabled={isDisabled}
            style={{
              width: "16px",
              height: "16px",
              cursor: isDisabled ? "not-allowed" : "pointer",
            }}
          />
        );

      default:
        return <span>{value}</span>;
    }
  };

  // Check if a column is a writeback column
  const isWritebackColumn = (columnIndex) => {
    return isWritebackColumnIndex(columnIndex, layout);
  };

  // Cell selection functionality (only for base columns)
  function handleCellSelection(rowIndex, columnIndex, cellValue) {
    // Only allow selection for base columns
    if (isWritebackColumn(columnIndex)) return;

    const cellKey = `${rowIndex}-${columnIndex}-${cellValue.qText}-${cellValue.qElemNumber}`;
    const newSelections = new Set(selectedCells);

    const isCurrentlySelected = newSelections.has(cellKey);

    if (isCurrentlySelected) {
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

  // Cell click handling (only for base columns)
  async function onCellClick(columnIndex, cellValue, row, pageRowIndex) {
    if (currentMode === "edit") {
      return;
    }

    if (currentMode === "selection" && selectionMode) {
      return;
    }

    // Don't allow clicks on writeback columns
    if (isWritebackColumn(columnIndex)) {
      return;
    }

    // Map to base column index for selection
    const baseColumnIndex = mapToBaseColumnIndex(columnIndex, layout);
    if (baseColumnIndex === -1) return;

    try {
      const success = await handleCellClick(
        app,
        layout,
        baseColumnIndex,
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

  // Apply cell selections (only for base columns)
  async function onApplyCellSelections() {
    setIsApplyingSelection(true);

    try {
      const fieldSelections = {};

      selectedCells.forEach((cellKey) => {
        const [rowIndex, columnIndex, cellText, elemNumber] =
          cellKey.split("-");
        const row = pagedRows[parseInt(rowIndex)];
        const colIdx = parseInt(columnIndex);

        // Only process base columns
        if (isWritebackColumn(colIdx)) return;

        const baseColIdx = mapToBaseColumnIndex(colIdx, layout);
        if (baseColIdx === -1) return;

        if (row && isDynamicColumnSelectable(colIdx, layout)) {
          const dimensionInfo = layout.qHyperCube.qDimensionInfo[baseColIdx];
          const fieldName =
            dimensionInfo?.qGroupFieldDefs?.[0] ||
            dimensionInfo?.qFallbackTitle ||
            dimensionInfo?.cId;

          if (fieldName && row[colIdx]) {
            if (!fieldSelections[fieldName]) {
              fieldSelections[fieldName] = new Set();
            }

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
        setSelectedCells(new Set());
        setSelectionMode(false);
      }
    } catch (error) {
      console.error("Error applying cell selections:", error);
    } finally {
      setTimeout(() => {
        setIsApplyingSelection(false);
      }, 100);
    }
  }

  // Clear selections
  async function onClearAllSelections() {
    setIsApplyingSelection(true);

    try {
      const success = await clearAllQlikSelections(app, model, selections);
      if (success) {
        setSelectedRows(clearLocalSelections());
        setSelectionMode(false);
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
  const pageStartIndex = page * pageSize;
  const pageSelectionCount = getPageSelectionCount(
    selectedRows,
    pageStartIndex,
    pageSize,
    displayRows.length
  );

  // Dynamic column widths based on configuration
  const getColumnWidth = (columnIndex) => {
    if (isWritebackColumn(columnIndex)) {
      const columnName = getWritebackColumnName(columnIndex, layout);
      const config = writebackColumnMap.get(columnName);
      if (config && config.width) {
        return config.width;
      }
      return "200px"; // Default width for writeback columns
    }

    // Default widths for base columns
    const columnName = baseColumns[columnIndex] || "";
    const defaultWidths = {
      DATE: "120px",
      EVENT: "140px",
      TIME: "100px",
      TARGET: "100px",
      DIFF: "100px",
      PHASE: "120px",
      FOCUS: "140px",
    };

    return defaultWidths[columnName] || "120px";
  };

  function handleHeaderClick(idx) {
    // Don't allow sorting on writeback columns
    if (!isWritebackColumn(idx)) {
      if (sortBy === idx) {
        setSortDir((prev) => !prev);
      } else {
        setSortBy(idx);
        setSortDir(true);
      }
      setPage(0);
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
          {/* Mode Toggle - only show if writeback is active */}
          {hasActiveWriteback && (
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
          {currentMode === "edit" && hasActiveWriteback ? (
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              {/* Writeback Configuration Info */}
              <span
                style={{
                  padding: "2px 8px",
                  backgroundColor: "#e3f2fd",
                  color: "#1976d2",
                  borderRadius: "12px",
                  fontSize: "11px",
                  fontWeight: "500",
                }}
              >
                📝 {configuredColumns.length} Writeback Column
                {configuredColumns.length !== 1 ? "s" : ""}
              </span>

              {/* Save Mode Indicator */}
              <span
                style={{
                  padding: "2px 8px",
                  backgroundColor:
                    writebackConfig.saveMode === "auto"
                      ? "#fff3cd"
                      : writebackConfig.saveMode === "batch"
                      ? "#d1ecf1"
                      : "#f8f9fa",
                  color:
                    writebackConfig.saveMode === "auto"
                      ? "#856404"
                      : writebackConfig.saveMode === "batch"
                      ? "#0c5460"
                      : "#6c757d",
                  borderRadius: "12px",
                  fontSize: "11px",
                  fontWeight: "500",
                }}
              >
                {writebackConfig.saveMode === "auto"
                  ? "🔄 Auto Save"
                  : writebackConfig.saveMode === "batch"
                  ? "⏱️ Batch Save"
                  : "💾 Manual Save"}
              </span>

              {/* Key Dimensions Info */}
              {keyDimensionsSummary.hasKeyDimensions && (
                <span
                  style={{
                    padding: "2px 8px",
                    backgroundColor: "#e8f5e8",
                    color: "#2e7d32",
                    borderRadius: "12px",
                    fontSize: "11px",
                    fontWeight: "500",
                  }}
                >
                  🔑 {keyDimensionsSummary.keyDimensionNames.join("+")}
                  {!keyValidation.isValid && (
                    <span style={{ color: "#d32f2f", marginLeft: "4px" }}>
                      ⚠️
                    </span>
                  )}
                </span>
              )}

              {/* Writeback Status */}
              <span>
                {isLoadingWriteback ? (
                  <span style={{ color: "#007acc" }}>
                    Loading existing data...
                  </span>
                ) : hasUnsavedChanges ? (
                  <span style={{ color: "#dc3545", fontWeight: "500" }}>
                    <strong>{Object.keys(editedData).length}</strong> unsaved
                    change{Object.keys(editedData).length !== 1 ? "s" : ""}
                    {writebackConfig.saveMode === "auto" && autoSaveTimer && (
                      <span style={{ color: "#ffc107", marginLeft: "8px" }}>
                        (Auto-saving...)
                      </span>
                    )}
                  </span>
                ) : saveStatus?.success ? (
                  <span style={{ color: "#28a745" }}>
                    ✅ Saved to {saveStatus.fileName}
                  </span>
                ) : saveStatus && !saveStatus.success ? (
                  <span style={{ color: "#dc3545" }}>
                    ❌ Save failed: {saveStatus.message}
                  </span>
                ) : (
                  <span style={{ color: "#28a745" }}>✅ All changes saved</span>
                )}
              </span>

              {/* Writeback Columns Info */}
              {writebackConfig.showChangeCounter !== false && (
                <span style={{ fontSize: "12px", color: "#6c757d" }}>
                  Writeback:{" "}
                  {configuredColumns.map((col) => col.columnName).join(", ")}
                </span>
              )}
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
          ) : !writebackConfig.enabled ? (
            <span style={{ color: "#6c757d" }}>
              <strong>Writeback:</strong> Disabled (Enable in property panel)
            </span>
          ) : configuredColumns.length === 0 ? (
            <span style={{ color: "#856404" }}>
              <strong>Writeback:</strong> No columns configured (Add in property
              panel)
            </span>
          ) : (
            <span style={{ color: "#28a745" }}>
              <strong>Writeback:</strong> {configuredColumns.length} column
              {configuredColumns.length !== 1 ? "s" : ""} ready
              <br />
              <small>
                Columns: {configuredColumns.map((c) => c.columnName).join(", ")}
              </small>
            </span>
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

          {/* Edit Mode Controls - only show if writeback is active */}
          {currentMode === "edit" && hasActiveWriteback && (
            <>
              {writebackConfig.saveMode === "manual" && (
                <>
                  <button
                    onClick={saveAllChanges}
                    disabled={
                      !hasUnsavedChanges || isSaving || isLoadingWriteback
                    }
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
                    disabled={
                      !hasUnsavedChanges || isSaving || isLoadingWriteback
                    }
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

              {/* Show save mode status for non-manual modes */}
              {writebackConfig.saveMode !== "manual" && hasUnsavedChanges && (
                <span style={{ fontSize: "11px", color: "#6c757d" }}>
                  {writebackConfig.saveMode === "auto"
                    ? `Auto-save in ${writebackConfig.autoSaveDelay || 2}s`
                    : `Batch save every ${
                        writebackConfig.batchSaveInterval || 5
                      }min`}
                </span>
              )}
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
                {columns.map((c, idx) => {
                  const isWriteback = isWritebackColumn(idx);
                  const isKeyDim = !isWriteback && isKeyDimension(c, layout);

                  let config = null;
                  if (isWriteback) {
                    const columnName = getWritebackColumnName(idx, layout);
                    config = writebackColumnMap.get(columnName);
                  }

                  return (
                    <th
                      key={idx}
                      style={{
                        cursor: isWriteback ? "default" : "pointer",
                        userSelect: "none",
                        padding: "12px 8px",
                        backgroundColor: "#f8f9fa",
                        border: "1px solid #dee2e6",
                        borderTop: "none",
                        fontWeight: "600",
                        fontSize: "14px",
                        color: "#495057",
                        width: getColumnWidth(idx),
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
                          {isWriteback
                            ? getWritebackColumnName(idx, layout)
                            : c}
                          {isKeyDim && (
                            <span
                              style={{
                                fontSize: "10px",
                                color: "#2e7d32",
                                marginLeft: "4px",
                              }}
                              title="Key Dimension"
                            >
                              🔑
                            </span>
                          )}
                          {isWriteback && !config?.readOnly && (
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
                          {isWriteback && config?.required && (
                            <span
                              style={{
                                fontSize: "10px",
                                color: "#dc3545",
                                marginLeft: "2px",
                              }}
                            >
                              *
                            </span>
                          )}
                        </span>
                        {sortBy === idx && !isWriteback && (
                          <span style={{ color: "#007acc", fontSize: "12px" }}>
                            {sortDir ? "▲" : "▼"}
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
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
                      const isWriteback = isWritebackColumn(j);
                      const cellKey = `${i}-${j}-${cell.qText}-${cell.qElemNumber}`;
                      const isCellSelected = selectedCells.has(cellKey);

                      // Check if this cell value is selected anywhere in this dimension (only for base columns)
                      const isValueSelected =
                        !isWriteback &&
                        isDynamicColumnSelectable(j, layout) &&
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

                      const rowId = getRowId(row, actualRowIndex);

                      let cellContent;
                      if (isWriteback) {
                        const columnName = getWritebackColumnName(j, layout);
                        const config = writebackColumnMap.get(columnName);
                        cellContent = renderWritebackCell(
                          rowId,
                          columnName,
                          config
                        );
                      } else {
                        cellContent = (
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
                              isDynamicColumnSelectable(j, layout) && (
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
                        );
                      }

                      return (
                        <td
                          key={j}
                          style={{
                            padding: "8px",
                            border: "1px solid #eee",
                            borderTop: "none",
                            fontSize: "13px",
                            width: getColumnWidth(j),
                            overflow: "hidden",
                            whiteSpace:
                              isWriteback &&
                              writebackColumnMap.get(
                                getWritebackColumnName(j, layout)
                              )?.columnType === "textarea"
                                ? "normal"
                                : "nowrap",
                            cursor: isWriteback
                              ? "default"
                              : currentMode === "edit"
                              ? "default"
                              : currentMode === "selection" &&
                                isDynamicColumnSelectable(j, layout) &&
                                !selectionMode
                              ? "pointer"
                              : "default",
                            backgroundColor:
                              isValueSelected && currentMode === "selection"
                                ? "#d4edda"
                                : isWriteback
                                ? writebackColumnMap.get(
                                    getWritebackColumnName(j, layout)
                                  )?.readOnly
                                  ? "#f8f9fa"
                                  : "#fff8e1"
                                : !isWriteback &&
                                  isKeyDimension(baseColumns[j], layout)
                                ? "#f3e5f5"
                                : currentMode === "selection" &&
                                  isDynamicColumnSelectable(j, layout) &&
                                  !isWriteback
                                ? "rgba(0, 123, 204, 0.05)"
                                : "transparent",
                          }}
                          title={
                            isWriteback
                              ? `${getWritebackColumnName(j, layout)} ${
                                  writebackColumnMap.get(
                                    getWritebackColumnName(j, layout)
                                  )?.readOnly
                                    ? "(Read-only)"
                                    : "(Editable)"
                                }${
                                  writebackColumnMap.get(
                                    getWritebackColumnName(j, layout)
                                  )?.required
                                    ? " - Required"
                                    : ""
                                }`
                              : !isWriteback &&
                                isKeyDimension(baseColumns[j], layout)
                              ? `${baseColumns[j]} (Key Dimension)`
                              : cell.qText
                          }
                          onClick={() => onCellClick(j, cell, row, i)}
                        >
                          {cellContent}
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
            {currentMode === "edit" && hasActiveWriteback ? (
              <span>
                ✏️ = Editable • * = Required
                {hasUnsavedChanges &&
                  writebackConfig.showChangeCounter !== false && (
                    <span style={{ color: "#dc3545", marginLeft: "8px" }}>
                      {Object.keys(editedData).length} unsaved change
                      {Object.keys(editedData).length !== 1 ? "s" : ""}
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
            ) : !writebackConfig.enabled ? (
              <span>Writeback disabled - Enable in property panel</span>
            ) : configuredColumns.length === 0 ? (
              <span>Configure writeback columns in property panel</span>
            ) : (
              <span>
                Writeback ready - {configuredColumns.length} column
                {configuredColumns.length !== 1 ? "s" : ""} configured
              </span>
            )}

            {/* Key Dimensions Status */}
            {keyDimensionsSummary.hasKeyDimensions && (
              <div style={{ fontSize: 10, marginTop: 2, color: "#2e7d32" }}>
                🔑 = Key Dimension
                {!keyValidation.isValid && (
                  <span style={{ color: "#d32f2f", marginLeft: "8px" }}>
                    • ⚠️ {keyValidation.duplicates.length} duplicate key
                    {keyValidation.duplicates.length !== 1 ? "s" : ""} detected
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
