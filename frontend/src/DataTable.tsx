import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useState } from 'react';
import { DownloadIcon } from './icons';

interface DataTableProps {
  data: Record<string, any>[];
}

// Helper function to detect and format dates
function formatValue(value: any): string {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return '';
  }

  // Check if it's a number that could be a timestamp
  if (typeof value === 'number') {
    // Check if it's a timestamp (milliseconds since epoch)
    // Timestamps are typically 13 digits (milliseconds) or 10 digits (seconds)
    const numStr = value.toString();
    const isTimestamp = 
      (numStr.length === 13 && value > 1000000000000) || // milliseconds (after year 2001)
      (numStr.length === 10 && value > 1000000000); // seconds (after year 2001)
    
    if (isTimestamp) {
      // Convert to milliseconds if it's in seconds
      const timestamp = numStr.length === 10 ? value * 1000 : value;
      try {
        const date = new Date(timestamp);
        // Check if the date is valid
        if (!isNaN(date.getTime())) {
          return date.toLocaleString();
        }
      } catch (e) {
        // If date parsing fails, fall through to number formatting
      }
    }
    
    // Format regular numbers with commas
    return value.toLocaleString();
  }

  // Check if it's a string that could be a numeric timestamp
  if (typeof value === 'string') {
    const numValue = Number(value);
    if (!isNaN(numValue) && value.trim() === numValue.toString()) {
      const numStr = numValue.toString();
      const isTimestamp = 
        (numStr.length === 13 && numValue > 1000000000000) ||
        (numStr.length === 10 && numValue > 1000000000);
      
      if (isTimestamp) {
        const timestamp = numStr.length === 10 ? numValue * 1000 : numValue;
        try {
          const date = new Date(timestamp);
          if (!isNaN(date.getTime())) {
            return date.toLocaleString();
          }
        } catch (e) {
          // Fall through to return string as-is
        }
      }
    }
  }

  return String(value);
}

// Helper function to convert data to CSV format
function convertToCSV(data: Record<string, any>[]): string {
  if (data.length === 0) return '';

  // Get headers from the first row
  const headers = Object.keys(data[0]);
  
  // Create CSV header row
  const headerRow = headers.map(header => {
    // Escape quotes and wrap in quotes if contains comma, newline, or quote
    const escaped = String(header).replace(/"/g, '""');
    return `"${escaped}"`;
  }).join(',');

  // Create CSV data rows
  const dataRows = data.map(row => {
    return headers.map(header => {
      const value = row[header];
      // Handle null/undefined
      if (value === null || value === undefined) {
        return '""';
      }
      // Convert to string and escape quotes
      const stringValue = String(value).replace(/"/g, '""');
      // Wrap in quotes if contains comma, newline, or quote
      if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
        return `"${stringValue}"`;
      }
      return stringValue;
    }).join(',');
  });

  return [headerRow, ...dataRows].join('\n');
}

// Helper function to download CSV
function downloadCSV(csvContent: string, filename: string = 'table.csv') {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
}

export function DataTable({ data }: DataTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleDownloadCSV = () => {
    const csvContent = convertToCSV(data);
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    downloadCSV(csvContent, `table-${timestamp}.csv`);
  };

  // Generate columns from the first row's keys
  const columns: ColumnDef<Record<string, any>>[] =
    data.length > 0
      ? Object.keys(data[0]).map((key) => ({
          accessorKey: key,
          header: key,
          cell: (info) => {
            const value = info.getValue();
            return formatValue(value);
          },
        }))
      : [];

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rowCount = data.length;

  return (
    <div style={{ marginBottom: '1rem', position: 'relative' }}>
      {/* Header with row count and expand/collapse button */}
      {data.length > 0 && (
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '0.5rem',
          padding: '0.5rem 0.75rem',
          background: '#f9fafb',
          borderRadius: '6px',
          border: '1px solid #e5e7eb'
        }}>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            style={{
              padding: '0.5rem 0.75rem',
              background: 'transparent',
              color: '#111827',
              border: '1px solid #d2d6db',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#f3f4f6';
              e.currentTarget.style.borderColor = '#9ca3af';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.borderColor = '#d2d6db';
            }}
            title={isExpanded ? "Collapse table" : "Expand table"}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            {isExpanded ? 'Collapse' : 'Expand'} Table ({rowCount} {rowCount === 1 ? 'row' : 'rows'})
          </button>
          <button
            onClick={handleDownloadCSV}
            style={{
              padding: '0.5rem 0.75rem',
              background: '#111827',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              transition: 'background-color 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#374151';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#111827';
            }}
            title="Download as CSV"
          >
            <DownloadIcon width="16" height="16" />
            Download CSV
          </button>
        </div>
      )}
      {isExpanded && (
        <div style={{ borderRadius: '8px', border: '1px solid #e5e7eb', overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.875rem',
              tableLayout: 'fixed', // Fixed layout to enforce column widths and row heights
            }}
          >
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    const sortDirection = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                        style={{
                          padding: '0.75rem 1rem',
                          borderBottom: '2px solid #e5e7eb',
                          background: '#f9fafb',
                          width: '15rem',
                          fontWeight: 600,
                          textAlign: 'left',
                          cursor: canSort ? 'pointer' : 'default',
                          userSelect: 'none',
                          position: 'relative',
                          transition: 'background-color 0.2s',
                        }}
                        onMouseEnter={(e) => {
                          if (canSort) {
                            e.currentTarget.style.backgroundColor = '#f3f4f6';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (canSort) {
                            e.currentTarget.style.backgroundColor = '#f9fafb';
                          }
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                          }}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {canSort && (
                            <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                              {sortDirection === 'asc' ? '↑' : sortDirection === 'desc' ? '↓' : '⇅'}
                            </span>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  style={{
                    borderBottom: '1px solid #e5e7eb',
                    transition: 'background-color 0.15s',
                    height: '3rem', // Fixed row height
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#f9fafb';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      style={{
                        padding: '0',
                        color: '#111827',
                        height: '5rem', // Fixed cell height
                        maxHeight: '5rem', // Ensure max height
                        verticalAlign: 'top', // Align content to top
                        position: 'relative', // For proper overflow handling
                      }}
                    >
                      <div
                        style={{
                          padding: '0.75rem 1rem',
                          height: '100%',
                          maxHeight: '5rem',
                          overflow: 'auto',
                          wordBreak: 'break-word',
                          boxSizing: 'border-box',
                        }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.length === 0 && (
        <div
          style={{
            padding: '2rem',
            textAlign: 'center',
            color: '#6b7280',
          }}
        >
          No data available
        </div>
      )}
    </div>
  );
}

