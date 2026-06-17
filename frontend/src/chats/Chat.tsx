import { type Message } from "../App";
import ReactMarkdown from "react-markdown";
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-dist-min";   // ← FULL PLOTLY BUILD
import { useRef, useEffect, useState } from "react";
import { DataTable } from "../DataTable";
import { exportMessageToPDF } from "../pdfExport";
import { DownloadIcon, SpinnerIcon } from "../icons";
import { logger } from "../utils/logger";
import { sanitizePlotlyFigure } from "../utils/responseParser";

const Plot = createPlotlyComponent(Plotly);

interface MessageItemProps {
  message: Message;
  messageIndex: number;
}

function MessageItem({ message, messageIndex }: MessageItemProps) {
  const [isExporting, setIsExporting] = useState(false);
  
  const handleExportPDF = async () => {
    if (message.role === "assistant") {
      setIsExporting(true);
      try {
        await exportMessageToPDF(message, messageIndex);
      } catch (error) {
        logger.error("Error exporting to PDF:", error);
        alert("Failed to export PDF. Please try again.");
      } finally {
        setIsExporting(false);
      }
    }
  };

  return (
    <div
      style={{
        marginBottom: "1.5rem",
        alignSelf: message.role === "user" ? "flex-end" : "flex-start",
        maxWidth: "80%",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem"
      }}
    >
      {/* PDF Download Button - only for assistant messages that are complete */}
      {message.role === "assistant" && message.isComplete  && message.response_type === "text" && (
        <div style={{ display: "flex", justifyContent: "flex-start" }}>
          <button
            onClick={handleExportPDF}
            disabled={isExporting}
            style={{
              padding: "0.4rem 0.6rem",
              background: isExporting ? "#9ca3af" : "#111827",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              cursor: isExporting ? "not-allowed" : "pointer",
              fontSize: "0.75rem",
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              transition: "background-color 0.2s",
            }}
            onMouseEnter={(e) => {
              if (!isExporting) {
                e.currentTarget.style.backgroundColor = "#374151";
              }
            }}
            onMouseLeave={(e) => {
              if (!isExporting) {
                e.currentTarget.style.backgroundColor = "#111827";
              }
            }}
            title="Download as PDF"
          >
            <DownloadIcon width="14" height="14" />
            {isExporting ? "Exporting..." : "PDF"}
          </button>
        </div>
      )}
      <div
        style={{
          padding: "0rem 1rem",
          background: message.role === "user" ? "#f3f4f6" : "#ffffff",
          borderRadius: message.role === "user" ? "8px" : "0px",
        }}
      >
        <div
          style={{
            fontSize: "0.75rem",
            color: "#6b7280",
            marginBottom: "0.25rem",
            fontWeight: 600,
          }}
        >
          {/* {message.role === "user" ? "You" : "Assistant"} */}
        </div>

      {message.response_type === "code" && (message.figures || message.tables) ? (
        // Render quantitative response with figures, tables, and text
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* Render figures using Plotly */}
          {message.figures && message.figures.length > 0 && message.figures.map((figure: any, i: number) => {
            try {
              // Parse figure if it's a string, otherwise use directly
              const raw = typeof figure === "string" ? JSON.parse(figure) : figure;
              const figureData = sanitizePlotlyFigure(raw);

              if (!figureData.data || !figureData.layout) {
                return (
                  <div key={`figure-${i}`} style={{ color: "red", marginBottom: "1rem" }}>
                    Error: Figure is missing data or layout properties
                  </div>
                );
              }

              return (
                <div key={`figure-${i}`} style={{ marginBottom: "1rem" }}>
                  <Plot
                    data={figureData.data as Plotly.Data[]}
                    layout={figureData.layout as Partial<Plotly.Layout>}
                    frames={figureData.frames || []}
                  />
                </div>
              );
            } catch (e) {
              logger.error(`Error parsing Plotly figure ${i}:`, e, figure);
              return (
                <div key={`figure-${i}`} style={{ color: "red", marginBottom: "1rem" }}>
                  Error parsing Plotly figure: {String(e)}
                </div>
              );
            }
          })}
          
          {/* Render tables */}
          {message.tables && message.tables.length > 0 && message.tables.map((table: any, i: number) => {
            try {
              // Parse table if it's a string, otherwise use directly
              const tableData = typeof table === "string" ? JSON.parse(table) : table;
              
              // Handle df.to_dict(orient='records') format: array of objects
              // Each object represents a row with column names as keys
              if (Array.isArray(tableData) && tableData.length > 0) {
                return (
                  <div key={`table-${i}`}>
                    <DataTable data={tableData} />
                  </div>
                );
              }
              
              return (
                <div key={`table-${i}`} style={{ color: "red", marginBottom: "1rem" }}>
                  Invalid table format: expected array of objects
                </div>
              );
            } catch (e) {
              return (
                <div key={`table-${i}`} style={{ color: "red", marginBottom: "1rem" }}>
                  Error parsing table: {String(e)}
                </div>
              );
            }
          })}
          
          {/* Render text content if present */}
          {message.content && message.content.trim() && (
            <div>
              <ReactMarkdown
                components={{
                  a: ({ node, ...props }) => (
                    <a {...props} target="_blank" rel="noopener noreferrer" />
                  ),
                  p: ({node, ...props}) => <p style={{ margin: "0.5rem 0" }} {...props} />,
                  ul: ({node, ...props}) => <ul style={{ margin: "0.25rem 0" }} {...props} />,
                  li: ({node, ...props}) => <li style={{ margin: "0.15rem 0" }} {...props} />,
                  h1: ({node, ...props}) => <h1 style={{ margin: "0.4rem 0", fontSize: "1.1rem" }} {...props} />,
                  h2: ({node, ...props}) => <h2 style={{ margin: "0.3rem 0", fontSize: "1rem" }} {...props} />,
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>
      ) : message.isDeepResearch && message.progress !== undefined ? (
        // Deep research in progress: show progress with loading bar
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {/* Progress text in lighter font */}
          <div style={{ 
            color: "#9ca3af", 
            fontSize: "0.9rem",
            lineHeight: "1.5",
            fontStyle: "italic"
          }}>
            {message.progress || "Researching (this may take a moment)..."}
          </div>
          {/* Loading bar */}
          <div className="deep-research-loading-bar">
            <div className="deep-research-loading-bar-fill" />
          </div>
        </div>
      ) : (
        // Default: Markdown text
        <ReactMarkdown
          components={{
            a: ({ node, ...props }) => (
              <a {...props} target="_blank" rel="noopener noreferrer" />
            ),
            p: ({node, ...props}) => <p style={{ margin: "0.5rem 0" }} {...props} />,
            ul: ({node, ...props}) => <ul style={{ margin: "0.25rem 0" }} {...props} />,
            li: ({node, ...props}) => <li style={{ margin: "0.15rem 0" }} {...props} />,
            h1: ({node, ...props}) => <h1 style={{ margin: "0.4rem 0", fontSize: "1.1rem" }} {...props} />,
            h2: ({node, ...props}) => <h2 style={{ margin: "0.3rem 0", fontSize: "1rem" }} {...props} />,
          }}
        >
          {message.content}
        </ReactMarkdown>
      )}
      </div>
    </div>
  );
}

interface Props {
  messages: Message[];
  isLoading: boolean;
  loadingAction: string | null;
  isLoadingConversation?: boolean;
  selectedConversationId?: string | null;
  activeDeepResearchConversations?: Set<string>;
}

export default function Chat({ messages, isLoading, loadingAction, isLoadingConversation = false, selectedConversationId, activeDeepResearchConversations }: Props) {
  
  const getLoadingMessage = () => {
    if (loadingAction === "Starting sandbox") {
      return "Starting sandbox";
    } else if (loadingAction === "Web Search") {
      return "Searching the Web";
    } else if (loadingAction && ["Charts/Tables/Stats", "World Map (Flow Map)", "World Map (Bubble Chart)"].includes(loadingAction)) {
      return "Analyzing";
    } else {
      return "Generating";
    }
  };

  const containerRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom whenever messages change or loading starts
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, isLoading]);
    
  return (
    <div 
      ref={containerRef}
      style={{ padding: "1rem", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column" }}
    >
      {isLoadingConversation ? (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: "100%",
            flexDirection: "column",
            gap: "1rem"
          }}
        >
          <div className="loading-spinner" style={{
            width: "40px",
            height: "40px",
            border: "4px solid #e5e7eb",
            borderTop: "4px solid #3b82f6",
            borderRadius: "50%",
            animation: "spin 1s linear infinite"
          }}></div>
          <div style={{ color: "#6b7280", fontSize: "0.95rem" }}>Loading conversation...</div>
        </div>
      ) : messages.length === 0 && !isLoading ? (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: "100%",
            color: "#21354",
            fontSize: "1.5rem",
            padding: "2rem",
            textAlign: "center"
          }}
        >
          How can your data help you today?
        </div>
      ) : null}
      {messages.map((message, i) => (
        <MessageItem key={i} message={message} messageIndex={i} />
      ))}
      {isLoading && loadingAction !== "Deep Research" && (
        <div
          style={{
            marginBottom: "1.5rem",
            padding: "1rem",
            background: "#ffffff",
            borderRadius: "0px",
            alignSelf: "flex-start",
            maxWidth: "80%"
          }}
        >
          <div style={{ 
            color: "#6b7280",
            fontSize: "0.95rem",
            display: "flex",
            alignItems: "center",
            gap: "0.25rem"
          }}>
            <span>{getLoadingMessage()}</span>
            <span className="loading-dots">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </div>
        </div>
      )}
      {selectedConversationId && activeDeepResearchConversations && activeDeepResearchConversations.has(selectedConversationId) && (
        <div
          style={{
            marginBottom: "1.5rem",
            padding: "1rem",
            background: "#ffffff",
            borderRadius: "0px",
            alignSelf: "flex-start",
            maxWidth: "80%",
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem"
          }}
        >
          <div style={{ 
            color: "#9ca3af",
            fontSize: "0.9rem",
            lineHeight: "1.5",
            fontStyle: "italic",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem"
          }}>
            <SpinnerIcon width="16" height="16" color="#3b82f6" />
            <span>Researching (this may take a moment)...</span>
          </div>
          {/*<div className="deep-research-loading-bar">
            <div className="deep-research-loading-bar-fill" />
          </div>
          */}
        </div>
      )}
    </div>
  );
}
