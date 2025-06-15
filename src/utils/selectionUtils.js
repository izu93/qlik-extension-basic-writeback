// utils/selectionUtils.js - FIXED VERSION

/**
 * Handle single cell click for immediate Qlik selection
 * FIXED: Use app.getField() and prevent unnecessary re-renders
 */
export async function handleCellClick(
  app,
  layout,
  columnIndex,
  cellValue,
  row,
  model,
  selections,
  rowIndex,
  currentPage,
  pageSize
) {
  if (!app) {
    return false;
  }

  if (!layout?.qHyperCube?.qDimensionInfo) {
    return false;
  }

  // Check if clicked column is a dimension (not a measure)
  const dimensionCount = layout.qHyperCube.qDimensionInfo.length;
  if (columnIndex >= dimensionCount) {
    return false;
  }

  try {
    // Get the field name from the dimension info - try multiple possible field name sources
    const dimensionInfo = layout.qHyperCube.qDimensionInfo[columnIndex];
    let fieldName =
      dimensionInfo?.qGroupFieldDefs?.[0] ||
      dimensionInfo?.qFallbackTitle ||
      dimensionInfo?.cId ||
      dimensionInfo?.qAttrExprInfo?.[0]?.qFallbackTitle;

    if (!fieldName) {
      throw new Error("No field name available");
    }

    // FIXED: Use getField() instead of field() and handle the async properly
    let field;

    // Try different methods to get the field
    if (typeof app.getField === "function") {
      field = await app.getField(fieldName);
    } else if (typeof app.field === "function") {
      field = await app.field(fieldName);
    } else {
      throw new Error("No field access method available");
    }

    if (!field) {
      throw new Error("Field object not available");
    }

    // FIXED: Use the element number if available for more reliable selection
    if (cellValue.qElemNumber !== undefined && cellValue.qElemNumber >= 0) {
      // Use selectValues with element number for exact matching
      await field.selectValues(
        [
          {
            qText: cellValue.qText,
            qElemNumber: cellValue.qElemNumber,
            qIsNumeric: !isNaN(cellValue.qNum) && cellValue.qNum !== null,
            qNumber: isNaN(cellValue.qNum) ? undefined : cellValue.qNum,
          },
        ],
        false,
        false
      ); // toggleMode=false, softLock=false
    } else {
      // Fallback to text-based selection
      await field.selectValues(
        [
          {
            qText: cellValue.qText,
            qIsNumeric: !isNaN(cellValue.qNum) && cellValue.qNum !== null,
            qNumber: isNaN(cellValue.qNum) ? undefined : cellValue.qNum,
          },
        ],
        false,
        false
      );
    }

    return true;
  } catch (error) {
    // FIXED: More reliable fallback to selectHyperCubeValues method
    try {
      const globalRowIndex = (currentPage - 1) * pageSize + rowIndex;

      // Use the model's selectHyperCubeValues method which is more direct
      if (model && typeof model.selectHyperCubeValues === "function") {
        await model.selectHyperCubeValues(
          "/qHyperCubeDef",
          columnIndex,
          [cellValue.qElemNumber],
          false
        );
        return true;
      }

      // Last resort: use the original hypercube selection method
      if (selections) {
        // Cancel any existing selection first
        if (selections.isActive()) {
          await selections.cancel();
        }

        await selections.begin("/qHyperCubeDef");

        await selections.select({
          method: "selectHyperCubeCells",
          params: ["/qHyperCubeDef", [globalRowIndex], [columnIndex]],
        });

        await selections.confirm();

        return true;
      }
    } catch (fallbackError) {
      // Silent fallback failure
    }

    return false;
  }
}

/**
 * Apply batch selections to Qlik app
 * FIXED: Native Qlik behavior - select only in the FIRST dimension field (like native tables)
 */
export async function applyBatchSelections(
  app,
  layout,
  selectedRows,
  allRows,
  model,
  selections,
  currentPage,
  pageSize
) {
  if (!app) {
    return false;
  }

  if (selectedRows.size === 0) {
    return false;
  }

  if (!layout?.qHyperCube?.qDimensionInfo) {
    return false;
  }

  try {
    const dimensionCount = layout.qHyperCube.qDimensionInfo.length;

    if (dimensionCount === 0) {
      return false;
    }

    // Convert page-relative row indices to global row indices
    const globalRowIndices = Array.from(selectedRows).map(
      (pageRowIndex) => (currentPage - 1) * pageSize + pageRowIndex
    );

    // FIXED: Native Qlik behavior - only select in the FIRST dimension (index 0)
    // This mimics how native Qlik tables work and prevents flickering
    const firstDimIndex = 0;

    // Method 1: Try direct field selection (cleanest, like single cell clicks)
    try {
      const dimensionInfo = layout.qHyperCube.qDimensionInfo[firstDimIndex];
      let fieldName =
        dimensionInfo?.qGroupFieldDefs?.[0] ||
        dimensionInfo?.qFallbackTitle ||
        dimensionInfo?.cId;

      if (fieldName && app) {
        // Collect unique values from the first dimension only
        const valuesToSelect = [];
        const seenValues = new Set();

        for (const globalRowIndex of globalRowIndices) {
          const row = allRows[globalRowIndex];
          if (row && row[firstDimIndex]) {
            const cellValue = row[firstDimIndex];
            const valueKey = cellValue.qText + "|" + cellValue.qElemNumber;

            if (!seenValues.has(valueKey)) {
              seenValues.add(valueKey);
              valuesToSelect.push({
                qText: cellValue.qText,
                qElemNumber: cellValue.qElemNumber,
                qIsNumeric: !isNaN(cellValue.qNum) && cellValue.qNum !== null,
                qNumber: isNaN(cellValue.qNum) ? undefined : cellValue.qNum,
              });
            }
          }
        }

        if (valuesToSelect.length > 0) {
          let field;
          if (typeof app.getField === "function") {
            field = await app.getField(fieldName);
          } else if (typeof app.field === "function") {
            field = await app.field(fieldName);
          }

          if (field) {
            await field.selectValues(valuesToSelect, false, false);
            return true;
          }
        }
      }
    } catch (fieldError) {
      // Silent fallback
    }

    // Method 2: Try model.selectHyperCubeValues on first dimension only
    if (model && typeof model.selectHyperCubeValues === "function") {
      try {
        const elemNumbers = [];

        for (const globalRowIndex of globalRowIndices) {
          const row = allRows[globalRowIndex];
          if (
            row &&
            row[firstDimIndex] &&
            row[firstDimIndex].qElemNumber !== undefined &&
            row[firstDimIndex].qElemNumber >= 0
          ) {
            elemNumbers.push(row[firstDimIndex].qElemNumber);
          }
        }

        if (elemNumbers.length > 0) {
          // Remove duplicates and select all at once in first dimension only
          const uniqueElemNumbers = [...new Set(elemNumbers)];
          await model.selectHyperCubeValues(
            "/qHyperCubeDef",
            firstDimIndex,
            uniqueElemNumbers,
            false
          );
          return true;
        }
      } catch (modelError) {
        // Silent fallback
      }
    }

    // Method 3: Fallback to selections API - but only for first dimension
    if (selections) {
      const rowIndices = [];
      const columnIndices = [];

      // Only add entries for the first dimension column
      globalRowIndices.forEach((globalRowIndex) => {
        rowIndices.push(globalRowIndex);
        columnIndices.push(firstDimIndex);
      });

      // Clear existing selections first
      if (selections.isActive()) {
        await selections.cancel();
      }

      // Begin fresh selection mode
      await selections.begin("/qHyperCubeDef");

      // Apply selection only in first dimension
      await selections.select({
        method: "selectHyperCubeCells",
        params: ["/qHyperCubeDef", rowIndices, columnIndices],
      });

      // Confirm immediately
      await selections.confirm();

      return true;
    }

    return false;
  } catch (error) {
    // Clean up selection state on error
    try {
      if (selections && selections.isActive()) {
        await selections.cancel();
      }
    } catch (cancelError) {
      // Silent cleanup failure
    }

    return false;
  }
}

/**
 * Clear all selections in Qlik app
 * FIXED: Better cleanup sequence
 */
export async function clearAllQlikSelections(app, model, selections) {
  try {
    // First, cancel any active selection mode
    if (selections && selections.isActive()) {
      await selections.cancel();
    }

    // Then clear all selections using app
    if (app && typeof app.clearAll === "function") {
      await app.clearAll();
      return true;
    }

    // Fallback: try selections.clear if available
    if (selections && typeof selections.clear === "function") {
      await selections.clear();
      return true;
    }
  } catch (error) {
    return false;
  }

  return false;
}

// Keep all other utility functions the same...
export function toggleRowSelection(selectedRows, rowIndex) {
  const newSelectedRows = new Set(selectedRows);

  if (newSelectedRows.has(rowIndex)) {
    newSelectedRows.delete(rowIndex);
  } else {
    newSelectedRows.add(rowIndex);
  }

  return newSelectedRows;
}

export function clearLocalSelections() {
  return new Set();
}

export function selectAllOnPage(
  currentSelections,
  pageStartIndex,
  pageSize,
  totalRows
) {
  const newSelections = new Set(currentSelections);

  for (
    let i = pageStartIndex;
    i < Math.min(pageStartIndex + pageSize, totalRows);
    i++
  ) {
    newSelections.add(i);
  }

  return newSelections;
}

export function deselectAllOnPage(
  currentSelections,
  pageStartIndex,
  pageSize,
  totalRows
) {
  const newSelections = new Set(currentSelections);

  for (
    let i = pageStartIndex;
    i < Math.min(pageStartIndex + pageSize, totalRows);
    i++
  ) {
    newSelections.delete(i);
  }

  return newSelections;
}

export function getPageSelectionCount(
  selectedRows,
  pageStartIndex,
  pageSize,
  totalRows
) {
  let count = 0;

  for (
    let i = pageStartIndex;
    i < Math.min(pageStartIndex + pageSize, totalRows);
    i++
  ) {
    if (selectedRows.has(i)) {
      count++;
    }
  }

  return count;
}

export function isPageFullySelected(
  selectedRows,
  pageStartIndex,
  pageSize,
  totalRows
) {
  const pageRowCount = Math.min(pageSize, totalRows - pageStartIndex);
  const selectedOnPage = getPageSelectionCount(
    selectedRows,
    pageStartIndex,
    pageSize,
    totalRows
  );

  return pageRowCount > 0 && selectedOnPage === pageRowCount;
}

export function getDimensionCount(layout) {
  return layout?.qHyperCube?.qDimensionInfo?.length || 0;
}

export function isColumnSelectable(columnIndex, layout) {
  const dimensionCount = getDimensionCount(layout);
  return columnIndex < dimensionCount;
}

export function getSelectionSummary(selectedRows, totalRows) {
  const selectedCount = selectedRows.size;
  const percentage =
    totalRows > 0 ? Math.round((selectedCount / totalRows) * 100) : 0;

  return {
    selectedCount,
    totalRows,
    percentage,
    hasSelections: selectedCount > 0,
    isAllSelected: selectedCount === totalRows,
  };
}
