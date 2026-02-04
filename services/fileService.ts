import { RagChunk } from "../types";

// Declare global PDFJS variable from the CDN script
declare global {
  interface Window {
    pdfjsLib: any;
  }
}

// Configure worker
if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

const CHUNK_SIZE = 500; // Characters per chunk (approx)
const OVERLAP = 50;

export const parsePdf = async (file: File): Promise<{ text: string; page: number }[]> => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  const pages: { text: string; page: number }[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item: any) => item.str).join(' ');
    pages.push({ text: pageText, page: i });
  }

  return pages;
};

export const chunkText = (pages: { text: string; page: number }[], fileName: string): Omit<RagChunk, 'id' | 'embedding'>[] => {
  const chunks: Omit<RagChunk, 'id' | 'embedding'>[] = [];

  pages.forEach(({ text, page }) => {
    // Simple sliding window chunking
    // In production, split by sentence or paragraph preferably
    for (let i = 0; i < text.length; i += (CHUNK_SIZE - OVERLAP)) {
      const chunkText = text.slice(i, i + CHUNK_SIZE);
      if (chunkText.length > 50) { // Filter extremely short chunks
        chunks.push({
          text: chunkText,
          sourceFileName: fileName,
          pageNumber: page
        });
      }
    }
  });

  return chunks;
};