// utils/readService.js - Writeback Read Service
import ENV from "../config/env.js";

/**
 * Read writeback data from Qlik Automation and merge with current table data
 */
export async function loadWritebackData(layout, app) {
  try {
    // Use stable app ID - consistent with saveService
    let appId;

    // Priority: Use app.id first (more stable), then layout.qInfo.qId as fallback
    if (app && app.id) {
      appId = app.id;
    } else if (layout?.qInfo?.qId) {
      appId = layout.qInfo.qId;
    } else {
      appId = "unknown-app";
    }

    console.log("Loading writeback data for appId:", appId);

    // Call the read automation
    const response = await callReadAutomation(appId, "latest");

    if (!response.success) {
      console.warn("No writeback data found:", response.message);
      return {}; // Return empty object if no data found
    }

    // Parse the CSV data
    const writebackData = parseWritebackCSV(response.csvContent);

    // Merge with current table data
    const mergedData = mergeWritebackWithTable(writebackData, layout);

    console.log(
      `Loaded ${
        Object.keys(mergedData).length
      } writeback entries for app ${appId}`
    );

    return mergedData;
  } catch (error) {
    console.error("Failed to load writeback data:", error);
    return {}; // Return empty object on error so table still works
  }
}

/**
 * Call the read automation webhook
 */
async function callReadAutomation(appId, action = "latest") {
  if (
    !ENV.DB_READ_WEBHOOK_URL ||
    ENV.DB_READ_WEBHOOK_URL.includes("YOUR_TENANT")
  ) {
    throw new Error(
      "Read webhook URL not configured. Please update config/env.js"
    );
  }

  const formData = new FormData();
  formData.append("appId", appId);
  formData.append("action", action);

  const requestOptions = {
    method: "POST",
    body: formData,
  };

  // Add token if configured
  if (ENV.DB_READ_TOKEN && !ENV.DB_READ_TOKEN.includes("your_actual")) {
    requestOptions.headers = {
      "X-Execution-Token": ENV.DB_READ_TOKEN,
    };
  }

  const response = await fetch(ENV.DB_READ_WEBHOOK_URL, requestOptions);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(
      "Read automation failed:",
      response.status,
      response.statusText,
      errorText
    );
    throw new Error(
      `HTTP ${response.status}: ${response.statusText} - ${errorText}`
    );
  }

  let responseData;
  try {
    responseData = await response.json();
  } catch {
    // Handle non-JSON response
    const textResponse = await response.text();
    console.error("Non-JSON response received:", textResponse);
    throw new Error(`Invalid response format: ${textResponse}`);
  }

  // Handle array response (automation sometimes returns array)
  if (Array.isArray(responseData) && responseData.length > 0) {
    responseData = responseData[0];

    // If it's still a string after extracting from array, parse it
    if (typeof responseData === "string") {
      try {
        responseData = JSON.parse(responseData);
      } catch (e) {
        // Don't throw error - we might already have the object structure we need
      }
    }
  }

  // Check if we got writeback data - handle both object and string formats
  let hasSuccessStatus = false;
  let csvContent = null;
  let fileName = null;
  let responseAppId = null;

  if (typeof responseData === "object" && responseData.status === "success") {
    hasSuccessStatus = true;
    csvContent = responseData.csvContent;
    fileName = responseData.fileName;
    responseAppId = responseData.appId;
  } else if (
    typeof responseData === "string" &&
    responseData.includes('"status": "success"')
  ) {
    hasSuccessStatus = true;

    // Extract data manually from string - find the csvContent section
    const csvStartIndex =
      responseData.indexOf('"csvContent": "') + '"csvContent": "'.length;
    const csvEndIndex = responseData.lastIndexOf('"\n}');

    if (
      csvStartIndex > '"csvContent": "'.length - 1 &&
      csvEndIndex > csvStartIndex
    ) {
      const rawCsvContent = responseData.substring(csvStartIndex, csvEndIndex);

      // Properly handle escaped characters
      csvContent = rawCsvContent
        .replace(/\\n/g, "\n") // Convert \n to actual newlines
        .replace(/\\"/g, '"') // Convert \" to actual quotes
        .replace(/\\r/g, "\r"); // Convert \r to actual carriage returns
    }

    // Extract other fields with simpler regex
    const fileMatch = responseData.match(/"fileName":\s*"([^"]+)"/);
    const appMatch = responseData.match(/"appId":\s*"([^"]+)"/);

    if (fileMatch) fileName = fileMatch[1];
    if (appMatch) responseAppId = appMatch[1];
  }

  if (hasSuccessStatus && csvContent) {
    // Handle CSV content that might be a string or array
    let csvData = csvContent;

    // If it's a string, we need to parse it as CSV
    if (typeof csvData === "string") {
      // Split into lines and parse as CSV
      const lines = csvData.trim().split("\n");

      if (lines.length > 0) {
        // Parse each line as CSV
        const parsedData = lines.map((line) => {
          // Simple CSV parsing - handle quoted values
          const result = [];
          let current = "";
          let inQuotes = false;

          for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
              inQuotes = !inQuotes;
            } else if (char === "," && !inQuotes) {
              result.push(current.trim());
              current = "";
            } else {
              current += char;
            }
          }
          result.push(current.trim());
          return result;
        });
        csvData = parsedData;
      }
    }

    return {
      success: true,
      csvContent: csvData,
      fileName: fileName,
      appId: responseAppId,
    };
  } else if (hasSuccessStatus && !csvContent) {
    // No data found - this is normal for new apps
    return {
      success: false,
      message: "No writeback data found - this is expected for new apps",
    };
  } else {
    console.error("Unexpected automation response structure:", responseData);
    throw new Error("Unexpected response format from automation");
  }
}

/**
 * Parse CSV content returned from automation
 */
function parseWritebackCSV(csvContent) {
  const writebackData = {};

  if (!csvContent || !Array.isArray(csvContent)) {
    console.warn("Invalid CSV content format");
    return writebackData;
  }

  // csvContent is an array where first element is headers, rest are rows
  const [headers, ...rows] = csvContent;

  if (!headers || !Array.isArray(headers)) {
    console.warn("Invalid CSV headers");
    return writebackData;
  }

  // Find column indices for the data we need
  const columnIndices = {
    date: headers.indexOf("DATE"),
    event: headers.indexOf("EVENT"),
    time: headers.indexOf("TIME"),
    writebackField: headers.indexOf("WRITEBACK_FIELD"),
    writebackValue: headers.indexOf("WRITEBACK_VALUE"),
    timestamp: headers.indexOf("WRITEBACK_TIMESTAMP"),
    auditId: headers.indexOf("AUDIT_ID"),
  };

  // Process each row
  rows.forEach((row, index) => {
    if (!row || !Array.isArray(row)) return;

    const writebackField = row[columnIndices.writebackField];
    const writebackValue = row[columnIndices.writebackValue];
    const dateValue = row[columnIndices.date];
    const eventValue = row[columnIndices.event];
    const timeValue = row[columnIndices.time];
    const auditId = row[columnIndices.auditId];

    // Create a unique row identifier using SIMPLIFIED logic that matches the table
    const rowId = createRowId(dateValue, eventValue, timeValue, index);

    // Store the writeback value
    if (rowId && writebackField && writebackValue !== undefined) {
      const key = `${rowId}-${writebackField}`;
      writebackData[key] = {
        value: writebackValue,
        timestamp: row[columnIndices.timestamp],
        auditId: auditId,
        field: writebackField,
      };
    }
  });

  return writebackData;
}

/**
 * Create row ID using SIMPLIFIED logic that matches the table component
 * This should match exactly with the writebackTable.jsx row ID generation
 */
function createRowId(dateValue, eventValue, timeValue, rowIndex) {
  const uniqueParts = [];

  // Use the same logic as in writebackTable.jsx
  // Add the key identifying values
  if (dateValue) uniqueParts.push(dateValue);
  if (eventValue) uniqueParts.push(eventValue);
  if (timeValue) uniqueParts.push(timeValue);

  // Add row index for uniqueness
  uniqueParts.push(`row-${rowIndex}`);

  return uniqueParts.join("|");
}

/**
 * Merge writeback data with current table layout for initial load
 */
function mergeWritebackWithTable(writebackData, layout) {
  const mergedData = {};

  if (!layout?.qHyperCube?.qDataPages?.[0]?.qMatrix) {
    return mergedData;
  }

  const columns =
    layout.qHyperCube.qDimensionInfo?.map((d) => d.qFallbackTitle) || [];
  const measures =
    layout.qHyperCube.qMeasureInfo?.map((m) => m.qFallbackTitle) || [];
  const allColumns = [...columns, ...measures];
  const rows = layout.qHyperCube.qDataPages[0].qMatrix;

  // Process each row to find matching writeback data
  rows.forEach((row, index) => {
    // Create row ID using SAME logic as table component
    const uniqueParts = [];

    if (row && row.length > 0) {
      // Get first 3 values as identifier (matching writebackTable.jsx)
      for (let i = 0; i < Math.min(3, row.length); i++) {
        if (row[i] && row[i].qText) {
          uniqueParts.push(row[i].qText);
        }
      }
    }
    uniqueParts.push(`row-${index}`);
    const rowId = uniqueParts.join("|");

    // Check for writeback data for each writeback column
    allColumns.forEach((columnName) => {
      const key = `${rowId}-${columnName}`;

      if (writebackData[key]) {
        mergedData[key] = writebackData[key].value;
      }
    });
  });

  return mergedData;
}

/**
 * Test the read webhook connection
 */
export async function testReadConnection() {
  try {
    if (
      !ENV.DB_READ_WEBHOOK_URL ||
      ENV.DB_READ_WEBHOOK_URL.includes("YOUR_TENANT")
    ) {
      return {
        success: false,
        error: "Read webhook URL not configured",
      };
    }

    // Test with a dummy appId
    const testPayload = new FormData();
    testPayload.append("appId", "test-connection");
    testPayload.append("action", "latest");

    const response = await fetch(ENV.DB_READ_WEBHOOK_URL, {
      method: "POST",
      headers: {
        ...(ENV.DB_READ_TOKEN &&
          !ENV.DB_READ_TOKEN.includes("your_actual") && {
            "X-Execution-Token": ENV.DB_READ_TOKEN,
          }),
      },
      body: testPayload,
    });

    return {
      success: response.ok,
      message: response.ok
        ? "Read connection test successful"
        : "Connection failed",
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

/**
 * Get specific writeback file by date or action
 */
export async function getWritebackByAction(layout, app, action) {
  try {
    const appId = layout?.qInfo?.qId || "unknown-app";
    const response = await callReadAutomation(appId, action);

    if (!response.success) {
      return { success: false, message: response.message };
    }

    const writebackData = parseWritebackCSV(response.csvContent);
    const mergedData = mergeWritebackWithTable(writebackData, layout);

    return {
      success: true,
      data: mergedData,
      fileName: response.fileName,
      recordCount: Object.keys(mergedData).length,
    };
  } catch (error) {
    console.error("Failed to get writeback data:", error);
    return { success: false, message: error.message };
  }
}
