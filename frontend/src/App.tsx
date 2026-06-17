import { useState, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import Chat from "./chats/Chat";
import MessageInput from "./chats/MessageInput";
import Dashboard from "./dashboards/Dashboard";
import { SidebarSection } from "./SidebarSection";
import {
  getConversationMessages, 
  createDashboard, 
  deleteDashboard, 
  updateDashboardTitle, 
  type Dashboard as DashboardType 
} from "./api";
import { PencilIcon, DashboardIcon, ChevronLeftIcon, ChevronRightIcon, LogoutIcon } from "./icons";
import { logger } from "./utils/logger";
import { useAuth } from "./auth/AuthContext";
import Auth from "./auth/Auth";

export interface Message {
  role: "user" | "assistant";
  content: string;
  response_type: string | "text";
  figures?: any[];
  tables?: any[];
  other_results?: any[];
  code?: string | null;
  isComplete?: boolean; // Flag to indicate if the message is fully generated
  progress?: string; // Progress text for deep research (shown in lighter font)
  isDeepResearch?: boolean; // Flag to indicate if this is a deep research message
}

function App() {
  const { currentUser, logout } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [dashboards, setDashboards] = useState<DashboardType[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [selectedDashboardId, setSelectedDashboardId] = useState<string | null>(null);
  const [sidebarRefreshTrigger, setSidebarRefreshTrigger] = useState(0);
  const [dashboardRefreshTrigger, setDashboardRefreshTrigger] = useState(0);
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [isChatsExpanded, setIsChatsExpanded] = useState(false);
  const [isDashboardsExpanded, setIsDashboardsExpanded] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [activeDeepResearchConversations, setActiveDeepResearchConversations] = useState<Set<string>>(new Set());

  const previousMessagesRef = useRef<Message[]>([]);
  
  const userId = currentUser?.email || "";

  // Watch for assistant messages being completed and refresh sidebar
  useEffect(() => {
    // Skip on initial mount (when previousMessagesRef is empty)
    if (previousMessagesRef.current.length === 0) {
      previousMessagesRef.current = messages;
      return;
    }
    
    // Check if any assistant message has just been marked as complete
    const previousMessages = previousMessagesRef.current;
    
    // Find the last assistant message in current messages
    const lastAssistantMessage = [...messages].reverse().find(msg => msg.role === "assistant");
    const previousLastAssistantMessage = [...previousMessages].reverse().find(msg => msg.role === "assistant");
    
    // If we have a new assistant message that is complete, refresh sidebar
    // This handles both cases:
    // 1. New complete message added (non-streaming)
    // 2. Existing message transitioned from incomplete to complete (streaming)
    if (lastAssistantMessage && lastAssistantMessage.isComplete) {
      const wasCompleteBefore = previousLastAssistantMessage?.isComplete ?? false;
      const isCompleteNow = lastAssistantMessage.isComplete;
      
      // Refresh if this is a new message or if it just became complete
      if (!previousLastAssistantMessage || (!wasCompleteBefore && isCompleteNow)) {
        // Trigger sidebar refresh
        setSidebarRefreshTrigger(prev => prev + 1);
      }
    }
    
    // Update ref for next comparison
    previousMessagesRef.current = messages;
  }, [messages]);

  // Show auth screen if not logged in
  if (!currentUser) {
    return <Auth />;
  }

  const addMessage = (message: Message) => {
    setMessages((prev) => [...prev, message]);
  };

  const updateLastMessage = (updater: (message: Message) => Message) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      updated[updated.length - 1] = updater(updated[updated.length - 1]);
      return updated;
    });
  };

  const handleLoadingChange = (loading: boolean, action: string | null) => {
    setIsLoading(loading);
    setLoadingAction(action);
  };

  const setDeepResearchActive = (conversationId: string | null) => {
    if (conversationId) {
      setActiveDeepResearchConversations(prev => new Set(prev).add(conversationId));
    }
  };

  const setDeepResearchInactive = (conversationId: string | null) => {
    if (conversationId) {
      setActiveDeepResearchConversations(prev => {
        const newSet = new Set(prev);
        newSet.delete(conversationId);
        return newSet;
      });
    }
  };

  const handleNewChat = () => {
    // Clear selected dashboard and conversation, reset to chat view
    setSelectedDashboardId(null);
    setSelectedConversationId(null);
    setMessages([]);
    // Expand Chats menu
    setIsChatsExpanded(true);
  };

  const handleConversationSelect = async (conversationId: string) => {
    // Clear dashboard selection when selecting a conversation
    setSelectedDashboardId(null);
    // Clear messages and set loading state immediately (force synchronous render)
    flushSync(() => {
      setMessages([]);
      setSelectedConversationId(conversationId);
      setIsLoadingConversation(true);
    });
    
    try {
      const conversationMessages = await getConversationMessages(conversationId);
      // Convert API messages to Message format
      const formattedMessages: Message[] = conversationMessages.map((msg) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
        response_type: msg.response_type || "text",
        figures: msg.figures,
        tables: msg.tables,
        other_results: msg.other_results,
        code: msg.code || null,
        isComplete: msg.isComplete ?? true,
        progress: msg.progress,
        isDeepResearch: msg.isDeepResearch,
      }));
      setMessages(formattedMessages);
    } catch (error) {
      logger.error("Failed to load conversation messages:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      alert(`Failed to load conversation: ${errorMessage}`);
    } finally {
      setIsLoadingConversation(false);
    }
  };

  const handleNewDashboard = async () => {
    // Clear conversation selection when creating a new dashboard
    setSelectedConversationId(null);
    setMessages([]);
    // Expand Dashboards menu
    setIsDashboardsExpanded(true);
    
    try {
      // Create new dashboard via API
      const dashboardId = await createDashboard("New Dashboard");
      // Add minimal dashboard to state for title prop (Dashboard component will load full data)
      setDashboards((prev) => [...prev, { id: dashboardId, title: "New Dashboard", userId }]);
      setSelectedDashboardId(dashboardId);
      // Trigger sidebar refresh to show the new dashboard
      setDashboardRefreshTrigger(prev => prev + 1);
    } catch (error) {
      logger.error("Failed to create dashboard:", error);
      alert("Failed to create dashboard. Please try again.");
    }
  };

  const handleDashboardSelect = (dashboardId: string) => {
    // Clear conversation selection when selecting a dashboard
    setSelectedConversationId(null);
    setMessages([]);
    setSelectedDashboardId(dashboardId);
    // Ensure dashboard is in state (if not, Dashboard component will load it and update via onTitleChange)
    // If dashboard exists in state, the title prop will be passed correctly
    // If not, Dashboard will load from API and call onTitleChange to update state
  };

  const handleDashboardTitleChange = async (dashboardId: string, newTitle: string) => {
    // Update local state first for immediate UI update
    setDashboards((prev) => {
      const existingDashboard = prev.find((d) => d.id === dashboardId);
      if (existingDashboard) {
        // Update existing dashboard
        return prev.map((dashboard) =>
          dashboard.id === dashboardId ? { ...dashboard, title: newTitle } : dashboard
        );
      } else {
        // Add dashboard if it doesn't exist in the array
        return [...prev, { id: dashboardId, title: newTitle, userId }];
      }
    });
    
    // Trigger sidebar refresh to show the updated title
    setDashboardRefreshTrigger(prev => prev + 1);
    
    // Then update the API (don't await to avoid blocking UI)
    try {
      await updateDashboardTitle(dashboardId, newTitle);
    } catch (error) {
      logger.error("Failed to update dashboard title:", error);
      alert("Failed to update dashboard title. Please try again.");
      // Revert the local state change on error
      // Note: We'd need to track the previous title to revert properly, but for now just show the error
    }
  };

  const handleDashboardRename = (dashboardId: string, newTitle: string) => {
    handleDashboardTitleChange(dashboardId, newTitle);
  };

  const handleDashboardDelete = async (dashboardId: string) => {
    try {
      await deleteDashboard(dashboardId);
      setDashboards((prev) => prev.filter((dashboard) => dashboard.id !== dashboardId));
      // If the deleted dashboard was selected, clear the selection
      if (selectedDashboardId === dashboardId) {
        setSelectedDashboardId(null);
      }
    } catch (error) {
      logger.error("Failed to delete dashboard:", error);
      alert("Failed to delete dashboard. Please try again.");
    }
  };

  return (
    <div
      style={{
        display: "flex",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      {/* ---------- Sidebar ---------- */}
      <div
        style={{
          width: isSidebarCollapsed ? "60px" : "250px",
          background: "#f3f4f6",
          color: "#111", 
          padding: isSidebarCollapsed ? "1rem 0.5rem" : "1rem",
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          overflow: "hidden",
          transition: "width 0.2s ease, padding 0.2s ease",
          position: "relative",
        }}
      >
        {/* Collapse/Expand Toggle Button - only when expanded */}
        {!isSidebarCollapsed && (
          <button
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            style={{
              position: "absolute",
              top: "1rem",
              right: "0.5rem",
              border: "none",
              padding: "0.5rem",
              borderRadius: "6px",
              background: "#e5e7eb",
              color: "#111",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10,
              transition: "background 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#d1d5db";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#e5e7eb";
            }}
            title="Collapse sidebar"
          >
            <ChevronLeftIcon color="#111" />
          </button>
        )}

        {/* Top section - New Chat and New Dashboard buttons */}
        <div style={{ flexShrink: 0 }}>
          {!isSidebarCollapsed && (
            <>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                  marginTop: "2.5rem",
                }}
              >
                <button
                  onClick={handleNewChat}
                  style={{
                    border: "none",
                    padding: "0.5rem 0.75rem",
                    borderRadius: "8px",
                    background: "#f3f4f6",
                    color: "#111",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: "0.9rem",
                    display: "flex",
                    alignItems: "center",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#e5e7eb";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "#f3f4f6";
                  }}
                >
                  <PencilIcon 
                    color="#111" 
                    style={{ marginRight: "0.5rem", display: "inline-block", verticalAlign: "middle" }} 
                  />
                  New Chat
                </button>
                <button
                  onClick={handleNewDashboard}
                  style={{
                    border: "none",
                    padding: "0.5rem 0.75rem",
                    borderRadius: "8px",
                    background: "#f3f4f6",
                    color: "#111",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: "0.9rem",
                    display: "flex",
                    alignItems: "center",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#e5e7eb";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "#f3f4f6";
                  }}
                >
                  <DashboardIcon 
                    color="#111" 
                    style={{ marginRight: "0.5rem", display: "inline-block", verticalAlign: "middle" }} 
                  />
                  New Dashboard
                </button>
              </div>

              <div
                style={{
                  height: "1px",
                  background: "#e5e7eb",
                  margin: "0.5rem 0",
                }}
              />
            </>
          )}

          {/* Icon-only buttons when collapsed - includes expander, new chat, and new dashboard */}
          {isSidebarCollapsed && (
            <>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                  marginTop: "1rem",
                  alignItems: "center",
                }}
              >
                <button
                  onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                  style={{
                    border: "none",
                    padding: "0.5rem",
                    borderRadius: "8px",
                    background: "#e5e7eb",
                    color: "#111",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "background 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#d1d5db";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "#e5e7eb";
                  }}
                  title="Expand sidebar"
                >
                  <ChevronRightIcon color="#111" />
                </button>
                <button
                  onClick={handleNewChat}
                  style={{
                    border: "none",
                    padding: "0.5rem",
                    borderRadius: "8px",
                    background: "#f3f4f6",
                    color: "#111",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#e5e7eb";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "#f3f4f6";
                  }}
                  title="New Chat"
                >
                  <PencilIcon 
                    color="#111" 
                    style={{ display: "inline-block", verticalAlign: "middle" }} 
                  />
                </button>
                <button
                  onClick={handleNewDashboard}
                  style={{
                    border: "none",
                    padding: "0.5rem",
                    borderRadius: "8px",
                    background: "#f3f4f6",
                    color: "#111",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#e5e7eb";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "#f3f4f6";
                  }}
                  title="New Dashboard"
                >
                  <DashboardIcon 
                    color="#111" 
                    style={{ display: "inline-block", verticalAlign: "middle" }} 
                  />
                </button>
              </div>

              <div
                style={{
                  height: "1px",
                  background: "#e5e7eb",
                  margin: "0.5rem 0",
                }}
              />
            </>
          )}
        </div>

        {/* Scrollable middle section - Chats and Dashboards */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            overflowX: "hidden",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            minHeight: 0,
            marginTop: "1rem",
          }}
        >
          {!isSidebarCollapsed ? (
            <>
              <SidebarSection
                title="Chats"
                items={[]}
                onConversationSelect={handleConversationSelect}
                selectedConversationId={selectedConversationId}
                refreshTrigger={sidebarRefreshTrigger}
                isExpanded={isChatsExpanded}
                onExpandedChange={setIsChatsExpanded}
                activeDeepResearchConversations={activeDeepResearchConversations}
              />
              <SidebarSection
                title="Dashboards"
                items={[]}
                itemsWithIds={[]}
                onConversationSelect={handleDashboardSelect}
                selectedConversationId={selectedDashboardId}
                onDashboardRename={handleDashboardRename}
                onDashboardDelete={handleDashboardDelete}
                onDashboardsUpdate={(dashs) => {
                  // Sync SidebarSection's fetched dashboards with App.tsx state
                  setDashboards(dashs);
                }}
                refreshTrigger={dashboardRefreshTrigger}
                isExpanded={isDashboardsExpanded}
                onExpandedChange={setIsDashboardsExpanded}
              />
            </>
          ) : (
            <>
              <SidebarSection
                title=""
                items={[]}
                onConversationSelect={handleConversationSelect}
                selectedConversationId={selectedConversationId}
                refreshTrigger={sidebarRefreshTrigger}
                isExpanded={false}
                onExpandedChange={setIsChatsExpanded}
                isCollapsed={true}
                activeDeepResearchConversations={activeDeepResearchConversations}
              />
              <SidebarSection
                title=""
                items={[]}
                itemsWithIds={[]}
                onConversationSelect={handleDashboardSelect}
                selectedConversationId={selectedDashboardId}
                onDashboardRename={handleDashboardRename}
                onDashboardDelete={handleDashboardDelete}
                onDashboardsUpdate={(dashs) => {
                  // Sync SidebarSection's fetched dashboards with App.tsx state
                  setDashboards(dashs);
                }}
                refreshTrigger={dashboardRefreshTrigger}
                isExpanded={false}
                onExpandedChange={setIsDashboardsExpanded}
                isCollapsed={true}
              />
            </>
          )}
        </div>

        {/* Fixed bottom section - User info and logout */}
        {!isSidebarCollapsed && (
          <div
            style={{
              flexShrink: 0,
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.5rem",
              marginTop: "1rem",
              marginBottom: "2rem",
            }}
          >
            <div 
              style={{ 
                fontSize: "0.875rem", 
                color: "#111", 
                fontWeight: "500",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
                minWidth: 0,
              }}>
              {currentUser.displayName || currentUser.email}
            </div>
            <button
              onClick={logout}
              style={{
                border: "none",
                padding: "0.5rem",
                borderRadius: "6px",
                background: "transparent",
                color: "#111",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 0.2s ease",
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#e5e7eb";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
              title="Sign Out"
            >
              <LogoutIcon color="#111" width="1.25em" height="1.25em" />
            </button>
          </div>
        )}
      </div>

      {/* ---------- Main Content Area ---------- */}
      {selectedDashboardId ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: isSidebarCollapsed ? "calc(100% - 60px)" : "calc(100% - 250px)",
            height: "100vh",
            overflow: "hidden",
            background: "#fff",
            transition: "width 0.2s ease",
          }}
        >
          <Dashboard
            dashboardId={selectedDashboardId}
            title={dashboards.find((d) => d.id === selectedDashboardId)?.title || "New Dashboard"}
            onTitleChange={(newTitle) => handleDashboardTitleChange(selectedDashboardId, newTitle)}
          />
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "60%",
            minWidth: "320px",
            height: "92vh",
            borderRadius: "8px",
            overflow: "hidden",
            background: "#fff",
            margin: "auto", // centers the chat box vertically + horizontally
          }}
        >
          <Chat 
            messages={messages} 
            isLoading={isLoading} 
            loadingAction={loadingAction} 
            isLoadingConversation={isLoadingConversation}
            selectedConversationId={selectedConversationId}
            activeDeepResearchConversations={activeDeepResearchConversations}
          />
          <MessageInput 
            onSend={addMessage} 
            updateLastMessage={updateLastMessage} 
            messages={messages} 
            onLoadingChange={handleLoadingChange}
            selectedConversationId={selectedConversationId}
            setSelectedConversationId={setSelectedConversationId}
            setDeepResearchActive={setDeepResearchActive}
            setDeepResearchInactive={setDeepResearchInactive}
          />
        </div>
      )}
    </div>
  );
}

export default App;
