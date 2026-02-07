
import { Message, Role } from "../types";

const PROXY_URL = '/api/gemini';

// Model Constants
const CHAT_MODEL = 'gemini-3-flash-preview';
const EMBEDDING_MODEL = 'gemini-embedding-001';
const MAX_HISTORY_TURNS = 15;

async function callGeminiProxy(action: string, payload: any): Promise<any> {
  const response = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Gemini Proxy Error Details:", errorText);
    throw new Error(`Gemini Proxy Error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  // Handle streaming response separately if needed, but for simple JSON:
  if (response.headers.get('content-type')?.includes('application/json')) {
    return response.json();
  }
  return response;
}

export const generateEmbedding = async (text: string): Promise<number[]> => {
  if (!text || !text.trim()) {
    console.warn("Attempted to generate embedding for empty text");
    return [];
  }

  try {
    const result = await callGeminiProxy('embedding', {
      model: EMBEDDING_MODEL,
      text: text,
      outputDimensionality: 768
    });

    // The proxy should return { values: [...] }
    if (!result.values) {
      console.error("Embedding response missing values:", JSON.stringify(result));
      throw new Error("Failed to generate embedding");
    }
    return result.values;
  } catch (error) {
    console.error("Embedding generation error:", error);
    throw error;
  }
};

export const generateChatTitle = async (firstUserMessage: string): Promise<string> => {
  try {
    const result = await callGeminiProxy('generate-content', {
      model: CHAT_MODEL,
      contents: {
        parts: [{ text: `Generate a very concise title (max 5 words) for a chat conversation that begins with the following message. Do not use quotes. Message: "${firstUserMessage}"` }]
      }
    });
    return result.text?.trim() || "New Chat";
  } catch (e) {
    console.error("Title generation failed", e);
    return "New Chat";
  }
}

// Helper to file to Base64 part
export const fileToGenerativePart = async (file: Blob, mimeType: string) => {
  return new Promise<{ inlineData: { data: string, mimeType: string } }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = (reader.result as string).split(',')[1];
      resolve({
        inlineData: {
          data: base64String,
          mimeType: mimeType
        },
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export const generateMultimodalResponse = async (
  prompt: string,
  history: Message[],
  mediaBlob: Blob,
  mimeType: string
): Promise<string> => {
  // Convert the Blob to a Generative Part
  const mediaPart = await fileToGenerativePart(mediaBlob, mimeType);

  // Format history for the model
  const chatHistory = history.map(msg => ({
    role: msg.role === Role.USER ? 'user' : 'model',
    parts: [{ text: msg.text }]
  }));

  try {
    // We used 'chat' in SDK, but for multimodal one-shot, 'generate-content' is often easier or we can use 'chat' if we want history.
    // The previous implementation used chat.sendMessage with history.
    // Let's use the 'chat' action in our proxy.

    const result = await callGeminiProxy('chat', {
      model: "gemini-3-flash-preview",
      history: chatHistory,
      message: [
        { text: prompt },
        mediaPart
      ],
      systemInstruction: "You are a helpful AI assistant. Answer the user's questions naturally and conversationally. Use flowing paragraphs and avoid markdown lists or bullet points unless the user explicitly requests a list.",
      config: {
        maxOutputTokens: 4096,
      }
    });

    return result.text || "";

  } catch (error) {
    console.error("Multimodal generation error:", error);
    throw error;
  }
};

const MAX_CONTEXT_CHARS = 20000; // Approx 5k tokens
const COMPRESSION_TARGET_CHARS = 10000; // Target size after compression

// Helper to summarize older history
async function summarizeHistory(history: Message[]): Promise<Message[]> {
  // Keep the last 4 messages intact (immediate context)
  const recentMessages = history.slice(-4);
  const olderMessages = history.slice(0, -4);

  if (olderMessages.length === 0) return history;

  // Convert older messages to text for summarization
  const messagesText = olderMessages.map(m => `${m.role === Role.USER ? 'User' : 'AI'}: ${m.text}`).join('\n');

  try {
    const summaryResult = await callGeminiProxy('generate-content', {
      model: "gemini-3-flash-preview", // Use fast model for summary
      contents: {
        parts: [{
          text: `Summarize the following conversation history into a concise paragraph. Capture key facts, user preferences, and important context. \n\nConversation:\n${messagesText}`
        }]
      }
    });

    const summaryText = summaryResult.text || "Previous conversation summary unavailable.";

    // Create a new "system-like" message with the summary
    const summaryMessage: Message = {
      id: "summary-" + Date.now(),
      role: Role.MODEL,
      text: `[System Note: Previous conversation summary]: ${summaryText}`,
      timestamp: Date.now()
    };

    return [summaryMessage, ...recentMessages];

  } catch (error) {
    console.error("Failed to summarize history:", error);
    return history; // Fallback: return original history if summary fails
  }
}

export const generateRagResponse = async (
  history: Message[],
  contextChunks: { text: string; sourceFileName: string; pageNumber?: number }[],
  onChunk: (text: string) => void
): Promise<string> => {

  const contextText = contextChunks.map(c =>
    `[Source: ${c.sourceFileName}, Page: ${c.pageNumber || 'N/A'}]\n${c.text}`
  ).join("\n\n---\n\n");

  const systemInstruction = `
You are a helpful AI assistant. You have access to a RAG (Retrieval Augmented Generation) database.
Use the following pieces of retrieved context to answer the user's question. 
If the answer is not in the context, check if the question is a follow-up or related to the previous conversation history.
If the question is about the previous conversation, answer it using the conversation history.
If the question is new and not in the retrieved context, just say that you don't know based on the provided documents.
Keep answers concise and relevant.
Use flowing, natural language paragraphs. Do NOT use markdown lists or bullet points for simple enumeration unless absolutely necessary.

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

  // Calculate approximate size
  let totalChars = history.reduce((acc, m) => acc + (m.text?.length || 0), 0) + contextText.length;

  let processedHistory = history;

  // Compress if needed
  if (totalChars > MAX_CONTEXT_CHARS) {
    console.log(`Context size ${totalChars} exceeds limit ${MAX_CONTEXT_CHARS}. Compressing...`);
    processedHistory = await summarizeHistory(history.slice(0, -1)); // Exclude last message (current prompt) from summary
    // Re-verify size? For now, assume summary is small enough.
  } else {
    processedHistory = history.slice(0, -1); // Just exclude the last message which is the prompt
  }

  const finalHistoryForModel = processedHistory.map(msg => ({
    role: msg.role === Role.USER ? 'user' : 'model',
    parts: [{ text: msg.text }]
  }));

  try {
    // For streaming, we need to handle the response differently
    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'stream-chat',
        payload: {
          model: CHAT_MODEL,
          history: finalHistoryForModel,
          message: lastMessage.parts[0].text,
          systemInstruction,
          config: {}
        }
      })
    });

    if (!response.body) throw new Error("No response body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunkText = decoder.decode(value, { stream: true });
      fullText += chunkText;
      onChunk(fullText);
    }

    return fullText;

  } catch (error) {
    console.error("Chat generation error:", error);
    throw error;
  }
};

export const transcribeAudio = async (audioBlob: Blob): Promise<string> => {
  try {
    const audioPart = await fileToGenerativePart(audioBlob, "audio/webm");

    const result = await callGeminiProxy('generate-content', {
      model: "gemini-3-flash-preview",
      contents: {
        role: 'user',
        parts: [
          { text: "Transcribe the following audio exactly as spoken. Do not add any commentary." },
          audioPart
        ]
      }
    });

    return result.text?.trim() || "";
  } catch (error) {
    console.error("Transcription error:", error);
    throw error;
  }
};