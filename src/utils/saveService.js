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
    const timestamp = generateETTimestamp();
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
      fileName: "Clean Database",
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
 * UPDATED: Convert edited data with improved user/time handling
 */
function convertToDbRecords(
  editedData,
  layout,
  currentUser,
  timestamp,
  appId,
  sessionId
) {
  console.log("Converting edited data to database records (CLEAN SCHEMA)...");

  const baseRows = getBaseRows(layout);
  const baseColumns = getBaseColumns(layout);
  const dbRecords = [];

  const modelStructure = analyzeModelStructure(layout);
  console.log("Detected clean model structure:", modelStructure);

  const editsByPrimaryKey = groupEditsByPrimaryKey(
    editedData,
    baseRows,
    baseColumns,
    modelStructure
  );

  console.log("Edits grouped by primary key:", Object.keys(editsByPrimaryKey));

  // Generate simple version number
  const version = generateSimpleVersion();

  Object.entries(editsByPrimaryKey).forEach(([primaryKey, edits]) => {
    console.log(`Processing ${primaryKey}:`, edits);

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

    const dbRecord = createCleanDbRecord(
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
    console.log(`Created clean DB record for ${primaryKey}:`, dbRecord);
  });

  return dbRecords;
}

/**
 * UPDATED: Get writeback fields dynamically from extension configuration
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

  console.log("✅ Dynamic writeback fields from config:", writebackFields);
  return writebackFields;
}

/**
 * UPDATED: Analyze model structure - Clean schema focused
 */
function analyzeModelStructure(layout) {
  const dimensions = layout.qHyperCube?.qDimensionInfo || [];

  const structure = {
    primaryKey: null,
    keyDimensions: [], // ONLY the first dimension (primary key)
    writebackFields: getWritebackFieldsFromConfig(layout),
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

    // ONLY include the primary key dimension (accountid)
    structure.keyDimensions.push({
      name: dimensions[0].qFallbackTitle,
      dbColumn: convertToDbColumnName(dimensions[0].qFallbackTitle),
      index: 0,
      type: "dimension",
    });
  }

  console.log("🏗️ Clean model structure:", {
    primaryKey: structure.primaryKey?.name,
    keyDimensions: structure.keyDimensions.length,
    writebackFields: structure.writebackFields.length,
    auditFields: structure.auditFields.length,
    writebackColumns: structure.writebackFields,
  });

  return structure;
}

/**
 * Generate all possible UI field name variations from database field name
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
 * UPDATED: Create clean database record with improved user/time handling
 */
function createCleanDbRecord(
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
  console.log("=== CREATE CLEAN DB RECORD ===");
  console.log("Edits received:", edits);
  console.log("Writeback fields expected:", modelStructure.writebackFields);

  const dbRecord = {};

  // Add ONLY the primary key dimension (accountid)
  modelStructure.keyDimensions.forEach((dimension) => {
    const value = extractValueFromRow(
      sourceRow,
      dimension.index,
      dimension.type
    );
    dbRecord[dimension.dbColumn] = value;
  });

  // Add writeback fields with dynamic mapping
  modelStructure.writebackFields.forEach((dbFieldName) => {
    let editValue = "";

    const possibleUINames = generateUIFieldVariations(dbFieldName);

    console.log(`Looking for edit value for DB field "${dbFieldName}"`);
    console.log(`Possible UI names:`, possibleUINames);

    for (const uiName of possibleUINames) {
      if (edits.hasOwnProperty(uiName)) {
        editValue = edits[uiName];
        console.log(
          `✅ Found mapping: "${uiName}" → "${dbFieldName}" = "${editValue}"`
        );
        break;
      }
    }

    if (!editValue) {
      Object.keys(edits).forEach((editKey) => {
        if (fuzzyMatchFields(editKey, dbFieldName)) {
          editValue = edits[editKey];
          console.log(
            `🔍 Fuzzy match: "${editKey}" → "${dbFieldName}" = "${editValue}"`
          );
        }
      });
    }

    dbRecord[dbFieldName] = editValue || null;
  });

  // Add clean audit fields
  const etTimestamp = generateETTimestamp();
  const simpleVersion = generateSimpleVersion();

  dbRecord.created_by = currentUser;
  dbRecord.modified_by = currentUser;
  dbRecord.created_at = etTimestamp;
  dbRecord.modified_at = etTimestamp;
  dbRecord.version = simpleVersion;
  dbRecord.session_id = sessionId;
  dbRecord.app_id = appId;

  console.log("=== FINAL CLEAN DB RECORD ===");
  console.log(dbRecord);
  return dbRecord;
}

/**
 * Get current Qlik user - IMPROVED for readable names
 */
async function getCurrentQlikUser(app) {
  console.log("🔍 Getting current user...");

  try {
    if (app && typeof app.getAppLayout === "function") {
      const appLayout = await app.getAppLayout();
      let user = appLayout?.owner;

      if (user && typeof user === "string") {
        // Clean up user name
        if (user.includes("\\")) {
          user = user.split("\\").pop();
        }

        // Convert auth0 ID to readable format
        if (user.startsWith("auth0|")) {
          const shortId = user.substring(6, 14);
          user = `user_${shortId}`;
        }

        // If it's an email, extract the username part
        if (user.includes("@")) {
          user = user.split("@")[0];
        }

        console.log("✅ Processed user name:", user);
        return user;
      }
    }

    // Fallback: Generate session-based user
    let sessionUser = sessionStorage.getItem("qlik_user_id");
    if (!sessionUser) {
      sessionUser = `user_${Date.now().toString().slice(-6)}`;
      sessionStorage.setItem("qlik_user_id", sessionUser);
    }

    console.log("📝 Using session user:", sessionUser);
    return sessionUser;
  } catch (error) {
    console.error("Error getting user:", error);
    return `user_${Date.now().toString().slice(-6)}`;
  }
}

/**
 * Generate ET timestamp
 */
function generateETTimestamp() {
  const now = new Date();

  // Convert to Eastern Time
  const etTime = new Date(
    now.toLocaleString("en-US", {
      timeZone: "America/New_York",
    })
  );

  // Format as YYYY-MM-DD HH:MM:SS
  const year = etTime.getFullYear();
  const month = (etTime.getMonth() + 1).toString().padStart(2, "0");
  const day = etTime.getDate().toString().padStart(2, "0");
  const hours = etTime.getHours().toString().padStart(2, "0");
  const minutes = etTime.getMinutes().toString().padStart(2, "0");
  const seconds = etTime.getSeconds().toString().padStart(2, "0");

  const formatted = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

  console.log("🕐 Generated ET timestamp:", formatted);
  return formatted;
}

/**
 * FIXED: Generate smaller version number that fits in PostgreSQL INTEGER
 */
function generateSimpleVersion() {
  const now = new Date();
  const etTime = new Date(
    now.toLocaleString("en-US", {
      timeZone: "America/New_York",
    })
  );

  // Use smaller format: MMDDHHMM (8 digits max, fits in INTEGER)
  const version = parseInt(
    (etTime.getMonth() + 1).toString().padStart(2, "0") + // MM (01-12)
      etTime.getDate().toString().padStart(2, "0") + // DD (01-31)
      etTime.getHours().toString().padStart(2, "0") + // HH (00-23)
      etTime.getMinutes().toString().padStart(2, "0") // MM (00-59)
  );

  console.log("📊 Generated smaller version (MMDDHHMM):", version);
  return version;
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
  if (editKey.includes("::")) {
    return editKey.split("::")[0];
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
    return parts[parts.length - 1];
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
  console.log(`🔍 Looking for row with primaryKey: ${primaryKey}`);

  const parts = primaryKey.split("|");
  const rowIndexPart = parts[parts.length - 1];
  const keyParts = parts.slice(0, -1);

  const rowIndexMatch = rowIndexPart.match(/row-(\d+)/);
  if (rowIndexMatch) {
    const rowIndex = parseInt(rowIndexMatch[1]);

    if (rowIndex >= 0 && rowIndex < baseRows.length) {
      const row = baseRows[rowIndex];

      if (row[0] && row[0].qText && keyParts.length > 0) {
        const firstKey = keyParts[0];
        const actualValue = row[0].qText;

        if (actualValue === firstKey) {
          console.log(`✅ Row matched successfully!`);
          return row;
        }
      }
      return row;
    }
  }

  if (keyParts.length > 0) {
    const searchKey = keyParts[0];
    for (let i = 0; i < baseRows.length; i++) {
      const row = baseRows[i];
      if (row[0] && row[0].qText === searchKey) {
        console.log(`✅ Found matching row by search key`);
        return row;
      }
    }
  }

  console.log(`❌ No matching row found for primaryKey: ${primaryKey}`);
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
 * UPDATED: Generate clean SQL for new schema with UPSERT
 */
function generateCleanSQL(record, modelStructure) {
  // Only include essential columns
  const essentialColumns = [
    ...modelStructure.keyDimensions.map((d) => d.dbColumn),
    ...modelStructure.writebackFields,
    ...modelStructure.auditFields,
  ];

  // Filter record to only include essential columns
  const cleanRecord = {};
  essentialColumns.forEach((column) => {
    if (record.hasOwnProperty(column)) {
      cleanRecord[column] = record[column];
    }
  });

  const columns = Object.keys(cleanRecord);
  const values = columns.map((column) => {
    const value = cleanRecord[column];

    if (value === null || value === undefined) {
      return "NULL";
    } else if (typeof value === "number") {
      return value;
    } else if (typeof value === "string") {
      return `'${value.replace(/'/g, "''")}'`;
    } else {
      return `'${String(value).replace(/'/g, "''")}'`;
    }
  });

  // Use UPSERT for clean data handling
  const sql = `
INSERT INTO writeback_data (
  ${columns.join(",\n  ")}
) VALUES (
  ${values.join(",\n  ")}
)
ON CONFLICT (accountid, session_id) 
DO UPDATE SET
  model_feedback = EXCLUDED.model_feedback,
  comments = EXCLUDED.comments,
  modified_by = EXCLUDED.modified_by,
  modified_at = EXCLUDED.modified_at,
  version = EXCLUDED.version;`;

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

  console.log("Sending to PostgreSQL automation (CLEAN SCHEMA):", {
    webhookUrl: ENV.DB_SAVE_WEBHOOK_URL,
    recordCount: dbRecords.length,
    user: context.user,
  });

  // Analyze model structure for SQL generation
  const modelStructure = analyzeModelStructure(layout);

  // Generate clean SQL with UPSERT
  const sql = generateCleanSQL(dbRecords[0], modelStructure);

  const payload = {
    query: sql,
    app_id: context.appId,
    model_info: {
      primary_key: modelStructure.primaryKey?.name,
      key_dimensions: modelStructure.keyDimensions.map((d) => d.name),
      writeback_fields: modelStructure.writebackFields,
      total_columns:
        modelStructure.keyDimensions.length +
        modelStructure.writebackFields.length +
        modelStructure.auditFields.length,
    },
  };

  console.log("🎯 Clean database payload:", JSON.stringify(payload, null, 2));

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
