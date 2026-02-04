import { GoogleGenAI, EmbedContentResponse } from "@google/genai";
import { Message, Role } from "../types";

// Initialize Gemini Client
// In a real app, strict error handling for missing API KEY is needed.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

// Model Constants
const CHAT_MODEL = 'gemini-3-flash-preview';
const EMBEDDING_MODEL = 'text-embedding-004';
const MAX_HISTORY_TURNS = 15; // Limit history to last 15 user-model exchanges (30 messages)

export const generateEmbedding = async (text: string): Promise<number[]> => {
  if (!process.env.API_KEY) throw new Error("API Key missing");
  if (!text || !text.trim()) {
      console.warn("Attempted to generate embedding for empty text");
      return []; 
  }
  
  try {
    // Explicitly structure the content to avoid ambiguity with string inputs in embedContent
    // Using 'any' for result to accommodate potential SDK response variations (embedding vs embeddings)
    const result: any = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: {
          parts: [{ text: text }]
      }
    });

    // The API might return 'embedding' (singular) or 'embeddings' (plural array) depending on exact endpoint behavior
    const embeddingValues = result.embedding?.values || result.embeddings?.[0]?.values;

    if (!embeddingValues) {
      // In case of failure without throwing, checking response structure helps
      console.error("Embedding response missing values:", JSON.stringify(result));
      throw new Error("Failed to generate embedding");
    }

    return embeddingValues;
  } catch (error) {
    console.error("Embedding generation error:", error);
    throw error;
  }
};

export const generateChatTitle = async (firstUserMessage: string): Promise<string> => {
    if (!process.env.API_KEY) return "New Chat";

    try {
        const response = await ai.models.generateContent({
            model: CHAT_MODEL,
            contents: `Generate a very concise title (max 5 words) for a chat conversation that begins with the following message. Do not use quotes. Message: "${firstUserMessage}"`,
        });
        return response.text?.trim() || "New Chat";
    } catch (e) {
        console.error("Title generation failed", e);
        return "New Chat";
    }
}

export const generateRagResponse = async (
  history: Message[],
  contextChunks: { text: string; sourceFileName: string; pageNumber?: number }[],
  onChunk: (text: string) => void
): Promise<string> => {
  if (!process.env.API_KEY) throw new Error("API Key missing");

  const contextText = contextChunks.map(c => 
    `[Source: ${c.sourceFileName}, Page: ${c.pageNumber || 'N/A'}]\n${c.text}`
  ).join("\n\n---\n\n");
  
  const systemInstruction = `
You are a helpful AI assistant. You have access to a RAG (Retrieval Augmented Generation) database.
Use the following pieces of retrieved context to answer the user's question. 
If the answer is not in the context, just say that you don't know based on the provided documents, but you can try to answer from general knowledge if explicitly asked.
Keep answers concise and relevant.

Context:
${contextText}
`;

  // Filter history for the model and limit context size
  const fullChatHistory = history.map(msg => ({
    role: msg.role === Role.USER ? 'user' : 'model',
    parts: [{ text: msg.text }]
  }));

  // Get the last user message
  const lastMessage = fullChatHistory.pop();
  if (!lastMessage || !lastMessage.parts[0].text) {
     throw new Error("No user message found");
  }

  // Slice history to prioritize recent messages
  const recentHistory = fullChatHistory.slice(-(MAX_HISTORY_TURNS * 2));

  try {
    const chat = ai.chats.create({
      model: CHAT_MODEL,
      history: recentHistory, // Provide limited previous context
      config: {
        systemInstruction: systemInstruction,
      }
    });

    const result = await chat.sendMessageStream({
        message: lastMessage.parts[0].text
    });

    let fullText = "";
    for await (const chunk of result) {
      const text = chunk.text; // Access .text property directly
      if (text) {
        fullText += text;
        onChunk(fullText);
      }
    }
    return fullText;

  } catch (error) {
    console.error("Chat generation error:", error);
    throw error;
  }
};