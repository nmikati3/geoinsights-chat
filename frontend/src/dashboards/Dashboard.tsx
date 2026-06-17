import { useState, useRef, useEffect } from "react";
import { PlusIcon } from "../icons";
import DashboardSidebar from "./DashboardSidebar";
import Figure from "./Figure";
import { getDashboardById, addFigureToDashboard, removeFigureFromDashboard, updateFigure } from "../api";
import { ensureSandboxActive } from "../utils/sandbox";
import { logger } from "../utils/logger";
import { DEFAULT_FIGURE_WIDTH, DEFAULT_FIGURE_HEIGHT, FIGURE_GAP, FIGURE_START_X, FIGURE_START_Y, DASHBOARD_CONTAINER_MAX_WIDTH } from "../constants";

interface FigureData {
  dashboard_id: string;
  figure_id: string;
  title: string;
  dataset: string | null;
  figure?: any | null; // Plotly figure data
  table?: any | null; // Table data
  x?: number; // X position
  y?: number; // Y position
  width?: number; // Width
  height?: number; // Height
  code?: string | null; // Code used to generate the figure
}

interface DashboardProps {
  dashboardId: string;
  title?: string;
  onTitleChange?: (title: string) => void;
  onAddFigure?: () => void;
}

export default function Dashboard({ 
  dashboardId,
  title: initialTitle = "New Dashboard",
  onTitleChange,
  onAddFigure 
}: DashboardProps) {
  const [title, setTitle] = useState(initialTitle);
  const [isEditing, setIsEditing] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [selectedFigureId, setSelectedFigureId] = useState<string | null>(null);
  const [figures, setFigures] = useState<FigureData[]>([]);

  const [isAddButtonHovered, setIsAddButtonHovered] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const isCancellingRef = useRef(false);
  const hasLoadedRef = useRef(false);
  // Map to maintain the link between figure objects and their backend figure IDs
  const figureIdMapRef = useRef<Map<string, string>>(new Map());

  // Reset state when dashboardId changes (but not when title changes)
  useEffect(() => {
    // Reset all state when dashboardId changes
    setTitle(initialTitle);
    setFigures([]);
    setSelectedFigureId(null);
    setIsEditing(false);
    figureIdMapRef.current.clear();
    hasLoadedRef.current = false;
  }, [dashboardId]); // Removed initialTitle from dependencies to prevent reset on title change

  // Load dashboard data from API
  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    
    const loadDashboard = async () => {
      try {
        setIsLoading(true);
        // Check if sandbox is running and start it if needed
        try {
          await ensureSandboxActive({ showAlert: true });
        } catch (error: any) {
          logger.error("Failed to ensure sandbox active:", error);
          // Continue loading dashboard even if sandbox fails - user can retry later
          alert(`Warning: ${error.message || "Unknown error"}. Dashboard will load but code execution may not work.`);
        }
        const dashboardResponse = await getDashboardById(dashboardId);
        if (dashboardResponse) {
          // Always use API title as source of truth when loading from backend
          const apiTitle = dashboardResponse.title;
          let dashboardTitle: string;
          
          // Use API title if it's meaningful, otherwise use prop/default
          if (apiTitle && apiTitle !== "Dashboard" && apiTitle.trim() !== "") {
            dashboardTitle = apiTitle;
          } else {
            dashboardTitle = initialTitle || "New Dashboard";
          }
          
          // Update local state
          setTitle(dashboardTitle);
          
          // Always notify parent with the title we're using (from API or prop)
          // This ensures App.tsx state stays in sync with what Dashboard displays
          // Always notify, even if it's "New Dashboard", to keep state in sync
          onTitleChange?.(dashboardTitle);
          
          // Dashboard is an array of dicts, each dict has figures, other_results, tables arrays
          // Each element of the dict is also an array - only show the first element of each list
          if (dashboardResponse.dashboardArray && Array.isArray(dashboardResponse.dashboardArray)) {
            // Clear and rebuild the figure ID map
            figureIdMapRef.current.clear();
            
            // Log the first item to understand the structure
            if (dashboardResponse.dashboardArray.length > 0) {
              logger.log("First dashboard item structure:", dashboardResponse.dashboardArray[0]);
              logger.log("All keys in first item:", Object.keys(dashboardResponse.dashboardArray[0]));
            }
            
            const loadedFigures: FigureData[] = dashboardResponse.dashboardArray.map((item: any, index: number) => {
              // Read figure from item.figure key (primary) or item.figures[0] (fallback)
              const figureData = item.figure !== undefined && item.figure !== null
                ? item.figure
                : (item.figures && Array.isArray(item.figures) && item.figures.length > 0 
                    ? item.figures[0] 
                    : null);
              // Read table from item.table key (primary) or item.tables[0] (fallback)
              const tableData = item.table !== undefined && item.table !== null
                ? item.table
                : (item.tables && Array.isArray(item.tables) && item.tables.length > 0 
                    ? item.tables[0] 
                    : null);
              
              // Extract figure ID 
              const backendFigureId = item.figure_id
              
              // Use the backend figure ID directly as the frontend ID if available
              const frontendId = backendFigureId || `temp-fig-${index}-${Date.now()}`;
              
              // Store the mapping (even if backend ID is missing, we'll use frontend ID as fallback)
              if (backendFigureId) {
                figureIdMapRef.current.set(frontendId, backendFigureId);
                logger.log(`Mapped frontend ID ${frontendId} to backend ID ${backendFigureId}`);
              } else {
                // If no backend ID found, map frontend ID to itself as fallback
                // This allows the UI to work, but backend operations will fail
                figureIdMapRef.current.set(frontendId, frontendId);
                logger.warn(`Figure at index ${index} is missing figure_id. Item:`, item);
                logger.warn(`Available keys:`, Object.keys(item));
                logger.warn(`Using temporary ID: ${frontendId}`);
              }
              
              // Extract figure metadata (title, position, size, code) from the item
              return {
                dashboard_id: dashboardId,
                figure_id: frontendId, // Use backend ID as frontend ID when available
                title: item.title || `Figure ${index + 1}`,
                figure: figureData,
                table: tableData || null,
                x: item.x,
                y: item.y,
                width: item.width,
                height: item.height,
                code: item.code || null,
              };
            });
            setFigures(loadedFigures);
            
            // Log the final mapping for debugging
            logger.log("Figure ID mapping:", Array.from(figureIdMapRef.current.entries()));
          } else if (dashboardResponse.figures && Array.isArray(dashboardResponse.figures)) {
            // Fallback: if dashboard has a figures array directly (old structure)
            const loadedFigures: FigureData[] = dashboardResponse.figures.map((fig: any) => {
              // Read figure from fig.figure key (primary) or fig.figures[0] (fallback)
              const figureData = fig.figure !== undefined && fig.figure !== null
                ? fig.figure
                : (fig.figures && Array.isArray(fig.figures) && fig.figures.length > 0 
                    ? fig.figures[0] 
                    : null);
              // Read table from fig.table key (primary) or fig.tables[0] (fallback)
              const tableData = fig.table !== undefined && fig.table !== null
                ? fig.table
                : (fig.tables && Array.isArray(fig.tables) && fig.tables.length > 0 
                    ? fig.tables[0] 
                    : null);
              
              return {
                dashboard_id: dashboardId,
                figure_id: fig.figure_id,
                title: fig.title || `Figure${fig.id}`,
                figure: figureData,
                table: tableData,
                x: fig.x,
                y: fig.y,
                width: fig.width,
                height: fig.height,
                code: fig.code || null,
              };
            });
            setFigures(loadedFigures);
          }
        }
      } catch (error) {
        logger.error("Failed to load dashboard:", error);
        alert("Failed to load dashboard. Please try again.");
      } finally {
        setIsLoading(false);
      }
    };
    
    loadDashboard();
  }, [dashboardId]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Sync title with prop when it changes (e.g., when renamed in sidebar)
  // Only update if not currently editing and dashboard has loaded to avoid conflicts
  useEffect(() => {
    // Only sync after dashboard has loaded (to avoid overwriting API title during initial load)
    if (!isEditing && hasLoadedRef.current && initialTitle && initialTitle !== title) {
      // Only sync if prop is meaningful (not default values)
      // This ensures sidebar renames are reflected in Dashboard
      // But don't overwrite API title with "New Dashboard" default
      if (initialTitle !== "New Dashboard" && initialTitle !== "Dashboard" && initialTitle.trim() !== "") {
        setTitle(initialTitle);
      }
    }
  }, [initialTitle, isEditing, title]);

  // Auto-select figure if there's only one
  useEffect(() => {
    if (figures.length === 1) {
      // If there's only one figure and it's not selected, select it
      if (!selectedFigureId || !figures.find(f => f.figure_id === selectedFigureId)) {
        setSelectedFigureId(figures[0].figure_id);
      }
    } else if (figures.length === 0) {
      setSelectedFigureId(null);
    } else if (selectedFigureId && !figures.find(f => f.figure_id === selectedFigureId)) {
      // If selected figure was deleted, clear selection
      setSelectedFigureId(null);
    }
  }, [figures, selectedFigureId]);

  const handleTitleClick = () => {
    setIsEditing(true);
  };

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
  };

  const handleTitleBlur = async () => {
    if (!isCancellingRef.current) {
      const trimmedTitle = title.trim();
      if (trimmedTitle) {
        setTitle(trimmedTitle);
        onTitleChange?.(trimmedTitle);
        // Title is saved via onTitleChange in App.tsx
      } else {
        setTitle(initialTitle);
      }
    }
    setIsEditing(false);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const trimmedTitle = title.trim();
      if (trimmedTitle) {
        setTitle(trimmedTitle);
        onTitleChange?.(trimmedTitle);
      } else {
        setTitle(initialTitle);
      }
      setIsEditing(false);
    } else if (e.key === "Escape") {
      e.preventDefault();
      isCancellingRef.current = true;
      setTitle(initialTitle);
      setIsEditing(false);
      setTimeout(() => {
        isCancellingRef.current = false;
      }, 0);
    }
  };

  const handleAddFigure = async () => {
    // Create a new figure with default position and size
    const newFigureId = `figure-${Date.now()}`;

    let newX = FIGURE_START_X;
    let newY = FIGURE_START_Y;

    if (figures.length > 0) {
      // Find the last row (highest y position)
      // Calculate actual y positions for all figures
      const figuresWithY = figures.map((f, index) => ({
        ...f,
        actualY: f.y ?? FIGURE_START_Y + Math.floor(index / 2) * (DEFAULT_FIGURE_HEIGHT + FIGURE_GAP),
        actualX: f.x ?? FIGURE_START_X + (index % 2) * (DEFAULT_FIGURE_WIDTH + FIGURE_GAP),
        actualWidth: f.width ?? DEFAULT_FIGURE_WIDTH,
        actualHeight: f.height ?? DEFAULT_FIGURE_HEIGHT,
      }));

      const lastRowY = Math.max(...figuresWithY.map(f => f.actualY));
      
      // Get all figures in the last row (within tolerance)
      const figuresInLastRow = figuresWithY.filter(f => Math.abs(f.actualY - lastRowY) < 10);

      if (figuresInLastRow.length > 0) {
        // Find the rightmost figure in the last row
        const rightmostFigure = figuresInLastRow.reduce((rightmost, current) => {
          return current.actualX > rightmost.actualX ? current : rightmost;
        }, figuresInLastRow[0]);

        // Calculate where the new figure would be placed
        const proposedX = rightmostFigure.actualX + rightmostFigure.actualWidth + FIGURE_GAP;
        const proposedRightEdge = proposedX + DEFAULT_FIGURE_WIDTH;

        // Check if the new figure would fit within the container width
        // Leave some margin (e.g., 50px) from the right edge
        const rightMargin = 50;
        if (proposedRightEdge <= DASHBOARD_CONTAINER_MAX_WIDTH - rightMargin) {
          // There's space in the current row
          newX = proposedX;
          newY = lastRowY;
        } else {
          // No space in current row, start a new row
          // Find the tallest figure in the last row to determine spacing
          const tallestInLastRow = figuresInLastRow.reduce((tallest, current) => {
            return current.actualHeight > tallest.actualHeight ? current : tallest;
          }, figuresInLastRow[0]);
          
          newY = lastRowY + tallestInLastRow.actualHeight + FIGURE_GAP;
          newX = FIGURE_START_X;
        }
      } else {
        // No figures in last row (shouldn't happen, but handle it)
        newY = lastRowY + DEFAULT_FIGURE_HEIGHT + FIGURE_GAP;
        newX = FIGURE_START_X;
      }
    }

    const newFigure: FigureData = {
      dashboard_id: dashboardId,
      figure_id: newFigureId,
      title: `Figure${figures.length + 1}`,
      dataset: "",
      figure: null,
      table: null,
      code: null,
      x: newX,
      y: newY,
      width: DEFAULT_FIGURE_WIDTH,
      height: DEFAULT_FIGURE_HEIGHT,
    };
    
    // Store the mapping: frontend ID -> backend ID (same in this case since we generate it)
    figureIdMapRef.current.set(newFigureId, newFigureId);
    
    // Add to local state first
    setFigures((prev) => [...prev, newFigure]);
    setSelectedFigureId(newFigureId);
    setIsSidebarCollapsed(false);
    onAddFigure?.();
    
    // Save to backend - use the figure ID we generated
    try {
      logger.log("Adding figure with empty dataset");
      await addFigureToDashboard({
        dashboard_id: dashboardId,
        figure_id: newFigureId, // This is the ID we send to backend
        title: newFigure.title,
        dataset: "",
        figure: null,
        table: null,
        x: newX,
        y: newY,
        width: DEFAULT_FIGURE_WIDTH,
        height: DEFAULT_FIGURE_HEIGHT,
        code: null,
      });
      
      // Add a small delay to ensure the backend has processed and stored the dataset
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Try to reload dashboard to get the actual backend IDs and sync the mapping
      // This ensures that if the backend created the figure with a different ID,
      // we'll have the correct mapping. If this fails, we'll keep the local state.
      try {
        const dashboardResponse = await getDashboardById(dashboardId);
        if (dashboardResponse && dashboardResponse.dashboardArray && Array.isArray(dashboardResponse.dashboardArray)) {
        // Save existing mappings before clearing
        const oldMapping = new Map(figureIdMapRef.current);
        
        // Preserve existing figure data to avoid losing chart data
        const existingFiguresMap = new Map<string, FigureData>();
        figures.forEach(fig => {
          existingFiguresMap.set(fig.figure_id, fig);
        });
        
        // Clear and rebuild the figure ID map
        figureIdMapRef.current.clear();
        
        const loadedFigures: FigureData[] = dashboardResponse.dashboardArray.map((item: any, index: number) => {
          // Read figure from item.figure key (primary) or item.figures[0] (fallback)
          const figureData = item.figure !== undefined && item.figure !== null
            ? item.figure
            : (item.figures && Array.isArray(item.figures) && item.figures.length > 0 
                ? item.figures[0] 
                : null);
          // Read table from item.table key (primary) or item.tables[0] (fallback)
          const tableData = item.table !== undefined && item.table !== null
            ? item.table
            : (item.tables && Array.isArray(item.tables) && item.tables.length > 0 
                ? item.tables[0] 
                : null);
          
          const backendFigureId = item.figure_id;
          const frontendId = backendFigureId || `temp-fig-${index}-${Date.now()}`;
          
          if (backendFigureId) {
            figureIdMapRef.current.set(frontendId, backendFigureId);
          } else {
            figureIdMapRef.current.set(frontendId, frontendId);
          }
          
          // Try to find existing figure data by matching backend ID or position/size
          let existingFigure: FigureData | undefined;
          
          // First try to match by backend ID using the old mapping
          if (backendFigureId) {
            // Find existing figure whose backend ID matches
            for (const [oldFrontendId, oldBackendId] of oldMapping.entries()) {
              if (oldBackendId === backendFigureId) {
                existingFigure = existingFiguresMap.get(oldFrontendId);
                if (existingFigure) break;
              }
            }
          }
          
          // If no match by ID, try to match by position and size (for newly created figures)
          if (!existingFigure) {
            existingFigure = Array.from(existingFiguresMap.values()).find(
              ef => Math.abs((ef.x || 0) - (item.x || 0)) < 10 &&
                    Math.abs((ef.y || 0) - (item.y || 0)) < 10 &&
                    Math.abs((ef.width || 0) - (item.width || 0)) < 10 &&
                    Math.abs((ef.height || 0) - (item.height || 0)) < 10
            );
          }
          
          // Preserve existing figure/table data if API doesn't return it
          // Use API data if available, otherwise fall back to existing data
          const preservedFigure = figureData || existingFigure?.figure || null;
          const preservedTable = tableData || existingFigure?.table || null;
          
          return {
            dashboard_id: dashboardId,
            figure_id: frontendId,
            title: item.title || existingFigure?.title || `Figure ${index + 1}`,
            dataset: item.dataset || existingFigure?.dataset || "",
            figure: preservedFigure,
            table: preservedTable,
            x: item.x ?? existingFigure?.x,
            y: item.y ?? existingFigure?.y,
            width: item.width ?? existingFigure?.width,
            height: item.height ?? existingFigure?.height,
            code: item.code ?? existingFigure?.code ?? null,
          };
        });
        
        setFigures(loadedFigures);
        
        // Try to maintain selection on the newly created figure
        // Find the figure that matches our new figure's position/size
        const matchingFigure = loadedFigures.find(f => 
          Math.abs((f.x || 0) - newX) < 10 && 
          Math.abs((f.y || 0) - newY) < 10 &&
          Math.abs((f.width || 0) - DEFAULT_FIGURE_WIDTH) < 10 &&
          Math.abs((f.height || 0) - DEFAULT_FIGURE_HEIGHT) < 10
        );
        
          if (matchingFigure) {
            setSelectedFigureId(matchingFigure.figure_id);
          }
        }
      } catch (reloadError) {
        // If reload fails (e.g., CORS error), log it but don't revert local state
        // The figure was successfully added to the backend, so we keep the local state
        logger.warn("Failed to reload dashboard after adding figure (this is non-critical):", reloadError);
        // Don't show alert to user - the figure was added successfully, just the reload failed
      }
    } catch (error) {
      logger.error("Failed to save figure to dashboard:", error);
      // Revert local state on error
      setFigures((prev) => prev.filter(f => f.figure_id !== newFigureId));
      if (selectedFigureId === newFigureId) {
        setSelectedFigureId(null);
      }
      alert("Failed to save figure. Please try again.");
    }
  };

  const handleFigureUpdate = async (
    dashboard_id: string,
    figure_id: string,
    updates: {
      title?: string;
      figure?: any;
      table?: any;
      code?: string | null;
      dataset?: string | null;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    },
    options?: {
      showAlert?: boolean;
      silentFail?: boolean;
    }
  ) => {
    const { showAlert = true, silentFail = false } = options || {};
    
    // Update local state first (including dataset if provided)
    setFigures((prev) =>
      prev.map((f) =>
        f.figure_id === figure_id ? { ...f, ...updates } : f
      )
    );
    
    // Build the update object with only the fields that changed
    const currentFigure = figures.find(f => f.figure_id === figure_id);
    if (currentFigure) {
      const newInformation: any = {};
      
      // Check each field and only include if it actually changed
      if (updates.title !== undefined && updates.title !== currentFigure.title) {
        newInformation.title = updates.title;
      }
      if (updates.figure !== undefined && updates.figure !== currentFigure.figure) {
        // Always send null for figure to backend
        newInformation.figure = null;
      }
      if (updates.table !== undefined && updates.table !== currentFigure.table) {
        // Always send null for table to backend
        newInformation.table = null;
      }
      if (updates.code !== undefined && updates.code !== currentFigure.code) {
        newInformation.code = updates.code;
      }
      if (updates.dataset !== undefined && updates.dataset !== currentFigure.dataset) {
        newInformation.dataset = updates.dataset;
      }
      if (updates.x !== undefined && updates.x !== currentFigure.x) {
        newInformation.x = updates.x;
      }
      if (updates.y !== undefined && updates.y !== currentFigure.y) {
        newInformation.y = updates.y;
      }
      if (updates.width !== undefined && updates.width !== currentFigure.width) {
        newInformation.width = updates.width;
      }
      if (updates.height !== undefined && updates.height !== currentFigure.height) {
        newInformation.height = updates.height;
      }
      
      // Only call update if something actually changed
      if (Object.keys(newInformation).length > 0) {
        try {
          // Look up the backend figure ID from the mapping
          // For newly created figures, the mapping might not be set yet, so fallback to figure_id
          const backendFigureId = figureIdMapRef.current.get(figure_id) || figure_id;
          await updateFigure(dashboard_id, backendFigureId, newInformation);
        } catch (error) {
          logger.error("Failed to update figure:", error);
          if (showAlert && !silentFail) {
            alert("Failed to update figure. Please try again.");
          }
        }
      }
    }
  };


  const handleFigureDelete = async (dashboard_id: string, figure_id: string) => {
    // Look up the backend figure ID from the mapping before deleting
    const backendFigureId = figureIdMapRef.current.get(figure_id) || figure_id;
    
    // Remove from local state first
    setFigures((prev) => prev.filter((figure) => figure.figure_id !== figure_id));
    // Remove from ID mapping if it exists
    figureIdMapRef.current.delete(figure_id);
    if (selectedFigureId === figure_id) {
      setSelectedFigureId(null);
    }
    
    // Save to backend using the backend figure ID
    try {
      await removeFigureFromDashboard(dashboard_id, backendFigureId);
    } catch (error) {
      logger.error("Failed to delete figure:", error);
      alert("Failed to delete figure. Please try again.");
      // Could reload dashboard here to revert state, but for now just show error
    }
  };

  if (isLoading) {
    return (
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
        <div style={{ color: "#6b7280", fontSize: "0.95rem" }}>Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: "#fff",
        position: "relative",
      }}
    >
      {/* Editable Title */}
      <div
        data-dashboard-title-section
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "2rem",
          paddingBottom: "1rem",
        }}
      >
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={title}
            onChange={handleTitleChange}
            onBlur={handleTitleBlur}
            onKeyDown={handleTitleKeyDown}
            style={{
              fontSize: "1.5rem",
              fontWeight: 600,
              border: "none",
              outline: "2px solid #3b82f6",
              outlineOffset: "-2px",
              borderRadius: "4px",
              padding: "0.25rem 0.5rem",
              background: "#fff",
              color: "#111",
              cursor: "text",
              minWidth: "200px",
            }}
          />
        ) : (
          <h1
            onClick={handleTitleClick}
            style={{
              fontSize: "1.5rem",
              fontWeight: 600,
              margin: 0,
              cursor: "text",
              color: "#111",
              padding: "0.25rem 0.5rem",
              borderRadius: "4px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f3f4f6";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            {title}
          </h1>
        )}
        <button
          onClick={handleAddFigure}
          onMouseEnter={() => setIsAddButtonHovered(true)}
          onMouseLeave={() => setIsAddButtonHovered(false)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "32px",
            height: "32px",
            borderRadius: "4px",
            border: `1px solid ${isAddButtonHovered ? "#9ca3af" : "#d1d5db"}`,
            background: isAddButtonHovered ? "#f9fafb" : "#fff",
            cursor: "pointer",
            transition: "all 0.2s",
            flexShrink: 0,
            padding: 0,
            transform: isAddButtonHovered ? "scale(1.05)" : "scale(1)",
          }}
          title="Add Figure"
        >
          <PlusIcon 
            color={isAddButtonHovered ? "#374151" : "#6b7280"} 
            width="18px" 
            height="18px"
          />
        </button>
      </div>

      {/* Content Area with Figures */}
      <div
        style={{
          flex: 1,
          padding: "1rem 0.5rem 2rem 0.5rem",
          paddingRight: `calc(0.5rem + ${isSidebarCollapsed ? "60px" : "400px"})`,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "auto",
          alignItems: "center",
          transition: "padding-right 0.3s ease",
          marginBottom: "4rem",
        }}
      >
        {figures.length > 0 ? (
          <div
            style={{
              position: "relative",
              width: "100%",
              maxWidth: "1200px",
              minHeight: "100%",
            }}
          >
            {figures.map((figure, index) => {
              // Calculate size to fit 2 figures per row maximum
              // Container maxWidth: 1200px, padding: ~100px total, gap: 50px
              // So: (1200 - 100 - 50) / 2 = 525px per figure
              // Use 500px to ensure comfortable fit
              return (
                <Figure
                  dashboard_id={figure.dashboard_id}
                  figure_id={figure.figure_id}
                  title={figure.title}
                  figure={figure.figure}
                  table={figure.table}
                  x={figure.x ?? FIGURE_START_X + (index % 2) * (DEFAULT_FIGURE_WIDTH + FIGURE_GAP)}
                  y={figure.y ?? FIGURE_START_Y + Math.floor(index / 2) * (DEFAULT_FIGURE_HEIGHT + FIGURE_GAP)}
                  width={figure.width ?? DEFAULT_FIGURE_WIDTH}
                  height={figure.height ?? DEFAULT_FIGURE_HEIGHT}
                  onTitleChange={(dashboard_id, figure_id, title) => handleFigureUpdate(dashboard_id, figure_id, { title })}
                  onDelete={(dashboard_id, figure_id) => handleFigureDelete(dashboard_id, figure_id)}
                  onPositionChange={(dashboard_id, figure_id, x, y) => handleFigureUpdate(dashboard_id, figure_id, { x, y }, { showAlert: false, silentFail: true })}
                  onSizeChange={(dashboard_id, figure_id, width, height) => handleFigureUpdate(dashboard_id, figure_id, { width, height }, { showAlert: false, silentFail: true })}
                />
              );
            })}
          </div>
        ) : (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <button
              onClick={handleAddFigure}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "120px",
                height: "120px",
                borderRadius: "12px",
                border: "2px dashed #d1d5db",
                background: "#f9fafb",
                cursor: "pointer",
                transition: "all 0.2s",
                flexDirection: "column",
                gap: "0.5rem",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "#3b82f6";
                e.currentTarget.style.background = "#eff6ff";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#d1d5db";
                e.currentTarget.style.background = "#f9fafb";
              }}
            >
              <PlusIcon 
                color="#6b7280" 
                width="2em" 
                height="2em"
                style={{ display: "block" }}
              />
              <span
                style={{
                  fontSize: "0.875rem",
                  color: "#6b7280",
                  fontWeight: 500,
                }}
              >
                Add Figure
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Dashboard Sidebar */}
      <DashboardSidebar 
        isCollapsed={isSidebarCollapsed}
        onCollapseChange={setIsSidebarCollapsed}
        selectedFigureId={selectedFigureId}
        onSelectedFigureChange={setSelectedFigureId}
        figures={figures}
        onFigureUpdate={(id: string, figure: any, table: any, code?: string | null, dataset?: string | null) => {
          // Find the figure to get dashboard_id
          const targetFigure = figures.find(f => f.figure_id === id);
          if (targetFigure) {
            handleFigureUpdate(targetFigure.dashboard_id, id, { figure, table, code, dataset });
          }
        }}
      />
    </div>
  );
}
