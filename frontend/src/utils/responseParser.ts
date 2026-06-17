/**
 * Parses API response objects to extract figures, tables, and other_results.
 * Handles various response formats:
 * - Direct figures array
 * - Nested objects structure
 * - Single fig_dict object at root level
 */
export interface ParsedResponse {
  figures: any[];
  tables: any[];
  other_results: any[];
}

export function parseResponseObjects(response: any): ParsedResponse {
  let figures: any[] = [];
  let tables: any[] = [];
  let other_results: any[] = [];

  if (response.figures) {
    // Direct figures array
    figures = Array.isArray(response.figures) ? response.figures : [response.figures];
  } else if (response.objects && response.object_types) {
    // Nested structure: objects array contains objects with figures/tables/other_results
    response.objects.forEach((obj: any) => {
      // obj can be a string (JSON) or an object
      const parsedObj = typeof obj === "string" ? JSON.parse(obj) : obj;

      // Check if this object has figures, tables, or other_results
      if (parsedObj.figures) {
        const objFigures = Array.isArray(parsedObj.figures) ? parsedObj.figures : [parsedObj.figures];
        figures.push(...objFigures);
      }
      if (parsedObj.tables) {
        const objTables = Array.isArray(parsedObj.tables) ? parsedObj.tables : [parsedObj.tables];
        tables.push(...objTables);
      }
      if (parsedObj.other_results) {
        const objOther = Array.isArray(parsedObj.other_results) ? parsedObj.other_results : [parsedObj.other_results];
        other_results.push(...objOther);
      }
    });
  } else if (response.data && response.layout) {
    // Single fig_dict object at root level
    figures = [{ data: response.data, layout: response.layout, frames: response.frames || [] }];
  }

  // Also check for direct tables and other_results at root level
  if (response.tables && tables.length === 0) {
    tables = Array.isArray(response.tables) ? response.tables : [response.tables];
  }
  if (response.other_results && other_results.length === 0) {
    other_results = Array.isArray(response.other_results) ? response.other_results : [response.other_results];
  }

  return { figures, tables, other_results };
}

// ---------------------------------------------------------------------------
// Plotly figure sanitisation — strips HTML from text fields that Plotly renders
// as HTML by default (text, hovertext, name, hovertemplate) and blocks image
// traces which can load arbitrary external URLs for tracking/exfiltration.
// ---------------------------------------------------------------------------
function stripHtmlTags(str: string): string {
  return str.replace(/<[^>]*>/g, '');
}

function sanitizeTextField(value: any): any {
  if (typeof value === 'string') return stripHtmlTags(value);
  if (Array.isArray(value)) return value.map((v: any) => (typeof v === 'string' ? stripHtmlTags(v) : v));
  return value;
}

export function sanitizePlotlyFigure(figureData: any): any {
  if (!figureData || !figureData.data || !Array.isArray(figureData.data)) return figureData;

  const textFields = ['text', 'hovertext', 'name', 'hovertemplate'];

  const sanitizedData = figureData.data.map((trace: any) => {
    if (!trace || typeof trace !== 'object') return trace;

    // Block image traces — they can fetch arbitrary URLs
    if (trace.type === 'image') {
      return { type: 'scatter', x: [], y: [], mode: 'markers' };
    }

    const sanitized = { ...trace };
    for (const field of textFields) {
      if (field in sanitized) {
        sanitized[field] = sanitizeTextField(sanitized[field]);
      }
    }
    return sanitized;
  });

  // Sanitise layout title and axis titles
  const layout = figureData.layout ? { ...figureData.layout } : {};
  if (typeof layout.title === 'string') {
    layout.title = stripHtmlTags(layout.title);
  } else if (layout.title && typeof layout.title === 'object' && typeof layout.title.text === 'string') {
    layout.title = { ...layout.title, text: stripHtmlTags(layout.title.text) };
  }
  for (const axis of ['xaxis', 'yaxis', 'zaxis']) {
    if (layout[axis]) {
      layout[axis] = { ...layout[axis] };
      if (typeof layout[axis].title === 'string') {
        layout[axis].title = stripHtmlTags(layout[axis].title);
      } else if (layout[axis].title && typeof layout[axis].title === 'object' && typeof layout[axis].title.text === 'string') {
        layout[axis].title = { ...layout[axis].title, text: stripHtmlTags(layout[axis].title.text) };
      }
    }
  }

  return { ...figureData, data: sanitizedData, layout };
}
