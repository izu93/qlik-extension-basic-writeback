// utils/dynamicColumnsUtils.js - Dynamic column management

/**
 * Get all columns including dynamically added writeback columns
 */
export function getAllColumns(layout) {
  const baseColumns = getBaseColumns(layout);
  const writebackColumns = getWritebackColumns(layout);

  return [...baseColumns, ...writebackColumns];
}

/**
 * Get base columns from hypercube (existing data model)
 */
export function getBaseColumns(layout) {
  if (
    !layout?.qHyperCube ||
    (!layout.qHyperCube.qDimensionInfo && !layout.qHyperCube.qMeasureInfo)
  ) {
    return [];
  }

  return [
    ...(layout.qHyperCube.qDimensionInfo || []),
    ...(layout.qHyperCube.qMeasureInfo || []),
  ].map((f) => f.qFallbackTitle);
}

/**
 * Get configured writeback columns that should be added dynamically
 */
export function getWritebackColumns(layout) {
  const writebackConfig = layout?.writebackConfig || {
    enabled: false,
    columns: [],
  };

  if (!writebackConfig.enabled || !writebackConfig.columns) {
    return [];
  }

  return writebackConfig.columns.map((col) => col.columnName);
}

/**
 * Get enhanced rows with writeback column placeholders
 */
export function getEnhancedRows(layout) {
  const baseRows = getBaseRows(layout);
  const writebackColumns = getWritebackColumns(layout);

  if (writebackColumns.length === 0) {
    return baseRows;
  }

  // Add placeholder cells for writeback columns
  return baseRows.map((row) => {
    const enhancedRow = [...row];

    // Add empty cells for each writeback column
    writebackColumns.forEach(() => {
      enhancedRow.push({
        qText: "",
        qNum: null,
        qElemNumber: -1,
        qState: "O",
        qIsEmpty: true,
        qIsWriteback: true, // Mark as writeback cell
      });
    });

    return enhancedRow;
  });
}

/**
 * Get base rows from hypercube
 */
export function getBaseRows(layout) {
  return layout?.qHyperCube?.qDataPages?.[0]?.qMatrix || [];
}

/**
 * Check if a column index is a writeback column
 */
export function isWritebackColumnIndex(columnIndex, layout) {
  const baseColumns = getBaseColumns(layout);
  return columnIndex >= baseColumns.length;
}

/**
 * Get writeback column name from column index
 */
export function getWritebackColumnName(columnIndex, layout) {
  const baseColumns = getBaseColumns(layout);
  const writebackColumns = getWritebackColumns(layout);

  if (columnIndex < baseColumns.length) {
    return null; // Not a writeback column
  }

  const writebackIndex = columnIndex - baseColumns.length;
  return writebackColumns[writebackIndex] || null;
}

/**
 * Check if any writeback columns are configured
 */
export function hasWritebackColumns(layout) {
  return getWritebackColumns(layout).length > 0;
}

/**
 * Get column configuration for a writeback column
 */
export function getWritebackColumnConfig(columnName, layout) {
  const writebackConfig = layout?.writebackConfig || {
    enabled: false,
    columns: [],
  };

  return (
    writebackConfig.columns?.find((col) => col.columnName === columnName) ||
    null
  );
}

/**
 * Determine if we should show Edit/Select mode buttons
 */
export function shouldShowModeButtons(layout) {
  const writebackConfig = layout?.writebackConfig || {
    enabled: false,
    columns: [],
  };

  return (
    writebackConfig.enabled &&
    writebackConfig.columns &&
    writebackConfig.columns.length > 0
  );
}

/**
 * Get base column count (excludes writeback columns)
 */
export function getBaseColumnCount(layout) {
  return getBaseColumns(layout).length;
}

/**
 * Map column index to base hypercube index (for selections)
 */
export function mapToBaseColumnIndex(columnIndex, layout) {
  const baseColumnCount = getBaseColumnCount(layout);

  if (columnIndex >= baseColumnCount) {
    return -1; // Writeback column, not selectable
  }

  return columnIndex;
}

/**
 * Check if column is selectable (not a writeback column)
 */
export function isColumnSelectable(columnIndex, layout) {
  return mapToBaseColumnIndex(columnIndex, layout) !== -1;
}

/**
 * Get dimension count from base hypercube (for selection logic)
 */
export function getBaseDimensionCount(layout) {
  return layout?.qHyperCube?.qDimensionInfo?.length || 0;
}

/**
 * Check if base column index is a dimension (for selection logic)
 */
export function isBaseDimension(baseColumnIndex, layout) {
  const dimensionCount = getBaseDimensionCount(layout);
  return baseColumnIndex >= 0 && baseColumnIndex < dimensionCount;
}
