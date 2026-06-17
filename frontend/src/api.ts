import { type Message } from "./App";
import { logger } from "./utils/logger";
import { auth } from "./auth/config";
import { SANDBOX_CHECK_TIMEOUT, SANDBOX_START_TIMEOUT } from "./constants";

// API calls go through our server's /api proxy, which forwards to the backend
// In local dev, Vite proxies /api to VITE_BACKEND_URL
// In production, the Express server proxies /api to BACKEND_URL with GCP auth
const API_URL = "/api";

// Helper function to get the current user's ID token
async function getIdToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) {
    return null;
  }
  try {
    return await user.getIdToken();
  } catch (error) {
    logger.error("Failed to get ID token:", error);
    return null;
  }
}

// Helper function to get headers with auth token — throws if not authenticated
async function getAuthHeaders(): Promise<HeadersInit> {
  const token = await getIdToken();
  if (!token) {
    throw new Error("Authentication required. Please sign in.");
  }
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
  };
}

export async function checkSandboxIsActive(timeoutMs: number = SANDBOX_CHECK_TIMEOUT): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_URL}/sandbox_running`, {
      method: "GET",
      headers: headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    const isActive = data["running"];
    // Ensure we return a proper boolean
    return Boolean(isActive);
  } catch (error: any) {
    // Silently handle all errors and return false
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function startSandbox(timeoutMs: number = SANDBOX_START_TIMEOUT): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_URL}/start_sandbox`, {
      method: "POST",
      headers: headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      // Try to parse error response as JSON (backend returns JSON with "detail" field)
      let errorMessage = response.statusText;
      try {
        const errorData = await response.json();
        errorMessage = errorData.detail || errorData.message || errorMessage;
      } catch {
        // If JSON parsing fails, try text
        const errorText = await response.text().catch(() => response.statusText);
        errorMessage = errorText || errorMessage;
      }
      throw new Error(`Failed to start sandbox: ${response.status} ${errorMessage}`);
    }

    const data = await response.json();
    // Verify the response structure
    if (data.status !== "success") {
      throw new Error(data.message || "Sandbox initialization returned unsuccessful status");
    }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error("Request timed out while starting sandbox. The backend may be experiencing connection issues with the sandbox service.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function sendMessage(messages: Array<{ role: string; content: string }>, selectedAction: string | null, dataset: string | null) {

    let endpoint = "/text_response"; // default endpoint
    let body = JSON.stringify({ messages, search: false, dataset: dataset }) ;               // default search flag  // default map type

    if (selectedAction === "Web Search") {
      body = JSON.stringify({ messages, search: true});
    } else if (selectedAction === "Code") {
      endpoint = "/code_response";
      body = JSON.stringify({ messages, dataset: dataset });
    } else if (selectedAction && ["World Map (Flow Map)", "World Map (Bubble Chart)"].includes(selectedAction)) {
      endpoint = "/world_map_response";
      body = JSON.stringify({ messages, response_type: selectedAction});
    }

    const headers = await getAuthHeaders();
    const response = await fetch(`${API_URL}${endpoint}`, {
      method: "POST",
      headers: headers,
      body: body
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to send message: ${response.status} ${errorText}`);
    }

    return await response.json();
}

export async function sendStreamingMessage(
  messages: Array<{ role: string; content: string }>,
  search: boolean,
  onChunk: (chunk: string) => void,
  dataset: string | null
): Promise<void> {
  const body = JSON.stringify({ messages, search, dataset: dataset });

  const headers = await getAuthHeaders();
  const response = await fetch(`${API_URL}/stream_text_response`, {
    method: "POST",
    headers: headers,
    body: body
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to send streaming message: ${response.status} ${errorText}`);
  }

  if (!response.body) {
    throw new Error("Response body is null");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      onChunk(chunk);
    }
  } finally {
    reader.releaseLock();
  }
}

export async function sendQuantitativeStreamingMessage(
  messages: Array<{ role: string; content: string }>,
  onMetadata: (metadata: { figures: any[]; tables: any[]; other_results: any[]; code: string | null }) => void,
  onTextChunk: (chunk: string) => void,
  onError: (error: string) => void,
  onDone: () => void,
  dataset: string | null
): Promise<void> {
  const body = JSON.stringify({ messages, dataset: dataset });

  const headers = await getAuthHeaders();
  const response = await fetch(`${API_URL}/stream_quantitative_response`, {
    method: "POST",
    headers: headers,
    body: body
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    onError(`Failed to send quantitative streaming message: ${response.status} ${errorText}`);
    return;
  }

  if (!response.body) {
    throw new Error("Response body is null");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      
      // Process complete SSE events (lines ending with \n\n)
      const lines = buffer.split("\n\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6); // Remove "data: " prefix
          try {
            const parsed = JSON.parse(data);
            
            if (parsed.type === "metadata") {
              onMetadata({
                figures: parsed.figures || [],
                tables: parsed.tables || [],
                other_results: parsed.other_results || [],
                code: parsed.code || null
              });
            } else if (parsed.type === "text") {
              onTextChunk(parsed.content || "");
            } else if (parsed.type === "done") {
              onDone();
              return;
            } else if (parsed.type === "error") {
              onError(parsed.message || "Unknown error");
              return;
            }
          } catch (e) {
            logger.error("Error parsing SSE data:", e, data);
          }
        }
      }
    }
    
    // Process any remaining buffer
    if (buffer.trim()) {
      const lines = buffer.split("\n\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "done") {
              onDone();
            } else if (parsed.type === "error") {
              onError(parsed.message || "Unknown error");
            }
          } catch (e) {
            logger.error("Error parsing final SSE data:", e);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function sendFigureMessage(messages: Array<{ role: string; content: string }>, dataset: string | null) {
  const body = JSON.stringify({ messages, dataset: dataset });
  const headers = await getAuthHeaders();

  const response = await fetch(`${API_URL}/figure_response`, {
    method: "POST",
    headers: headers,
    body: body
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to send figure message: ${response.status} ${errorText}`);
  }

  return await response.json();
}

export async function sendWorldMapMessage(messages: Array<{ role: string; content: string }>, selectedAction: string | null) {
  const body = JSON.stringify({ messages, response_type: selectedAction });
  const headers = await getAuthHeaders();

  const response = await fetch(`${API_URL}/world_map_response`, {
    method: "POST",
    headers: headers,
    body: body
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to send world map message: ${response.status} ${errorText}`);
  }

  return await response.json();
}

export async function sendDeepResearchMessage(
  messages: Array<{ role: string; content: string }>,
  onProgress: (progress: string) => void,
  onClarificationQuestion: (clarifications: string) => void,
  onFinalReport: (finalReport: string) => void,
  onError: (error: string) => void,
  onDone: () => void,
  dataset: string | null
): Promise<void> {
  const body = JSON.stringify({ messages, dataset: dataset });

  const headers = await getAuthHeaders();
  const response = await fetch(`${API_URL}/deep_research_response`, {
    method: "POST",
    headers: headers,
    body: body
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    onError(`Failed to send deep research message: ${response.status} ${errorText}`);
    return;
  }

  if (!response.body) {
    throw new Error("Response body is null");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      
      // Process complete SSE events (lines ending with \n\n)
      const lines = buffer.split("\n\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6); // Remove "data: " prefix
          try {
            const parsed = JSON.parse(data);
            
            if (parsed.type === "progress") {
              onProgress(parsed.content || "");
            } else if (parsed.type === "clarification_question") {
              onClarificationQuestion(parsed.clarification_question || "");
            } else if (parsed.type === "final_report") {
              onFinalReport(parsed.final_report || "");
            } else if (parsed.type === "done") {
              onDone();
              return;
            } else if (parsed.type === "error") {
              onError(parsed.message || "Unknown error");
              return;
            }
          } catch (e) {
            logger.error("Error parsing SSE data:", e, data);
          }
        }
      }
    }
    
    // Process any remaining buffer
    if (buffer.trim()) {
      const lines = buffer.split("\n\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "done") {
              onDone();
            } else if (parsed.type === "error") {
              onError(parsed.message || "Unknown error");
            }
          } catch (e) {
            logger.error("Error parsing final SSE data:", e);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: any;
  updatedAt: any;
  userId: string;
}

export async function getConversations(): Promise<Conversation[]> {

  let endpoint = "/get_all_conversations";
  const headers = await getAuthHeaders();
  
  const response = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    headers: headers
  });

  if (!response.ok) {
    throw new Error("Failed to fetch conversations");
  }

  const data = await response.json();
  return data.conversations || [];
}

export async function updateConversationTitle(conversationId: string, newTitle: string): Promise<void> {

  let endpoint = "/update_conversation_title";
  let body = JSON.stringify({ conversation_id: conversationId, new_title: newTitle });
  const headers = await getAuthHeaders();

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    headers: headers,
    body: body,
  });

  if (!response.ok) {
    throw new Error("Failed to update conversation title");
  }
}

export async function deleteConversation(conversationId: string): Promise<void> {
  let endpoint = "/delete_conversation";
  let body = JSON.stringify({ conversation_id: conversationId });
  const headers = await getAuthHeaders();

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    headers: headers,
    body: body,
  });

  if (!response.ok) {
    throw new Error("Failed to delete conversation");
  }
}

export async function createConversation(messages: Array<Message>): Promise<string> {
  let endpoint = "/create_conversation";
  let body = JSON.stringify({ messages: messages.map((message) => ({
    role: message.role,
    content: message.content,
    response_type: message.response_type || "text",
    figures: message.figures || [],
    tables: message.tables || [],
    other_results: message.other_results || [],
    code: message.code || null
  })) });
  const headers = await getAuthHeaders();

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    headers: headers,
    body: body,
  });

  if (!response.ok) {
    throw new Error("Failed to create conversation");
  }

  const data = await response.json();
  // Return conversation ID from response
  return data.conversation_id || data.conversation?.id || "";
}


export async function getConversationMessages(conversationId: string): Promise<Array<{ role: string; content: string; response_type?: string; figures?: any[]; tables?: any[]; other_results?: any[]; code?: string | null; isComplete?: boolean; progress?: string; isDeepResearch?: boolean }>> {
  // Try get_conversation_by_id first, as it might include messages
  let endpoint = "/get_conversation_by_id";
  let body = JSON.stringify({ conversation_id: conversationId });
  const headers = await getAuthHeaders();

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    headers: headers,
    body: body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error("API Error Response:", errorText);
    throw new Error(`Failed to get conversation messages: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  logger.log("Full API response:", data);
  
  // Check various possible locations for messages
  let rawMessages = data.conversation
  
  if (rawMessages.length === 0) {
    logger.warn("No messages found in conversation response. Full response:", data);
    return [];
  }
  
  // Sort messages by createdAt in ascending order (oldest first)
  const sortedMessages = [...rawMessages].sort((a: any, b: any) => {
    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return dateA - dateB;
  });
  
  // Map camelCase fields from backend to snake_case expected by frontend
  const mappedMessages = sortedMessages.map((msg: any) => {
    // Ensure deep research messages always have role "assistant"
    const isDeepResearch = msg.isDeepResearch || msg.progress !== undefined;
    const role = isDeepResearch ? "assistant" : msg.role;
    
    return {
      role: role,
      content: msg.content,
      response_type: msg.responseType || msg.response_type || "text",
      figures: msg.figures || [],
      tables: msg.tables || [],
      other_results: msg.otherResults || msg.other_results || [],
      isComplete: msg.isComplete ?? true,
      progress: msg.progress,
      isDeepResearch: isDeepResearch,
    };
  });
  
  return mappedMessages;
}


export async function addMessageToConversation(conversationId: string, message: Message): Promise<void> {
  let endpoint = "/add_message_to_conversation";
  let body = JSON.stringify({ 
    conversation_id: conversationId, 
    role: message.role, 
    content: message.content, 
    response_type: message.response_type || "text", 
    figures: message.figures || [], 
    tables: message.tables || [], 
    other_results: message.other_results || [],
    code: message.code || null,
    isDeepResearch: message.isDeepResearch || false,
    progress: message.progress || null
  });
  const headers = await getAuthHeaders();

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    headers: headers,
    body: body,
  });

  if (!response.ok) {
    throw new Error("Failed to add message to conversation");
  }
}

// Dashboard API functions
export interface Dashboard {
  id: string;
  title: string;
  createdAt?: any;
  updatedAt?: any;
  userId: string;
  figures?: Array<{
    id: string;
    title: string;
    figure?: any;
    table?: any;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    code?: string | null;
  }>;
}

export async function createDashboard(title: string): Promise<string> {
  const endpoint = "/create_dashboard";
  const body = JSON.stringify({ "title": title });
  const headers = await getAuthHeaders();

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    headers: headers,
    body: body,
  });

  if (!response.ok) {
    throw new Error("Failed to create dashboard");
  }

  const data = await response.json();
  return data.dashboard_id || "";
}

export async function getDashboards(): Promise<Dashboard[]> {
  const endpoint = "/get_all_dashboards";
  const headers = await getAuthHeaders();

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    headers: headers,
  });

  if (!response.ok) {
    throw new Error("Failed to fetch dashboards");
  }

  const data = await response.json();
  return data.dashboards || [];
}

export async function getDashboardById(dashboardId: string): Promise<any> {
  const endpoint = "/get_dashboard_by_id";
  const body = JSON.stringify({ dashboard_id: dashboardId });
  const headers = await getAuthHeaders();

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    headers: headers,
    body: body,
  });

  if (!response.ok) {
    throw new Error("Failed to get dashboard by id");
  }

  const data = await response.json();
  // Dashboard response structure: 
  // - If dashboard is an array, it's the new structure (array of dicts with figures/tables/other_results)
  // - Otherwise, it's the old structure (object with figures array)
  // The response also contains title, id, etc. at the top level
  if (Array.isArray(data.dashboard)) {
    // New structure: return object with title/id and the array
    // Don't default to "Dashboard" - let the component handle defaults
    return {
      id: data.dashboard_id || data.id || dashboardId,
      title: data.title || null, // Return null instead of defaulting to "Dashboard"
      //userId: data.user_id || data.userId || "",
      dashboardArray: data.dashboard, // The array of dicts
    };
  }
  // Old structure: return as-is
  return data.dashboard || null;
}

export async function updateDashboardTitle(dashboardId: string, newTitle: string): Promise<void> {
  const endpoint = "/update_dashboard_title";
  const body = JSON.stringify({ dashboard_id: dashboardId, new_title: newTitle });
  const headers = await getAuthHeaders();

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    headers: headers,
    body: body,
  });

  if (!response.ok) {
    throw new Error("Failed to update dashboard title");
  }
}

export async function deleteDashboard(dashboardId: string): Promise<void> {
  const endpoint = "/delete_dashboard";
  const body = JSON.stringify({ dashboard_id: dashboardId });
  const headers = await getAuthHeaders();

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    headers: headers,
    body: body,
  });

  if (!response.ok) {
    throw new Error("Failed to delete dashboard");
  }
}

export async function addFigureToDashboard(figure: {
  dashboard_id: string;
  figure_id: string;
  title: string;
  dataset: string | null;
  figure?: any;
  table?: any;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  code?: string | null;
}): Promise<void> {
  const endpoint = "/add_figure_to_dashboard";
  const body = JSON.stringify({ ...figure});
  const headers = await getAuthHeaders();

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    headers: headers,
    body: body,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    logger.error("Failed to add figure to dashboard:", errorText);
    throw new Error(`Failed to add figure to dashboard: ${response.status} ${errorText}`);
  }
}

export async function removeFigureFromDashboard(dashboardId: string, figureId: string): Promise<void> {
  const endpoint = "/remove_figure_from_dashboard";
  const body = JSON.stringify({ dashboard_id: dashboardId, figure_id: figureId });
  const headers = await getAuthHeaders();

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    headers: headers,
    body: body,
  });

  if (!response.ok) {
    throw new Error("Failed to remove figure from dashboard");
  }
}

export async function updateFigure(
  dashboardId: string,
  figureId: string,
  newInformation: {
    title?: string;
    code?: string | null;
    figure?: any;
    table?: any;
    dataset?: string | null;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }
): Promise<void> {
  const endpoint = "/update_figure";
  const body = JSON.stringify({
    dashboard_id: dashboardId,
    figure_id: figureId,
    new_information: newInformation,
  });
  const headers = await getAuthHeaders();

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    headers: headers,
    body: body,
  });

  if (!response.ok) {
    throw new Error("Failed to update figure");
  }
}

export async function getDatasets(): Promise<string[]> {
  const endpoint = "/datasets";
  const headers = await getAuthHeaders();

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: "GET",
    headers: headers,
  });

  if (!response.ok) {
    throw new Error("Failed to fetch datasets");
  }

  const data = await response.json();
  return data.datasets || [];
}