import { useState, useEffect, useRef } from "react";
import { getConversations, updateConversationTitle, deleteConversation, type Conversation, getDashboards, updateDashboardTitle, type Dashboard } from "./api";
import { PencilIcon, ThreeDotsIcon, DeleteIcon, ChevronRightIcon, ChevronDownIcon, SpinnerIcon } from "./icons";
import { logger } from "./utils/logger";

const sidebarButton = {
    border: "none",
    padding: "0.5rem 0.75rem",
    borderRadius: "8px",
    background: "#f3f4f6",
    color: "#111",
    cursor: "pointer",
    textAlign: "left" as const,
    fontSize: "0.9rem",
  };
  
const sidebarItemButton = {
    ...sidebarButton,
    background: "#f3f4f6",
    fontWeight: 400,
};

export function SidebarSection({
  title,
  items,
  itemsWithIds,
  onConversationSelect,
  selectedConversationId,
  refreshTrigger,
  onDashboardRename,
  onDashboardDelete,
  onDashboardsUpdate,
  isExpanded: externalIsExpanded,
  onExpandedChange,
  isCollapsed,
  activeDeepResearchConversations,
}: {
  title: string;
  items: string[];
  itemsWithIds?: Array<{ id: string; title: string }>;
  onConversationSelect?: (conversationId: string) => void;
  selectedConversationId?: string | null;
  refreshTrigger?: number;
  onDashboardRename?: (dashboardId: string, newTitle: string) => void;
  onDashboardDelete?: (dashboardId: string) => void;
  onDashboardsUpdate?: (dashboards: Dashboard[]) => void;
  isExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  isCollapsed?: boolean;
  activeDeepResearchConversations?: Set<string>;
}) {
  const [internalIsExpanded, setInternalIsExpanded] = useState(false);
  const isExpanded = externalIsExpanded !== undefined ? externalIsExpanded : internalIsExpanded;
  
  const setIsExpanded = (expanded: boolean) => {
    if (onExpandedChange) {
      onExpandedChange(expanded);
    } else {
      setInternalIsExpanded(expanded);
    }
  };
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [editingDashboardId, setEditingDashboardId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>("");
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ conversation: Conversation | null; dashboard: Dashboard | null }>({ conversation: null, dashboard: null });
  const menuRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const sidebarSectionRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef<{ [key: string]: HTMLButtonElement | null }>({});
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isCancellingRef = useRef(false);

  const fetchConversations = () => {
    if (title === "Chats") {
      setIsLoadingConversations(true);
      setConversationsError(null);
      
      logger.log("Calling get_all_conversations to refresh sidebar");
      getConversations()
        .then((convs) => {
          logger.log("Received conversations:", convs.length);
          setConversations(convs);
          setIsLoadingConversations(false);
        })
        .catch((error) => {
          logger.error("Failed to fetch conversations:", error);
          setConversationsError(error.message || "Failed to load conversations");
          setIsLoadingConversations(false);
        });
    }
  };

  const fetchDashboards = () => {
    if (title === "Dashboards") {
      setIsLoadingConversations(true);
      setConversationsError(null);
      
      logger.log("Calling get_all_dashboards to refresh sidebar");
      getDashboards()
        .then((dashs) => {
          logger.log("Received dashboards:", dashs.length);
          setDashboards(dashs);
          // Update App.tsx dashboards state to keep them in sync
          if (onDashboardsUpdate) {
            onDashboardsUpdate(dashs);
          }
          setIsLoadingConversations(false);
        })
        .catch((error) => {
          logger.error("Failed to fetch dashboards:", error);
          setConversationsError(error.message || "Failed to load dashboards");
          setIsLoadingConversations(false);
        });
    }
  };

  useEffect(() => {
    if (title === "Chats") {
      fetchConversations();
    } else if (title === "Dashboards") {
      fetchDashboards();
    }
  }, [title]);

  // Refresh conversations or dashboards when refreshTrigger changes
  useEffect(() => {
    if (refreshTrigger !== undefined && refreshTrigger > 0) {
      if (title === "Chats") {
        fetchConversations();
      } else if (title === "Dashboards" || title === "") {
        fetchDashboards();
      }
    }
  }, [refreshTrigger]);

  // Close menu when clicking outside
  useEffect(() => {
    if (!openMenuId) return;

    const handleClickOutside = (event: MouseEvent) => {
      const menuElement = menuRefs.current[openMenuId];
      const buttonElement = buttonRefs.current[openMenuId];
      const target = event.target as Node;
      
      // Don't close if clicking on the menu element itself or the button that opened it
      if (menuElement && menuElement.contains(target)) {
        return;
      }
      if (buttonElement && buttonElement.contains(target)) {
        return;
      }
      
      // Close menu for any other click
      setOpenMenuId(null);
    };

    // Use a small delay to ensure the button click handler has processed
    const timeoutId = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [openMenuId]);

  const handleRename = (conversation: Conversation) => {
    setEditingConversationId(conversation.id);
    setEditingTitle(conversation.title);
    setOpenMenuId(null);
    // Focus the input after a brief delay to ensure it's rendered
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  };

  const handleSaveRename = async (itemId: string) => {
    const trimmedTitle = editingTitle.trim();
    if (!trimmedTitle) {
      // If empty, cancel the edit
      setEditingConversationId(null);
      setEditingDashboardId(null);
      return;
    }

    if (title === "Chats") {
      const conversation = conversations.find(c => c.id === itemId);
      if (conversation && trimmedTitle !== conversation.title) {
        try {
          await updateConversationTitle(itemId, trimmedTitle);
          fetchConversations(); // Refresh the list
        } catch (error) {
          logger.error("Failed to rename conversation:", error);
          alert("Failed to rename conversation. Please try again.");
        }
      }
      setEditingConversationId(null);
    } else if (title === "Dashboards") {
      const dashboard = dashboards.find(d => d.id === itemId);
      if (dashboard && trimmedTitle !== dashboard.title) {
        // Call onDashboardRename first to update App.tsx state immediately
        // This ensures the Dashboard component's title prop updates right away
        if (onDashboardRename) {
          onDashboardRename(itemId, trimmedTitle);
        }
        try {
          await updateDashboardTitle(itemId, trimmedTitle);
          fetchDashboards(); // Refresh the list from API
        } catch (error) {
          logger.error("Failed to rename dashboard:", error);
          alert("Failed to rename dashboard. Please try again.");
          // On error, refresh to get the correct title back
          fetchDashboards();
        }
      }
      setEditingDashboardId(null);
    }
  };

  const handleCancelRename = () => {
    isCancellingRef.current = true;
    setEditingConversationId(null);
    setEditingDashboardId(null);
    setEditingTitle("");
    setTimeout(() => {
      isCancellingRef.current = false;
    }, 0);
  };

  const handleDelete = (conversation: Conversation | null, dashboard: Dashboard | null = null) => {
    setDeleteConfirmation({ conversation, dashboard });
    setOpenMenuId(null);
  };

  const confirmDelete = async () => {
    if (title === "Chats" && deleteConfirmation.conversation) {
      try {
        await deleteConversation(deleteConfirmation.conversation.id);
        fetchConversations(); // Refresh the list
      } catch (error) {
        logger.error("Failed to delete conversation:", error);
        alert("Failed to delete conversation. Please try again.");
      }
    } else if (title === "Dashboards" && deleteConfirmation.dashboard) {
      try {
        if (onDashboardDelete) {
          await onDashboardDelete(deleteConfirmation.dashboard.id);
        }
        fetchDashboards(); // Refresh the list
      } catch (error) {
        logger.error("Failed to delete dashboard:", error);
        alert("Failed to delete dashboard. Please try again.");
      }
    }
    setDeleteConfirmation({ conversation: null, dashboard: null });
  };

  const cancelDelete = () => {
    setDeleteConfirmation({ conversation: null, dashboard: null });
  };

  return (
    <>
      {/* Delete Confirmation Modal */}
      {(deleteConfirmation.conversation || deleteConfirmation.dashboard) && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100000,
          }}
          onClick={cancelDelete}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: "8px",
              padding: "1.5rem",
              minWidth: "400px",
              maxWidth: "500px",
              boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
            }}
          >
            <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.25rem", fontWeight: 600 }}>
              Delete {title === "Chats" ? "Conversation" : "Dashboard"}
            </h3>
            <p style={{ margin: "0 0 1.5rem 0", color: "#6b7280", fontSize: "0.875rem" }}>
              Are you sure you want to delete "{deleteConfirmation.conversation?.title || deleteConfirmation.dashboard?.title || ""}"? This action cannot be undone.
            </p>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
              <button
                onClick={cancelDelete}
                style={{
                  padding: "0.5rem 1rem",
                  border: "1px solid #e5e7eb",
                  borderRadius: "6px",
                  background: "#fff",
                  color: "#111",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#f9fafb";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#fff";
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                style={{
                  padding: "0.5rem 1rem",
                  border: "none",
                  borderRadius: "6px",
                  background: "#ef4444",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#dc2626";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#ef4444";
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {isCollapsed ? null : (
        <div 
          ref={(el) => { sidebarSectionRef.current = el; }}
          style={{ display: "flex", flexDirection: "column", minHeight: 0 }}
        >
          {/* Section header */}
          <div
            style={{
              fontWeight: 600,
              marginBottom: "0.5rem",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              cursor: "pointer",
            }}
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? (
              <ChevronDownIcon color="#6b7280" style={{ display: "inline-block" }} />
            ) : (
              <ChevronRightIcon color="#6b7280" style={{ display: "inline-block" }} />
            )}
            <span>{title}</span>
          </div>

      {/* Scrollable content */}
      {isExpanded && (
        <div 
          onClick={(e) => {
            // Close menu if clicking anywhere in the scrollable area
            // The menu's own click handlers will prevent this from closing when clicking on menu items
            if (openMenuId) {
              const target = e.target as HTMLElement;
              const menuElement = menuRefs.current[openMenuId];
              // Only close if not clicking on the menu element itself
              if (menuElement && !menuElement.contains(target)) {
                setOpenMenuId(null);
              }
            }
          }}
          style={{ 
            marginLeft: "0.5rem", 
            marginRight: "0.5rem",
            display: "flex", 
            flexDirection: "column", 
            gap: "0.25rem",
            overflowY: "auto",
            overflowX: "visible",
            flex: 1,
            minHeight: "20rem",
          }}
        >

        {isLoadingConversations && (
          <div style={{ fontSize: "0.8rem", color: "#6b7280", padding: "0.5rem 0.75rem" }}>
            Loading conversations...
          </div>
        )}

        {conversationsError && (
          <div style={{ fontSize: "0.8rem", color: "#ef4444", padding: "0.5rem 0.75rem" }}>
            {conversationsError}
          </div>
        )}

        {!isLoadingConversations && !conversationsError && (title === "Chats" ? conversations : title === "Dashboards" ? dashboards : itemsWithIds || items.map((name, idx) => ({ id: idx.toString(), title: name }))).map((item) => {
          const conversation = title === "Chats" ? item as Conversation : null;
          const dashboard = title === "Dashboards" ? item as Dashboard : null;
          const displayName = conversation ? conversation.title : dashboard ? dashboard.title : (item as { id: string; title: string }).title;
          const itemId = conversation ? conversation.id : dashboard ? dashboard.id : (item as { id: string; title: string }).id;
          const isMenuOpen = openMenuId === itemId;

          return (
            <div
              key={itemId}
              style={{
                display: "flex",
                alignItems: "flex-start",
                position: "relative",
                gap: "0.25rem",
                //minHeight: "20rem",
                overflow: "visible",
              }}
            >
              {((title === "Chats" && conversation && editingConversationId === conversation.id) ||
                (title === "Dashboards" && editingDashboardId === itemId)) ? (
                <input
                  ref={inputRef}
                  type="text"
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSaveRename(itemId);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      handleCancelRename();
                    }
                  }}
                  onBlur={() => {
                    // Don't save if we're cancelling (Escape was pressed)
                    if (!isCancellingRef.current) {
                      handleSaveRename(itemId);
                    }
                  }}
                  style={{
                    ...sidebarItemButton,
                    flex: 1,
                    outline: "2px solid #3b82f6",
                    outlineOffset: "-2px",
                    cursor: "text",
                  }}
                />
              ) : (
                <button 
                  className="sidebar-button" 
                  style={{ 
                    ...sidebarItemButton, 
                    flex: 1,
                    background: selectedConversationId === itemId ? "#dbeafe" : sidebarItemButton.background,
                    fontWeight: selectedConversationId === itemId ? 600 : sidebarItemButton.fontWeight,
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                  onClick={() => {
                    // Close any open menu when clicking on a conversation item
                    if (openMenuId) {
                      setOpenMenuId(null);
                    }
                    // Load conversation or dashboard if callback is provided
                    if (onConversationSelect) {
                      if (title === "Chats" && conversation) {
                        onConversationSelect(conversation.id);
                      } else if (title !== "Chats") {
                        onConversationSelect(itemId);
                      }
                    }
                  }}
                >
                  {title === "Chats" && activeDeepResearchConversations && activeDeepResearchConversations.has(itemId) && (
                    <SpinnerIcon width="14" height="14" color="#3b82f6" style={{ flexShrink: 0 }} />
                  )}
                  <span style={{ flex: 1, textAlign: "left" }}>{displayName}</span>
                </button>
              )}
              {((title === "Chats" && conversation) || title === "Dashboards") && (
                <div style={{ position: "relative", paddingRight: "0.25rem", marginTop: "0.25rem"}} ref={(el) => { menuRefs.current[itemId] = el; }}>
                  <button
                    ref={(el) => { buttonRefs.current[itemId] = el; }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setOpenMenuId(isMenuOpen ? null : itemId);
                    }}
                    style={{
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      padding: "0.25rem",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: "4px",
                      outlineOffset: "2px",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#e5e7eb";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <ThreeDotsIcon />
                  </button>
                  {isMenuOpen && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        position: "absolute",
                        right: "0",
                        top: "100%",
                        marginTop: "0.25rem",
                        background: "#fff",
                        border: "1px solid #e5e7eb",
                        borderRadius: "8px",
                        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
                        zIndex: 1000,
                        minWidth: "150px",
                        padding: "0.25rem",
                      }}
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (title === "Chats" && conversation) {
                            handleRename(conversation);
                          } else if (title === "Dashboards") {
                            setEditingDashboardId(itemId);
                            setEditingTitle(displayName);
                            setOpenMenuId(null);
                            setTimeout(() => {
                              inputRef.current?.focus();
                              inputRef.current?.select();
                            }, 0);
                          }
                        }}
                        style={{
                          width: "100%",
                          border: "none",
                          background: "transparent",
                          padding: "0.5rem 0.75rem",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          fontSize: "0.875rem",
                          color: "#111",
                          borderRadius: "4px",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "#f3f4f6";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                      >
                        <PencilIcon color="#6b7280" />
                        Rename
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (title === "Chats" && conversation) {
                            handleDelete(conversation, null);
                          } else if (title === "Dashboards" && dashboard) {
                            handleDelete(null, dashboard);
                          }
                        }}
                        style={{
                          width: "100%",
                          border: "none",
                          background: "transparent",
                          padding: "0.5rem 0.75rem",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          fontSize: "0.875rem",
                          color: "#ef4444",
                          borderRadius: "4px",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "#fee2e2";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                      >
                        <DeleteIcon />
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {!isLoadingConversations && !conversationsError && (title === "Chats" ? conversations.length === 0 : title === "Dashboards" ? dashboards.length === 0 : items.length === 0) && (
          <div style={{ fontSize: "0.8rem", color: "#6b7280", padding: "0.5rem 0.75rem" }}>
            No {title.toLowerCase()} yet.
          </div>
        )}
        </div>
      )}
        </div>
      )}
    </>
  );
}