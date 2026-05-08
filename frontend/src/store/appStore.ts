import { create } from 'zustand';
import type { Paragraph } from '../utils/tokenize';
import type { WordAnnotation } from '../api';

export type LearningCardType = 'word' | 'phrase' | 'sentence' | 'paragraph' | 'grammar';

export const APP_DEFAULT_SETTINGS_KEY = 'appDefaultSettings';

export type AppDefaultSettings = {
  showIPA?: boolean;
  showChinese?: boolean;
  exportFormat?: 'epub' | 'pdf';
  exportIncludeIPA?: boolean;
  exportIncludeChinese?: boolean;
  exportIncludePhraseList?: boolean;
  exportIncludePhraseTranslations?: boolean;
  level?: string;
  autoMark?: boolean;
  annotationMode?: 'ai' | 'local' | 'local-first';
  phraseCardProvider?: 'openai' | 'local';
  sentenceCardProvider?: 'openai' | 'local';
  autoPronounceSetting?: boolean;
  autoShowCardOnPlay?: boolean;
  speechRate?: number;
  speechPitch?: number;
  selectedVoice?: string;
  immersiveMode?: boolean;
  autoResumeOnOpen?: boolean;
  autoReadOnOpen?: boolean;
  autoStartTime?: string;
  autoFixedBackupEnabled?: boolean;
};

export function readAppDefaultSettings(): AppDefaultSettings {
  const stored = localStorage.getItem(APP_DEFAULT_SETTINGS_KEY);
  if (!stored) return {};

  try {
    return JSON.parse(stored) as AppDefaultSettings;
  } catch (error) {
    console.error('Failed to parse app default settings:', error);
    return {};
  }
}

export interface Chapter {
  id: string;
  title: string;
  content: string;
  paragraphs: Paragraph[];
}

export interface Document {
  id: string;
  title: string;
  type: 'text' | 'epub';
  format?: 'plain' | 'markdown';
  content?: string;
  paragraphs?: Paragraph[];
  chapters?: Chapter[];
  currentChapterId?: string;
  author?: string;
  createdAt: number;
}

interface AppState {
  documents: Document[];
  currentDocumentId: string | null;
  knownWords: Set<string>;
  learntWords: Set<string>;
  annotations: Map<string, WordAnnotation>;
  selectedWord: string | null;
  cardHistory: Array<{ type: LearningCardType; word: string; timestamp: number }>;
  bookmarks: Map<string, {
    documentId: string;
    chapterId?: string;
    paragraphIndex: number;
    sentenceIndex: number;
    timestamp: number;
  }>;

  showIPA: boolean;
  showChinese: boolean;
  exportFormat: 'epub' | 'pdf';
  exportIncludeIPA: boolean;
  exportIncludeChinese: boolean;
  exportIncludePhraseList: boolean;
  exportIncludePhraseTranslations: boolean;
  level: string;
  autoMark: boolean;
  annotationMode: 'ai' | 'local' | 'local-first';
  phraseCardProvider: 'openai' | 'local';
  sentenceCardProvider: 'openai' | 'local';
  autoPronounceSetting: boolean;
  autoShowCardOnPlay: boolean;

  addDocument: (doc: Document) => void;
  removeDocument: (id: string) => void;
  loadDocuments: (docs: Document[], currentDocumentId?: string | null) => void;
  setCurrentDocument: (id: string) => void;
  setCurrentChapter: (chapterId: string) => void;
  loadKnownWords: (words: string[]) => void;
  addKnownWord: (word: string) => void;
  addLearntWord: (word: string) => void;
  removeLearntWord: (word: string) => void;
  removeAnnotation: (word: string) => void;
  addAnnotation: (word: string, annotation: WordAnnotation) => void;
  updateAnnotation: (word: string, updates: Partial<WordAnnotation>) => void;
  loadLearntWords: (words: string[]) => void;
  loadAnnotations: (annotations: Map<string, WordAnnotation>) => void;
  setSelectedWord: (word: string | null) => void;
  addToCardHistory: (type: LearningCardType, word: string) => void;
  removeFromCardHistory: (word: string) => void;
  addBookmark: (documentId: string, chapterId: string | undefined, paragraphIndex: number, sentenceIndex: number) => void;
  setShowIPA: (show: boolean) => void;
  setShowChinese: (show: boolean) => void;
  setExportFormat: (format: 'epub' | 'pdf') => void;
  setExportIncludeIPA: (show: boolean) => void;
  setExportIncludeChinese: (show: boolean) => void;
  setExportIncludePhraseList: (show: boolean) => void;
  setExportIncludePhraseTranslations: (show: boolean) => void;
  setLevel: (level: string) => void;
  setAutoMark: (autoMark: boolean) => void;
  setAnnotationMode: (mode: 'ai' | 'local' | 'local-first') => void;
  setPhraseCardProvider: (provider: 'openai' | 'local') => void;
  setSentenceCardProvider: (provider: 'openai' | 'local') => void;
  setAutoPronounceSetting: (enabled: boolean) => void;
  setAutoShowCardOnPlay: (enabled: boolean) => void;
}

export const useAppStore = create<AppState>((set) => {
  const defaults = readAppDefaultSettings();

  return {
    documents: [],
    currentDocumentId: localStorage.getItem('currentDocumentId') || null,
    knownWords: new Set(),
    learntWords: new Set(),
    annotations: new Map(),
    selectedWord: null,
    cardHistory: [],
    bookmarks: (() => {
      const stored = localStorage.getItem('bookmarks');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          return new Map(Object.entries(parsed));
        } catch (e) {
          console.error('Failed to load bookmarks:', e);
        }
      }
      return new Map();
    })(),
    showIPA: defaults.showIPA ?? true,
    showChinese: defaults.showChinese ?? true,
    exportFormat: (localStorage.getItem('exportFormat') as 'epub' | 'pdf') || defaults.exportFormat || 'epub',
    exportIncludeIPA: localStorage.getItem('exportIncludeIPA') === null ? (defaults.exportIncludeIPA ?? true) : localStorage.getItem('exportIncludeIPA') === 'true',
    exportIncludeChinese: localStorage.getItem('exportIncludeChinese') === null ? (defaults.exportIncludeChinese ?? true) : localStorage.getItem('exportIncludeChinese') === 'true',
    exportIncludePhraseList: localStorage.getItem('exportIncludePhraseList') === null ? (defaults.exportIncludePhraseList ?? true) : localStorage.getItem('exportIncludePhraseList') === 'true',
    exportIncludePhraseTranslations: localStorage.getItem('exportIncludePhraseTranslations') === null ? (defaults.exportIncludePhraseTranslations ?? true) : localStorage.getItem('exportIncludePhraseTranslations') === 'true',
    level: defaults.level || 'B2',
    autoMark: defaults.autoMark ?? true,
    annotationMode: defaults.annotationMode || 'local-first',
    phraseCardProvider: defaults.phraseCardProvider || 'openai',
    sentenceCardProvider: defaults.sentenceCardProvider || 'local',
    autoPronounceSetting: defaults.autoPronounceSetting ?? true,
    autoShowCardOnPlay: defaults.autoShowCardOnPlay ?? false,

    addDocument: (doc) => set((state) => {
      localStorage.setItem('currentDocumentId', doc.id);
      const filtered = state.documents.filter(existing => existing.id !== doc.id);
      return {
        documents: [...filtered, doc],
        currentDocumentId: doc.id,
      };
    }),

    removeDocument: (id) => set((state) => {
      const remainingDocuments = state.documents.filter(doc => doc.id !== id);
      const nextCurrentDocumentId = state.currentDocumentId === id
        ? (remainingDocuments[0]?.id || null)
        : state.currentDocumentId;

      if (nextCurrentDocumentId) {
        localStorage.setItem('currentDocumentId', nextCurrentDocumentId);
      } else {
        localStorage.removeItem('currentDocumentId');
      }

      return {
        documents: remainingDocuments,
        currentDocumentId: nextCurrentDocumentId,
      };
    }),

    loadDocuments: (docs, currentId) => set({
      documents: docs,
      currentDocumentId: currentId || docs[0]?.id || null,
    }),

    setCurrentDocument: (id) => {
      if (id) {
        localStorage.setItem('currentDocumentId', id);
      } else {
        localStorage.removeItem('currentDocumentId');
      }
      set({ currentDocumentId: id });
    },

    setCurrentChapter: (chapterId) => set((state) => {
      const currentDoc = state.documents.find(d => d.id === state.currentDocumentId);
      if (currentDoc && currentDoc.type === 'epub') {
        const updatedDocs = state.documents.map(doc =>
          doc.id === state.currentDocumentId
            ? { ...doc, currentChapterId: chapterId }
            : doc
        );
        return { documents: updatedDocs };
      }
      return {};
    }),

    loadKnownWords: (words) => set({ knownWords: new Set(words.map(w => w.toLowerCase())) }),

    addKnownWord: (word) => set((state) => {
      const newKnownWords = new Set(state.knownWords);
      newKnownWords.add(word.toLowerCase());
      return { knownWords: newKnownWords };
    }),

    addLearntWord: (word) => set((state) => {
      const newLearntWords = new Set(state.learntWords);
      newLearntWords.add(word.toLowerCase());
      return { learntWords: newLearntWords };
    }),

    removeLearntWord: (word) => set((state) => {
      const newLearntWords = new Set(state.learntWords);
      newLearntWords.delete(word.toLowerCase());
      return { learntWords: newLearntWords };
    }),

    removeAnnotation: (word) => set((state) => {
      const newAnnotations = new Map(state.annotations);
      newAnnotations.delete(word.toLowerCase());
      return { annotations: newAnnotations };
    }),

    addAnnotation: (word, annotation) => set((state) => {
      const newAnnotations = new Map(state.annotations);
      newAnnotations.set(word.toLowerCase(), annotation);
      return { annotations: newAnnotations };
    }),

    updateAnnotation: (word, updates) => set((state) => {
      const newAnnotations = new Map(state.annotations);
      const existing = newAnnotations.get(word.toLowerCase());
      if (existing) {
        newAnnotations.set(word.toLowerCase(), { ...existing, ...updates });
      }
      return { annotations: newAnnotations };
    }),

    loadLearntWords: (words) => set({ learntWords: new Set(words.map(w => w.toLowerCase())) }),

    loadAnnotations: (annotations) => set({ annotations }),

    setSelectedWord: (word) => set({ selectedWord: word }),

    addToCardHistory: (type, word) => set((state) => {
      const filtered = state.cardHistory.filter(item => item.word !== word);
      const newHistory = [
        { type, word, timestamp: Date.now() },
        ...filtered,
      ];
      return { cardHistory: newHistory };
    }),

    removeFromCardHistory: (word) => set((state) => ({
      cardHistory: state.cardHistory.filter(item => item.word !== word),
    })),

    addBookmark: (documentId, chapterId, paragraphIndex, sentenceIndex) => set((state) => {
      const newBookmarks = new Map(state.bookmarks);
      newBookmarks.set(documentId, {
        documentId,
        chapterId,
        paragraphIndex,
        sentenceIndex,
        timestamp: Date.now(),
      });
      console.log('[Bookmark] Added:', { documentId, chapterId, paragraphIndex, sentenceIndex });

      const bookmarksObj = Object.fromEntries(newBookmarks);
      localStorage.setItem('bookmarks', JSON.stringify(bookmarksObj));

      return { bookmarks: newBookmarks };
    }),

    setShowIPA: (show) => set({ showIPA: show }),
    setShowChinese: (show) => set({ showChinese: show }),
    setExportFormat: (format) => {
      localStorage.setItem('exportFormat', format);
      set({ exportFormat: format });
    },
    setExportIncludeIPA: (show) => {
      localStorage.setItem('exportIncludeIPA', String(show));
      set({ exportIncludeIPA: show });
    },
    setExportIncludeChinese: (show) => {
      localStorage.setItem('exportIncludeChinese', String(show));
      set({ exportIncludeChinese: show });
    },
    setExportIncludePhraseList: (show) => {
      localStorage.setItem('exportIncludePhraseList', String(show));
      set({ exportIncludePhraseList: show });
    },
    setExportIncludePhraseTranslations: (show) => {
      localStorage.setItem('exportIncludePhraseTranslations', String(show));
      set({ exportIncludePhraseTranslations: show });
    },
    setLevel: (level) => set({ level }),
    setAutoMark: (autoMark) => set({ autoMark }),
    setAnnotationMode: (mode) => set({ annotationMode: mode }),
    setPhraseCardProvider: (provider) => set({ phraseCardProvider: provider }),
    setSentenceCardProvider: (provider) => set({ sentenceCardProvider: provider }),
    setAutoPronounceSetting: (enabled) => set({ autoPronounceSetting: enabled }),
    setAutoShowCardOnPlay: (enabled) => set({ autoShowCardOnPlay: enabled }),
  };
});

export const getLatestBookmark = (documentId: string) => {
  const bookmarks = useAppStore.getState().bookmarks;
  return bookmarks.get(documentId) || null;
};
