import { useState, useEffect, useRef } from "react";
import { type Message } from "../App";
import DashboardChat from "./DashboardChat";
import DashboardMessageInput from "./DashboardMessageInput";
import { ChevronRightIcon, ChevronLeftIcon, ChevronDownIcon, XIcon } from "../icons";

interface FigureData {
  dashboard_id: string;
  figure_id: string;
  title: string;
  figure?: any;
  table?: any;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

interface Props {
  isCollapsed: boolean;
  onCollapseChange: (collapsed: boolean) => void;
  selectedFigureId: string | null;
  onSelectedFigureChange: (id: string | null) => void;
  figures: FigureData[];
  onFigureUpdate: (id: string, figure: any, table: any, code?: string | null, dataset?: string | null) => void;
}

export default function DashboardSidebar({ isCollapsed, onCollapseChange, selectedFigureId, onSelectedFigureChange, figures, onFigureUpdate }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('dashboardSidebarWidth');
    return saved ? parseInt(saved, 10) : 400;
  });
  const [isResizing, setIsResizing] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Save sidebar width to localStorage when it changes
  useEffect(() => {
    if (!isCollapsed) {
      localStorage.setItem('dashboardSidebarWidth', sidebarWidth.toString());
    }
  }, [sidebarWidth, isCollapsed]);

  // Handle sidebar resize
  useEffect(() => {
    if (!isResizing) {
      // Remove cursor style when not resizing
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      return;
    }

    // Set cursor and prevent text selection during resize
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      const minWidth = 300;
      const maxWidth = 800;
      const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
      setSidebarWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    if (isDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [isDropdownOpen]);

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

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        width: isCollapsed ? "60px" : `${sidebarWidth}px`,
        height: "100vh",
        background: "#fff",
        borderLeft: "1px solid #e5e7eb",
        display: "flex",
        flexDirection: "column",
        zIndex: 1000,
        boxShadow: "-4px 0 6px -1px rgba(0, 0, 0, 0.1)",
        transition: isResizing ? "none" : "width 0.3s ease",
      }}
    >
      {isCollapsed ? (
        /* Collapsed State */
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "1rem 0",
            gap: "1rem",
            height: "100%",
          }}
        >
          <button
            onClick={() => onCollapseChange(false)}
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              padding: "0.5rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "4px",
              color: "#6b7280",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#e5e7eb";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
            title="Expand sidebar"
          >
            <ChevronLeftIcon color="#6b7280" width="1.5em" height="1.5em" />
          </button>
        </div>
      ) : (
        /* Expanded State */
        <>
          {/* Header */}
          <div
            style={{
              padding: "1rem",
              borderBottom: "1px solid #e5e7eb",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "#f9fafb",
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: "1rem",
                fontWeight: 600,
                color: "#111",
              }}
            >
              Create Figure
            </h2>
            <button
              onClick={() => onCollapseChange(true)}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                padding: "0.25rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "4px",
                color: "#6b7280",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#e5e7eb";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
              title="Collapse sidebar"
            >
              <ChevronRightIcon color="#6b7280" width="1.25em" height="1.25em" />
            </button>
          </div>

          {/* Figure Selection Dropdown */}
          <div
            style={{
              padding: "1rem",
              borderBottom: "1px solid #e5e7eb",
              background: "#fff",
            }}
          >
            <div
              ref={dropdownRef}
              style={{
                position: "relative",
                width: "100%",
              }}
            >
              <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  borderRadius: "6px",
                  border: "1px solid #d1d5db",
                  background: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  color: "#111",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "#9ca3af";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "#d1d5db";
                }}
              >
                <span>
                  {selectedFigureId
                    ? figures.find((f) => f.figure_id === selectedFigureId)?.title || "Select a figure"
                    : "Select a figure"}
                </span>
                <ChevronDownIcon
                  color="#6b7280"
                  width="1em"
                  height="1em"
                  style={{
                    transform: isDropdownOpen ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.2s ease",
                  }}
                />
              </button>
              {isDropdownOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    marginTop: "0.25rem",
                    background: "#fff",
                    border: "1px solid #d1d5db",
                    borderRadius: "6px",
                    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                    zIndex: 100,
                    maxHeight: "200px",
                    overflowY: "auto",
                  }}
                >
                  {figures.length === 0 ? (
                    <div
                      style={{
                        padding: "0.75rem",
                        color: "#6b7280",
                        fontSize: "0.875rem",
                        textAlign: "center",
                      }}
                    >
                      No figures available
                    </div>
                  ) : (
                    figures.map((figure) => (
                      <button
                        key={figure.figure_id}
                        onClick={() => {
                          onSelectedFigureChange(figure.figure_id);
                          setIsDropdownOpen(false);
                        }}
                        style={{
                          width: "100%",
                          padding: "0.75rem",
                          border: "none",
                          background: selectedFigureId === figure.figure_id ? "#f3f4f6" : "#fff",
                          textAlign: "left",
                          cursor: "pointer",
                          fontSize: "0.875rem",
                          color: "#111",
                          borderBottom: "1px solid #f3f4f6",
                        }}
                        onMouseEnter={(e) => {
                          if (selectedFigureId !== figure.figure_id) {
                            e.currentTarget.style.background = "#f9fafb";
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (selectedFigureId !== figure.figure_id) {
                            e.currentTarget.style.background = "#fff";
                          }
                        }}
                      >
                        {figure.title}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Selected Figure Display */}
            {selectedFigureId && (
              <div
                style={{
                  marginTop: "0.75rem",
                  padding: "0.5rem 0.75rem",
                  background: "#f3f4f6",
                  borderRadius: "6px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span
                  style={{
                    fontSize: "0.875rem",
                    fontWeight: 500,
                    color: "#111",
                  }}
                >
                  Editing: {figures.find((f) => f.figure_id === selectedFigureId)?.title || ""}
                </span>
                <button
                  onClick={() => onSelectedFigureChange(null)}
                  style={{
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    padding: "0.25rem",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: "4px",
                    color: "#6b7280",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#e5e7eb";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                  title="Stop editing this figure"
                >
                  <XIcon color="#6b7280" width="1em" height="1em" />
                </button>
              </div>
            )}
          </div>

          {/* Chat Area */}
          <DashboardChat 
            messages={messages} 
            isLoading={isLoading} 
            loadingAction={loadingAction}
            selectedFigureId={selectedFigureId}
          />

          {/* Message Input */}
          <DashboardMessageInput
            onSend={addMessage}
            updateLastMessage={updateLastMessage}
            messages={messages}
            onLoadingChange={handleLoadingChange}
            selectedFigureId={selectedFigureId}
            onFigureUpdate={onFigureUpdate}
            selectedDataset={selectedDataset}
            setSelectedDataset={setSelectedDataset}
          />
        </>
      )}

      {/* Resize Handle */}
      {!isCollapsed && (
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            setIsResizing(true);
          }}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: "6px",
            cursor: "ew-resize",
            backgroundColor: isResizing ? "#3b82f6" : "transparent",
            zIndex: 1001,
            transition: "background-color 0.15s ease",
            pointerEvents: "auto",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.cursor = "ew-resize";
            if (!isResizing) {
              e.currentTarget.style.backgroundColor = "#3b82f6";
            }
          }}
          onMouseLeave={(e) => {
            if (!isResizing) {
              e.currentTarget.style.backgroundColor = "transparent";
            }
          }}
        />
      )}
    </div>
  );
}
