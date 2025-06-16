// utils/saveService.js - Writeback Save Service
import ENV from "../config/env.js";

/**
 * Save writeback data to Qlik Automation
 * Takes the edited data and sends it to your automation webhook
 */
export async function saveWritebackData(editedData, layout, app) {
  try {
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

    console.log("Saving writeback data for appId:", appId);

    const fileName = `writeback_${appId}_${timestamp.replace(
      /[:.]/g,
      "-"
    )}.csv`;

    // Convert editedData to CSV format for your automation
    const csvContent = generateCSV(editedData, layout, timestamp);

    // Send to your Qlik Automation
    const result = await sendToAutomation(
      csvContent,
      appId,
      timestamp,
      fileName
    );

    return {
      success: true,
      message: "Data saved successfully",
      fileName,
      timestamp,
      changeCount: Object.keys(editedData).length,
    };
  } catch (error) {
    console.error("Save operation failed:", error);
    throw new Error(`Failed to save: ${error.message}`);
  }
}

/**
 * Generate CSV content from edited data with merged values in actual columns
 */
function generateCSV(editedData, layout, timestamp) {
  const columns =
    layout?.qHyperCube?.qDimensionInfo?.map((d) => d.qFallbackTitle) || [];
  const measures =
    layout?.qHyperCube?.qMeasureInfo?.map((m) => m.qFallbackTitle) || [];
  const allColumns = [...columns, ...measures];
  const rows = layout?.qHyperCube?.qDataPages?.[0]?.qMatrix || [];

  // Create a map of edited values by rowId and field for quick lookup
  const editedValuesByRow = {};

  Object.entries(editedData).forEach(([key, value]) => {
    const lastDashIndex = key.lastIndexOf("-");
    const actualRowId = key.substring(0, lastDashIndex);
    const fieldName = key.substring(lastDashIndex + 1);

    if (!editedValuesByRow[actualRowId]) {
      editedValuesByRow[actualRowId] = {};
    }
    editedValuesByRow[actualRowId][fieldName] = value;
  });

  // CSV Headers: include all table columns plus writeback audit info
  const csvHeaders = [
    ...allColumns,
    "WRITEBACK_FIELD",
    "WRITEBACK_VALUE",
    "WRITEBACK_TIMESTAMP",
    "WRITEBACK_USER",
    "AUDIT_ID",
  ];

  const csvRows = [csvHeaders.join(",")];

  // Process each edited field
  Object.entries(editedData).forEach(([key, value]) => {
    const lastDashIndex = key.lastIndexOf("-");
    const actualRowId = key.substring(0, lastDashIndex);
    const fieldName = key.substring(lastDashIndex + 1);

    // Find the corresponding row by reconstructing the rowId for each row
    let foundRow = null;

    rows.forEach((row, index) => {
      const uniqueParts = [];

      if (row && row.length > 0) {
        for (let i = 0; i < Math.min(3, row.length); i++) {
          if (row[i] && row[i].qText) {
            uniqueParts.push(row[i].qText);
          }
        }
      }

      uniqueParts.push(`row-${index}`);
      const reconstructedRowId = uniqueParts.join("|");

      if (reconstructedRowId === actualRowId) {
        foundRow = row;
      }
    });

    if (foundRow) {
      const csvRow = [];

      // Add all original column values, merging in edited values where they exist
      allColumns.forEach((colName, colIndex) => {
        let cellValue;

        const rowEdits = editedValuesByRow[actualRowId];

        if (rowEdits && rowEdits[colName]) {
          // Use the edited value instead of original
          cellValue = rowEdits[colName];
        } else if (rowEdits && colName === fieldName) {
          // Also check if the current field being processed matches this column
          cellValue = value;
        } else {
          // Use original value
          if (foundRow[colIndex] && foundRow[colIndex].qText !== undefined) {
            cellValue = foundRow[colIndex].qText;
          } else {
            cellValue = "";
          }
        }

        csvRow.push(`"${cellValue}"`);
      });

      // Add writeback audit information
      csvRow.push(`"${fieldName}"`);
      csvRow.push(`"${value}"`);
      csvRow.push(`"${timestamp}"`);
      csvRow.push(`"User"`);
      csvRow.push(`"${Date.now()}_${Math.random().toString(36).substr(2, 9)}"`);

      csvRows.push(csvRow.join(","));
    } else {
      // Fallback: create a row with just the writeback data
      const csvRow = new Array(allColumns.length).fill('""');
      csvRow.push(`"${fieldName}"`);
      csvRow.push(`"${value}"`);
      csvRow.push(`"${timestamp}"`);
      csvRow.push(`"User"`);
      csvRow.push(`"${Date.now()}_${Math.random().toString(36).substr(2, 9)}"`);

      csvRows.push(csvRow.join(","));
    }
  });

  return csvRows.join("\n");
}

/**
 * Send form data to Qlik Automation webhook
 */
async function sendToAutomation(csvContent, appId, timestamp, fileName) {
  if (
    !ENV.DB_SAVE_WEBHOOK_URL ||
    ENV.DB_SAVE_WEBHOOK_URL.includes("YOUR_TENANT")
  ) {
    throw new Error(
      "Save webhook URL not configured. Please update config/env.js"
    );
  }

  const formData = new FormData();
  formData.append("csvContent", csvContent);
  formData.append("appId", appId);
  formData.append("timestamp", timestamp);
  formData.append("userAgent", navigator.userAgent);
  formData.append("fileName", fileName);

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
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  let responseData;
  try {
    responseData = await response.json();
  } catch {
    responseData = { success: true, message: await response.text() };
  }

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
