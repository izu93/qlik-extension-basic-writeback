// utils/userPresenceService.js - Real User Presence Management (FIXED)

/**
 * User Presence Service - Real-time user tracking for Qlik Cloud
 * Handles user sessions, activity tracking, and conflict detection
 */

class UserPresenceService {
  constructor(app, layout) {
    this.app = app;
    this.layout = layout;
    this.sessionId = this.getOrCreateSessionId();
    this.currentUser = null;
    this.users = new Map();
    this.conflicts = new Map();
    this.listeners = new Set();
    this.isConnected = false;
    this.updateInterval = null;
    this.heartbeatInterval = null;
    this.lastKeystroke = 0;

    // Configuration - UPDATED for 1 minute intervals
    this.config = {
      updateFrequency: 60000, // 1 minute (was 3 seconds)
      heartbeatFrequency: 30000, // 30 seconds (keep heartbeat more frequent)
      userTimeout: 180000, // 3 minutes (increased timeout since updates are less frequent)
      conflictCheckInterval: 60000, // 1 minute
    };

    console.log("UserPresenceService initialized", {
      sessionId: this.sessionId,
    });
  }

  /**
   * Initialize the service and start tracking
   */
  async initialize() {
    try {
      console.log("Initializing user presence service...");

      // Get current user info
      this.currentUser = await this.getCurrentUser();
      console.log("👤 Current user detected:", this.currentUser);

      // Register this session
      await this.registerSession();

      // Start monitoring
      this.startMonitoring();

      this.isConnected = true;
      this.notifyListeners("connected", { user: this.currentUser });

      console.log("User presence service connected");
      return true;
    } catch (error) {
      console.error("Failed to initialize user presence:", error);
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Get current Qlik user with enhanced detection
   */
  async getCurrentUser() {
    try {
      // Use the existing getCurrentQlikUser logic from saveService
      let userId = null;
      let userName = null;

      if (
        this.app &&
        this.app.global &&
        typeof this.app.global.getAuthenticatedUser === "function"
      ) {
        const userInfo = await this.app.global.getAuthenticatedUser();

        if (typeof userInfo === "string") {
          const userIdMatch = userInfo.match(/UserId=([^;]+)/);
          if (userIdMatch && userIdMatch[1]) {
            userId = userIdMatch[1].trim();
          }
        }
      }

      // Try to get display name from API
      if (userId) {
        userName = await this.getUserDisplayName(userId);
      }

      // Fallback to session-based user
      if (!userName) {
        userName = this.getSessionUser();
      }

      const initials = this.generateInitials(userName);
      const now = new Date();

      return {
        id: this.sessionId,
        userId: userId || "unknown",
        name: userName,
        initials: initials,
        sessionId: this.sessionId,
        isCurrentUser: true,
        status: "viewing",
        editingRow: null,
        editingFields: [],
        startTime: now,
        lastActivity: now,
        appId: this.getAppId(),
      };
    } catch (error) {
      console.error("Error getting current user:", error);

      // Emergency fallback
      const fallbackName = `User_${this.sessionId.slice(-6)}`;
      const now = new Date();

      return {
        id: this.sessionId,
        userId: "fallback",
        name: fallbackName,
        initials: fallbackName.substring(0, 2).toUpperCase(),
        sessionId: this.sessionId,
        isCurrentUser: true,
        status: "viewing",
        editingRow: null,
        editingFields: [],
        startTime: now,
        lastActivity: now,
        appId: this.getAppId(),
      };
    }
  }

  /**
   * Get user display name from Qlik Cloud API
   */
  async getUserDisplayName(userId) {
    try {
      const hostname = window.location.hostname;
      if (!hostname.includes("qlikcloud")) return null;

      const apiUrl = `https://${hostname}/api/v1/users?filter=subject eq "${encodeURIComponent(
        userId
      )}"`;

      const response = await fetch(apiUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        if (data.data && data.data.length > 0 && data.data[0].name) {
          return data.data[0].name;
        }
      }

      return null;
    } catch (error) {
      console.log("Could not fetch display name from API:", error);
      return null;
    }
  }

  /**
   * Generate user initials from name
   */
  generateInitials(name) {
    if (!name) return "U";

    const parts = name.trim().split(" ");
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    } else {
      return name.substring(0, 2).toUpperCase();
    }
  }

  /**
   * Get or create session-based user
   */
  getSessionUser() {
    let sessionUser = sessionStorage.getItem("qlik_writeback_user");
    if (!sessionUser) {
      const timestamp = Date.now().toString();
      const random = Math.random().toString(36).substr(2, 5);
      sessionUser = `User_${timestamp.slice(-6)}_${random}`;
      sessionStorage.setItem("qlik_writeback_user", sessionUser);
    }
    return sessionUser;
  }

  /**
   * Register this user session
   */
  async registerSession() {
    const sessionData = {
      sessionId: this.sessionId,
      user: this.currentUser,
      appId: this.getAppId(),
      timestamp: new Date().toISOString(),
      action: "join",
    };

    // Store in sessionStorage for cross-tab detection
    const allSessions = this.getAllSessions();
    allSessions[this.sessionId] = sessionData;
    localStorage.setItem("qlik_active_sessions", JSON.stringify(allSessions));

    console.log("Session registered:", sessionData);
  }

  /**
   * Start monitoring user activity
   */
  startMonitoring() {
    // User activity updates
    this.updateInterval = setInterval(() => {
      this.updateUserActivity();
    }, this.config.updateFrequency);

    // Heartbeat to maintain session
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, this.config.heartbeatFrequency);

    // Listen for beforeunload to cleanup
    window.addEventListener("beforeunload", () => {
      this.cleanup();
    });

    // Listen for storage changes (other tabs)
    window.addEventListener("storage", (e) => {
      if (e.key === "qlik_active_sessions") {
        this.handleSessionChanges();
      }
    });

    // FIXED: Add keyboard listener for typing detection
    document.addEventListener("keydown", () => {
      this.lastKeystroke = Date.now();
    });

    console.log("User monitoring started");
  }

  /**
   * Update user activity and fetch other users
   */
  async updateUserActivity() {
    try {
      // Update current user activity
      if (this.currentUser) {
        this.currentUser.lastActivity = new Date();

        // Detect if user is editing
        const editingInfo = this.detectEditingActivity();
        this.currentUser.status = editingInfo.status;
        this.currentUser.editingRow = editingInfo.editingRow;
        this.currentUser.editingFields = editingInfo.editingFields;

        console.log(
          "Current user status:",
          this.currentUser.status,
          "editing:",
          this.currentUser.editingRow
        );
      }

      // Get all active sessions
      const allUsers = this.getAllActiveUsers();

      // Check for conflicts
      this.detectConflicts(allUsers);

      // Notify listeners
      this.notifyListeners("usersUpdated", {
        users: allUsers,
        conflicts: Array.from(this.conflicts.values()),
      });
    } catch (error) {
      console.error("Error updating user activity:", error);
    }
  }

  /**
   * Detect if current user is editing
   */
  detectEditingActivity() {
    // Check if any input fields are focused
    const activeElement = document.activeElement;
    const isEditing =
      activeElement &&
      (activeElement.tagName === "INPUT" ||
        activeElement.tagName === "TEXTAREA" ||
        activeElement.tagName === "SELECT");

    let editingRow = null;
    let editingFields = [];
    let status = "viewing";

    if (isEditing) {
      // Try to determine which row/field is being edited
      const cell = activeElement.closest("td");
      if (cell) {
        const row = cell.closest("tr");
        if (row) {
          // Get account ID from first cell
          const firstCell = row.querySelector("td:first-child");
          if (firstCell) {
            editingRow = firstCell.textContent.trim();
          }
        }

        // Determine field being edited
        const columnHeaders = document.querySelectorAll("th");
        const cellIndex = Array.from(cell.parentNode.children).indexOf(cell);
        if (columnHeaders[cellIndex]) {
          const fieldName = columnHeaders[cellIndex].textContent.trim();
          // Remove emojis and extra text from field name
          const cleanFieldName = fieldName.replace(/[✏️🔑*]/g, "").trim();
          editingFields = [cleanFieldName];
        }
      }

      // Determine if typing or just focused
      status = this.isUserTyping() ? "typing" : "editing";
    }

    return { status, editingRow, editingFields };
  }

  /**
   * Detect if user is actively typing
   */
  isUserTyping() {
    return Date.now() - this.lastKeystroke < 2000; // Typing if keystroke within 2 seconds
  }

  /**
   * Get all active users from sessions
   */
  getAllActiveUsers() {
    const allSessions = this.getAllSessions();
    const now = Date.now();
    const activeUsers = [];

    Object.values(allSessions).forEach((session) => {
      // FIXED: Ensure dates are properly parsed
      const lastActivity = session.user.lastActivity
        ? new Date(session.user.lastActivity)
        : new Date(session.timestamp);

      const startTime = session.user.startTime
        ? new Date(session.user.startTime)
        : new Date(session.timestamp);

      const timeSinceActivity = now - lastActivity.getTime();

      // Only include users active within timeout
      if (timeSinceActivity < this.config.userTimeout) {
        const user = {
          ...session.user,
          lastActivity: lastActivity,
          startTime: startTime,
          isCurrentUser: session.sessionId === this.sessionId,
        };

        // FIXED: For current user, use the live status from this.currentUser
        if (session.sessionId === this.sessionId && this.currentUser) {
          user.status = this.currentUser.status;
          user.editingRow = this.currentUser.editingRow;
          user.editingFields = this.currentUser.editingFields;
          user.lastActivity = this.currentUser.lastActivity;
        }

        activeUsers.push(user);
      }
    });

    return activeUsers;
  }

  /**
   * Detect conflicts between users
   */
  detectConflicts(users) {
    this.conflicts.clear();

    // Group users by what they're editing
    const editingMap = new Map();

    users.forEach((user) => {
      if (user.status === "editing" && user.editingRow) {
        if (!editingMap.has(user.editingRow)) {
          editingMap.set(user.editingRow, []);
        }
        editingMap.get(user.editingRow).push(user);
      }
    });

    // Find conflicts (multiple users editing same row)
    editingMap.forEach((usersEditingRow, rowId) => {
      if (usersEditingRow.length > 1) {
        this.conflicts.set(rowId, {
          rowId: rowId,
          users: usersEditingRow.map((u) => u.name),
          fields: [...new Set(usersEditingRow.flatMap((u) => u.editingFields))],
          severity: "warning",
        });
      }
    });
  }

  /**
   * Send heartbeat to maintain session
   */
  sendHeartbeat() {
    if (this.currentUser) {
      // FIXED: Update current user activity before heartbeat
      this.currentUser.lastActivity = new Date();

      const sessionData = {
        sessionId: this.sessionId,
        user: this.currentUser,
        appId: this.getAppId(),
        timestamp: new Date().toISOString(),
        action: "heartbeat",
      };

      const allSessions = this.getAllSessions();
      allSessions[this.sessionId] = sessionData;
      localStorage.setItem("qlik_active_sessions", JSON.stringify(allSessions));
    }
  }

  /**
   * Handle session changes from other tabs
   */
  handleSessionChanges() {
    // Trigger update when other users join/leave
    setTimeout(() => {
      this.updateUserActivity();
    }, 100);
  }

  /**
   * Get all sessions from localStorage
   */
  getAllSessions() {
    try {
      const stored = localStorage.getItem("qlik_active_sessions");
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      console.error("Error reading sessions:", error);
      return {};
    }
  }

  /**
   * Get or create session ID
   */
  getOrCreateSessionId() {
    let sessionId = sessionStorage.getItem("qlik_presence_session");
    if (!sessionId) {
      sessionId = `session_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      sessionStorage.setItem("qlik_presence_session", sessionId);
    }
    return sessionId;
  }

  /**
   * Get app ID
   */
  getAppId() {
    return this.layout?.qInfo?.qId || "unknown-app";
  }

  /**
   * Add event listener
   */
  addEventListener(event, callback) {
    this.listeners.add({ event, callback });
  }

  /**
   * Remove event listener
   */
  removeEventListener(callback) {
    this.listeners.forEach((listener) => {
      if (listener.callback === callback) {
        this.listeners.delete(listener);
      }
    });
  }

  /**
   * Notify all listeners
   */
  notifyListeners(event, data) {
    this.listeners.forEach((listener) => {
      if (listener.event === event) {
        try {
          listener.callback(data);
        } catch (error) {
          console.error("Error in presence listener:", error);
        }
      }
    });
  }

  /**
   * Update user editing status - FIXED to immediately update and persist
   */
  updateEditingStatus(rowId, fields) {
    if (this.currentUser) {
      this.currentUser.editingRow = rowId;
      this.currentUser.editingFields = fields || [];
      this.currentUser.status = rowId ? "editing" : "viewing";
      this.currentUser.lastActivity = new Date();

      /*console.log("Updated editing status:", {
        status: this.currentUser.status,
        editingRow: this.currentUser.editingRow,
        editingFields: this.currentUser.editingFields,
      });*/

      // Immediate update and persist
      this.sendHeartbeat();

      // FIXED: Trigger immediate user update with current user data
      const allUsers = this.getAllActiveUsers();
      this.notifyListeners("usersUpdated", {
        users: allUsers,
        conflicts: Array.from(this.conflicts.values()),
      });
    }
  }

  /**
   * Cleanup when user leaves
   */
  cleanup() {
    console.log("🧹 Cleaning up user presence...");

    // Clear intervals
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Remove this session
    const allSessions = this.getAllSessions();
    delete allSessions[this.sessionId];
    localStorage.setItem("qlik_active_sessions", JSON.stringify(allSessions));

    this.isConnected = false;
    this.notifyListeners("disconnected", {});
  }

  /**
   * Disconnect and cleanup
   */
  disconnect() {
    this.cleanup();
  }

  /**
   * Get connection status
   */
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      currentUser: this.currentUser,
      sessionId: this.sessionId,
    };
  }
}

export default UserPresenceService;
