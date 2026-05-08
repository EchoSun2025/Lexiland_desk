/**
 * Tokenize text into paragraphs, sentences, and words
 */

export interface Token {
  id: string;
  type: 'word' | 'punctuation' | 'whitespace';
  text: string;
  startIndex: number;
  endIndex: number;
}

export interface Sentence {
  id: string;
  text: string;
  tokens: Token[];
  startIndex: number;
  endIndex: number;
}

export interface Paragraph {
  id: string;
  text: string;
  sentences: Sentence[];
  startIndex: number;
  endIndex: number;
  blockType?: 'paragraph' | 'heading' | 'blockquote' | 'unordered-list-item' | 'ordered-list-item' | 'code';
  blockLevel?: number;
  blockMarker?: string;
}

/**
 * Generate a simple unique ID
 */
function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Split text into paragraphs
 */
export function tokenizeParagraphs(text: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  
  // First try splitting by double newlines (standard paragraph breaks)
  let rawParagraphs = text.split(/\n\n+/);
  
  // If only one paragraph found, try splitting by single newlines followed by uppercase
  // This handles files where paragraphs are separated by single newlines
  if (rawParagraphs.length === 1) {
    rawParagraphs = text.split(/\n(?=[A-Z])/);
  }

  let currentIndex = 0;

  for (const line of rawParagraphs) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      currentIndex += line.length;
      continue;
    }
    
    const startIndex = text.indexOf(trimmed, currentIndex);
    const endIndex = startIndex + trimmed.length;
    
    const sentences = tokenizeSentences(trimmed, startIndex);
    
    paragraphs.push({
      id: generateId('para'),
      text: trimmed,
      sentences,
      startIndex,
      endIndex,
    });
    
    currentIndex = endIndex;
  }
  
  return paragraphs;
}

function createParagraph(
  text: string,
  startIndex: number,
  blockType: Paragraph['blockType'] = 'paragraph',
  blockLevel?: number,
  blockMarker?: string,
): Paragraph {
  return {
    id: generateId('para'),
    text,
    sentences: tokenizeSentences(text, startIndex),
    startIndex,
    endIndex: startIndex + text.length,
    blockType,
    blockLevel,
    blockMarker,
  };
}

export function tokenizeMarkdownParagraphs(markdown: string): Paragraph[] {
  const text = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const paragraphs: Paragraph[] = [];
  const lines = text.split('\n');
  let currentIndex = 0;
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeStartIndex = 0;
  let bufferedParagraphLines: string[] = [];
  let bufferedParagraphStartIndex = 0;

  const flushBufferedParagraph = () => {
    const content = bufferedParagraphLines.join('\n').trim();
    if (content) {
      paragraphs.push(createParagraph(content, bufferedParagraphStartIndex, 'paragraph'));
    }
    bufferedParagraphLines = [];
  };

  const flushCodeBlock = () => {
    const content = codeLines.join('\n').trim();
    if (content) {
      paragraphs.push(createParagraph(content, codeStartIndex, 'code'));
    }
    codeLines = [];
  };

  for (const line of lines) {
    const lineWithBreak = `${line}\n`;
    const trimmed = line.trim();

    if (/^```/.test(trimmed)) {
      flushBufferedParagraph();
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeStartIndex = currentIndex;
      } else {
        inCodeBlock = false;
        flushCodeBlock();
      }
      currentIndex += lineWithBreak.length;
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      currentIndex += lineWithBreak.length;
      continue;
    }

    if (!trimmed) {
      flushBufferedParagraph();
      currentIndex += lineWithBreak.length;
      continue;
    }

    const singleLineCodeFenceMatch = trimmed.match(/^```([^`]*)```$/);
    if (singleLineCodeFenceMatch) {
      flushBufferedParagraph();
      const codeText = singleLineCodeFenceMatch[1].trim();
      if (codeText) {
        paragraphs.push(createParagraph(codeText, currentIndex, 'code'));
      }
      currentIndex += lineWithBreak.length;
      continue;
    }

    const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushBufferedParagraph();
      const headingText = headingMatch[2].trim();
      if (headingText) {
        paragraphs.push(createParagraph(headingText, currentIndex, 'heading', headingMatch[1].length));
      }
      currentIndex += lineWithBreak.length;
      continue;
    }

    const blockquoteMatch = line.match(/^\s{0,3}>\s?(.*)$/);
    if (blockquoteMatch) {
      flushBufferedParagraph();
      const quoteText = blockquoteMatch[1].trim();
      if (quoteText) {
        paragraphs.push(createParagraph(quoteText, currentIndex, 'blockquote'));
      }
      currentIndex += lineWithBreak.length;
      continue;
    }

    const unorderedMatch = line.match(/^\s*([-*+])\s+(.*)$/);
    if (unorderedMatch) {
      flushBufferedParagraph();
      const itemText = unorderedMatch[2].trim();
      if (itemText) {
        paragraphs.push(createParagraph(itemText, currentIndex, 'unordered-list-item', undefined, unorderedMatch[1]));
      }
      currentIndex += lineWithBreak.length;
      continue;
    }

    const orderedMatch = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (orderedMatch) {
      flushBufferedParagraph();
      const itemText = orderedMatch[2].trim();
      if (itemText) {
        paragraphs.push(createParagraph(itemText, currentIndex, 'ordered-list-item', undefined, `${orderedMatch[1]}.`));
      }
      currentIndex += lineWithBreak.length;
      continue;
    }

    if (bufferedParagraphLines.length === 0) {
      bufferedParagraphStartIndex = currentIndex;
    }
    bufferedParagraphLines.push(line);
    currentIndex += lineWithBreak.length;
  }

  flushBufferedParagraph();
  if (inCodeBlock) {
    flushCodeBlock();
  }

  return paragraphs;
}

/**
 * Split paragraph into sentences
 * Simple implementation: split by . ! ?
 */
export function tokenizeSentences(text: string, baseIndex: number = 0): Sentence[] {
  const sentences: Sentence[] = [];
  
  // Match sentences ending with . ! ? followed by space or end of string
  const sentenceRegex = /[^.!?]+[.!?]+/g;
  let match;
  
  while ((match = sentenceRegex.exec(text)) !== null) {
    const sentenceText = match[0].trim();
    const startIndex = baseIndex + match.index;
    const endIndex = startIndex + match[0].length;
    
    const tokens = tokenizeWords(sentenceText, startIndex);
    
    sentences.push({
      id: generateId('sent'),
      text: sentenceText,
      tokens,
      startIndex,
      endIndex,
    });
  }
  
  // Handle remaining text without sentence ending
  const lastIndex = sentences.length > 0 ? sentences[sentences.length - 1].endIndex - baseIndex : 0;
  const remaining = text.slice(lastIndex).trim();
  
  if (remaining.length > 0) {
    const startIndex = baseIndex + lastIndex;
    const tokens = tokenizeWords(remaining, startIndex);
    
    sentences.push({
      id: generateId('sent'),
      text: remaining,
      tokens,
      startIndex,
      endIndex: startIndex + remaining.length,
    });
  }
  
  return sentences;
}

/**
 * Split sentence into word tokens
 */
export function tokenizeWords(text: string, baseIndex: number = 0): Token[] {
  const tokens: Token[] = [];
  
  // Match words, punctuation, and whitespace
  const tokenRegex = /(\w+(?:'\w+)?)|([^\w\s])|(\s+)/g;
  let match;
  
  while ((match = tokenRegex.exec(text)) !== null) {
    const [fullMatch, word, punct, space] = match;
    const startIndex = baseIndex + match.index;
    const endIndex = startIndex + fullMatch.length;
    
    let type: Token['type'];
    let tokenText: string;
    
    if (word) {
      type = 'word';
      tokenText = word;
    } else if (punct) {
      type = 'punctuation';
      tokenText = punct;
    } else {
      type = 'whitespace';
      tokenText = space;
    }
    
    tokens.push({
      id: generateId('tok'),
      type,
      text: tokenText,
      startIndex,
      endIndex,
    });
  }
  
  return tokens;
}

/**
 * Check if a word is in the known words list
 */
export function isKnownWord(word: string, knownWords: Set<string>): boolean {
  return knownWords.has(word.toLowerCase());
}
