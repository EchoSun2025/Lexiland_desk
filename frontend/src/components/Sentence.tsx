import type { Sentence as SentenceType } from '../utils/tokenize';
import Word from './Word';
import { useState, Fragment, useRef } from 'react';
import type { MouseEvent, TouchEvent } from 'react';
import { findAnnotationEntry } from '../utils/wordMeanings';

interface SentenceProps {
  sentence: SentenceType;
  paragraphIndex: number;
  sentenceIndex: number;
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
  autoPronounceSetting?: boolean;  // 自动发音开关
  onWordClick?: (word: string, pIndex?: number, sIndex?: number, tokenIndex?: number) => void;
  onPhraseClick?: (phrase: string) => void;
  onMarkKnown?: (word: string) => void;
  onSentenceContextMenu?: (
    e: MouseEvent,
    payload: { text: string; pIndex: number; sIndex: number; focusWords: string[] }
  ) => void;
  hasSentenceCard?: boolean;
  onSentenceCardClick?: (sentenceText: string) => void;
  isCurrentSentence?: boolean;
  currentWordIndex?: number;
}

export default function Sentence({ sentence, paragraphIndex, sentenceIndex, knownWords, markedWords, phraseMarkedRanges, annotatedPhraseRanges, underlinePhraseRanges, learntWords, annotations, phraseAnnotations, phraseTranslationInserts, showIPA, showChinese, autoMark, autoPronounceSetting = false, onWordClick, onPhraseClick, onMarkKnown, onSentenceContextMenu, hasSentenceCard = false, onSentenceCardClick, isCurrentSentence = false, currentWordIndex = -1 }: SentenceProps) {
  let wordCount = 0; // Track word index within this sentence
  const [hoveredUnderlineRange, setHoveredUnderlineRange] = useState<number | null>(null);
  const [hoveredAnnotatedPhraseIndex, setHoveredAnnotatedPhraseIndex] = useState<number | null>(null);
  const [hoveredPhraseMarkedIndex, setHoveredPhraseMarkedIndex] = useState<number | null>(null);
  const longPressTimerRef = useRef<number | undefined>(undefined);
  const didLongPressRef = useRef(false);
  const focusWords = Array.from(
    new Set(
      sentence.tokens
        .filter(token => token.type === 'word')
        .map(token => token.text.toLowerCase())
        .filter(word => markedWords.has(word)),
    ),
  );

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = undefined;
    }
  };

  const openContextMenuAt = (clientX: number, clientY: number) => {
    const syntheticEvent = {
      preventDefault() {},
      stopPropagation() {},
      clientX,
      clientY,
    } as unknown as MouseEvent;

    onSentenceContextMenu?.(syntheticEvent, {
      text: sentence.text,
      pIndex: paragraphIndex,
      sIndex: sentenceIndex,
      focusWords,
    });
  };

  const handleTouchStart = (e: TouchEvent<HTMLSpanElement>) => {
    if (e.touches.length !== 1) return;
    e.stopPropagation();
    const touch = e.touches[0];
    didLongPressRef.current = false;
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      didLongPressRef.current = true;
      openContextMenuAt(touch.clientX, touch.clientY);
    }, 500);
  };

  const handleTouchMove = () => {
    clearLongPressTimer();
  };

  const handleTouchEnd = (e: TouchEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    clearLongPressTimer();
    window.setTimeout(() => {
      didLongPressRef.current = false;
    }, 0);
  };

  const handleTouchCancel = (e: TouchEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    clearLongPressTimer();
    window.setTimeout(() => {
      didLongPressRef.current = false;
    }, 0);
  };

  return (
    <span
      className={`inline whitespace-pre-wrap ${
        isCurrentSentence
          ? 'bg-blue-100 rounded px-1'
          : hasSentenceCard
            ? 'bg-green-100/30 rounded px-1'
            : ''
      }`}
      onContextMenu={(e) => {
        e.stopPropagation();
        onSentenceContextMenu?.(e, {
          text: sentence.text,
          pIndex: paragraphIndex,
          sIndex: sentenceIndex,
          focusWords,
        });
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      {sentence.tokens.map((token, tokenIndex) => {
        const tokenPos = `p${paragraphIndex}-s${sentenceIndex}-t${tokenIndex}`;
        
        // Check if this token is in any phrase marked range (blue - selection)
        const phraseMarkedRangeIndex = phraseMarkedRanges.findIndex(range =>
          range.pIndex === paragraphIndex &&
          range.sIndex === sentenceIndex &&
          tokenIndex >= range.startTokenIndex &&
          tokenIndex <= range.endTokenIndex
        );
        const isInPhraseRange = phraseMarkedRangeIndex !== -1;
        
        // Check if this token is in the currently hovered phrase marked range
        const isInHoveredPhraseMarked = hoveredPhraseMarkedIndex !== null &&
          hoveredPhraseMarkedIndex === phraseMarkedRangeIndex;
        
        // Check if this token is in any annotated phrase range (blue-purple)
        const annotatedRangeIndex = annotatedPhraseRanges.findIndex(range =>
          range.pIndex === paragraphIndex &&
          range.sIndex === sentenceIndex &&
          tokenIndex >= range.startTokenIndex &&
          tokenIndex <= range.endTokenIndex
        );
        const annotatedRange = annotatedRangeIndex !== -1 ? annotatedPhraseRanges[annotatedRangeIndex] : null;
        const isInAnnotatedPhraseRange = !!annotatedRange;
        
        // Check if this token is in the currently hovered annotated phrase
        const isInHoveredAnnotatedPhrase = hoveredAnnotatedPhraseIndex !== null &&
          hoveredAnnotatedPhraseIndex === annotatedRangeIndex;

        // Check if this token is in any underline phrase range and get its color
        const underlineRangeIndex = underlinePhraseRanges.findIndex(range =>
          range.pIndex === paragraphIndex &&
          range.sIndex === sentenceIndex &&
          tokenIndex >= range.startTokenIndex &&
          tokenIndex <= range.endTokenIndex
        );
        const underlineRange = underlineRangeIndex !== -1 ? underlinePhraseRanges[underlineRangeIndex] : null;
        const isInUnderlineRange = !!underlineRange;
        const underlineColor = underlineRange?.color || 'purple';
        
        // Highlight if hovering over an underline range and this token is in a phrase range within that underline
        const shouldHighlight = hoveredUnderlineRange !== null && 
          isInPhraseRange &&
          underlinePhraseRanges[hoveredUnderlineRange] &&
          paragraphIndex === underlinePhraseRanges[hoveredUnderlineRange].pIndex &&
          sentenceIndex === underlinePhraseRanges[hoveredUnderlineRange].sIndex &&
          tokenIndex >= underlinePhraseRanges[hoveredUnderlineRange].startTokenIndex &&
          tokenIndex <= underlinePhraseRanges[hoveredUnderlineRange].endTokenIndex;

        const isWordToken = token.type === 'word';
        const isCurrentWord = isCurrentSentence && isWordToken && wordCount === currentWordIndex;

        if (isWordToken) {
          const colorMap: Record<string, string> = {
            red: '#f8717199', orange: '#fb923c99', amber: '#fbbf2499', emerald: '#34d39999',
            cyan: '#22d3ee99', blue: '#60a5fa99', purple: '#a78bfa99', pink: '#f472b699'
          };
          const borderStyle = isInUnderlineRange ? {
            borderBottom: `1px solid ${colorMap[underlineColor] || '#a78bfa99'}`
          } : {};
          
          // Add light purple background for annotated phrases
          const phraseBackgroundStyle = isInAnnotatedPhraseRange ? {
            backgroundColor: shouldHighlight ? 'rgba(167, 139, 250, 0.3)' : 'rgba(167, 139, 250, 0.1)'
          } : (shouldHighlight ? { backgroundColor: 'rgba(167, 139, 250, 0.3)' } : {});
          
          // Determine if should show phrase translation
          const shouldShowPhraseTranslation = isInAnnotatedPhraseRange && 
            annotatedRange && 
            showChinese && 
            phraseTranslationInserts.get(annotatedRange.phrase);
          
          // Check if this is the last token in the annotated phrase
          const isLastTokenInPhrase = isInAnnotatedPhraseRange && 
            annotatedRange && 
            tokenIndex === annotatedRange.endTokenIndex;
          
          const result = (
            <span 
              key={`${token.id}-${tokenIndex}`} 
              data-token-pos={tokenPos} 
              style={{...borderStyle, ...phraseBackgroundStyle}}
              className="cursor-pointer"
              onMouseEnter={() => {
                if (isInUnderlineRange) setHoveredUnderlineRange(underlineRangeIndex);
                if (isInAnnotatedPhraseRange) setHoveredAnnotatedPhraseIndex(annotatedRangeIndex);
                if (isInPhraseRange) setHoveredPhraseMarkedIndex(phraseMarkedRangeIndex);
              }}
              onMouseLeave={() => {
                setHoveredUnderlineRange(null);
                setHoveredAnnotatedPhraseIndex(null);
                setHoveredPhraseMarkedIndex(null);
              }}
              onDoubleClick={(e) => {
                // Priority: Word card > Phrase card
                // Check if this word itself has a card
                const wordAnnotation = findAnnotationEntry(annotations as Map<string, any>, token.text.toLowerCase())?.annotation;
                const hasWordCard = wordAnnotation && (wordAnnotation as any).definition;
                
                if (hasWordCard) {
                  // Word card takes priority - Word component will handle this
                  return;
                } else if (isInAnnotatedPhraseRange && annotatedRange) {
                  // Only expand phrase card if word doesn't have a card
                  e.stopPropagation();
                  onPhraseClick?.(annotatedRange.phrase);
                }
              }}
            >
              <Word
                token={token}
                isKnown={knownWords.has(token.text.toLowerCase())}
                isMarked={markedWords.has(token.text.toLowerCase())}
                isPhraseMarked={isInPhraseRange}
                isAnnotatedPhrase={isInAnnotatedPhraseRange}
                isHoveredPhrase={isInHoveredAnnotatedPhrase || isInHoveredPhraseMarked}
                isLearnt={learntWords.has(token.text.toLowerCase())}
                annotation={findAnnotationEntry(annotations as Map<string, any>, token.text.toLowerCase())?.annotation}
                showIPA={showIPA}
                showChinese={showChinese}
                autoMark={autoMark}
                autoPronounceSetting={autoPronounceSetting}
                onClick={() => onWordClick?.(token.text, paragraphIndex, sentenceIndex, tokenIndex)}
                onMarkKnown={onMarkKnown}
                isCurrentWord={isCurrentWord}
              />
              {/* Show phrase translation after the last token of annotated phrase */}
              {isLastTokenInPhrase && shouldShowPhraseTranslation && phraseAnnotations.get(annotatedRange.phrase) && (
                <span className="text-[10px] text-muted ml-1">
                  {phraseAnnotations.get(annotatedRange.phrase)!.chinese}
                </span>
              )}
            </span>
          );
          wordCount++;
          return result;
        } else {
          // For non-word tokens (space, punctuation), also check if in phrase range
          // Use purple 35% for annotated phrases, blue 35% for marked phrases (selection)
          // Hover entire phrase to 100% opacity
          let phraseUnderlineClass = '';
          if (isInAnnotatedPhraseRange) {
            // 已标注：紫色 35% 透明，悬停整个短语时 100%
            phraseUnderlineClass = isInHoveredAnnotatedPhrase 
              ? 'border-b-2 border-purple-500' 
              : 'border-b-2 border-purple-500/35';
          } else if (isInPhraseRange) {
            // 选择中：蓝色 35% 透明，悬停整个短语时 100%
            phraseUnderlineClass = isInHoveredPhraseMarked 
              ? 'border-b-2 border-blue-500' 
              : 'border-b-2 border-blue-500/35';
          }
          
          const colorMap: Record<string, string> = {
            red: '#f8717199', orange: '#fb923c99', amber: '#fbbf2499', emerald: '#34d39999',
            cyan: '#22d3ee99', blue: '#60a5fa99', purple: '#a78bfa99', pink: '#f472b699'
          };
          const borderStyle = isInUnderlineRange ? {
            borderBottom: `1px solid ${colorMap[underlineColor] || '#a78bfa99'}`
          } : {};
          const hoverStyle = shouldHighlight ? { backgroundColor: 'rgba(167, 139, 250, 0.3)' } : {};
          
          // Check if this is the last token in the annotated phrase (for non-word tokens)
          const isLastTokenInPhrase = isInAnnotatedPhraseRange && 
            annotatedRange && 
            tokenIndex === annotatedRange.endTokenIndex;
          
          const shouldShowPhraseTranslation = isInAnnotatedPhraseRange && 
            annotatedRange && 
            showChinese && 
            phraseTranslationInserts.get(annotatedRange.phrase);
          
          return (
            <Fragment key={`${token.id}-${tokenIndex}`}>
              <span 
                data-token-pos={tokenPos} 
                className={phraseUnderlineClass} 
                style={{...borderStyle, ...hoverStyle}}
                onMouseEnter={() => {
                  if (isInUnderlineRange) setHoveredUnderlineRange(underlineRangeIndex);
                  if (isInAnnotatedPhraseRange) setHoveredAnnotatedPhraseIndex(annotatedRangeIndex);
                  if (isInPhraseRange) setHoveredPhraseMarkedIndex(phraseMarkedRangeIndex);
                }}
                onMouseLeave={() => {
                  setHoveredUnderlineRange(null);
                  setHoveredAnnotatedPhraseIndex(null);
                  setHoveredPhraseMarkedIndex(null);
                }}
                onDoubleClick={() => {
                  if (isInAnnotatedPhraseRange && annotatedRange) {
                    onPhraseClick?.(annotatedRange.phrase);
                  }
                }}
              >
                {token.text}
              </span>
              {/* Show phrase translation after the last token of annotated phrase */}
              {isLastTokenInPhrase && shouldShowPhraseTranslation && phraseAnnotations.get(annotatedRange.phrase) && (
                <span className="text-[10px] text-muted ml-1">
                  {phraseAnnotations.get(annotatedRange.phrase)!.chinese}
                </span>
              )}
            </Fragment>
          );
        }
      })}
      {hasSentenceCard && (
        <button
          type="button"
          className="inline-flex h-5 w-2 ml-1 align-middle rounded-full bg-green-300/70 hover:bg-green-400/80 shadow-sm"
          title="Open sentence card"
          aria-label="Open sentence card"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSentenceCardClick?.(sentence.text);
          }}
        />
      )}
    </span>
  );
}
