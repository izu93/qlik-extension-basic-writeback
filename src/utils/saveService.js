// utils/saveService.js - Fixed CSV Save Service
import ENV from "../config/env.js";

/**
 * Save writeback data to Qlik Automation with properly formatted CSV
 */
export async function saveWritebackData(editedData, layout, app) {
  try {
    console.log("Starting save operation with data:", editedData);

    // Get current user information from Qlik app
    let currentUser = "Unknown";
    try {
      if (app && app.global) {
        const globalObject = await app.global;
        if (
          globalObject &&
          typeof globalObject.getAuthenticatedUser === "function"
        ) {
          const userInfo = await globalObject.getAuthenticatedUser();
          currentUser =
            userInfo?.qUserId ||
            userInfo?.qUserName ||
            userInfo?.userId ||
            "Unknown";
        }
      }

      // Alternative method if the above doesn't work
      if (
        currentUser === "Unknown" &&
        app &&
        typeof app.getAppLayout === "function"
      ) {
        const appLayout = await app.getAppLayout();
        currentUser =
          appLayout?.qLocaleInfo?.qUserName ||
          appLayout?.session?.user?.name ||
          appLayout?.session?.user?.userId ||
          "Unknown";
      }

      // Another alternative using session info
      if (currentUser === "Unknown" && typeof window !== "undefined") {
        // Try to get from browser context
        currentUser =
          window.qlik?.currentUser?.userId ||
          window.qlik?.session?.user?.name ||
          document.querySelector('meta[name="user"]')?.content ||
          "Unknown";
      }
    } catch (userError) {
      console.warn("Could not retrieve user information:", userError);
      currentUser = "Unknown";
    }

    console.log("Current user identified as:", currentUser);

    // Generate basic audit info - use stable app ID
    const timestamp = new Date().toISOString();
    let appId;

    // Priority: Use app.id first (more stable), then layout.qInfo.qId as fallback
    if (app && app.id) {
      appId = app.id;
    } else if (layout?.qInfo?.qId) {
      appId = layout.qInfo.qId;
    } else {
      appId = "unknown-app";
    }

    console.log(
      "Saving writeback data for appId:",
      appId,
      "by user:",
      currentUser
    );

    const fileName = `writeback_${appId}_${timestamp.replace(
      /[:.]/g,
      "-"
    )}.csv`;

    // Convert editedData to proper CSV format with real user
    const csvContent = generateProperCSV(
      editedData,
      layout,
      timestamp,
      currentUser
    );

    console.log("Generated CSV content:", csvContent);

    // Send to your Qlik Automation
    const result = await sendToAutomation(
      csvContent,
      appId,
      timestamp,
      fileName,
      currentUser
    );

    return {
      success: true,
      message: "Data saved successfully",
      fileName,
      timestamp,
      changeCount: Object.keys(editedData).length,
      savedBy: currentUser,
    };
  } catch (error) {
    console.error("Save operation failed:", error);
    throw new Error(`Failed to save: ${error.message}`);
  }
}

/**
 * Generate properly structured CSV with base data + writeback changes
 * Creates audit trail with real user information
 */
function generateProperCSV(
  editedData,
  layout,
  timestamp,
  currentUser = "Unknown"
) {
  console.log("Generating CSV for editedData:", editedData);
  console.log("Using user:", currentUser);

  // Get base columns and rows from hypercube
  const baseColumns = getBaseColumns(layout);
  const baseRows = getBaseRows(layout);

  console.log("Base columns:", baseColumns);
  console.log("Base rows count:", baseRows.length);

  // Get writeback configuration
  const writebackConfig = layout?.writebackConfig || { columns: [] };
  const writebackColumns = writebackConfig.columns || [];

  console.log(
    "Writeback columns:",
    writebackColumns.map((c) => c.columnName)
  );

  // Create full column headers with versioning
  const allHeaders = [
    ...baseColumns,
    ...writebackColumns.map((col) => col.columnName),
    "WRITEBACK_TIMESTAMP",
    "WRITEBACK_USER",
    "VERSION",
    "CHANGE_TYPE",
    "AUDIT_ID",
  ];

  const csvRows = [allHeaders.join(",")];
  console.log("CSV Headers:", allHeaders);

  // Group edited values by row identifier
  const editedValuesByRow = {};

  Object.entries(editedData).forEach(([key, value]) => {
    const lastDashIndex = key.lastIndexOf("-");
    const rowId = key.substring(0, lastDashIndex);
    const fieldName = key.substring(lastDashIndex + 1);

    if (!editedValuesByRow[rowId]) {
      editedValuesByRow[rowId] = {};
    }
    editedValuesByRow[rowId][fieldName] = value;
  });

  console.log("Edited values by row:", editedValuesByRow);

  // Generate version number (simple timestamp-based versioning)
  const version = Math.floor(Date.now() / 1000); // Unix timestamp as version

  // Process each edited row - CREATE AUDIT TRAIL VERSION
  Object.entries(editedValuesByRow).forEach(([rowId, rowEdits]) => {
    console.log(`Processing row ${rowId} with edits:`, rowEdits);

    // Find the corresponding base data row
    const rowMatch = findMatchingRow(rowId, baseRows, baseColumns);

    if (rowMatch) {
      console.log("Found matching row:", rowMatch.row);

      // Create audit trail row with version tracking and real user
      const csvRow = [];

      // Add base column values
      baseColumns.forEach((colName, colIndex) => {
        const cellValue = rowMatch.row[colIndex];
        const displayValue = cellValue ? cellValue.qText || "" : "";
        csvRow.push(`"${displayValue}"`);
      });

      // Add ALL writeback column values for this row
      writebackColumns.forEach((col) => {
        const value = rowEdits[col.columnName] || col.defaultValue || "";
        csvRow.push(`"${value}"`);
      });

      // Add audit columns with real user information
      csvRow.push(`"${timestamp}"`); // WRITEBACK_TIMESTAMP
      csvRow.push(`"${currentUser}"`); // WRITEBACK_USER (real user!)
      csvRow.push(`"${version}"`); // VERSION (incremental)
      csvRow.push(`"UPDATE"`); // CHANGE_TYPE
      csvRow.push(`"${generateAuditId()}"`); // AUDIT_ID

      csvRows.push(csvRow.join(","));
    } else {
      console.log(`No matching row found for rowId: ${rowId}`);

      // Create fallback row with real user information
      const csvRow = [];

      // Empty base columns
      baseColumns.forEach(() => {
        csvRow.push('""');
      });

      // Writeback columns with current edits
      writebackColumns.forEach((col) => {
        const value = rowEdits[col.columnName] || col.defaultValue || "";
        csvRow.push(`"${value}"`);
      });

      // Audit columns with real user
      csvRow.push(`"${timestamp}"`);
      csvRow.push(`"${currentUser}"`); // Real user here too
      csvRow.push(`"${version}"`);
      csvRow.push(`"INSERT"`);
      csvRow.push(`"${generateAuditId()}"`);

      csvRows.push(csvRow.join(","));
    }
  });

  const finalCSV = csvRows.join("\n");
  console.log("Final CSV with real user:", finalCSV);

  return finalCSV;
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
 * Find matching row in base data using enhanced row ID logic
 */
function findMatchingRow(rowId, baseRows, baseColumns) {
  console.log(`Looking for row with ID: ${rowId}`);

  // Parse the row ID to extract key components
  // Row ID format: "keypart1|keypart2|keypart3|row-N"
  const parts = rowId.split("|");
  const rowIndexPart = parts[parts.length - 1]; // "row-N"
  const keyParts = parts.slice(0, -1); // ["keypart1", "keypart2", "keypart3"]

  // Extract row index
  const rowIndexMatch = rowIndexPart.match(/row-(\d+)/);
  if (rowIndexMatch) {
    const rowIndex = parseInt(rowIndexMatch[1]);

    if (rowIndex >= 0 && rowIndex < baseRows.length) {
      const row = baseRows[rowIndex];
      console.log(`Found row at index ${rowIndex}:`, row);

      // Verify the row matches the key parts
      let isMatch = true;
      for (let i = 0; i < Math.min(keyParts.length, 3); i++) {
        if (row[i] && row[i].qText !== keyParts[i]) {
          isMatch = false;
          break;
        }
      }

      if (isMatch) {
        return { row, index: rowIndex };
      }
    }
  }

  // Fallback: try to find by key parts
  for (let i = 0; i < baseRows.length; i++) {
    const row = baseRows[i];
    let matches = 0;

    for (let j = 0; j < Math.min(keyParts.length, 3); j++) {
      if (row[j] && row[j].qText === keyParts[j]) {
        matches++;
      }
    }

    if (matches >= 2) {
      // At least 2 key parts match
      console.log(`Found matching row by key parts at index ${i}:`, row);
      return { row, index: i };
    }
  }

  console.log("No matching row found");
  return null;
}

/**
 * Generate unique audit ID
 */
function generateAuditId() {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Send form data to Qlik Automation webhook
 */
async function sendToAutomation(
  csvContent,
  appId,
  timestamp,
  fileName,
  currentUser = "Unknown"
) {
  if (
    !ENV.DB_SAVE_WEBHOOK_URL ||
    ENV.DB_SAVE_WEBHOOK_URL.includes("YOUR_TENANT")
  ) {
    throw new Error(
      "Save webhook URL not configured. Please update config/env.js"
    );
  }

  console.log("Sending to automation:", {
    webhookUrl: ENV.DB_SAVE_WEBHOOK_URL,
    appId,
    fileName,
    user: currentUser,
    csvLength: csvContent.length,
  });

  const formData = new FormData();
  formData.append("csvContent", csvContent);
  formData.append("appId", appId);
  formData.append("timestamp", timestamp);
  formData.append("userAgent", navigator.userAgent);
  formData.append("fileName", fileName);
  formData.append("currentUser", currentUser); // Send user info to automation

  const requestOptions = {
    method: "POST",
    body: formData,
  };

  if (ENV.DB_SAVE_TOKEN && !ENV.DB_SAVE_TOKEN.includes("your_actual")) {
    requestOptions.headers = {
      "X-Execution-Token": ENV.DB_SAVE_TOKEN,
    };
  }

  const response = await fetch(ENV.DB_SAVE_WEBHOOK_URL, requestOptions);

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Automation response error:", errorText);
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

  console.log("Automation response:", responseData);
  return responseData;
}

/**
 * Test the save webhook connection
 */
export async function testSaveConnection() {
  try {
    if (
      !ENV.DB_SAVE_WEBHOOK_URL ||
      ENV.DB_SAVE_WEBHOOK_URL.includes("YOUR_TENANT")
    ) {
      return {
        success: false,
        error: "Webhook URL not configured",
      };
    }

    const testPayload = {
      test: true,
      timestamp: new Date().toISOString(),
      message: "Connection test from Qlik extension",
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
      message: "Connection test successful",
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
