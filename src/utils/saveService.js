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
 * Get current Qlik user's REAL DISPLAY NAME like "karthik burra"
 * This approach uses the Qlik Cloud Users REST API to get the actual user name
 */
async function getCurrentQlikUser(app) {
  console.log("Getting current user display name...");

  try {
    // Step 1: Get the user ID first using getAuthenticatedUser
    let userId = null;
    let userDirectory = null;

    if (
      app &&
      app.global &&
      typeof app.global.getAuthenticatedUser === "function"
    ) {
      try {
        const userInfo = await app.global.getAuthenticatedUser();
        console.log("Raw user info from getAuthenticatedUser:", userInfo);

        if (userInfo) {
          // Parse the response format: "UserDirectory=; UserId=auth0|..."
          if (typeof userInfo === "string") {
            const userIdMatch = userInfo.match(/UserId=([^;]+)/);
            const userDirMatch = userInfo.match(/UserDirectory=([^;]*)/);

            if (userIdMatch && userIdMatch[1]) {
              userId = userIdMatch[1].trim();
            }
            if (userDirMatch && userDirMatch[1]) {
              userDirectory = userDirMatch[1].trim();
            }
          } else if (typeof userInfo === "object") {
            userId = userInfo.qUserId || userInfo.UserId || userInfo.userId;
            userDirectory = userInfo.qUserDirectory || userInfo.UserDirectory;
          }
        }
      } catch (error) {
        console.log("getAuthenticatedUser failed:", error);
      }
    }

    console.log("🔍 Extracted userId:", userId);
    console.log("🔍 Extracted userDirectory:", userDirectory);

    // Step 2: If we have a userId, try to get the display name from Qlik Cloud API
    if (userId) {
      try {
        const displayName = await getUserDisplayNameFromAPI(userId, app);
        if (displayName) {
          console.log("SUCCESS: Got real display name from API:", displayName);
          return displayName;
        }
      } catch (error) {
        console.log("Failed to get display name from API:", error);
      }
    }

    // Step 3: Try alternative methods to get user info
    if (app && typeof app.getAppLayout === "function") {
      try {
        const appLayout = await app.getAppLayout();
        console.log("Checking app layout for user info...");

        // Check app metadata for user names
        let user = null;

        if (appLayout?.qMeta?.createdBy) {
          user = appLayout.qMeta.createdBy;
        } else if (appLayout?.qMeta?.modifiedBy) {
          user = appLayout.qMeta.modifiedBy;
        } else if (appLayout?.qMeta?.owner) {
          user = appLayout.qMeta.owner;
        }

        if (user && typeof user === "string") {
          // If it looks like a display name (contains space), use it
          if (
            user.includes(" ") &&
            !user.includes("@") &&
            !user.includes("\\")
          ) {
            console.log("SUCCESS: Got display name from app layout:", user);
            return user;
          }
        }
      } catch (error) {
        console.log("App layout method failed:", error);
      }
    }

    // Step 4: Fallback - try to extract meaningful name from user ID
    if (userId) {
      let cleanUser = userId;

      // Clean up auth0 IDs
      if (cleanUser.startsWith("auth0|")) {
        const authId = cleanUser.substring(6);
        cleanUser = `user_${authId.substring(0, 8)}`;
      }

      // Clean up other formats
      if (cleanUser.includes("\\")) {
        cleanUser = cleanUser.split("\\").pop();
      }
      if (cleanUser.includes("@")) {
        cleanUser = cleanUser.split("@")[0];
      }

      console.log("Using cleaned user ID:", cleanUser);
      return cleanUser;
    }

    // Step 5: Generate session-based user as last resort
    let sessionUser = null;

    if (typeof sessionStorage !== "undefined") {
      sessionUser = sessionStorage.getItem("qlik_writeback_user");
    }

    if (!sessionUser) {
      const timestamp = Date.now().toString();
      const random = Math.random().toString(36).substr(2, 5);
      sessionUser = `user_${timestamp.slice(-6)}_${random}`;

      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem("qlik_writeback_user", sessionUser);
      }
    }

    console.log("FALLBACK: Using generated session user:", sessionUser);
    return sessionUser;
  } catch (error) {
    console.error("Error getting user:", error);

    const fallbackUser = `user_${Date.now().toString().slice(-8)}`;
    console.log("FINAL FALLBACK: Using emergency fallback user:", fallbackUser);
    return fallbackUser;
  }
}

/**
 * Get user display name from Qlik Cloud Users REST API
 * This requires the user to be findable in the tenant's user list
 */
async function getUserDisplayNameFromAPI(userId, app) {
  try {
    console.log(
      "Attempting to get display name from Qlik Cloud API for userId:",
      userId
    );

    // Get the tenant hostname for API calls
    const hostname = window.location.hostname;
    if (!hostname.includes("qlikcloud")) {
      console.log("Not on Qlik Cloud, skipping API call");
      return null;
    }

    // Construct the Users API endpoint
    const apiBaseUrl = `https://${hostname}/api/v1`;
    const usersEndpoint = `${apiBaseUrl}/users`;

    // Try to search for the user by subject (userId)
    const searchUrl = `${usersEndpoint}?filter=subject eq "${encodeURIComponent(
      userId
    )}"`;

    console.log("Making API call to:", searchUrl);

    // Try to use the app's session for authentication
    const response = await fetch(searchUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      credentials: "include", // Use the current session cookies
    });

    if (!response.ok) {
      console.log("API call failed with status:", response.status);
      return null;
    }

    const data = await response.json();
    console.log("API response:", data);

    if (data.data && data.data.length > 0) {
      const user = data.data[0];
      if (user.name) {
        console.log("Found user display name:", user.name);
        return user.name;
      }
    }

    console.log("No user found or no name field in response");
    return null;
  } catch (error) {
    console.log("Failed to get user from API:", error);
    return null;
  }
}

/**
 * Alternative method: Try to get user info from Qlik's internal APIs
 * This might work in some Qlik Cloud environments
 */
async function getUserInfoFromInternalAPI(app) {
  try {
    // Try to get user info from Qlik's internal user API
    const hostname = window.location.hostname;
    const userInfoUrl = `https://${hostname}/api/v1/users/me`;

    console.log("Trying internal user API:", userInfoUrl);

    const response = await fetch(userInfoUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      credentials: "include",
    });

    if (response.ok) {
      const userData = await response.json();
      console.log("Internal API user data:", userData);

      if (userData.name) {
        console.log("Got display name from internal API:", userData.name);
        return userData.name;
      }
    }

    return null;
  } catch (error) {
    console.log("Internal API failed:", error);
    return null;
  }
}

/**
 * Enhanced user detection that tries to get real display name
 */
async function getReliableCurrentUser(app) {
  console.log("Getting reliable current user with display name...");

  // First try cached user
  const cachedUser = getCachedUser();
  if (cachedUser) {
    console.log("Using cached user:", cachedUser);
    return cachedUser;
  }

  // Try the main method
  const user = await getCurrentQlikUser(app);

  // Cache the result
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem("cached_qlik_user", user);
    sessionStorage.setItem("cached_qlik_user_timestamp", Date.now().toString());
  }

  return user;
}

/**
 * Get cached user if available and recent (within 1 hour)
 */
function getCachedUser() {
  try {
    if (typeof sessionStorage === "undefined") return null;

    const cachedUser = sessionStorage.getItem("cached_qlik_user");
    const cachedTimestamp = sessionStorage.getItem(
      "cached_qlik_user_timestamp"
    );

    if (!cachedUser || !cachedTimestamp) return null;

    const cacheAge = Date.now() - parseInt(cachedTimestamp);
    const oneHour = 60 * 60 * 1000;

    if (cacheAge < oneHour) {
      return cachedUser;
    } else {
      // Clear old cache
      sessionStorage.removeItem("cached_qlik_user");
      sessionStorage.removeItem("cached_qlik_user_timestamp");
      return null;
    }
  } catch (error) {
    return null;
  }
}

/**
 * Simple method to extract a reasonable display name from user ID
 * This is used when API calls fail but we have a meaningful user ID
 */
function extractDisplayNameFromUserId(userId) {
  if (!userId) return null;

  // If it's an email, extract the username part and make it readable
  if (userId.includes("@")) {
    const username = userId.split("@")[0];
    // Convert dots and underscores to spaces and title case
    return username
      .replace(/[._]/g, " ")
      .replace(/\b\w/g, (l) => l.toUpperCase());
  }

  // If it has underscores or dots, make it readable
  if (userId.includes("_") || userId.includes(".")) {
    return userId
      .replace(/[._]/g, " ")
      .replace(/\b\w/g, (l) => l.toUpperCase());
  }

  // If it's camelCase, split it
  if (/[a-z][A-Z]/.test(userId)) {
    return userId
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\b\w/g, (l) => l.toUpperCase());
  }

  return userId;
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
