import type { WordAnnotation } from '../api';
import { generateEmojiImage, generateMeaningField, searchImage, savePastedImage, resolveAssetUrl } from '../api';
import { useState, useEffect, useRef } from 'react';
import { updateEmoji, addEmojiImagePathToActiveMeaning, setActiveMeaning, addManualMeaning, updateActiveMeaningDetails } from '../db';
import { getWordEmoji, getAllEmojiKeywords, getDetailedPartOfSpeech } from '../utils/emojiHelper';
import { useAppStore } from '../store/appStore';
import { applyMeaningToAnnotation, ensureEncounteredMeanings, getActiveMeaning, getCanonicalWord, getEncounteredSurfaceForms } from '../utils/wordMeanings';
import { logWordDebug, shouldDebugWord } from '../utils/wordDebug';
import CardNotes from './CardNotes';

interface WordCardProps {
  annotation: WordAnnotation;
  displayWord?: string;
  isLearnt: boolean;
  onClose: () => void;
  onMarkKnown?: (word: string) => void;
  onDelete?: (word: string) => void;
  onRegenerateAI?: (word: string, sentence: string) => void;
}

// 获取所有 emoji 关键词（用于搜索）
const keywordToEmoji = getAllEmojiKeywords();

export default function WordCard({ annotation, displayWord, isLearnt, onClose, onMarkKnown, onDelete, onRegenerateAI }: WordCardProps) {
  const updateAnnotation = useAppStore((state: any) => state.updateAnnotation);
  const [displayedEmoji, setDisplayedEmoji] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [emojiError, setEmojiError] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiSearchQuery, setEmojiSearchQuery] = useState('');
  const [imageSource, setImageSource] = useState<string | null>(null); // 'unsplash', 'clipboard', 'ai', or null
  const [showWebImageHelper, setShowWebImageHelper] = useState(false);
  const [googleKeyword, setGoogleKeyword] = useState('');
  const [isClipboardSaving, setIsClipboardSaving] = useState(false);
  const [unsplashLocked, setUnsplashLocked] = useState(false);
  const [floatingPanelPos, setFloatingPanelPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const longPressTimer = useRef<number | undefined>(undefined);
  const isLongPress = useRef(false);
  const [showManualMeaningForm, setShowManualMeaningForm] = useState(false);
  const [manualMeaningMode, setManualMeaningMode] = useState<'new' | 'edit'>('new');
  const [manualMeaningChinese, setManualMeaningChinese] = useState('');
  const [manualMeaningDefinition, setManualMeaningDefinition] = useState('');
  const [manualMeaningExample, setManualMeaningExample] = useState('');
  const [manualMeaningSentence, setManualMeaningSentence] = useState('');
  const [manualMeaningDocumentTitle, setManualMeaningDocumentTitle] = useState('');
  const [manualMeaningPos, setManualMeaningPos] = useState('');
  const [manualMeaningBaseForm, setManualMeaningBaseForm] = useState('');
  const [manualMeaningWordForms, setManualMeaningWordForms] = useState('');
  const [manualFieldLoading, setManualFieldLoading] = useState<'definition' | 'example' | 'wordForms' | null>(null);
  const annotationWithMeanings = ensureEncounteredMeanings(annotation);
  const activeMeaning = getActiveMeaning(annotationWithMeanings);
  const fallbackLemmaWord = getCanonicalWord(annotation.word, annotation);
  const lemmaWord = annotation.baseForm?.trim().toLowerCase() || fallbackLemmaWord;
  const annotationStorageKey = (annotation.cardKey || annotation.word).toLowerCase();
  const preferredSurfaceForm = displayWord || annotation.word;
  const encounteredSurfaceForms = getEncounteredSurfaceForms(annotationWithMeanings, preferredSurfaceForm);
  const primarySurfaceForm = encounteredSurfaceForms[0] || '';
  const cardDisplayWord = preferredSurfaceForm || primarySurfaceForm || annotation.word;
  const normalizedIpa = annotation.ipa.replace(/^\/+|\/+$/g, '');
  const regenerateWord = primarySurfaceForm || cardDisplayWord;
  const frequencyLabel = annotation.bncRank && annotation.bncRank > 0
    ? `BNC #${annotation.bncRank}`
    : (annotation.level || '');

  useEffect(() => {
    if (!shouldDebugWord(displayWord, annotation.word, annotation.baseForm, lemmaWord, primarySurfaceForm)) {
      return;
    }

    logWordDebug('WordCard.render-state', {
      displayWord: displayWord || null,
      annotationWord: annotation.word,
      annotationBaseForm: annotation.baseForm || null,
      lemmaWord,
      primarySurfaceForm: primarySurfaceForm || null,
      encounteredSurfaceForms,
      partOfSpeech: annotation.partOfSpeech,
      activeMeaning,
    });
  }, [
    displayWord,
    annotation.word,
    annotation.baseForm,
    annotation.partOfSpeech,
    lemmaWord,
    primarySurfaceForm,
    encounteredSurfaceForms,
    activeMeaning,
  ]);

  // 组件加载时，确定显示哪个 emoji
  useEffect(() => {
    // 新优先级：图片数组 > emoji 字段 > 自动推荐
    if (annotation.emojiImagePath && annotation.emojiImagePath.length > 0) {
      // 显示最新的图片（数组第一个）
      setDisplayedEmoji(annotation.emojiImagePath[0]);
      if (annotation.emojiModel && annotation.emojiModel.startsWith('web-')) {
        setImageSource('clipboard');
      } else if (annotation.emojiModel) {
        setImageSource('ai');
      } else {
        setImageSource('unsplash');
      }
    } else if (annotation.emoji) {
      // 显示 unicode emoji
      setDisplayedEmoji(annotation.emoji);
      setImageSource(null);
    } else {
      // 兜底：自动推荐
      setDisplayedEmoji(getWordEmoji(annotation));
      setImageSource(null);
    }
  }, [annotation.word, annotation.emojiImagePath, annotation.emoji, annotation.emojiModel]);

  useEffect(() => {
    setGoogleKeyword(`${annotation.word} photo`);
  }, [annotation.word]);

  const calculateFloatingPanelPos = (panelWidth: number, panelHeight: number) => {
    const button = emojiButtonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const gap = 8;
    const padding = 12;

    let left = rect.right + gap;
    if (left + panelWidth > window.innerWidth - padding) {
      left = rect.left - panelWidth - gap;
    }
    left = Math.max(padding, Math.min(left, window.innerWidth - panelWidth - padding));

    let top = rect.top;
    top = Math.max(padding, Math.min(top, window.innerHeight - panelHeight - padding));

    setFloatingPanelPos({ top, left });
  };

  const handlePronounce = () => {
    const utterance = new SpeechSynthesisUtterance(cardDisplayWord);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  };

  const handleSwitchMeaning = async (meaningId: string) => {
    if (meaningId === annotationWithMeanings.activeMeaningId) return;
    const projected = applyMeaningToAnnotation(annotationWithMeanings, meaningId);
    updateAnnotation(annotationStorageKey, projected);
    await setActiveMeaning(annotationStorageKey, meaningId, (updates) => {
      updateAnnotation(annotationStorageKey, updates);
    });
  };

  const resetManualMeaningForm = () => {
    setManualMeaningMode('new');
    setManualMeaningChinese('');
    setManualMeaningDefinition('');
    setManualMeaningExample('');
    setManualMeaningSentence('');
    setManualMeaningDocumentTitle('');
    setManualMeaningPos('');
    setManualMeaningBaseForm('');
    setManualMeaningWordForms('');
    setShowManualMeaningForm(false);
  };

  const openNewMeaningForm = () => {
    setManualMeaningMode('new');
    setManualMeaningChinese('');
    setManualMeaningDefinition('');
    setManualMeaningExample('');
    setManualMeaningSentence(annotation.sentence || '');
    setManualMeaningDocumentTitle(annotation.documentTitle || '');
    setManualMeaningPos('');
    setManualMeaningBaseForm('');
    setManualMeaningWordForms('');
    setShowManualMeaningForm(true);
  };

  const openEditMeaningForm = () => {
    setManualMeaningMode('edit');
    setManualMeaningChinese(activeMeaning.chinese || '');
    setManualMeaningDefinition(activeMeaning.definition || '');
    setManualMeaningExample(activeMeaning.example || '');
    setManualMeaningSentence(activeMeaning.sentence || annotation.sentence || '');
    setManualMeaningDocumentTitle(activeMeaning.documentTitle || annotation.documentTitle || '');
    setManualMeaningPos(activeMeaning.partOfSpeech || '');
    setManualMeaningBaseForm(activeMeaning.baseForm || '');
    setManualMeaningWordForms((activeMeaning.wordForms || []).join(', '));
    setShowManualMeaningForm(true);
  };

  useEffect(() => {
    if (!showManualMeaningForm || manualMeaningMode !== 'edit') return;

    setManualMeaningChinese(activeMeaning.chinese || '');
    setManualMeaningDefinition(activeMeaning.definition || '');
    setManualMeaningExample(activeMeaning.example || '');
    setManualMeaningSentence(activeMeaning.sentence || annotation.sentence || '');
    setManualMeaningDocumentTitle(activeMeaning.documentTitle || annotation.documentTitle || '');
    setManualMeaningPos(activeMeaning.partOfSpeech || '');
    setManualMeaningBaseForm(activeMeaning.baseForm || '');
    setManualMeaningWordForms((activeMeaning.wordForms || []).join(', '));
  }, [
    showManualMeaningForm,
    manualMeaningMode,
    activeMeaning.id,
    activeMeaning.chinese,
    activeMeaning.definition,
    activeMeaning.example,
    activeMeaning.sentence,
    activeMeaning.documentTitle,
    activeMeaning.partOfSpeech,
    activeMeaning.baseForm,
    activeMeaning.wordForms,
    annotation.sentence,
    annotation.documentTitle,
  ]);

  const parseWordForms = (value: string): string[] | undefined => {
    const forms = value
      .split(/[,\n]/)
      .map(item => item.trim())
      .filter(Boolean);
    return forms.length > 0 ? forms : undefined;
  };

  const buildManualMeaningPayload = () => ({
    baseForm: manualMeaningBaseForm.trim() || undefined,
    ipa: annotation.ipa,
    chinese: manualMeaningChinese.trim(),
    definition: manualMeaningDefinition.trim(),
    example: manualMeaningExample.trim(),
    level: annotation.level,
    partOfSpeech: manualMeaningPos.trim(),
    sentence: manualMeaningSentence.trim() || undefined,
    documentTitle: manualMeaningDocumentTitle.trim() || undefined,
    wordForms: parseWordForms(manualMeaningWordForms),
    emoji: undefined,
    emojiImagePath: [],
    emojiModel: undefined,
  });

  const handleAddManualMeaning = async () => {
    if (!manualMeaningChinese.trim() || !manualMeaningDefinition.trim()) {
      alert('Chinese and definition are required.');
      return;
    }

    await addManualMeaning(
      annotationStorageKey,
      buildManualMeaningPayload(),
      (updates) => {
        updateAnnotation(annotationStorageKey, updates);
      },
    );

    resetManualMeaningForm();
  };

  const handleSaveCurrentMeaning = async () => {
    if (!manualMeaningChinese.trim() || !manualMeaningDefinition.trim()) {
      alert('Chinese and definition are required.');
      return;
    }

    await updateActiveMeaningDetails(annotationStorageKey, buildManualMeaningPayload(), (updates) => {
      updateAnnotation(annotationStorageKey, updates);
    });

    resetManualMeaningForm();
  };

  const handleGenerateManualField = async (field: 'definition' | 'example' | 'wordForms') => {
    if (!manualMeaningChinese.trim()) {
      alert('Fill in the Chinese meaning first.');
      return;
    }

    setManualFieldLoading(field);
    try {
      const result = await generateMeaningField(
        annotation.word,
        field,
        manualMeaningChinese.trim(),
        manualMeaningPos.trim() || undefined,
        manualMeaningSentence.trim() || undefined,
      );

      if (!result.success || !result.data?.text) {
        throw new Error(result.error || `Failed to generate ${field}`);
      }

      if (field === 'definition') {
        setManualMeaningDefinition(result.data.text);
      } else if (field === 'example') {
        setManualMeaningExample(result.data.text);
      } else {
        setManualMeaningWordForms(result.data.text);
      }
    } catch (error: any) {
      alert(error?.message || `Failed to generate ${field}`);
    } finally {
      setManualFieldLoading(null);
    }
  };

  // 搜索真实照片 (Unsplash)
  const handleSearchImage = async () => {
    if (isGenerating) return;
    
    setIsGenerating(true);
    setEmojiError(null);
    
    try {
      const result = await searchImage(
        annotation.word,
        annotation.definition
      );
      
      if (result.success && result.data) {
        const imagePath = result.data.imageUrl;
        const source = result.data.source || 'unknown';
        
        setDisplayedEmoji(imagePath);
        setImageSource(source);
        
        // 添加到图片数组（不存模型信息，因为是 Unsplash）
        await addEmojiImagePathToActiveMeaning(annotationStorageKey, imagePath, undefined, (updates) => {
          updateAnnotation(annotationStorageKey, updates);
        });
        setUnsplashLocked(true);
        console.log('[Image Search Debug] Image found and saved:', {
          word: annotation.word,
          imagePath,
          source,
        });
      } else {
        setEmojiError(result.error || 'No image found');
        console.error('[Unsplash] Error:', result.error);
      }
    } catch (error) {
      setEmojiError('Network error');
      console.error('[Unsplash] Exception:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;
        if (typeof result === 'string') resolve(result);
        else reject(new Error('Failed to convert blob to data URL'));
      };
      reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
      reader.readAsDataURL(blob);
    });

  const handleOpenGoogleImages = () => {
    const q = googleKeyword.trim() || `${annotation.word} photo`;
    const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handlePasteFromClipboard = async () => {
    if (isClipboardSaving) return;
    setIsClipboardSaving(true);
    setEmojiError(null);

    try {
      if (!navigator.clipboard || !navigator.clipboard.read) {
        throw new Error('Clipboard image read is not supported in this browser.');
      }

      const items = await navigator.clipboard.read();
      let imageBlob: Blob | null = null;
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith('image/'));
        if (imageType) {
          imageBlob = await item.getType(imageType);
          break;
        }
      }

      if (!imageBlob) {
        throw new Error('No image found in clipboard. Copy an image first.');
      }

      const dataUrl = await blobToDataUrl(imageBlob);
      const result = await savePastedImage(annotation.word, dataUrl);
      if (!result.success || !result.data?.imageUrl) {
        throw new Error(result.error || 'Failed to save pasted image');
      }

      const imagePath = result.data.imageUrl;
      setDisplayedEmoji(imagePath);
      setImageSource('clipboard');

      // Store with a model marker so reload can distinguish clipboard source
      await addEmojiImagePathToActiveMeaning(annotationStorageKey, imagePath, 'web-clipboard', (updates) => {
        updateAnnotation(annotationStorageKey, updates);
      });
      setUnsplashLocked(false);

      console.log('[Clipboard Image] Saved:', annotation.word, imagePath);
      setShowWebImageHelper(false);
      alert('Pasted image saved successfully.');
    } catch (error: any) {
      setEmojiError(error?.message || 'Failed to read image from clipboard');
      console.error('[Clipboard Image] Error:', error);
    } finally {
      setIsClipboardSaving(false);
    }
  };

  const handlePasteEvent = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items || items.length === 0 || isClipboardSaving) return;

    const imageItem = Array.from(items).find((item) => item.type.startsWith('image/'));
    if (!imageItem) return;

    e.preventDefault();
    e.stopPropagation();
    setIsClipboardSaving(true);
    setEmojiError(null);

    try {
      const blob = imageItem.getAsFile();
      if (!blob) {
        throw new Error('Failed to read pasted image data');
      }

      const dataUrl = await blobToDataUrl(blob);
      const result = await savePastedImage(annotation.word, dataUrl);
      if (!result.success || !result.data?.imageUrl) {
        throw new Error(result.error || 'Failed to save pasted image');
      }

      const imagePath = result.data.imageUrl;
      setDisplayedEmoji(imagePath);
      setImageSource('clipboard');

      await addEmojiImagePathToActiveMeaning(annotationStorageKey, imagePath, 'web-clipboard', (updates) => {
        updateAnnotation(annotationStorageKey, updates);
      });
      setUnsplashLocked(false);

      console.log('[Clipboard Image] Saved via paste event:', annotation.word, imagePath);
      setShowWebImageHelper(false);
      alert('Pasted image saved successfully.');
    } catch (error: any) {
      setEmojiError(error?.message || 'Failed to save pasted image');
      console.error('[Clipboard Image] Paste event error:', error);
    } finally {
      setIsClipboardSaving(false);
    }
  };

  // 长按：生成 AI 图片
  const handleGenerateAI = async () => {
    if (isGenerating) return;
    
    setIsGenerating(true);
    setEmojiError(null);
    
    try {
      const result = await generateEmojiImage(
        annotation.word,
        annotation.definition,
        annotation.sentence
      );
      
      if (result.success && result.data) {
        const imagePath = result.data.imageUrl;
        const model = result.data.model;
        
        setDisplayedEmoji(imagePath);
        setImageSource('ai');
        
        // 添加到图片数组（包含模型信息）
        await addEmojiImagePathToActiveMeaning(annotationStorageKey, imagePath, model, (updates) => {
          updateAnnotation(annotationStorageKey, updates);
        });
        console.log('[AI Generate] Image created:', annotation.word, imagePath, 'Model:', model);
      } else {
        setEmojiError(result.error || 'Failed to generate');
        console.error('[AI Generate] Error:', result.error);
      }
    } catch (error) {
      setEmojiError('Network error');
      console.error('[AI Generate] Exception:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  // 鼠标按下：开始长按计时（仅左键）
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isLongPress.current = false;
    longPressTimer.current = window.setTimeout(() => {
      isLongPress.current = true;
      handleGenerateAI();
    }, 800); // 800ms 长按触发
  };

  // 鼠标抬起：如果不是长按，执行短按操作（仅左键）
  const handleMouseUp = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = undefined;
    }
    
    if (!isLongPress.current) {
      // 短按：打开 Web Image Helper
      setShowEmojiPicker(false);
      calculateFloatingPanelPos(336, 280);
      setShowWebImageHelper(true);
    }
  };

  // 鼠标离开：取消长按
  const handleMouseLeave = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = undefined;
    }
    isLongPress.current = false;
  };

  // 右键点击：执行 Unsplash（防重复）
  const handleEmojiRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (unsplashLocked) {
      return;
    }
    void handleSearchImage();
  };

  // 选择 emoji
  const handleSelectEmoji = async (emoji: string) => {
    setDisplayedEmoji(emoji);
    setShowEmojiPicker(false);
    setEmojiSearchQuery('');
    setImageSource(null);
    
    // 保存到数据库
    await updateEmoji(annotationStorageKey, emoji, (updates) => {
      updateAnnotation(annotationStorageKey, updates);
    });
    setUnsplashLocked(false);
    console.log('[Emoji Manual] Selected:', annotation.word, emoji);
  };

  // 获取所有匹配搜索的 emoji
  const getFilteredEmojis = () => {
    if (!emojiSearchQuery.trim()) {
      // 无搜索，显示常用 emoji
      return Array.from(commonEmojis);
    }
    
    const query = emojiSearchQuery.toLowerCase().trim();
    const results: string[] = [];
    
    // 搜索 keywordToEmoji（emojilib 的数据）
    for (const [keyword, emoji] of keywordToEmoji.entries()) {
      if (keyword.includes(query) && !results.includes(emoji)) {
        results.push(emoji);
      }
    }
    
    return results.slice(0, 100); // 限制最多 100 个结果
  };

  // 常用 emoji 列表
  const commonEmojis = [
    '😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂',
    '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋',
    '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥸', '🤩',
    '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣',
    '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬',
    '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗',
    '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯',
    '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐',
    '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈',
    '👿', '👹', '👺', '🤡', '💩', '👻', '💀', '☠️', '👽', '👾',
    '🤖', '🎃', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿',
    '😾', '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨',
    '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤',
    '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
    '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️',
    '✨', '💫', '⭐', '🌟', '✴️', '🌠', '🔥', '💥', '💢', '💦',
    '💨', '🌈', '☀️', '🌤️', '⛅', '🌥️', '☁️', '🌦️', '🌧️', '⛈️',
    '🌩️', '🌨️', '❄️', '☃️', '⛄', '🌬️', '💨', '💧', '💦', '☔',
    '📚', '📖', '📝', '✏️', '✒️', '🖊️', '🖋️', '📁', '📂', '🗂️',
    '🎯', '🎪', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷',
    '🎺', '🎸', '🪕', '🎻', '🎲', '♟️', '🎮', '🕹️', '🎰', '🧩',
    '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️', '🏵️', '🎗️', '🎫', '🎟️',
    '💰', '💴', '💵', '💶', '💷', '💸', '💳', '🧾', '💹', '✅',
    '❌', '❎', '✔️', '☑️', '⭕', '🚫', '⛔', '📛', '🔞', '💯',
    '🔔', '🔕', '📢', '📣', '📯', '🔊', '🔇', '🔈', '🔉', '🔔',
  ];

  const isImageEmoji =
    displayedEmoji?.startsWith('/learning-images/') ||
    displayedEmoji?.startsWith('http');

  return (
    <div
      className="bg-white border border-border rounded-2xl p-4 mb-3 shadow-sm"
      onContextMenu={(e) => {
        e.preventDefault();
        openEditMeaningForm();
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 text-center">
          <h3 className="text-2xl font-bold text-gray-900 flex items-center justify-center gap-2">
            {/* Emoji - 左键搜图/右键选emoji/长按AI生成 */}
            <div className="relative" onContextMenu={handleEmojiRightClick}>
              <button
                ref={emojiButtonRef}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
                onContextMenu={handleEmojiRightClick}
                disabled={isGenerating}
                className={`relative transition-all ${
                  isGenerating 
                    ? 'opacity-50 cursor-wait' 
                    : 'hover:scale-110 cursor-pointer hover:shadow-lg'
                }`}
                title="Left click: Web Image Helper | Right click: Unsplash | Long press: AI generate"
              >
                {isImageEmoji ? (
                  <img 
                    src={resolveAssetUrl(displayedEmoji)} 
                    alt={annotation.word}
                    className="w-12 h-12 rounded-lg object-cover"
                  />
                ) : (
                  <span className="text-3xl">{displayedEmoji}</span>
                )}
                {isGenerating && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-80 rounded-lg">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
                  </div>
                )}
              </button>
              
              {/* Emoji Picker 弹窗 */}
              {showEmojiPicker && (
                <div
                  className="fixed z-[9999] bg-white border-2 border-gray-300 rounded-lg shadow-2xl p-3 w-[21rem] max-h-96 overflow-hidden flex flex-col"
                  style={{ top: floatingPanelPos.top, left: floatingPanelPos.left }}
                >
                  <div className="text-xs text-gray-600 mb-2 font-semibold">Select an emoji:</div>
                  
                  {/* 搜索框 */}
                  <input
                    type="text"
                    value={emojiSearchQuery}
                    onChange={(e) => setEmojiSearchQuery(e.target.value)}
                    placeholder="Search emoji (e.g., hand, smile)..."
                    className="w-full px-3 py-2 mb-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                  
                  {/* Emoji 网格 */}
                  <div className="overflow-y-auto max-h-56 mb-2">
                    <div className="grid grid-cols-10 gap-1">
                      {getFilteredEmojis().map((emoji, index) => (
                        <button
                          key={index}
                          onClick={() => handleSelectEmoji(emoji)}
                          className="text-2xl hover:bg-gray-100 rounded p-1 transition-colors"
                          title={emoji}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  <button
                    onClick={() => {
                      setShowEmojiPicker(false);
                      calculateFloatingPanelPos(336, 280);
                      setShowWebImageHelper(true);
                    }}
                    className="w-full py-1 mb-2 text-sm bg-blue-100 text-blue-700 hover:bg-blue-200 rounded"
                  >
                    🌐 Web Image Helper
                  </button>
                  <button
                    onClick={() => {
                      setShowEmojiPicker(false);
                      setEmojiSearchQuery('');
                    }}
                    className="w-full py-1 text-sm bg-gray-200 hover:bg-gray-300 rounded"
                  >
                    Close
                  </button>
                </div>
              )}

              {/* Web image helper: Google search + clipboard paste */}
              {showWebImageHelper && (
                <div
                  className="fixed z-[9999] bg-white border-2 border-blue-300 rounded-lg shadow-2xl p-3 w-[21rem]"
                  style={{ top: floatingPanelPos.top, left: floatingPanelPos.left }}
                  onPaste={handlePasteEvent}
                >
                  <div className="text-xs text-gray-700 mb-2 font-semibold">
                    Web Image Helper
                  </div>
                  <div className="text-xs text-gray-500 mb-2 leading-relaxed">
                    1) Open Google Images with keyword
                    <br />
                    2) Copy an image
                    <br />
                    3) Click "Paste from Clipboard" or press Ctrl/Cmd+V directly
                  </div>
                  <input
                    type="text"
                    value={googleKeyword}
                    onChange={(e) => setGoogleKeyword(e.target.value)}
                    onPaste={handlePasteEvent}
                    className="w-full px-3 py-2 mb-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Search keyword"
                  />
                  <button
                    onClick={handleOpenGoogleImages}
                    className="w-full py-1 mb-2 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded"
                  >
                    🔎 Open Google Images
                  </button>
                  <button
                    onClick={handlePasteFromClipboard}
                    disabled={isClipboardSaving}
                    className={`w-full py-1 mb-2 text-sm rounded ${
                      isClipboardSaving
                        ? 'bg-gray-200 text-gray-500 cursor-wait'
                        : 'bg-green-600 text-white hover:bg-green-700'
                    }`}
                  >
                    {isClipboardSaving ? 'Saving...' : '📋 Paste from Clipboard'}
                  </button>
                  <button
                    onClick={() => {
                      setShowWebImageHelper(false);
                      calculateFloatingPanelPos(336, 420);
                      setShowEmojiPicker(true);
                    }}
                    className="w-full py-1 mb-2 text-sm bg-purple-100 text-purple-700 hover:bg-purple-200 rounded"
                  >
                    😀 Emoji Picker
                  </button>
                  <button
                    onClick={() => setShowWebImageHelper(false)}
                    className="w-full py-1 text-sm bg-gray-200 hover:bg-gray-300 rounded"
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
            <span className="flex flex-wrap items-baseline justify-center gap-x-2 gap-y-1">
              <span>{cardDisplayWord}</span>
            </span>
          </h3>
          {emojiError && (
            <div className="text-xs text-red-500 mt-1">
              ⚠️ {emojiError}
            </div>
          )}
          {/* 显示图片来源信息 */}
          {isImageEmoji && imageSource && (
            <div className="text-xs text-gray-500 mt-1">
              {imageSource === 'unsplash' && '📷 Photo from Unsplash'}
              {imageSource === 'clipboard' && '📋 Image from Clipboard'}
              {imageSource === 'ai' && `🎨 AI Generated ${annotation.emojiModel ? `(${annotation.emojiModel})` : ''}`}
            </div>
          )}
          {annotation.emoji && !isImageEmoji && (
            <div className="text-xs text-blue-500 mt-1">
              ✓ Emoji
            </div>
          )}
          <div className="flex items-center justify-center gap-3 mt-1">
            {/* Clickable IPA for pronunciation */}
            {normalizedIpa && (
              <button
                onClick={handlePronounce}
                className="text-sm text-blue-600 hover:text-blue-800 hover:underline cursor-pointer transition-colors"
                title="Click to pronounce"
              >
                /{normalizedIpa}/
              </button>
            )}
            {frequencyLabel && (
              <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-semibold">
                {frequencyLabel}
              </span>
            )}
            <span className="text-xs text-gray-600 font-medium">{getDetailedPartOfSpeech(annotation)}</span>
          </div>
          {encounteredSurfaceForms.length > 0 && (
            <div className="mt-2 text-xs text-gray-500">
              Seen as: {encounteredSurfaceForms.join(', ')}
            </div>
          )}
          <div className="mt-2 flex items-center justify-center gap-2">
            <button
              onClick={() => {
                setShowEmojiPicker(false);
                calculateFloatingPanelPos(336, 280);
                setShowWebImageHelper((prev) => !prev);
              }}
              className="text-xs px-2 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded border border-blue-200"
              title="Open Web Image Helper"
            >
              🌐 Web Image
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Delete button */}
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete "${cardDisplayWord}" from cards and add to known words?`)) {
                  onDelete(annotationStorageKey);
                }
              }}
              className="text-gray-400 hover:text-red-600 text-lg leading-none px-2"
              aria-label="Delete"
              title="Delete and mark as known"
            >
              ×
            </button>
          )}
          {/* Collapse button */}
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none px-2"
            aria-label="Collapse"
            title="Collapse card"
          >
            ◀
          </button>
        </div>
      </div>

      {annotationWithMeanings.encounteredMeanings && annotationWithMeanings.encounteredMeanings.length > 1 && (
        <div className="mb-3">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="text-xs font-semibold text-muted">Encountered Meanings</div>
            <button
              onClick={() => {
                if (showManualMeaningForm && manualMeaningMode === 'new') {
                  resetManualMeaningForm();
                } else {
                  openNewMeaningForm();
                }
              }}
              className="text-xs px-2 py-1 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded border border-amber-200"
            >
              + New Meaning
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {annotationWithMeanings.encounteredMeanings.map((meaning, index) => (
              <button
                key={meaning.id}
                onClick={() => void handleSwitchMeaning(meaning.id)}
                className={`text-xs px-2 py-1 rounded border transition-colors ${
                  meaning.id === activeMeaning.id
                    ? 'bg-blue-100 text-blue-700 border-blue-300'
                    : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                }`}
                title={meaning.definition}
              >
                {index + 1}. {meaning.shortLabel}
              </button>
            ))}
          </div>
        </div>
      )}

      {annotationWithMeanings.encounteredMeanings && annotationWithMeanings.encounteredMeanings.length <= 1 && (
        <div className="mb-3 flex justify-end">
          <button
            onClick={() => {
              if (showManualMeaningForm && manualMeaningMode === 'new') {
                resetManualMeaningForm();
              } else {
                openNewMeaningForm();
              }
            }}
            className="text-xs px-2 py-1 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded border border-amber-200"
          >
            + New Meaning
          </button>
        </div>
      )}

      {showManualMeaningForm && (
        <div className="mb-3 border border-amber-200 bg-amber-50 rounded-lg p-3">
          <div className="text-xs font-semibold text-amber-800 mb-2">
            {manualMeaningMode === 'edit' ? 'Edit Current Meaning' : 'Add Manual Meaning'}
          </div>
          <input
            type="text"
            value={manualMeaningChinese}
            onChange={(e) => setManualMeaningChinese(e.target.value)}
            placeholder="Chinese meaning"
            className="w-full px-3 py-2 mb-2 text-sm border border-amber-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
            <select
              value={manualMeaningPos}
              onChange={(e) => setManualMeaningPos(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-amber-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
            >
              <option value="">Part of speech</option>
              <option value="noun">noun</option>
              <option value="verb">verb</option>
              <option value="adjective">adjective</option>
              <option value="adverb">adverb</option>
              <option value="pronoun">pronoun</option>
              <option value="preposition">preposition</option>
              <option value="conjunction">conjunction</option>
              <option value="interjection">interjection</option>
              <option value="determiner">determiner</option>
              <option value="phrase">phrase</option>
              <option value="other">other</option>
            </select>
            <input
              type="text"
              value={manualMeaningBaseForm}
              onChange={(e) => setManualMeaningBaseForm(e.target.value)}
              placeholder="Base form / lemma (optional)"
              className="w-full px-3 py-2 text-sm border border-amber-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
          <div className="mb-2">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="text-xs text-amber-800">Definition</div>
              <button
                onClick={() => void handleGenerateManualField('definition')}
                disabled={manualFieldLoading !== null}
                className={`text-xs px-2 py-1 rounded border ${
                  manualFieldLoading === 'definition'
                    ? 'bg-gray-200 text-gray-500 border-gray-200 cursor-wait'
                    : 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100'
                }`}
              >
                {manualFieldLoading === 'definition' ? 'Generating...' : 'AI'}
              </button>
            </div>
            <textarea
              value={manualMeaningDefinition}
              onChange={(e) => setManualMeaningDefinition(e.target.value)}
              placeholder="English definition"
              className="w-full px-3 py-2 text-sm border border-amber-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 min-h-[72px]"
            />
          </div>
          <div className="mb-2">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="text-xs text-amber-800">Example</div>
              <button
                onClick={() => void handleGenerateManualField('example')}
                disabled={manualFieldLoading !== null}
                className={`text-xs px-2 py-1 rounded border ${
                  manualFieldLoading === 'example'
                    ? 'bg-gray-200 text-gray-500 border-gray-200 cursor-wait'
                    : 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100'
                }`}
              >
                {manualFieldLoading === 'example' ? 'Generating...' : 'AI'}
              </button>
            </div>
            <textarea
              value={manualMeaningExample}
              onChange={(e) => setManualMeaningExample(e.target.value)}
              placeholder="Example"
              className="w-full px-3 py-2 text-sm border border-amber-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 min-h-[72px]"
            />
          </div>
          <div className="mb-2">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="text-xs text-amber-800">Word Forms</div>
              <button
                onClick={() => void handleGenerateManualField('wordForms')}
                disabled={manualFieldLoading !== null}
                className={`text-xs px-2 py-1 rounded border ${
                  manualFieldLoading === 'wordForms'
                    ? 'bg-gray-200 text-gray-500 border-gray-200 cursor-wait'
                    : 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100'
                }`}
              >
                {manualFieldLoading === 'wordForms' ? 'Generating...' : 'AI'}
              </button>
            </div>
            <input
              type="text"
              value={manualMeaningWordForms}
              onChange={(e) => setManualMeaningWordForms(e.target.value)}
              placeholder="Comma-separated word forms"
              className="w-full px-3 py-2 text-sm border border-amber-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
          <textarea
            value={manualMeaningSentence}
            onChange={(e) => setManualMeaningSentence(e.target.value)}
            placeholder="Original sentence"
            className="w-full px-3 py-2 mb-2 text-sm border border-amber-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 min-h-[72px]"
          />
          <input
            type="text"
            value={manualMeaningDocumentTitle}
            onChange={(e) => setManualMeaningDocumentTitle(e.target.value)}
            placeholder="Document title"
            className="w-full px-3 py-2 mb-3 text-sm border border-amber-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <div className="flex gap-2">
            <button
              onClick={() => void (manualMeaningMode === 'edit' ? handleSaveCurrentMeaning() : handleAddManualMeaning())}
              className="text-xs px-3 py-2 bg-amber-600 text-white hover:bg-amber-700 rounded"
            >
              {manualMeaningMode === 'edit' ? 'Save Changes' : 'Save Meaning'}
            </button>
            {manualMeaningMode === 'edit' && (
              <button
                onClick={() => void handleAddManualMeaning()}
                className="text-xs px-3 py-2 bg-purple-600 text-white hover:bg-purple-700 rounded"
              >
                Save as New Meaning
              </button>
            )}
            <button
              onClick={resetManualMeaningForm}
              className="text-xs px-3 py-2 bg-white text-gray-700 hover:bg-gray-50 rounded border border-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Chinese Translation with AI button */}
      <div className="mb-3 flex items-center gap-2">
        <div className="text-lg text-gray-900 flex-1">{annotation.chinese}</div>
        {onRegenerateAI && (
          <button
            onClick={() => onRegenerateAI(regenerateWord, annotation.sentence || '')}
            className="text-xs px-2 py-1 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded border border-purple-200 flex-shrink-0"
            title="Re-generate with AI"
          >
            🤖 AI
          </button>
        )}
      </div>

      {/* Word Forms (if available) */}
      {annotation.wordForms && annotation.wordForms.length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-semibold text-muted mb-1">词形变化</div>
          <div className="text-sm text-gray-700 flex flex-wrap gap-2">
            {annotation.wordForms.map((form, idx) => (
              <span key={idx} className="px-2 py-1 bg-gray-100 rounded text-xs">
                {form}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Definition */}
      <div className="mb-3">
        <div className="text-xs font-semibold text-muted mb-1">Definition</div>
        <div className="text-sm text-gray-700 leading-relaxed">{annotation.definition}</div>
      </div>

      {/* Example */}
      <div className="mb-3">
        <div className="text-xs font-semibold text-muted mb-1">Example</div>
        <div className="text-sm text-gray-700 italic leading-relaxed bg-gray-50 p-2 rounded-lg">
          "{annotation.example}"
        </div>
      </div>

      {/* Original Sentence (if available) */}
      {annotation.sentence && (
        <div className="mb-3">
          <div className="text-xs font-semibold text-muted mb-1">原文句子</div>
          <div className="text-sm text-gray-700 leading-relaxed bg-blue-50 p-2 rounded-lg">
            "{annotation.sentence}"
          </div>
        </div>
      )}

      {/* Document Title (if available) */}
      {annotation.documentTitle && (
        <div className="mb-3">
          <div className="text-xs font-semibold text-muted mb-1">文章标题</div>
          <div className="text-sm text-gray-600">
            📖 {annotation.documentTitle}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-2 border-t border-border">
        {onMarkKnown && (
          <button 
            onClick={() => onMarkKnown(annotation.word)}
            className={`flex-1 px-3 py-2 text-sm rounded-lg font-semibold transition-colors ${
              isLearnt
                ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                : 'bg-green-50 text-green-700 hover:bg-green-100'
            }`}
          >
            {isLearnt ? '✓ Known' : '✓ Mark as Known'}
          </button>
        )}
      </div>

      <CardNotes
        cardType="word"
        cardKey={annotationStorageKey}
        cardText={cardDisplayWord}
        context={annotation.sentence}
      />
    </div>
  );
}
