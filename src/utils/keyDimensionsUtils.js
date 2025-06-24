// utils/keyDimensionsUtils.js - Key Dimensions functionality

/**
 * Get key dimensions configuration from layout
 */
export function getKeyDimensionsConfig(layout) {
  return {
    keyDimensions: layout?.keyDimensions || [],
    keyGenerationStrategy: layout?.keyGenerationStrategy || "concatenate",
    keySeparator: layout?.keySeparator || "|",
    showKeyInTable: layout?.showKeyInTable || false,
    validateKeyUniqueness: layout?.validateKeyUniqueness !== false,
  };
}

/**
 * Get key dimensions that are present in the actual data columns
 */
export function getActiveKeyDimensions(layout, columns) {
  const config = getKeyDimensionsConfig(layout);

  return config.keyDimensions
    .filter(
      (keyDim) =>
        keyDim.isKeyDimension && columns.includes(keyDim.dimensionName)
    )
    .sort((a, b) => (a.keyOrder || 1) - (b.keyOrder || 1));
}

/**
 * Generate unique key for a row based on key dimensions
 */
export function generateRowKey(row, layout, columns) {
  const config = getKeyDimensionsConfig(layout);
  const activeKeyDimensions = getActiveKeyDimensions(layout, columns);

  if (activeKeyDimensions.length === 0) {
    // Fallback to using first few columns if no key dimensions configured
    return generateFallbackKey(row, columns);
  }

  const keyValues = [];

  activeKeyDimensions.forEach((keyDim) => {
    const columnIndex = columns.findIndex(
      (col) => col === keyDim.dimensionName
    );
    if (columnIndex >= 0 && row[columnIndex]) {
      keyValues.push(row[columnIndex].qText || "");
    }
  });

  return generateKeyFromValues(keyValues, config);
}

/**
 * Generate key from array of values based on strategy
 */
export function generateKeyFromValues(values, config) {
  switch (config.keyGenerationStrategy) {
    case "hash":
      return generateHashKey(values);
    case "composite":
      return JSON.stringify(values);
    case "concatenate":
    default:
      return values.join(config.keySeparator);
  }
}

/**
 * Generate hash key from values
 */
export function generateHashKey(values) {
  const str = values.join("|");
  let hash = 0;

  if (str.length === 0) return hash.toString();

  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  return Math.abs(hash).toString();
}

/**
 * Fallback key generation when no key dimensions configured
 */
export function generateFallbackKey(row, columns) {
  const keyValues = [];

  // Use first 3 columns as fallback key
  for (let i = 0; i < Math.min(3, row.length); i++) {
    if (row[i] && row[i].qText) {
      keyValues.push(row[i].qText);
    }
  }

  return keyValues.join("|");
}

/**
 * Validate key uniqueness in dataset
 */
export function validateKeyUniqueness(rows, layout, columns) {
  const config = getKeyDimensionsConfig(layout);

  if (!config.validateKeyUniqueness) {
    return { isValid: true, duplicates: [] };
  }

  const keyMap = new Map();
  const duplicates = [];

  rows.forEach((row, index) => {
    const key = generateRowKey(row, layout, columns);

    if (keyMap.has(key)) {
      const existingIndex = keyMap.get(key);
      duplicates.push({
        key,
        rows: [existingIndex, index],
        values: getKeyValues(row, layout, columns),
      });
    } else {
      keyMap.set(key, index);
    }
  });

  return {
    isValid: duplicates.length === 0,
    duplicates,
    totalRows: rows.length,
    uniqueKeys: keyMap.size,
  };
}

/**
 * Get key values for a specific row
 */
export function getKeyValues(row, layout, columns) {
  const activeKeyDimensions = getActiveKeyDimensions(layout, columns);
  const keyValues = {};

  activeKeyDimensions.forEach((keyDim) => {
    const columnIndex = columns.findIndex(
      (col) => col === keyDim.dimensionName
    );
    if (columnIndex >= 0 && row[columnIndex]) {
      keyValues[keyDim.dimensionName] = row[columnIndex].qText || "";
    }
  });

  return keyValues;
}

/**
 * Check if a column is marked as a key dimension
 */
export function isKeyDimension(columnName, layout) {
  const config = getKeyDimensionsConfig(layout);

  return config.keyDimensions.some(
    (keyDim) => keyDim.isKeyDimension && keyDim.dimensionName === columnName
  );
}

/**
 * Get key dimension info for a specific column
 */
export function getKeyDimensionInfo(columnName, layout) {
  const config = getKeyDimensionsConfig(layout);

  return config.keyDimensions.find(
    (keyDim) => keyDim.dimensionName === columnName
  );
}

/**
 * Create enhanced row ID that includes both key and fallback
 */
export function createEnhancedRowId(row, index, layout, columns) {
  const keyDimensionKey = generateRowKey(row, layout, columns);
  const fallbackKey = `row-${index}`;

  // Combine key dimension key with fallback for maximum uniqueness
  return `${keyDimensionKey}|${fallbackKey}`;
}

/**
 * Get key dimensions summary for display
 */
export function getKeyDimensionsSummary(layout, columns) {
  const config = getKeyDimensionsConfig(layout);
  const activeKeyDimensions = getActiveKeyDimensions(layout, columns);

  if (activeKeyDimensions.length === 0) {
    return {
      hasKeyDimensions: false,
      message: "No key dimensions configured",
      strategy: config.keyGenerationStrategy,
    };
  }

  const keyDimensionNames = activeKeyDimensions.map((kd) => kd.dimensionName);

  return {
    hasKeyDimensions: true,
    keyDimensions: activeKeyDimensions,
    keyDimensionNames,
    strategy: config.keyGenerationStrategy,
    separator: config.keySeparator,
    showInTable: config.showKeyInTable,
    message: `Key: ${keyDimensionNames.join(" + ")} (${
      config.keyGenerationStrategy
    })`,
  };
}

/**
 * Export key dimensions configuration
 */
export function exportKeyDimensionsConfig(layout) {
  const config = getKeyDimensionsConfig(layout);

  return {
    keyDimensions: config.keyDimensions,
    keyGenerationStrategy: config.keyGenerationStrategy,
    keySeparator: config.keySeparator,
    showKeyInTable: config.showKeyInTable,
    validateKeyUniqueness: config.validateKeyUniqueness,
    exportedAt: new Date().toISOString(),
  };
}

/**
 * Validate key dimensions configuration
 */
export function validateKeyDimensionsConfig(keyDimensions) {
  const errors = [];

  if (!Array.isArray(keyDimensions)) {
    errors.push("Key dimensions must be an array");
    return { isValid: false, errors };
  }

  const keyDimensionNames = new Set();
  const keyOrders = new Set();

  keyDimensions.forEach((keyDim, index) => {
    if (!keyDim.dimensionName || keyDim.dimensionName.trim() === "") {
      errors.push(`Key dimension ${index + 1}: Dimension name is required`);
    }

    if (keyDimensionNames.has(keyDim.dimensionName)) {
      errors.push(
        `Key dimension ${index + 1}: Duplicate dimension name "${
          keyDim.dimensionName
        }"`
      );
    } else {
      keyDimensionNames.add(keyDim.dimensionName);
    }

    if (keyDim.isKeyDimension) {
      const keyOrder = keyDim.keyOrder || 1;
      if (keyOrders.has(keyOrder)) {
        errors.push(
          `Key dimension ${index + 1}: Duplicate key order ${keyOrder}`
        );
      } else {
        keyOrders.add(keyOrder);
      }
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
  };
}
