import { useState, useRef, useEffect } from "react";
import { 
  sendFigureMessage, 
  sendWorldMapMessage,
  getDatasets,
} from "../api";
import { type Message } from "../App";
import { SendIcon, PlusIcon, XIcon } from "../icons";
import { ensureSandboxActive } from "../utils/sandbox";
import { parseResponseObjects } from "../utils/responseParser";
import { logger } from "../utils/logger";

interface Props {
  onSend: (message: Message) => void;
  updateLastMessage: (updater: (message: Message) => Message) => void;
  messages: Message[] | [];
  onLoadingChange: (isLoading: boolean, action: string | null) => void;
  selectedFigureId: string | null;
  onFigureUpdate: (id: string, figure: any, table: any, code?: string | null, dataset?: string | null) => void;
  selectedDataset: string | null;
  setSelectedDataset: (dataset: string | null) => void;
}

//const ACTIONS = [
//  "World Map (Flow Map)",
//  "World Map (Bubble Chart)",
//];

export default function DashboardMessageInput({ onSend, updateLastMessage, messages, onLoadingChange, selectedFigureId, onFigureUpdate, selectedDataset, setSelectedDataset }: Props) {
  const [text, setText] = useState("");
  //const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [showDatasetMenu, setShowDatasetMenu] = useState(false);
  const [showDatasetReminder, setShowDatasetReminder] = useState(false);
  const [datasets, setDatasets] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);
  const currentAssistantMessageRef = useRef<Message | null>(null);
  const datasetMenuRef = useRef<HTMLDivElement>(null);
  const plusButtonRef = useRef<HTMLButtonElement>(null);

  // Fetch datasets on component mount
  useEffect(() => {
    const fetchDatasets = async () => {
      try {
        const fetchedDatasets = await getDatasets();
        setDatasets(fetchedDatasets);
      } catch (error) {
        logger.error("Failed to fetch datasets:", error);
        // Fallback to empty array if fetch fails
        setDatasets([]);
      }
    };
    fetchDatasets();
  }, []);

  // Close dataset menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        datasetMenuRef.current &&
        !datasetMenuRef.current.contains(event.target as Node) &&
        plusButtonRef.current &&
        !plusButtonRef.current.contains(event.target as Node)
      ) {
        setShowDatasetMenu(false);
      }
    };

    if (showDatasetMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [showDatasetMenu]);
  
  // Helper function to save assistant message (if needed in future)
  const saveAssistantMessage = async (_message: Message) => {
    // TODO: Implement if needed for dashboard messages
  };
  
  async function handleSend() {
    if (text.trim() === "" || !selectedFigureId || isSending) return;
    if (!selectedDataset) {
      // Show gentle reminder message
      setShowDatasetReminder(true);
      setTimeout(() => setShowDatasetReminder(false), 3000); // Hide after 3 seconds
      return;
    }

    setIsSending(true);
    const userMessage: Message = { role: "user", content: text, response_type: "text" };
    onSend(userMessage);

    const userInput = text;
    const currentAction = ''; //selectedAction;
    // Capture the selected figure ID at the start of the request to ensure
    // the figure is updated correctly even if the user switches figures mid-request
    const targetFigureId = selectedFigureId;
    setText("");

    // Set loading immediately so the loading indicator appears right after user message
    onLoadingChange(true, currentAction || null);

    // Determine if we should use World Map
    const WorldMap = currentAction && ["World Map (Flow Map)", "World Map (Bubble Chart)"].includes(currentAction);

    try {
      // Check if sandbox is active, if not, start it and show "Starting sandbox"
      try {
        await ensureSandboxActive({ onLoadingChange, showAlert: true });
      } catch (error: any) {
        // Error already handled by ensureSandboxActive with alert
        return;
      }
      
      const messageHistory = [...messages.map(m => ({ role: m.role, content: m.content })), { role: "user", content: userInput }];
      
      if (WorldMap) {
        // World Map: use sendWorldMapMessage
        const response = await sendWorldMapMessage(messageHistory, currentAction);
        
        // Parse response objects
        const { figures, tables, other_results } = parseResponseObjects(response);
        const code = response.code || response.text || null;
        
        // Update figure if we have a selected figure ID (use the captured value)
        if (targetFigureId) {
          // Priority: first figure > first table
          const firstFigure = figures.length > 0 ? figures[0] : null;
          const firstTable = tables.length > 0 ? tables[0] : (response.tables && response.tables.length > 0 ? response.tables[0] : null);
          onFigureUpdate(targetFigureId, firstFigure, firstFigure ? null : firstTable, code, selectedDataset);
        }
        
        const assistantMessage: Message = { 
          role: "assistant", 
          content: code || "",
          response_type: "code",
          figures: figures,
          tables: tables.length > 0 ? tables : (response.tables || []),
          other_results: other_results.length > 0 ? other_results : (response.other_results || []),
          code: code,
          isComplete: true
        };
        currentAssistantMessageRef.current = { ...assistantMessage };
        onSend(assistantMessage);
        await saveAssistantMessage(assistantMessage);
      } else {
        // Default: use sendFigureMessage
        // Create assistant message immediately with empty content
        const assistantMessage: Message = {
          role: "assistant",
          content: "",
          response_type: "code",
          isComplete: false
        };
        currentAssistantMessageRef.current = { ...assistantMessage };
        onSend(assistantMessage);
        
        const response = await sendFigureMessage(messageHistory, selectedDataset);
        
        // Parse response objects
        const { figures, tables, other_results } = parseResponseObjects(response);
        const code = response.code || response.text || null;
        
        // Update figure if we have a selected figure ID (use the captured value)
        if (targetFigureId) {
          // Priority: first figure > first table
          const firstFigure = figures.length > 0 ? figures[0] : null;
          const firstTable = tables.length > 0 ? tables[0] : (response.tables && response.tables.length > 0 ? response.tables[0] : null);
          onFigureUpdate(targetFigureId, firstFigure, firstFigure ? null : firstTable, code, selectedDataset);
        }
        
        // Update the assistant message with the response
        if (currentAssistantMessageRef.current) {
          currentAssistantMessageRef.current.content = code || "";
          currentAssistantMessageRef.current.response_type = response.response_type || "code";
          currentAssistantMessageRef.current.figures = figures;
          currentAssistantMessageRef.current.tables = tables.length > 0 ? tables : (response.tables || []);
          currentAssistantMessageRef.current.other_results = other_results.length > 0 ? other_results : (response.other_results || []);
          currentAssistantMessageRef.current.code = code;
          currentAssistantMessageRef.current.isComplete = true;
        }
        
        updateLastMessage((msg) => ({
          ...msg,
          content: code || "",
          response_type: response.response_type || "code",
          figures: figures,
          tables: tables.length > 0 ? tables : (response.tables || []),
          other_results: other_results.length > 0 ? other_results : (response.other_results || []),
          code: code,
          isComplete: true
        }));
        
        await saveAssistantMessage(currentAssistantMessageRef.current!);
      }
    } catch (error) {
      // Handle errors
      const lastMessage = messages[messages.length - 1];
      if (lastMessage && !lastMessage.isComplete && currentAssistantMessageRef.current) {
        // Update existing incomplete message with error
        if (currentAssistantMessageRef.current) {
          currentAssistantMessageRef.current.content = `Error: Failed to get response from server${error instanceof Error ? `: ${error.message}` : ''}`;
          currentAssistantMessageRef.current.response_type = "error";
          currentAssistantMessageRef.current.isComplete = true;
        }
        updateLastMessage((msg) => ({
          ...msg,
          content: `Error: Failed to get response from server${error instanceof Error ? `: ${error.message}` : ''}`,
          response_type: "error",
          isComplete: true
        }));
      } else {
        // Create new error message
        const errorMessage: Message = { 
          role: "assistant", 
          content: `Error: Failed to get response from server${error instanceof Error ? `: ${error.message}` : ''}`,
          response_type: "error",
          isComplete: true
        };
        onSend(errorMessage);
      }
    } finally {
      onLoadingChange(false, null);
      setIsSending(false);
    }
  }

  return (
    <div
      style={{
        padding: "0.75rem",
        borderTop: "1px solid #e5e7eb",
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.375rem"
        }}
      >
        {/*ACTIONS.map((action) => {
          const isSelected = selectedAction === action;
          return (
            <button
              key={action}
              type="button"
              onClick={() => {
                setSelectedAction(isSelected ? null : action);
              }}
              disabled={!selectedFigureId}
              style={{
                borderRadius: "6px",
                border: isSelected ? "1px solid #111" : "1px solid #d2d6db",
                background: !selectedFigureId ? "#f3f4f6" : isSelected ? "#111" : "#fff",
                color: !selectedFigureId ? "#9ca3af" : isSelected ? "#fff" : "#111",
                padding: "0.3rem 0.6rem",
                fontSize: "0.75rem",
                cursor: !selectedFigureId ? "not-allowed" : "pointer",
                transition: "all 0.2s ease",
                opacity: !selectedFigureId ? 0.6 : 1,
              }}
            >
              {action}
            </button>
          );
        })}*/}
      </div>

      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          alignItems: "flex-start",
          position: "relative"
        }}
      >
        <div style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column" }}>
          <div style={{ position: "relative", display: "flex", alignItems: "flex-start" }}>
            <button
              ref={plusButtonRef}
              type="button"
              onClick={() => setShowDatasetMenu(!showDatasetMenu)}
              disabled={!selectedFigureId}
              style={{
                position: "absolute",
                left: "0.5rem",
                top: "0.5rem",
                height: "1.25rem",
                width: "1.25rem",
                borderRadius: "4px",
                border: "1px solid #d2d6db",
                background: !selectedFigureId ? "#f3f4f6" : "#fff",
                color: !selectedFigureId ? "#9ca3af" : "#111",
                cursor: !selectedFigureId ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0",
                transition: "all 0.2s ease",
                zIndex: 1
              }}
              onMouseEnter={(e) => {
                if (selectedFigureId) {
                  e.currentTarget.style.backgroundColor = "#f3f4f6";
                }
              }}
              onMouseLeave={(e) => {
                if (selectedFigureId) {
                  e.currentTarget.style.backgroundColor = "#fff";
                }
              }}
            >
              <PlusIcon 
                width="12" 
                height="12" 
                color="currentColor"
              />
            </button>
            {showDatasetMenu && selectedFigureId && (
              <div
                ref={datasetMenuRef}
                style={{
                  position: "absolute",
                  bottom: "100%",
                  left: 0,
                  marginBottom: "0.5rem",
                  background: "#fff",
                  border: "1px solid #d2d6db",
                  borderRadius: "8px",
                  boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
                  zIndex: 1000,
                  minWidth: "150px",
                  padding: "0.5rem 0"
                }}
              >
                {datasets.map((dataset) => (
                  <button
                    key={dataset}
                    type="button"
                    onClick={() => {
                      setSelectedDataset(dataset);
                      setShowDatasetMenu(false);
                    }}
                    style={{
                      width: "100%",
                      padding: "0.5rem 1rem",
                      textAlign: "left",
                      border: "none",
                      background: "transparent",
                      color: "#111",
                      cursor: "pointer",
                      fontSize: "0.9rem",
                      transition: "background-color 0.2s"
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = "#f3f4f6";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "transparent";
                    }}
                  >
                    {dataset}
                  </button>
                ))}
              </div>
            )}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={!selectedFigureId}
              placeholder={
                !selectedFigureId
                  ? "Please select a figure to edit"
                  //: selectedAction
                  //? `Ask with "${selectedAction}"...`
                  : "Ask anything..."
              }
              style={{
                flex: 1,
                padding: selectedDataset ? "0.5rem 0.75rem 2rem 2.25rem" : "0.5rem 0.75rem 0.5rem 2.25rem",
                borderRadius: "6px",
                border: "1px solid #d2d6db",
                fontSize: "0.875rem",
                background: !selectedFigureId ? "#f3f4f6" : "#fff",
                resize: "vertical",
                minHeight: "2rem",
                maxHeight: "6rem",
                fontFamily: "inherit",
                cursor: !selectedFigureId ? "not-allowed" : "text",
                color: !selectedFigureId ? "#9ca3af" : "#111",
              }}
            />
            {selectedDataset && (
              <div
                style={{
                  position: "absolute",
                  bottom: "0.375rem",
                  left: "0.5rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.375rem",
                  pointerEvents: "auto",
                  zIndex: 2
                }}
              >
                <span style={{ color: "#3b82f6", fontSize: "0.8rem", fontWeight: 500 }}>
                  {selectedDataset}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedDataset(null);
                  }}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#3b82f6",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0.25rem"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = "0.7";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = "1";
                  }}
                >
                  <XIcon width="12" height="12" color="currentColor" />
                </button>
              </div>
            )}
          </div>
          {showDatasetReminder && (
            <div
              style={{
                marginTop: "0.375rem",
                marginLeft: "0.5rem",
                padding: "0.4rem 0.6rem",
                background: "#fef3c7",
                border: "1px solid #fbbf24",
                borderRadius: "6px",
                fontSize: "0.75rem",
                color: "#92400e",
                alignSelf: "flex-start"
              }}
            >
              Please select a dataset before sending your message.
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleSend}
          disabled={!selectedFigureId || !selectedDataset || isSending}
          style={{
            height: "2rem",
            width: "2rem",
            borderRadius: "50%",
            border: "none",
            background: (!selectedFigureId || !selectedDataset || isSending) ? "#d1d5db" : "#111827",
            color: "#fff",
            cursor: (!selectedFigureId || !selectedDataset || isSending) ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0.4rem",
            flexShrink: 0,
            opacity: (!selectedFigureId || !selectedDataset || isSending) ? 0.6 : 1,
            marginTop: "0.25rem"
          }}
        >
          <SendIcon 
            width="100%" 
            height="100%" 
            color="currentColor"
            style={{ height: "100%", width: "100%" }}
          />
        </button>
      </div>
    </div>
  );
}
