import { createWorker } from 'tesseract.js';
import { RagChunk } from "../types";
import * as pdfjsLib from 'pdfjs-dist';

// Set worker source to local public file to avoid CORS/version issues
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

const CHUNK_SIZE = 500; // Characters per chunk (approx)
const OVERLAP = 50;

export const parsePdf = async (file: File): Promise<{ text: string; page: number }[]> => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pages: { text: string; page: number }[] = [];
  let worker: Tesseract.Worker | null = null;

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    let pageText = textContent.items.map((item: any) => item.str).join(' ');

    // Heuristic: If text is missing or too short, assume image-based PDF
    if (pageText.trim().length < 20) {
      console.log(`Page ${i} appears to be an image. Attempting OCR...`);

      // Initialize OCR worker if needed
      if (!worker) {
        worker = await createWorker('eng');
      }

      try {
        const viewport = page.getViewport({ scale: 2.0 }); // High scale for better OCR
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        if (context) {
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          await page.render({
            canvasContext: context,
            viewport: viewport,
            canvasFactory: undefined // Optional, but might shut up ts if it's looking for something else?
            // Actually, just casting might be safer if types are strict
          } as any).promise;

          const imageBlob = await new Promise<Blob | null>(resolve =>
            canvas.toBlob(resolve, 'image/png')
          );

          if (imageBlob) {
            const { data: { text } } = await worker.recognize(imageBlob);
            pageText = text;
            console.log(`OCR Result (Page ${i}):`, text.substring(0, 50) + "...");
          }
        }
      } catch (ocrError) {
        console.error(`OCR failed for page ${i}`, ocrError);
      }
    }

    pages.push({ text: pageText, page: i });
  }

  if (worker) {
    await worker.terminate();
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