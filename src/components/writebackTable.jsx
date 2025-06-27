import React, { useState, useEffect, useCallback } from "react";
import { getColumns, getRows } from "../utils/hypercubeUtils";
import { getPagedRows } from "../utils/paginationUtils";
import { sortRows } from "../utils/sortUtils";
import {
  handleCellClick,
  applyBatchSelections,
  clearAllQlikSelections,
  toggleRowSelection,
  clearLocalSelections,
  selectAllOnPage,
  deselectAllOnPage,
  getPageSelectionCount,
  isPageFullySelected,
  getDimensionCount,
  isColumnSelectable,
  getSelectionSummary,
} from "../utils/selectionUtils";
import { saveWritebackData, testSaveConnection } from "../utils/saveService";
import { loadWritebackData, testReadConnection } from "../utils/readService";
import {
  getKeyDimensionsConfig,
  getActiveKeyDimensions,
  generateRowKey,
  createEnhancedRowId,
  validateKeyUniqueness,
  isKeyDimension,
  getKeyDimensionsSummary,
} from "../utils/keyDimensionsUtils";
import {
  getAllColumns,
  getBaseColumns,
  getEnhancedRows,
  isWritebackColumnIndex,
  getWritebackColumnName,
  hasWritebackColumns,
  getWritebackColumnConfig,
  shouldShowModeButtons,
  getBaseColumnCount,
  mapToBaseColumnIndex,
  isColumnSelectable as isDynamicColumnSelectable,
  getBaseDimensionCount,
  isBaseDimension,
} from "../utils/dynamicColumnsUtils";

// REAL USER PRESENCE INTEGRATION
import UserPresenceService from "../utils/userPresenceService";

/**
 * WritebackTable: Dynamic Columns + Key Dimensions + Real Active Users Support
 */
export default function WritebackTable({
  layout,
  app,
  model,
  selections,
  pageSize = 100,
}) {
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState(null);
  const [sortDir, setSortDir] = useState(true);
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [selectionMode, setSelectionMode] = useState(false);

  // Selection states
  const [selectedCells, setSelectedCells] = useState(new Set());
  const [qlikSelections, setQlikSelections] = useState(new Set());
  const [isApplyingSelection, setIsApplyingSelection] = useState(false);

  // Writeback states
  const [editedData, setEditedData] = useState({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [isLoadingWriteback, setIsLoadingWriteback] = useState(false);

  // Mode toggle state: always default to selection
  const [currentMode, setCurrentMode] = useState("selection");

  // Auto-save timer
  const [autoSaveTimer, setAutoSaveTimer] = useState(null);

  // REAL USER PRESENCE - Replace mock data with real service
  const [activeUsers, setActiveUsers] = useState([]);
  const [showUserPanel, setShowUserPanel] = useState(false);
  const [conflicts, setConflicts] = useState([]);
  const [isWebSocketConnected, setIsWebSocketConnected] = useState(false);
  const [presenceService, setPresenceService] = useState(null);

  // Use dynamic columns system
  const columns = getAllColumns(layout);
  const baseColumns = getBaseColumns(layout);
  const rows = getEnhancedRows(layout);

  // Get key dimensions configuration (use base columns for key dimensions)
  const keyDimensionsConfig = getKeyDimensionsConfig(layout);
  const activeKeyDimensions = getActiveKeyDimensions(layout, baseColumns);
  const keyDimensionsSummary = getKeyDimensionsSummary(layout, baseColumns);

  // Validate key uniqueness if enabled (use base rows)
  const baseRows = getRows(layout);
  const keyValidation = validateKeyUniqueness(baseRows, layout, baseColumns);

  // Get dynamic writeback configuration from layout
  const writebackConfig = layout?.writebackConfig || {
    enabled: false,
    columns: [],
  };
  const hasActiveWriteback = shouldShowModeButtons(layout);
  const configuredColumns = writebackConfig.columns || [];

  // Create a map of writeback columns for quick lookup
  const writebackColumnMap = new Map();
  configuredColumns.forEach((config) => {
    writebackColumnMap.set(config.columnName, config);
  });

  // REAL USER PRESENCE INITIALIZATION - Replace mock data with real service
  useEffect(() => {
    async function initializePresenceService() {
      if (app && layout) {
        console.log('🔗 Initializing real user presence...');
        
        try {
          const service = new UserPresenceService(app, layout);
          
          // Add event listeners
          service.addEventListener('connected', (data) => {
            console.log('✅ User presence connected:', data.user);
            setIsWebSocketConnected(true);
          });
          
          service.addEventListener('disconnected', () => {
            console.log('❌ User presence disconnected');
            setIsWebSocketConnected(false);
            setActiveUsers([]);
            setConflicts([]);
          });
          
          service.addEventListener('usersUpdated', (data) => {
            console.log('👥 Users updated:', data.users.length, 'users');
            setActiveUsers(data.users);
            setConflicts(data.conflicts);
          });
          
          // Initialize the service
          const initialized = await service.initialize();
          if (initialized) {
            setPresenceService(service);
            console.log('🎉 Real user presence active!');
          } else {
            console.error('Failed to initialize presence service');
            // Fallback to offline mode
            setIsWebSocketConnected(false);
          }
          
        } catch (error) {
          console.error('Error initializing presence service:', error);
          setIsWebSocketConnected(false);
        }
      }
    }

    initializePresenceService();

    // Cleanup on unmount
    return () => {
      if (presenceService) {
        presenceService.disconnect();
      }
    };
  }, [app, layout?.qInfo?.qId]);

  // TRACK EDITING ACTIVITY - Add tracking for editing activity
  const updateEditingActivity = useCallback((rowId, fields) => {
    if (presenceService) {
      presenceService.updateEditingStatus(rowId, fields);
    }
  }, [presenceService]);

  // Helper Functions for Active Users (keeping existing UI components)
  const getUserStatusColor = (status) => {
    switch (status) {
      case "editing":
        return "#28a745";
      case "typing":
        return "#ffc107";
      case "viewing":
        return "#6c757d";
      case "idle":
        return "#dee2e6";
      default:
        return "#6c757d";
    }
  };

  const getUserStatusIcon = (status) => {
    switch (status) {
      case "editing":
        return "✏️";
      case "typing":
        return "⌨️";
      case "viewing":
        return "👀";
      case "idle":
        return "💤";
      default:
        return "👤";
    }
  };

  const getTimeSince = (date) => {
    // FIXED: Handle date parsing issues
    let targetDate;
    if (date instanceof Date) {
      targetDate = date;
    } else if (typeof date === 'string') {
      targetDate = new Date(date);
    } else {
      targetDate = new Date();
    }

    // Check if date is valid
    if (isNaN(targetDate.getTime())) {
      return "now";
    }

    const seconds = Math.floor((new Date() - targetDate) / 1000);
    if (seconds < 0) return "now";
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  // User Bubble Component
  const UserBubble = ({ user, onClick }) => {
    return (
      <div
        style={{
          position: "relative",
          width: "32px",
          height: "32px",
          borderRadius: "50%",
          backgroundColor: getUserStatusColor(user.status),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontWeight: "bold",
          fontSize: "11px",
          cursor: "pointer",
          animation:
            user.status === "editing"
              ? "pulse 2s infinite"
              : user.status === "typing"
              ? "typing 1s infinite"
              : "none",
          border: user.isCurrentUser ? "2px solid #007acc" : "none",
          boxSizing: "border-box",
          transition: "transform 0.2s ease-in-out",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "scale(1.1)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)";
        }}
        onClick={() => onClick && onClick(user)}
        title={`${user.name} - ${user.status.charAt(0).toUpperCase() + user.status.slice(1)}${
          user.editingRow ? ` (editing ${user.editingRow})` : ""
        }${user.editingFields.length > 0 ? ` - ${user.editingFields.join(", ")}` : ""}`}
      >
        {user.initials}
      </div>
    );
  };

  // Conflict Alert Component
  const ConflictAlert = ({ conflicts }) => {
    if (conflicts.length === 0) return null;

    return (
      <div
        style={{
          background: "#fff3cd",
          color: "#856404",
          border: "1px solid #ffeaa7",
          borderRadius: "4px",
          padding: "8px 12px",
          margin: "8px 0",
          fontSize: "12px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          animation: "slideDown 0.3s ease-in-out",
        }}
      >
        <span>⚠️</span>
        <div style={{ flex: 1 }}>
          <strong>Conflict Detected:</strong> {conflicts[0].users.join(" and ")}{" "}
          are editing the same record ({conflicts[0].rowId}).
        </div>
        <button
          style={{
            padding: "4px 8px",
            background: "#007acc",
            color: "white",
            border: "none",
            borderRadius: "3px",
            fontSize: "11px",
            cursor: "pointer",
          }}
          onClick={() => setShowUserPanel(true)}
        >
          View Details
        </button>
      </div>
    );
  };

  // User Collaboration Side Panel Component
  const UserCollaborationPanel = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    const activeUsersCount = activeUsers.filter(
      (u) => u.status !== "idle"
    ).length;
    const editingUsersCount = activeUsers.filter(
      (u) => u.status === "editing"
    ).length;

    return (
      <>
        {/* Overlay */}
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.3)",
            zIndex: 999,
            animation: "fadeIn 0.2s ease-in-out",
          }}
          onClick={onClose}
        />

        {/* Side Panel */}
        <div
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            height: "100vh",
            width: "350px",
            background: "white",
            borderLeft: "1px solid #dee2e6",
            boxShadow: "-4px 0 12px rgba(0,0,0,0.15)",
            zIndex: 1000,
            animation: "slideInRight 0.3s ease-in-out",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Panel Header */}
          <div
            style={{
              padding: "20px",
              borderBottom: "1px solid #dee2e6",
              background: "#f8f9fa",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h3
                style={{
                  margin: 0,
                  color: "#2c5aa0",
                  fontSize: "16px",
                  fontWeight: "bold",
                }}
              >
                👥 Live Collaboration
              </h3>
              <button
                onClick={onClose}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "18px",
                  cursor: "pointer",
                  color: "#6c757d",
                  padding: "4px",
                }}
              >
                ×
              </button>
            </div>

            {/* Summary Stats */}
            <div
              style={{
                marginTop: "12px",
                display: "flex",
                gap: "12px",
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  background: isWebSocketConnected ? "#e8f5e8" : "#f8f9fa",
                  color: isWebSocketConnected ? "#2e7d32" : "#6c757d",
                  padding: "6px 12px",
                  borderRadius: "12px",
                  fontSize: "11px",
                  fontWeight: "500",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <div
                  style={{
                    width: "6px",
                    height: "6px",
                    background: isWebSocketConnected ? "#4caf50" : "#6c757d",
                    borderRadius: "50%",
                    animation: isWebSocketConnected
                      ? "blink 1s infinite"
                      : "none",
                  }}
                />
                {isWebSocketConnected ? "Live Connected" : "Offline"}
              </div>

              <div
                style={{
                  background: "#e3f2fd",
                  color: "#1976d2",
                  padding: "6px 12px",
                  borderRadius: "12px",
                  fontSize: "11px",
                  fontWeight: "500",
                }}
              >
                {activeUsersCount} Active Users
              </div>

              {editingUsersCount > 0 && (
                <div
                  style={{
                    background: "#fff3cd",
                    color: "#856404",
                    padding: "6px 12px",
                    borderRadius: "12px",
                    fontSize: "11px",
                    fontWeight: "500",
                  }}
                >
                  {editingUsersCount} Editing
                </div>
              )}
            </div>
          </div>

          {/* Conflicts Section */}
          {conflicts.length > 0 && (
            <div style={{ padding: "16px", borderBottom: "1px solid #fee" }}>
              <h4
                style={{
                  margin: "0 0 12px 0",
                  color: "#dc3545",
                  fontSize: "14px",
                  fontWeight: "bold",
                }}
              >
                ⚠️ Active Conflicts ({conflicts.length})
              </h4>
              {conflicts.map((conflict, index) => (
                <div
                  key={index}
                  style={{
                    background: "#fff3cd",
                    border: "1px solid #ffeaa7",
                    borderRadius: "4px",
                    padding: "12px",
                    marginBottom: "8px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "12px",
                      color: "#856404",
                      fontWeight: "bold",
                    }}
                  >
                    Account: {conflict.rowId}
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "#856404",
                      marginTop: "4px",
                    }}
                  >
                    Users: {conflict.users.join(", ")}
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "#856404",
                      marginTop: "4px",
                    }}
                  >
                    Fields: {conflict.fields.join(", ")}
                  </div>
                  <button
                    style={{
                      marginTop: "8px",
                      padding: "4px 8px",
                      background: "#007acc",
                      color: "white",
                      border: "none",
                      borderRadius: "3px",
                      fontSize: "10px",
                      cursor: "pointer",
                    }}
                  >
                    Resolve Conflict
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Users List */}
          <div style={{ flex: 1, overflow: "auto", padding: "16px" }}>
            <h4
              style={{
                margin: "0 0 16px 0",
                color: "#495057",
                fontSize: "14px",
                fontWeight: "bold",
              }}
            >
              Active Users ({activeUsers.length})
            </h4>

            {activeUsers.map((user) => {
              return (
                <div
                  key={user.id}
                  style={{
                    background: user.isCurrentUser ? "#e8f4fd" : "#f8f9fa",
                    border: user.isCurrentUser
                      ? "1px solid #007acc"
                      : "1px solid #dee2e6",
                    borderRadius: "6px",
                    padding: "16px",
                    marginBottom: "12px",
                    position: "relative",
                  }}
                >
                {/* User Header */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    marginBottom: "8px",
                  }}
                >
                  <div
                    style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "50%",
                      backgroundColor: getUserStatusColor(user.status),
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "white",
                      fontWeight: "bold",
                      fontSize: "14px",
                      animation:
                        user.status === "editing"
                          ? "pulse 2s infinite"
                          : user.status === "typing"
                          ? "typing 1s infinite"
                          : "none",
                    }}
                  >
                    {user.initials}
                  </div>

                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: "14px",
                        fontWeight: "bold",
                        color: "#495057",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      {user.name}
                      {user.isCurrentUser && (
                        <span
                          style={{
                            fontSize: "10px",
                            background: "#007acc",
                            color: "white",
                            padding: "2px 6px",
                            borderRadius: "8px",
                          }}
                        >
                          You
                        </span>
                      )}
                    </div>
                    {/* REMOVED: Status display - bubble color shows this already */}
                  </div>
                </div>

                {/* Activity Details */}
                {user.editingRow && (
                  <div
                    style={{
                      background: "rgba(255, 255, 255, 0.8)",
                      borderRadius: "4px",
                      padding: "8px",
                      marginBottom: "8px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "11px",
                        color: "#6c757d",
                        fontWeight: "bold",
                      }}
                    >
                      📝 Currently Working On:
                    </div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "#495057",
                        marginTop: "4px",
                      }}
                    >
                      <strong>Account:</strong> {user.editingRow}
                    </div>
                    {user.editingFields.length > 0 && (
                      <div
                        style={{
                          fontSize: "12px",
                          color: "#495057",
                          marginTop: "2px",
                        }}
                      >
                        <strong>Fields:</strong> {user.editingFields.join(", ")}
                      </div>
                    )}
                  </div>
                )}

                {/* Timing Info */}
                <div
                  style={{
                    fontSize: "10px",
                    color: "#6c757d",
                    display: "flex",
                    gap: "12px",
                  }}
                >
                  <span>🕐 Started: {getTimeSince(user.startTime)}</span>
                  <span>📍 Last active: {getTimeSince(user.lastActivity)}</span>
                </div>

                {/* Action Buttons */}
                {!user.isCurrentUser &&
                  user.status === "editing" &&
                  user.editingRow && (
                    <div
                      style={{ marginTop: "12px", display: "flex", gap: "6px" }}
                    >
                      <button
                        style={{
                          padding: "4px 8px",
                          background: "#ffc107",
                          color: "#000",
                          border: "none",
                          borderRadius: "3px",
                          fontSize: "10px",
                          cursor: "pointer",
                        }}
                      >
                        🚨 Request Access
                      </button>
                    </div>
                  )}
              </div>
            );
            })}
          </div>

          {/* Panel Footer */}
          <div
            style={{
              padding: "16px",
              borderTop: "1px solid #dee2e6",
              background: "#f8f9fa",
            }}
          >
            <button
              style={{
                width: "100%",
                padding: "10px",
                background: "#28a745",
                color: "white",
                border: "none",
                borderRadius: "4px",
                fontSize: "12px",
                fontWeight: "bold",
                cursor: "pointer",
                marginBottom: "8px",
              }}
              onClick={() => {
                if (presenceService) {
                  presenceService.updateUserActivity();
                }
              }}
            >
              🔄 Refresh All Data
            </button>

            <div
              style={{
                fontSize: "10px",
                color: "#6c757d",
                textAlign: "center",
              }}
            >
              Last updated: {new Date().toLocaleTimeString()}
            </div>
          </div>
        </div>
      </>
    );
  };

  // Active Users Header Component - Updated with real connection status
  const ActiveUsersHeader = () => {
    const activeCount = activeUsers.filter((u) => u.status !== "idle").length;
    const connectionStatus = presenceService?.getConnectionStatus();

    return (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 0",
          marginBottom: "8px",
          borderBottom: "1px solid #eee",
        }}
      >
        {/* Left side: Mode info and status */}
        <div
          style={{
            fontSize: "14px",
            color: "#495057",
            display: "flex",
            alignItems: "center",
            gap: "16px",
          }}
        >
          {/* Mode Toggle - only show if writeback is active */}
          {hasActiveWriteback && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  fontSize: "12px",
                  color: "#6c757d",
                  fontWeight: "500",
                }}
              >
                Mode:
              </span>
              <button
                onClick={() => handleModeChange("edit")}
                style={{
                  padding: "4px 8px",
                  backgroundColor:
                    currentMode === "edit" ? "#007acc" : "#e9ecef",
                  color: currentMode === "edit" ? "white" : "#6c757d",
                  border: "none",
                  borderRadius: "3px",
                  cursor: "pointer",
                  fontSize: "11px",
                  fontWeight: "500",
                }}
              >
                ✏️ Edit
              </button>
              <button
                onClick={() => handleModeChange("selection")}
                style={{
                  padding: "4px 8px",
                  backgroundColor:
                    currentMode === "selection" ? "#007acc" : "#e9ecef",
                  color: currentMode === "selection" ? "white" : "#6c757d",
                  border: "none",
                  borderRadius: "3px",
                  cursor: "pointer",
                  fontSize: "11px",
                  fontWeight: "500",
                }}
              >
                Select
              </button>
            </div>
          )}

          {/* Status information based on current mode */}
          {currentMode === "edit" && hasActiveWriteback ? (
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <span
                style={{
                  padding: "2px 8px",
                  backgroundColor: "#e3f2fd",
                  color: "#1976d2",
                  borderRadius: "12px",
                  fontSize: "11px",
                  fontWeight: "500",
                }}
              >
                📝 {configuredColumns.length} Writeback Column
                {configuredColumns.length !== 1 ? "s" : ""}
              </span>

              {keyDimensionsSummary.hasKeyDimensions && (
                <span
                  style={{
                    padding: "2px 8px",
                    backgroundColor: "#e8f5e8",
                    color: "#2e7d32",
                    borderRadius: "12px",
                    fontSize: "11px",
                    fontWeight: "500",
                  }}
                >
                  🔑 {keyDimensionsSummary.keyDimensionNames.join("+")}
                </span>
              )}

              <span>
                {isLoadingWriteback ? (
                  <span style={{ color: "#007acc" }}>
                    Loading existing data...
                  </span>
                ) : hasUnsavedChanges ? (
                  <span style={{ color: "#dc3545", fontWeight: "500" }}>
                    <strong>{Object.keys(editedData).length}</strong> unsaved
                    change{Object.keys(editedData).length !== 1 ? "s" : ""}
                  </span>
                ) : saveStatus?.success ? (
                  <span style={{ color: "#28a745" }}>
                    ✅ Saved to {saveStatus.fileName}
                  </span>
                ) : (
                  <span style={{ color: "#28a745" }}>✅ All changes saved</span>
                )}
              </span>
            </div>
          ) : currentMode === "selection" ? (
            <div>
              {selectedCells.size > 0 ? (
                <span>
                  <strong>{selectedCells.size}</strong> dimension values
                  selected for batch operation
                </span>
              ) : (
                <span>
                  Click dimension cells to select • Use checkboxes for batch
                  operations
                </span>
              )}
            </div>
          ) : (
            <span style={{ color: "#6c757d" }}>
              <strong>Writeback:</strong>{" "}
              {!writebackConfig.enabled
                ? "Disabled"
                : configuredColumns.length === 0
                ? "No columns configured"
                : `${configuredColumns.length} column${
                    configuredColumns.length !== 1 ? "s" : ""
                  } ready`}
            </span>
          )}
        </div>

        {/* Right side: Active Users + Controls */}
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          {/* Active Users Section */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "12px", color: "#6c757d" }}>
              👥 Active:
            </span>

            {/* User Bubbles */}
            <div style={{ display: "flex", gap: "6px" }}>
              {activeUsers.slice(0, 4).map((user) => (
                <UserBubble
                  key={user.id}
                  user={user}
                  onClick={() => setShowUserPanel(true)}
                />
              ))}
              {activeUsers.length > 4 && (
                <div
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "50%",
                    backgroundColor: "#dee2e6",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#6c757d",
                    fontSize: "10px",
                    fontWeight: "bold",
                    cursor: "pointer",
                  }}
                  onClick={() => setShowUserPanel(true)}
                >
                  +{activeUsers.length - 4}
                </div>
              )}
            </div>

            {/* Live Status - REAL connection status */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: isWebSocketConnected ? "#e8f5e8" : "#f8f9fa",
                color: isWebSocketConnected ? "#2e7d32" : "#6c757d",
                padding: "4px 8px",
                borderRadius: "12px",
                fontSize: "11px",
                fontWeight: "500",
              }}
            >
              <div
                style={{
                  width: "6px",
                  height: "6px",
                  background: isWebSocketConnected ? "#4caf50" : "#6c757d",
                  borderRadius: "50%",
                  animation: isWebSocketConnected ? "blink 1s infinite" : "none",
                }}
              />
              {isWebSocketConnected ? "Live" : "Offline"} ({activeCount} user{activeCount !== 1 ? 's' : ''})
            </div>

            {/* User Panel Toggle Button */}
            <button
              onClick={() => setShowUserPanel(!showUserPanel)}
              style={{
                padding: "6px 8px",
                backgroundColor: showUserPanel ? "#007acc" : "#e9ecef",
                color: showUserPanel ? "white" : "#6c757d",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "11px",
                fontWeight: "500",
              }}
              title="Toggle user collaboration panel"
            >
              👥 Users
            </button>
          </div>

          {/* Existing Mode-specific Controls */}
          {currentMode === "edit" &&
            hasActiveWriteback &&
            writebackConfig.saveMode === "manual" && (
              <>
                <button
                  onClick={saveAllChanges}
                  disabled={
                    !hasUnsavedChanges || isSaving || isLoadingWriteback
                  }
                  style={{
                    padding: "6px 12px",
                    backgroundColor:
                      !hasUnsavedChanges || isSaving || isLoadingWriteback
                        ? "#6c757d"
                        : "#28a745",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor:
                      !hasUnsavedChanges || isSaving || isLoadingWriteback
                        ? "not-allowed"
                        : "pointer",
                    fontSize: "12px",
                    fontWeight: "500",
                  }}
                >
                  {isSaving
                    ? "Saving..."
                    : hasUnsavedChanges
                    ? `Save Changes (${Object.keys(editedData).length})`
                    : "No Changes"}
                </button>

                <button
                  onClick={clearAllChanges}
                  disabled={
                    !hasUnsavedChanges || isSaving || isLoadingWriteback
                  }
                  style={{
                    padding: "6px 12px",
                    backgroundColor: "#dc3545",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor:
                      !hasUnsavedChanges || isSaving || isLoadingWriteback
                        ? "not-allowed"
                        : "pointer",
                    fontSize: "12px",
                  }}
                >
                  Clear Changes
                </button>
              </>
            )}

          {currentMode === "selection" && (
            <>
              {selectedCells.size > 0 && (
                <>
                  <button
                    onClick={onApplyCellSelections}
                    disabled={isApplyingSelection}
                    style={{
                      padding: "6px 12px",
                      backgroundColor: isApplyingSelection
                        ? "#6c757d"
                        : "#28a745",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: isApplyingSelection ? "not-allowed" : "pointer",
                      fontSize: "12px",
                      fontWeight: "500",
                    }}
                  >
                    {isApplyingSelection
                      ? "Applying..."
                      : `Apply Cell Selections (${selectedCells.size})`}
                  </button>
                  <button
                    onClick={() => setSelectedCells(new Set())}
                    disabled={isApplyingSelection}
                    style={{
                      padding: "6px 12px",
                      backgroundColor: "#6c757d",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: isApplyingSelection ? "not-allowed" : "pointer",
                      fontSize: "12px",
                    }}
                  >
                    Clear Cell Selections
                  </button>
                </>
              )}

              <button
                onClick={() => setSelectionMode(!selectionMode)}
                disabled={isApplyingSelection}
                style={{
                  padding: "6px 12px",
                  backgroundColor: selectionMode ? "#ffc107" : "#007acc",
                  color: selectionMode ? "#000" : "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: isApplyingSelection ? "not-allowed" : "pointer",
                  fontSize: "12px",
                }}
              >
                {selectionMode ? "Exit Multi Select" : "Multi Select"}
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  // Auto-save functionality
  const scheduleAutoSave = useCallback(() => {
    if (writebackConfig.saveMode === "auto" && hasUnsavedChanges) {
      if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
      }

      const delay = (writebackConfig.autoSaveDelay || 2) * 1000;
      const timer = setTimeout(() => {
        saveAllChanges();
      }, delay);

      setAutoSaveTimer(timer);
    }
  }, [
    writebackConfig.saveMode,
    writebackConfig.autoSaveDelay,
    hasUnsavedChanges,
    autoSaveTimer,
  ]);

  // Inject CSS styles
  useEffect(() => {
    const styles = `
      @keyframes pulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.1); }
        100% { transform: scale(1); }
      }
      
      @keyframes typing {
        0%, 50% { opacity: 1; }
        25%, 75% { opacity: 0.7; }
      }
      
      @keyframes blink {
        0%, 50% { opacity: 1; }
        51%, 100% { opacity: 0.3; }
      }
      
      @keyframes slideDown {
        0% { opacity: 0; transform: translateY(-10px); }
        100% { opacity: 1; transform: translateY(0); }
      }
      
      @keyframes fadeIn {
        0% { opacity: 0; }
        100% { opacity: 1; }
      }
      
      @keyframes slideInRight {
        0% { transform: translateX(100%); }
        100% { transform: translateX(0); }
      }
    `;

    const styleSheet = document.createElement("style");
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);

    return () => {
      document.head.removeChild(styleSheet);
    };
  }, []);

  // Batch save functionality
  useEffect(() => {
    if (writebackConfig.saveMode === "batch" && hasUnsavedChanges) {
      const interval = (writebackConfig.batchSaveInterval || 5) * 60 * 1000;
      const timer = setInterval(() => {
        if (hasUnsavedChanges) {
          saveAllChanges();
        }
      }, interval);

      return () => clearInterval(timer);
    }
  }, [
    writebackConfig.saveMode,
    writebackConfig.batchSaveInterval,
    hasUnsavedChanges,
  ]);

  // Load existing writeback data on mount and when layout changes
  useEffect(() => {
    async function loadExistingWritebackData() {
      if (hasActiveWriteback && layout) {
        setIsLoadingWriteback(true);

        try {
          const existingData = await loadWritebackData(layout, app);
          if (existingData && Object.keys(existingData).length > 0) {
            setEditedData(existingData);
            console.log(
              `Loaded ${
                Object.keys(existingData).length
              } writeback values from automation`
            );
          }
        } catch (error) {
          console.error("Failed to load existing writeback data:", error);
        } finally {
          setIsLoadingWriteback(false);
        }
      }
    }

    loadExistingWritebackData();
  }, [layout?.qInfo?.qId, hasActiveWriteback]);

  // ADD: Focus/blur tracking for better editing detection
  useEffect(() => {
    const handleFocus = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        // Try to determine which row is being edited
        const cell = e.target.closest('td');
        if (cell) {
          const row = cell.closest('tr');
          if (row) {
            const firstCell = row.querySelector('td:first-child');
            if (firstCell) {
              const accountId = firstCell.textContent.trim();
              
              // Get column name
              const cellIndex = Array.from(cell.parentNode.children).indexOf(cell);
              const headers = document.querySelectorAll('th');
              const fieldName = headers[cellIndex]?.textContent.trim();
              
              if (accountId && fieldName) {
                updateEditingActivity(accountId, [fieldName]);
              }
            }
          }
        }
      }
    };

    const handleBlur = () => {
      // Small delay before clearing editing status
      setTimeout(() => {
        const activeElement = document.activeElement;
        const stillEditing = activeElement && (
          activeElement.tagName === 'INPUT' || 
          activeElement.tagName === 'TEXTAREA' || 
          activeElement.tagName === 'SELECT'
        );
        
        if (!stillEditing && presenceService) {
          presenceService.updateEditingStatus(null, []);
        }
      }, 100);
    };

    document.addEventListener('focusin', handleFocus);
    document.addEventListener('focusout', handleBlur);

    return () => {
      document.removeEventListener('focusin', handleFocus);
      document.removeEventListener('focusout', handleBlur);
    };
  }, [presenceService, updateEditingActivity]);

  // Cleanup auto-save timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
      }
    };
  }, [autoSaveTimer]);

  if (!columns.length) {
    return (
      <div style={{ padding: 24, color: "#666" }}>
        No data yet.
        <br />
        Add dimensions and measures to your table.
        <br />
        {!writebackConfig.enabled ? (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              backgroundColor: "#f8f9fa",
              borderRadius: 4,
              fontSize: 13,
            }}
          >
            <strong>Writeback:</strong> Disabled
            <br />
            <em>
              Enable writeback in the property panel to add editable columns.
            </em>
          </div>
        ) : configuredColumns.length === 0 ? (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              backgroundColor: "#fff3cd",
              color: "#856404",
              borderRadius: 4,
              fontSize: 13,
            }}
          >
            <strong>Writeback Enabled:</strong> No columns configured
            <br />
            <em>
              Add writeback columns in the property panel - they will appear
              automatically!
            </em>
          </div>
        ) : (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              backgroundColor: "#d1ecf1",
              color: "#0c5460",
              borderRadius: 4,
              fontSize: 13,
            }}
          >
            <strong>Writeback Ready:</strong> {configuredColumns.length} column
            {configuredColumns.length !== 1 ? "s" : ""} configured
            <br />
            <strong>Columns:</strong>{" "}
            {configuredColumns.map((col) => col.columnName).join(", ")}
            <br />
            <em>
              Writeback columns will appear automatically when you add data!
            </em>
          </div>
        )}
        {/* Key Dimensions Information */}
        {keyDimensionsSummary.hasKeyDimensions && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              backgroundColor: "#e3f2fd",
              color: "#1976d2",
              borderRadius: 4,
              fontSize: 13,
            }}
          >
            <strong>🔑 Key Dimensions:</strong> {keyDimensionsSummary.message}
            <br />
            {!keyValidation.isValid && (
              <div style={{ color: "#d32f2f", marginTop: 4 }}>
                <strong>⚠️ Warning:</strong> {keyValidation.duplicates.length}{" "}
                duplicate key{keyValidation.duplicates.length !== 1 ? "s" : ""}{" "}
                found!
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Writeback functionality with enhanced row ID using key dimensions
  const getRowId = (row, index) => {
    return createEnhancedRowId(row, index, layout, baseColumns);
  };

  // MODIFIED: updateEditedData to track editing activity
  const updateEditedData = (rowId, field, value) => {
    const key = `${rowId}-${field}`;
    console.log("Generated key:", key);
    
    setEditedData((prev) => {
      const newData = {
        ...prev,
        [key]: value,
      };
      return newData;
    });

    setHasUnsavedChanges(true);
    scheduleAutoSave();
    
    // NEW: Track editing activity
    const accountId = rowId.split('|')[0]; // Extract account ID from row ID
    updateEditingActivity(accountId, [field]);
  };

  const getEditedValue = (rowId, field) => {
    const key = `${rowId}-${field}`;
    const config = writebackColumnMap.get(field);
    return editedData[key] || config?.defaultValue || "";
  };

  const validateField = (value, config) => {
    if (!config.validation) return { isValid: true };

    const validation = config.validation;

    if (config.required && (!value || value.trim() === "")) {
      return { isValid: false, message: "This field is required" };
    }

    switch (config.columnType) {
      case "text":
      case "textarea":
        if (validation.minLength && value.length < validation.minLength) {
          return {
            isValid: false,
            message: `Minimum length is ${validation.minLength}`,
          };
        }
        if (validation.maxLength && value.length > validation.maxLength) {
          return {
            isValid: false,
            message: `Maximum length is ${validation.maxLength}`,
          };
        }
        break;

      case "number":
        const numValue = parseFloat(value);
        if (isNaN(numValue)) {
          return { isValid: false, message: "Please enter a valid number" };
        }
        if (validation.min !== undefined && numValue < validation.min) {
          return {
            isValid: false,
            message: `Minimum value is ${validation.min}`,
          };
        }
        if (validation.max !== undefined && numValue > validation.max) {
          return {
            isValid: false,
            message: `Maximum value is ${validation.max}`,
          };
        }
        break;
    }

    return { isValid: true };
  };

  // MODIFIED: saveAllChanges to update presence after save
  const saveAllChanges = async () => {
    if (!hasUnsavedChanges || Object.keys(editedData).length === 0) {
      return;
    }

    const validationErrors = [];
    Object.entries(editedData).forEach(([key, value]) => {
      const field = key.split("-").pop();
      const config = writebackColumnMap.get(field);
      if (config) {
        const validation = validateField(value, config);
        if (!validation.isValid) {
          validationErrors.push(`${field}: ${validation.message}`);
        }
      }
    });

    if (validationErrors.length > 0) {
      setSaveStatus({
        success: false,
        message: `Validation errors: ${validationErrors.join("; ")}`,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (writebackConfig.confirmBeforeSave) {
      const confirmed = window.confirm(
        `Save ${Object.keys(editedData).length} changes?`
      );
      if (!confirmed) {
        return;
      }
    }

    setIsSaving(true);
    setSaveStatus(null);

    try {
      const result = await saveWritebackData(editedData, layout, app);

      setSaveStatus({
        success: true,
        message: result.message,
        fileName: result.fileName,
        changeCount: result.changeCount,
        timestamp: result.timestamp,
      });

      setHasUnsavedChanges(false);
      setEditedData({});

      // NEW: Update presence after successful save
      if (presenceService) {
        presenceService.updateEditingStatus(null, []);
      }

      if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
        setAutoSaveTimer(null);
      }
    } catch (error) {
      setSaveStatus({
        success: false,
        message: error.message,
        timestamp: new Date().toISOString(),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const clearAllChanges = () => {
    setEditedData({});
    setHasUnsavedChanges(false);
    setSaveStatus(null);

    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      setAutoSaveTimer(null);
    }
  };

  // MODIFIED: handleModeChange to update presence
  const handleModeChange = (newMode) => {
    setCurrentMode(newMode);
    if (newMode === "selection" && selectionMode) {
      setSelectionMode(false);
    }
    
    // NEW: Update presence when switching modes
    if (presenceService) {
      if (newMode === 'edit') {
        presenceService.updateEditingStatus(null, []);
      } else {
        presenceService.updateEditingStatus(null, []);
      }
    }
  };

  const renderWritebackCell = (rowId, field, config) => {
    const value = getEditedValue(rowId, field);
    const isDisabled = config.readOnly || currentMode !== "edit";
    const validation = validateField(value, config);

    const baseStyle = {
      width: "100%",
      padding: "6px 8px",
      border: `1px solid ${!validation.isValid ? "#dc3545" : "#ddd"}`,
      borderRadius: "4px",
      fontSize: "13px",
      backgroundColor: isDisabled ? "#f8f9fa" : "white",
      color: isDisabled ? "#6c757d" : "#495057",
      cursor: isDisabled ? "not-allowed" : "text",
      boxSizing: "border-box",
      opacity: currentMode !== "edit" ? 0.6 : 1,
    };

    const handleChange = (newValue) => {
      updateEditedData(rowId, field, newValue);
    };

    switch (config.columnType) {
      case "text":
        return (
          <div>
            <input
              type="text"
              value={value}
              onChange={(e) => handleChange(e.target.value)}
              placeholder={config.placeholder}
              readOnly={config.readOnly}
              disabled={currentMode !== "edit"}
              style={baseStyle}
              title={!validation.isValid ? validation.message : undefined}
            />
            {!validation.isValid && (
              <div
                style={{ fontSize: "10px", color: "#dc3545", marginTop: "2px" }}
              >
                {validation.message}
              </div>
            )}
          </div>
        );

      case "textarea":
        return (
          <div>
            <textarea
              value={value}
              onChange={(e) => handleChange(e.target.value)}
              placeholder={config.placeholder}
              readOnly={config.readOnly}
              disabled={currentMode !== "edit"}
              rows={2}
              style={{
                ...baseStyle,
                resize: "vertical",
                minHeight: "40px",
              }}
              title={!validation.isValid ? validation.message : undefined}
            />
            {!validation.isValid && (
              <div
                style={{ fontSize: "10px", color: "#dc3545", marginTop: "2px" }}
              >
                {validation.message}
              </div>
            )}
          </div>
        );

      case "number":
        return (
          <div>
            <input
              type="number"
              value={value}
              onChange={(e) => handleChange(e.target.value)}
              placeholder={config.placeholder}
              readOnly={config.readOnly}
              disabled={currentMode !== "edit"}
              min={config.validation?.min}
              max={config.validation?.max}
              style={baseStyle}
              title={!validation.isValid ? validation.message : undefined}
            />
            {!validation.isValid && (
              <div
                style={{ fontSize: "10px", color: "#dc3545", marginTop: "2px" }}
              >
                {validation.message}
              </div>
            )}
          </div>
        );

      case "dropdown":
        const options = config.dropdownOptions
          ? config.dropdownOptions.split(",").map((opt) => opt.trim())
          : [];

        return (
          <select
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            disabled={isDisabled}
            style={baseStyle}
          >
            <option value="">{config.placeholder || "Select..."}</option>
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        );

      case "date":
        return (
          <input
            type="date"
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            readOnly={config.readOnly}
            disabled={currentMode !== "edit"}
            style={baseStyle}
          />
        );

      case "checkbox":
        return (
          <input
            type="checkbox"
            checked={value === "true" || value === true}
            onChange={(e) => handleChange(e.target.checked)}
            disabled={isDisabled}
            style={{
              width: "16px",
              height: "16px",
              cursor: isDisabled ? "not-allowed" : "pointer",
            }}
          />
        );

      default:
        return <span>{value}</span>;
    }
  };

  const isWritebackColumn = (columnIndex) => {
    return isWritebackColumnIndex(columnIndex, layout);
  };

  function handleCellSelection(rowIndex, columnIndex, cellValue) {
    if (isWritebackColumn(columnIndex)) return;

    const cellKey = `${rowIndex}-${columnIndex}-${cellValue.qText}-${cellValue.qElemNumber}`;
    const newSelections = new Set(selectedCells);

    const isCurrentlySelected = newSelections.has(cellKey);

    if (isCurrentlySelected) {
      const keysToRemove = [];
      for (const key of newSelections) {
        const [, keyColIndex, keyText, keyElemNumber] = key.split("-");
        if (
          parseInt(keyColIndex) === columnIndex &&
          keyText === cellValue.qText &&
          keyElemNumber === String(cellValue.qElemNumber)
        ) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => newSelections.delete(key));
    } else {
      pagedRows.forEach((row, i) => {
        if (
          row[columnIndex] &&
          row[columnIndex].qText === cellValue.qText &&
          row[columnIndex].qElemNumber === cellValue.qElemNumber
        ) {
          const keyForThisRow = `${i}-${columnIndex}-${row[columnIndex].qText}-${row[columnIndex].qElemNumber}`;
          newSelections.add(keyForThisRow);
        }
      });
    }

    setSelectedCells(newSelections);
  }

  async function onCellClick(columnIndex, cellValue, row, pageRowIndex) {
    if (currentMode === "edit") {
      return;
    }

    if (currentMode === "selection" && selectionMode) {
      return;
    }

    if (isWritebackColumn(columnIndex)) {
      return;
    }

    const baseColumnIndex = mapToBaseColumnIndex(columnIndex, layout);
    if (baseColumnIndex === -1) return;

    try {
      const success = await handleCellClick(
        app,
        layout,
        baseColumnIndex,
        cellValue,
        row,
        model,
        selections,
        pageRowIndex,
        page + 1,
        pageSize
      );

      if (success) {
        console.log("Cell selection completed, waiting for layout update...");
      }
    } catch (error) {
      console.error("Error in cell click:", error);
    }
  }

  async function onApplyCellSelections() {
    setIsApplyingSelection(true);

    try {
      const fieldSelections = {};

      selectedCells.forEach((cellKey) => {
        const [rowIndex, columnIndex, cellText, elemNumber] =
          cellKey.split("-");
        const row = pagedRows[parseInt(rowIndex)];
        const colIdx = parseInt(columnIndex);

        if (isWritebackColumn(colIdx)) return;

        const baseColIdx = mapToBaseColumnIndex(colIdx, layout);
        if (baseColIdx === -1) return;

        if (row && isDynamicColumnSelectable(colIdx, layout)) {
          const dimensionInfo = layout.qHyperCube.qDimensionInfo[baseColIdx];
          const fieldName =
            dimensionInfo?.qGroupFieldDefs?.[0] ||
            dimensionInfo?.qFallbackTitle ||
            dimensionInfo?.cId;

          if (fieldName && row[colIdx]) {
            if (!fieldSelections[fieldName]) {
              fieldSelections[fieldName] = new Set();
            }

            const valueKey = `${row[colIdx].qText}|${row[colIdx].qElemNumber}`;
            if (
              !Array.from(fieldSelections[fieldName]).some(
                (v) => `${v.qText}|${v.qElemNumber}` === valueKey
              )
            ) {
              fieldSelections[fieldName].add({
                qText: row[colIdx].qText,
                qElemNumber: row[colIdx].qElemNumber,
                qIsNumeric:
                  !isNaN(row[colIdx].qNum) && row[colIdx].qNum !== null,
                qNumber: isNaN(row[colIdx].qNum) ? undefined : row[colIdx].qNum,
              });
            }
          }
        }
      });

      let success = false;
      for (const [fieldName, valueSet] of Object.entries(fieldSelections)) {
        const values = Array.from(valueSet);
        try {
          let field;
          if (typeof app.getField === "function") {
            field = await app.getField(fieldName);
          } else if (typeof app.field === "function") {
            field = await app.field(fieldName);
          }

          if (field && values.length > 0) {
            await field.selectValues(values, false, false);
            success = true;
          }
        } catch (fieldError) {
          console.error(`Failed to select in field ${fieldName}:`, fieldError);
        }
      }

      if (success) {
        setSelectedCells(new Set());
        setSelectionMode(false);
      }
    } catch (error) {
      console.error("Error applying cell selections:", error);
    } finally {
      setTimeout(() => {
        setIsApplyingSelection(false);
      }, 100);
    }
  }

  async function onClearAllSelections() {
    setIsApplyingSelection(true);

    try {
      const success = await clearAllQlikSelections(app, model, selections);
      if (success) {
        setSelectedRows(clearLocalSelections());
        setSelectionMode(false);
      }
    } catch (error) {
      console.error("Error clearing selections:", error);
    } finally {
      setTimeout(() => {
        setIsApplyingSelection(false);
      }, 100);
    }
  }

  const displayRows = sortRows(rows, sortBy, sortDir);
  const { pagedRows, totalPages } = getPagedRows(displayRows, page, pageSize);
  const pageStartIndex = page * pageSize;
  const pageSelectionCount = getPageSelectionCount(
    selectedRows,
    pageStartIndex,
    pageSize,
    displayRows.length
  );

  const getColumnWidth = (columnIndex) => {
    if (isWritebackColumn(columnIndex)) {
      const columnName = getWritebackColumnName(columnIndex, layout);
      const config = writebackColumnMap.get(columnName);
      if (config && config.width) {
        return config.width;
      }
      return "200px";
    }
    return "120px";
  };

  function handleHeaderClick(idx) {
    if (!isWritebackColumn(idx)) {
      if (sortBy === idx) {
        setSortDir((prev) => !prev);
      } else {
        setSortBy(idx);
        setSortDir(true);
      }
      setPage(0);
    }
  }

  function resetSort() {
    setSortBy(null);
    setSortDir(true);
    setPage(0);
  }

  function gotoPage(newPage) {
    setPage(Math.max(0, Math.min(totalPages - 1, newPage)));
  }

  return (
    <div style={{ width: "100%", height: "100%" }}>
      {/* Active Users Header */}
      <ActiveUsersHeader />

      {/* Show conflict alerts */}
      <ConflictAlert conflicts={conflicts} />

      {/* Table container */}
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: "4px",
          overflow: "hidden",
          backgroundColor: "white",
          height: "600px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ flex: 1, overflow: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              tableLayout: "fixed",
            }}
          >
            <thead>
              <tr
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 10,
                  backgroundColor: "#f8f9fa",
                }}
              >
                {columns.map((c, idx) => {
                  const isWriteback = isWritebackColumn(idx);
                  const columnName = isWriteback
                    ? getWritebackColumnName(idx, layout)
                    : baseColumns[idx];
                  const isKeyDim =
                    !isWriteback && isKeyDimension(columnName, layout);
                  let config = null;
                  if (isWriteback) {
                    config = writebackColumnMap.get(columnName);
                  }

                  return (
                    <th
                      key={idx}
                      style={{
                        cursor: isWriteback ? "default" : "pointer",
                        userSelect: "none",
                        padding: "12px 8px",
                        backgroundColor: "#f8f9fa",
                        border: "1px solid #dee2e6",
                        borderTop: "none",
                        fontWeight: "600",
                        fontSize: "14px",
                        color: "#495057",
                        width: getColumnWidth(idx),
                        textAlign: "left",
                        boxShadow: "0 2px 2px -1px rgba(0, 0, 0, 0.1)",
                      }}
                      onClick={() => handleHeaderClick(idx)}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <span>
                          {isWriteback ? columnName : c}
                          {isKeyDim && (
                            <span
                              style={{
                                fontSize: "10px",
                                color: "#2e7d32",
                                marginLeft: "4px",
                              }}
                              title="Key Dimension"
                            >
                              🔑
                            </span>
                          )}
                          {isWriteback && !config?.readOnly && (
                            <span
                              style={{
                                fontSize: "10px",
                                color: "#28a745",
                                marginLeft: "4px",
                              }}
                            >
                              ✏️
                            </span>
                          )}
                          {isWriteback && config?.required && (
                            <span
                              style={{
                                fontSize: "10px",
                                color: "#dc3545",
                                marginLeft: "2px",
                              }}
                            >
                              *
                            </span>
                          )}
                        </span>
                        {sortBy === idx && !isWriteback && (
                          <span style={{ color: "#007acc", fontSize: "12px" }}>
                            {sortDir ? "▲" : "▼"}
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {pagedRows.map((row, i) => {
                const actualRowIndex = pageStartIndex + i;
                const backgroundColor = i % 2 === 0 ? "#ffffff" : "#f9f9f9";

                return (
                  <tr
                    key={i}
                    style={{
                      borderBottom: "1px solid #eee",
                      backgroundColor,
                      transition: "background-color 0.2s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = "#f0f8ff";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = backgroundColor;
                    }}
                  >
                    {row.map((cell, j) => {
                      const isWriteback = isWritebackColumn(j);
                      const cellKey = `${i}-${j}-${cell.qText}-${cell.qElemNumber}`;
                      const isCellSelected = selectedCells.has(cellKey);

                      const isValueSelected =
                        !isWriteback &&
                        isDynamicColumnSelectable(j, layout) &&
                        Array.from(selectedCells).some((selectedKey) => {
                          const [
                            ,
                            selectedColIndex,
                            selectedText,
                            selectedElemNumber,
                          ] = selectedKey.split("-");
                          return (
                            parseInt(selectedColIndex) === j &&
                            selectedText === cell.qText &&
                            selectedElemNumber === String(cell.qElemNumber)
                          );
                        });

                      const rowId = getRowId(row, actualRowIndex);

                      let cellColumnName = null;
                      if (isWriteback) {
                        cellColumnName = getWritebackColumnName(j, layout);
                      } else {
                        cellColumnName = baseColumns[j];
                      }

                      let cellContent;
                      if (isWriteback) {
                        const columnName = getWritebackColumnName(j, layout);
                        const config = writebackColumnMap.get(columnName);
                        cellContent = renderWritebackCell(
                          rowId,
                          columnName,
                          config
                        );
                      } else {
                        cellContent = (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                              justifyContent: "space-between",
                            }}
                          >
                            <span style={{ flex: 1 }}>{cell.qText}</span>

                            {currentMode === "selection" &&
                              selectionMode &&
                              isDynamicColumnSelectable(j, layout) && (
                                <input
                                  type="checkbox"
                                  checked={isValueSelected}
                                  onChange={(e) => {
                                    e.stopPropagation();
                                    handleCellSelection(i, j, cell);
                                  }}
                                  style={{
                                    width: "12px",
                                    height: "12px",
                                    cursor: "pointer",
                                    flexShrink: 0,
                                  }}
                                  title={`Select all instances of "${cell.qText}" for batch operation`}
                                />
                              )}
                          </div>
                        );
                      }

                      return (
                        <td
                          key={j}
                          style={{
                            padding: "8px",
                            border: "1px solid #eee",
                            borderTop: "none",
                            fontSize: "13px",
                            width: getColumnWidth(j),
                            overflow: "hidden",
                            whiteSpace:
                              isWriteback &&
                              writebackColumnMap.get(
                                getWritebackColumnName(j, layout)
                              )?.columnType === "textarea"
                                ? "normal"
                                : "nowrap",
                            cursor: isWriteback
                              ? "default"
                              : currentMode === "edit"
                              ? "default"
                              : currentMode === "selection" &&
                                isDynamicColumnSelectable(j, layout) &&
                                !selectionMode
                              ? "pointer"
                              : "default",
                            backgroundColor:
                              isValueSelected && currentMode === "selection"
                                ? "#d4edda"
                                : isWriteback
                                ? writebackColumnMap.get(
                                    getWritebackColumnName(j, layout)
                                  )?.readOnly
                                  ? "#f8f9fa"
                                  : "#fff8e1"
                                : !isWriteback &&
                                  cellColumnName &&
                                  isKeyDimension(cellColumnName, layout)
                                ? "#f3e5f5"
                                : currentMode === "selection" &&
                                  isDynamicColumnSelectable(j, layout) &&
                                  !isWriteback
                                ? "rgba(0, 123, 204, 0.05)"
                                : "transparent",
                          }}
                          title={
                            isWriteback
                              ? `${getWritebackColumnName(j, layout)} ${
                                  writebackColumnMap.get(
                                    getWritebackColumnName(j, layout)
                                  )?.readOnly
                                    ? "(Read-only)"
                                    : "(Editable)"
                                }${
                                  writebackColumnMap.get(
                                    getWritebackColumnName(j, layout)
                                  )?.required
                                    ? " - Required"
                                    : ""
                                }`
                              : !isWriteback &&
                                cellColumnName &&
                                isKeyDimension(cellColumnName, layout)
                              ? `${cellColumnName} (Key Dimension)`
                              : cell.qText
                          }
                          onClick={() => onCellClick(j, cell, row, i)}
                        >
                          {cellContent}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination controls */}
      <div
        style={{
          marginTop: 16,
          padding: "12px 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          borderTop: "1px solid #eee",
        }}
      >
        <div>
          {sortBy !== null && (
            <button
              onClick={resetSort}
              style={{
                fontWeight: "500",
                padding: "6px 12px",
                backgroundColor: "#6c757d",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              Reset Sort
            </button>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => gotoPage(page - 1)}
            disabled={page === 0}
            style={{
              padding: "6px 12px",
              backgroundColor: page === 0 ? "#e9ecef" : "#007acc",
              color: page === 0 ? "#6c757d" : "white",
              border: "none",
              borderRadius: "4px",
              cursor: page === 0 ? "not-allowed" : "pointer",
              fontSize: "12px",
            }}
          >
            Previous
          </button>

          <span
            style={{
              fontWeight: "500",
              fontSize: "14px",
              color: "#495057",
              margin: "0 8px",
            }}
          >
            Page {page + 1} of {totalPages}
          </span>

          <button
            onClick={() => gotoPage(page + 1)}
            disabled={page >= totalPages - 1}
            style={{
              padding: "6px 12px",
              backgroundColor: page >= totalPages - 1 ? "#e9ecef" : "#007acc",
              color: page >= totalPages - 1 ? "#6c757d" : "white",
              border: "none",
              borderRadius: "4px",
              cursor: page >= totalPages - 1 ? "not-allowed" : "pointer",
              fontSize: "12px",
            }}
          >
            Next
          </button>
        </div>

        <div
          style={{
            fontSize: 12,
            color: "#6c757d",
            textAlign: "right",
          }}
        >
          <div>
            Showing {pagedRows.length} of {displayRows.length} rows
          </div>
          <div style={{ fontSize: 11, marginTop: 2 }}>
            {currentMode === "edit" && hasActiveWriteback ? (
              <span>
                ✏️ = Editable • * = Required
                {hasUnsavedChanges &&
                  writebackConfig.showChangeCounter !== false && (
                    <span style={{ color: "#dc3545", marginLeft: "8px" }}>
                      {Object.keys(editedData).length} unsaved change
                      {Object.keys(editedData).length !== 1 ? "s" : ""}
                    </span>
                  )}
                {!hasUnsavedChanges && (
                  <span style={{ color: "#28a745", marginLeft: "8px" }}>
                    All saved
                  </span>
                )}
              </span>
            ) : currentMode === "selection" ? (
              <span>
                Click dimension cells to select • Use checkboxes for batch
                operations
                {pageSelectionCount > 0 && (
                  <span style={{ color: "#007acc", marginLeft: "8px" }}>
                    • {pageSelectionCount} selected on page
                  </span>
                )}
              </span>
            ) : !writebackConfig.enabled ? (
              <span>Writeback disabled - Enable in property panel</span>
            ) : configuredColumns.length === 0 ? (
              <span>Configure writeback columns in property panel</span>
            ) : (
              <span>
                Writeback ready - {configuredColumns.length} column
                {configuredColumns.length !== 1 ? "s" : ""} configured
              </span>
            )}

            {keyDimensionsSummary.hasKeyDimensions && (
              <div style={{ fontSize: 10, marginTop: 2, color: "#2e7d32" }}>
                🔑 = Key Dimension
                {!keyValidation.isValid && (
                  <span style={{ color: "#d32f2f", marginLeft: "8px" }}>
                    • ⚠️ {keyValidation.duplicates.length} duplicate key
                    {keyValidation.duplicates.length !== 1 ? "s" : ""} detected
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* User Collaboration Panel */}
      <UserCollaborationPanel
        isOpen={showUserPanel}
        onClose={() => setShowUserPanel(false)}
      />
    </div>
  );
}