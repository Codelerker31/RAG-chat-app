import { supabase } from './supabaseClient';
import { ChatSession, Message, RagDocument } from '../types';

export const db = {
  // --- Chats ---
  async getChats(): Promise<ChatSession[]> {
    const { data: chats, error } = await supabase
      .from('chats')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) throw error;
    if (!chats) return [];

    // Fetch messages for all chats (in a real app, you might lazy load these or fetch by ID)
    const { data: messages, error: msgError } = await supabase
      .from('messages')
      .select('*')
      .order('timestamp', { ascending: true });

    if (msgError) throw msgError;

    // Map messages to chats
    return chats.map(chat => ({
      ...chat,
      messages: messages ? messages.filter(m => m.chat_id === chat.id) : []
    }));
  },

  async createChat(chat: ChatSession): Promise<void> {
    // Insert chat
    const { error } = await supabase.from('chats').insert({
      id: chat.id,
      title: chat.title,
      type: chat.type,
      created_at: chat.createdAt
    });
    if (error) throw error;

    // Insert initial messages
    if (chat.messages.length > 0) {
      await this.addMessages(chat.id, chat.messages);
    }
  },

  async updateChatTitle(chatId: string, title: string): Promise<void> {
    const { error } = await supabase
      .from('chats')
      .update({ title })
      .eq('id', chatId);
    
    if (error) throw error;
  },

  async clearChatMessages(chatId: string): Promise<void> {
    const { error } = await supabase
      .from('messages')
      .delete()
      .eq('chat_id', chatId);
    
    if (error) throw error;
  },

  // --- Messages ---
  async addMessages(chatId: string, messages: Message[]): Promise<void> {
    const records = messages.map(msg => ({
      id: msg.id,
      chat_id: chatId,
      role: msg.role,
      text: msg.text,
      timestamp: msg.timestamp
    }));

    const { error } = await supabase.from('messages').insert(records);
    if (error) throw error;
  },
  
  // --- Documents ---
  async getDocuments(): Promise<RagDocument[]> {
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .order('upload_timestamp', { ascending: false });
      
    if (error) throw error;
    
    // Map DB snake_case to TS camelCase
    return (data || []).map(doc => ({
        id: doc.id,
        fileName: doc.file_name,
        uploadTimestamp: doc.upload_timestamp,
        scope: doc.scope,
        chunkCount: doc.chunk_count
    }));
  },

  async addDocument(doc: RagDocument): Promise<void> {
    const { error } = await supabase.from('documents').insert({
        id: doc.id,
        file_name: doc.fileName,
        upload_timestamp: doc.uploadTimestamp,
        scope: doc.scope,
        chunk_count: doc.chunkCount
    });
    if (error) throw error;
  },

  async deleteDocument(docId: string): Promise<void> {
    // Note: Assuming CASCADE DELETE is configured in SQL for rag_chunks linked to this document
    const { error } = await supabase
      .from('documents')
      .delete()
      .eq('id', docId);
      
    if (error) throw error;
  },

  async deleteDocuments(docIds: string[]): Promise<void> {
    if (docIds.length === 0) return;
    
    const { error } = await supabase
        .from('documents')
        .delete()
        .in('id', docIds);

    if (error) throw error;
  },

  // Simulate a "Preview" by fetching text from Page 1
  async getDocumentPageOne(docId: string): Promise<string> {
      const { data, error } = await supabase
        .from('rag_chunks')
        .select('text')
        .eq('document_id', docId)
        .eq('page_number', 1)
        .limit(1)
        .single();
      
      if (error && error.code !== 'PGRST116') { // Ignore "no rows" errors
          console.error("Preview fetch error", error);
          throw error;
      }
      
      return data ? data.text : "No text content found for Page 1.";
  }
};