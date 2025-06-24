// utils/saveService.js - QlikCloud Auth0 User Resolution
import ENV from "../config/env.js";

/**
 * Get current user from QlikCloud - Handles Auth0 subject ID to readable name conversion
 */
async function getCurrentQlikUser(app) {
  let currentUser = "Unknown";

  try {
    console.log("🔍 Starting QlikCloud Auth0-aware user detection...");

    // Step 1: Get the Auth0 subject ID using various methods
    const auth0Subject = await getAuth0Subject(app);
    console.log("🔑 Auth0 Subject ID:", auth0Subject);

    if (auth0Subject && auth0Subject !== "Unknown") {
      // Step 2: Convert Auth0 subject to readable username via QlikCloud API
      const readableName = await convertAuth0SubjectToReadableName(
        auth0Subject
      );
      if (readableName && readableName !== "Unknown") {
        console.log(
          "✅ Successfully converted to readable name:",
          readableName
        );
        return readableName;
      }

      // Fallback: If API call fails, try to extract username from email if possible
      const fallbackName = await extractUsernameFromAuth0Subject(auth0Subject);
      if (fallbackName && fallbackName !== "Unknown") {
        console.log("🔄 Using fallback extracted name:", fallbackName);
        return fallbackName;
      }

      // Last resort: Use the Auth0 subject ID itself
      console.log(
        "⚠️ Using Auth0 subject as username (no conversion available)"
      );
      return auth0Subject;
    }

    console.log("❌ No Auth0 subject found, trying other methods...");

    // Step 3: Fallback to other detection methods
    return await fallbackUserDetection(app);
  } catch (error) {
    console.error("💥 Error in Auth0 user detection:", error);
    return "Unknown";
  }
}

/**
 * Get Auth0 subject ID from various sources
 */
async function getAuth0Subject(app) {
  console.log("🔍 Searching for Auth0 subject ID...");

  // Method 1: Try OSUser() expression if available
  if (app && typeof app.evaluate === "function") {
    try {
      console.log("📊 Trying OSUser() expression...");
      const osUserResult = await app.evaluate("OSUser()");
      console.log("OSUser() result:", osUserResult);

      if (osUserResult && typeof osUserResult === "string") {
        // Parse OSUser() result which typically looks like:
        // "UserDirectory=QLIKCLOUD; UserId=auth0|fcec2f3c14290076943546b83871cef1f4a400cb81c7e123d2511d46b9302378"
        const subjectMatch = osUserResult.match(/UserId=([^;]+)/);
        if (subjectMatch) {
          const subject = subjectMatch[1].trim();
          console.log("✅ Extracted Auth0 subject from OSUser():", subject);
          return subject;
        }

        // Sometimes it's just the subject directly
        if (osUserResult.startsWith("auth0|")) {
          console.log(
            "✅ Found direct Auth0 subject from OSUser():",
            osUserResult
          );
          return osUserResult;
        }
      }
    } catch (osUserError) {
      console.log("❌ OSUser() evaluation failed:", osUserError.message);
    }
  }

  // Method 2: Try app layout owner field (might contain Auth0 subject)
  if (app && typeof app.getAppLayout === "function") {
    try {
      console.log("📱 Checking app layout for Auth0 subject...");
      const appLayout = await app.getAppLayout();

      const possibleSubjects = [
        appLayout?.owner,
        appLayout?.qMeta?.createdBy,
        appLayout?.qMeta?.modifiedBy,
        appLayout?.createdBy,
        appLayout?.userId,
      ];

      for (const field of possibleSubjects) {
        if (field && typeof field === "string" && field.includes("auth0|")) {
          console.log("✅ Found Auth0 subject in app layout:", field);
          return field;
        }
      }
    } catch (layoutError) {
      console.log("❌ App layout check failed:", layoutError.message);
    }
  }

  // Method 3: Check browser storage for Auth0 tokens
  if (typeof window !== "undefined") {
    try {
      console.log("🌐 Checking browser storage for Auth0 tokens...");

      // Check for Auth0 tokens in storage
      const tokenSources = [
        () => localStorage.getItem("auth0.spajs.txs"),
        () => localStorage.getItem("@@auth0spajs@@::user"),
        () => localStorage.getItem("auth0.user"),
        () => sessionStorage.getItem("auth0.user"),
        () => localStorage.getItem("qlik-user"),
        () => sessionStorage.getItem("qlik-user"),
      ];

      for (const getToken of tokenSources) {
        try {
          const token = getToken();
          if (token) {
            console.log("Found token in storage, attempting to parse...");

            // Try to parse as JSON
            try {
              const parsed = JSON.parse(token);
              const subject = parsed.sub || parsed.user_id || parsed.subject;
              if (subject && subject.includes("auth0|")) {
                console.log("✅ Found Auth0 subject in parsed token:", subject);
                return subject;
              }
            } catch (parseError) {
              // Try as JWT token
              if (token.includes(".")) {
                try {
                  const payload = JSON.parse(atob(token.split(".")[1]));
                  const subject = payload.sub || payload.user_id;
                  if (subject && subject.includes("auth0|")) {
                    console.log("✅ Found Auth0 subject in JWT:", subject);
                    return subject;
                  }
                } catch (jwtError) {
                  // Silent fail
                }
              }
            }
          }
        } catch (e) {
          // Silent fail for each token source
        }
      }
    } catch (storageError) {
      console.log("❌ Storage check failed:", storageError);
    }
  }

  // Method 4: Check for Auth0 subject in URL or DOM
  if (typeof window !== "undefined") {
    try {
      // Check URL parameters
      const urlParams = new URLSearchParams(window.location.search);
      for (const [key, value] of urlParams) {
        if (value && value.includes("auth0|")) {
          console.log(`✅ Found Auth0 subject in URL param ${key}:`, value);
          return value;
        }
      }

      // Check DOM elements that might contain user info
      const metaElements = document.querySelectorAll('meta[content*="auth0|"]');
      for (const meta of metaElements) {
        const content = meta.getAttribute("content");
        if (content && content.includes("auth0|")) {
          console.log("✅ Found Auth0 subject in meta element:", content);
          return content;
        }
      }
    } catch (domError) {
      console.log("DOM/URL check failed:", domError);
    }
  }

  console.log("❌ No Auth0 subject found");
  return "Unknown";
}

/**
 * Convert Auth0 subject ID to readable username using QlikCloud Users API
 */
async function convertAuth0SubjectToReadableName(auth0Subject) {
  try {
    console.log(
      "🌐 Attempting to convert Auth0 subject to readable name via API..."
    );
    console.log("Auth0 Subject:", auth0Subject);

    // Extract tenant info from current URL
    const hostname = window.location.hostname;
    const tenantMatch = hostname.match(
      /^([^.]+)\.(us|eu|ap|ca)\.qlikcloud\.com$/
    );

    if (!tenantMatch) {
      console.log("❌ Could not determine tenant from hostname:", hostname);
      return "Unknown";
    }

    const tenant = tenantMatch[1];
    const region = tenantMatch[2];
    const baseUrl = `https://${tenant}.${region}.qlikcloud.com`;

    console.log("🏢 Detected tenant:", tenant, "region:", region);

    // Try to get user info from QlikCloud Users API
    const apiUrl = `${baseUrl}/api/v1/users?subject=${encodeURIComponent(
      auth0Subject
    )}`;
    console.log("🔗 API URL:", apiUrl);

    try {
      // First try: Use current session cookies (if user is logged in)
      const response = await fetch(apiUrl, {
        method: "GET",
        credentials: "include", // Include cookies
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        const userData = await response.json();
        console.log("✅ API Response:", userData);

        if (userData.data && userData.data.length > 0) {
          const user = userData.data[0];
          const name = user.name || user.email || user.id;

          if (name) {
            console.log("✅ Found readable name from API:", name);

            // Try to extract just the username part if it's an email
            if (name.includes("@")) {
              const username = name.split("@")[0];
              console.log("📧 Extracted username from email:", username);
              return username;
            }

            return name;
          }
        }
      } else {
        console.log(
          "❌ API request failed:",
          response.status,
          response.statusText
        );
      }
    } catch (apiError) {
      console.log("❌ API call failed:", apiError.message);
    }

    return "Unknown";
  } catch (error) {
    console.error("💥 Error converting Auth0 subject:", error);
    return "Unknown";
  }
}

/**
 * Try to extract a reasonable username from Auth0 subject ID
 */
async function extractUsernameFromAuth0Subject(auth0Subject) {
  try {
    console.log("🔧 Attempting to extract username from Auth0 subject...");

    // Remove the auth0| prefix
    const withoutPrefix = auth0Subject.replace("auth0|", "");

    // If it looks like an email, extract the username part
    if (withoutPrefix.includes("@")) {
      const username = withoutPrefix.split("@")[0];
      console.log("📧 Extracted username from email-like subject:", username);
      return username;
    }

    // If it's a GUID-like string, try to make it more readable
    if (withoutPrefix.match(/^[a-f0-9-]{36}$/i)) {
      // It's a GUID, use first 8 characters as identifier
      const shortId = withoutPrefix.substring(0, 8);
      console.log("🆔 Using short ID from GUID:", shortId);
      return `user_${shortId}`;
    }

    // If it's all hex or alphanumeric, take first 12 characters
    if (withoutPrefix.match(/^[a-f0-9]+$/i) && withoutPrefix.length > 12) {
      const shortId = withoutPrefix.substring(0, 12);
      console.log("🔤 Using short hex ID:", shortId);
      return `user_${shortId}`;
    }

    // If it contains recognizable patterns, try to extract them
    const patterns = [
      /([a-zA-Z0-9._-]+)@/, // Email username
      /^([a-zA-Z0-9._-]+)/, // First part before special chars
      /([a-zA-Z]+\d*)/, // Letters followed by optional numbers
    ];

    for (const pattern of patterns) {
      const match = withoutPrefix.match(pattern);
      if (match && match[1] && match[1].length >= 3) {
        console.log("🎯 Extracted pattern-based username:", match[1]);
        return match[1];
      }
    }

    // Last resort: use the subject as-is but shortened
    if (withoutPrefix.length > 20) {
      const shortened = withoutPrefix.substring(0, 20) + "...";
      console.log("✂️ Using shortened subject:", shortened);
      return shortened;
    }

    console.log("🔄 Using subject without auth0 prefix:", withoutPrefix);
    return withoutPrefix;
  } catch (error) {
    console.error("Error extracting username:", error);
    return auth0Subject; // Return original if extraction fails
  }
}

/**
 * Fallback user detection methods (from previous implementation)
 */
async function fallbackUserDetection(app) {
  console.log("🔄 Using fallback user detection methods...");

  // Try basic methods from the previous implementation
  try {
    // Check app layout
    if (app && typeof app.getAppLayout === "function") {
      const appLayout = await app.getAppLayout();

      const possibleUserFields = [
        appLayout?.owner,
        appLayout?.qMeta?.createdBy,
        appLayout?.qMeta?.modifiedBy,
        appLayout?.createdBy,
        appLayout?.modifiedBy,
        appLayout?.userId,
      ];

      for (const field of possibleUserFields) {
        if (field && typeof field === "string" && field.trim() !== "") {
          console.log("✅ Found user from fallback app layout:", field);
          return field;
        }
      }
    }

    // Check browser context
    if (typeof window !== "undefined") {
      const browserSources = [
        () => window.qlik?.currentUser?.name,
        () => window.qlik?.user?.name,
        () => window.currentUser,
        () => localStorage.getItem("currentUser"),
        () => sessionStorage.getItem("currentUser"),
      ];

      for (const getUser of browserSources) {
        try {
          const user = getUser();
          if (user && typeof user === "string" && user.trim() !== "") {
            console.log("✅ Found user from fallback browser context:", user);
            return user;
          }
        } catch (e) {
          // Silent fail
        }
      }
    }

    // Generate a reasonable fallback
    const timestamp = Date.now().toString().slice(-6);
    const fallbackUser = `qlik_user_${timestamp}`;
    console.log("🔄 Generated fallback user:", fallbackUser);
    return fallbackUser;
  } catch (error) {
    console.error("Fallback detection failed:", error);
    return "Unknown";
  }
}

/**
 * Save writeback data to Qlik Automation with Auth0-aware user detection
 */
export async function saveWritebackData(editedData, layout, app) {
  try {
    console.log("Starting save operation with data:", editedData);

    // Auth0-aware user detection for QlikCloud
    const currentUser = await getCurrentQlikUser(app);
    console.log("🎯 Final detected user:", currentUser);

    return saveWithUser(editedData, layout, app, currentUser);
  } catch (error) {
    console.error("Save operation failed:", error);
    throw new Error(`Failed to save: ${error.message}`);
  }
}

/**
 * Continue with save operation using detected user
 */
async function saveWithUser(editedData, layout, app, currentUser) {
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

  const fileName = `writeback_${appId}_${timestamp.replace(/[:.]/g, "-")}.csv`;

  // Convert editedData to proper CSV format with detected user
  const csvContent = generateProperCSV(
    editedData,
    layout,
    timestamp,
    currentUser
  );

  console.log("Generated CSV content with user:", currentUser);

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
}

// [Rest of the functions: generateProperCSV, getBaseColumns, getBaseRows, etc. - keep from previous version]

/**
 * Generate properly structured CSV with base data + writeback changes
 * Creates audit trail with detected user information
 */
function generateProperCSV(
  editedData,
  layout,
  timestamp,
  currentUser = "Unknown"
) {
  console.log("Generating CSV for editedData:", editedData);
  console.log("Using detected user:", currentUser);

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

      // Create audit trail row with version tracking and detected user
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

      // Add audit columns with detected user information
      csvRow.push(`"${timestamp}"`); // WRITEBACK_TIMESTAMP
      csvRow.push(`"${currentUser}"`); // WRITEBACK_USER (detected user!)
      csvRow.push(`"${version}"`); // VERSION (incremental)
      csvRow.push(`"UPDATE"`); // CHANGE_TYPE
      csvRow.push(`"${generateAuditId()}"`); // AUDIT_ID

      csvRows.push(csvRow.join(","));
    } else {
      console.log(`No matching row found for rowId: ${rowId}`);

      // Create fallback row with detected user information
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

      // Audit columns with detected user
      csvRow.push(`"${timestamp}"`);
      csvRow.push(`"${currentUser}"`); // Detected user here too
      csvRow.push(`"${version}"`);
      csvRow.push(`"INSERT"`);
      csvRow.push(`"${generateAuditId()}"`);

      csvRows.push(csvRow.join(","));
    }
  });

  const finalCSV = csvRows.join("\n");
  console.log("Final CSV with detected user:", finalCSV);

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
  formData.append("currentUser", currentUser); // Send detected user info to automation

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
