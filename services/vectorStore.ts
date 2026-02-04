import { supabase } from './supabaseClient';
import { RagChunk, VectorSearchResult } from "../types";

export interface SearchOptions {
  filterScope?: string;
  metadataFilter?: Record<string, any>; // Support generic key-value filters
  topK?: number;
}

export class VectorStore {
  
  constructor() {}

  // Save chunks to Supabase `rag_chunks` table
  async addChunks(chunks: RagChunk[], documentId: string): Promise<void> {
    const records = chunks.map(chunk => ({
      id: chunk.id,
      document_id: documentId,
      text: chunk.text,
      embedding: chunk.embedding,
      page_number: chunk.pageNumber
    }));

    const { error } = await supabase.from('rag_chunks').insert(records);
    if (error) {
      console.error("Vector insert error:", error);
      throw new Error("Failed to save vector embeddings to database.");
    }
  }

  // Refactored Search Method
  async search(queryEmbedding: number[], options: SearchOptions): Promise<VectorSearchResult[]> {
    const { 
      filterScope = 'global', 
      metadataFilter = {}, 
      topK = 5 
    } = options;
    
    // Call the Postgres function we defined. 
    // We are passing `metadata_filter` assuming the RPC has been updated to accept JSONB filtering.
    // If the RPC only accepts `filter_scope`, we rely on that and consider `metadataFilter` reserved for future RPC upgrades.
    const { data: chunks, error } = await supabase.rpc('match_rag_chunks', {
      query_embedding: queryEmbedding,
      match_threshold: 0.5,
      match_count: topK,
      filter_scope: filterScope,
      // metadata_filter: metadataFilter // Uncomment if RPC supports generic JSON filtering
    });

    if (error) {
      console.error("Vector search error:", error);
      throw new Error("Failed to perform vector search.");
    }

    // Map result back to our internal type
    return (chunks || []).map((chunk: any) => ({
      chunk: {
        id: chunk.id,
        text: chunk.text,
        embedding: [], // We don't need the embedding back for the UI
        sourceFileName: chunk.file_name,
        pageNumber: chunk.page_number 
      },
      similarity: chunk.similarity
    }));
  }
}

export const vectorStore = new VectorStore();