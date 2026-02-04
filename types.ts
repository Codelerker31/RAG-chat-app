export enum Role {
  USER = 'user',
  MODEL = 'model'
}

export interface Message {
  id: string;
  role: Role;
  text: string;
  timestamp: number;
  isStreaming?: boolean;
  sources?: { title: string; page: number }[];
}

export enum ChatType {
  GLOBAL = 'global', // Uses only global RAG
  DEDICATED = 'dedicated' // Uses Global + Private RAG
}

export interface ChatSession {
  id: string;
  title: string;
  type: ChatType;
  messages: Message[];
  createdAt: number;
}

export interface RagChunk {
  id: string;
  text: string;
  embedding: number[];
  sourceFileName: string;
  pageNumber?: number;
}

export interface RagDocument {
  id: string;
  fileName: string;
  uploadTimestamp: number;
  scope: 'global' | string; // 'global' or chatSessionId
  chunkCount: number;
}

export interface VectorSearchResult {
  chunk: RagChunk;
  similarity: number;
}