import type { WordAnnotation } from '../api';

export interface EncounteredMeaning {
  id: string;
  chinese: string;
  definition: string;
  example: string;
  level: string;
  partOfSpeech: string;
  baseForm?: string;
  ipa?: string;
  sentence?: string;
  documentTitle?: string;
  wordForms?: string[];
  emoji?: string;
  emojiImagePath?: string[];
  emojiModel?: string;
  createdAt: number;
  updatedAt: number;
  matchCount: number;
  shortLabel: string;
}

type AnnotationWithMeanings = WordAnnotation & {
  encounteredForms?: string[];
  encounteredMeanings?: EncounteredMeaning[];
  activeMeaningId?: string;
};

export function getCanonicalWord(
  word: string,
  annotation?: Pick<WordAnnotation, 'baseForm' | 'partOfSpeech'>,
): string {
  const surface = word.trim().toLowerCase();
  const baseForm = annotation?.baseForm?.trim().toLowerCase();
  const pos = normalizePos(annotation?.partOfSpeech);

  if (!baseForm || baseForm === surface) {
    return surface;
  }

  // Fall back to the lemma for common inflected/participle surfaces even when POS is noisy.
  if (/(ed|en|ing)$/.test(surface)) {
    return baseForm;
  }

  // Only reuse the lemma when the inflection pattern is high-confidence.
  if (pos === 'verb') {
    return baseForm;
  }

  if (pos === 'noun' && /s$/.test(surface)) {
    return baseForm;
  }

  if ((pos === 'adjective' || pos === 'adverb') && /(er|est)$/.test(surface)) {
    return baseForm;
  }

  return surface;
}

function normalizeWordForm(value?: string): string {
  return (value || '').trim().toLowerCase();
}

export function getEncounteredSurfaceForms(
  annotation: Pick<WordAnnotation, 'word' | 'baseForm' | 'encounteredForms'>,
  preferredSurface?: string,
): string[] {
  const canonicalForms = new Set(
    [annotation.word, annotation.baseForm]
      .map(normalizeWordForm)
      .filter(Boolean),
  );

  const orderedForms = [preferredSurface, ...(annotation.encounteredForms || [])]
    .map(normalizeWordForm)
    .filter(Boolean);

  return Array.from(new Set(orderedForms)).filter(form => !canonicalForms.has(form));
}

function normalizeText(value?: string): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value?: string): string[] {
  return normalizeText(value)
    .split(' ')
    .map(token => token.trim())
    .filter(token => token.length > 1);
}

function overlapScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let hits = 0;
  setA.forEach(token => {
    if (setB.has(token)) hits += 1;
  });
  return hits;
}

function normalizePos(partOfSpeech?: string): string {
  const raw = normalizeText(partOfSpeech).split(' ')[0] || '';
  const posAliases: Record<string, string> = {
    v: 'verb',
    vi: 'verb',
    vt: 'verb',
    verb: 'verb',
    verbs: 'verb',
    n: 'noun',
    noun: 'noun',
    nouns: 'noun',
    adj: 'adjective',
    adjective: 'adjective',
    adjectives: 'adjective',
    adv: 'adverb',
    adverb: 'adverb',
    adverbs: 'adverb',
  };

  return posAliases[raw] || raw;
}

function buildShortLabel(annotation: Pick<WordAnnotation, 'chinese' | 'definition'>): string {
  const chinese = (annotation.chinese || '')
    .split(/[;；,，/]/)
    .map(part => part.trim())
    .find(Boolean);
  if (chinese) return chinese.slice(0, 16);

  const english = (annotation.definition || '')
    .split(/[;,.]/)
    .map(part => part.trim())
    .find(Boolean);
  return (english || 'Meaning').slice(0, 24);
}

function createMeaningId(word: string, meaning: Pick<WordAnnotation, 'partOfSpeech' | 'baseForm' | 'chinese'>): string {
  const seed = [
    normalizeText(word),
    normalizePos(meaning.partOfSpeech),
    normalizeText(meaning.baseForm || ''),
    normalizeText(meaning.chinese).slice(0, 24),
  ]
    .filter(Boolean)
    .join('-')
    .replace(/\s+/g, '-');

  return `${seed || normalizeText(word)}-${Date.now()}`;
}

export function createMeaningFromAnnotation(annotation: WordAnnotation, existingId?: string): EncounteredMeaning {
  const now = Date.now();
  return {
    id: existingId || createMeaningId(annotation.word, annotation),
    chinese: annotation.chinese,
    definition: annotation.definition,
    example: annotation.example,
    level: annotation.level,
    partOfSpeech: annotation.partOfSpeech,
    baseForm: annotation.baseForm,
    ipa: annotation.ipa,
    sentence: annotation.sentence,
    documentTitle: annotation.documentTitle,
    wordForms: annotation.wordForms,
    emoji: annotation.emoji,
    emojiImagePath: annotation.emojiImagePath,
    emojiModel: annotation.emojiModel,
    createdAt: now,
    updatedAt: now,
    matchCount: 1,
    shortLabel: buildShortLabel(annotation),
  };
}

export function ensureEncounteredMeanings<T extends AnnotationWithMeanings>(annotation: T): T {
  if (annotation.encounteredMeanings && annotation.encounteredMeanings.length > 0) {
    const activeMeaningId = annotation.activeMeaningId || annotation.encounteredMeanings[0].id;
    return {
      ...annotation,
      encounteredForms: Array.from(new Set([annotation.word.toLowerCase(), ...(annotation.encounteredForms || [])])),
      activeMeaningId,
      encounteredMeanings: annotation.encounteredMeanings.map(meaning => ({
        ...meaning,
        shortLabel: meaning.shortLabel || buildShortLabel(meaning),
        matchCount: meaning.matchCount || 1,
      })),
    };
  }

  const firstMeaning = createMeaningFromAnnotation(annotation);
  return {
    ...annotation,
    encounteredForms: Array.from(new Set([annotation.word.toLowerCase(), ...(annotation.encounteredForms || [])])),
    encounteredMeanings: [firstMeaning],
    activeMeaningId: firstMeaning.id,
  };
}

export function getActiveMeaning<T extends AnnotationWithMeanings>(annotation: T): EncounteredMeaning {
  const normalized = ensureEncounteredMeanings(annotation);
  return (
    normalized.encounteredMeanings?.find(meaning => meaning.id === normalized.activeMeaningId) ||
    normalized.encounteredMeanings![0]
  );
}

export function applyMeaningToAnnotation<T extends AnnotationWithMeanings>(annotation: T, meaningId: string): T {
  const normalized = ensureEncounteredMeanings(annotation);
  const meaning =
    normalized.encounteredMeanings?.find(item => item.id === meaningId) ||
    normalized.encounteredMeanings![0];

  return {
    ...normalized,
    baseForm: meaning.baseForm,
    ipa: meaning.ipa || normalized.ipa,
    chinese: meaning.chinese,
    definition: meaning.definition,
    example: meaning.example,
    level: meaning.level,
    partOfSpeech: meaning.partOfSpeech,
    sentence: meaning.sentence,
    documentTitle: meaning.documentTitle,
    wordForms: meaning.wordForms,
    emoji: meaning.emoji,
    emojiImagePath: meaning.emojiImagePath,
    emojiModel: meaning.emojiModel,
    activeMeaningId: meaning.id,
  };
}

export function applyUpdatesToActiveMeaning<T extends AnnotationWithMeanings>(
  annotation: T,
  updates: Partial<WordAnnotation>,
): T {
  const normalized = ensureEncounteredMeanings(annotation);
  const activeMeaning = getActiveMeaning(normalized);

  const nextMeanings = normalized.encounteredMeanings!.map(meaning =>
    meaning.id === activeMeaning.id
      ? {
          ...meaning,
          emoji: updates.emoji !== undefined ? updates.emoji : meaning.emoji,
          emojiImagePath: updates.emojiImagePath !== undefined ? updates.emojiImagePath : meaning.emojiImagePath,
          emojiModel: updates.emojiModel !== undefined ? updates.emojiModel : meaning.emojiModel,
          baseForm: updates.baseForm !== undefined ? updates.baseForm : meaning.baseForm,
          ipa: updates.ipa !== undefined ? updates.ipa : meaning.ipa,
          chinese: updates.chinese !== undefined ? updates.chinese : meaning.chinese,
          definition: updates.definition !== undefined ? updates.definition : meaning.definition,
          example: updates.example !== undefined ? updates.example : meaning.example,
          level: updates.level !== undefined ? updates.level : meaning.level,
          partOfSpeech: updates.partOfSpeech !== undefined ? updates.partOfSpeech : meaning.partOfSpeech,
          sentence: updates.sentence !== undefined ? updates.sentence : meaning.sentence,
          documentTitle: updates.documentTitle !== undefined ? updates.documentTitle : meaning.documentTitle,
          wordForms: updates.wordForms !== undefined ? updates.wordForms : meaning.wordForms,
          updatedAt: Date.now(),
          shortLabel:
            updates.chinese !== undefined || updates.definition !== undefined
              ? buildShortLabel({
                  chinese: updates.chinese ?? meaning.chinese,
                  definition: updates.definition ?? meaning.definition,
                })
              : meaning.shortLabel,
        }
      : meaning,
  );

  return applyMeaningToAnnotation(
    {
      ...normalized,
      ...updates,
      encounteredForms: normalized.encounteredForms,
      encounteredMeanings: nextMeanings,
    },
    activeMeaning.id,
  );
}

function scoreMeaningMatch(existing: EncounteredMeaning, incoming: WordAnnotation): number {
  let score = 0;

  if (normalizePos(existing.partOfSpeech) && normalizePos(existing.partOfSpeech) === normalizePos(incoming.partOfSpeech)) {
    score += 3;
  }

  if (normalizeText(existing.baseForm) && normalizeText(existing.baseForm) === normalizeText(incoming.baseForm)) {
    score += 3;
  }

  const existingChinese = normalizeText(existing.chinese);
  const incomingChinese = normalizeText(incoming.chinese);
  if (existingChinese && incomingChinese) {
    if (existingChinese === incomingChinese) score += 4;
    else if (existingChinese.includes(incomingChinese) || incomingChinese.includes(existingChinese)) score += 2;
  }

  score += Math.min(
    3,
    overlapScore(tokenize(existing.definition), tokenize(incoming.definition)),
  );

  score += Math.min(
    2,
    overlapScore(
      tokenize(`${existing.example} ${existing.sentence}`),
      tokenize(`${incoming.example} ${incoming.sentence}`),
    ),
  );

  return score;
}

export function mergeAnnotationMeanings<T extends AnnotationWithMeanings>(
  existing: T | undefined,
  incoming: WordAnnotation,
): { annotation: T; isNewMeaning: boolean; activeMeaningId: string } {
  if (!existing) {
    const withMeaning = ensureEncounteredMeanings(incoming as T);
    return {
      annotation: withMeaning,
      isNewMeaning: true,
      activeMeaningId: withMeaning.activeMeaningId!,
    };
  }

  const normalized = ensureEncounteredMeanings(existing);
  const incomingSurface = incoming.word.toLowerCase();
  const meanings = normalized.encounteredMeanings || [];
  let bestMeaning = meanings[0];
  let bestScore = -1;

  for (const meaning of meanings) {
    const score = scoreMeaningMatch(meaning, incoming);
    if (score > bestScore) {
      bestScore = score;
      bestMeaning = meaning;
    }
  }

  const shouldReuseMeaning = bestScore >= 5;
  const now = Date.now();

  if (shouldReuseMeaning && bestMeaning) {
    const mergedMeaning: EncounteredMeaning = {
      ...bestMeaning,
      ...createMeaningFromAnnotation(incoming, bestMeaning.id),
      id: bestMeaning.id,
      createdAt: bestMeaning.createdAt,
      updatedAt: now,
      matchCount: (bestMeaning.matchCount || 1) + 1,
      emoji: incoming.emoji ?? bestMeaning.emoji,
      emojiImagePath:
        incoming.emojiImagePath && incoming.emojiImagePath.length > 0
          ? incoming.emojiImagePath
          : bestMeaning.emojiImagePath,
      emojiModel: incoming.emojiModel ?? bestMeaning.emojiModel,
    };

    const next = normalized.encounteredMeanings!.map(meaning =>
      meaning.id === bestMeaning.id ? mergedMeaning : meaning,
    );

    const annotation = applyMeaningToAnnotation(
      {
        ...normalized,
        encounteredForms: Array.from(new Set([...(normalized.encounteredForms || []), incomingSurface])),
        encounteredMeanings: next,
      } as T,
      mergedMeaning.id,
    );

    return {
      annotation,
      isNewMeaning: false,
      activeMeaningId: mergedMeaning.id,
    };
  }

  const newMeaning = createMeaningFromAnnotation(incoming);
  const annotation = applyMeaningToAnnotation(
    {
      ...normalized,
      encounteredForms: Array.from(new Set([...(normalized.encounteredForms || []), incomingSurface])),
      encounteredMeanings: [...normalized.encounteredMeanings!, newMeaning],
    } as T,
    newMeaning.id,
  );

  return {
    annotation,
    isNewMeaning: true,
    activeMeaningId: newMeaning.id,
  };
}

export function appendManualMeaning<T extends AnnotationWithMeanings>(
  existing: T,
  incoming: WordAnnotation,
): { annotation: T; activeMeaningId: string } {
  const normalized = ensureEncounteredMeanings(existing);
  const newMeaning = createMeaningFromAnnotation(incoming);
  const annotation = applyMeaningToAnnotation(
    {
      ...normalized,
      encounteredMeanings: [...normalized.encounteredMeanings!, newMeaning],
    } as T,
    newMeaning.id,
  );

  return {
    annotation,
    activeMeaningId: newMeaning.id,
  };
}

export function findBestMeaningIdForSentence<T extends AnnotationWithMeanings>(
  annotation: T,
  sentence?: string,
): string | null {
  if (!sentence) return null;

  const normalized = ensureEncounteredMeanings(annotation);
  const sentenceTokens = tokenize(sentence);
  if (sentenceTokens.length === 0) return normalized.activeMeaningId || normalized.encounteredMeanings?.[0]?.id || null;

  let bestMeaning = normalized.encounteredMeanings?.[0];
  let bestScore = -1;

  normalized.encounteredMeanings?.forEach(meaning => {
    const score = overlapScore(
      sentenceTokens,
      tokenize(`${meaning.sentence} ${meaning.example} ${meaning.definition} ${meaning.chinese}`),
    );
    if (score > bestScore) {
      bestScore = score;
      bestMeaning = meaning;
    }
  });

  return bestMeaning?.id || null;
}

export function findAnnotationEntry<T extends AnnotationWithMeanings>(
  annotations: Map<string, T>,
  surfaceWord: string,
): { key: string; annotation: T } | null {
  const normalizedSurface = surfaceWord.toLowerCase();
  const direct = annotations.get(normalizedSurface);
  if (direct) {
    return { key: normalizedSurface, annotation: direct };
  }

  return null;
}
