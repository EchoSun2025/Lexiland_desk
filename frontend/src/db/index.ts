import Dexie from 'dexie';
import type { Table } from 'dexie';
import {
  appendManualMeaning,
  applyMeaningToAnnotation,
  applyUpdatesToActiveMeaning,
  ensureEncounteredMeanings,
  type EncounteredMeaning,
} from '../utils/wordMeanings';
import { logWordDebug, shouldDebugWord } from '../utils/wordDebug';

export interface KnownWord {
  word: string;
  level?: string; // A2, B1, B2, C1, C2
  addedAt: number;
}

export interface LearntWord {
  word: string;
  learntAt: number;
}

export interface CachedAnnotation {
  word: string;
  cardKey?: string;
  lemmaWord?: string;
  baseForm?: string;
  bncRank?: number;
  ipa: string;
  chinese: string;
  definition: string;
  example: string;
  level: string;
  partOfSpeech: string;
  sentence?: string;  // original sentence context
  documentTitle?: string;
  wordForms?: string[];
  emoji?: string;  // Unicode emoji锛堥粯璁ょ敓鎴愭垨鎵嬪姩閫夋嫨锛?
  emojiImagePath?: string[];  // 鍥剧墖璺緞鏁扮粍锛圓I/Unsplash锛屾敮鎸佸涓巻鍙茶褰曪級
  emojiModel?: string;  // 鏈€鏂板浘鐗囦娇鐢ㄧ殑妯″瀷
  encounteredForms?: string[];
  encounteredMeanings?: EncounteredMeaning[];
  activeMeaningId?: string;
  cachedAt: number;
}

export interface SavedDocument {
  id: string;
  title: string;
  type?: 'text' | 'epub';
  format?: 'plain' | 'markdown';
  content?: string;
  paragraphs?: any[];
  chapters?: any[];
  currentChapterId?: string;
  author?: string;
  createdAt: number;
  lastOpenedAt: number;
}

export interface CachedPhraseAnnotation {
  phrase: string;
  cardType?: 'phrase' | 'sentence' | 'paragraph' | 'grammar';
  chinese: string;
  explanation?: string;
  usagePattern?: string;
  usagePatternChinese?: string;
  isCommonUsage?: boolean;
  grammarPoints?: Array<{
    text: string;
    explanation: string;
  }>;
  focusWordNotes?: Array<{
    word: string;
    note: string;
  }>;
  sentenceContext: string;
  documentTitle?: string;
  cachedAt: number;
}

export interface CardNote {
  id: string;
  cardType: 'word' | 'phrase' | 'sentence' | 'paragraph' | 'grammar';
  cardKey: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export class LexiLandDB extends Dexie {
  knownWords!: Table<KnownWord, string>;
  learntWords!: Table<LearntWord, string>;
  annotations!: Table<CachedAnnotation, string>;
  phraseAnnotations!: Table<CachedPhraseAnnotation, string>;
  documents!: Table<SavedDocument, string>;
  cardNotes!: Table<CardNote, string>;

  constructor() {
    super('LexiLandDB');
    // Version 4: 鍘熸湁缁撴瀯
    this.version(4).stores({
      knownWords: 'word, level, addedAt',
      learntWords: 'word, learntAt',
      annotations: 'word, cachedAt',
      phraseAnnotations: 'phrase, cachedAt',
      documents: 'id, createdAt, lastOpenedAt',
    });
    
    // Version 5: 娣诲姞 emojiImagePath 瀛楁鍒?annotations
    this.version(5).stores({
      knownWords: 'word, level, addedAt',
      learntWords: 'word, learntAt',
      annotations: 'word, cachedAt',
      phraseAnnotations: 'phrase, cachedAt',
      documents: 'id, createdAt, lastOpenedAt',
    });
    
    // Version 6: 娣诲姞 emojiModel 鍜?manualEmoji 瀛楁
    this.version(6).stores({
      knownWords: 'word, level, addedAt',
      learntWords: 'word, learntAt',
      annotations: 'word, cachedAt',
      phraseAnnotations: 'phrase, cachedAt',
      documents: 'id, createdAt, lastOpenedAt',
    });
    
    // Version 7: 閲嶆瀯 emoji 鏁版嵁缁撴瀯锛歟moji (string) + emojiImagePath (array)
    this.version(7).stores({
      knownWords: 'word, level, addedAt',
      learntWords: 'word, learntAt',
      annotations: 'word, cachedAt',
      phraseAnnotations: 'phrase, cachedAt',
      documents: 'id, createdAt, lastOpenedAt',
    }).upgrade(async (trans) => {
      // 鏁版嵁杩佺Щ锛歮anualEmoji -> emoji, emojiImagePath (string) -> emojiImagePath (array)
      const annotations = await trans.table('annotations').toArray();
      for (const annotation of annotations) {
        const updated: any = { ...annotation };
        
        // 杩佺Щ manualEmoji -> emoji
        if ((annotation as any).manualEmoji) {
          updated.emoji = (annotation as any).manualEmoji;
          delete updated.manualEmoji;
        }
        
        // 杩佺Щ emojiImagePath (string) -> emojiImagePath (array)
        if ((annotation as any).emojiImagePath && typeof (annotation as any).emojiImagePath === 'string') {
          updated.emojiImagePath = [(annotation as any).emojiImagePath];
        } else if (!(annotation as any).emojiImagePath) {
          updated.emojiImagePath = [];
        }
        
        await trans.table('annotations').put(updated);
      }
      console.log('[DB Migration v7] Migrated emoji data structure for', annotations.length, 'annotations');
    });

    this.version(8).stores({
      knownWords: 'word, level, addedAt',
      learntWords: 'word, learntAt',
      annotations: 'word, cachedAt',
      phraseAnnotations: 'phrase, cachedAt',
      documents: 'id, createdAt, lastOpenedAt',
    }).upgrade(async (trans) => {
      const annotations = await trans.table('annotations').toArray();
      for (const annotation of annotations) {
        await trans.table('annotations').put({
          ...annotation,
          emojiImagePath: normalizeEmojiImagePaths((annotation as any).emojiImagePath),
        });
      }
      console.log('[DB Migration v8] Normalized emoji image paths to /learning-images/ for', annotations.length, 'annotations');
    });

    this.version(9).stores({
      knownWords: 'word, level, addedAt',
      learntWords: 'word, learntAt',
      annotations: 'word, cachedAt',
      phraseAnnotations: 'phrase, cachedAt',
      documents: 'id, createdAt, lastOpenedAt',
    }).upgrade(async (trans) => {
      const annotations = await trans.table('annotations').toArray();
      for (const annotation of annotations) {
        const normalized = ensureEncounteredMeanings(annotation as CachedAnnotation);
        await trans.table('annotations').put(normalized);
      }
      console.log('[DB Migration v9] Initialized encountered meanings for', annotations.length, 'annotations');
    });

    this.version(10).stores({
      knownWords: 'word, level, addedAt',
      learntWords: 'word, learntAt',
      annotations: 'word, cachedAt',
      phraseAnnotations: 'phrase, cardType, cachedAt',
      documents: 'id, createdAt, lastOpenedAt',
      cardNotes: 'id, [cardType+cardKey], createdAt',
    });
  }
}

export const db = new LexiLandDB();

function normalizeEmojiImagePath(path?: string): string | undefined {
  if (!path) return path;
  if (path.startsWith('/emoji-images/')) {
    return path.replace('/emoji-images/', '/learning-images/');
  }
  return path;
}

function normalizeEmojiImagePaths(paths?: string[]): string[] {
  if (!paths) return [];
  return paths.map(normalizeEmojiImagePath).filter((path): path is string => Boolean(path));
}

/**
 * Load known words from JSON file and save to IndexedDB
 */
export async function loadKnownWordsFromFile(jsonPath: string): Promise<string[]> {
  try {
    const response = await fetch(jsonPath);
    const data = await response.json();
    
    // Assume the JSON structure is: { words: ["word1", "word2", ...] }
    // Or: ["word1", "word2", ...]
    const words: string[] = Array.isArray(data) ? data : data.words || [];
    
    // Save to IndexedDB
    const knownWords = words.map(word => ({
      word: word.toLowerCase(),
      addedAt: Date.now(),
    }));
    
    await db.knownWords.bulkPut(knownWords);
    
    return words;
  } catch (error) {
    console.error('Failed to load known words:', error);
    return [];
  }
}

/**
 * Get all known words from IndexedDB
 */
export async function getAllKnownWords(): Promise<string[]> {
  const words = await db.knownWords.toArray();
  return words.map(w => w.word);
}

/**
 * Add a known word to IndexedDB
 */
export async function addKnownWord(word: string, level?: string): Promise<void> {
  await db.knownWords.put({
    word: word.toLowerCase(),
    level,
    addedAt: Date.now(),
  });
}

/**
 * Batch add known words to IndexedDB (faster for large batches)
 */
export async function batchAddKnownWords(words: string[], level?: string): Promise<void> {
  const timestamp = Date.now();
  const knownWords = words.map(word => ({
    word: word.toLowerCase(),
    level,
    addedAt: timestamp,
  }));
  
  await db.knownWords.bulkPut(knownWords);
}

/**
 * Cache an annotation in IndexedDB
 */
export async function cacheAnnotation(
  word: string,
  annotation: Omit<CachedAnnotation, 'word' | 'cachedAt'> & { word?: string },
): Promise<void> {
  const storageKey = word.toLowerCase();
  const cachedAnnotation = ensureEncounteredMeanings({
    ...annotation,
    word: storageKey,
    cardKey: annotation.cardKey || storageKey,
    lemmaWord: annotation.lemmaWord || annotation.word,
    emojiImagePath: normalizeEmojiImagePaths(annotation.emojiImagePath),
    cachedAt: Date.now(),
  });

  if (shouldDebugWord(word, cachedAnnotation.baseForm, cachedAnnotation.word)) {
    logWordDebug('DB.cacheAnnotation', {
      key: storageKey,
      annotation: cachedAnnotation,
    });
  }

  await db.annotations.put(cachedAnnotation);
}

/**
 * Get cached annotation from IndexedDB
 */
export async function getCachedAnnotation(word: string): Promise<CachedAnnotation | undefined> {
  const annotation = await db.annotations.get(word.toLowerCase());
  if (!annotation) return annotation;
  return ensureEncounteredMeanings({
    ...annotation,
    emojiImagePath: normalizeEmojiImagePaths(annotation.emojiImagePath),
  });
}

/**
 * Get all cached annotations from IndexedDB
 */
export async function getAllCachedAnnotations(): Promise<CachedAnnotation[]> {
  const annotations = await db.annotations.toArray();
  return annotations.map(annotation =>
    ensureEncounteredMeanings({
      ...annotation,
      emojiImagePath: normalizeEmojiImagePaths(annotation.emojiImagePath),
    }),
  );
}

/**
 * Update emoji for a word annotation (unicode emoji)
 */
export async function updateEmoji(word: string, emoji: string, onUpdate?: (updates: Partial<CachedAnnotation>) => void): Promise<void> {
  const annotation = await db.annotations.get(word.toLowerCase());
  if (annotation) {
    const updatedAnnotation = applyUpdatesToActiveMeaning(ensureEncounteredMeanings(annotation), { emoji });
    await db.annotations.put(updatedAnnotation);
    console.log('[DB] Updated emoji for:', word, emoji);
    
    // 鍥炶皟锛氶€氱煡 store 鏇存柊
    if (onUpdate) {
      onUpdate({
        emoji: updatedAnnotation.emoji,
        encounteredMeanings: updatedAnnotation.encounteredMeanings,
        activeMeaningId: updatedAnnotation.activeMeaningId,
      });
    }
  } else {
    console.warn('[DB] Annotation not found for word:', word, '- Cannot save emoji');
  }
}

/**
 * Add image path to a word annotation (Unsplash/AI)
 */
export async function addEmojiImagePath(word: string, imagePath: string, model?: string, onUpdate?: (updates: Partial<CachedAnnotation>) => void): Promise<void> {
  const annotation = await db.annotations.get(word.toLowerCase());
  if (annotation) {
    // 鍒濆鍖栨暟缁勶紙濡傛灉涓嶅瓨鍦級
    if (!annotation.emojiImagePath) {
      annotation.emojiImagePath = [];
    }
    
    // 娣诲姞鏂板浘鐗囪矾寰勫埌鏁扮粍寮€澶达紙鏈€鏂扮殑鍦ㄥ墠闈級
    annotation.emojiImagePath.unshift(normalizeEmojiImagePath(imagePath)!);
    
    // 闄愬埗鏈€澶氫繚瀛?5 寮犲巻鍙插浘鐗?
    if (annotation.emojiImagePath.length > 5) {
      annotation.emojiImagePath = annotation.emojiImagePath.slice(0, 5);
    }
    
    // 鏇存柊妯″瀷淇℃伅锛堝鏋滄彁渚涳級
    if (model) {
      annotation.emojiModel = model;
    }
    
    await db.annotations.put(annotation);
    console.log('[DB] Added emoji image path for:', word, imagePath);
    
    // 鍥炶皟锛氶€氱煡 store 鏇存柊
    if (onUpdate) {
      onUpdate({ 
        emojiImagePath: annotation.emojiImagePath,
        emojiModel: model 
      });
    }
  } else {
    console.warn('[DB] Annotation not found for word:', word, '- Cannot save emoji image path');
  }
}

export async function addEmojiImagePathToActiveMeaning(word: string, imagePath: string, model?: string, onUpdate?: (updates: Partial<CachedAnnotation>) => void): Promise<void> {
  const annotation = await db.annotations.get(word.toLowerCase());
  if (!annotation) {
    console.warn('[DB] Annotation not found for word:', word, '- Cannot save emoji image path');
    return;
  }

  const normalized = ensureEncounteredMeanings(annotation);
  const nextImagePaths = [normalizeEmojiImagePath(imagePath)!, ...(normalized.emojiImagePath || [])].slice(0, 5);
  const updatedAnnotation = applyUpdatesToActiveMeaning(normalized, {
    emojiImagePath: nextImagePaths,
    emojiModel: model,
  });

  await db.annotations.put(updatedAnnotation);

  if (onUpdate) {
    onUpdate({
      emojiImagePath: updatedAnnotation.emojiImagePath,
      emojiModel: updatedAnnotation.emojiModel,
      encounteredMeanings: updatedAnnotation.encounteredMeanings,
      activeMeaningId: updatedAnnotation.activeMeaningId,
    });
  }
}

export async function setActiveMeaning(word: string, meaningId: string, onUpdate?: (updates: Partial<CachedAnnotation>) => void): Promise<void> {
  const annotation = await db.annotations.get(word.toLowerCase());
  if (!annotation) {
    console.warn('[DB] Annotation not found for word:', word, '- Cannot switch meaning');
    return;
  }

  const updatedAnnotation = applyMeaningToAnnotation(ensureEncounteredMeanings(annotation), meaningId);
  await db.annotations.put(updatedAnnotation);

  if (onUpdate) {
    onUpdate(updatedAnnotation);
  }
}

export async function updateActiveMeaningDetails(
  word: string,
  updates: Partial<CachedAnnotation>,
  onUpdate?: (updates: Partial<CachedAnnotation>) => void,
): Promise<void> {
  const annotation = await db.annotations.get(word.toLowerCase());
  if (!annotation) {
    console.warn('[DB] Annotation not found for word:', word, '- Cannot update meaning');
    return;
  }

  const updatedAnnotation = applyUpdatesToActiveMeaning(ensureEncounteredMeanings(annotation), updates);
  await db.annotations.put(updatedAnnotation);

  if (onUpdate) {
    onUpdate(updatedAnnotation);
  }
}

export async function addManualMeaning(word: string, meaning: Omit<CachedAnnotation, 'word' | 'cachedAt' | 'encounteredMeanings' | 'activeMeaningId'>, onUpdate?: (updates: Partial<CachedAnnotation>) => void): Promise<void> {
  const annotation = await db.annotations.get(word.toLowerCase());
  if (!annotation) {
    console.warn('[DB] Annotation not found for word:', word, '- Cannot add manual meaning');
    return;
  }

  const normalized = ensureEncounteredMeanings(annotation);
  const appended = appendManualMeaning(normalized, {
    ...normalized,
    ...meaning,
    word: normalized.word,
  });

  await db.annotations.put({
    ...appended.annotation,
    cachedAt: annotation.cachedAt,
  });

  if (onUpdate) {
    onUpdate(appended.annotation);
  }
}

/**
 * Add a learnt word to IndexedDB
 */
export async function addLearntWordToDB(word: string): Promise<void> {
  await db.learntWords.put({
    word: word.toLowerCase(),
    learntAt: Date.now(),
  });
}

/**
 * Remove a learnt word from IndexedDB
 */
export async function removeLearntWordFromDB(word: string): Promise<void> {
  await db.learntWords.delete(word.toLowerCase());
}

/**
 * Cache phrase annotation
 */
export async function cachePhraseAnnotation(phrase: string, annotation: {
  cardType?: 'phrase' | 'sentence' | 'paragraph' | 'grammar';
  chinese: string;
  explanation?: string;
  usagePattern?: string;
  usagePatternChinese?: string;
  isCommonUsage?: boolean;
  grammarPoints?: Array<{
    text: string;
    explanation: string;
  }>;
  focusWordNotes?: Array<{
    word: string;
    note: string;
  }>;
  sentenceContext: string;
  documentTitle?: string;
}): Promise<void> {
  await db.phraseAnnotations.put({
    phrase: phrase.toLowerCase(),
    cardType: annotation.cardType || 'phrase',
    chinese: annotation.chinese,
    explanation: annotation.explanation,
    usagePattern: annotation.usagePattern,
    usagePatternChinese: annotation.usagePatternChinese,
    isCommonUsage: annotation.isCommonUsage,
    grammarPoints: annotation.grammarPoints,
    focusWordNotes: annotation.focusWordNotes,
    sentenceContext: annotation.sentenceContext,
    documentTitle: annotation.documentTitle,
    cachedAt: Date.now(),
  });
}

/**
 * Get all cached phrase annotations
 */
export async function getAllCachedPhraseAnnotations(): Promise<CachedPhraseAnnotation[]> {
  return await db.phraseAnnotations.toArray();
}

/**
 * Delete phrase annotation
 */
export async function deletePhraseAnnotation(phrase: string): Promise<void> {
  await db.phraseAnnotations.delete(phrase.toLowerCase());
}

export async function saveDocument(document: Omit<SavedDocument, 'lastOpenedAt'>): Promise<void> {
  await db.documents.put({
    ...document,
    lastOpenedAt: Date.now(),
  });
}

export async function getAllSavedDocuments(): Promise<SavedDocument[]> {
  return await db.documents.orderBy('lastOpenedAt').reverse().toArray();
}

export async function touchDocument(documentId: string): Promise<void> {
  const existing = await db.documents.get(documentId);
  if (existing) {
    await db.documents.put({
      ...existing,
      lastOpenedAt: Date.now(),
    });
  }
}

export async function getCardNotes(
  cardType: CardNote['cardType'],
  cardKey: string
): Promise<CardNote[]> {
  return await db.cardNotes
    .where('[cardType+cardKey]')
    .equals([cardType, cardKey])
    .sortBy('createdAt');
}

export async function addCardNote(note: Omit<CardNote, 'id' | 'createdAt'>): Promise<CardNote> {
  const createdAt = Date.now();
  const savedNote: CardNote = {
    ...note,
    id: `${note.cardType}-${note.cardKey}-${createdAt}-${Math.random().toString(36).slice(2)}`,
    createdAt,
  };
  await db.cardNotes.add(savedNote);
  return savedNote;
}

/**
 * Get all learnt words from IndexedDB
 */
export async function getAllLearntWords(): Promise<string[]> {
  const words = await db.learntWords.toArray();
  return words.map(w => w.word);
}

/**
 * Delete an annotation from IndexedDB
 */
export async function deleteAnnotation(word: string): Promise<void> {
  await db.annotations.delete(word.toLowerCase());
}

/**
 * Export all user data as JSON with timestamp
 */
export async function exportUserData(): Promise<string> {
  const [knownWords, learntWords, annotations, phraseAnnotations, cardNotes] = await Promise.all([
    db.knownWords.toArray(),
    db.learntWords.toArray(),
    db.annotations.toArray(),
    db.phraseAnnotations.toArray(),
    db.cardNotes.toArray()
  ]);

  const exportData = {
    exportedAt: new Date().toISOString(),
    exportDate: new Date().toLocaleDateString('zh-CN'),
    version: '1.2',
    data: {
      knownWords: knownWords.map(w => ({
        word: w.word,
        level: w.level,
        addedAt: new Date(w.addedAt).toISOString()
      })),
      learntWords: learntWords.map(w => ({
        word: w.word,
        learntAt: new Date(w.learntAt).toISOString()
      })),
      phraseAnnotations: phraseAnnotations.map(p => ({
        phrase: p.phrase,
        cardType: p.cardType,
        chinese: p.chinese,
        explanation: p.explanation,
        usagePattern: p.usagePattern,
        usagePatternChinese: p.usagePatternChinese,
        isCommonUsage: p.isCommonUsage,
        grammarPoints: p.grammarPoints,
        sentenceContext: p.sentenceContext,
        documentTitle: p.documentTitle,
        cachedAt: new Date(p.cachedAt).toISOString()
      })),
      annotations: annotations.map(a => ({
        word: a.word,
        cardKey: a.cardKey,
        lemmaWord: a.lemmaWord,
        baseForm: a.baseForm,
        bncRank: a.bncRank,
        ipa: a.ipa,
        chinese: a.chinese,
        definition: a.definition,
        example: a.example,
        level: a.level,
        partOfSpeech: a.partOfSpeech,
        sentenceContext: a.sentence,  // 淇濇寔鍚戝悗鍏煎锛屼絾瀵煎嚭鏃朵娇鐢?sentenceContext
        documentTitle: a.documentTitle,
        wordForms: a.wordForms,
        emoji: a.emoji,  // Unicode emoji
        emojiImagePath: normalizeEmojiImagePaths(a.emojiImagePath),  // 鍥剧墖璺緞鏁扮粍
        emojiModel: a.emojiModel,  // 鐢熸垚鍥剧墖鐨勬ā鍨?
        encounteredMeanings: a.encounteredMeanings,
        activeMeaningId: a.activeMeaningId,
        cachedAt: new Date(a.cachedAt).toISOString()
      })),
      cardNotes: cardNotes.map(note => ({
        ...note,
        createdAt: new Date(note.createdAt).toISOString()
      }))
    },
    statistics: {
      totalKnownWords: knownWords.length,
      totalLearntWords: learntWords.length,
      totalAnnotations: annotations.length,
      totalPhraseAnnotations: phraseAnnotations.length,
      totalCardNotes: cardNotes.length
    }
  };

  return JSON.stringify(exportData, null, 2);
}

/**
 * Import user data from JSON and merge with existing data
 */
export async function importUserData(jsonData: string): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const result = {
    imported: 0,
    skipped: 0,
    errors: [] as string[]
  };

  try {
    const data = JSON.parse(jsonData);
    
    if (!data.data || !data.version) {
      throw new Error('Invalid data format');
    }

    // Import known words
    if (data.data.knownWords && Array.isArray(data.data.knownWords)) {
      for (const item of data.data.knownWords) {
        try {
          const existing = await db.knownWords.get(item.word);
          if (!existing) {
            await db.knownWords.add({
              word: item.word,
              level: item.level,
              addedAt: new Date(item.addedAt).getTime()
            });
            result.imported++;
          } else {
            result.skipped++;
          }
        } catch (err: any) {
          result.errors.push(`Known word "${item.word}": ${err.message}`);
        }
      }
    }

    // Import learnt words
    if (data.data.learntWords && Array.isArray(data.data.learntWords)) {
      for (const item of data.data.learntWords) {
        try {
          const existing = await db.learntWords.get(item.word);
          if (!existing) {
            await db.learntWords.add({
              word: item.word,
              learntAt: new Date(item.learntAt).getTime()
            });
            result.imported++;
          } else {
            result.skipped++;
          }
        } catch (err: any) {
          result.errors.push(`Learnt word "${item.word}": ${err.message}`);
        }
      }
    }

    // Import annotations
    if (data.data.annotations && Array.isArray(data.data.annotations)) {
      for (const item of data.data.annotations) {
        try {
          const storageKey = (item.cardKey || item.word).toLowerCase();
          const existing = await db.annotations.get(storageKey);
          if (!existing) {
            const importedAnnotation = {
              word: storageKey,
              cardKey: item.cardKey || storageKey,
              lemmaWord: item.lemmaWord || item.baseForm || item.word,
              baseForm: item.baseForm,
              bncRank: item.bncRank,
              ipa: item.ipa,
              chinese: item.chinese,
              definition: item.definition,
              example: item.example,
              level: item.level,
              partOfSpeech: item.partOfSpeech,
              sentence: item.sentenceContext || item.sentence,  // 鏀寔鏂版棫鏍煎紡
              documentTitle: item.documentTitle,
              wordForms: item.wordForms,
              emoji: item.emoji,  // Unicode emoji
              emojiImagePath: normalizeEmojiImagePaths(item.emojiImagePath),  // 鍥剧墖璺緞鏁扮粍
              emojiModel: item.emojiModel,  // 鐢熸垚鍥剧墖鐨勬ā鍨?
              encounteredMeanings: item.encounteredMeanings,
              activeMeaningId: item.activeMeaningId,
              cachedAt: new Date(item.cachedAt).getTime()
            };
            if (shouldDebugWord(importedAnnotation.word, importedAnnotation.baseForm)) {
              logWordDebug('DB.importUserData:annotation-import', {
                importedAnnotation,
              });
            }
            await db.annotations.add(importedAnnotation);
            result.imported++;
          } else {
            if (shouldDebugWord(item.word, item.baseForm)) {
              logWordDebug('DB.importUserData:annotation-skipped-existing', {
                existing,
                incoming: item,
              });
            }
            result.skipped++;
          }
        } catch (err: any) {
          result.errors.push(`Annotation "${item.word}": ${err.message}`);
        }
      }
    }

    // Import phrase annotations
    if (data.data.phraseAnnotations && Array.isArray(data.data.phraseAnnotations)) {
      for (const item of data.data.phraseAnnotations) {
        try {
          const existing = await db.phraseAnnotations.get(item.phrase);
          if (!existing) {
            await db.phraseAnnotations.add({
              phrase: item.phrase,
              cardType: item.cardType || 'phrase',
              chinese: item.chinese,
              explanation: item.explanation,
              usagePattern: item.usagePattern,
              usagePatternChinese: item.usagePatternChinese,
              isCommonUsage: item.isCommonUsage,
              grammarPoints: item.grammarPoints,
              sentenceContext: item.sentenceContext,
              documentTitle: item.documentTitle,
              cachedAt: new Date(item.cachedAt).getTime()
            });
            result.imported++;
          } else {
            result.skipped++;
          }
        } catch (err: any) {
          result.errors.push(`Phrase annotation "${item.phrase}": ${err.message}`);
        }
      }
    }

    if (data.data.cardNotes && Array.isArray(data.data.cardNotes)) {
      for (const item of data.data.cardNotes) {
        try {
          const existing = await db.cardNotes.get(item.id);
          if (!existing) {
            await db.cardNotes.add({
              id: item.id,
              cardType: item.cardType,
              cardKey: item.cardKey,
              role: item.role,
              content: item.content,
              createdAt: new Date(item.createdAt).getTime()
            });
            result.imported++;
          } else {
            result.skipped++;
          }
        } catch (err: any) {
          result.errors.push(`Card note "${item.id}": ${err.message}`);
        }
      }
    }

    return result;
  } catch (error: any) {
    throw new Error(`Failed to parse import data: ${error.message}`);
  }
}
