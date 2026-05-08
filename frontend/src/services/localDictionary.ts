import type { WordAnnotation } from '../api';
import { logWordDebug, shouldDebugWord } from '../utils/wordDebug';

export interface LocalDictEntry {
  word: string;
  ipa: string;
  pos: string;
  level: string;
  bncRank?: number;
  chinese: string;
  definition: string;
  examples?: string[];
}

class LocalDictionaryService {
  private isLoaded = false;
  private dictionary = new Map<string, LocalDictEntry>();
  private wordForms = new Map<string, string>();

  private hasDerivedForms(word: string): boolean {
    const lowerWord = word.toLowerCase();
    for (const [form, base] of this.wordForms.entries()) {
      if (form !== lowerWord && base === lowerWord) {
        return true;
      }
    }
    return false;
  }

  private shouldApplyMappedBaseForm(lowerWord: string, mappedBaseForm: string | null): boolean {
    if (!mappedBaseForm || mappedBaseForm === lowerWord) {
      return false;
    }

    // Guard against noisy reverse mappings like "light" -> "lighting".
    if (this.hasDerivedForms(lowerWord)) {
      return false;
    }

    return true;
  }

  private isUnknownPos(pos?: string): boolean {
    const normalized = (pos || '').trim().toLowerCase();
    return !normalized || normalized === 'unknown' || normalized === 'other';
  }

  private shouldPreferMappedEntry(
    lowerWord: string,
    directEntry: LocalDictEntry | undefined,
    mappedBaseForm: string | null,
    mappedEntry: LocalDictEntry | undefined,
  ): boolean {
    if (!this.shouldApplyMappedBaseForm(lowerWord, mappedBaseForm) || !mappedEntry) {
      return false;
    }

    if (!directEntry) {
      return true;
    }

    if (this.isUnknownPos(directEntry.pos)) {
      return true;
    }

    const chinese = (directEntry.chinese || '').toLowerCase();
    if (chinese.includes('过去分词') || chinese.includes('过去式') || chinese.includes('现在分词')) {
      return true;
    }

    return false;
  }

  async initialize(): Promise<void> {
    if (this.isLoaded) return;

    try {
      const dictionaries = [
        '/dictionaries/core-50000.json',
        '/dictionaries/core-30000.json',
        '/dictionaries/core-10000.json',
        '/dictionaries/core-5000.json',
        '/dictionaries/core-1000.json',
      ];

      let loaded = false;
      for (const dictPath of dictionaries) {
        try {
          const response = await fetch(dictPath);
          if (!response.ok) continue;

          const data: Record<string, LocalDictEntry> = await response.json();
          Object.entries(data).forEach(([word, entry]) => {
            this.dictionary.set(word.toLowerCase(), entry);
          });

          this.isLoaded = true;
          console.log(`[LocalDict] Loaded ${this.dictionary.size} words from ${dictPath}`);
          loaded = true;
          break;
        } catch {
          continue;
        }
      }

      if (!loaded) {
        console.warn('[LocalDict] No dictionary file found, will fallback to AI');
      }

      if (loaded) {
        try {
          const formsResponse = await fetch('/dictionaries/word-forms.json');
          if (formsResponse.ok) {
            const forms: Record<string, string> = await formsResponse.json();
            Object.entries(forms).forEach(([form, base]) => {
              this.wordForms.set(form.toLowerCase(), base.toLowerCase());
            });
            console.log(`[LocalDict] Loaded ${this.wordForms.size} word forms`);
          }
        } catch {
          console.log('[LocalDict] No word forms file, using rules only');
        }
      }
    } catch (error) {
      console.error('Failed to load local dictionary:', error);
    }
  }

  async lookup(word: string): Promise<WordAnnotation | null> {
    if (!this.isLoaded) {
      await this.initialize();
    }

    const lowerWord = word.toLowerCase();
    const mappedBaseForm = this.wordForms.get(lowerWord) || null;
    const mappedEntry = mappedBaseForm ? this.dictionary.get(mappedBaseForm) : undefined;
    const shouldApplyMappedBaseForm = this.shouldApplyMappedBaseForm(lowerWord, mappedBaseForm);

    let entry = this.dictionary.get(lowerWord);
    const directEntryWord = entry?.word || null;

    if (shouldDebugWord(lowerWord, mappedBaseForm, directEntryWord)) {
      logWordDebug('LocalDictionary.lookup:start', {
        requestedWord: word,
        lowerWord,
        directEntryWord,
        directEntryPos: entry?.pos || null,
        mappedBaseForm,
        shouldApplyMappedBaseForm,
        mappedBaseExistsInDictionary: mappedBaseForm ? this.dictionary.has(mappedBaseForm) : false,
      });
    }

    if (!entry) {
      const baseForm = this.findBaseForm(lowerWord);
      if (baseForm) {
        entry = this.dictionary.get(baseForm);
        if (shouldDebugWord(lowerWord, baseForm, entry?.word)) {
          logWordDebug('LocalDictionary.lookup:resolved-via-base-form', {
            lowerWord,
            baseForm,
            resolvedEntryWord: entry?.word || null,
            resolvedEntryPos: entry?.pos || null,
          });
        }
      }
    } else if (mappedBaseForm && mappedBaseForm !== lowerWord && shouldDebugWord(lowerWord, mappedBaseForm, directEntryWord)) {
      logWordDebug('LocalDictionary.lookup:direct-entry-overrides-base-form-map', {
        lowerWord,
        directEntryWord,
        directEntryPos: entry?.pos || null,
        mappedBaseForm,
        note: 'Direct dictionary hit prevented fallback to mapped base form.',
      });
    }

    if (this.shouldPreferMappedEntry(lowerWord, entry, mappedBaseForm, mappedEntry) && mappedEntry) {
      if (shouldDebugWord(lowerWord, mappedBaseForm, entry?.word, mappedEntry.word)) {
        logWordDebug('LocalDictionary.lookup:prefer-mapped-entry', {
          lowerWord,
          mappedBaseForm,
          directEntry: entry || null,
          mappedEntry,
        });
      }
      entry = mappedEntry;
    }

    if (!entry) {
      if (shouldDebugWord(lowerWord, mappedBaseForm)) {
        logWordDebug('LocalDictionary.lookup:miss', {
          lowerWord,
          mappedBaseForm,
        });
      }
      return null;
    }

    const resolvedBaseForm =
      shouldApplyMappedBaseForm && mappedBaseForm && this.dictionary.has(mappedBaseForm)
        ? mappedBaseForm
        : entry.word;
    const resolvedPartOfSpeech =
      !this.isUnknownPos(entry.pos)
        ? entry.pos
        : mappedEntry?.pos || entry.pos || 'unknown';
    const wordForms = this.getWordForms(resolvedBaseForm);
    const baseEntry = this.dictionary.get(resolvedBaseForm);
    const resolvedBncRank = Number(baseEntry?.bncRank || entry.bncRank || 0) || undefined;

    const annotation = {
      word: lowerWord,
      baseForm: resolvedBaseForm,
      ipa: entry.ipa || '',
      chinese: entry.chinese || '',
      definition: entry.definition || '',
      example: entry.examples?.[0] || '',
      level: entry.level || 'B2',
      bncRank: resolvedBncRank,
      partOfSpeech: resolvedPartOfSpeech,
      wordForms: wordForms.length > 0 ? wordForms : undefined,
    };

    if (shouldDebugWord(lowerWord, annotation.baseForm, entry.word)) {
      logWordDebug('LocalDictionary.lookup:return', {
        lowerWord,
        annotation,
      });
    }

    return annotation;
  }

  private findBaseForm(word: string): string | null {
    const mapped = this.wordForms.get(word);
    if (mapped && this.dictionary.has(mapped)) {
      console.log(`[LocalDict] Found in forms map: "${word}" -> "${mapped}"`);
      return mapped;
    }

    const rules = [
      { pattern: /ing$/, replacements: ['', 'e'] },
      { pattern: /ed$/, replacements: ['', 'e'] },
      { pattern: /s$/, replacements: [''] },
      { pattern: /es$/, replacements: ['', 'e'] },
      { pattern: /ies$/, replacements: ['y'] },
      { pattern: /er$/, replacements: ['', 'e'] },
      { pattern: /est$/, replacements: ['', 'e'] },
      { pattern: /([^aeiou])\1ing$/, replacements: ['$1'] },
      { pattern: /([^aeiou])\1ed$/, replacements: ['$1'] },
    ];

    for (const rule of rules) {
      for (const replacement of rule.replacements) {
        const candidate = word.replace(rule.pattern, replacement);
        if (candidate !== word && this.dictionary.has(candidate)) {
          console.log(`[LocalDict] Lemmatized by rule: "${word}" -> "${candidate}"`);
          return candidate;
        }
      }
    }

    return null;
  }

  async lookupBatch(words: string[]): Promise<Map<string, WordAnnotation>> {
    if (!this.isLoaded) {
      await this.initialize();
    }

    const results = new Map<string, WordAnnotation>();
    for (const word of words) {
      const result = await this.lookup(word);
      if (result) {
        results.set(word.toLowerCase(), result);
      }
    }

    return results;
  }

  has(word: string): boolean {
    return this.dictionary.has(word.toLowerCase());
  }

  size(): number {
    return this.dictionary.size;
  }

  getWordForms(baseWord: string): string[] {
    if (!this.isLoaded) {
      return [];
    }

    const forms: string[] = [];
    const baseLower = baseWord.toLowerCase();
    this.wordForms.forEach((base, form) => {
      if (base === baseLower && form !== baseLower) {
        forms.push(form);
      }
    });

    return forms;
  }

  getStats() {
    return {
      totalWords: this.dictionary.size,
      isLoaded: this.isLoaded,
    };
  }
}

export const localDictionary = new LocalDictionaryService();
