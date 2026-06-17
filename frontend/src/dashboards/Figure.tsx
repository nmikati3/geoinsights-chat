import { useState, useRef, useEffect } from "react";
import { XIcon, PencilIcon } from "../icons";
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-dist-min";
import { DataTable } from "../DataTable";
import {
  FIGURE_HEADER_HEIGHT,
  FIGURE_INNER_MARGIN,
  FIGURE_INNER_BOTTOM_MARGIN,
  FIGURE_MIN_WIDTH,
  FIGURE_MIN_HEIGHT,
  FIGURE_HANDLE_SIZE,
} from "../constants";
import { sanitizePlotlyFigure } from "../utils/responseParser";

const Plot = createPlotlyComponent(Plotly);

interface FigureProps {
  dashboard_id: string;
  figure_id: string;
  title: string;
  figure?: any;
  table?: any;
  x: number;
  y: number;
  width: number;
  height: number;
  onTitleChange: (dashboard_id: string, figure_id: string, title: string) => void;
  onDelete: (dashboard_id: string, figure_id: string) => void;
  onPositionChange: (dashboard_id: string, figure_id: string, x: number, y: number) => void;
  onSizeChange: (dashboard_id: string, figure_id: string, width: number, height: number) => void;
}

type ResizeHandle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se" | null;

export default function Figure(props: FigureProps) {
  const {
    dashboard_id,
    figure_id,
    title,
    figure,
    table,
    x,
    y,
    width,
    height,
    onTitleChange,
    onDelete,
    onPositionChange,
    onSizeChange,
  } = props;

  const figureRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(title);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeHandle, setResizeHandle] = useState<ResizeHandle>(null);

  const dragStart = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({
    mouseX: 0,
    mouseY: 0,
    startX: 0,
    startY: 0,
    startW: 0,
    startH: 0,
  });

  /* =======================
     Sync title
  ======================= */
  useEffect(() => setEditedTitle(title), [title]);

  useEffect(() => {
    if (isEditing) inputRef.current?.focus();
  }, [isEditing]);

  /* =======================
     Global mouse handling
  ======================= */
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      /* ===== DRAGGING ===== */
      if (isDragging && !isResizing) {
        const parent = figureRef.current?.parentElement;
        if (!parent) return;

        const rect = parent.getBoundingClientRect();
        onPositionChange(
          dashboard_id,
          figure_id,
          e.clientX - rect.left - dragStart.current.x,
          e.clientY - rect.top - dragStart.current.y
        );
      }

      /* ===== RESIZING ===== */
      if (isResizing && resizeHandle) {
        const dx = e.clientX - resizeStart.current.mouseX;
        const dy = e.clientY - resizeStart.current.mouseY;

        let newX = resizeStart.current.startX;
        let newY = resizeStart.current.startY;
        let newW = resizeStart.current.startW;
        let newH = resizeStart.current.startH;

        if (resizeHandle.includes("e")) {
          newW = Math.max(FIGURE_MIN_WIDTH, resizeStart.current.startW + dx);
        }

        if (resizeHandle.includes("s")) {
          newH = Math.max(FIGURE_MIN_HEIGHT, resizeStart.current.startH + dy);
        }

        if (resizeHandle.includes("w")) {
          newW = Math.max(FIGURE_MIN_WIDTH, resizeStart.current.startW - dx);
          newX = resizeStart.current.startX + (resizeStart.current.startW - newW);
        }

        if (resizeHandle.includes("n")) {
          newH = Math.max(FIGURE_MIN_HEIGHT, resizeStart.current.startH - dy);
          newY = resizeStart.current.startY + (resizeStart.current.startH - newH);
        }

        onSizeChange(dashboard_id, figure_id, newW, newH);
        onPositionChange(dashboard_id, figure_id, newX, newY);
      }
    }

    function onMouseUp() {
      setIsDragging(false);
      setIsResizing(false);
      setResizeHandle(null);
    }

    if (isDragging || isResizing) {
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [isDragging, isResizing, resizeHandle, dashboard_id, figure_id, onPositionChange, onSizeChange]);

  /* =======================
     Drag & resize start
  ======================= */
  const startDrag = (e: React.MouseEvent) => {
    if (isResizing) return;

    const parent = figureRef.current?.parentElement;
    if (!parent) return;

    const rect = parent.getBoundingClientRect();
    dragStart.current = {
      x: e.clientX - rect.left - x,
      y: e.clientY - rect.top - y,
    };
    setIsDragging(true);
  };

  const startResize = (e: React.MouseEvent, handle: ResizeHandle) => {
    e.preventDefault();
    e.stopPropagation();

    resizeStart.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: x,
      startY: y,
      startW: width,
      startH: height,
    };

    setIsDragging(false);
    setResizeHandle(handle);
    setIsResizing(true);
  };

  /* =======================
     Render
  ======================= */
  return (
    <div
      ref={figureRef}
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        height,
        border: "2px dashed #d1d5db",
        borderRadius: 8,
        background: "#fff",
        overflow: "hidden",
      }}
    >
      {/* HEADER — DRAG HANDLE */}
      <div
        onMouseDown={startDrag}
        style={{
          height: FIGURE_HEADER_HEIGHT,
          padding: "0 0.75rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: isDragging ? "grabbing" : "grab",
          userSelect: "none",
        }}
      >
        {isEditing ? (
          <input
            ref={inputRef}
            value={editedTitle}
            onChange={(e) => setEditedTitle(e.target.value)}
            onBlur={() => {
              onTitleChange(dashboard_id, figure_id, editedTitle.trim() || title);
              setIsEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onTitleChange(dashboard_id, figure_id, editedTitle.trim() || title);
                setIsEditing(false);
              }

              if (e.key === "Escape") {
                e.preventDefault();
                setEditedTitle(title);
                setIsEditing(false);
              }
            }}
            style={{
              width: "100%",
            }}
          />
        ) : (
          <h3 onClick={() => setIsEditing(true)} style={{ margin: 0 }}>
            {title}
          </h3>
        )}

        <div>
          <button onClick={() => setIsEditing(true)}>
            <PencilIcon width="1rem" height="1rem" />
          </button>
          <button onClick={() => onDelete(dashboard_id, figure_id)}>
            <XIcon width="1rem" height="1rem" />
          </button>
        </div>
      </div>

      {/* INNER FRAME */}
      <div
        style={{
          height: `calc(100% - ${FIGURE_HEADER_HEIGHT}px)`,
          padding: FIGURE_INNER_MARGIN,
          paddingBottom: FIGURE_INNER_BOTTOM_MARGIN,
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            width: "100%",
            height: `calc(100% - ${FIGURE_INNER_BOTTOM_MARGIN}px)`,
            overflow: "hidden",
          }}
        >
          {figure ? (() => {
            const safe = sanitizePlotlyFigure(figure);
            return (
              <Plot
                data={safe.data}
                layout={{ ...safe.layout, autosize: true }}
                style={{ width: "100%", height: "100%" }}
                useResizeHandler
                config={{ displaylogo: false }}
              />
            );
          })() : table ? (
            <DataTable data={table} />
          ) : null}
        </div>
      </div>

      {/* RESIZE HANDLES */}
      {[
        { h: "n", s: { top: 0, left: FIGURE_HANDLE_SIZE, right: FIGURE_HANDLE_SIZE, height: FIGURE_HANDLE_SIZE, cursor: "ns-resize" } },
        { h: "s", s: { bottom: 0, left: FIGURE_HANDLE_SIZE, right: FIGURE_HANDLE_SIZE, height: FIGURE_HANDLE_SIZE, cursor: "ns-resize" } },
        { h: "e", s: { right: 0, top: FIGURE_HANDLE_SIZE, bottom: FIGURE_HANDLE_SIZE, width: FIGURE_HANDLE_SIZE, cursor: "ew-resize" } },
        { h: "w", s: { left: 0, top: FIGURE_HANDLE_SIZE, bottom: FIGURE_HANDLE_SIZE, width: FIGURE_HANDLE_SIZE, cursor: "ew-resize" } },
        { h: "nw", s: { top: 0, left: 0, width: FIGURE_HANDLE_SIZE, height: FIGURE_HANDLE_SIZE, cursor: "nwse-resize" } },
        { h: "ne", s: { top: 0, right: 0, width: FIGURE_HANDLE_SIZE, height: FIGURE_HANDLE_SIZE, cursor: "nesw-resize" } },
        { h: "sw", s: { bottom: 0, left: 0, width: FIGURE_HANDLE_SIZE, height: FIGURE_HANDLE_SIZE, cursor: "nesw-resize" } },
        { h: "se", s: { bottom: 0, right: 0, width: FIGURE_HANDLE_SIZE, height: FIGURE_HANDLE_SIZE, cursor: "nwse-resize" } },
      ].map(({ h, s }) => (
        <div
          key={h}
          onMouseDown={(e) => startResize(e, h as ResizeHandle)}
          style={{ position: "absolute", zIndex: 10, ...s }}
        />
      ))}
    </div>
  );
}
