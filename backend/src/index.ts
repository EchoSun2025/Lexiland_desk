import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { ensureSpeechDirectories, registerSpeechRoutes } from './speech.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const localEnvPath = path.resolve(__dirname, '..', '.env');
const workspaceEnvPath = path.resolve(__dirname, '..', '..', '.env');

if (fs.existsSync(localEnvPath)) {
  dotenv.config({ path: localEnvPath });
}

if (fs.existsSync(workspaceEnvPath)) {
  dotenv.config({ path: workspaceEnvPath, override: false });
}

const DEFAULT_DATA_DIR = 'D:\\0_EnglishLearning';
const LEARNING_DATA_DIR = path.resolve(process.env.LEARNING_DATA_DIR || DEFAULT_DATA_DIR);
const LEARNING_IMAGES_DIR = path.join(LEARNING_DATA_DIR, 'images');
const LEARNING_BACKUPS_DIR = path.join(LEARNING_DATA_DIR, 'backups');
const BACKUP_LATEST_SHRINK_RATIO = 0.5;
const BACKUP_LATEST_PROTECT_MIN_ITEMS = 200;

for (const dir of [LEARNING_DATA_DIR, LEARNING_IMAGES_DIR, LEARNING_BACKUPS_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

type BackupSummary = {
  path: string;
  fileName: string;
  exportedAt?: string;
  totalKnownWords: number;
  totalLearntWords: number;
  totalAnnotations: number;
  totalPhraseAnnotations: number;
  totalCardNotes: number;
  totalItems: number;
};

function summarizeBackupData(data: any, backupPath: string): BackupSummary {
  const totalKnownWords = data?.statistics?.totalKnownWords ?? data?.data?.knownWords?.length ?? 0;
  const totalLearntWords = data?.statistics?.totalLearntWords ?? data?.data?.learntWords?.length ?? 0;
  const totalAnnotations = data?.statistics?.totalAnnotations ?? data?.data?.annotations?.length ?? 0;
  const totalPhraseAnnotations = data?.statistics?.totalPhraseAnnotations ?? data?.data?.phraseAnnotations?.length ?? 0;
  const totalCardNotes = data?.statistics?.totalCardNotes ?? data?.data?.cardNotes?.length ?? 0;

  return {
    path: backupPath,
    fileName: path.basename(backupPath),
    exportedAt: typeof data?.exportedAt === 'string' ? data.exportedAt : undefined,
    totalKnownWords,
    totalLearntWords,
    totalAnnotations,
    totalPhraseAnnotations,
    totalCardNotes,
    totalItems: totalKnownWords + totalLearntWords + totalAnnotations + totalPhraseAnnotations + totalCardNotes,
  };
}

function readBackupSummary(backupPath: string): BackupSummary | null {
  if (!fs.existsSync(backupPath)) {
    return null;
  }

  try {
    const jsonData = fs.readFileSync(backupPath, 'utf-8');
    const data = JSON.parse(jsonData);
    return summarizeBackupData(data, backupPath);
  } catch {
    return null;
  }
}

function listBackupSummaries(): BackupSummary[] {
  if (!fs.existsSync(LEARNING_BACKUPS_DIR)) {
    return [];
  }

  const fileNames = fs
    .readdirSync(LEARNING_BACKUPS_DIR)
    .filter((name) => /^userdata-.*\.json$/i.test(name));

  return fileNames
    .map((name) => readBackupSummary(path.join(LEARNING_BACKUPS_DIR, name)))
    .filter((summary): summary is BackupSummary => Boolean(summary));
}

function shouldProtectLatestBackup(currentLatest: BackupSummary | null, incoming: BackupSummary): boolean {
  if (!currentLatest) {
    return false;
  }

  if (currentLatest.totalItems < BACKUP_LATEST_PROTECT_MIN_ITEMS) {
    return false;
  }

  return incoming.totalItems < currentLatest.totalItems * BACKUP_LATEST_SHRINK_RATIO;
}

function chooseBackupForLoad(): { summary: BackupSummary | null; warning?: string } {
  const latestPath = path.join(LEARNING_BACKUPS_DIR, 'userdata-latest.json');
  const latestSummary = readBackupSummary(latestPath);
  const allSummaries = listBackupSummaries();

  if (!latestSummary && allSummaries.length === 0) {
    return { summary: null };
  }

  const richestSummary = allSummaries.reduce<BackupSummary | null>((best, item) => {
    if (!best || item.totalItems > best.totalItems) {
      return item;
    }
    return best;
  }, latestSummary);

  if (
    latestSummary &&
    richestSummary &&
    richestSummary.path !== latestSummary.path &&
    latestSummary.totalItems < BACKUP_LATEST_PROTECT_MIN_ITEMS &&
    richestSummary.totalItems >= BACKUP_LATEST_PROTECT_MIN_ITEMS
  ) {
    return {
      summary: richestSummary,
      warning: `Latest backup looked incomplete (${latestSummary.totalItems} items). Loaded richer snapshot ${richestSummary.fileName} (${richestSummary.totalItems} items) instead.`,
    };
  }

  if (
    latestSummary &&
    richestSummary &&
    richestSummary.path !== latestSummary.path &&
    latestSummary.totalItems < richestSummary.totalItems * BACKUP_LATEST_SHRINK_RATIO
  ) {
    return {
      summary: richestSummary,
      warning: `Latest backup shrank from ${richestSummary.totalItems} items to ${latestSummary.totalItems}. Loaded richer snapshot ${richestSummary.fileName} instead.`,
    };
  }

  return { summary: latestSummary || richestSummary };
}

const fastify = Fastify({
  logger: true,
  // User-data backups can grow past Fastify's default body limit.
  bodyLimit: 20 * 1024 * 1024,
});

// 初始化 OpenAI 客户端
type AITextProvider = 'openai' | 'local';
type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

const TEXT_AI_PROVIDER: AITextProvider = process.env.AI_TEXT_PROVIDER === 'local' ? 'local' : 'openai';
const OPENAI_TEXT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const LOCAL_LLM_BASE_URL = (process.env.LOCAL_LLM_BASE_URL || 'http://127.0.0.1:11434/v1').replace(/\/+$/, '');
const LOCAL_LLM_MODEL = process.env.LOCAL_LLM_MODEL || 'qwen2.5:7b';

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  : null;

const localTextClient = new OpenAI({
  apiKey: process.env.LOCAL_LLM_API_KEY || 'ollama',
  baseURL: LOCAL_LLM_BASE_URL,
});

function resolveTextProvider(provider?: string): AITextProvider {
  return provider === 'local' || provider === 'openai' ? provider : TEXT_AI_PROVIDER;
}

function getTextClient(provider?: AITextProvider): OpenAI {
  if (provider === 'local') {
    return localTextClient;
  }

  if (!openai) {
    throw new Error('OPENAI_API_KEY is required when AI_TEXT_PROVIDER=openai');
  }

  return openai;
}

function getTextModel(provider?: AITextProvider): string {
  return provider === 'local' ? LOCAL_LLM_MODEL : OPENAI_TEXT_MODEL;
}

function getTextProviderLabel(provider?: AITextProvider): string {
  return provider === 'local'
    ? `local model "${LOCAL_LLM_MODEL}" via ${LOCAL_LLM_BASE_URL}`
    : `OpenAI model "${OPENAI_TEXT_MODEL}"`;
}

function getImageClient(): OpenAI {
  if (!openai) {
    throw new Error('OPENAI_API_KEY is required for image generation');
  }

  return openai;
}

async function createTextCompletion(options: {
  messages: ChatMessage[];
  temperature?: number;
  jsonMode?: boolean;
  maxTokens?: number;
  provider?: AITextProvider;
}) {
  const provider = options.provider || TEXT_AI_PROVIDER;
  const client = getTextClient(provider);
  return client.chat.completions.create({
    model: getTextModel(provider),
    messages: options.messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens,
    ...(options.jsonMode && provider === 'openai'
      ? { response_format: { type: 'json_object' as const } }
      : {}),
  });
}

function extractTextContent(content: string): string {
  const trimmed = content.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fencedMatch?.[1]?.trim() || trimmed;
}

function parseJsonResponse<T>(content: string, provider?: AITextProvider): T {
  const normalized = extractTextContent(content);

  try {
    return JSON.parse(normalized) as T;
  } catch {
    const objectMatch = normalized.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return JSON.parse(objectMatch[0]) as T;
    }
    throw new Error(`Failed to parse JSON returned by ${getTextProviderLabel(provider)}`);
  }
}

// 注册 CORS
const devOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

await fastify.register(cors, {
  origin: (origin, callback) => {
    if (process.env.NODE_ENV === 'production') {
      callback(null, origin === 'https://lexiland.app');
      return;
    }

    // Allow local dev servers such as Vite on 5173/5174/5175 and non-browser clients.
    if (!origin || devOriginPattern.test(origin)) {
      callback(null, true);
      return;
    }

    callback(null, false);
  },
  credentials: true,
});

// Serve learning images from fixed data directory
await fastify.register(staticPlugin, {
  root: LEARNING_IMAGES_DIR,
  prefix: '/learning-images/',
});

const speechPaths = await ensureSpeechDirectories(LEARNING_DATA_DIR);
await fastify.register(staticPlugin, {
  root: speechPaths.audioDir,
  prefix: '/speech-audio/',
  decorateReply: false,
});

// 健康检查路由
fastify.get('/health', async (request, reply) => {
  return {
    status: 'ok',
    timestamp: Date.now(),
    dataDir: LEARNING_DATA_DIR,
    ai: {
      textProvider: TEXT_AI_PROVIDER,
      textModel: getTextModel(),
      localBaseUrl: TEXT_AI_PROVIDER === 'local' ? LOCAL_LLM_BASE_URL : undefined,
      imageProvider: 'openai',
    },
  };
});

// 测试路由
fastify.get('/api/test', async (request, reply) => {
  return { message: 'LexiLand Read Backend is running!' };
});

// 生词注释 API
interface AnnotateRequest {
  word: string;
  level?: string;
  context?: string;
}

// 短语注释 API
interface AnnotatePhraseRequest {
  phrase: string;
  sentenceContext: string;
  level?: string;
  cardType?: 'phrase' | 'sentence' | 'paragraph' | 'grammar';
  provider?: AITextProvider;
  focusWords?: string[];
}

interface GenerateMeaningFieldRequest {
  word: string;
  field: 'definition' | 'example' | 'wordForms';
  chinese: string;
  partOfSpeech?: string;
  sentenceContext?: string;
}

interface CardNoteReplyRequest {
  cardType: 'word' | 'phrase' | 'sentence' | 'paragraph' | 'grammar';
  cardText: string;
  note: string;
  history?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  context?: string;
}

fastify.post<{ Body: AnnotateRequest }>('/api/annotate', async (request, reply) => {
  const { word, level = 'B2', context } = request.body;

  if (!word || typeof word !== 'string') {
    return reply.code(400).send({ error: 'Word is required' });
  }

  try {
    const prompt = `You are a language learning assistant. Provide comprehensive annotation for the English word "${word}" suitable for a ${level} level learner.
${context ? `\nContext: "${context}"` : ''}

Please provide the following information in JSON format:
{
  "word": "${word}",
  "baseForm": "base form of the word if it's an inflected form (e.g., 'run' for 'ran', 'be' for 'was'), otherwise leave empty",
  "ipa": "International Phonetic Alphabet pronunciation (without slashes)",
  "chinese": "Concise Chinese translation - ONE SHORT WORD OR PHRASE ONLY, no semicolons, no extra explanations (简体中文)",
  "definition": "Clear English definition",
  "example": "A natural example sentence using this word",
  "level": "CEFR level (A1/A2/B1/B2/C1/C2)",
  "partOfSpeech": "Part of speech (noun/verb/adjective/etc.)"
}

Important: 
- If context is provided, interpret the word ONLY as it is used in that sentence. Do not default to the most common dictionary meaning if the sentence clearly indicates another sense.
- Identify the actual part of speech in the sentence. For inflected forms such as gerunds, participles, past tense, or plural forms, explain the contextual meaning of the inflected form, not a different lemma's common noun meaning.
- Example: in "Relief coursed through her", "coursed" is a verb meaning something like "surged/flowed through", not the noun "course". In a sentence where "springing" describes movement, treat it as a verb meaning "jumping/leaping", not the season "spring".
- If the word is an irregular past tense (e.g., 'ran'), past participle (e.g., 'spoken'), or other inflected form, provide the baseForm.
- The "example" field MUST contain a complete, natural sentence demonstrating the word's usage. NEVER leave it empty.
- Return ONLY the JSON object, no additional text.`;

    const completion = await createTextCompletion({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      jsonMode: true,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error(`No response from ${getTextProviderLabel()}`);
    }

    const annotation = parseJsonResponse<{
      example?: string;
      [key: string]: unknown;
    }>(content);

    // Validate required fields
    if (!annotation.example || annotation.example.trim() === '') {
      throw new Error('Generated annotation missing example sentence');
    }
    return {
      success: true,
      data: annotation,
      usage: completion.usage,
    };
  } catch (error: any) {
    fastify.log.error('Annotation error:', error);
    return reply.code(500).send({
      success: false,
      error: error.message || 'Failed to generate annotation',
    });
  }
});

fastify.post<{ Body: GenerateMeaningFieldRequest }>('/api/generate-meaning-field', async (request, reply) => {
  const { word, field, chinese, partOfSpeech, sentenceContext } = request.body;

  if (!word || typeof word !== 'string') {
    return reply.code(400).send({ success: false, error: 'Word is required' });
  }

  if (field !== 'definition' && field !== 'example' && field !== 'wordForms') {
    return reply.code(400).send({ success: false, error: 'Field must be definition, example, or wordForms' });
  }

  if (!chinese || typeof chinese !== 'string') {
    return reply.code(400).send({ success: false, error: 'Chinese meaning is required' });
  }

  try {
    const prompt =
      field === 'definition'
        ? `Write ONE short, clear English definition for the English word "${word}" meaning "${chinese}"${partOfSpeech ? ` as a ${partOfSpeech}` : ''}${sentenceContext ? ` in the sentence "${sentenceContext}"` : ''}. Return ONLY the definition text.`
        : field === 'example'
          ? `Write ONE natural English example sentence using the word "${word}" to mean "${chinese}"${partOfSpeech ? ` as a ${partOfSpeech}` : ''}${sentenceContext ? ` and stay close to this situation: "${sentenceContext}"` : ''}. Return ONLY the example sentence.`
          : `List the common inflected forms for the English word "${word}"${partOfSpeech ? ` as a ${partOfSpeech}` : ''}. Return ONLY a short comma-separated list such as "stride, strides, striding, strode, stridden".`;

    const completion = await createTextCompletion({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
    });

    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) {
      throw new Error(`No response from ${getTextProviderLabel()}`);
    }

    return {
      success: true,
      data: {
        field,
        text,
      },
      usage: completion.usage,
    };
  } catch (error: any) {
    fastify.log.error({ error, stack: error.stack }, 'Generate meaning field error');
    return reply.code(500).send({
      success: false,
      error: error.message || 'Failed to generate meaning field',
    });
  }
});

// 短语注释 API
fastify.post<{ Body: AnnotatePhraseRequest }>('/api/annotate-phrase', async (request, reply) => {
  const { phrase, sentenceContext, level = 'B2', cardType = 'phrase', provider, focusWords = [] } = request.body;
  const selectedProvider = resolveTextProvider(provider);
  const normalizedFocusWords = Array.isArray(focusWords)
    ? Array.from(
        new Set(
          focusWords
            .filter((item): item is string => typeof item === 'string')
            .map(item => item.trim())
            .filter(Boolean),
        ),
      )
    : [];

  fastify.log.info({ phrase, sentenceContext, level, cardType, provider: selectedProvider, focusWords: normalizedFocusWords }, 'Phrase annotation request');

  if (!phrase || typeof phrase !== 'string') {
    fastify.log.error({ phrase }, 'Invalid phrase');
    return reply.code(400).send({ success: false, error: 'Phrase is required' });
  }

  if (!sentenceContext || typeof sentenceContext !== 'string') {
    fastify.log.error({ sentenceContext }, 'Invalid sentenceContext');
    return reply.code(400).send({ success: false, error: 'Sentence context is required' });
  }

  try {
    let prompt: string;

    if (cardType === 'sentence') {
      prompt = `You are a language-learning assistant creating a sentence card for a ${level} learner.

Sentence:
"${sentenceContext}"

Focus words already marked by the learner in this sentence:
${normalizedFocusWords.length > 0 ? normalizedFocusWords.map(word => `- ${word}`).join('\n') : '(none)'}

Return ONE JSON object in this shape:
{
  "phrase": "${phrase}",
  "cardType": "sentence",
  "chinese": "Natural simplified Chinese translation of the full sentence",
  "explanation": "用简体中文写句子解析。说明整句是怎么组织起来的，重点解释这里真正值得学习的 B2 级语法或结构。",
  "usagePattern": "Optional reusable English pattern from the sentence, otherwise empty string",
  "usagePatternChinese": "Optional short Chinese gloss for the reusable pattern, otherwise empty string",
  "isCommonUsage": true,
  "grammarPoints": [
    { "text": "short quoted grammar chunk from the sentence", "explanation": "用简体中文写给 B2 学习者的解释" }
  ],
  "focusWordNotes": [
    { "word": "focus word", "note": "用简体中文说明这个词在本句中的搭配、补语结构、介词选择、时态、语态，或其他特别值得注意的语法点" }
  ],
  "sentenceContext": "${sentenceContext}"
}

Important:
- The translation in "chinese" must be simplified Chinese.
- The analysis in "explanation" must be in simplified Chinese.
- Every "grammarPoints[*].explanation" must be in simplified Chinese.
- If focus words are provided, inspect each one carefully in THIS sentence and explain any special collocation or grammar attached to it.
- If a focus word is used in a normal way with nothing special, say that briefly in simplified Chinese instead of inventing a problem.
- Include 2 to 5 grammarPoints only when they are actually helpful for a B2 learner.
- Prefer grammar that is visible in this exact sentence: clause structure, reduced clauses, tense/aspect, voice, complementation, prepositions, discourse markers, and fixed combinations.
- Do not include IPA.
- Return ONLY the JSON object, no markdown or extra commentary.`;
      prompt = `You are a language-learning assistant creating a sentence card for a ${level} learner.

Sentence:
"${sentenceContext}"

Return ONE JSON object in this shape:
{
  "phrase": "${phrase}",
  "cardType": "sentence",
  "chinese": "Natural simplified Chinese translation of the full sentence",
  "explanation": "用简体中文写句子解析，说明整句如何组织起来，并解释其中值得学习的 B2 语法或结构",
  "usagePattern": "Optional reusable English pattern from the sentence, otherwise empty string",
  "usagePatternChinese": "Optional short Chinese gloss for the reusable pattern, otherwise empty string",
  "isCommonUsage": true,
  "grammarPoints": [
    { "text": "short quoted grammar chunk from the sentence", "explanation": "用简体中文写给 B2 学习者的简洁解释" }
  ],
  "sentenceContext": "${sentenceContext}"
}

Important:
- The translation in "chinese" must be simplified Chinese.
- The analysis in "explanation" must be simplified Chinese.
- Every "grammarPoints[*].explanation" must be simplified Chinese.
- Include 2 to 4 grammarPoints only when they are actually helpful for a B2 learner.
- Prefer grammar that is visible in this exact sentence: clause structure, reduced clauses, tense/aspect, voice, complementation, prepositions, discourse markers, and fixed combinations.
- Do not include IPA.
- Do not include focusWordNotes.
- Return ONLY the JSON object, no markdown or extra commentary.`;
      prompt = `You are a language-learning assistant creating a compact sentence card for a ${level} learner.

Sentence:
"${sentenceContext}"

Return ONE JSON object in this shape:
{
  "phrase": "${phrase}",
  "cardType": "sentence",
  "chinese": "Natural simplified Chinese translation of the full sentence",
  "explanation": "用简体中文写一小段简短语法分析，控制在 1 到 2 句",
  "usagePattern": "Optional reusable English structure from the sentence, otherwise empty string",
  "usagePatternChinese": "Optional short Chinese gloss for the reusable structure, otherwise empty string",
  "grammarPoints": [
    { "text": "short quoted grammar chunk from the sentence", "explanation": "用简体中文写给 B2 学习者的简洁解释" }
  ],
  "sentenceContext": "${sentenceContext}"
}

Important:
- Keep the output compact.
- The translation in "chinese" must be simplified Chinese.
- The analysis in "explanation" must be simplified Chinese.
- Every "grammarPoints[*].explanation" must be simplified Chinese.
- usagePattern and usagePatternChinese should be present only when there is a genuinely reusable structure.
- Include 1 to 3 grammarPoints only when they are actually helpful for a B2 learner.
- Prefer grammar that is visible in this exact sentence: clause structure, tense/aspect, voice, complementation, prepositions, discourse markers, and fixed combinations.
- Do not include IPA.
- Do not include focusWordNotes.
- Return ONLY the JSON object, no markdown or extra commentary.`;
    } else {
      const cardLabel = cardType === 'paragraph'
        ? 'paragraph'
        : cardType === 'grammar'
          ? 'grammar point'
          : 'phrase or expression';

      prompt = `You are a language learning assistant. Provide annotation for the English ${cardLabel} "${phrase}" suitable for a ${level} level learner.

The phrase appears in this sentence:
"${sentenceContext}"

Please provide the following information in JSON format:
{
  "phrase": "${phrase}",
  "cardType": "${cardType}",
  "chinese": "Concise Chinese translation of this phrase in this context (简体中文)",
  "explanation": "If this is a fixed expression, idiom, or common collocation, explain its meaning and usage. If it's just a regular phrase, leave this field empty or null.",
  "usagePattern": "If this can be generalized into a reusable learner pattern, normalize it like 'help sb. (to) do sth.' Otherwise return empty string.",
  "usagePatternChinese": "Chinese explanation of the reusable learner pattern. Otherwise return empty string.",
  "isCommonUsage": true,
  "grammarPoints": [
    { "text": "short grammar chunk from the source", "explanation": "concise Chinese explanation" }
  ],
  "sentenceContext": "${sentenceContext}"
}

Important:
- Focus on translating the phrase accurately based on the sentence context
- If it's a fixed expression (idiom, phrasal verb, collocation), provide an explanation
- For sentence or paragraph cards, include 1-4 useful grammarPoints when present
- For phrase cards, include grammarPoints only when the phrase contains a reusable grammar pattern
- If it contains a teachable grammar or collocation pattern, fill usagePattern and usagePatternChinese
- If it's just a regular phrase with no special meaning, you can leave "explanation" empty and usagePattern empty
- Set isCommonUsage to true only if this phrase or pattern is reusable beyond this exact sentence
- Do NOT include IPA pronunciation
- Return ONLY the JSON object, no additional text.`;
    }

    const completion = await createTextCompletion({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      jsonMode: true,
      provider: selectedProvider,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error(`No response from ${getTextProviderLabel(selectedProvider)}`);
    }

    const parsedAnnotation = parseJsonResponse<Record<string, unknown>>(content, selectedProvider);
    delete (parsedAnnotation as Record<string, unknown>).focusWordNotes;

    const annotation = {
      cardType,
      grammarPoints: [],
      ...parsedAnnotation,
    };

    fastify.log.info({ annotation }, 'Phrase annotation success');

    return {
      success: true,
      data: annotation,
      usage: completion.usage,
    };
  } catch (error: any) {
    fastify.log.error({ error, stack: error.stack }, 'Phrase annotation error');
    return reply.code(500).send({
      success: false,
      error: error.message || 'Failed to generate phrase annotation',
    });
  }
});

// Unsplash 图片搜索 API
fastify.post<{ Body: CardNoteReplyRequest }>('/api/card-note-reply', async (request, reply) => {
  const { cardType, cardText, note, history = [], context } = request.body;

  if (!cardText || typeof cardText !== 'string') {
    return reply.code(400).send({ success: false, error: 'cardText is required' });
  }

  if (!note || typeof note !== 'string') {
    return reply.code(400).send({ success: false, error: 'note is required' });
  }

  try {
    const recentHistory = history.slice(-8);
    const completion = await createTextCompletion({
      messages: [
        {
          role: 'system',
          content:
            'You are a concise English reading tutor for Chinese-speaking learners. Answer in simplified Chinese unless the user asks otherwise. Focus on meaning, grammar, and usage tied to the card.',
        },
        {
          role: 'user',
          content: `Card type: ${cardType}
Card text: ${cardText}
${context ? `Context: ${context}` : ''}

Previous note conversation:
${recentHistory.map(item => `${item.role}: ${item.content}`).join('\n') || '(none)'}

User note/question: ${note}`,
        },
      ],
      temperature: 0.3,
    });

    const answer = completion.choices[0]?.message?.content?.trim();
    if (!answer) {
      throw new Error(`No response from ${getTextProviderLabel()}`);
    }

    return {
      success: true,
      data: {
        reply: answer,
      },
      usage: completion.usage,
    };
  } catch (error: any) {
    fastify.log.error({ error, stack: error.stack }, 'Card note reply error');
    return reply.code(500).send({
      success: false,
      error: error.message || 'Failed to generate note reply',
    });
  }
});

interface SearchImageRequest {
  word: string;
  definition?: string;
}

interface UnsplashSearchResponse {
  results?: Array<{
    urls?: {
      regular?: string;
    };
    user?: {
      name?: string;
      links?: {
        html?: string;
      };
    };
  }>;
}

function buildSearchQueries(word: string, definition?: string): string[] {
  const queries: string[] = [];
  if (definition) {
    if (definition.includes('n. ') && !definition.includes('v. ')) {
      queries.push(`${word} photo`, `${word}`);
    } else if (definition.includes('v. ')) {
      queries.push(`${word} action photo`, `${word} photo`, `${word}`);
    } else if (definition.includes('adj. ')) {
      queries.push(`${word} feeling`, `${word} emotion`, `${word} photo`, `${word}`);
    } else {
      queries.push(`${word} photo`, `${word}`);
    }
  } else {
    queries.push(`${word} photo`, `${word}`);
  }
  return queries;
}

async function downloadImageToLocal(imageUrl: string, word: string): Promise<string> {
  const sanitizedWord = word.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const extension = imageUrl.toLowerCase().includes('.png') ? 'png' : 'jpg';
  const filename = `${sanitizedWord}_${Date.now()}.${extension}`;
  const filepath = path.join(LEARNING_IMAGES_DIR, filename);

  const imageData = await fetch(imageUrl);
  if (!imageData.ok) {
    throw new Error(`Failed to download image: ${imageData.statusText}`);
  }

  const buffer = Buffer.from(await imageData.arrayBuffer());
  fs.writeFileSync(filepath, buffer);

  return `/learning-images/${filename}`;
}

fastify.post<{ Body: SearchImageRequest }>('/api/search-image', async (request, reply) => {
  const { word, definition } = request.body;

  if (!word || typeof word !== 'string') {
    return reply.code(400).send({
      success: false,
      error: 'Word is required',
    });
  }

  try {
    const searchQueries = buildSearchQueries(word, definition);
    const unsplashKey = process.env.UNSPLASH_ACCESS_KEY;

    let remoteImageUrl: string | null = null;
    const source: 'unsplash' = 'unsplash';
    let successQuery = '';
    let photographerName: string | undefined;
    let photographerUrl: string | undefined;
    if (!unsplashKey || unsplashKey === 'your_unsplash_access_key_here') {
      throw new Error('Unsplash API key not configured');
    }

    for (const searchQuery of searchQueries) {
      fastify.log.info({ word, searchQuery }, 'Searching Unsplash');

      const response = await fetch(
        `https://api.unsplash.com/search/photos?query=${encodeURIComponent(searchQuery)}&per_page=1&orientation=squarish`,
        {
          headers: {
            Authorization: `Client-ID ${unsplashKey}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Unsplash API error: ${response.statusText}`);
      }

      const data = (await response.json()) as UnsplashSearchResponse;
      if (data.results && data.results.length > 0) {
        const photo = data.results[0];
        if (!photo.urls?.regular) {
          continue;
        }
        remoteImageUrl = photo.urls.regular;
        successQuery = searchQuery;
        photographerName = photo.user?.name;
        photographerUrl = photo.user?.links?.html;
        fastify.log.info({ word, searchQuery, resultsCount: data.results.length }, 'Found image from Unsplash');
        break;
      } else {
        fastify.log.info({ word, searchQuery }, 'No results on Unsplash, trying next query');
      }
    }

    if (!remoteImageUrl) {
      throw new Error('No images found from Unsplash');
    }

    const localPath = await downloadImageToLocal(remoteImageUrl, word);
    fastify.log.info({ word, localPath, source, successQuery }, 'Saved search image locally');

    return {
      success: true,
      data: {
        word,
        imageUrl: localPath,
        source,
        searchQuery: successQuery,
        photographer: photographerName,
        photographerUrl,
      },
    };
  } catch (error: any) {
    fastify.log.error({ 
      error: error.message, 
      stack: error.stack,
      word,
      searchQuery: `${word} photo`
    }, 'Image search error');
    return reply.code(500).send({
      success: false,
      error: error.message || 'Failed to search image',
    });
  }
});

interface SavePastedImageRequest {
  word: string;
  imageData: string; // data URL, e.g. data:image/png;base64,...
}

fastify.post<{ Body: SavePastedImageRequest }>('/api/save-pasted-image', async (request, reply) => {
  const { word, imageData } = request.body;

  if (!word || typeof word !== 'string') {
    return reply.code(400).send({ success: false, error: 'Word is required' });
  }
  if (!imageData || typeof imageData !== 'string' || !imageData.startsWith('data:image/')) {
    return reply.code(400).send({ success: false, error: 'Invalid image data. Expected data:image/* base64.' });
  }

  try {
    const match = imageData.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
    if (!match) {
      return reply.code(400).send({ success: false, error: 'Malformed image data URL.' });
    }

    const extRaw = match[1].toLowerCase();
    const ext = extRaw === 'jpeg' ? 'jpg' : extRaw;
    const base64 = match[2];
    const allowed = new Set(['png', 'jpg', 'webp', 'gif']);
    if (!allowed.has(ext)) {
      return reply.code(400).send({ success: false, error: `Unsupported image format: ${ext}` });
    }

    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length === 0) {
      return reply.code(400).send({ success: false, error: 'Empty image data.' });
    }
    if (buffer.length > 10 * 1024 * 1024) {
      return reply.code(400).send({ success: false, error: 'Image too large. Max 10MB.' });
    }

    const sanitizedWord = word.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const filename = `${sanitizedWord}_${Date.now()}.${ext}`;
    const filepath = path.join(LEARNING_IMAGES_DIR, filename);
    fs.writeFileSync(filepath, buffer);

    const localPath = `/learning-images/${filename}`;
    fastify.log.info({ word, localPath, size: buffer.length }, 'Saved pasted image locally');
    return {
      success: true,
      data: {
        word,
        imageUrl: localPath,
        source: 'clipboard',
      },
    };
  } catch (error: any) {
    fastify.log.error({ error: error.message, stack: error.stack, word }, 'Save pasted image error');
    return reply.code(500).send({
      success: false,
      error: error.message || 'Failed to save pasted image',
    });
  }
});

interface SaveUserBackupRequest {
  jsonData: string;
}

fastify.post<{ Body: SaveUserBackupRequest }>('/api/user-backup/save', async (request, reply) => {
  const { jsonData } = request.body;
  if (!jsonData || typeof jsonData !== 'string') {
    return reply.code(400).send({ success: false, error: 'jsonData is required' });
  }

  try {
    // validate json before saving
    const parsedData = JSON.parse(jsonData);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotPath = path.join(LEARNING_BACKUPS_DIR, `userdata-${timestamp}.json`);
    const latestPath = path.join(LEARNING_BACKUPS_DIR, 'userdata-latest.json');
    const incomingSummary = summarizeBackupData(parsedData, snapshotPath);
    const currentLatestSummary = readBackupSummary(latestPath);
    const preserveLatest = shouldProtectLatestBackup(currentLatestSummary, incomingSummary);

    fs.writeFileSync(snapshotPath, jsonData, 'utf-8');
    if (!preserveLatest) {
      fs.writeFileSync(latestPath, jsonData, 'utf-8');
    }

    return {
      success: true,
      data: {
        savedAt: new Date().toISOString(),
        snapshotPath,
        latestPath,
        warning: preserveLatest
          ? `Snapshot saved, but latest backup was preserved because the new backup only had ${incomingSummary.totalItems} items versus ${currentLatestSummary?.totalItems || 0} in latest.`
          : undefined,
      },
    };
  } catch (error: any) {
    fastify.log.error({ error: error.message }, 'Failed to save user backup');
    return reply.code(500).send({
      success: false,
      error: error.message || 'Failed to save user backup',
    });
  }
});

fastify.get('/api/user-backup/load', async (request, reply) => {
  try {
    const selected = chooseBackupForLoad();
    if (!selected.summary) {
      return reply.code(404).send({
        success: false,
        error: `No backup found in ${LEARNING_BACKUPS_DIR}`,
      });
    }
    const jsonData = fs.readFileSync(selected.summary.path, 'utf-8');
    return {
      success: true,
      data: {
        jsonData,
        path: selected.summary.path,
        warning: selected.warning,
      },
    };
  } catch (error: any) {
    fastify.log.error({ error: error.message }, 'Failed to load user backup');
    return reply.code(500).send({
      success: false,
      error: error.message || 'Failed to load user backup',
    });
  }
});

fastify.get('/api/user-backup/status', async () => {
  const latestPath = path.join(LEARNING_BACKUPS_DIR, 'userdata-latest.json');
  return {
    success: true,
    data: {
      dataDir: LEARNING_DATA_DIR,
      imagesDir: LEARNING_IMAGES_DIR,
      backupsDir: LEARNING_BACKUPS_DIR,
      hasLatestBackup: fs.existsSync(latestPath),
    },
  };
});

// AI 生成 Emoji 图片 API
interface GenerateEmojiRequest {
  word: string;
  definition: string;
  sentenceContext?: string;
}

fastify.post<{ Body: GenerateEmojiRequest }>('/api/generate-emoji', async (request, reply) => {
  const { word, definition, sentenceContext } = request.body;

  if (!word || typeof word !== 'string') {
    return reply.code(400).send({
      success: false,
      error: 'Word is required',
    });
  }

  try {
    // Step 1: 生成 visual hint
    const imageClient = getImageClient();
    const hintPrompt = `For the English word "${word}" (definition: ${definition})${sentenceContext ? ` used in context: "${sentenceContext}"` : ''}, generate a SHORT visual description (max 10 words) that could be used to create a simple emoji/icon representing this word's meaning. Focus on ONE clear, recognizable visual element.

Examples:
- "book" → "open book with visible pages"
- "run" → "person running with motion lines"
- "happy" → "smiling face with bright eyes"

Return ONLY the visual description, no explanation.`;

    const hintCompletion = await imageClient.chat.completions.create({
      model: OPENAI_TEXT_MODEL,
      messages: [{ role: 'user', content: hintPrompt }],
      temperature: 0.5,
      max_tokens: 30,
    });

    const visualHint = hintCompletion.choices[0]?.message?.content?.trim();
    if (!visualHint) {
      throw new Error('Failed to generate visual hint');
    }

    fastify.log.info({ word, visualHint }, 'Generated visual hint');

    // Step 2: 生成图片（带回退机制）
    const imagePrompt = `A simple, clean emoji-style icon: ${visualHint}. Minimalist design, solid colors, white background, centered, no text.`;
    
    let imageUrl: string | undefined;
    let modelUsed: string;
    let imageResponse: any;

    // 尝试模型列表（从最便宜到较贵）
    const modelsToTry = [
      { model: 'gpt-image-1-mini', quality: 'low' },
      { model: 'gpt-image-1', quality: 'low' },
      { model: 'dall-e-2', quality: undefined }, // dall-e-2 不支持 quality
    ];

    for (const config of modelsToTry) {
      try {
        fastify.log.info({ model: config.model, quality: config.quality }, 'Trying image generation');
        
        const params: any = {
          model: config.model,
          prompt: imagePrompt,
          n: 1,
          size: '1024x1024',
          response_format: 'url',
        };
        
        if (config.quality) {
          params.quality = config.quality;
        }
        
        imageResponse = await imageClient.images.generate(params);

        if (imageResponse.data && imageResponse.data.length > 0) {
          imageUrl = imageResponse.data[0]?.url;
          if (imageUrl) {
            modelUsed = config.model;
            fastify.log.info({ word, imageUrl, model: modelUsed }, 'Successfully generated image');
            break;
          }
        }
      } catch (modelError: any) {
        fastify.log.warn({ 
          model: config.model, 
          error: modelError.message,
          code: modelError.code 
        }, 'Model failed, trying next');
        continue;
      }
    }

    if (!imageUrl) {
      throw new Error('All image generation models failed');
    }

    // Step 3: 下载图片到本地
    const sanitizedWord = word.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const filename = `${sanitizedWord}_${Date.now()}.png`;
    const filepath = path.join(LEARNING_IMAGES_DIR, filename);

    // 下载图片
    fastify.log.info({ imageUrl, filepath }, 'Downloading image');
    const imageData = await fetch(imageUrl);
    if (!imageData.ok) {
      throw new Error(`Failed to download image: ${imageData.statusText}`);
    }
    
    const buffer = Buffer.from(await imageData.arrayBuffer());
    fs.writeFileSync(filepath, buffer);
    
    const localPath = `/learning-images/${filename}`;
    fastify.log.info({ word, localPath, model: modelUsed! }, 'Saved emoji image locally');

    return {
      success: true,
      data: {
        word,
        visualHint,
        imageUrl: localPath, // 返回本地路径
        originalUrl: imageUrl, // 保留原始 URL 用于调试
        model: modelUsed!, // 返回实际使用的模型
      },
      usage: {
        hint: hintCompletion.usage,
        image: imageResponse,
      },
    };
  } catch (error: any) {
    fastify.log.error({ error, stack: error.stack }, 'Emoji generation error');
    return reply.code(500).send({
      success: false,
      error: error.message || 'Failed to generate emoji',
    });
  }
});

// 启动服务器
await registerSpeechRoutes(fastify, {
  dataDir: LEARNING_DATA_DIR,
  speechAudioUrlPrefix: '/speech-audio',
  openai,
  createTextCompletion,
  resolveTextProvider,
  getTextProviderLabel,
});

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`✅ Backend server is running on http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
