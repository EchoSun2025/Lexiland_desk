import type { Paragraph as ParagraphType, Token as TokenType } from '../utils/tokenize';
import { tokenizeWords } from '../utils/tokenize';
import type { MouseEvent, ReactNode } from 'react';
import Sentence from './Sentence';
import Word from './Word';

type RenderMode = 'default' | 'markdown';

type MarkdownInlineSegment = {
  text: string;
  style: 'plain' | 'bold' | 'italic' | 'code';
};

interface ParagraphProps {
  paragraph: ParagraphType;
  knownWords: Set<string>;
  markedWords: Set<string>;
  phraseMarkedRanges: Array<{ pIndex: number; sIndex: number; startTokenIndex: number; endTokenIndex: number }>;
  annotatedPhraseRanges: Array<{ pIndex: number; sIndex: number; startTokenIndex: number; endTokenIndex: number; phrase: string }>;
  underlinePhraseRanges: Array<{ pIndex: number; sIndex: number; startTokenIndex: number; endTokenIndex: number; color: string }>;
  learntWords: Set<string>;
  annotations: Map<string, { ipa?: string; chinese?: string }>;
  phraseAnnotations: Map<string, { phrase: string; chinese: string; explanation?: string; sentenceContext: string }>;
  phraseTranslationInserts: Map<string, boolean>;
  showIPA: boolean;
  showChinese: boolean;
  autoMark: boolean;
  autoPronounceSetting?: boolean;
  onWordClick?: (word: string, pIndex?: number, sIndex?: number, tokenIndex?: number) => void;
  onPhraseClick?: (phrase: string) => void;
  onMarkKnown?: (word: string) => void;
  onSentenceContextMenu?: (
    e: MouseEvent,
    payload: { text: string; pIndex: number; sIndex: number; focusWords: string[] }
  ) => void;
  sentenceCardKeys: Set<string>;
  onSentenceCardClick?: (sentenceText: string) => void;
  onParagraphAction?: (paragraphIndex: number) => void;
  paragraphIndex?: number;
  currentSentenceIndex?: number | null;
  currentWordIndex?: number;
  sentencesBeforeThisPara?: number;
  renderMode?: RenderMode;
}

function parseMarkdownInlineSegments(text: string): MarkdownInlineSegment[] {
  const segments: MarkdownInlineSegment[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), style: 'plain' });
    }

    const token = match[0];
    if (token.startsWith('`') && token.endsWith('`')) {
      segments.push({ text: token.slice(1, -1), style: 'code' });
    } else if (token.startsWith('**') && token.endsWith('**')) {
      segments.push({ text: token.slice(2, -2), style: 'bold' });
    } else if (token.startsWith('*') && token.endsWith('*')) {
      segments.push({ text: token.slice(1, -1), style: 'italic' });
    } else {
      segments.push({ text: token, style: 'plain' });
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), style: 'plain' });
  }

  return segments.filter((segment) => segment.text.length > 0);
}

function getMarkdownWrapperClass(paragraph: ParagraphType): string {
  const blockType = paragraph.blockType || 'paragraph';
  const headingLevel = paragraph.blockLevel || 1;

  if (blockType === 'heading') {
    if (headingLevel <= 1) return 'leading-tight mb-4 mt-6 rounded-xl px-3 py-2.5 bg-gradient-to-r from-stone-50 via-zinc-50 to-neutral-100 border border-stone-200 text-3xl font-black tracking-tight text-left text-stone-900 shadow-sm';
    if (headingLevel === 2) return 'leading-tight mb-3 mt-5 rounded-lg px-3 py-2 bg-gradient-to-r from-stone-50 to-zinc-100 border-l-4 border-stone-400 text-2xl font-bold text-left text-stone-900';
    if (headingLevel === 3) return 'leading-snug mb-3 mt-4 rounded-lg px-2.5 py-1.5 bg-stone-50 border-l-4 border-stone-300 text-xl font-bold text-left text-stone-900';
    return 'leading-snug mb-2 mt-3 rounded-lg px-2 py-1 bg-zinc-50 border-l-4 border-zinc-300 text-lg font-semibold text-left text-zinc-900';
  }

  if (blockType === 'blockquote') {
    return 'leading-relaxed mb-3 rounded-r-xl rounded-l-sm px-3 py-2.5 bg-stone-100/80 border-l-4 border-stone-400 text-stone-700 italic text-left shadow-sm';
  }

  if (blockType === 'code') {
    return 'leading-relaxed mb-3 rounded-xl px-3 py-3 bg-zinc-100 text-orange-700 font-mono text-sm overflow-x-auto whitespace-pre-wrap text-left border border-zinc-300 shadow-sm';
  }

  if (blockType === 'unordered-list-item' || blockType === 'ordered-list-item') {
    return 'leading-relaxed mb-1 rounded-lg px-2 py-1.5 hover:bg-stone-50 text-left';
  }

  return 'leading-relaxed mb-2 rounded-lg p-1.5 hover:bg-gray-50 text-left';
}

function getInlineSegmentClass(style: MarkdownInlineSegment['style']): string {
  if (style === 'bold') return 'font-bold text-stone-950';
  if (style === 'italic') return 'italic text-stone-700';
  if (style === 'code') return 'inline-flex items-center px-1.5 py-0.5 rounded-md bg-zinc-100 text-orange-700 border border-zinc-400 font-mono text-[0.95em] shadow-sm';
  return '';
}

export default function Paragraph({
  paragraph,
  knownWords,
  markedWords,
  phraseMarkedRanges,
  annotatedPhraseRanges,
  underlinePhraseRanges,
  learntWords,
  annotations,
  phraseAnnotations,
  phraseTranslationInserts,
  showIPA,
  showChinese,
  autoMark,
  autoPronounceSetting = false,
  onWordClick,
  onPhraseClick,
  onMarkKnown,
  onSentenceContextMenu,
  sentenceCardKeys,
  onSentenceCardClick,
  onParagraphAction,
  paragraphIndex = 0,
  currentSentenceIndex = null,
  currentWordIndex = -1,
  sentencesBeforeThisPara = 0,
  renderMode = 'default',
}: ParagraphProps) {
  if (renderMode === 'markdown') {
    const blockType = paragraph.blockType || 'paragraph';
    const inlineSegments = parseMarkdownInlineSegments(paragraph.text);
    let wordIndex = 0;

    const renderSegmentTokens = (segment: MarkdownInlineSegment, segmentIndex: number): ReactNode => {
      const segmentTokens = tokenizeWords(segment.text, 0);
      return (
        <span key={`${paragraph.id}-seg-${segmentIndex}`} className={getInlineSegmentClass(segment.style)}>
          {segmentTokens.map((token: TokenType, tokenIndex: number) => {
            if (token.type !== 'word') {
              return <span key={`${paragraph.id}-seg-${segmentIndex}-tok-${tokenIndex}`}>{token.text}</span>;
            }

            const currentWordTokenIndex = wordIndex;
            wordIndex += 1;

            return (
              <Word
                key={`${paragraph.id}-seg-${segmentIndex}-tok-${tokenIndex}`}
                token={token}
                isKnown={knownWords.has(token.text.toLowerCase())}
                isMarked={markedWords.has(token.text.toLowerCase())}
                isPhraseMarked={false}
                isAnnotatedPhrase={false}
                isHoveredPhrase={false}
                isLearnt={learntWords.has(token.text.toLowerCase())}
                annotation={annotations.get(token.text.toLowerCase())}
                showIPA={showIPA}
                showChinese={showChinese}
                autoMark={autoMark}
                autoPronounceSetting={blockType === 'code' ? false : autoPronounceSetting}
                onClick={blockType === 'code' ? undefined : () => onWordClick?.(token.text, paragraphIndex, 0, currentWordTokenIndex)}
                onMarkKnown={onMarkKnown}
                isCurrentWord={false}
              />
            );
          })}
        </span>
      );
    };

    return (
      <div className={`relative group ${getMarkdownWrapperClass(paragraph)}`}>
        {blockType !== 'code' && (
          <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              className="px-2 py-1 border border-border bg-white rounded-lg hover:bg-hover text-xs"
              onClick={() => onParagraphAction?.(paragraphIndex)}
            >
              &gt;
            </button>
          </div>
        )}
        {(blockType === 'unordered-list-item' || blockType === 'ordered-list-item') && (
          <span
            className={`inline-flex w-4 h-4 mr-2 mt-1 align-top items-center justify-center rounded-full text-[10px] font-bold ${
              blockType === 'unordered-list-item'
                ? 'bg-zinc-200 text-zinc-700'
                : 'bg-stone-200 text-stone-700'
            }`}
          >
            {paragraph.blockMarker || (blockType === 'unordered-list-item' ? '•' : '1.')}
          </span>
        )}
        {blockType === 'code' ? (
          <pre className="m-0 overflow-x-auto whitespace-pre-wrap">
            <code className="text-orange-700">{paragraph.text}</code>
          </pre>
        ) : (
          <span>{inlineSegments.map(renderSegmentTokens)}</span>
        )}
      </div>
    );
  }

  return (
    <div className="relative leading-relaxed mb-2 rounded-lg p-1.5 hover:bg-gray-50 group">
      <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          className="px-2 py-1 border border-border bg-white rounded-lg hover:bg-hover text-xs"
          onClick={() => onParagraphAction?.(paragraphIndex)}
        >
          &gt;
        </button>
      </div>
      {paragraph.sentences.map((sentence, index) => {
        const globalSentenceIndex = sentencesBeforeThisPara + index;
        const isCurrentSentence = currentSentenceIndex === globalSentenceIndex;

        return (
          <Sentence
            key={sentence.id}
            sentence={sentence}
            paragraphIndex={paragraphIndex}
            sentenceIndex={index}
            knownWords={knownWords}
            markedWords={markedWords}
            phraseMarkedRanges={phraseMarkedRanges}
            annotatedPhraseRanges={annotatedPhraseRanges}
            underlinePhraseRanges={underlinePhraseRanges}
            learntWords={learntWords}
            annotations={annotations}
            phraseAnnotations={phraseAnnotations}
            phraseTranslationInserts={phraseTranslationInserts}
            showIPA={showIPA}
            showChinese={showChinese}
            autoMark={autoMark}
            autoPronounceSetting={autoPronounceSetting}
            onWordClick={onWordClick}
            onPhraseClick={onPhraseClick}
            onMarkKnown={onMarkKnown}
            onSentenceContextMenu={onSentenceContextMenu}
            hasSentenceCard={sentenceCardKeys.has(sentence.text.toLowerCase())}
            onSentenceCardClick={onSentenceCardClick}
            isCurrentSentence={isCurrentSentence}
            currentWordIndex={currentWordIndex}
          />
        );
      })}
    </div>
  );
}
