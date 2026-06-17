import { useState, useRef, useEffect } from "react";
import { 
  sendStreamingMessage, 
  sendQuantitativeStreamingMessage, 
  sendWorldMapMessage, 
  sendMessage, 
  sendDeepResearchMessage, 
  createConversation, 
  addMessageToConversation,
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
  selectedConversationId: string | null;
  setSelectedConversationId: (id: string | null) => void;
  setDeepResearchActive: (conversationId: string | null) => void;
  setDeepResearchInactive: (conversationId: string | null) => void;
}

const ACTIONS = [
  "Charts/Tables/Stats",
  "Web Search",
  //"World Map (Flow Map)",
  //"World Map (Bubble Chart)",
  "Deep Research"
];

export default function MessageInput({ onSend, updateLastMessage, messages, onLoadingChange, selectedConversationId, setSelectedConversationId, setDeepResearchActive, setDeepResearchInactive }: Props) {
  const [text, setText] = useState("");
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);
  const [showDatasetMenu, setShowDatasetMenu] = useState(false);
  const [showDatasetReminder, setShowDatasetReminder] = useState(false);
  const [datasets, setDatasets] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);
  const currentAssistantMessageRef = useRef<Message | null>(null);
  const currentConversationIdRef = useRef<string | null>(null);
  const isNewConversationRef = useRef<boolean>(false);
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
    
  // Helper function to save assistant message to the database
  const saveAssistantMessageToDatabase = async (message: Message) => {
    try {
      const conversationId = currentConversationIdRef.current;
      if (conversationId) {
        // Ensure deep research messages always have role "assistant"
        const messageToSave = {
          ...message,
          role: message.isDeepResearch ? "assistant" : message.role
        };
        // Conversation exists, add assistant message to it
        await addMessageToConversation(conversationId, messageToSave);
      }
      // If no conversation exists, assistant message will be saved when conversation is created
    } catch (error) {
      logger.error("Failed to save assistant message to database:", error);
      // Don't show alert to user, just log the error
    }
  };

  async function handleSend() {
    if (text.trim() === "" || isSending) return;
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
    const currentAction = selectedAction;
    setText("");

    // Set loading immediately so the loading indicator appears right after user message
    onLoadingChange(true, currentAction);
    
    // Determine if we should use streaming
    const shouldStream = !currentAction || currentAction === "Web Search";
    const useQuantitativeStream = currentAction === "Charts/Tables/Stats";
    const WorldMap = currentAction && ["World Map (Flow Map)", "World Map (Bubble Chart)"].includes(currentAction);
    const isDeepResearch = currentAction === "Deep Research";
    
    // Track the current conversation ID (use ref to avoid async state issues and make it accessible in callbacks)
    currentConversationIdRef.current = selectedConversationId;
    
    try {
      // Handle conversation creation/updating based on whether conversation exists
      if (!currentConversationIdRef.current) {
        // New conversation: create it with all messages including the new user message
        try {
          const allMessages = [...messages, userMessage];
          const conversationId = await createConversation(allMessages);
          currentConversationIdRef.current = conversationId;
          setSelectedConversationId(conversationId);
          
          // Mark this as a new conversation so we refresh after assistant message
          isNewConversationRef.current = true;
          
          // Note: The conversation is now highlighted because selectedConversationId is set
        } catch (error) {
          logger.error("Failed to create conversation:", error);
          // Continue anyway - user can still see the message
        }
      } else {
        // Reset flag for existing conversations
        isNewConversationRef.current = false;
        // Existing conversation: 
        // 1. FIRST: Check if sandbox is active (calls /sandbox_running)
        try {
          await ensureSandboxActive({ onLoadingChange, showAlert: true });
        } catch (error: any) {
          // Error already handled by ensureSandboxActive with alert
          return;
        }
        
        // 2. SECOND: Add user message to conversation
        try {
          await addMessageToConversation(currentConversationIdRef.current, userMessage);
        } catch (error) {
          logger.error("Failed to add user message to conversation:", error);
          // Continue anyway - user can still see the message
        }

      }
      
      // For new conversations, check sandbox after creating conversation
      if (!currentConversationIdRef.current) {
        // Check if sandbox is active, if not, start it and show "Starting sandbox"
        try {
          await ensureSandboxActive({ onLoadingChange, showAlert: true });
        } catch (error: any) {
          // Error already handled by ensureSandboxActive with alert
          return;
        }
      }
      
      // Start loading with the actual action (only if sandbox was already active, or after starting it)
      onLoadingChange(true, currentAction);
      
      const messageHistory = [...messages.map(m => ({ role: m.role, content: m.content })), { role: "user", content: userInput }];
      
      if (useQuantitativeStream) {
        // Use quantitative streaming for Code action
        // Create assistant message immediately with empty content
        const assistantMessage: Message = { 
          role: "assistant", 
          content: "",
          response_type: "code",
          figures: [],
          tables: [],
          other_results: [],
          code: null,
          isComplete: false
        };
        currentAssistantMessageRef.current = { ...assistantMessage };
        onSend(assistantMessage);
        
        // Stream the quantitative response
        let accumulatedContent = "";
        await sendQuantitativeStreamingMessage(
          messageHistory,
          (metadata) => {
            // Update message with metadata (figures, tables, other_results)
            if (currentAssistantMessageRef.current) {
              currentAssistantMessageRef.current.figures = metadata.figures || [];
              currentAssistantMessageRef.current.tables = metadata.tables || [];
              currentAssistantMessageRef.current.other_results = metadata.other_results || [];
              currentAssistantMessageRef.current.code = metadata.code || null;
            }
            updateLastMessage((msg) => ({
              ...msg,
              figures: metadata.figures || [],
              tables: metadata.tables || [],
              other_results: metadata.other_results || [],
              code: metadata.code || null
            }));
          },
          (chunk: string) => {
            // Accumulate text chunks
            accumulatedContent += chunk;
            if (currentAssistantMessageRef.current) {
              currentAssistantMessageRef.current.content = accumulatedContent;
            }
            updateLastMessage((msg) => ({
              ...msg,
              content: accumulatedContent
            }));
          },
          (error: string) => {
            // Handle error
            if (currentAssistantMessageRef.current) {
              currentAssistantMessageRef.current.content = `Error: ${error}`;
              currentAssistantMessageRef.current.response_type = "text";
              currentAssistantMessageRef.current.isComplete = true;
            }
            updateLastMessage((msg) => ({
              ...msg,
              content: `Error: ${error}`,
              response_type: "text",
              isComplete: true
            }));
            // Save error message to database
            if (currentAssistantMessageRef.current) {
              saveAssistantMessageToDatabase(currentAssistantMessageRef.current);
            }
          },
          () => {
            // Stream complete - mark message as complete
            if (currentAssistantMessageRef.current) {
              currentAssistantMessageRef.current.isComplete = true;
              saveAssistantMessageToDatabase(currentAssistantMessageRef.current);
            }
            updateLastMessage((msg) => ({
              ...msg,
              isComplete: true
            }));
          },
          selectedDataset
        );
      } else if (isDeepResearch) {
        // Use deep research streaming for Deep Research action
        // Create assistant message immediately with empty content
        const assistantMessage: Message = { 
          role: "assistant", 
          content: "",
          response_type: "text",
          isComplete: false,
          isDeepResearch: true,
          progress: ""
        };
        currentAssistantMessageRef.current = { ...assistantMessage };
        onSend(assistantMessage);
        
        // Set the deep research flag as active for this conversation
        setDeepResearchActive(currentConversationIdRef.current);
        
        // Don't save the initial empty message - wait for content before saving
        // The message will be saved when clarification question, final report, or error arrives
        
        try {
          // Stream the deep research response
          await sendDeepResearchMessage(
            messageHistory,
            (progress: string) => {
              // Update progress text
              if (currentAssistantMessageRef.current) {
                currentAssistantMessageRef.current.role = "assistant"; // Ensure role is assistant
                currentAssistantMessageRef.current.progress = progress;
              }
              updateLastMessage((msg) => ({
                ...msg,
                role: "assistant", // Ensure role is assistant
                progress: progress
              }));
            },
            (clarificationQuestion: string) => {
              // Update with clarification question - deep research is complete
              if (currentAssistantMessageRef.current) {
                currentAssistantMessageRef.current.role = "assistant"; // Ensure role is assistant
                currentAssistantMessageRef.current.content = clarificationQuestion;
                currentAssistantMessageRef.current.progress = undefined;
                currentAssistantMessageRef.current.isComplete = true;
                saveAssistantMessageToDatabase(currentAssistantMessageRef.current);
              }
              updateLastMessage((msg) => ({
                ...msg,
                role: "assistant", // Ensure role is assistant
                content: clarificationQuestion,
                progress: undefined, // Clear progress when clarification question arrives
                isComplete: true
              }));
              // Clear the deep research flag
              setDeepResearchInactive(currentConversationIdRef.current);
            },
            (finalReport: string) => {
              // Update with final report - deep research is complete
              if (currentAssistantMessageRef.current) {
                currentAssistantMessageRef.current.role = "assistant"; // Ensure role is assistant
                currentAssistantMessageRef.current.content = finalReport;
                currentAssistantMessageRef.current.progress = undefined;
                currentAssistantMessageRef.current.isComplete = true;
                saveAssistantMessageToDatabase(currentAssistantMessageRef.current);
              }
              updateLastMessage((msg) => ({
                ...msg,
                role: "assistant", // Ensure role is assistant
                content: finalReport,
                progress: undefined, // Clear progress when final report arrives
                isComplete: true
              }));
              // Clear the deep research flag
              setDeepResearchInactive(currentConversationIdRef.current);
            },
            (error: string) => {
              // Handle error from stream - deep research is complete (with error)
              if (currentAssistantMessageRef.current) {
                currentAssistantMessageRef.current.role = "assistant"; // Ensure role is assistant
                currentAssistantMessageRef.current.content = `Error: ${error}`;
                currentAssistantMessageRef.current.progress = undefined;
                currentAssistantMessageRef.current.isComplete = true;
                saveAssistantMessageToDatabase(currentAssistantMessageRef.current);
              }
              updateLastMessage((msg) => ({
                ...msg,
                role: "assistant", // Ensure role is assistant
                content: `Error: ${error}`,
                progress: undefined,
                isComplete: true
              }));
              // Clear the deep research flag
              setDeepResearchInactive(currentConversationIdRef.current);
            },
            () => {
              // Stream complete - ensure message is marked as complete
              // Only save if message has content (final report or clarification question should have already saved it)
              if (currentAssistantMessageRef.current && !currentAssistantMessageRef.current.isComplete) {
                currentAssistantMessageRef.current.role = "assistant"; // Ensure role is assistant
                currentAssistantMessageRef.current.isComplete = true;
                // Only save if there's content - don't save empty messages
                if (currentAssistantMessageRef.current.content && currentAssistantMessageRef.current.content.trim() !== "") {
                  saveAssistantMessageToDatabase(currentAssistantMessageRef.current);
                }
              }
              updateLastMessage((msg) => ({
                ...msg,
                role: "assistant", // Ensure role is assistant
                isComplete: true
              }));
              // Clear the deep research flag
              setDeepResearchInactive(currentConversationIdRef.current);
            },
            selectedDataset
          );
        } catch (deepResearchError) {
          // Handle exceptions from sendDeepResearchMessage (e.g., network errors)
          if (currentAssistantMessageRef.current) {
            currentAssistantMessageRef.current.role = "assistant"; // Ensure role is assistant
            currentAssistantMessageRef.current.content = `Error: Failed to get response from server${deepResearchError instanceof Error ? `: ${deepResearchError.message}` : ''}`;
            currentAssistantMessageRef.current.progress = undefined;
            currentAssistantMessageRef.current.isComplete = true;
            saveAssistantMessageToDatabase(currentAssistantMessageRef.current);
          }
          updateLastMessage((msg) => ({
            ...msg,
            role: "assistant", // Ensure role is assistant
            content: `Error: Failed to get response from server${deepResearchError instanceof Error ? `: ${deepResearchError.message}` : ''}`,
            progress: undefined,
            isComplete: true
          }));
          // Clear the deep research flag
          setDeepResearchInactive(currentConversationIdRef.current);
          // Re-throw to be caught by outer catch block for loading state cleanup
          throw deepResearchError;
        }
      } else if (WorldMap) {
        // Use world map for World Map (Flow Map) or World Map (Bubble Chart)
        const response = await sendWorldMapMessage(messageHistory, currentAction);
        
        // Parse response objects
        const { figures, tables, other_results } = parseResponseObjects(response);
        const code = response.code || response.text || null;
        
        const assistantMessage: Message = { 
          role: "assistant", 
          content: response.text || "",
          response_type: "code",
          figures: figures,
          tables: tables.length > 0 ? tables : (response.tables || []),
          other_results: other_results.length > 0 ? other_results : (response.other_results || []),
          code: code,
          isComplete: true
        };
        onSend(assistantMessage);
        // Save completed message to database
        await saveAssistantMessageToDatabase(assistantMessage);
      } else if (shouldStream) {
        // Use streaming for null selectedAction or "Web Search"
        const search = currentAction === "Web Search";
        
        // Create assistant message immediately with empty content
        const assistantMessage: Message = { 
          role: "assistant", 
          content: "",
          response_type: "text",
          isComplete: false
        };
        currentAssistantMessageRef.current = { ...assistantMessage };
        onSend(assistantMessage);
        
        // Stream the response and update the message content incrementally
        let accumulatedContent = "";
        await sendStreamingMessage(messageHistory, search, (chunk: string) => {
          accumulatedContent += chunk;
          if (currentAssistantMessageRef.current) {
            currentAssistantMessageRef.current.content = accumulatedContent;
          }
          // Update the last message (which should be the assistant message we just added)
          updateLastMessage((msg) => ({
            ...msg,
            content: accumulatedContent
          }));
        }, selectedDataset);
        
        // Mark message as complete after streaming finishes
        if (currentAssistantMessageRef.current) {
          currentAssistantMessageRef.current.isComplete = true;
          saveAssistantMessageToDatabase(currentAssistantMessageRef.current);
        }
        updateLastMessage((msg) => ({
          ...msg,
          isComplete: true
        }));
      } else {
        // Use non-streaming for other actions
        const response = await sendMessage(messageHistory, currentAction, selectedDataset);
        const assistantMessage: Message = { 
          role: "assistant", 
          content: response.text || "No response received",
          response_type: response.response_type || "text",
          isComplete: true // Non-streaming responses are immediately complete
        };
        onSend(assistantMessage);
        // Save completed message to database
        await saveAssistantMessageToDatabase(assistantMessage);
      }
    } catch (error) {
      // Check if the last message is an incomplete deep research message
      const lastMessage = messages[messages.length - 1];
      if (lastMessage && lastMessage.isDeepResearch && !lastMessage.isComplete) {
        // Update the existing deep research message to show error and clear progress
        if (currentAssistantMessageRef.current) {
          currentAssistantMessageRef.current.content = `Error: Failed to get response from server${error instanceof Error ? `: ${error.message}` : ''}`;
          currentAssistantMessageRef.current.progress = undefined;
          currentAssistantMessageRef.current.isComplete = true;
          saveAssistantMessageToDatabase(currentAssistantMessageRef.current);
        }
        updateLastMessage((msg) => ({
          ...msg,
          content: `Error: Failed to get response from server${error instanceof Error ? `: ${error.message}` : ''}`,
          progress: undefined,
          isComplete: true
        }));
      } else {
        // Create a new error message for other cases
        const errorMessage: Message = { 
          role: "assistant", 
          content: `Error: Failed to get response from server${error instanceof Error ? `: ${error.message}` : ''}`,
          response_type: "error",
          isComplete: true
        };
        onSend(errorMessage);
        // Save error message to database
        await saveAssistantMessageToDatabase(errorMessage);
      }
    } finally {
      onLoadingChange(false, null);
      setIsSending(false);
    }
  }

  return (
    <div
      style={{
        padding: "0rem 1.5rem",
        //borderTop: "1px solid #e5e7eb",
        background: "#fefefe",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem"
        }}
      >
        {ACTIONS.map((action) => {
          const isSelected = selectedAction === action;
          return (
            <button
              key={action}
              type="button"
              onClick={() => {
                setSelectedAction(isSelected ? null : action);
              }}
              style={{
                borderRadius: "8px",
                border: isSelected ? "1px solid #111" : "1px solid #d2d6db",
                background: isSelected ? "#111" : "#fff",
                color: isSelected ? "#fff" : "#111",
                padding: "0.4rem 0.9rem",
                fontSize: "0.85rem",
                cursor: "pointer",
                transition: "all 0.2s ease"
              }}
            >
              {action}
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          gap: "0.75rem",
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
              style={{
                position: "absolute",
                left: "0.75rem",
                top: "0.85rem",
                height: "1.5rem",
                width: "1.5rem",
                borderRadius: "4px",
                border: "1px solid #d2d6db",
                background: "#fff",
                color: "#111",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0",
                transition: "all 0.2s ease",
                zIndex: 1
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "#f3f4f6";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "#fff";
              }}
            >
              <PlusIcon 
                width="14" 
                height="14" 
                color="currentColor"
              />
            </button>
            {showDatasetMenu && (
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
              placeholder={
                selectedAction
                  ? `Ask with "${selectedAction}"...`
                  : "Ask anything..."
              }
              style={{
                flex: 1,
                padding: selectedDataset ? "0.85rem 1rem 2.5rem 3rem" : "0.85rem 1rem 0.85rem 3rem",
                borderRadius: "8px",
                border: "1px solid #d2d6db",
                fontSize: "1rem",
                background: "#fff",
                resize: "vertical",
                minHeight: "2.5rem",
                fontFamily: "inherit"
              }}
            />
            {selectedDataset && (
              <div
                style={{
                  position: "absolute",
                  bottom: "0.5rem",
                  left: "0.75rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  pointerEvents: "auto",
                  zIndex: 2
                }}
              >
                <span style={{ color: "#3b82f6", fontSize: "0.9rem", fontWeight: 500 }}>
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
                  <XIcon width="14" height="14" color="currentColor" />
                </button>
              </div>
            )}
          </div>
          {showDatasetReminder && (
            <div
              style={{
                marginTop: "0.5rem",
                marginLeft: "0.75rem",
                padding: "0.5rem 0.75rem",
                background: "#fef3c7",
                border: "1px solid #fbbf24",
                borderRadius: "6px",
                fontSize: "0.85rem",
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
          disabled={isSending || !selectedDataset}
          style={{
            height: "2.5rem",
            width: "2.5rem",
            borderRadius: "50%",
            border: "none",
            background: (selectedDataset && !isSending) ? "#111827" : "#d2d6db",
            color: "#fff",
            fontWeight: 600,
            cursor: (selectedDataset && !isSending) ? "pointer" : "not-allowed",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0.5rem",
            transition: "background-color 0.2s",
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
