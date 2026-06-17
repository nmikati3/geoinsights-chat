import { type Message } from "../App";
import { useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface MessageItemProps {
  message: Message;
}

function MessageItem({ message }: MessageItemProps) {
  return (
    <div
      style={{
        marginBottom: "1rem",
        alignSelf: message.role === "user" ? "flex-end" : "flex-start",
        maxWidth: "85%",
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem"
      }}
    >
      <div
        style={{
          padding: "0.5rem 0.75rem",
          background: message.role === "user" ? "#f3f4f6" : "#ffffff",
          borderRadius: "8px",
          fontSize: "0.875rem",
          lineHeight: "1.5",
        }}
      >
        {message.response_type === "code" && (message.code || message.content) && (
          // Render code as Python code block
          <SyntaxHighlighter
            language="python"
            style={oneLight}
            customStyle={{
              margin: 0,
              padding: "0.75rem",
              borderRadius: "6px",
              border: "1px solid #e5e7eb",
              fontSize: "0.8rem",
              lineHeight: "1.5",
            }}
          >
            {(message.code || message.content).trim()}
          </SyntaxHighlighter>
        )}
        {message.response_type !== "code" && (
          // Default: Markdown text
          <ReactMarkdown
            components={{
              a: ({ node, ...props }) => (
                <a {...props} target="_blank" rel="noopener noreferrer" />
              ),
              p: ({node, ...props}) => <p style={{ margin: "0.25rem 0", fontSize: "0.875rem" }} {...props} />,
              ul: ({node, ...props}) => <ul style={{ margin: "0.25rem 0", fontSize: "0.875rem" }} {...props} />,
              li: ({node, ...props}) => <li style={{ margin: "0.1rem 0", fontSize: "0.875rem" }} {...props} />,
              h1: ({node, ...props}) => <h1 style={{ margin: "0.3rem 0", fontSize: "0.95rem", fontWeight: 600 }} {...props} />,
              h2: ({node, ...props}) => <h2 style={{ margin: "0.25rem 0", fontSize: "0.9rem", fontWeight: 600 }} {...props} />,
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
  selectedFigureId: string | null;
}

export default function DashboardChat({ messages, isLoading, loadingAction, selectedFigureId }: Props) {
  const getLoadingMessage = () => {
    if (loadingAction === "Starting sandbox") {
      return "Starting sandbox";
    } else {
      return "Analyzing";
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
      style={{ 
        padding: "0.75rem", 
        overflowY: "auto", 
        flex: 1, 
        display: "flex", 
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      {messages.length === 0 && !isLoading ? (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: "100%",
            color: "#6b7280",
            fontSize: "0.875rem",
            padding: "1rem",
            textAlign: "center"
          }}
        >
          {!selectedFigureId
            ? "Please select a figure from the dropdown above to start editing"
            : "Ask me to create a figure for your dashboard"}
        </div>
      ) : null}
      {messages.map((message, i) => (
        <MessageItem key={i} message={message} />
      ))}
      {isLoading && (
        <div
          style={{
            marginBottom: "1rem",
            padding: "0.5rem 0.75rem",
            background: "#ffffff",
            borderRadius: "8px",
            alignSelf: "flex-start",
            maxWidth: "85%"
          }}
        >
          <div style={{ 
            color: "#6b7280",
            fontSize: "0.8rem",
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
    </div>
  );
}
