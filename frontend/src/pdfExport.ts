import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import Plotly from 'plotly.js-dist-min';
import { type Message } from './App';
import { logger } from './utils/logger';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isValidUrl(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return lower.startsWith('http://') || lower.startsWith('https://');
}

export async function exportMessageToPDF(message: Message, messageIndex: number): Promise<void> {
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageWidth = 210; // A4 width in mm
  const pageHeight = 297; // A4 height in mm
  const margin = 15;
  const contentWidth = pageWidth - 2 * margin;
  let yPosition = margin;
  const lineHeight = 7;

  // Helper to add a new page if needed
  const checkPageBreak = (requiredHeight: number) => {
    if (yPosition + requiredHeight > pageHeight - margin) {
      pdf.addPage();
      yPosition = margin;
      return true;
    }
    return false;
  };

  // Add title
  pdf.setFontSize(16);
  pdf.setFont('helvetica', 'bold');
  pdf.text('', margin, yPosition);
  yPosition += lineHeight * 1.5;

  // Helper function to process inline markdown (bold, italic, links)
  function processInlineMarkdown(text: string): { text: string; formats: Array<{ start: number; end: number; type: 'bold' | 'italic' | 'link'; url?: string }> } {
    const formats: Array<{ start: number; end: number; type: 'bold' | 'italic' | 'link'; url?: string }> = [];
    let processedText = text;
    
    // Helper function to adjust format positions after text modification
    const adjustFormatsAfter = (modifyIndex: number, lengthRemoved: number) => {
      formats.forEach(f => {
        if (f.start > modifyIndex) {
          f.start -= lengthRemoved;
          f.end -= lengthRemoved;
        } else if (f.end > modifyIndex) {
          // Format overlaps modification point - adjust end only
          f.end -= lengthRemoved;
        }
      });
    };
    
    // Process bold (**text**) first - manually find and process to avoid regex issues
    const boldMatches: Array<{ fullMatch: string; text: string; index: number }> = [];
    let searchIndex = 0;
    while (searchIndex < processedText.length) {
      const boldStart = processedText.indexOf('**', searchIndex);
      if (boldStart === -1) break;
      
      const boldEnd = processedText.indexOf('**', boldStart + 2);
      if (boldEnd === -1) break;
      
      const boldText = processedText.substring(boldStart + 2, boldEnd);
      boldMatches.push({
        fullMatch: '**' + boldText + '**',
        text: boldText,
        index: boldStart
      });
      
      searchIndex = boldEnd + 2;
    }
    
    // Process bold matches in reverse order to maintain indices
    for (let i = boldMatches.length - 1; i >= 0; i--) {
      const match = boldMatches[i];
      const lengthRemoved = match.fullMatch.length - match.text.length;
      const beforeBold = processedText.substring(0, match.index);
      const afterBold = processedText.substring(match.index + match.fullMatch.length);
      processedText = beforeBold + match.text + afterBold;
      
      // Adjust existing format positions
      adjustFormatsAfter(match.index, lengthRemoved);
      
      // Record format position
      formats.push({ 
        start: match.index, 
        end: match.index + match.text.length, 
        type: 'bold' 
      });
    }
    
    // Process italic (*text* or _text_) - but not if it's part of bold
    const italicMatches: Array<{ fullMatch: string; text: string; index: number }> = [];
    // Match single * or _ but not **
    const italicRegex = /(?<!\*)\*([^*\n]+)\*(?!\*)|(?<!_)_([^_\n]+)_(?!_)/g;
    let italicMatch;
    while ((italicMatch = italicRegex.exec(processedText)) !== null) {
      const italicText = italicMatch[1] || italicMatch[2];
      italicMatches.push({
        fullMatch: italicMatch[0],
        text: italicText,
        index: italicMatch.index
      });
    }
    
    // Process italic matches in reverse order
    for (let i = italicMatches.length - 1; i >= 0; i--) {
      const match = italicMatches[i];
      const startPos = match.index;
      const endPos = startPos + match.text.length;
      
      // Check if this range overlaps with any bold formatting
      const overlapsBold = formats.some(f => f.type === 'bold' && 
        (startPos >= f.start && startPos < f.end) || 
        (endPos > f.start && endPos <= f.end) ||
        (startPos < f.start && endPos > f.end));
      
      if (!overlapsBold) {
        const lengthRemoved = match.fullMatch.length - match.text.length;
        const beforeItalic = processedText.substring(0, match.index);
        const afterItalic = processedText.substring(match.index + match.fullMatch.length);
        processedText = beforeItalic + match.text + afterItalic;
        
        // Adjust existing format positions
        adjustFormatsAfter(match.index, lengthRemoved);
        
        formats.push({ 
          start: startPos, 
          end: endPos, 
          type: 'italic' 
        });
      }
    }
    
    // Process links last (after bold/italic, so positions are correct)
    const linkMatches: Array<{ fullMatch: string; text: string; url: string; index: number }> = [];
    const linkRegex = /\[([^\]]+)\]\(([^\)]+)\)/g;
    let linkMatch;
    while ((linkMatch = linkRegex.exec(processedText)) !== null) {
      const linkText = linkMatch[1];
      const linkUrl = linkMatch[2];
      linkMatches.push({
        fullMatch: linkMatch[0],
        text: linkText,
        url: linkUrl,
        index: linkMatch.index
      });
    }
    
    // Process links in reverse order to maintain indices
    for (let i = linkMatches.length - 1; i >= 0; i--) {
      const match = linkMatches[i];
      const lengthRemoved = match.fullMatch.length - match.text.length;
      const beforeLink = processedText.substring(0, match.index);
      const afterLink = processedText.substring(match.index + match.fullMatch.length);
      processedText = beforeLink + match.text + afterLink;
      
      // Adjust existing format positions
      adjustFormatsAfter(match.index, lengthRemoved);
      
      // Record format position - mark just the link text, store URL separately
      formats.push({ 
        start: match.index, 
        end: match.index + match.text.length, 
        type: 'link',
        url: match.url
      });
    }
    
    // Sort formats by start position
    formats.sort((a, b) => a.start - b.start);
    
    return { text: processedText, formats };
  }
  
  // Add text content with markdown formatting
  if (message.content && message.content.trim()) {
    // Parse and render markdown content
    const lines = message.content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      
      // Check for headers
      const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headerMatch) {
        const headerLevel = headerMatch[1].length;
        const headerText = headerMatch[2];
        
        // Set font size based on header level
        const headerSizes: { [key: number]: number } = {
          1: 18,
          2: 16,
          3: 14,
          4: 13,
          5: 12,
          6: 11
        };
        
        pdf.setFontSize(headerSizes[headerLevel] || 12);
        
        // Render header with formatting - process markdown first, then wrap
        const headerEndY = renderFormattedTextWithWrapping(pdf, headerText, margin, yPosition, contentWidth, headerSizes[headerLevel] || 12, true);
        // Add spacing after header (headerEndY already includes line height, so just add extra spacing)
        yPosition = headerEndY + lineHeight * 1.2; // Extra spacing between header and next content
        continue;
      }
      
      // Check for horizontal dividers (---, ***, or ___)
      const dividerMatch = line.match(/^(\*{3,}|-{3,}|_{3,})$/);
      if (dividerMatch) {
        // Add spacing before divider
        yPosition += lineHeight * 0.5;
        
        // Check page break
        if (yPosition > pageHeight - margin - lineHeight) {
          pdf.addPage();
          yPosition = margin;
        }
        
        // Draw horizontal line
        const lineY = yPosition;
        pdf.setDrawColor(200, 200, 200); // Light gray color
        pdf.setLineWidth(0.5); // Thin line
        pdf.line(margin, lineY, margin + contentWidth, lineY);
        
        // Add spacing after divider
        yPosition += lineHeight * 1.0;
        continue;
      }
      
      // Regular text line
      if (line.trim()) {
        pdf.setFontSize(12);
        const textEndY = renderFormattedTextWithWrapping(pdf, line, margin, yPosition, contentWidth, 12, false);
        yPosition = textEndY + lineHeight * 0.3; // Small spacing between paragraphs
      } else {
        // Empty line - add spacing
        yPosition += lineHeight * 0.5;
      }
    }
    
    yPosition += lineHeight * 0.5; // Add spacing after text block
  }
  
  // Helper function to render formatted text with proper wrapping
  function renderFormattedTextWithWrapping(
    pdf: jsPDF, 
    originalText: string, 
    startX: number, 
    startY: number, 
    maxWidth: number,
    fontSize: number,
    isHeader: boolean
  ): number {
    pdf.setFontSize(fontSize);
    let currentY = startY;
    let currentX = startX;
    
    // Process markdown to get formatted segments
    const processed = processInlineMarkdown(originalText);
    
    // Group consecutive characters by format
    const segments: Array<{ text: string; bold: boolean; italic: boolean; isLink: boolean; url?: string }> = [];
    let currentSegment = { text: '', bold: false, italic: false, isLink: false, url: undefined as string | undefined };
    
    for (let i = 0; i < processed.text.length; i++) {
      const formatsAtPos = processed.formats.filter(f => i >= f.start && i < f.end);
      const isBold = formatsAtPos.some(f => f.type === 'bold') || isHeader;
      const isItalic = formatsAtPos.some(f => f.type === 'italic');
      const linkFormat = formatsAtPos.find(f => f.type === 'link');
      const isLink = !!linkFormat;
      const linkUrl = linkFormat?.url;
      
      if (currentSegment.text === '' || 
          currentSegment.bold !== isBold || 
          currentSegment.italic !== isItalic ||
          currentSegment.isLink !== isLink ||
          currentSegment.url !== linkUrl) {
        if (currentSegment.text) {
          segments.push(currentSegment);
        }
        currentSegment = { 
          text: processed.text[i], 
          bold: isBold, 
          italic: isItalic, 
          isLink: isLink,
          url: linkUrl
        };
      } else {
        currentSegment.text += processed.text[i];
      }
    }
    
    if (currentSegment.text) {
      segments.push(currentSegment);
    }
    
    // Render segments with word-level wrapping
    segments.forEach(segment => {
      pdf.setFont('helvetica', segment.bold ? (segment.italic ? 'bolditalic' : 'bold') : (segment.italic ? 'italic' : 'normal'));
      pdf.setFontSize(fontSize);
      
      // Split segment into words and spaces, preserving both
      const parts: Array<{ text: string; isSpace: boolean }> = [];
      const wordRegex = /\S+|\s+/g;
      let match;
      while ((match = wordRegex.exec(segment.text)) !== null) {
        parts.push({
          text: match[0],
          isSpace: /^\s+$/.test(match[0])
        });
      }
      
      parts.forEach(part => {
        pdf.setFont('helvetica', segment.bold ? (segment.italic ? 'bolditalic' : 'bold') : (segment.italic ? 'italic' : 'normal'));
        pdf.setFontSize(fontSize);
        
        // Set link styling (blue color)
        if (segment.isLink && !part.isSpace) {
          pdf.setTextColor(0, 0, 255); // Blue color for links
        } else {
          pdf.setTextColor(0, 0, 0); // Black for regular text
        }
        
        const partWidth = pdf.getTextWidth(part.text);
        const currentLineHeight = lineHeight * (isHeader ? 1.2 : 1);
        
        // For spaces at start of line, skip them
        if (part.isSpace && currentX === startX) {
          return; // Skip leading spaces
        }
        
        // Check if we need a new line (horizontal wrapping)
        if (currentX > startX && currentX + partWidth > startX + maxWidth) {
          // If it's a space, skip it (we're wrapping)
          if (part.isSpace) {
            return;
          }
          
          // Move to next line
          currentY += currentLineHeight;
          currentX = startX;
          
          // Check page break after moving to new line
          // Ensure we have enough space for the current line plus a buffer
          if (currentY + fontSize * 0.5 > pageHeight - margin) {
            pdf.addPage();
            currentY = margin;
            currentX = startX;
          }
        }
        
        // Check page break before rendering - ensure we have space for the text
        // Use fontSize as a safe buffer (accounts for descenders and line spacing)
        if (currentY + fontSize > pageHeight - margin) {
          pdf.addPage();
          currentY = margin;
          currentX = startX;
        }
        
        // Render the part
        pdf.text(part.text, currentX, currentY);
        
        // Make links clickable and draw underline (only for validated http/https URLs)
        if (segment.isLink && !part.isSpace && segment.url && isValidUrl(segment.url)) {
          pdf.link(currentX, currentY - fontSize * 0.7, partWidth, fontSize * 0.8, { url: segment.url });

          // Draw underline for links
          const underlineY = currentY + 1; // Slightly below baseline
          pdf.setDrawColor(0, 0, 255); // Blue underline
          pdf.setLineWidth(0.1);
          pdf.line(currentX, underlineY, currentX + partWidth, underlineY);
          pdf.setDrawColor(0, 0, 0); // Reset draw color to black
        }
        
        // Reset text color after rendering (for next part)
        pdf.setTextColor(0, 0, 0);
        
        currentX += partWidth;
      });
    });
    
    // Return the bottom of the last line (currentY is the baseline, add line height)
    return currentY + (lineHeight * (isHeader ? 1.2 : 1));
  }

  // Handle figures (Plotly charts)
  if (message.figures && message.figures.length > 0) {
    for (let i = 0; i < message.figures.length; i++) {
      const figure = message.figures[i];
      try {
        const figureData = typeof figure === 'string' ? JSON.parse(figure) : figure;
        
        // Create a temporary div to render the plot
        const tempDiv = document.createElement('div');
        tempDiv.style.width = '800px';
        tempDiv.style.height = '600px';
        tempDiv.style.position = 'absolute';
        tempDiv.style.left = '-9999px';
        document.body.appendChild(tempDiv);

        // Render Plotly chart
        await Plotly.newPlot(tempDiv, figureData.data, figureData.layout, {
          displayModeBar: false,
          staticPlot: true,
        });

        // Wait for chart to render
        await new Promise(resolve => setTimeout(resolve, 500));

        // Convert to image using Plotly's toImage method
        const imgData = await new Promise<string>((resolve, reject) => {
          Plotly.toImage(tempDiv, {
            format: 'png',
            width: 800,
            height: 600,
          })
            .then((dataUrl: string) => resolve(dataUrl))
            .catch((error: any) => reject(error));
        });

        // Clean up
        document.body.removeChild(tempDiv);

        // Add image to PDF
        const img = new Image();
        img.src = imgData;

        await new Promise((resolve) => {
          img.onload = () => {
            const imgWidth = contentWidth;
            const imgHeight = (img.height * imgWidth) / img.width;
            
            checkPageBreak(imgHeight + lineHeight);
            
            pdf.addImage(imgData, 'PNG', margin, yPosition, imgWidth, imgHeight);
            yPosition += imgHeight + lineHeight;
            resolve(null);
          };
        });
      } catch (error) {
        logger.error('Error exporting figure to PDF:', error);
        // Add error text instead
        pdf.setFontSize(10);
        pdf.setTextColor(255, 0, 0);
        checkPageBreak(lineHeight);
        pdf.text(`Error exporting chart ${i + 1}`, margin, yPosition);
        yPosition += lineHeight;
        pdf.setTextColor(0, 0, 0);
      }
    }
  }

  // Handle tables
  if (message.tables && message.tables.length > 0) {
    for (let i = 0; i < message.tables.length; i++) {
      const table = message.tables[i];
      try {
        const tableData = typeof table === 'string' ? JSON.parse(table) : table;
        
        if (Array.isArray(tableData) && tableData.length > 0) {
          // Create a temporary div to render the table
          const tempDiv = document.createElement('div');
          tempDiv.style.width = '800px';
          tempDiv.style.position = 'absolute';
          tempDiv.style.left = '-9999px';
          tempDiv.style.backgroundColor = '#ffffff';
          document.body.appendChild(tempDiv);

          // Get headers
          const headers = Object.keys(tableData[0]);
          
          // Create table HTML
          let tableHTML = '<table style="border-collapse: collapse; width: 100%; font-size: 10px;">';
          
          // Header row
          tableHTML += '<thead><tr style="background-color: #f9fafb;">';
          headers.forEach(header => {
            tableHTML += `<th style="border: 1px solid #e5e7eb; padding: 8px; text-align: left; font-weight: bold;">${escapeHtml(header)}</th>`;
          });
          tableHTML += '</tr></thead>';
          
          // Data rows
          tableHTML += '<tbody>';
          tableData.forEach((row: any) => {
            tableHTML += '<tr>';
            headers.forEach(header => {
              const value = row[header];
              const displayValue = value === null || value === undefined ? '' : String(value);
              tableHTML += `<td style="border: 1px solid #e5e7eb; padding: 8px;">${escapeHtml(displayValue)}</td>`;
            });
            tableHTML += '</tr>';
          });
          tableHTML += '</tbody></table>';
          
          tempDiv.innerHTML = tableHTML;

          // Wait for rendering
          await new Promise(resolve => setTimeout(resolve, 100));

          // Convert to image
          const canvas = await html2canvas(tempDiv, {
            scale: 2,
            backgroundColor: '#ffffff',
          });

          // Clean up
          document.body.removeChild(tempDiv);

          const imgData = canvas.toDataURL('image/png');
          const imgWidth = contentWidth;
          const imgHeight = (canvas.height * imgWidth) / canvas.width;

          checkPageBreak(imgHeight + lineHeight);

          pdf.addImage(imgData, 'PNG', margin, yPosition, imgWidth, imgHeight);
          yPosition += imgHeight + lineHeight;
        }
      } catch (error) {
        logger.error('Error exporting table to PDF:', error);
        // Add error text instead
        pdf.setFontSize(10);
        pdf.setTextColor(255, 0, 0);
        checkPageBreak(lineHeight);
        pdf.text(`Error exporting table ${i + 1}`, margin, yPosition);
        yPosition += lineHeight;
        pdf.setTextColor(0, 0, 0);
      }
    }
  }

  // Save PDF
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  pdf.save(`chat-response-${messageIndex}-${timestamp}.pdf`);
}

