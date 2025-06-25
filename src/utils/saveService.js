// utils/saveService.js - Dynamic PostgreSQL Database Save Service
// AUTO-DETECTS fields from Qlik model + adds writeback and audit columns
import ENV from "../config/env.js";

/**
 * Save writeback data directly to PostgreSQL database via Qlik Automation
 */
export async function saveWritebackData(editedData, layout, app) {
  try {
    // === SAVE DEBUG ===
    console.log("=== SAVE DEBUG ===");
    console.log("editedData:", editedData);
    console.log("layout structure:", layout?.qHyperCube);
    console.log("Webhook URL:", ENV.DB_SAVE_WEBHOOK_URL);
    console.log("Webhook Token:", ENV.DB_SAVE_TOKEN ? "Configured" : "Missing");

    console.log(
      "Starting dynamic PostgreSQL save operation with data:",
      editedData
    );

    // Get current user
    const currentUser = await getCurrentQlikUser(app);
    console.log("Current user:", currentUser);

    // Generate audit info
    const timestamp = new Date().toISOString();
    const appId = getConsistentAppId(app, layout);
    const sessionId = getOrCreateSessionId();

    console.log("Save context:", { appId, sessionId, user: currentUser });

    // Convert edited data to database records
    const dbRecords = convertToDbRecords(
      editedData,
      layout,
      currentUser,
      timestamp,
      appId,
      sessionId
    );

    console.log(`Generated ${dbRecords.length} database records to save`);

    if (dbRecords.length === 0) {
      return {
        success: false,
        message: "No changes to save",
        type: "warning",
      };
    }

    // Send to Qlik Automation for PostgreSQL insertion
    const result = await sendToPostgreSQLAutomation(dbRecords, layout, {
      appId,
      sessionId,
      user: currentUser,
      timestamp,
    });

    return {
      success: true,
      message: `Successfully saved ${dbRecords.length} records to database`,
      fileName: null,
      timestamp,
      changeCount: dbRecords.length,
      savedBy: currentUser,
      type: "success",
    };
  } catch (error) {
    console.error("Dynamic PostgreSQL save operation failed:", error);
    throw new Error(`Failed to save to database: ${error.message}`);
  }
}

/**
 * Convert edited data to database record format - DYNAMIC VERSION
 */
function convertToDbRecords(
  editedData,
  layout,
  currentUser,
  timestamp,
  appId,
  sessionId
) {
  console.log("Converting edited data to database records (DYNAMIC)...");

  const baseRows = getBaseRows(layout);
  const baseColumns = getBaseColumns(layout);
  const dbRecords = [];

  // Get the model structure dynamically
  const modelStructure = analyzeModelStructure(layout);
  console.log("Detected model structure:", modelStructure);

  // Group edited data by primary key (first dimension)
  const editsByPrimaryKey = groupEditsByPrimaryKey(
    editedData,
    baseRows,
    baseColumns,
    modelStructure
  );

  console.log("Edits grouped by primary key:", Object.keys(editsByPrimaryKey));

  // Generate version number
  const version = Math.floor(Date.now() / 1000);

  // Create database record for each edited entity
  Object.entries(editsByPrimaryKey).forEach(([primaryKey, edits]) => {
    console.log(`Processing ${primaryKey}:`, edits);

    // Find the source row data
    const sourceRow = findRowByPrimaryKey(
      baseRows,
      baseColumns,
      primaryKey,
      modelStructure
    );

    if (!sourceRow) {
      console.warn(`No source row found for ${primaryKey}`);
      return;
    }

    // Create database record DYNAMICALLY
    const dbRecord = createDynamicDbRecord(
      sourceRow,
      baseColumns,
      modelStructure,
      edits,
      currentUser,
      timestamp,
      appId,
      sessionId,
      version,
      primaryKey
    );

    dbRecords.push(dbRecord);
    console.log(`Created dynamic DB record for ${primaryKey}:`, dbRecord);
  });

  return dbRecords;
}

/**
 * UPDATED: Get writeback fields dynamically from extension configuration
 * This replaces the hardcoded array
 */
function getWritebackFieldsFromConfig(layout) {
  const writebackConfig = layout?.writebackConfig;

  if (!writebackConfig?.enabled || !writebackConfig?.columns) {
    console.log("No writeback configuration found, using fallback");
    // Fallback to hardcoded fields if no configuration
    return ["model_feedback", "comments"];
  }

  // Extract column names and convert to database format
  const writebackFields = writebackConfig.columns.map((column) => {
    return convertToDbColumnName(column.columnName);
  });

  console.log("Dynamic writeback fields from config:", writebackFields);
  return writebackFields;
}

/**
 * UPDATED: Analyze model structure - DYNAMIC writeback fields
 */
function analyzeModelStructure(layout) {
  const dimensions = layout.qHyperCube?.qDimensionInfo || [];

  const structure = {
    primaryKey: null,
    keyDimensions: [], // ONLY dimension fields (key business identifiers)
    writebackFields: getWritebackFieldsFromConfig(layout), // DYNAMIC!
    auditFields: [
      "created_by",
      "modified_by",
      "created_at",
      "modified_at",
      "version",
      "session_id",
      "app_id",
    ],
  };

  // First dimension is the primary key
  if (dimensions.length > 0) {
    structure.primaryKey = {
      name: dimensions[0].qFallbackTitle,
      dbColumn: convertToDbColumnName(dimensions[0].qFallbackTitle),
      index: 0,
    };
  }

  // ONLY dimensions (key identifiers) - NO measures
  dimensions.forEach((dimension, index) => {
    structure.keyDimensions.push({
      name: dimension.qFallbackTitle,
      dbColumn: convertToDbColumnName(dimension.qFallbackTitle),
      index: index,
      type: "dimension",
    });
  });

  console.log("Dynamic model structure:", {
    keyDimensions: structure.keyDimensions.length,
    writebackFields: structure.writebackFields.length,
    auditFields: structure.auditFields.length,
    writebackColumns: structure.writebackFields,
  });

  return structure;
}

/**
 * Generate all possible UI field name variations from database field name
 * This makes the extension work with any naming convention
 */
function generateUIFieldVariations(dbFieldName) {
  const variations = [];

  // 1. Original database field name
  variations.push(dbFieldName);

  // 2. Replace underscores with spaces
  const spacedVersion = dbFieldName.replace(/_/g, " ");
  variations.push(spacedVersion);

  // 3. Title Case (Model Feedback)
  const titleCase = spacedVersion.replace(/\b\w/g, (l) => l.toUpperCase());
  variations.push(titleCase);

  // 4. Sentence case (Model feedback)
  const sentenceCase =
    spacedVersion.charAt(0).toUpperCase() + spacedVersion.slice(1);
  variations.push(sentenceCase);

  // 5. camelCase (modelFeedback)
  const camelCase = dbFieldName.replace(/_([a-z])/g, (match, letter) =>
    letter.toUpperCase()
  );
  variations.push(camelCase);

  // 6. PascalCase (ModelFeedback)
  const pascalCase = camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
  variations.push(pascalCase);

  // 7. UPPERCASE variations
  variations.push(dbFieldName.toUpperCase());
  variations.push(spacedVersion.toUpperCase());
  variations.push(titleCase.toUpperCase());

  // 8. lowercase variations
  variations.push(dbFieldName.toLowerCase());
  variations.push(spacedVersion.toLowerCase());

  // Remove duplicates and return
  return [...new Set(variations)];
}

/**
 * Fuzzy matching for field names as fallback
 */
function fuzzyMatchFields(uiFieldName, dbFieldName) {
  const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalizedUI = normalize(uiFieldName);
  const normalizedDB = normalize(dbFieldName);

  return normalizedUI === normalizedDB;
}

/**
 * UPDATED: Create database record - FULLY DYNAMIC FIELD MAPPING
 * No hardcoded field names - uses naming convention
 */
function createDynamicDbRecord(
  sourceRow,
  baseColumns,
  modelStructure,
  edits,
  currentUser,
  timestamp,
  appId,
  sessionId,
  version,
  primaryKey
) {
  console.log("=== CREATE DB RECORD DEBUG ===");
  console.log("Edits received:", edits);
  console.log("Writeback fields expected:", modelStructure.writebackFields);

  const dbRecord = {};

  // Add ONLY key dimension fields (no measures)
  modelStructure.keyDimensions.forEach((dimension) => {
    const value = extractValueFromRow(
      sourceRow,
      dimension.index,
      dimension.type
    );
    dbRecord[dimension.dbColumn] = value;
  });

  // Add writeback fields - DYNAMIC MAPPING with naming convention
  modelStructure.writebackFields.forEach((dbFieldName) => {
    let editValue = "";

    // DYNAMIC: Generate all possible UI field name variations
    const possibleUINames = generateUIFieldVariations(dbFieldName);

    console.log(`Looking for edit value for DB field "${dbFieldName}"`);
    console.log(`Possible UI names:`, possibleUINames);

    // Find matching edit value from any possible UI name
    for (const uiName of possibleUINames) {
      if (edits.hasOwnProperty(uiName)) {
        editValue = edits[uiName];
        console.log(
          `Found mapping: "${uiName}" → "${dbFieldName}" = "${editValue}"`
        );
        break;
      }
    }

    // If still no match, try fuzzy matching as fallback
    if (!editValue) {
      Object.keys(edits).forEach((editKey) => {
        if (fuzzyMatchFields(editKey, dbFieldName)) {
          editValue = edits[editKey];
          console.log(
            `Fuzzy match: "${editKey}" → "${dbFieldName}" = "${editValue}"`
          );
        }
      });
    }

    dbRecord[dbFieldName] = editValue;
    console.log(`Final mapping: ${dbFieldName} = "${editValue}"`);
  });

  // Add audit fields
  dbRecord.created_by = currentUser;
  dbRecord.modified_by = currentUser;
  dbRecord.created_at = timestamp;
  dbRecord.modified_at = timestamp;
  dbRecord.version = version;
  dbRecord.session_id = sessionId;
  dbRecord.app_id = appId;

  console.log("=== FINAL DB RECORD ===");
  console.log(dbRecord);
  return dbRecord;
}

/**
 * Convert Qlik field name to database column name
 */
function convertToDbColumnName(fieldName) {
  return fieldName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_") // Replace non-alphanumeric with underscore
    .replace(/_+/g, "_") // Replace multiple underscores with single
    .replace(/^_|_$/g, ""); // Remove leading/trailing underscores
}

/**
 * Group edited data by primary key
 */
function groupEditsByPrimaryKey(
  editedData,
  baseRows,
  baseColumns,
  modelStructure
) {
  const grouped = {};

  if (!modelStructure.primaryKey) {
    console.error("No primary key field detected");
    return grouped;
  }

  Object.entries(editedData).forEach(([key, value]) => {
    // Extract primary key from edit key
    const primaryKey = extractPrimaryKeyFromEditKey(
      key,
      baseRows,
      baseColumns,
      modelStructure
    );

    if (primaryKey) {
      if (!grouped[primaryKey]) {
        grouped[primaryKey] = {};
      }

      // Extract field name from edit key
      const fieldName = extractFieldNameFromEditKey(key);
      grouped[primaryKey][fieldName] = value;
    }
  });

  return grouped;
}

/**
 * Extract primary key from edit key
 */
function extractPrimaryKeyFromEditKey(
  editKey,
  baseRows,
  baseColumns,
  modelStructure
) {
  // Handle composite keys (key1::key2::field) or simple keys (key-field)
  if (editKey.includes("::")) {
    return editKey.split("::")[0]; // First part is primary key
  } else if (editKey.includes("-")) {
    const lastDashIndex = editKey.lastIndexOf("-");
    return editKey.substring(0, lastDashIndex);
  }

  return null;
}

/**
 * Extract field name from edit key
 */
function extractFieldNameFromEditKey(editKey) {
  if (editKey.includes("::")) {
    const parts = editKey.split("::");
    return parts[parts.length - 1]; // Last part is field name
  } else if (editKey.includes("-")) {
    const lastDashIndex = editKey.lastIndexOf("-");
    return editKey.substring(lastDashIndex + 1);
  }

  return editKey;
}

/**
 * Find source row by primary key - ENHANCED VERSION
 */
function findRowByPrimaryKey(
  baseRows,
  baseColumns,
  primaryKey,
  modelStructure
) {
  console.log(`Looking for row with primaryKey: ${primaryKey}`);
  console.log(`Base rows count: ${baseRows.length}`);
  console.log(`Base columns:`, baseColumns);

  // Parse the primaryKey (row ID) to extract key components
  // Row ID format: "aa16889|row-0" or "keypart1|keypart2|row-N"
  const parts = primaryKey.split("|");
  const rowIndexPart = parts[parts.length - 1]; // "row-N"
  const keyParts = parts.slice(0, -1); // ["aa16889"] or ["keypart1", "keypart2"]

  console.log(`Primary key parts:`, parts);
  console.log(`Row index part: ${rowIndexPart}`);
  console.log(`Key parts:`, keyParts);

  // Method 1: Extract row index and verify with AccountID
  const rowIndexMatch = rowIndexPart.match(/row-(\d+)/);
  if (rowIndexMatch) {
    const rowIndex = parseInt(rowIndexMatch[1]);
    console.log(`Extracted row index: ${rowIndex}`);

    if (rowIndex >= 0 && rowIndex < baseRows.length) {
      const row = baseRows[rowIndex];
      console.log(`Found row at index ${rowIndex}:`, row);

      // Verify the row matches the key parts by checking AccountID (first dimension)
      if (row[0] && row[0].qText && keyParts.length > 0) {
        const firstKey = keyParts[0]; // Should be AccountID
        const actualValue = row[0].qText;

        console.log(`Comparing key: "${firstKey}" vs actual: "${actualValue}"`);

        if (actualValue === firstKey) {
          console.log(`Row matched successfully by index + AccountID!`);
          return row;
        } else {
          console.log(
            `Key mismatch: expected "${firstKey}", got "${actualValue}"`
          );
        }
      } else {
        console.log(`No key verification possible, using row by index anyway`);
        return row;
      }
    } else {
      console.log(
        `Row index ${rowIndex} out of bounds (max: ${baseRows.length - 1})`
      );
    }
  } else {
    console.log(`Could not extract row index from: ${rowIndexPart}`);
  }

  // Method 2: Fallback - search by AccountID in key parts
  console.log(`Fallback: searching by AccountID in key parts...`);
  if (keyParts.length > 0) {
    const searchKey = keyParts[0]; // AccountID should be first

    for (let i = 0; i < baseRows.length; i++) {
      const row = baseRows[i];
      if (row[0] && row[0].qText === searchKey) {
        console.log(
          `Found matching row by AccountID "${searchKey}" at index ${i}:`,
          row
        );
        return row;
      }
    }

    console.log(`No row found with AccountID: ${searchKey}`);
  }

  // Method 3: Last resort - try to match with primary key field directly
  if (modelStructure.primaryKey) {
    const primaryKeyIndex = modelStructure.primaryKey.index;
    console.log(
      `Last resort: searching by primary key index ${primaryKeyIndex}...`
    );

    // Try to extract just the AccountID from the complex key
    let searchValue = primaryKey;
    if (keyParts.length > 0) {
      searchValue = keyParts[0]; // First part should be AccountID
    }

    const foundRow = baseRows.find((row) => {
      return row[primaryKeyIndex] && row[primaryKeyIndex].qText === searchValue;
    });

    if (foundRow) {
      console.log(`Found row by primary key field match:`, foundRow);
      return foundRow;
    }
  }

  console.log(`No matching row found for primaryKey: ${primaryKey}`);
  return null;
}

/**
 * Extract value from row based on index and type
 */
function extractValueFromRow(row, index, type) {
  if (!row[index]) return null;

  if (type === "measure") {
    const num = parseFloat(row[index].qNum);
    return isNaN(num) ? null : num;
  } else {
    return row[index].qText || null;
  }
}

/**
 * Generate SQL dynamically based on record structure
 */
function generateDynamicSQL(record, modelStructure) {
  // Get all columns from the record
  const columns = Object.keys(record);
  const values = columns.map((column) => {
    const value = record[column];

    // Handle different data types
    if (value === null || value === undefined) {
      return "NULL";
    } else if (typeof value === "number") {
      return value;
    } else if (typeof value === "string") {
      return `'${value.replace(/'/g, "''")}'`; // Escape single quotes
    } else {
      return `'${String(value).replace(/'/g, "''")}'`;
    }
  });

  const sql = `
INSERT INTO writeback_data (
  ${columns.join(",\n  ")}
) VALUES (
  ${values.join(",\n  ")}
);`;

  return sql;
}

/**
 * Send database records to Qlik Automation for PostgreSQL insertion
 */
async function sendToPostgreSQLAutomation(dbRecords, layout, context) {
  if (
    !ENV.DB_SAVE_WEBHOOK_URL ||
    ENV.DB_SAVE_WEBHOOK_URL.includes("YOUR_TENANT")
  ) {
    throw new Error(
      "Database webhook URL not configured. Please update config/env.js"
    );
  }

  console.log("Sending to PostgreSQL automation (DYNAMIC):", {
    webhookUrl: ENV.DB_SAVE_WEBHOOK_URL,
    recordCount: dbRecords.length,
    user: context.user,
  });

  // Analyze model structure for SQL generation
  const modelStructure = analyzeModelStructure(layout);

  // Generate SQL dynamically
  const sql = generateDynamicSQL(dbRecords[0], modelStructure);

  const payload = {
    query: sql,
    app_id: context.appId,
    model_info: {
      primary_key: modelStructure.primaryKey?.name,
      key_dimensions: modelStructure.keyDimensions.map((d) => d.name),
      writeback_fields: modelStructure.writebackFields, // 🎯 DYNAMIC
      total_columns:
        modelStructure.keyDimensions.length +
        modelStructure.writebackFields.length +
        modelStructure.auditFields.length,
    },
  };

  console.log("Dynamic database payload:", JSON.stringify(payload, null, 2));

  const requestOptions = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(ENV.DB_SAVE_TOKEN &&
        !ENV.DB_SAVE_TOKEN.includes("your_actual") && {
          "X-Execution-Token": ENV.DB_SAVE_TOKEN,
        }),
    },
    body: JSON.stringify(payload),
  };

  const response = await fetch(ENV.DB_SAVE_WEBHOOK_URL, requestOptions);

  if (!response.ok) {
    const errorText = await response.text();
    console.error("PostgreSQL automation error:", errorText);
    throw new Error(
      `HTTP ${response.status}: ${response.statusText} - ${errorText}`
    );
  }

  let responseData;
  try {
    responseData = await response.json();
  } catch {
    responseData = { success: true, message: await response.text() };
  }

  console.log("PostgreSQL automation response:", responseData);
  return responseData;
}

/**
 * Get or create session ID
 */
function getOrCreateSessionId() {
  let sessionId = sessionStorage.getItem("qlik_writeback_session");
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    sessionStorage.setItem("qlik_writeback_session", sessionId);
  }
  return sessionId;
}

/**
 * Get consistent app ID
 */
function getConsistentAppId(app, layout) {
  if (app && app.id) {
    return app.id;
  } else if (layout?.qInfo?.qId) {
    return layout.qInfo.qId;
  } else {
    return "unknown-app";
  }
}

/**
 * Get base columns from hypercube layout
 */
function getBaseColumns(layout) {
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
 * Get base rows from hypercube layout
 */
function getBaseRows(layout) {
  return layout?.qHyperCube?.qDataPages?.[0]?.qMatrix || [];
}

/**
 * Get current Qlik user
 */
async function getCurrentQlikUser(app) {
  console.log("Getting current user...");

  try {
    if (app && typeof app.getAppLayout === "function") {
      const appLayout = await app.getAppLayout();
      const owner = appLayout?.owner;
      if (owner && typeof owner === "string") {
        if (owner.includes("\\")) {
          return owner.split("\\").pop();
        }
        return owner;
      }
    }

    return "Unknown User";
  } catch (error) {
    console.error("Error getting user:", error);
    return "Unknown User";
  }
}

/**
 * Test the database connection
 */
export async function testDatabaseConnection() {
  try {
    const testPayload = {
      query: "SELECT 1 as test_connection;",
      app_id: "test_app",
    };

    const response = await fetch(ENV.DB_SAVE_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(ENV.DB_SAVE_TOKEN &&
          !ENV.DB_SAVE_TOKEN.includes("your_actual") && {
            "X-Execution-Token": ENV.DB_SAVE_TOKEN,
          }),
      },
      body: JSON.stringify(testPayload),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return {
      success: true,
      message: "Database connection test successful",
      status: response.status,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}
