import React, { useState, useRef, useEffect, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { 
  ChatSession, 
  ChatType, 
  Message, 
  Role, 
  RagDocument, 
  RagChunk 
} from './types';
import { generateEmbedding, generateRagResponse, generateChatTitle } from './services/geminiService';
import { parsePdf, chunkText } from './services/fileService';
import { vectorStore } from './services/vectorStore';
import { db } from './services/db';
import { 
  PlusIcon, 
  ChatBubbleIcon, 
  DocumentIcon, 
  UploadIcon,
  Spinner,
  SparklesIcon,
  SearchIcon,
  DatabaseIcon,
  SendIcon,
  TrashIcon,
  MicIcon,
  StopCircleIcon,
  DownloadIcon,
  SunIcon,
  MoonIcon,
  EyeIcon,
  SortIcon
} from './components/Icon';
import { Modal } from './components/Modal';
import { Toast, ToastType } from './components/Toast';

// --- Type Definition for Speech API ---
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

// --- RAG Logic Extraction ---
const processRagRequest = async (
  userMsg: Message,
  history: Message[],
  chatType: ChatType,
  chatId: string,
  onStream: (text: string) => void,
  onStatusUpdate: (status: string) => void,
  onSourcesFound: (sources: { title: string; page: number }[]) => void
): Promise<string> => {
  
  onStatusUpdate("Thinking...");

  // 1. Generate Embedding for Query
  onStatusUpdate("Analyzing query...");
  const queryEmbedding = await generateEmbedding(userMsg.text);

  // 2. Identify Scope for Retrieval
  const scope = chatType === ChatType.DEDICATED ? chatId : 'global';

  // 3. Vector Search (Database)
  let contextChunks: any[] = [];
  if (process.env.SUPABASE_URL) {
    onStatusUpdate("Searching knowledge base...");
    // Updated usage to match new SearchOptions interface
    const searchResults = await vectorStore.search(queryEmbedding, {
        filterScope: scope,
        topK: 5
    });
    contextChunks = searchResults.map(r => r.chunk);
    
    // Extract unique sources for UI
    const sources = searchResults.map(r => ({
      title: r.chunk.sourceFileName,
      page: r.chunk.pageNumber || 0
    })).filter((v, i, a) => a.findIndex(t => (t.title === v.title && t.page === v.page)) === i);
    
    onSourcesFound(sources);
  } else {
    console.warn("Skipping RAG search: DB not configured");
  }

  // 4. Generate Response
  onStatusUpdate("Generating response...");
  let fullResponse = '';
  await generateRagResponse(
    [...history, userMsg],
    contextChunks,
    (chunkText) => {
        fullResponse = chunkText;
        onStream(chunkText);
    }
  );

  return fullResponse;
};

const App: React.FC = () => {
  // --- State ---
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isLoadingChats, setIsLoadingChats] = useState(true); // Loading state for initial fetch
  
  // Processing States
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  
  // Voice Input State
  const [isListening, setIsListening] = useState(false);
  
  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [chatFilter, setChatFilter] = useState<'all' | 'global' | 'dedicated'>('all');
  
  // RAG Data State
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  
  // Modals & UI
  const [isNewChatModalOpen, setIsNewChatModalOpen] = useState(false);
  
  // New Chat Form State
  const [newChatTitle, setNewChatTitle] = useState('');

  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isDocManagerOpen, setIsDocManagerOpen] = useState(false);
  const [uploadScope, setUploadScope] = useState<'global' | 'dedicated'>('global');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [uploadProgressPercent, setUploadProgressPercent] = useState(0);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const currentChat = chats.find(c => c.id === currentChatId);

  // --- Theme Toggle ---
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  // --- Helper Functions ---
  const showToast = (message: string, type: ToastType) => {
    setToast({ message, type });
  };

  // --- Persistence & Initialization ---

  // Load Data from Supabase on Mount
  useEffect(() => {
    const loadData = async () => {
      setIsLoadingChats(true);
      try {
        const [fetchedChats, fetchedDocs] = await Promise.all([
          db.getChats(),
          db.getDocuments()
        ]);

        if (fetchedChats.length > 0) {
          setChats(fetchedChats);
          
          // Restore last active session from localStorage
          const lastActiveId = localStorage.getItem('lastActiveChatId');
          const chatExists = fetchedChats.find(c => c.id === lastActiveId);
          
          if (lastActiveId && chatExists) {
            setCurrentChatId(lastActiveId);
          } else {
            setCurrentChatId(fetchedChats[fetchedChats.length - 1].id);
          }
        }

        setDocuments(fetchedDocs);
      } catch (e) {
        console.error("Failed to load data from Supabase", e);
        showToast("Failed to connect to database. Check credentials.", 'error');
      } finally {
        setIsLoadingChats(false);
      }
    };

    if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
        loadData();
    } else {
        setIsLoadingChats(false);
        showToast("Supabase configuration missing in env.", 'info');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist Current Session ID
  useEffect(() => {
    if (currentChatId) {
      localStorage.setItem('lastActiveChatId', currentChatId);
    }
  }, [currentChatId]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentChat?.messages, isProcessing, processingStatus, currentChatId]);

  const filteredChats = useMemo(() => {
    return chats.filter(c => {
      const matchesSearch = c.title.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesFilter = chatFilter === 'all' 
        ? true 
        : chatFilter === 'global' ? c.type === ChatType.GLOBAL : c.type === ChatType.DEDICATED;
      return matchesSearch && matchesFilter;
    });
  }, [chats, searchQuery, chatFilter]);

  // --- Voice Input Handler ---
  const toggleVoiceInput = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      showToast("Speech recognition not supported in this browser.", 'error');
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInput(prev => (prev ? `${prev} ${transcript}` : transcript));
      };

      recognition.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        setIsListening(false);
        showToast("Error listening. Please try again.", 'error');
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    }
  };

  // --- Handlers ---

  const openNewChatModal = () => {
      setNewChatTitle('');
      setIsNewChatModalOpen(true);
  };

  const handleCreateChat = async (title: string, type: ChatType) => {
    if (!Object.values(ChatType).includes(type)) {
      showToast("Invalid chat type selected", 'error');
      return;
    }

    const finalTitle = title.trim() || "New Chat";

    const newChat: ChatSession = {
      id: uuidv4(),
      title: finalTitle,
      type,
      messages: [{
        id: uuidv4(),
        role: Role.MODEL,
        text: type === ChatType.GLOBAL 
          ? 'Ready to chat using Global Data.' 
          : 'Ready. Upload documents to this chat to create a custom knowledge base.',
        timestamp: Date.now()
      }],
      createdAt: Date.now()
    };

    // Update UI immediately (Optimistic)
    setChats(prev => [...prev, newChat]);
    setCurrentChatId(newChat.id);
    setIsNewChatModalOpen(false);

    if (process.env.SUPABASE_URL) {
      try {
          await db.createChat(newChat);
          showToast("Chat created successfully", 'success');
      } catch (e) {
          console.error(e);
          showToast("Chat created locally, but failed to save to DB", 'error');
      }
    } else {
       showToast("Chat created locally (DB not configured)", 'info');
    }
  };

  const handleClearChat = async () => {
    if (!currentChatId) return;
    
    if (window.confirm("Are you sure you want to clear this chat? This action cannot be undone.")) {
      try {
        if (process.env.SUPABASE_URL) {
          await db.clearChatMessages(currentChatId);
        }
        
        setChats(prev => prev.map(c => 
          c.id === currentChatId 
            ? { ...c, messages: [] } 
            : c
        ));
        
        showToast("Chat cleared successfully", 'success');
      } catch (e) {
        console.error("Failed to clear chat", e);
        showToast("Failed to clear chat history", 'error');
      }
    }
  };

  const handleExportChat = (format: 'txt' | 'json') => {
    if (!currentChat) return;

    let content = '';
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `chat_${currentChat.title.replace(/\s+/g, '_')}_${timestamp}.${format}`;

    if (format === 'json') {
      content = JSON.stringify(currentChat.messages, null, 2);
    } else {
      content = `Chat: ${currentChat.title}\nDate: ${new Date().toLocaleString()}\n\n`;
      content += currentChat.messages.map(m => {
        const role = m.role === Role.USER ? 'User' : 'AI';
        return `[${new Date(m.timestamp).toLocaleTimeString()}] ${role}:\n${m.text}\n`;
      }).join('\n-------------------\n\n');
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Chat exported successfully", 'success');
  };

  const handleSendMessage = async () => {
    if (!input.trim() || !currentChatId || isProcessing) return;

    if (!process.env.API_KEY) {
        showToast("Missing API Key. Please configure your environment.", 'error');
        return;
    }

    const userMsg: Message = {
      id: uuidv4(),
      role: Role.USER,
      text: input,
      timestamp: Date.now()
    };

    const targetChat = chats.find(c => c.id === currentChatId);
    if (!targetChat) return;

    // Auto-naming Logic: If title is "New Chat" and this is the first user interaction
    if (targetChat.title === "New Chat" && targetChat.messages.length <= 1) {
       generateChatTitle(userMsg.text).then(async (newTitle) => {
           setChats(prev => prev.map(c => c.id === currentChatId ? { ...c, title: newTitle } : c));
           if (process.env.SUPABASE_URL) {
               await db.updateChatTitle(currentChatId, newTitle);
           }
       }).catch(err => console.error("Failed to generate title", err));
    }

    // Optimistic Update
    setChats(prev => prev.map(c => 
      c.id === currentChatId 
        ? { ...c, messages: [...c.messages, userMsg] }
        : c
    ));
    setInput('');
    setIsProcessing(true);
    setProcessingStatus("Initializing...");

    try {
      // Save User Message to DB
      if (process.env.SUPABASE_URL) {
        await db.addMessages(currentChatId, [userMsg]).catch(e => console.error("Failed to save user msg", e));
      }

      // Prepare placeholder for model response
      const modelMsgId = uuidv4();
      setChats(prev => prev.map(c => 
        c.id === currentChatId 
          ? { ...c, messages: [...c.messages, {
              id: modelMsgId,
              role: Role.MODEL,
              text: '',
              timestamp: Date.now(),
              isStreaming: true
            }] }
          : c
      ));

      let responseSources: { title: string; page: number }[] = [];

      // Call extracted RAG logic
      const fullResponse = await processRagRequest(
        userMsg,
        targetChat.messages, 
        targetChat.type,
        targetChat.id,
        (chunkText) => {
          // Streaming Update
          setChats(prev => prev.map(c => 
            c.id === currentChatId 
              ? { ...c, messages: c.messages.map(m => 
                  m.id === modelMsgId ? { ...m, text: chunkText } : m
                ) }
              : c
          ));
        },
        (status) => setProcessingStatus(status),
        (foundSources) => {
            responseSources = foundSources;
            // Optimistic update to show sources even before text starts streaming
            setChats(prev => prev.map(c => 
                c.id === currentChatId 
                  ? { ...c, messages: c.messages.map(m => 
                      m.id === modelMsgId ? { ...m, sources: foundSources } : m
                    ) }
                  : c
              ));
        }
      );

      // Finalize & Save Model Response to DB
      const finalModelMsg: Message = {
          id: modelMsgId,
          role: Role.MODEL,
          text: fullResponse,
          timestamp: Date.now(),
          isStreaming: false,
          sources: responseSources
      };

      setChats(prev => prev.map(c => 
        c.id === currentChatId 
          ? { ...c, messages: c.messages.map(m => 
              m.id === modelMsgId ? finalModelMsg : m
            ) }
          : c
      ));

      if (process.env.SUPABASE_URL) {
        await db.addMessages(currentChatId, [finalModelMsg]).catch(e => console.error("Failed to save model msg", e));
      }

    } catch (error) {
      console.error(error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      showToast(`Error: ${errorMessage}`, 'error');
      
      // Cleanup loading state
      setChats(prev => prev.map(c => 
        c.id === currentChatId 
          ? { ...c, messages: c.messages.filter(m => m.isStreaming) } // remove broken streaming msg
          : c
      ));
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    const file = e.target.files[0];

    // PDF Validation
    if (file.type !== 'application/pdf') {
        showToast("Only PDF files are allowed.", 'error');
        e.target.value = ''; // Reset input
        return;
    }
    
    // 20MB Limit
    const MAX_FILE_SIZE = 20 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
        showToast("File exceeds 20MB limit.", 'error');
        e.target.value = ''; // Reset input
        return;
    }

    if (!process.env.SUPABASE_URL) {
        showToast("Database not configured. Cannot upload documents.", 'error');
        return;
    }

    setIsUploading(true);
    setUploadStatus('Starting upload process...');
    setUploadProgressPercent(0);
    
    try {
      const scope = uploadScope === 'global' ? 'global' : (currentChatId || 'global');
      const docId = uuidv4();

      // 1. Parse PDF
      setUploadStatus(`Parsing PDF (${file.name})...`);
      setUploadProgressPercent(10);
      const pages = await parsePdf(file);
      
      // 2. Chunk
      setUploadStatus(`Splitting document into chunks (${pages.length} pages)...`);
      setUploadProgressPercent(20);
      const rawChunks = chunkText(pages, file.name);
      
      // 3. Generate Embeddings & Prepare for DB
      setUploadStatus('Analyzing text and generating embeddings...');
      
      const chunksWithEmbeddings: RagChunk[] = [];
      const totalChunks = rawChunks.length;
      
      // Processing loop with ETA
      for (let i = 0; i < totalChunks; i++) {
        // Update status with ETA every few chunks
        if (i % 2 === 0 || i === totalChunks - 1) {
            const remaining = totalChunks - i;
            const etaSeconds = Math.ceil(remaining * 0.2); // Assume ~200ms per chunk via network
            setUploadStatus(`Embedding chunk ${i + 1} of ${totalChunks} (approx. ${etaSeconds}s remaining)...`);
            // Progress from 20% to 90%
            setUploadProgressPercent(20 + Math.floor((i / totalChunks) * 70));
        }
        
        const embedding = await generateEmbedding(rawChunks[i].text);
        
        chunksWithEmbeddings.push({
          id: uuidv4(),
          ...rawChunks[i],
          embedding
        });
      }

      setUploadProgressPercent(90);

      // 4. Update Metadata DB
      setUploadStatus('Saving document metadata...');
      const newDoc: RagDocument = {
        id: docId,
        fileName: file.name,
        uploadTimestamp: Date.now(),
        scope: scope,
        chunkCount: chunksWithEmbeddings.length
      };
      
      await db.addDocument(newDoc);
      setDocuments(prev => [...prev, newDoc]);

      // 5. Save Vectors to DB
      setUploadStatus('Finalizing: Saving vector embeddings...');
      await vectorStore.addChunks(chunksWithEmbeddings, docId);

      setUploadProgressPercent(100);
      setUploadStatus('Upload Complete!');
      showToast(`${file.name} uploaded successfully!`, 'success');
      
      setTimeout(() => {
        setIsUploadModalOpen(false);
        setUploadStatus('');
        setUploadProgressPercent(0);
        setIsUploading(false);
      }, 1200);

    } catch (error) {
      console.error(error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      setUploadStatus('Error during upload.');
      showToast(`Upload failed: ${errorMessage}`, 'error');
      setIsUploading(false);
      setUploadProgressPercent(0);
    }
  };

  const handleDocumentDelete = async (docId: string, fileName: string) => {
    if (window.confirm(`Are you sure you want to delete "${fileName}"?`)) {
       try {
         if (process.env.SUPABASE_URL) {
            await db.deleteDocument(docId);
         }
         setDocuments(prev => prev.filter(d => d.id !== docId));
         showToast("Document deleted successfully", 'success');
       } catch (e) {
         console.error(e);
         showToast("Failed to delete document", 'error');
       }
    }
  };

  const DocManagerModal = () => {
    const [tab, setTab] = useState<'all' | 'global' | 'chat'>('all');
    // Sorting State
    const [sortBy, setSortBy] = useState<'date' | 'name' | 'scope'>('date');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    
    // Selection State
    const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());

    // Preview State
    const [previewDoc, setPreviewDoc] = useState<{ id: string, name: string } | null>(null);
    const [previewContent, setPreviewContent] = useState<string>('');
    const [loadingPreview, setLoadingPreview] = useState(false);

    // Search State (Content Search)
    const [docSearchQuery, setDocSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<{chunk: any, similarity: number}[] | null>(null);
    const [isSearchingDocs, setIsSearchingDocs] = useState(false);
    
    // Toggle Selection
    const toggleSelect = (id: string) => {
        const newSet = new Set(selectedDocs);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedDocs(newSet);
    };

    const toggleSelectAll = () => {
        if (selectedDocs.size === processedDocs.length) {
            setSelectedDocs(new Set());
        } else {
            setSelectedDocs(new Set(processedDocs.map(d => d.id)));
        }
    };

    const handleSort = (field: 'date' | 'name' | 'scope') => {
        if (sortBy === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(field);
            setSortOrder('asc');
        }
    };

    const handleBulkDelete = async () => {
        if (!process.env.SUPABASE_URL) return;
        const count = selectedDocs.size;
        if (window.confirm(`Are you sure you want to delete ${count} document(s)?`)) {
            try {
                const ids = Array.from(selectedDocs);
                await db.deleteDocuments(ids);
                setDocuments(prev => prev.filter(d => !selectedDocs.has(d.id)));
                setSelectedDocs(new Set());
                showToast(`Deleted ${count} documents.`, 'success');
            } catch (e) {
                console.error(e);
                showToast("Bulk delete failed", 'error');
            }
        }
    };

    const handlePreview = async (docId: string, name: string) => {
        setPreviewDoc({ id: docId, name });
        setLoadingPreview(true);
        try {
            const text = await db.getDocumentPageOne(docId);
            setPreviewContent(text);
        } catch (e) {
            setPreviewContent("Error loading preview content.");
        } finally {
            setLoadingPreview(false);
        }
    };

    const handleDocSearch = async () => {
        if (!docSearchQuery.trim()) {
            setSearchResults(null);
            return;
        }
        
        if (!process.env.SUPABASE_URL) {
            showToast("Search requires database connection", 'error');
            return;
        }

        setIsSearchingDocs(true);
        try {
            const embedding = await generateEmbedding(docSearchQuery);
            let scope = 'global';
            if (tab === 'chat' && currentChatId) scope = currentChatId;
            if (tab === 'chat' && !currentChatId) scope = 'global';
            
            // Refactored search call
            const results = await vectorStore.search(embedding, {
                filterScope: scope,
                topK: 10
            });
            setSearchResults(results);
        } catch (e) {
            console.error(e);
            showToast("Search failed", 'error');
        } finally {
            setIsSearchingDocs(false);
        }
    };

    const processedDocs = useMemo(() => {
        let docs = documents.filter(doc => {
            if (tab === 'global') return doc.scope === 'global';
            if (tab === 'chat') return doc.scope === currentChatId;
            return true;
        });
        
        return docs.sort((a, b) => {
            let val = 0;
            if (sortBy === 'date') val = a.uploadTimestamp - b.uploadTimestamp;
            if (sortBy === 'name') val = a.fileName.localeCompare(b.fileName);
            if (sortBy === 'scope') val = a.scope.localeCompare(b.scope);
            return sortOrder === 'asc' ? val : -val;
        });
    }, [documents, tab, currentChatId, sortBy, sortOrder]);

    if (previewDoc) {
        return (
            <div className="flex flex-col h-[60vh]">
                <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-200 dark:border-slate-800">
                    <h3 className="font-bold text-slate-700 dark:text-slate-200 truncate pr-4">Preview: {previewDoc.name}</h3>
                    <button onClick={() => setPreviewDoc(null)} className="text-sm text-blue-500 hover:underline">Back to List</button>
                </div>
                <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 shadow-inner">
                    {loadingPreview ? (
                        <div className="flex items-center justify-center h-full"><Spinner /></div>
                    ) : (
                        <div className="prose dark:prose-invert max-w-none text-sm font-serif leading-loose whitespace-pre-line">
                            <div className="mb-4 text-xs uppercase tracking-widest text-slate-400 border-b border-slate-200 dark:border-slate-800 pb-1">Page 1 Content Preview</div>
                            {previewContent}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
      <div className="space-y-4">
        {/* Top Controls: Tabs & Search */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
            <div className="flex space-x-2">
            {['all', 'global', 'chat'].map(t => (
                <button
                    key={t}
                    onClick={() => { setTab(t as any); setSearchResults(null); setDocSearchQuery(''); setSelectedDocs(new Set()); }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all capitalize ${
                    tab === t 
                    ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300' 
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800'
                    }`}
                >
                    {t === 'chat' ? 'Current Chat' : t}
                </button>
            ))}
            </div>
            
            <div className="relative flex-1 max-w-xs">
                <input 
                    type="text" 
                    placeholder="Search content..."
                    value={docSearchQuery}
                    onChange={(e) => setDocSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleDocSearch()}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-lg pl-8 pr-8 py-1.5 text-xs focus:outline-none focus:border-violet-400 dark:focus:border-violet-500 transition-colors"
                />
                <div className="absolute left-2.5 top-2 text-slate-400 dark:text-slate-500"><SearchIcon /></div>
                <button 
                    onClick={handleDocSearch}
                    className="absolute right-1.5 top-1 p-0.5 text-violet-600 dark:text-violet-300 rounded hover:bg-violet-100 dark:hover:bg-violet-900"
                    disabled={isSearchingDocs}
                >
                    {isSearchingDocs ? <Spinner /> : <div className="scale-75"><SearchIcon /></div>}
                </button>
            </div>
        </div>
        
        {/* Bulk Action Bar */}
        {selectedDocs.size > 0 && (
            <div className="flex items-center justify-between bg-violet-50 dark:bg-violet-900/20 p-2 rounded-lg text-xs animate-fadeIn">
                <span className="font-semibold text-violet-700 dark:text-violet-300 pl-2">{selectedDocs.size} selected</span>
                <button 
                    onClick={handleBulkDelete}
                    className="flex items-center gap-1 bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 px-3 py-1.5 rounded border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-colors font-medium shadow-sm"
                >
                    <TrashIcon /> Delete Selected
                </button>
            </div>
        )}

        {/* Content Area */}
        <div className="h-80 overflow-y-auto space-y-1 pr-1">
           {searchResults ? (
               searchResults.length === 0 ? (
                   <div className="text-center text-slate-400 text-sm mt-10">No matching content found.</div>
               ) : (
                   searchResults.map((result, idx) => (
                       <div key={idx} className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-sm">
                           <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-bold text-violet-600 dark:text-violet-400 truncate max-w-[200px]">
                                    {result.chunk.sourceFileName}
                                </span>
                                <span className="text-[10px] text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                                    Pg {result.chunk.pageNumber || '?'} • {(result.similarity * 100).toFixed(0)}% Match
                                </span>
                           </div>
                           <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-3 leading-relaxed">
                               "{result.chunk.text}"
                           </p>
                       </div>
                   ))
               )
           ) : (
             <>
                {/* List Header */}
                <div className="flex items-center justify-between px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-t-lg text-[10px] uppercase font-bold text-slate-500 sticky top-0 z-10">
                    <div className="flex items-center gap-3">
                        <input 
                            type="checkbox" 
                            checked={processedDocs.length > 0 && selectedDocs.size === processedDocs.length}
                            onChange={toggleSelectAll}
                            className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                        />
                        <button onClick={() => handleSort('name')} className="hover:text-violet-500 flex items-center gap-1">
                            File Name {sortBy === 'name' && <SortIcon />}
                        </button>
                    </div>
                    <div className="flex items-center gap-4">
                        <button onClick={() => handleSort('scope')} className="hover:text-violet-500 flex items-center gap-1">
                            Scope {sortBy === 'scope' && <SortIcon />}
                        </button>
                        <button onClick={() => handleSort('date')} className="hover:text-violet-500 flex items-center gap-1">
                            Date {sortBy === 'date' && <SortIcon />}
                        </button>
                        <span className="w-12 text-center">Actions</span>
                    </div>
                </div>

                {/* List Body */}
                {processedDocs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 text-slate-400">
                        <DocumentIcon />
                        <p className="text-sm mt-2">No documents found.</p>
                    </div>
                ) : (
                    processedDocs.map(doc => (
                        <div key={doc.id} className={`flex items-center justify-between p-3 border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group ${selectedDocs.has(doc.id) ? 'bg-violet-50 dark:bg-violet-900/10' : ''}`}>
                            <div className="flex items-center gap-3 overflow-hidden">
                                <input 
                                    type="checkbox" 
                                    checked={selectedDocs.has(doc.id)}
                                    onChange={() => toggleSelect(doc.id)}
                                    className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                                />
                                <div className={`p-1.5 rounded-lg flex-shrink-0 ${doc.scope === 'global' ? 'bg-blue-50 text-blue-500 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-fuchsia-50 text-fuchsia-500 dark:bg-fuchsia-900/30 dark:text-fuchsia-400'}`}>
                                    <DocumentIcon />
                                </div>
                                <div className="truncate min-w-0">
                                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate" title={doc.fileName}>{doc.fileName}</p>
                                    <p className="text-[10px] text-slate-400 dark:text-slate-500">{doc.chunkCount} chunks</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4 flex-shrink-0">
                                <div className="text-[10px] font-medium px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 w-16 text-center truncate">
                                    {doc.scope === 'global' ? 'Global' : 'Private'}
                                </div>
                                <div className="text-[10px] text-slate-400 w-16 text-right">
                                    {new Date(doc.uploadTimestamp).toLocaleDateString()}
                                </div>
                                <div className="flex items-center gap-1 w-12 justify-end">
                                    <button 
                                        onClick={() => handlePreview(doc.id, doc.fileName)}
                                        className="p-1.5 text-slate-400 hover:text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/30 rounded-lg transition-colors"
                                        title="Preview Page 1"
                                    >
                                        <EyeIcon />
                                    </button>
                                    <button 
                                        onClick={() => handleDocumentDelete(doc.id, doc.fileName)}
                                        className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-lg transition-colors"
                                        title="Delete"
                                    >
                                        <TrashIcon />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))
                )}
             </>
           )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950 font-sans text-slate-800 dark:text-slate-100 transition-colors duration-200">
      
      {/* Toast Notification */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Sidebar */}
      <div className="w-80 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col shadow-sm z-20">
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-600 to-fuchsia-500 dark:from-violet-400 dark:to-fuchsia-400 bg-clip-text text-transparent mb-1">
              RAGMaster
            </h1>
            <p className="text-xs text-slate-400 font-medium tracking-wide">AI DOCUMENT CHAT</p>
          </div>
          <button 
            onClick={toggleTheme}
            className="p-2 text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
            title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
          >
            {theme === 'light' ? <MoonIcon /> : <SunIcon />}
          </button>
        </div>

        <div className="p-4 space-y-3">
            <button 
                onClick={openNewChatModal}
                className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 dark:from-violet-700 dark:to-fuchsia-700 dark:hover:from-violet-600 dark:hover:to-fuchsia-600 text-white p-3 rounded-xl shadow-lg shadow-violet-200 dark:shadow-none transition-all flex items-center justify-center gap-2 text-sm font-bold transform active:scale-95"
            >
                <PlusIcon /> New Chat
            </button>
            
            <div className="space-y-2">
                <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-violet-500 transition-colors">
                        <SearchIcon />
                    </div>
                    <input 
                        type="text" 
                        placeholder="Search chats..." 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-sm rounded-xl pl-9 pr-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-violet-100 dark:focus:ring-violet-900 focus:border-violet-300 dark:focus:border-violet-700 transition-all placeholder-slate-400 dark:placeholder-slate-500"
                    />
                </div>
                
                {/* Chat Type Filter */}
                <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                    {['all', 'global', 'dedicated'].map((filter) => (
                        <button
                            key={filter}
                            onClick={() => setChatFilter(filter as any)}
                            className={`flex-1 py-1.5 text-xs font-medium rounded-md capitalize transition-all ${
                                chatFilter === filter 
                                ? 'bg-white dark:bg-slate-700 text-violet-600 dark:text-violet-300 shadow-sm' 
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                            }`}
                        >
                            {filter}
                        </button>
                    ))}
                </div>
            </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-1">
          <div className="mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-2">Your Chats</div>
          
          {isLoadingChats ? (
            <div className="space-y-2 animate-pulse mt-1">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex gap-3 p-3 rounded-xl">
                  <div className="w-5 h-5 bg-slate-200 dark:bg-slate-800 rounded-full"></div>
                  <div className="flex-1 space-y-2">
                    <div className="h-2.5 bg-slate-200 dark:bg-slate-800 rounded w-3/4"></div>
                    <div className="h-2 bg-slate-200 dark:bg-slate-800 rounded w-1/2"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              {filteredChats.map(chat => (
                <button
                  key={chat.id}
                  onClick={() => setCurrentChatId(chat.id)}
                  className={`w-full text-left p-3 rounded-xl mb-1 transition-all flex items-center gap-3 group relative overflow-hidden ${
                    currentChatId === chat.id 
                      ? 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 font-medium ring-1 ring-violet-200 dark:ring-violet-800' 
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {currentChatId === chat.id && <div className="absolute left-0 top-0 bottom-0 w-1 bg-violet-500 rounded-l-md"></div>}
                  <div className={`${currentChatId === chat.id ? 'text-violet-600 dark:text-violet-400' : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300'}`}>
                      {chat.type === ChatType.GLOBAL ? <ChatBubbleIcon /> : <SparklesIcon />}
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <p className="truncate text-sm">{chat.title}</p>
                    <p className="text-[10px] opacity-70 truncate">
                      {chat.type === ChatType.GLOBAL ? 'Global Knowledge' : 'Dedicated Knowledge'}
                    </p>
                  </div>
                </button>
              ))}
              {filteredChats.length === 0 && (
                  <div className="text-center py-8 text-slate-400 text-sm">
                      {chats.length === 0 ? "Loading chats..." : "No chats found"}
                  </div>
              )}
            </>
          )}
        </div>

        {/* Global Docs Status */}
        <div className="p-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-3 font-medium">
            <span>Knowledge Base</span>
            <button 
                onClick={() => setIsDocManagerOpen(true)}
                className="text-violet-600 hover:text-violet-800 dark:text-violet-400 dark:hover:text-violet-300 hover:underline"
            >
                Manage
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button 
                onClick={() => {
                    setUploadScope('global');
                    setIsUploadModalOpen(true);
                }}
                className="py-2 px-3 bg-white dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 text-xs rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-200 dark:hover:border-blue-800 transition-all flex flex-col items-center justify-center gap-1 shadow-sm"
            >
                <div className="text-blue-500 dark:text-blue-400"><UploadIcon /></div>
                <span>+ Global</span>
            </button>
            <button 
                onClick={() => setIsDocManagerOpen(true)}
                className="py-2 px-3 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs rounded-lg border border-slate-200 dark:border-slate-700 transition-all flex flex-col items-center justify-center gap-1 shadow-sm"
            >
                <div className="text-slate-500 dark:text-slate-400"><DatabaseIcon /></div>
                <span>View All ({documents.length})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-slate-50/50 dark:bg-slate-950/50 relative">
        
        {/* Header */}
        <div className="h-16 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-6 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md sticky top-0 z-10 transition-colors">
          <div>
            <h2 className="font-bold text-slate-800 dark:text-slate-100">{currentChat?.title || "RAGMaster AI"}</h2>
            {currentChat && (
              <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${currentChat?.type === ChatType.GLOBAL ? 'bg-blue-400' : 'bg-fuchsia-400'}`}></span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                      {currentChat?.type === ChatType.GLOBAL ? 'Global RAG Mode' : 'Dedicated RAG Mode'}
                  </span>
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            {currentChat && (
              <>
                <button
                    onClick={() => handleExportChat('txt')}
                    className="text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 p-2 rounded-lg transition-colors"
                    title="Export Chat as Text"
                >
                    <DownloadIcon />
                </button>
                <div className="h-4 w-px bg-slate-300 dark:bg-slate-700 mx-1"></div>
                <button
                    onClick={handleClearChat}
                    className="text-xs font-semibold text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/30 px-3 py-2 rounded-lg transition-colors"
                    title="Clear Chat History"
                >
                    Clear Chat
                </button>
              </>
            )}
            
            {currentChat?.type === ChatType.DEDICATED && (
               <button 
                  onClick={() => {
                      setUploadScope('dedicated');
                      setIsUploadModalOpen(true);
                  }}
                  className="text-xs font-semibold bg-fuchsia-100 hover:bg-fuchsia-200 dark:bg-fuchsia-900/30 dark:hover:bg-fuchsia-900/50 text-fuchsia-700 dark:text-fuchsia-300 px-3 py-2 rounded-lg flex items-center gap-2 transition-colors border border-fuchsia-200 dark:border-fuchsia-800 ml-2"
               >
                  <DocumentIcon /> Upload Context
               </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-700">
           {currentChat ? currentChat.messages.map((msg) => (
             <div key={msg.id} className={`flex w-full ${msg.role === Role.USER ? 'justify-end' : 'justify-start'}`}>
               <div className={`max-w-[85%] md:max-w-[75%] rounded-2xl px-5 py-4 shadow-sm ${
                 msg.role === Role.USER 
                   ? 'bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white rounded-br-sm' 
                   : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-bl-sm'
               }`}>
                 <p className="whitespace-pre-wrap leading-relaxed text-sm md:text-base">
                    {msg.text}
                    {msg.isStreaming && (
                         <span className="inline-block w-2 h-4 ml-1 align-bottom bg-violet-500 animate-[pulse_0.7s_infinite]"></span>
                    )}
                 </p>
                 {msg.role === Role.MODEL && msg.sources && msg.sources.length > 0 && (
                     <div className="mt-3 pt-3 border-t border-slate-100/50 dark:border-slate-700/50">
                         <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Sources Used</p>
                         <div className="flex flex-wrap gap-1">
                             {msg.sources.map((s, idx) => (
                                 <span key={idx} className="inline-flex items-center text-[10px] bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700">
                                     <DocumentIcon />
                                     <span className="ml-1 font-medium max-w-[100px] truncate">{s.title}</span>
                                     <span className="ml-1 opacity-70">pg.{s.page || '?'}</span>
                                 </span>
                             ))}
                         </div>
                     </div>
                 )}
               </div>
             </div>
           )) : (
             <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500">
               <div className="p-4 bg-slate-100 dark:bg-slate-800 rounded-full mb-4"><ChatBubbleIcon /></div>
               <p>Select or create a chat to begin</p>
             </div>
           )}
           {/* Visual Feedback for Loading Status when not yet streaming */}
           {isProcessing && !currentChat?.messages.find(m => m.isStreaming && m.text.length > 0) && (
                <div className="flex justify-start w-full animate-fadeIn">
                    <div className="bg-white/50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs font-medium px-4 py-2 rounded-full border border-slate-100 dark:border-slate-700 flex items-center gap-2 shadow-sm">
                        <Spinner />
                        <span>{processingStatus || "Processing..."}</span>
                    </div>
                </div>
           )}
           <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 md:p-6 bg-transparent">
          <div className="max-w-4xl mx-auto relative group">
            <div className={`absolute -inset-0.5 bg-gradient-to-r from-violet-200 to-fuchsia-200 rounded-2xl blur opacity-30 group-hover:opacity-60 transition duration-1000 ${isListening ? 'opacity-100 animate-pulse' : ''}`}></div>
            <div className="relative flex items-center bg-white dark:bg-slate-800 rounded-xl shadow-xl shadow-slate-200/50 dark:shadow-black/50 border border-slate-200 dark:border-slate-700 transition-colors">
                 <button 
                    onClick={toggleVoiceInput}
                    className={`p-3 ml-2 rounded-lg transition-all relative ${
                        isListening 
                        ? 'text-rose-500 bg-rose-50 dark:bg-rose-900/30 hover:bg-rose-100 dark:hover:bg-rose-900/50' 
                        : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                    title={isListening ? "Stop Listening" : "Start Voice Input"}
                 >
                    {isListening ? (
                        <>
                            <div className="absolute inset-0 rounded-lg animate-ping bg-rose-200 dark:bg-rose-800 opacity-75"></div>
                            <StopCircleIcon />
                        </>
                    ) : (
                        <MicIcon />
                    )}
                 </button>
                 
                 <input
                   type="text"
                   disabled={isProcessing || !currentChatId}
                   value={input}
                   onChange={(e) => setInput(e.target.value)}
                   onKeyDown={(e) => e.key === 'Enter' && !isProcessing && handleSendMessage()}
                   placeholder={
                       !currentChatId ? "Select a chat first..." : 
                       isListening ? "Listening... (Speak now)" :
                       isProcessing ? "AI is processing..." : 
                       "Ask me anything about your documents..."
                   }
                   className="w-full bg-transparent text-slate-800 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 rounded-xl px-4 py-4 focus:outline-none text-base"
                 />
                 <button 
                    onClick={handleSendMessage}
                    disabled={isProcessing || !input.trim() || !currentChatId}
                    className="absolute right-2 top-2 bottom-2 aspect-square flex items-center justify-center bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 dark:hover:bg-slate-600 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 text-white rounded-lg transition-all transform active:scale-95"
                 >
                    {isProcessing ? <Spinner /> : <SendIcon />}
                 </button>
            </div>
          </div>
          <div className="text-center mt-3">
            <p className="text-[10px] text-slate-400 dark:text-slate-600 font-medium">
               POWERED BY GEMINI & SUPABASE • {process.env.API_KEY ? 'CONNECTED' : 'API KEY MISSING'}
            </p>
          </div>
        </div>

      </div>

      {/* --- Modals --- */}

      {/* New Chat Modal */}
      <Modal isOpen={isNewChatModalOpen} onClose={() => setIsNewChatModalOpen(false)} title="Start a New Conversation">
         <div className="space-y-6">
            <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-200 mb-1.5">Conversation Title (Optional)</label>
                <input 
                    type="text" 
                    value={newChatTitle}
                    onChange={(e) => setNewChatTitle(e.target.value)}
                    placeholder="e.g. Q1 Financial Report Analysis" 
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-all placeholder-slate-400 dark:placeholder-slate-500"
                />
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Leave empty to auto-generate title from your first message.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
                <button 
                    onClick={() => handleCreateChat(newChatTitle, ChatType.GLOBAL)}
                    className="p-5 bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-500 rounded-xl flex flex-col items-center gap-3 group transition-all hover:shadow-lg hover:shadow-blue-500/10"
                >
                    <div className="p-3 bg-blue-50 dark:bg-blue-900/30 rounded-full text-blue-500 dark:text-blue-400 group-hover:scale-110 transition-transform"><ChatBubbleIcon /></div>
                    <div className="text-center">
                        <span className="block font-bold text-slate-700 dark:text-slate-200">Global Chat</span>
                        <span className="text-xs text-slate-400 dark:text-slate-500">Shared knowledge base</span>
                    </div>
                </button>
                <button 
                    onClick={() => handleCreateChat(newChatTitle, ChatType.DEDICATED)}
                    className="p-5 bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 hover:border-fuchsia-500 dark:hover:border-fuchsia-500 rounded-xl flex flex-col items-center gap-3 group transition-all hover:shadow-lg hover:shadow-fuchsia-500/10"
                >
                    <div className="p-3 bg-fuchsia-50 dark:bg-fuchsia-900/30 rounded-full text-fuchsia-500 dark:text-fuchsia-400 group-hover:scale-110 transition-transform"><SparklesIcon /></div>
                    <div className="text-center">
                        <span className="block font-bold text-slate-700 dark:text-slate-200">Dedicated Chat</span>
                        <span className="text-xs text-slate-400 dark:text-slate-500">Isolated + Global data</span>
                    </div>
                </button>
            </div>
         </div>
      </Modal>

      {/* Upload Modal */}
      <Modal isOpen={isUploadModalOpen} onClose={() => !isUploading && setIsUploadModalOpen(false)} title="Upload Documents">
          <div className="space-y-6">
             <div className={`border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center transition-colors relative ${isUploading ? 'bg-slate-50 dark:bg-slate-900 border-slate-300 dark:border-slate-600' : 'bg-slate-50 dark:bg-slate-900 border-slate-300 dark:border-slate-600 hover:bg-violet-50 dark:hover:bg-violet-900/20 hover:border-violet-400'}`}>
                <input 
                    type="file" 
                    accept="application/pdf"
                    onChange={handleFileUpload}
                    disabled={isUploading}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-10"
                />
                <div className={`p-4 rounded-full mb-3 transition-transform duration-500 ${isUploading ? 'bg-slate-200 dark:bg-slate-700 text-slate-500 scale-90' : 'bg-white dark:bg-slate-800 shadow-md text-violet-600 dark:text-violet-400'}`}>
                    {isUploading ? <Spinner /> : <UploadIcon />}
                </div>
                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                    {isUploading ? uploadStatus : 'Click or drag PDF here'}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                   Max size 20MB. Target: <span className="font-semibold text-violet-600 dark:text-violet-400 capitalize">{uploadScope === 'global' ? 'Global Knowledge Base' : 'Current Chat Only'}</span>
                </p>
             </div>
             
             {isUploading && (
                 <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                    <div 
                        className="bg-gradient-to-r from-violet-500 to-fuchsia-500 h-full transition-all duration-300"
                        style={{ width: `${uploadProgressPercent}%` }}
                    ></div>
                 </div>
             )}
          </div>
      </Modal>

      {/* Document Manager Modal */}
      <Modal isOpen={isDocManagerOpen} onClose={() => setIsDocManagerOpen(false)} title="Document Manager">
         <DocManagerModal />
      </Modal>

    </div>
  );
};

export default App;