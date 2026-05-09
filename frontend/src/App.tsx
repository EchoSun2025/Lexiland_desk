import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { useAppStore, type Document, type Chapter, type LearningCardType, type AppDefaultSettings, APP_DEFAULT_SETTINGS_KEY, getLatestBookmark, readAppDefaultSettings } from './store/appStore'
import { tokenizeParagraphs, tokenizeMarkdownParagraphs, type Paragraph as ParagraphType, type Sentence, type Token } from './utils'
import Paragraph from './components/Paragraph'
import WordCard from './components/WordCard'
import { loadKnownWordsFromFile, getAllKnownWords, addKnownWord as addKnownWordToDB, batchAddKnownWords, cacheAnnotation, getAllCachedAnnotations, addLearntWordToDB, removeLearntWordFromDB, getAllLearntWords, deleteAnnotation, cachePhraseAnnotation, getAllCachedPhraseAnnotations, deletePhraseAnnotation, exportUserData, importUserData, updateEmoji, addEmojiImagePathToActiveMeaning, setActiveMeaning, saveDocument, getAllSavedDocuments, touchDocument, deleteSavedDocument } from './db'
import { annotateWord, annotatePhrase, searchImage, generateEmojiImage, savePastedImage, resolveAssetUrl, saveUserBackup, loadUserBackup, getUserBackupStatus, getServerLibraryBooks, type WordAnnotation, type PhraseAnnotation, type ServerLibraryBook } from './api'
import PhraseCard from './components/PhraseCard'
import { localDictionary } from './services/localDictionary'
import { exportAnnotatedBook } from './services/bookExport'
import { exportLLIFString } from './services/llifConverter'
import { getWordEmoji, getAllEmojiKeywords } from './utils/emojiHelper'
import { applyMeaningToAnnotation, findAnnotationEntry, findBestMeaningIdForSentence, getEncounteredSurfaceForms, mergeAnnotationMeanings } from './utils/wordMeanings'
import { logWordDebug, shouldDebugWord } from './utils/wordDebug'

const keywordToEmoji = getAllEmojiKeywords();
const collapsedCommonEmojis = Array.from(new Set(Array.from(keywordToEmoji.values()))).slice(0, 120);
const SAMPLE_LEMMA_TEST_TITLE = 'sample lemma test';

type ViewMode = 'read' | 'review';
type ReviewSortMode = 'stats' | 'date' | 'alphabet';
type ReviewStatsRange = 'week' | 'month';

type ReviewCardItem =
  | {
      type: 'word';
      word: string;
      normalizedWord: string;
      cardKey: string;
      lookupKey: string;
      displayLabel: string;
      annotation: WordAnnotation;
      cachedAt: number;
    }
  | {
      type: Exclude<LearningCardType, 'word'>;
      word: string;
      normalizedWord: string;
      cardKey: string;
      lookupKey: string;
      annotation: PhraseAnnotation;
      cachedAt: number;
    };

type StatsBucket = {
  key: string;
  label: string;
  sublabel: string;
  count: number;
  cardKeys: string[];
};

type ReviewDisplayRow =
  | {
      type: 'divider';
      key: string;
      label: string;
    }
  | {
      type: 'card';
      key: string;
      item: ReviewCardItem;
    };

function getStoredBoolean(key: string, fallback: boolean): boolean {
  const stored = localStorage.getItem(key);
  return stored === null ? fallback : stored === 'true';
}

function getStoredString(key: string, fallback: string): string {
  return localStorage.getItem(key) ?? fallback;
}

function getStoredNumber(key: string, fallback: number): number {
  const stored = localStorage.getItem(key);
  if (stored === null) return fallback;

  const parsed = Number(stored);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeDocumentTitle(value?: string): string {
  return (value || '').trim().toLowerCase();
}

function normalizeWordFormValue(value?: string): string {
  return (value || '').trim().toLowerCase();
}

function getWordCardIdentity(
  annotation: Pick<WordAnnotation, 'word' | 'baseForm' | 'partOfSpeech' | 'definition' | 'cardKey' | 'wordForms' | 'encounteredForms'>,
  surfaceWord?: string,
): string {
  if (annotation.cardKey && !annotation.cardKey.includes('__')) {
    return annotation.cardKey.toLowerCase();
  }

  return normalizeWordFormValue(surfaceWord) || normalizeWordFormValue(annotation.word);
}

function getWordCardDisplayLabel(
  annotation: Pick<WordAnnotation, 'word' | 'baseForm' | 'partOfSpeech' | 'definition' | 'wordForms' | 'encounteredForms'>,
): string {
  return annotation.word;
}

function buildEncounteredForms(
  surfaceWord: string,
  annotation: Pick<WordAnnotation, 'word' | 'baseForm' | 'wordForms' | 'encounteredForms'>,
  existingForms: string[] = [],
): string[] {
  const normalizedSurface = normalizeWordFormValue(surfaceWord);
  const normalizedWord = normalizeWordFormValue(annotation.word);

  return Array.from(
    new Set(
      [normalizedSurface, normalizedWord, ...existingForms]
        .map(normalizeWordFormValue)
        .filter(form => Boolean(form) && (form === normalizedSurface || form === normalizedWord)),
    ),
  );
}

function getKnownFormsForAnnotation(annotation?: Pick<WordAnnotation, 'word' | 'baseForm' | 'encounteredForms'>): string[] {
  if (!annotation) {
    return [];
  }

  return Array.from(
    new Set(
      [annotation.word, annotation.baseForm, ...(annotation.encounteredForms || [])]
        .map(normalizeWordFormValue)
        .filter(Boolean),
    ),
  );
}

function App() {
  const appDefaults = readAppDefaultSettings();
  const {
    documents,
    currentDocumentId,
    knownWords,
    learntWords,
    annotations,
    selectedWord,
    cardHistory,
    showIPA,
    showChinese,
    exportFormat,
    exportIncludeIPA,
    exportIncludeChinese,
    exportIncludePhraseList,
    exportIncludePhraseTranslations,
    level,
    autoMark,
    annotationMode,
    phraseCardProvider,
    sentenceCardProvider,
    autoPronounceSetting,
    addDocument,
    removeDocument,
    loadDocuments,
    setCurrentDocument,
    setCurrentChapter,
    setSelectedWord,
    addAnnotation,
    updateAnnotation,
    addKnownWord,
    addLearntWord,
    removeLearntWord,
    removeAnnotation,
    addToCardHistory,
    removeFromCardHistory,
    addBookmark,
    setShowIPA,
    setShowChinese,
    setExportFormat,
    setExportIncludeIPA,
    setExportIncludeChinese,
    setExportIncludePhraseList,
    setExportIncludePhraseTranslations,
    setLevel,
    setAnnotationMode,
    setPhraseCardProvider,
    setSentenceCardProvider,
    setAutoPronounceSetting,
    setAutoShowCardOnPlay,
    loadKnownWords,
    loadLearntWords,
    loadAnnotations,
  } = useAppStore();
  
  const autoShowCardOnPlay = useAppStore(state => state.autoShowCardOnPlay);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [showNewDocModal, setShowNewDocModal] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newDocContent, setNewDocContent] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('read');
  const [reviewSortMode, setReviewSortMode] = useState<ReviewSortMode>('date');
  const [reviewStatsRange, setReviewStatsRange] = useState<ReviewStatsRange>('week');
  const [reviewSelectedBucketKey, setReviewSelectedBucketKey] = useState<string | null>(null);
  const [reviewHiddenCardKeys, setReviewHiddenCardKeys] = useState<Set<string>>(new Set());
  const [pendingDeleteDocumentId, setPendingDeleteDocumentId] = useState<string | null>(null);
  const [serverLibraryBooks, setServerLibraryBooks] = useState<ServerLibraryBook[]>([]);
  const [serverLibraryStatus, setServerLibraryStatus] = useState<string>('Loading server library...');
  const [loadingServerBookName, setLoadingServerBookName] = useState<string | null>(null);
  
  // Get current document and chapter
  const currentDocument = documents.find((d: Document) => d.id === currentDocumentId);
  const currentChapter = currentDocument?.type === 'epub' && currentDocument.currentChapterId
    ? currentDocument.chapters?.find((c: Chapter) => c.id === currentDocument.currentChapterId)
    : null;
  
  // Get paragraphs to display (from chapter or document)
  const displayParagraphs = currentChapter?.paragraphs || currentDocument?.paragraphs || [];
  const markdownOutlineEntries = useMemo(
    () =>
      currentDocument?.format === 'markdown'
        ? displayParagraphs
            .map((paragraph: ParagraphType, index: number) => ({
              paragraphIndex: index,
              title: paragraph.text,
              level: paragraph.blockType === 'heading' ? paragraph.blockLevel || 1 : null,
            }))
            .filter((item): item is { paragraphIndex: number; title: string; level: number } => Boolean(item.level))
        : [],
    [currentDocument?.format, displayParagraphs],
  );

  // Speech synthesis state
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState<number | null>(null);
  const [currentWordIndex, setCurrentWordIndex] = useState<number>(-1);
  const speechSynthesisRef = useRef<SpeechSynthesisUtterance | null>(null);
  const shouldStopRef = useRef(false);
  const resumedDocumentRef = useRef<string | null>(null);
  const autoStartDateRef = useRef<string | null>(null);
  const [speechRate, setSpeechRate] = useState(() => getStoredNumber('speechRate', appDefaults.speechRate ?? 0.9));
  const [speechPitch, setSpeechPitch] = useState(() => appDefaults.speechPitch ?? 1.0);
  const [selectedVoice, setSelectedVoice] = useState<string>(() => appDefaults.selectedVoice || '');
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [showSpeedControl, setShowSpeedControl] = useState(false);
  const [immersiveMode, setImmersiveMode] = useState(() => getStoredBoolean('immersiveMode', appDefaults.immersiveMode ?? false));
  const [autoResumeOnOpen, setAutoResumeOnOpen] = useState(() => getStoredBoolean('autoResumeOnOpen', appDefaults.autoResumeOnOpen ?? true));
  const [autoReadOnOpen, setAutoReadOnOpen] = useState(() => getStoredBoolean('autoReadOnOpen', appDefaults.autoReadOnOpen ?? false));
  const [autoStartTime, setAutoStartTime] = useState(() => getStoredString('autoStartTime', appDefaults.autoStartTime || '21:00'));
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('Voice off');
  const voiceRecognitionRef = useRef<any>(null);
  const [autoAnnotate, setAutoAnnotate] = useState(false); // 闂傚倸鍊搁崐鐑芥嚄閸洖鍌ㄧ憸鏃堝Υ閸愨晜鍎熼柕蹇嬪焺濞茬鈹戦悩璇у伐閻庢凹鍙冨畷锝堢疀濞戞瑧鍘撻梺鍛婄箓鐎氼參宕宠ぐ鎺撶厱闁硅埇鍔屾禍楣冩⒒閸屾瑧鍔嶉柟顔肩埣瀹曟洟顢涢悙鑼槷閻庡箍鍎遍ˇ顖毿ч弻銉︾厱妞ゆ劑鍊曢弸宥囩磼鐠囧弶顥為柕鍥у瀵粙濡搁敐鍕崟闂備胶顭堥鍡涘箰閹间焦鍋╅柣鎴ｆ閻愬﹪鏌嶉崫鍕舵敾闁?
  const [isLoadingAnnotation, setIsLoadingAnnotation] = useState(false);
  const [markedWords, setMarkedWords] = useState<Set<string>>(new Set());
  
  // 婵犵數濮烽弫鎼佸磻濞戙埄鏁嬫い鎾跺枑閸欏繘鏌熺紒銏犳灍闁哄懏绻堥弻鏇熷緞閸繂澹斿┑鐐村灟閸ㄥ綊鎮″☉銏＄厱婵炴垵宕獮鏍煕閻愵亜濮傛慨濠冩そ楠炴牠鎮欓幓鎺戭潙闂備礁鎲￠弻銊х矓閻熼偊鍤曢柟鎯版闁卞洭鏌曡箛瀣伄闁挎稒绻冪换娑欐綇閸撗冨煂闂佸湱鈷堥崑濠傤嚕缁嬪簱鏋庨柟鎵虫櫃缁?
  const [todayAnnotations, setTodayAnnotations] = useState<{ date: string; count: number; words: Array<{type: LearningCardType, word: string}> }>(() => {
    const stored = localStorage.getItem('todayAnnotations');
    if (stored) {
      const data = JSON.parse(stored);
      const today = new Date().toDateString();
      // 婵犵數濮烽弫鍛婃叏閻戝鈧倹绂掔€ｎ亞鍔﹀銈嗗坊閸嬫捇鏌涢悢閿嬪仴闁糕斁鍋撳銈嗗坊閸嬫挾绱撳鍜冭含妤犵偛鍟灒閻犲洩灏欑粣鐐烘煟韫囨洖浠фい顓炵墛缁傚秹鎮欓鍌滎啎闂佺懓顕崕鎰閻愵兙浜滈煫鍥ㄦ尵婢ф洜鐥幑鎰惞闁逞屽墮缁犲秹宕曢柆宓ュ洦瀵奸弶鎴狅紵閻庡箍鍎遍ˇ浼存偂閺囥垺鐓涢柛銉ｅ劚婵＄厧顭胯閸ㄥ爼寮婚妸銉㈡婵妫欓埢鍫ユ⒑閸濆嫮鐒跨紒缁樼箓閻ｉ攱绺界粙娆炬綂闂佺粯锚绾绢參鍩€椤掍礁鍔ら柍瑙勫灴閸╁嫰宕橀妸褏銈烽梻浣侯攰椤曟粎妲愰弴鐘插灊閻庯綆鍠栫粻鎶芥煙閹冾暢闁伙箑鐗撳铏圭矙閹稿孩鎷遍柣顏勵樀閺屾盯骞嬪鍛厯濠殿喖锕ュ浠嬬嵁閹邦厽鍎熼柨婵嗗€归～宥夋⒒娴ｈ銇熼柛妯绘そ閹虫宕奸弴鐐殿唹闂侀潧绻堥崐鏇犵不閿濆鐓ラ柡鍥殔娴滈箖姊虹紒妯哄闁挎洦浜濠氭晲婢跺﹦鐤€濡炪倖鐗楀銊バ掗姀銈嗏拺闁革富鍘藉▍鏇炩攽閻愨晛浜鹃梻浣告惈閺堫剛绮欓幘瀵割浄闁挎梻鍋撶€氭岸鏌熺紒妯轰刊闁诲酣鏀辩换婵嬫偨闂堟稐绮堕梺缁橆殔閿曨亜鐣疯ぐ鎺戝瀭妞ゆ洖鎳庡▓銊ヮ渻閵堝棗濮ч梻鍕瀹曟垹鈧綆鍠楅悡鏇熴亜閹板墎鎮肩紒鐘筹耿閺屾洟宕奸鍌滄殼濠殿喖锕ュ浠嬬嵁閹邦厽鍎熼柨婵嗗€搁～宀€绱撻崒娆戭槮妞ゆ垵妫濆畷褰掑锤濡ゅ啫绁﹂梺绯曞墲椤洭鎮疯ぐ鎺撶厓鐟滄粓宕滃▎鎾村仼鐎瑰嫰鍋婂鈺傘亜閹达絽袚闁诲骸顭峰铏规喆閸曨偆顦ㄥ┑鐐叉噺濞茬喖銆侀弮鍫熷亜闁惧繐婀遍敍?
      if (data.date === today) {
        // 闂傚倸鍊搁崐鐑芥嚄閸洍鈧箓宕奸姀鈥冲簥闂佸湱鍎ら〃鍛村磼閵娧勫枑闁哄啫鐗勯埀顑跨閳诲酣骞樺畷鍥╂澑闂備礁鎼ˇ鍐测枖閺囥垺鍎撻柛鏇ㄥ灡閸嬧剝绻濇繝鍌氭殶缂佺姵鐓￠弻锟犲川閻楀牏銆愰柧缁樼墵閺屾稑鈽夐崡鐐茬闂佺粯绻冮敋妞ゎ亜鍟存俊鍫曞幢濡ゅ啰鎳嗛梻浣瑰濞测晜淇婇崶鈺佸灊闁挎繂鎲橀弮鍫濈劦妞ゆ帒瀚悡姗€鏌熸潏鍓х暠闁诲繑濞婇弻娑㈠箛椤撶姰鍋為梺绋款儐閹逛線濡甸幇鏉跨闁圭偓鏋奸崑鎾舵崉娓氼垳鍞甸柣鐘叉惈瑜板潡宕奸妷銉ㄦ憰闂佹寧娲栭崐褰掓偂閸愵喗鐓冮弶鐐村椤︼箓鏌￠崱娆忎户缂佽鲸甯￠幃鈺呭礃濞堝妲檙ds闂傚倸鍊峰ù鍥敋瑜忛埀顒佺▓閺呮繄鍒掑▎鎾崇婵＄偛鐨烽崑鎾诲礃椤旂厧鑰垮┑鐐村灱妞存悂寮查埡鍛€甸柛蹇擃槸娴滈箖姊洪崨濠冨闁告挻鑹鹃埢宥夊冀椤撶喓鍘介棅顐㈡处濞叉牗绂掗敃鍌涚厱閹肩补鈧櫕姣愬銈庡幖濞差參鐛€ｎ喗鏅滈柣锝呰嫰楠炲牓姊绘担鍛婃儓闁哥噥鍋婂畷鎰矙閹稿孩鐦庨梻鍌氬€风粈渚€鎮块崶顒婄稏濠㈣埖鍔栭崑瀣煟濡儤鈻曢柛銈嗘礃閵囧嫰骞囬崜浣烘殸缂備胶濮伴崕鏌ュΦ閸曨垰妫橀柛顭戝枓閹稿啴姊?
        return {
          date: data.date,
          count: data.count || 0,
          words: data.words || []
        };
      }
    }
    return { date: new Date().toDateString(), count: 0, words: [] };
  });
  
  // State for hiding translations in card history (for self-testing)
  const [hiddenTranslations, setHiddenTranslations] = useState<Set<string>>(new Set());
  
  const [phraseMarkedRanges, setPhraseMarkedRanges] = useState<Array<{ pIndex: number; sIndex: number; startTokenIndex: number; endTokenIndex: number }>>([]); // stores token ranges
  const [underlinePhraseRanges, setUnderlinePhraseRanges] = useState<Array<{ pIndex: number; sIndex: number; startTokenIndex: number; endTokenIndex: number; color: string }>>([]); // for discontinuous phrases with Ctrl+Shift
  const [isOutlineCollapsed, setIsOutlineCollapsed] = useState(true); // Default collapsed like Notion
  const [isOutlineHovered, setIsOutlineHovered] = useState(false);
  const [phraseAnnotations, setPhraseAnnotations] = useState<Map<string, PhraseAnnotation>>(new Map());
  const [annotatedPhraseRanges, setAnnotatedPhraseRanges] = useState<Array<{ pIndex: number; sIndex: number; startTokenIndex: number; endTokenIndex: number; phrase: string }>>([]); // 闂傚倷娴囬褎顨ョ粙鍖¤€块梺顒€绉埀顒婄畵瀹曠厧鈹戦幇顒侇吙闂備礁澹婇崑鍛哄鈧畷鎴炲緞閹邦厾鍙嗗┑鐘绘涧濡瑩宕抽幎鑺ョ厸閻庯綆鍋嗘晶鐢告煛鐏炵偓绀冪紒缁樼椤︽煡鎮楀鐓庢珝鐎殿喗濞婇幃鈺冪磼濡攱瀚兼繝鐢靛仩鐏忣亪顢氳椤曪絾銈ｉ崘鈺冨幈濠电偛妫楅懟顖涚閻愵兛绻嗛柣鎰典簻閳ь剚鐗曠叅闊洦绋戦崹鍌毭归悩宸剰缂佺姷濞€閺岋絽螣濞嗘儳娈紓浣插亾闁告劦鍠楅悡蹇撯攽閻樿尙绠版い鈺婂墴閺?
  const [phraseTranslationInserts, setPhraseTranslationInserts] = useState<Map<string, boolean>>(new Map()); // 闂傚倸鍊搁崐鐑芥倿閿曗偓椤啴宕稿Δ鈧惌妤呭箹濞ｎ剙濡奸柣顓燁殜閺屽秷顧侀柛鎾村哺婵＄敻宕熼姘祮濠碘槅鍨靛▍锝嗗閸曨厾纾藉ù锝勭矙閸濇椽鏌ｉ悢鍙夋珔妞ゆ洩缍侀獮蹇撶暆閳ь剟鎮块埀顒勬⒑閸濆嫭宸濋柛鐔该埞鎴犫偓锝庡亐閹锋椽姊洪棃鈺佺槣闁告ê澧介弫顔尖槈閵忊€充缓濡炪倖鐗楃粙鎴澝归閿亾鐟欏嫭绌跨紓宥勭閻ｇ兘宕￠悙鈺傤潔濠电偛妫楃换瀣уΔ鍛拻濞达絽鎼敮鍫曟煙閼恒儳鐭掗柕鍡楀€圭粋鎺斺偓锝庝簽閿?
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false); // 闂傚倸鍊峰ù鍥х暦閸偅鍙忕€规洖娲ㄩ惌鍡椕归敐鍫綈婵炲懐濮撮湁闁绘ê妯婇崕鎰版煕鐎ｅ吀閭柡灞剧洴閸╁嫰宕橀浣割潓婵＄偑鍊戦崕閬嶆偋閹捐钃熼柡鍥风磿閻も偓婵犵數濮撮崐鎼佸煕婢跺瞼纾?
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; pIndex: number; sIndex: number; sentenceText?: string; focusWords?: string[] } | null>(null); // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐蹭画闂佹寧姊婚弲顐ょ不閹€鏀介柣妯哄级閹兼劙鏌＄€ｂ晝鍔嶉柕鍥ゅ楠炴﹢宕￠悙鍏哥棯闂備焦鎮堕崐鏍哄Ο鍏煎床婵犻潧娲ㄧ弧鈧梺绋挎湰绾板秴鈻撻鐘电＝濞达絾褰冩禍?
  const [expandedCardKeys, setExpandedCardKeys] = useState<Set<string>>(new Set());
  const [collapsedImageMenu, setCollapsedImageMenu] = useState<{ panel: 'emoji' | 'web'; word: string; cardLookupKey: string; top: number; left: number } | null>(null);
  const [collapsedEmojiSearchQuery, setCollapsedEmojiSearchQuery] = useState('');
  const [collapsedGoogleKeyword, setCollapsedGoogleKeyword] = useState('');
  const [collapsedClipboardSaving, setCollapsedClipboardSaving] = useState(false);
  const [collapsedUnsplashLockedWords, setCollapsedUnsplashLockedWords] = useState<Set<string>>(new Set());
  const [fixedStorageStatus, setFixedStorageStatus] = useState<string>('Not checked');
  const [autoFixedBackupEnabled, setAutoFixedBackupEnabled] = useState<boolean>(() =>
    getStoredBoolean('autoFixedBackupEnabled', appDefaults.autoFixedBackupEnabled ?? true)
  );
  const prevMarkedWordsSize = useRef<number>(0); // 闂傚倸鍊风粈渚€骞栭位鍥敃閿曗偓閻ょ偓绻涢幋娆忕仼闁绘帒鐏氶妵鍕箳閹存績鍋撻幖浣稿嚑婵炴垯鍨洪悡鏇㈡煏閸繃濯奸柛搴＄箻閺屽秹鎸婃径妯烩枅濡ょ姷鍋為…鍥╁垝閻㈠灚鍠嗛柛鏇ㄥ墯濮ｅ骸鈹戦敍鍕杭闁稿﹥鐗犲畷婵嬪即閵忕姈褔鏌熼梻瀵割槮缂?markedWords 婵犵數濮烽弫鍛婃叏娴兼潙鍨傜憸鐗堝笚閸嬪鏌曡箛瀣偓鏇犵矆閸愨斂浜滈煫鍥ㄦ尰閸ｈ姤淇?

  const closeCard = (cardKey: string) => {
    setExpandedCardKeys(prev => {
      const next = new Set(prev);
      next.delete(cardKey);
      return next;
    });
  };

  const expandSingleCard = (cardKey: string) => {
    setExpandedCardKeys(new Set([cardKey]));
  };

  
  // Initialize local dictionary
  useEffect(() => {
    localDictionary.initialize().then(() => {
      const stats = localDictionary.getStats();
      console.log(`[App] Local dictionary initialized: ${stats.totalWords} words`);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadServerLibrary = async () => {
      const result = await getServerLibraryBooks();
      if (cancelled) return;

      if (result.success && result.data) {
        setServerLibraryBooks(result.data);
        setServerLibraryStatus(
          result.data.length > 0
            ? `Server Library (${result.data.length})`
            : 'Server library is empty'
        );
      } else {
        setServerLibraryBooks([]);
        setServerLibraryStatus(result.error || 'Server library unavailable');
      }
    };

    void loadServerLibrary();

    return () => {
      cancelled = true;
    };
  }, []);

  // Save today's annotations to localStorage
  useEffect(() => {
    localStorage.setItem('todayAnnotations', JSON.stringify(todayAnnotations));
  }, [todayAnnotations]);

  useEffect(() => {
    localStorage.setItem('immersiveMode', String(immersiveMode));
  }, [immersiveMode]);

  useEffect(() => {
    localStorage.setItem('autoResumeOnOpen', String(autoResumeOnOpen));
  }, [autoResumeOnOpen]);

  useEffect(() => {
    localStorage.setItem('autoReadOnOpen', String(autoReadOnOpen));
  }, [autoReadOnOpen]);

  useEffect(() => {
    localStorage.setItem('autoStartTime', autoStartTime);
  }, [autoStartTime]);

  useEffect(() => {
    localStorage.setItem('speechRate', String(speechRate));
  }, [speechRate]);

  useEffect(() => {
    setReviewSelectedBucketKey(null);
  }, [reviewStatsRange]);

  useEffect(() => {
    setReviewHiddenCardKeys(new Set());
  }, [reviewSortMode, reviewSelectedBucketKey, reviewStatsRange]);

  const reviewCards = useMemo<ReviewCardItem[]>(() => {
    const items: ReviewCardItem[] = [];
    const seenWords = new Set<string>();

    for (const annotation of annotations.values()) {
      const wordCardIdentity = getWordCardIdentity(annotation);
      if (seenWords.has(wordCardIdentity)) continue;
      seenWords.add(wordCardIdentity);

      items.push({
        type: 'word',
        word: annotation.word,
        normalizedWord: wordCardIdentity,
        cardKey: `word-${wordCardIdentity}`,
        lookupKey: wordCardIdentity,
        displayLabel: getWordCardDisplayLabel(annotation),
        annotation,
        cachedAt: annotation.cachedAt || 0,
      });
    }

    for (const [phraseKey, annotation] of phraseAnnotations.entries()) {
      const cardType = annotation.cardType || 'phrase';
      items.push({
        type: cardType,
        word: annotation.phrase || phraseKey,
        normalizedWord: phraseKey,
        cardKey: `${cardType}-${phraseKey}`,
        lookupKey: phraseKey,
        annotation,
        cachedAt: annotation.cachedAt || 0,
      });
    }

    return items;
  }, [annotations, phraseAnnotations]);

  const sentenceCardKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const [phraseKey, annotation] of phraseAnnotations.entries()) {
      if ((annotation.cardType || 'phrase') === 'sentence') {
        keys.add(phraseKey);
      }
    }
    return keys;
  }, [phraseAnnotations]);

  const reviewStatsBuckets = useMemo<StatsBucket[]>(() => {
    const now = new Date();
    const bucketMap = new Map<string, StatsBucket>();

    if (reviewStatsRange === 'week') {
      for (let offset = 6; offset >= 0; offset--) {
        const date = new Date(now);
        date.setHours(0, 0, 0, 0);
        date.setDate(now.getDate() - offset);
        const key = date.toISOString().slice(0, 10);
        bucketMap.set(key, {
          key,
          label: date.toLocaleDateString('en-US', { weekday: 'short' }),
          sublabel: `${date.getMonth() + 1}/${date.getDate()}`,
          count: 0,
          cardKeys: [],
        });
      }
    } else {
      for (let offset = 5; offset >= 0; offset--) {
        const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        bucketMap.set(key, {
          key,
          label: date.toLocaleDateString('en-US', { month: 'short' }),
          sublabel: String(date.getFullYear()),
          count: 0,
          cardKeys: [],
        });
      }
    }

    reviewCards.forEach((item) => {
      if (!item.cachedAt) return;
      const date = new Date(item.cachedAt);
      const key = reviewStatsRange === 'week'
        ? date.toISOString().slice(0, 10)
        : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const bucket = bucketMap.get(key);
      if (!bucket) return;
      bucket.count += 1;
      bucket.cardKeys.push(item.cardKey);
    });

    return Array.from(bucketMap.values());
  }, [reviewCards, reviewStatsRange]);

  const reviewVisibleCards = useMemo(() => {
    let next = [...reviewCards];

    if (reviewSortMode === 'stats') {
      if (!reviewSelectedBucketKey) {
        return [];
      }
      const selectedBucket = reviewStatsBuckets.find((bucket) => bucket.key === reviewSelectedBucketKey);
      if (!selectedBucket) {
        return [];
      }
      const selectedCardKeys = new Set(selectedBucket.cardKeys);
      next = next.filter((item) => selectedCardKeys.has(item.cardKey));
    }

    if (reviewSortMode === 'alphabet') {
      next.sort((a, b) => a.normalizedWord.localeCompare(b.normalizedWord));
    } else {
      next.sort((a, b) => b.cachedAt - a.cachedAt || a.normalizedWord.localeCompare(b.normalizedWord));
    }
    return next.filter((item) => !reviewHiddenCardKeys.has(item.cardKey));
  }, [reviewCards, reviewSortMode, reviewSelectedBucketKey, reviewStatsBuckets, reviewHiddenCardKeys]);

  const reviewDisplayRows = useMemo<ReviewDisplayRow[]>(() => {
    const rows: ReviewDisplayRow[] = [];
    let lastDividerLabel: string | null = null;

    reviewVisibleCards.forEach((item) => {
      let dividerLabel: string | null = null;

      if (reviewSortMode === 'date') {
        const date = item.cachedAt ? new Date(item.cachedAt) : null;
        dividerLabel = date
          ? `${date.getFullYear()} ${date.getMonth() + 1}.${String(date.getDate()).padStart(2, '0')}`
          : 'Unknown date';
      } else if (reviewSortMode === 'alphabet') {
        const firstChar = item.normalizedWord.charAt(0).toUpperCase();
        dividerLabel = /^[A-Z]$/.test(firstChar) ? firstChar : '#';
      }

      if (dividerLabel && dividerLabel !== lastDividerLabel) {
        rows.push({
          type: 'divider',
          key: `divider-${dividerLabel}`,
          label: dividerLabel,
        });
        lastDividerLabel = dividerLabel;
      }

      rows.push({
        type: 'card',
        key: item.cardKey,
        item,
      });
    });

    return rows;
  }, [reviewVisibleCards, reviewSortMode]);

  // Auto-annotate when markedWords increases (if autoAnnotate is enabled)
  useEffect(() => {
    // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐蹭画濡炪倖鐗楃粙鎾汇€呴崣澶岀瘈濠电姴鍊搁弸锕傛煠閻楀牆顕滈柕鍥у缁犳盯骞樼捄渚毇闂備礁鎲￠崝蹇涘磻閹剧粯鈷掑ù锝堫潐閸嬬娀鏌涙惔锝呭妺缂佸倸绉瑰畷濂稿即閻愯泛鐓橀梻浣稿閸嬪懎煤濮椻偓瀹曟垿鏁愭径瀣幈闂侀潧顦伴崹鐢稿箟濞戙垹顫呴幒铏濠婂牊鐓忛柛顐ｇ箖閸ｅ綊鏌￠崱顓犳偧闁逞屽墲椤煤濡吋宕查柛顐犲劚缁犳牠鏌嶉崫鍕櫤闁诡垳鍋為妵鍕箛闂堟稐绨奸悶姘€鍥ㄢ拻濞达綀妫勯崥褰掓煕閻樺啿濮嶉柟顕€鏀卞蹇涘煛閸愌呯憹闂備胶顢婇幓顏嗗緤缂佹顩茬憸鐗堝笚閻撴洜鈧厜鍋撻柍褜鍓熷畷鎴︽倷閸濆嫮鏌у銈嗗笒鐎氼參鎮￠弴鐔翠簻闁规澘澧庨幃濂告煟椤撶偟鐒搁柡宀嬬秮閹垽宕妷褏鏉介梻浣告惈閺堫剟鎯勯鐐叉瀬闁稿瞼鍋涙导鐘绘煕閺囥劌浜介柣搴㈠▕濮婄粯绗熼埀顒€顭囬懡銈囩闁逞屽墯缁绘盯宕崘顏喩戠紓浣稿€哥粔褰掔嵁閺嶃劍濯撮柛婵勫労閸氬懘姊绘担铏瑰笡闁告梹鐗犻獮鍡欎沪鏉炲尅缍侀、娑㈡倷鐎电骞楅梻浣虹帛閺屻劑骞楀鍫濈疇闁哄洨濮风壕濂告煟濡搫鏆遍柣蹇涗憾閺屾洟宕堕妸銉ヮ潚閻庤娲樼敮锟犲箖濞嗘垟鍋撳☉娅虫垿鎮?
    if (autoAnnotate && markedWords.size > prevMarkedWordsSize.current && markedWords.size > 0 && !isLoadingAnnotation) {
      console.log('[Auto-Annotate] Triggered by word mark');
      handleAnnotate(true);
    }
    prevMarkedWordsSize.current = markedWords.size;
  }, [markedWords.size]); // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐蹭画濡炪倖鐗楃粙鎾汇€呴弻銉︾厽闁归偊鍨煎鎸庣箾瀹割喕绨荤紒鈧崘鈹夸簻闁哄啫娲らˉ宥囨偖濠靛洣绻嗛柣鎰典簻閳ь剚鐗曢蹇旂節濮橆剛锛涢梺鐟板⒔缁垶鎮¤箛娑欑厱闁靛鍨电€氼剛绮ｅ☉娆戠閻庢稒顭囬惌瀣煟閳╁啯绀堢紒顔款嚙閳藉濮€閻樻鍟嬮柣搴ゎ潐濞叉牕煤閵娿劉鍙洪梻?

  // Close export menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setShowExportMenu(false);
    if (showExportMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showExportMenu]);

  useEffect(() => {
    if (showSettings) {
      void handleCheckFixedStorageStatus();
    }
  }, [showSettings]);

  useEffect(() => {
    localStorage.setItem('autoFixedBackupEnabled', autoFixedBackupEnabled ? 'true' : 'false');
  }, [autoFixedBackupEnabled]);

  // Rebuild annotatedPhraseRanges when document or phraseAnnotations change
  useEffect(() => {
    if (!currentDocument || phraseAnnotations.size === 0) {
      setAnnotatedPhraseRanges([]);
      return;
    }

    const ranges: Array<{ pIndex: number; sIndex: number; startTokenIndex: number; endTokenIndex: number; phrase: string }> = [];

    // Scan each paragraph and sentence
    displayParagraphs.forEach((paragraph: ParagraphType, pIndex: number) => {
      paragraph.sentences.forEach((sentence: Sentence, sIndex: number) => {
        // Try to find phrase matches in this sentence
        for (let startTokenIndex = 0; startTokenIndex < sentence.tokens.length; startTokenIndex++) {
          // Try different phrase lengths (from 2 to remaining tokens)
          for (let endTokenIndex = startTokenIndex + 1; endTokenIndex < sentence.tokens.length; endTokenIndex++) {
            const phraseText = sentence.tokens
              .slice(startTokenIndex, endTokenIndex + 1)
              .map((t: Token) => t.text)
              .join('')
              .trim()
              .toLowerCase();

            const annotation = phraseAnnotations.get(phraseText);
            if (annotation && (annotation.cardType || 'phrase') === 'phrase') {
              ranges.push({
                pIndex,
                sIndex,
                startTokenIndex,
                endTokenIndex,
                phrase: phraseText
              });
              // Skip to end of this phrase to avoid overlapping matches
              startTokenIndex = endTokenIndex;
              break;
            }
          }
        }
      });
    });

    setAnnotatedPhraseRanges(ranges);
    console.log(`[OK] Rebuilt ${ranges.length} annotated phrase ranges for current document`);
  }, [currentDocument, phraseAnnotations]);

  // Clear marked words when document changes
  useEffect(() => {
    if (!currentDocument) {
      setMarkedWords(new Set());
      return;
    }

    // Auto-mark is removed, markedWords will only be set by manual clicks
    setMarkedWords(new Set());
  }, [currentDocument, knownWords]);

  // Load available voices
  useEffect(() => {
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      const enVoices = voices.filter(v => v.lang.startsWith('en'));
      setAvailableVoices(enVoices);
      if (enVoices.length > 0 && (!selectedVoice || !enVoices.some(v => v.name === selectedVoice))) {
        // Try to find Microsoft Ava Online Natural voice
        const avaVoice = enVoices.find(v => 
          v.name.toLowerCase().includes('ava') && 
          v.name.toLowerCase().includes('online')
        );
        // Fallback to any Microsoft Online Natural voice
        const msOnlineVoice = enVoices.find(v => 
          v.name.toLowerCase().includes('microsoft') && 
          v.name.toLowerCase().includes('online')
        );
        // Use Ava, or any MS Online, or first available
        setSelectedVoice(avaVoice?.name || msOnlineVoice?.name || enVoices[0].name);
      }
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, [selectedVoice]);

  // When selectedWord changes, add to history (婵犵數濮烽弫鎼佸磻閻愬搫鍨傞柛顐ｆ礀缁犱即鏌涘┑鍕姢闁活厽鎹囬弻锝夊箣閿濆棭妫勯梺鍛婁亢椤鎹㈠┑鍥╃瘈闁稿本绮岄。铏圭磽娴ｆ彃浜炬繝銏ｅ煐閸旀牠鎮¤箛鎾斀闁绘劘灏欐禒銏ゆ煕閺傝鈧牜鎹㈠☉銏犵闁稿繐鐨烽幏濠氭⒑闁偛鑻晶顖涖亜閺冣偓閻楃姴鐣锋导鏉戠婵°倐鍋撶痪?
  useEffect(() => {
    const selectedEntry = selectedWord ? findAnnotationEntry(annotations, selectedWord) : null;
    if (selectedWord && selectedEntry) {
      const annotation = selectedEntry.annotation;
      if (annotation && (annotation as any).definition) {
        // 濠电姷鏁告慨鐑藉极閹间礁纾块柟瀵稿Х缁€濠囨煃瑜滈崜姘跺Φ閸曨垰鍗抽柛鈩冾殔椤忣亪鏌涘▎蹇曠闁哄矉缍侀獮鍥敆娴ｇ懓鍓电紓鍌欒閸嬫捇鏌涢埄鍐姇闁绘挻绋戦…璺ㄦ崉閻氭潙濮涙繛瀵稿О閸ㄤ粙寮诲☉婊庢Щ闂佹寧娲︽禍顏勵嚕鐠囨祴妲堟俊顖炴敱閻庡姊洪崷顓炲妺闁搞劌銈稿顐﹀垂椤曞懏瀵岄梺闈涚墕濡瑩鎮￠妷锔剧婵炴潙顑嗗▍濠傗攽閿涘嫭鏆鐐叉喘瀵爼宕归鑲┿偖濠碉紕鍋戦崐鏇犳崲閹邦儵娑樷槈閳跺搫娲、娆撴偩瀹€鈧鏇㈡煛婢跺﹦澧曞褌绮欏畷姘舵偋閸粎绠氬銈嗗姧缁查箖鍩涢幒鏃傜＜妞ゆ洖鎳庨獮妤冣偓鍨緲鐎氫即鐛崶顒夋晣闁绘劕顕弶鐟扳攽閿涘嫬浜奸柛濠冩礈閹广垽骞囬鐟颁壕婵鍘ф晶鍙夈亜閵堝懎顏慨濠呮閹风娀鎳犻鍌ゅ敽闂備胶顭堥鍥磻濞戞艾寮查梻浣告惈缁嬩線宕戦崨杈剧稏?
        const canonicalHistoryWord = getWordCardIdentity(annotation as WordAnnotation);
        if (selectedEntry.key !== canonicalHistoryWord) {
          removeFromCardHistory(selectedEntry.key);
        }
        addToCardHistory('word', canonicalHistoryWord);
      }
    }
  }, [selectedWord, annotations, addToCardHistory, removeFromCardHistory]);

  // Handle word click
  // Handle word click: toggle marked state
  const handleWordClick = (word: string, pIndex?: number, sIndex?: number, tokenIndex?: number) => {
    const normalized = word.toLowerCase();
    const wordEntry = findAnnotationEntry(annotations, normalized);
    if (shouldDebugWord(normalized, wordEntry?.annotation?.baseForm, wordEntry?.annotation?.word)) {
      logWordDebug('App.handleWordClick:start', {
        clickedWord: word,
        normalized,
        foundEntryKey: wordEntry?.key || null,
        annotationWord: wordEntry?.annotation?.word || null,
        annotationBaseForm: wordEntry?.annotation?.baseForm || null,
        annotationPartOfSpeech: wordEntry?.annotation?.partOfSpeech || null,
      });
    }
    // If word has a card, just select it to show the card (for double-click on orange words)
    const hasCard = wordEntry && (wordEntry.annotation as any)?.definition;
    if (hasCard) {
      const annotation = wordEntry?.annotation as WordAnnotation | undefined;
      if (annotation) {
        void (async () => {
          const repaired = await localDictionary.lookup(normalized);
          if (!repaired) {
            return;
          }

          const repairedSurfaceWord = normalizeWordFormValue(repaired.word) || normalized;
          const repairedCardIdentity = getWordCardIdentity({
            ...repaired,
            word: repairedSurfaceWord,
          }, normalized);
          const currentCardIdentity = getWordCardIdentity(annotation, normalized);
          const currentSurfaceWord = normalizeWordFormValue(annotation.word);
          if (
            repaired.baseForm === annotation.baseForm &&
            repairedSurfaceWord === currentSurfaceWord &&
            (repaired.bncRank || 0) === (((annotation as WordAnnotation).bncRank) || 0) &&
            repaired.partOfSpeech === annotation.partOfSpeech &&
            repairedCardIdentity === currentCardIdentity
          ) {
            return;
          }

          const repairedAnnotation: WordAnnotation = {
            ...annotation,
            ...repaired,
            word: repairedSurfaceWord,
            cardKey: repairedCardIdentity,
            sentence: annotation.sentence,
            documentTitle: annotation.documentTitle,
            encounteredForms: buildEncounteredForms(normalized, repaired, annotation.encounteredForms || []),
            cachedAt: Date.now(),
          };

          if (shouldDebugWord(normalized, repaired.baseForm, repairedSurfaceWord)) {
            logWordDebug('App.handleWordClick:repair-existing-card', {
              normalized,
              previousAnnotation: annotation,
              repaired,
              repairedAnnotation,
            });
          }

          if (wordEntry?.key && wordEntry.key !== repairedCardIdentity && wordEntry.key !== normalized) {
            removeAnnotation(wordEntry.key);
            await deleteAnnotation(wordEntry.key);
          }

          addAnnotation(repairedCardIdentity, repairedAnnotation);
          await cacheAnnotation(repairedCardIdentity, repairedAnnotation);

        })();
      }

      if (pIndex !== undefined && sIndex !== undefined) {
        const sentenceText = displayParagraphs[pIndex]?.sentences[sIndex]?.text;
        if (annotation && sentenceText) {
          const meaningId = findBestMeaningIdForSentence(annotation, sentenceText);
          if (meaningId && meaningId !== annotation.activeMeaningId) {
            const projected = applyMeaningToAnnotation(annotation, meaningId);
            addAnnotation(wordEntry!.key, projected);
            void setActiveMeaning(wordEntry!.key, meaningId, (updates) => {
              updateAnnotation(wordEntry!.key, updates);
            });
          }
        }
      }
      if (shouldDebugWord(normalized, wordEntry?.annotation?.baseForm, wordEntry?.annotation?.word)) {
        logWordDebug('App.handleWordClick:select-existing-card', {
          selectedWord: normalized,
          entryKey: wordEntry?.key || null,
          annotation: wordEntry?.annotation || null,
        });
      }
      setSelectedWord(wordEntry.key);
      return;
    }

    // Check if this token is in any phrase marked range (purple takes priority)
    if (pIndex !== undefined && sIndex !== undefined && tokenIndex !== undefined) {
      // First check if this token is in any underline range
      const underlineRangeIndex = underlinePhraseRanges.findIndex(range =>
        range.pIndex === pIndex &&
        range.sIndex === sIndex &&
        tokenIndex >= range.startTokenIndex &&
        tokenIndex <= range.endTokenIndex
      );

      if (underlineRangeIndex !== -1) {
        // Remove the entire underline range and all phrase ranges within it
        const underlineRange = underlinePhraseRanges[underlineRangeIndex];
        setUnderlinePhraseRanges(prev => prev.filter((_, i) => i !== underlineRangeIndex));
        // Remove all phrase ranges that are within or overlap with this underline range
        setPhraseMarkedRanges(prev => prev.filter(phraseRange =>
          !(phraseRange.pIndex === underlineRange.pIndex &&
            phraseRange.sIndex === underlineRange.sIndex &&
            phraseRange.startTokenIndex >= underlineRange.startTokenIndex &&
            phraseRange.endTokenIndex <= underlineRange.endTokenIndex)
        ));
        return;
      }

      // Otherwise, check if it's in a phrase range (not connected by underline)
      const rangeIndex = phraseMarkedRanges.findIndex(range =>
        range.pIndex === pIndex &&
        range.sIndex === sIndex &&
        tokenIndex >= range.startTokenIndex &&
        tokenIndex <= range.endTokenIndex
      );

      if (rangeIndex !== -1) {
        // Remove entire range
        setPhraseMarkedRanges(prev => prev.filter((_, i) => i !== rangeIndex));
        return;
      }
    }

    // Then handle regular word marks (green)
    if (markedWords.has(normalized)) {
      // Remove mark
      setMarkedWords(prev => {
        const next = new Set(prev);
        next.delete(normalized);
        return next;
      });
    } else {
      // Add mark
      setMarkedWords(prev => new Set(prev).add(normalized));
      // useEffect 婵犵數濮烽弫鎼佸磻閻愬樊鐒芥繛鍡樻尭鐟欙箓鎮楅敐搴′簽闁崇懓绉电换娑橆啅椤旇崵鐩庨梺鍛婁亢椤鎹㈠┑鍥╃瘈闁稿本绮岄。铏圭磽娴ｆ彃浜炬繝銏ｅ煐閸旀牠鎮¤箛鎾斀闁绘劘灏欐禒銏狀熆閻熼偊妯€闁哄矉绻濆畷鍫曞Ψ閵壯傛偅闂備焦妞块崢浠嬨€冩繝鍥ц摕闁绘棁銆€閸嬫捇鎮藉▓璺ㄥ姼婵炲濮嶉崶銊у幈闂侀潧顭堥崕閬嶅箖閹寸姷纾?
    }
  };

  // Handle text selection for phrase marking
  const handleTextSelection = (e: React.MouseEvent) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    // Find a suitable parent container that's likely to contain all selected tokens
    // Start from the mouse event target and go up
    let parent = e.currentTarget as Element;

    const tokenPositions: Array<{ pIndex: number; sIndex: number; tokenIndex: number }> = [];
    const walker = document.createTreeWalker(
      parent,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => {
          const el = node as HTMLElement;
          if (el.hasAttribute('data-token-pos')) {
            const isContained = selection.containsNode(el, true);
            if (isContained) {
              return NodeFilter.FILTER_ACCEPT;
            }
          }
          return NodeFilter.FILTER_SKIP;
        }
      }
    );

    let node;
    while (node = walker.nextNode()) {
      const tokenPos = (node as HTMLElement).getAttribute('data-token-pos');
      if (tokenPos) {
        const match = tokenPos.match(/^p(\d+)-s(\d+)-t(\d+)$/);
        if (match) {
          tokenPositions.push({
            pIndex: parseInt(match[1]),
            sIndex: parseInt(match[2]),
            tokenIndex: parseInt(match[3])
          });
        }
      }
    }

    if (tokenPositions.length === 0) {
      selection.removeAllRanges();
      return;
    }

    // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸閻ゎ喗銇勯幇鈺佺労闁搞倖娲熼弻娑㈩敃閿濆棗顦╅梺杞扮濡瑧鎹㈠☉銏犵婵炲棗绻掓禒濂告⒑濞茶骞楁い銊ワ躬楠炲啫顫滈埀顒勫箖濞嗘挻鍤嬫繛鍫熷椤ュ绻濆▓鍨珯缂佽弓绮欓弫鍐敂閸繄鐣洪悗鐟板婢瑰寮告惔銏㈢闁糕剝锚閻忊晠鏌￠崱娆忊枅闁诡喖鍢查…銊╁礋椤掑倸鍤掗梻浣侯焾閿曘劑顢氳瀹撳嫰姊洪柅娑樺祮闁稿锕顐﹀礃椤旂晫鍘繝銏ｆ硾閻楀棝宕濈€涙ü绻嗘い鎰╁灮閻掑憡鎱ㄦ繝鍐┿仢鐎规洦鍋婂畷鐔碱敇婢跺牆鐏紒缁樼☉闇夐悗锝庡亝閻濇艾顪冮妶鍐ㄧ仾闁荤啿鏅涢悾鐑藉醇閺囥劍鏅㈡繛杈剧秬椤鎮甸锝囩瘈婵炲牆鐏濋弸鐔兼煥閺囨娅婄€规洘绮岄埢搴ょ疀婵犲喚娼旈柣鐔哥矋濡啫顕ｆ繝姘櫢闁绘ɑ鐓￠崬璺衡攽閻樿尙浠涢柛鏃€鐗犻崺銏ゅ醇閵夛腹鎷洪梻渚囧亞閸嬫盯鎳熼娑欐珷妞ゆ柨顫曟禍婊堟煥閺冨浂鍤欐繛鍛Ч閺岀喖鎼归銈嗗櫚濡ょ姷鍋涢澶愬箖濞嗘挻鍤戞い鎺戝€诲畵浣糕攽閻樻剚鍟忛柛鐘愁殜閺佸啴鍩￠崨顓狅紱婵犵數濮村ú銈夊触閻熸壋鏀芥い鏍电稻閹虫悊en闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢敃鈧悿顕€鏌熼幆鐗堫棄闁哄嫨鍎甸弻鈥愁吋閸愩劌顬夊┑鐐叉噽婵炩偓闁哄矉绲借灒闁惧繘鈧稓椹冲┑鐘愁問閸ㄤ即濡堕幖浣歌摕闁哄洢鍨归柋鍥ㄧ節闂堟稒锛嶅ù鐓庡€荤槐鎾存媴閹绘帊澹曢梺璇插嚱缂嶅棝宕板Δ鍛亗婵炴垯鍨洪悡鏇㈡煛閸ャ儱鐏繛鎳峰洦鐓熼煫鍥ュ劤缁嬭崵绱掔紒妯肩疄闁糕斁鍋撳銈嗗笒鐎氼剟鎮橀幎鑺ョ厵濡鑳堕崝宥嗕繆濡炵厧濮傛慨濠冩そ楠炴劖鎯旈敐鍥╂殼婵犵數鍋犻婊呯不閹捐绠栧Δ锝呭暞閻掕偐鈧箍鍎卞Λ娑㈠储閻㈠憡鈷掑ù锝呮憸娴犮垺銇勯幋婵囧闁哄懎鐖奸、鏃堝礋閵婏附鏉告俊鐐€栧Λ渚€锝炴径濞炬瀺濠电姴娲﹂悡娑㈡倶閻愯泛袚闁革綀娅ｉ埀顒€鐏氬妯尖偓姘煎櫍閸┾偓妞ゆ帒锕︾粔闈浢瑰鍡楃厫缂?
    if (tokenPositions.length === 1) {
      selection.removeAllRanges();
      return;
    }

    // Group by sentence to support cross-sentence selection
    const sentenceGroups = new Map<string, typeof tokenPositions>();
    tokenPositions.forEach(pos => {
      const key = `p${pos.pIndex}-s${pos.sIndex}`;
      if (!sentenceGroups.has(key)) {
        sentenceGroups.set(key, []);
      }
      sentenceGroups.get(key)!.push(pos);
    });

    // Create a range for each sentence group
    const newRanges = Array.from(sentenceGroups.entries()).map(([, positions]) => {
      const first = positions[0];
      const last = positions[positions.length - 1];
      return {
        pIndex: first.pIndex,
        sIndex: first.sIndex,
        startTokenIndex: first.tokenIndex,
        endTokenIndex: last.tokenIndex
      };
    });

// Handle Ctrl for underline phrases (connect with dashed line)
    if (e.ctrlKey || e.metaKey) {
      // If there are existing purple ranges, create underline from last purple to current selection
      if (phraseMarkedRanges.length > 0 && newRanges.length > 0) {
        const lastPurple = phraseMarkedRanges[phraseMarkedRanges.length - 1];
        const firstNew = newRanges[0];

        // Check if they're in the same sentence
        if (lastPurple.pIndex === firstNew.pIndex && lastPurple.sIndex === firstNew.sIndex) {
          const colors = ['red', 'orange', 'amber', 'emerald', 'cyan', 'blue', 'purple', 'pink'];
          const randomColor = colors[Math.floor(Math.random() * colors.length)];
          const underlineRange = {
            pIndex: lastPurple.pIndex,
            sIndex: lastPurple.sIndex,
            startTokenIndex: Math.min(lastPurple.startTokenIndex, firstNew.startTokenIndex),
            endTokenIndex: Math.max(lastPurple.endTokenIndex, firstNew.endTokenIndex),
            color: randomColor
          };
          setUnderlinePhraseRanges(prev => [...prev, underlineRange]);
        }
      }
      setPhraseMarkedRanges(prev => [...prev, ...newRanges]);
    } else {
      // Normal selection: just add purple marks without clearing
      setPhraseMarkedRanges(prev => [...prev, ...newRanges]);
    }

    selection.removeAllRanges();
  };

  // Handle annotate: generate IPA and Chinese for marked words
  const handleAnnotate = async (silent = false) => {
    if (!currentDocument || (markedWords.size === 0 && phraseMarkedRanges.length === 0)) {
      if (!silent) alert('Please mark some words or phrases first');
      return;
    }

    setIsLoadingAnnotation(true);

    // Collect words to annotate with their context
    const wordsToAnnotate: Array<{ word: string; sentence: string }> = [];
    const wordsSet = new Set(Array.from(markedWords).filter(word => !annotations.has(word)));
    
    // Find sentences containing marked words
    if (wordsSet.size > 0) {
      displayParagraphs.forEach((paragraph: ParagraphType) => {
        paragraph.sentences.forEach((sentence: Sentence) => {
          sentence.tokens.forEach((token: Token) => {
            if (token.type === 'word' && wordsSet.has(token.text.toLowerCase())) {
              wordsToAnnotate.push({
                word: token.text.toLowerCase(),
                sentence: sentence.text
              });
              wordsSet.delete(token.text.toLowerCase());
            }
          });
        });
      });
    }

    // Collect phrases to annotate
    const phrasesToAnnotate: Array<{ text: string; pIndex: number; sIndex: number }> = [];
    
    displayParagraphs.forEach((paragraph: ParagraphType, pIndex: number) => {
      paragraph.sentences.forEach((sentence: Sentence, sIndex: number) => {
        const rangesInThisSentence = phraseMarkedRanges.filter(
          range => range.pIndex === pIndex && range.sIndex === sIndex
        );

        rangesInThisSentence.forEach(range => {
          const phraseTokens = sentence.tokens.slice(range.startTokenIndex, range.endTokenIndex + 1);
          const phraseText = phraseTokens
            .map((t: Token) => t.text)
            .join('')
            .trim();

          if (phraseText) {
            phrasesToAnnotate.push({ text: phraseText, pIndex, sIndex });
          }
        });
      });
    });

    if (wordsToAnnotate.length === 0 && phrasesToAnnotate.length === 0) {
      if (!silent) alert('All marked words and phrases are already annotated');
      setIsLoadingAnnotation(false);
      return;
    }

    console.log(`Annotating ${wordsToAnnotate.length} words and ${phrasesToAnnotate.length} phrases...`);
    console.log('Phrases to annotate:', phrasesToAnnotate);
    let completed = 0;
    let failed = 0;
    const newAnnotations: WordAnnotation[] = [];
    const successfullyAnnotated: Array<{type: 'word' | 'phrase', word: string}> = [];

    // Annotate words
    for (const wordItem of wordsToAnnotate) {
      try {
        let annotationWithContext: WordAnnotation;
        
        // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢妶鍥╃厠闂佺粯鍨堕弸鑽ょ礊閺嵮岀唵閻犺櫣灏ㄩ崝鐔兼煛閸℃劕鈧洟濡撮幒鎴僵闁挎繂鎳嶆竟鏇㈡煟鎼淬埄鍟忛柛鐘虫礈閸掓帒鈻庤箛鏇熸闂佸壊鍋呭ú鏍ㄥ劔闂備焦瀵уΛ浣规叏閵堝鍋╅柛蹇氬亹缁♀偓缂佸墽澧楄摫妞ゎ偄锕弻娑⑩€﹂幋婊堝仐闂佺硶鏂侀崑鎾愁渻閵堝棗鍧婇柛瀣尵閻ヮ亞绱掗姀鐘茬濠电偞鍨归弫濠氬春閳ь剚銇勯幒鎴濐仾闁抽攱甯掗妴鎺戭潩椤掍焦鎮欐繛瀛樼矋缁秹濡甸崟顖涙櫆闁芥ê顦藉Λ鍡涙⒑闁偛鑻晶顖炴煕濠靛棝鍙勭€规洘绻堥獮瀣攽閹邦剚顓垮┑鐐差嚟婵挳顢栭崨瀛樺€峰┑鐘叉处閻撳繐鈹戦悩鑼婵＄虎鍠楃换娑㈠醇閻曞倽鈧寧鎱ㄦ繝鍐┿仢鐎规洦鍋婂畷鐔碱敃閻旇渹澹曟繝鐢靛У閼瑰墽绮婚悩缁樼厵闁硅鍔曢悡鎰亜?
        if (annotationMode === 'local' || annotationMode === 'local-first') {
          // 闂傚倸鍊峰ù鍥敋瑜忛幑銏ゅ箛椤旇棄搴婇梺鐟邦嚟婵潧鐣烽弻銉︾厱闁斥晛鍟伴埊鏇㈡煕鎼粹槄鏀婚柕鍥у瀵粙顢曢～顓犳崟闂佽瀛╅懝楣兯囨导鏉懳﹂柛鏇ㄥ灠缁犳娊鏌涢埄鍐︿沪濠㈣娲樼换婵嬫偨闂堟刀娑㈡煕鐎ｎ偅宕岄柟顔筋殜濡啫鈽夊▎蹇旀畼闂佽瀛╃喊宥咁潩閵娾晛鐒垫い鎺嗗亾缂佺姴绉瑰畷鏇㈡焼瀹ュ懐鐤囬柟鍏肩暘閸斿瞼绮婚弽褋鈧帒顫濋敐鍛闂備礁鎼惌澶屾閺囩喓顩烽柨鏃傚亾鐎氭岸鏌熺紒妯虹瑨鐞氭艾鈹?
          const localResult = await localDictionary.lookup(wordItem.word);
          
          if (localResult) {
            // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢敂钘変罕濠电姴锕ら悧鍡欑矆閸喓绠鹃柛鈩冾殜閻涙粓鏌ら弶鎸庡仴闁诡喗顨婂Λ鍐ㄢ槈濞嗗繑娈橀梺璇插绾板秴顫濋妸鈺佺劦妞ゆ巻鍋撶紒鐘茬Ч瀹曟洟鏌嗗鍛枃闁瑰吋鐣崝宀€绮婚弽褋鈧帒顫濋敐鍛闂備礁鎼惉濂稿窗閺嵮呮殾鐟滅増甯╅弫鍐煏韫囨洖孝鐞氭﹢姊婚崒娆掑厡缁绢厼鐖煎鎻掆槈閵忕姴鐝樺銈嗗笒閸婂鎯?
            console.log(`[Local Dict] Found "${wordItem.word}"`);
            annotationWithContext = {
              ...localResult,
              sentence: wordItem.sentence,
              documentTitle: currentDocument.title
            };
            console.log('[Local Dict] Annotation data:', annotationWithContext);
            if (shouldDebugWord(wordItem.word, annotationWithContext.baseForm, annotationWithContext.word)) {
              logWordDebug('App.annotateWords:local-result', {
                surfaceWord: wordItem.word,
                annotationMode,
                annotationWithContext,
              });
            }
          } else if (annotationMode === 'local-first') {
            // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢敂钘変罕濠电姴锕ら悧鍡欑矆閸喓绠鹃柛鈩冾殜閻涙粓鏌ら弶鎸庡仴闁哄备鍓濆鍕偓锝庝簽娴滃爼姊洪崫鍕効缂佺姵鎹囧璇差吋婢跺﹦鍘告繛杈剧到閹测€斥枔椤撶儐娓婚柕鍫濆暙閸旀粎绱掔拠鑼ⅵ鐎殿喛顕ч埥澶愬閻樻鍞洪梻浣烘嚀閻°劎鎹㈤崟顖涘剮閹艰揪绲跨壕钘壝归敐鍕煓闁告繆娅ｇ槐鎺旀嫚閹绘帗娈诲Δ鐘靛仜缁绘ê鐣烽妸鈺婃晬婵炴垶顭囬敍蹇涙⒒娓氣偓濞佳団€﹂銏♀挃闁告洦鍋€閺?AI
            console.log(`[Local Dict] Not found "${wordItem.word}", falling back to AI`);
            const result = await annotateWord(wordItem.word, level, wordItem.sentence);
            if (!result.success || !result.data) {
              failed++;
              console.error(`Failed to annotate "${wordItem.word}":`, result.error);
              continue;
            }
            annotationWithContext = {
              ...result.data,
              sentence: wordItem.sentence,
              documentTitle: currentDocument.title
            };
            if (shouldDebugWord(wordItem.word, annotationWithContext.baseForm, annotationWithContext.word)) {
              logWordDebug('App.annotateWords:ai-fallback-result', {
                surfaceWord: wordItem.word,
                annotationMode,
                annotationWithContext,
              });
            }
          } else {
            // annotationMode === 'local' 婵犵數濮烽弫鎼佸磻閻愬搫鍨傞柛顐ｆ礀缁犱即鎮归崶褎鈻曟繛鍏肩墵閺岋綁鎮㈠畡鎵泿闂佸吋婢橀悘婵嬫箒闂佺绻愰崥瀣礊閹达附鐓欓柣鐔稿閸╋綁鏌″畝瀣埌閾绘牠鏌嶈閸撶喖骞冭缁犳盯骞欓崘鈺冪▉濠德板€х徊浠嬪疮椤栫偞鍋傛繛鍡樻尰閻撴洘銇勯鐔风仴濞存粍绮撻弻娑㈠棘鐠囨祴鍋撳┑瀣摕婵炴垯鍨归悡娑樏归敐鍫燁仩闁告棏鍨跺鐑樻姜閹殿噮妲紓浣割槹閹告娊骞冮幆褉鏀介悗锝庝簽椤︺劌顪冮妶鍛閻庢凹鍓氶幈銊╁即閵忊檧鎷?
            failed++;
            console.warn(`[Local Dict] Word "${wordItem.word}" not in dictionary, skipping (local-only mode)`);
            continue;
          }
        } else {
          // annotationMode === 'ai'闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熸潏楣冩闁稿孩妫冮弻锝夊箻瀹曞洨妲忓┑鐐叉▕娴滄粓鏌ㄩ妶鍡曠箚闁靛牆鍊告禍鍓х磽娴ｅ搫校濠电偛锕濠氬即閻旈绐為梺鍓插亝缁洪箖宕戦幘璇插嵆闁靛繒濮烽崢娲椤愩垺澶勭紒瀣浮閹?AI
          const result = await annotateWord(wordItem.word, level, wordItem.sentence);
          if (!result.success || !result.data) {
            failed++;
            console.error(`Failed to annotate "${wordItem.word}":`, result.error);
            continue;
          }
          annotationWithContext = {
            ...result.data,
            sentence: wordItem.sentence,
            documentTitle: currentDocument.title
          };
          if (shouldDebugWord(wordItem.word, annotationWithContext.baseForm, annotationWithContext.word)) {
            logWordDebug('App.annotateWords:ai-result', {
              surfaceWord: wordItem.word,
              annotationMode,
              annotationWithContext,
            });
          }
        }
        
        // 婵犵數濮烽弫鎼佸磿閹寸姴绶ら柦妯侯棦濞差亝鏅滈柣鎰靛墮鎼村﹪姊虹粙璺ㄧ伇闁稿鍋ゅ畷鎴﹀Χ婢跺鍘繝鐢靛仧閸嬫挸鈻嶉崨瀛樼厱闁硅埇鍔屾禍楣冩⒒閸屾瑧鍔嶉柟顔肩埣瀹曟洟顢涢悙鑼槷閻庡箍鍎遍ˇ顖毿?
        const canonicalWord = normalizeWordFormValue(wordItem.word);
        const wordCardIdentity = getWordCardIdentity({
          ...annotationWithContext,
          word: canonicalWord,
        }, wordItem.word);
        const existingAnnotation = annotations.get(wordCardIdentity);
        const cachedAt = Date.now();
        const mergedAnnotation = mergeAnnotationMeanings(existingAnnotation as WordAnnotation | undefined, {
          ...annotationWithContext,
          word: canonicalWord,
          cardKey: wordCardIdentity,
          encounteredForms: buildEncounteredForms(wordItem.word, {
            ...annotationWithContext,
            word: canonicalWord,
          }, existingAnnotation?.encounteredForms || []),
          cachedAt,
        }).annotation;

        if (shouldDebugWord(wordItem.word, canonicalWord, mergedAnnotation.baseForm, mergedAnnotation.word)) {
          logWordDebug('App.annotateWords:canonicalized', {
            surfaceWord: wordItem.word,
            canonicalWord,
            existingAnnotation: existingAnnotation || null,
            mergedAnnotation,
          });
        }
        addAnnotation(wordCardIdentity, mergedAnnotation);
        await cacheAnnotation(wordCardIdentity, mergedAnnotation);
        
        // 闂傚倸鍊峰ù鍥х暦閸偅鍙忕€规洖娲﹂浠嬫煏閸繃澶勬い顐ｆ礋閺岋繝宕堕妷銉т痪闂佺顑傞弲娑㈠煘閹达附鍋愰柧蹇ｅ亞濞堛倝鎮楃憴鍕矮缂佽埖宀稿濠氭晸閻樻煡鍞堕梺闈涚箚閸撴繂袙閸曨厾纾藉ù锝呮惈灏忕紓渚囧枟閻熲晠鐛崘銊庢棃鍩€椤掑嫬鐓″璺号堥弸搴㈢箾閸℃ê鍧婇柛瀣尵閹瑰嫰濡歌閿涙粌顪冮妶鍡樼闁瑰啿閰ｉ幃姗€鏁愭径瀣幍?emoji
        const defaultEmoji = getWordEmoji(mergedAnnotation);
        await updateEmoji(wordCardIdentity, defaultEmoji, (updates) => {
          updateAnnotation(wordCardIdentity, updates);
        });
        console.log(`[App] Saved default emoji for "${wordItem.word}": ${defaultEmoji}`);
        
        // 濠电姷鏁告慨鐑藉极閹间礁纾块柟瀵稿Х缁€濠囨煃瑜滈崜姘跺Φ閸曨垰鍗抽柛鈩冾殔椤忣亪鏌涘▎蹇曠闁哄矉缍侀獮鍥敆娴ｇ懓鍓电紓鍌欒閸嬫捇鏌涢埄鍐姇闁绘挻绋戦…璺ㄦ崉閻氭潙濮涙繛瀵稿О閸ㄤ粙寮诲☉婊庢Щ闂佹寧娲︽禍顏勵嚕鐠囨祴妲堟俊顖炴敱閻庡姊洪崷顓炲妺闁搞劌銈稿顐﹀垂椤曞懏瀵岄梺闈涚墕濡瑩鎮￠妷锔剧婵炴潙顑嗗▍濠傗攽閿涘嫭鏆鐐叉喘瀵爼宕归鑲┿偖濠碉紕鍋戦崐鏇犳崲閹邦儵娑樷槈閳跺搫娲崺锟犲川椤旇瀚肩紓浣鸿檸閸樺ジ骞婃惔銊﹀亗闁规壆澧楅悡銉︽叏濡潡鍝洪柛鐘冲姍閺岋絽螖閳ь剟鎮ф繝鍥佸宕奸妷锔惧幍濡炪倖妫侀～澶娾枍婵犲洦鐓欓柧蹇ｅ亞閻矂鏌涢悩璇у伐閾伙綁寮堕悙瀛樼凡妞ゃ儲鑹鹃埞鎴︽倷鐎涙ê闉嶉梺鐓庣秺缁犳牠寮崘顔芥櫆闁告挆鍛姸?
        addToCardHistory('word', wordCardIdentity);
        
        newAnnotations.push(mergedAnnotation);
        successfullyAnnotated.push({ type: 'word', word: wordItem.word });
        completed++;
        
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        failed++;
        console.error(`Failed to annotate "${wordItem.word}":`, error);
      }
    }

    // Annotate phrases
    for (const phrase of phrasesToAnnotate) {
      try {
        // Get the full sentence text for context
        const sentenceText = displayParagraphs[phrase.pIndex].sentences[phrase.sIndex].text;
        
        console.log(`Annotating phrase: "${phrase.text}" in sentence: "${sentenceText}"`);
        const result = await annotatePhrase(phrase.text, sentenceText, level, 'phrase', phraseCardProvider);
        console.log('Phrase annotation result:', result);
        
        if (result.success && result.data) {
          const cachedAt = Date.now();
          const phraseData = {
            ...result.data,
            cardType: 'phrase' as const,
            documentTitle: currentDocument.title,  // 濠电姷鏁告慨鐑藉极閹间礁纾块柟瀵稿Х缁€濠囨煃瑜滈崜姘跺Φ閸曨垰鍗抽柛鈩冾殔椤忣亪鏌涘▎蹇曠闁哄矉缍侀獮鍥敆娴ｇ懓鍓垫繝纰樻閸嬪懘鏁冮姀銈呰摕婵炴垯鍨瑰敮闂侀潧绻嗛崜婵嬫偟閺嶎厽鍋℃繝濠傚缁跺弶绻涚涵椋庣瘈鐎殿喖顭烽崹楣冨箛娴ｅ憡鍊梻浣告啞娓氭宕伴弽顓炲嚑闁绘ê妯婂〒?
            cachedAt,
          };
          
          // Save to state
          setPhraseAnnotations(prev => new Map(prev).set(phrase.text.toLowerCase(), phraseData));
          
          // Save to IndexedDB
          await cachePhraseAnnotation(phrase.text, phraseData);
          
          // Find the range for this phrase and mark as annotated
          const rangeIndex = phraseMarkedRanges.findIndex(r => 
            r.pIndex === phrase.pIndex && 
            r.sIndex === phrase.sIndex &&
            displayParagraphs[r.pIndex].sentences[r.sIndex].tokens
              .slice(r.startTokenIndex, r.endTokenIndex + 1)
              .map((t: Token) => t.text)
              .join('')
              .trim()
              .toLowerCase() === phrase.text.toLowerCase()
          );
          
          if (rangeIndex !== -1) {
            const range = phraseMarkedRanges[rangeIndex];
            setAnnotatedPhraseRanges(prev => [...prev, { ...range, phrase: phrase.text.toLowerCase() }]);
          }
          
          // 濠电姷鏁告慨鐑藉极閹间礁纾块柟瀵稿Х缁€濠囨煃瑜滈崜姘跺Φ閸曨垰鍗抽柛鈩冾殔椤忣亪鏌涘▎蹇曠闁哄矉缍侀獮鍥敆娴ｇ懓鍓电紓鍌欒閸嬫捇鏌涢埄鍐姇闁绘挻绋戦…璺ㄦ崉閻氭潙濮涙繛瀵稿О閸ㄤ粙寮诲☉婊庢Щ闂佹寧娲︽禍顏勵嚕鐠囨祴妲堟俊顖炴敱閻庡姊洪崷顓炲妺闁搞劌銈稿顐﹀垂椤曞懏瀵岄梺闈涚墕濡瑩鎮￠妷锔剧婵炴潙顑嗗▍濠傗攽閿涘嫭鏆鐐叉喘瀵爼宕归鑲┿偖濠碉紕鍋戦崐鏇犳崲閹邦儵娑樷槈閳跺搫娲、娆撴偩瀹€鈧鏇㈡煛婢跺﹦澧曞褌绮欏畷姘舵偋閸粎绠氬銈嗗姧缁查箖鍩涢幒鏃傜＜妞ゆ洖鎳庨獮妤冣偓鍨緲鐎氫即鐛崶顒夋晣闁绘劕顕弶鐟扳攽閿涘嫬浜奸柛濠冩礈閹广垽骞囬鐟颁壕婵鍘ф晶鍙夈亜閵堝懎顏慨濠呮閹风娀鎳犻鍌ゅ敽闂備胶顭堥鍥磻濞戞艾寮查梻浣告惈缁嬩線宕戦崨杈剧稏?
          addToCardHistory('phrase', phrase.text);
          successfullyAnnotated.push({ type: 'phrase', word: phrase.text });
          completed++;
        } else {
          failed++;
          console.error(`Failed to annotate phrase "${phrase.text}":`, result.error);
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        failed++;
        console.error(`Failed to annotate phrase "${phrase.text}":`, error);
      }
    }

    setIsLoadingAnnotation(false);
    
    // Clear the marked ranges after successful annotation
    if (completed > 0) {
      setPhraseMarkedRanges([]);
      
      // Update today's annotation count and word list
      const today = new Date().toDateString();
      setTodayAnnotations(prev => {
        if (prev.date === today) {
          return { 
            date: today, 
            count: prev.count + completed,
            words: [...prev.words, ...successfullyAnnotated]
          };
        } else {
          // New day, reset count and list
          return { 
            date: today, 
            count: completed,
            words: successfullyAnnotated
          };
        }
      });
    }
    
    // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐蹭画濡炪倖鐗楃粙鎾汇€呴崣澶岀瘈濠电姴鍊搁弸锕傛煠閻楀牆顕滈柕鍥у缁犳盯骞樼捄渚澑婵＄偑鍊戦崕閬嶆偋閹捐钃熼柨婵嗩槸缁犳稒銇勯弮鍌氬付濠碉紕鍎ゆ穱濠囧Χ閸♀晜顓归梺鎼炲妺閸楁娊鏁愰悙鍙傛棃鍩€椤掑嫬鐓″璺号堥弸宥夋煣韫囷絽浜滈柣蹇涗憾閺屾盯鎮ゆ担鍝ヤ桓闂佽鍠楅〃鍛村煝閹捐鍨傛い鏃傛櫕娴滎亞绱撻崒娆愮グ妞ゆ泦鍥舵晞闁搞儮鏅涢崹婵囥亜閹惧崬鐏╃€瑰憡绻堥弻鈩冨緞鐎ｎ亞浠撮悗娈垮枤閸忔ê顫忓ú顏勫窛濠电姴鍟惁閿嬬箾鏉堝墽绉い銉︽尰閵囨瑩骞庨懞銉㈡嫽婵炶揪绲介幉锛勬嫻閿涘嫮纾兼い鏇炴噹閻忥妇鈧娲樼换鍌濈亙闂佸憡渚楅崢?
    if (!silent) {
      alert(`Annotation complete!\nWords: ${wordsToAnnotate.length}\nPhrases: ${phrasesToAnnotate.length}\nSuccess: ${completed}\nFailed: ${failed}`);
    }
  };

// Handle mark word as known (toggle learnt status)
  const handleMarkKnown = async (word: string) => {
    try {
      const normalized = word.toLowerCase();
      const isCurrentlyLearnt = learntWords.has(normalized);
      
      if (isCurrentlyLearnt) {
        // Remove from learntWords (unmark as known)
        removeLearntWord(normalized);
        await removeLearntWordFromDB(normalized);
        console.log(`Unmarked "${word}" as learnt`);
      } else {
        // Add to learntWords (mark as known)
        addLearntWord(normalized);
        await addLearntWordToDB(normalized);
        console.log(`Marked "${word}" as learnt`);
      }
    } catch (error) {
      console.error('Failed to toggle learnt status:', error);
    }
  };
  
  // Handle toggle phrase translation insert
  const handleTogglePhraseInsert = (phrase: string) => {
    const phraseLower = phrase.toLowerCase();
    setPhraseTranslationInserts(prev => {
      const newMap = new Map(prev);
      const currentState = newMap.get(phraseLower) || false;
      newMap.set(phraseLower, !currentState);
      return newMap;
    });
  };
  
  // Handle phrase click (double-click on annotated phrase to show card)
  const handlePhraseClick = (phrase: string) => {
    const phraseLower = phrase.toLowerCase();
    const annotation = phraseAnnotations.get(phraseLower);
    if (annotation) {
      // 濠电姷鏁告慨鐑藉极閹间礁纾块柟瀵稿Х缁€濠囨煃瑜滈崜姘跺Φ閸曨垰鍗抽柛鈩冾殔椤忣亪鏌涘▎蹇曠闁哄矉缍侀獮鍥敆娴ｇ懓鍓电紓鍌欒閸嬫捇鏌涢埄鍐姇闁绘挻绋戦…璺ㄦ崉閻氭潙濮涙繛瀵稿О閸ㄤ粙寮诲☉婊庢Щ闂佹寧娲︽禍顏勵嚕鐠囨祴妲堟俊顖炴敱閻庡姊洪崷顓炲妺闁搞劌銈稿顐﹀垂椤曞懏瀵岄梺闈涚墕濡瑩鎮￠妷锔剧婵炴潙顑嗗▍濠傗攽閿涘嫭鏆鐐叉喘瀵爼宕归鑲┿偖濠碉紕鍋戦崐鏇犳崲閹邦儵娑樷槈閳跺搫娲、娆撴偩瀹€鈧鏇㈡煛婢跺﹦澧曞褌绮欏畷姘舵偋閸粎绠氬銈嗗姧缁查箖鍩涢幒鏃傜＜妞ゆ洖鎳庨獮妤冣偓鍨緲鐎氫即鐛崶顒夋晣闁绘劕顕弶鐟扳攽閿涘嫬浜奸柛濠冩礈閹广垽骞囬鐟颁壕婵鍘ф晶鍙夈亜閵堝懎顏慨濠呮閹风娀鎳犻鍌ゅ敽闂備胶顭堥鍥磻濞戞艾寮查梻浣告惈缁嬩線宕戦崨杈剧稏?
      addToCardHistory(annotation.cardType || 'phrase', phrase);
    }
  };

  const handleSentenceCardClick = (sentenceText: string) => {
    const sentenceKey = sentenceText.toLowerCase();
    const annotation = phraseAnnotations.get(sentenceKey);
    if (!annotation || (annotation.cardType || 'phrase') !== 'sentence') {
      return;
    }

    addToCardHistory('sentence', annotation.phrase || sentenceText);
    closeCard(`sentence-${sentenceKey}`);
  };
  
  // Handle context menu (right-click to add bookmark)
  const handleContextMenu = (
    e: React.MouseEvent,
    pIndex: number,
    sIndex: number,
    sentenceText?: string,
    focusWords?: string[],
  ) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, pIndex, sIndex, sentenceText, focusWords });
  };

  const getAllSentenceLocations = () => {
    const allSentences: { paragraphIndex: number; sentenceIndex: number; text: string; sentence: Sentence }[] = [];
    displayParagraphs.forEach((para: ParagraphType, pIdx: number) => {
      para.sentences.forEach((sent: Sentence, sIdx: number) => {
        allSentences.push({
          paragraphIndex: pIdx,
          sentenceIndex: sIdx,
          text: sent.text,
          sentence: sent,
        });
      });
    });
    return allSentences;
  };

  const getGlobalSentenceIndex = (paragraphIndex: number, sentenceIndex: number) => {
    let index = 0;
    for (let i = 0; i < paragraphIndex; i++) {
      index += displayParagraphs[i]?.sentences.length || 0;
    }
    return index + sentenceIndex;
  };

  const getCurrentSentenceLocation = () => {
    const allSentences = getAllSentenceLocations();
    if (currentSentenceIndex === null) return allSentences[0] || null;
    return allSentences[currentSentenceIndex] || null;
  };

  const createTextCard = async (
    cardType: Exclude<LearningCardType, 'word'>,
    text: string,
    context: string,
    options?: {
      provider?: 'openai' | 'local';
      focusWords?: string[];
    }
  ) => {
    if (!currentDocument || !text.trim()) return;

    const resolvedProvider = options?.provider
      || (cardType === 'sentence' ? sentenceCardProvider : phraseCardProvider);

    setIsLoadingAnnotation(true);
    try {
      const result = await annotatePhrase(
        text.trim(),
        context.trim() || text.trim(),
        level,
        cardType,
        resolvedProvider,
        options?.focusWords,
      );
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to create card');
      }

      const cardData: PhraseAnnotation = {
        ...result.data,
        phrase: result.data.phrase || text.trim(),
        cardType,
        sentenceContext: result.data.sentenceContext || context || text,
        documentTitle: currentDocument.title,
        cachedAt: Date.now(),
      };
      const cardKey = cardData.phrase.toLowerCase();
      setPhraseAnnotations(prev => new Map(prev).set(cardKey, cardData));
      await cachePhraseAnnotation(cardData.phrase, cardData);
      addToCardHistory(cardType, cardData.phrase);

      if (cardType !== 'sentence' && cardData.grammarPoints && cardData.grammarPoints.length > 0) {
        for (const point of cardData.grammarPoints) {
          if (!point.text.trim()) continue;
          const grammarData: PhraseAnnotation = {
            phrase: point.text.trim(),
            cardType: 'grammar',
            chinese: point.explanation,
            explanation: point.explanation,
            sentenceContext: cardData.sentenceContext,
            documentTitle: currentDocument.title,
            cachedAt: Date.now(),
          };
          setPhraseAnnotations(prev => new Map(prev).set(grammarData.phrase.toLowerCase(), grammarData));
          await cachePhraseAnnotation(grammarData.phrase, grammarData);
          addToCardHistory('grammar', grammarData.phrase);
        }
      }

      setVoiceStatus(`${cardType} card created`);
    } catch (error: any) {
      console.error('[Card Create] Failed:', error);
      setVoiceStatus(error?.message || 'Card creation failed');
    } finally {
      setIsLoadingAnnotation(false);
    }
  };

  const markCurrentWordFromVoice = () => {
    const location = getCurrentSentenceLocation();
    if (!location) {
      setVoiceStatus('No current sentence');
      return;
    }

    const wordTokens = location.sentence.tokens.filter((token: Token) => token.type === 'word');
    const token = wordTokens[Math.max(0, currentWordIndex)] || wordTokens[0];
    if (!token) {
      setVoiceStatus('No current word');
      return;
    }

    setMarkedWords(prev => new Set(prev).add(token.text.toLowerCase()));
    setVoiceStatus(`Marked word: ${token.text}`);
    window.setTimeout(() => {
      void handleAnnotate(true);
    }, 0);
  };

  const createCurrentSentenceCard = () => {
    const location = getCurrentSentenceLocation();
    if (!location) {
      setVoiceStatus('No current sentence');
      return;
    }
    const focusWords = Array.from(
      new Set(
        location.sentence.tokens
          .filter((token: Token) => token.type === 'word')
          .map((token: Token) => token.text.toLowerCase())
          .filter((word: string) => markedWords.has(word)),
      ),
    );
    void createTextCard('sentence', location.text, location.text, {
      provider: sentenceCardProvider,
      focusWords,
    });
  };

  const handleVoiceCommand = (rawCommand: string) => {
    const command = rawCommand.replace(/\s+/g, '').toLowerCase();
    setVoiceStatus(rawCommand);

    if (command.includes('不懂') || command.includes("idon'tunderstand") || command.includes('unknown')) {
      markCurrentWordFromVoice();
      return;
    }

    if (command.includes('这句什么意思') || command.includes('這句什麼意思') || command.includes('sentence')) {
      createCurrentSentenceCard();
      return;
    }

    if (command.includes('暂停') || command.includes('停')) {
      handleStopReading();
      return;
    }

    if (command.includes('继续') || command.includes('开始') || command.includes('朗读')) {
      handlePlayPause();
      return;
    }

    if (command.includes('下一句')) {
      handleNextSentence();
      return;
    }

    if (command.includes('上一句')) {
      handlePrevSentence();
      return;
    }

    setVoiceStatus(`Unrecognized: ${rawCommand}`);
  };

  const toggleVoiceCommands = () => {
    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      alert('Speech recognition is not supported in this browser.');
      return;
    }

    if (isVoiceListening) {
      voiceRecognitionRef.current?.stop();
      setIsVoiceListening(false);
      setVoiceStatus('Voice off');
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event: any) => {
      const lastResult = event.results[event.results.length - 1];
      const transcript = lastResult?.[0]?.transcript?.trim();
      if (transcript) handleVoiceCommand(transcript);
    };
    recognition.onend = () => {
      setIsVoiceListening(false);
      setVoiceStatus('Voice off');
    };
    recognition.onerror = () => setVoiceStatus('Voice recognition error');
    voiceRecognitionRef.current = recognition;
    setIsVoiceListening(true);
    setVoiceStatus('Listening');
    recognition.start();
  };

  useEffect(() => {
    if (!currentDocument || resumedDocumentRef.current === currentDocument.id) return;
    resumedDocumentRef.current = currentDocument.id;
    if (!autoResumeOnOpen) return;

    const bookmark = getLatestBookmark(currentDocument.id);
    if (!bookmark) return;

    if (currentDocument.type === 'epub' && bookmark.chapterId && bookmark.chapterId !== currentDocument.currentChapterId) {
      setCurrentChapter(bookmark.chapterId);
    }

    const sentenceIndex = getGlobalSentenceIndex(bookmark.paragraphIndex, bookmark.sentenceIndex);
    setCurrentSentenceIndex(sentenceIndex);

    window.setTimeout(() => {
      const element = document.querySelector(`[data-paragraph-index="${bookmark.paragraphIndex}"]`);
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (autoReadOnOpen) {
        speakFromSentence(sentenceIndex);
      }
    }, 250);
  }, [currentDocument, autoResumeOnOpen, autoReadOnOpen]);

  useEffect(() => {
    if (!currentDocument || !autoStartTime) return;

    const timer = window.setInterval(() => {
      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const currentDate = now.toDateString();
      if (currentTime !== autoStartTime || autoStartDateRef.current === currentDate) return;

      autoStartDateRef.current = currentDate;
      setViewMode('read');
      const bookmark = getLatestBookmark(currentDocument.id);
      const startIndex = bookmark
        ? getGlobalSentenceIndex(bookmark.paragraphIndex, bookmark.sentenceIndex)
        : currentSentenceIndex ?? 0;
      setCurrentSentenceIndex(startIndex);
      speakFromSentence(startIndex);
    }, 30000);

    return () => window.clearInterval(timer);
  }, [currentDocument, autoStartTime, currentSentenceIndex]);
  
  // AI 闂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏇氶檷娴滃綊鏌涢幇鍏哥敖闁活厽鎹囬弻锝夊閵忊晝鍔搁梺钘夊暟閸犲酣鍩為幋锔藉亹闁告瑥顦ˇ鈺呮⒑缁嬫鍎嶉柛鏃€鍨垮濠氭晲婢跺﹦鐫勯梺绋胯閸婃宕濋幖浣光拺閻犲洩灏欑粻鐗堢箾瀹割喖寮鐐插暙閻ｏ繝骞嶉搹顐も偓璇测攽閻愬弶顥為柛銊ь攰閳敻姊?
  const handleRegenerateAI = async (word: string, sentence: string, type: LearningCardType) => {
    try {
      console.log('[AI Regenerate]', type, ':', word, 'Sentence:', sentence);
      
      if (type === 'word') {
        const result = await annotateWord(word, level, sentence);
        if (result.success && result.data) {
          const surfaceWord = word.toLowerCase();
          const canonicalWord = surfaceWord;
          const regeneratedCardIdentity = getWordCardIdentity({
            ...result.data,
            word: canonicalWord,
          }, surfaceWord);
          const surfaceEntry = findAnnotationEntry(annotations, surfaceWord)?.annotation as WordAnnotation | undefined;
          const canonicalEntry = annotations.get(regeneratedCardIdentity) as WordAnnotation | undefined;
          const existingAnnotation = canonicalEntry || surfaceEntry;
          const annotationWithContext: WordAnnotation = {
            ...result.data,
            word: canonicalWord,
            cardKey: regeneratedCardIdentity,
            sentence,
            documentTitle: currentDocument?.title || 'Unknown',
            wordForms: result.data.wordForms ?? existingAnnotation?.wordForms,
            encounteredForms: buildEncounteredForms(surfaceWord, {
              ...result.data,
              word: canonicalWord,
              encounteredForms: result.data.encounteredForms,
              wordForms: result.data.wordForms ?? existingAnnotation?.wordForms,
            }, existingAnnotation?.encounteredForms || []),
            cachedAt: Date.now(),
          };
          const mergedAnnotation = mergeAnnotationMeanings(
            existingAnnotation,
            annotationWithContext
          ).annotation;
          const normalizedMergedAnnotation: WordAnnotation = {
            ...mergedAnnotation,
            cardKey: regeneratedCardIdentity,
            encounteredForms: buildEncounteredForms(surfaceWord, mergedAnnotation, mergedAnnotation.encounteredForms || []),
          };
          if (shouldDebugWord(surfaceWord, canonicalWord, result.data.baseForm, normalizedMergedAnnotation.baseForm)) {
            logWordDebug('App.handleRegenerateAI:word-result', {
              surfaceWord,
              apiResult: result.data,
              canonicalWord,
              existingAnnotation: existingAnnotation || null,
              normalizedMergedAnnotation,
            });
          }
          addAnnotation(regeneratedCardIdentity, normalizedMergedAnnotation);
          await cacheAnnotation(regeneratedCardIdentity, normalizedMergedAnnotation);
          alert('? AI re-generated successfully!');
        } else {
          console.error('[AI Regenerate] Failed:', result.error);
          alert('? Failed to regenerate: ' + result.error);
        }
      } else {
        const result = await annotatePhrase(
          word,
          sentence,
          level,
          type,
          type === 'sentence' ? sentenceCardProvider : phraseCardProvider,
        );
        if (result.success && result.data) {
          const cachedAt = Date.now();
          const cardData = {
            ...result.data,
            phrase: result.data.phrase || word,
            cardType: type,
            documentTitle: result.data.documentTitle || currentDocument?.title || 'Unknown',
            cachedAt,
          };
          setPhraseAnnotations(prev => {
            const next = new Map(prev);
            next.set(word.toLowerCase(), cardData);
            return next;
          });
          await cachePhraseAnnotation(word, {
            cardType: type,
            chinese: result.data.chinese,
            explanation: result.data.explanation,
            usagePattern: result.data.usagePattern,
            usagePatternChinese: result.data.usagePatternChinese,
            isCommonUsage: result.data.isCommonUsage,
            grammarPoints: result.data.grammarPoints,
            focusWordNotes: result.data.focusWordNotes,
            sentenceContext: result.data.sentenceContext,
            documentTitle: cardData.documentTitle,
          });
          console.log('[AI Regenerate] Success:', result.data);
          alert('? AI re-generated successfully!');
        } else {
          console.error('[AI Regenerate] Failed:', result.error);
          alert('? Failed to regenerate: ' + result.error);
        }
      }
    } catch (error) {
      console.error('[AI Regenerate] Error:', error);
      alert('? Error: ' + error);
    }
  };
  
  // Add bookmark at current position
  const handleAddBookmark = () => {
    if (!contextMenu || !currentDocument) return;
    
    addBookmark(
      currentDocument.id,
      currentDocument.type === 'epub' ? currentDocument.currentChapterId : undefined,
      contextMenu.pIndex,
      contextMenu.sIndex
    );
    
    setContextMenu(null);
    alert('Bookmark added!');
  };

  const handleSentenceTranslateAnalyze = async () => {
    if (!contextMenu?.sentenceText) return;
    const sentenceText = contextMenu.sentenceText;
    const focusWords = contextMenu.focusWords || [];
    setContextMenu(null);
    await createTextCard('sentence', sentenceText, sentenceText, {
      provider: sentenceCardProvider,
      focusWords,
    });
  };
  
  // Jump to latest bookmark
  const handleJumpToBookmark = () => {
    if (!currentDocument) return;
    
    const bookmark = getLatestBookmark(currentDocument.id);
    if (!bookmark) {
      alert('No bookmark found for this document');
      return;
    }
    
    // If EPUB and different chapter, switch chapter first
    if (currentDocument.type === 'epub' && bookmark.chapterId && bookmark.chapterId !== currentDocument.currentChapterId) {
      setCurrentChapter(bookmark.chapterId);
    }
    
    // Scroll to the bookmarked paragraph
    setTimeout(() => {
      const element = document.querySelector(`[data-paragraph-index="${bookmark.paragraphIndex}"]`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        console.log('[Bookmark] Jumped to:', bookmark);
      }
    }, 100);
  };

  // Play (read aloud) from a specific paragraph
  const handlePlayFromParagraph = (startPIndex: number) => {
    if (!currentDocument) return;
    
    // Stop any ongoing speech
    window.speechSynthesis.cancel();
    
    // Get paragraphs to read
    const displayParagraphs = currentDocument.type === 'epub' && currentDocument.currentChapterId && currentDocument.chapters
      ? (currentDocument.chapters.find((c: Chapter) => c.id === currentDocument.currentChapterId)?.paragraphs || [])
      : (currentDocument.paragraphs || []);
    
    if (!displayParagraphs || startPIndex >= displayParagraphs.length) return;
    
    // Calculate the global sentence index from paragraph index
    let sentenceIndex = 0;
    for (let i = 0; i < startPIndex; i++) {
      sentenceIndex += displayParagraphs[i].sentences.length;
    }
    
    // Use the existing speakFromSentence function for consistent behavior
    speakFromSentence(sentenceIndex);
  };
  
  // Stop reading
  const handleStopReading = () => {
    handleStop();
  };

  const annotationBelongsToSampleLemmaTest = (annotation?: WordAnnotation): boolean => {
    if (!annotation) return false;

    if (normalizeDocumentTitle(annotation.documentTitle) === SAMPLE_LEMMA_TEST_TITLE) {
      return true;
    }

    return (annotation.encounteredMeanings || []).some(
      meaning => normalizeDocumentTitle(meaning.documentTitle) === SAMPLE_LEMMA_TEST_TITLE,
    );
  };

  const removeWordCards = async (
    cardKeys: Set<string>,
    options: { markAsKnown: boolean },
  ) => {
    const normalizedCardKeys = Array.from(
      new Set(
        Array.from(cardKeys)
          .map(normalizeWordFormValue)
          .filter(Boolean),
      ),
    );

    const knownForms = new Set<string>();

    for (const cardKey of normalizedCardKeys) {
      const annotation = annotations.get(cardKey) as WordAnnotation | undefined;
      getKnownFormsForAnnotation(annotation).forEach(form => knownForms.add(form));
      removeAnnotation(cardKey);
    }

    for (const cardKey of normalizedCardKeys) {
      await deleteAnnotation(cardKey);
    }

    if (options.markAsKnown) {
      for (const form of knownForms) {
        addKnownWord(form);
        await addKnownWordToDB(form);
      }
    }

    for (const cardKey of normalizedCardKeys) {
      closeCard(`word-${cardKey}`);
      removeFromCardHistory(cardKey);
    }

    if (selectedWord && normalizedCardKeys.includes(selectedWord.toLowerCase())) {
      setSelectedWord(null);
    }
  };

  // Handle delete from cards
  const handleDeleteFromCards = async (word: string) => {
    try {
      const directAnnotation = annotations.get(word.toLowerCase()) as WordAnnotation | undefined;
      const entry = directAnnotation
        ? { key: word.toLowerCase(), annotation: directAnnotation }
        : findAnnotationEntry(annotations, word.toLowerCase());
      const annotation = entry?.annotation as WordAnnotation | undefined;
      const surfaceWord = word.toLowerCase();
      const cardIdentity = annotation ? getWordCardIdentity(annotation) : surfaceWord;
      await removeWordCards(new Set<string>([cardIdentity]), { markAsKnown: true });

      console.log(`Deleted word card: ${cardIdentity}`);
    } catch (error) {
      console.error('Failed to delete from cards:', error);
    }
  };

  const handleDeleteSampleLemmaTestCards = async () => {
    try {
      const cachedAnnotations = await getAllCachedAnnotations();
      const sampleCardKeys = new Set<string>();

      for (const [key, annotation] of annotations.entries()) {
        if (!annotationBelongsToSampleLemmaTest(annotation)) {
          continue;
        }

        sampleCardKeys.add(getWordCardIdentity({
          ...annotation,
          cardKey: annotation.cardKey || key,
        }));
      }

      for (const annotation of cachedAnnotations) {
        if (!annotationBelongsToSampleLemmaTest(annotation as WordAnnotation)) {
          continue;
        }

        sampleCardKeys.add(getWordCardIdentity(annotation));
      }

      if (sampleCardKeys.size === 0) {
        alert('No word cards found from "Sample Lemma Test".');
        return;
      }

      await removeWordCards(sampleCardKeys, { markAsKnown: false });

      alert(`Deleted ${sampleCardKeys.size} Sample Lemma Test word cards.`);
    } catch (error) {
      console.error('Failed to delete Sample Lemma Test cards:', error);
      alert('Failed to delete Sample Lemma Test word cards.');
    }
  };

  const handleDeletePhraseFromCards = async (phrase: string) => {
    const normalized = phrase.toLowerCase();
    const cardType = phraseAnnotations.get(normalized)?.cardType || 'phrase';
    setPhraseAnnotations(prev => {
      const next = new Map(prev);
      next.delete(normalized);
      return next;
    });
    closeCard(`${cardType}-${normalized}`);
    setAnnotatedPhraseRanges(prev => prev.filter(r => r.phrase !== normalized));
    await deletePhraseAnnotation(phrase);
    removeFromCardHistory(phrase);
  };

  const handleClearReviewCards = () => {
    if (reviewVisibleCards.length === 0 && !reviewSelectedBucketKey) return;

    setExpandedCardKeys(new Set());
    setReviewSelectedBucketKey(null);
  };

  // Handle export known words (TXT format)
  const handleExportKnownWords = async () => {
    try {
      const allKnownWords = await getAllKnownWords();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const exportDate = new Date().toLocaleDateString('zh-CN');
      const filename = `lexiland-known-words-${timestamp}.txt`;

      // Sort words alphabetically
      const sortedWords = allKnownWords.sort((a, b) => a.localeCompare(b));

      // Create TXT content
      const txtContent = `Export Date: ${exportDate}
Known: ${sortedWords.length}

Known Words:
${sortedWords.join(' ')}
`;

      const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      console.log('Known words exported:', filename);
      alert(`Known words exported successfully!\n${sortedWords.length} words\nFilename: ${filename}`);
    } catch (error) {
      console.error('Export known words failed:', error);
      alert('Export failed, please try again');
    }
  };

  const handleExportBook = async (formatOverride?: 'epub' | 'pdf') => {
    if (!currentDocument) {
      alert('Please open a document before exporting.');
      return;
    }

    const targetFormat = formatOverride || exportFormat;
    const pdfWindow = targetFormat === 'pdf'
      ? window.open('', '_blank', 'noopener,noreferrer')
      : null;

    if (targetFormat === 'pdf' && !pdfWindow) {
      alert('PDF export was blocked by the browser. Please allow popups and try again.');
      return;
    }

    if (pdfWindow) {
      pdfWindow.document.write('<!DOCTYPE html><title>Preparing PDF...</title><body style="font-family: sans-serif; padding: 24px;">Preparing PDF export...</body>');
      pdfWindow.document.close();
    }

    try {
      await exportAnnotatedBook(
        currentDocument,
        annotations,
        phraseAnnotations,
        phraseTranslationInserts,
        {
          format: targetFormat,
          includeIPA: exportIncludeIPA,
          includeChinese: exportIncludeChinese,
          includePhraseList: exportIncludePhraseList,
          includePhraseTranslations: exportIncludePhraseTranslations,
        },
        pdfWindow,
      );

      if (targetFormat === 'pdf') {
        alert('Print dialog opened. Choose "Save as PDF" to finish exporting.');
      }
    } catch (error) {
      pdfWindow?.close();
      console.error('Export book failed:', error);
      alert(`Book export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Handle finish document - mark all unannotated words as known
  const handleFinishDocument = async () => {
    if (!currentDocument) return;

    try {
      // First, collect all words from the document
      const allWords = new Set<string>();
      displayParagraphs.forEach((paragraph: ParagraphType) => {
        paragraph.sentences.forEach((sentence: Sentence) => {
          sentence.tokens.forEach((token: Token) => {
            if (token.type === 'word' && token.text.length > 1) {
              allWords.add(token.text.toLowerCase());
            }
          });
        });
      });

      // Collect words that will be added (not already known and not annotated)
      const wordsToAdd: string[] = [];
      for (const word of allWords) {
        if (!knownWords.has(word) && !findAnnotationEntry(annotations, word)) {
          wordsToAdd.push(word);
        }
      }

      // Check if there's a next chapter BEFORE showing any confirmation
      let hasNextChapter = false;
      let nextChapter = null;
      
      if (currentDocument.type === 'epub' && currentDocument.chapters && currentDocument.currentChapterId) {
        console.log('[Finish] Document type: epub, checking chapters');
        console.log('[Finish] Current chapter ID:', currentDocument.currentChapterId);
        console.log('[Finish] Total chapters:', currentDocument.chapters.length);
        
        const currentChapterIndex = currentDocument.chapters.findIndex(
          (c: Chapter) => c.id === currentDocument.currentChapterId
        );
        console.log('[Finish] Current chapter index:', currentChapterIndex);
        
        if (currentChapterIndex !== -1 && currentChapterIndex < currentDocument.chapters.length - 1) {
          hasNextChapter = true;
          nextChapter = currentDocument.chapters[currentChapterIndex + 1];
          console.log('[Finish] Next chapter exists:', nextChapter.title);
        }
      }

      // If no words to add and has next chapter, go directly to next chapter
      if (wordsToAdd.length === 0 && hasNextChapter && nextChapter) {
        console.log('[Finish] No new words, moving to next chapter directly');
        setCurrentChapter(nextChapter.id);
        
        // Scroll to top - use ID selector
        setTimeout(() => {
          const scrollContainer = document.getElementById('main-scroll-container');
          if (scrollContainer) {
            console.log('[Finish] Scrolling to top (no words case)');
            scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
          }
        }, 200);
        return;
      }

      // If no words to add and no next chapter, just show message
      if (wordsToAdd.length === 0) {
        alert('All words in this chapter are already known!');
        return;
      }

      const confirmed = confirm(
        `Add ${wordsToAdd.length} words to known words?\n\n` +
        'Confirm finish reading?'
      );


      if (!confirmed) return;

      // Show processing message
      console.log(`[Finish] Batch adding ${wordsToAdd.length} words...`);

      // Batch add to IndexedDB (much faster!)
      await batchAddKnownWords(wordsToAdd);
      
      // Batch update Zustand store
      wordsToAdd.forEach(word => addKnownWord(word));

      // After adding words, check if we should go to next chapter
      if (hasNextChapter && nextChapter) {
        console.log('[Finish] Moving to next chapter:', nextChapter.title);
        
        setCurrentChapter(nextChapter.id);
        
        // Scroll to top - use ID selector
        setTimeout(() => {
          const scrollContainer = document.getElementById('main-scroll-container');
          if (scrollContainer) {
            console.log('[Finish] Scrolling to top');
            scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            console.warn('[Finish] Scroll container not found');
          }
        }, 300);
      } else {
        alert(`? 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢敂钘変罕濠电姴锕ら悧鍡欑矆閸喓绠鹃柟瀛樼懃閻忣亪鏌涙惔鈽呰含闁哄瞼鍠栭幃婊兾熼懡銈呭箰闂備胶顭堥鍡涘箰閹间礁鐓″璺猴功閺嗭箓鏌涢妷銏℃珖闁绘稏鍎崇槐鎾诲磼濞嗘帩鍞归梺閫炲苯澧柛鐔锋健椤㈡棃顢曢敂鐣屽帗閻熸粍绮撳畷婊冣槈閵忕姷鐤囬梺瑙勫礃椤曆呪偓姘槹閵囧嫰骞掗幋婵愪痪闂佺楠搁敃銉╁Φ閸曨垰鍐€妞ゆ劦婢€濞岊亪姊洪崫鍕闁告挻鐟╅崺銉﹀緞閹邦剛鐫勯梺閫炲苯澧寸捄顖炴煕閹烘挻鍊ч梻鍌欐祰椤曆勵殽缁嬪尅鑰块梺顒€绉埀顒婄畵瀹曠厧鈹戦幇顒侇吙闂備礁澹婇崑鍛洪弽顓熺叆闁靛牆鎳夐弨浠嬫煟濡搫绾ч柟鍏煎姉缁辨帡鍩€?${wordsToAdd.length} 婵犵數濮烽弫鎼佸磻閻愬搫鍨傞柛顐ｆ礀缁犲綊鏌嶉崫鍕偓濠氥€呴崣澶岀瘈闂傚牊渚楅崕蹇涙煢閸愵亜鏋庨柍瑙勫灴閹晠宕ｆ径瀣€风紓浣鸿檸閸樻悂宕戦幘缁樷拻濞达絽鎲￠幆鍫熺箾閺夋垵顏俊鍙夊姍瀵挳鎮欏蹇曠М濠德ゅ煐瀵板嫮鈧綆鍓欓獮?Known Words`);
      }
      
      console.log(`[Finish] Successfully added ${wordsToAdd.length} words to known words`);
    } catch (error) {
      console.error('Failed to finish document:', error);
      alert('Failed to finish document, please try again');
    }
  };

  // Handle export user data
  const handleExportData = async () => {
    try {
      const jsonData = await exportUserData();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const filename = `lexiland-userdata-${timestamp}.json`;

      const blob = new Blob([jsonData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      console.log('User data exported:', filename);
      alert(`Data exported successfully!\nFilename: ${filename}`);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed, please try again');
    }
  };

  // Handle export LLIF format
  const handleExportLLIF = async () => {
    try {
      const llifData = await exportLLIFString();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const filename = `lexiland-llif-${timestamp}.json`;

      const blob = new Blob([llifData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      console.log('LLIF data exported:', filename);
      alert(`LLIF data exported successfully!\nFilename: ${filename}\n\nThis format can be used across different language learning apps.`);
    } catch (error) {
      console.error('LLIF export failed:', error);
      alert('LLIF export failed, please try again');
    }
  };

  // Handle import user data
  const handleImportData = () => {
    importInputRef.current?.click();
  };

  const reloadDataFromDB = async () => {
    const [newKnownWords, newLearntWords, newAnnotations, newPhraseAnnotations] = await Promise.all([
      getAllKnownWords(),
      getAllLearntWords(),
      getAllCachedAnnotations(),
      getAllCachedPhraseAnnotations(),
    ]);

    loadKnownWords(newKnownWords);
    loadLearntWords(newLearntWords);

    const annotationsMap = new Map();
    newAnnotations.forEach(a => {
      annotationsMap.set(a.word, a);
    });
    loadAnnotations(annotationsMap);

    const phraseMap = new Map<string, PhraseAnnotation>();
    newPhraseAnnotations.forEach(item => {
      phraseMap.set(item.phrase, {
        phrase: item.phrase,
        cardType: item.cardType || 'phrase',
        chinese: item.chinese,
        explanation: item.explanation,
        usagePattern: item.usagePattern,
        usagePatternChinese: item.usagePatternChinese,
        isCommonUsage: item.isCommonUsage,
        grammarPoints: item.grammarPoints,
        focusWordNotes: item.focusWordNotes,
        sentenceContext: item.sentenceContext,
        documentTitle: item.documentTitle,
        cachedAt: item.cachedAt,
      });
    });
    setPhraseAnnotations(phraseMap);
  };

  const saveToFixedStorageInternal = async (silent: boolean = false, reason: string = 'manual') => {
    try {
      const jsonData = await exportUserData();
      const result = await saveUserBackup(jsonData);
      if (result.success) {
        setFixedStorageStatus(`Saved: ${result.data?.latestPath || 'latest backup'}`);
        if (!silent) {
          alert(`Backup saved to fixed storage.\n${result.data?.latestPath || ''}`);
        } else {
          console.log(`[Fixed Backup] Auto-saved (${reason}):`, result.data?.latestPath || 'latest backup');
        }
      } else {
        if (!silent) {
          alert(`Save backup failed: ${result.error}`);
        } else {
          console.warn(`[Fixed Backup] Auto-save failed (${reason}):`, result.error);
        }
      }
    } catch (error: any) {
      if (!silent) {
        alert(`Save backup failed: ${error.message}`);
      } else {
        console.warn(`[Fixed Backup] Auto-save exception (${reason}):`, error.message);
      }
    }
  };

  const handleSaveToFixedStorage = async () => {
    await saveToFixedStorageInternal(false, 'manual');
  };

  const handleLoadFromFixedStorage = async () => {
    try {
      const backup = await loadUserBackup();
      if (!backup.success || !backup.data?.jsonData) {
        alert(`Load backup failed: ${backup.error || 'No backup found'}`);
        return;
      }

      const result = await importUserData(backup.data.jsonData);
      await reloadDataFromDB();

      let message = `Loaded from fixed storage.\nImported: ${result.imported}\nSkipped: ${result.skipped}`;
      if (backup.data.path) {
        message += `\nSource: ${backup.data.path}`;
      }
      if (backup.data.warning) {
        message += `\nNote: ${backup.data.warning}`;
      }
      if (result.errors.length > 0) {
        message += `\nErrors: ${result.errors.length}`;
      }
      alert(message);
    } catch (error: any) {
      alert(`Load backup failed: ${error.message}`);
    }
  };

  const handleCheckFixedStorageStatus = async () => {
    const status = await getUserBackupStatus();
    if (status.success && status.data) {
      setFixedStorageStatus(
        `${status.data.hasLatestBackup ? 'Backup ready' : 'No backup yet'} | ${status.data.dataDir}`
      );
    } else {
      setFixedStorageStatus(`Status check failed: ${status.error}`);
    }
  };

  const handleSetCurrentAsDefault = () => {
    const defaults: AppDefaultSettings = {
      showIPA,
      showChinese,
      exportFormat,
      exportIncludeIPA,
      exportIncludeChinese,
      exportIncludePhraseList,
      exportIncludePhraseTranslations,
      level,
      autoMark,
      annotationMode,
      phraseCardProvider,
      sentenceCardProvider,
      autoPronounceSetting,
      autoShowCardOnPlay,
      speechRate,
      speechPitch,
      selectedVoice,
      immersiveMode,
      autoResumeOnOpen,
      autoReadOnOpen,
      autoStartTime,
      autoFixedBackupEnabled,
    };

    localStorage.setItem(APP_DEFAULT_SETTINGS_KEY, JSON.stringify(defaults));
    localStorage.setItem('speechRate', String(speechRate));
    localStorage.setItem('immersiveMode', String(immersiveMode));
    localStorage.setItem('autoResumeOnOpen', String(autoResumeOnOpen));
    localStorage.setItem('autoReadOnOpen', String(autoReadOnOpen));
    localStorage.setItem('autoStartTime', autoStartTime);
    localStorage.setItem('autoFixedBackupEnabled', autoFixedBackupEnabled ? 'true' : 'false');

    alert('Current settings saved as default for next startup.');
  };

  // One-time migration + periodic auto backup
  useEffect(() => {
    const run = async () => {
      if (!autoFixedBackupEnabled) return;
      const migrationKey = 'fixedStorageMigratedV1';
      const migrated = localStorage.getItem(migrationKey) === 'true';
      if (!migrated) {
        await saveToFixedStorageInternal(true, 'initial-migration');
        localStorage.setItem(migrationKey, 'true');
      }
    };
    void run();
  }, [autoFixedBackupEnabled]);

  useEffect(() => {
    if (!autoFixedBackupEnabled) return;
    const timer = setInterval(() => {
      void saveToFixedStorageInternal(true, 'interval-5min');
    }, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [autoFixedBackupEnabled]);

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const result = await importUserData(text);
      await reloadDataFromDB();

      let message = `Import completed!\nImported: ${result.imported} items\nSkipped (already exists): ${result.skipped} items`;
      if (result.errors.length > 0) {
        message += `\n\nErrors: ${result.errors.length}\n${result.errors.slice(0, 5).join('\n')}`;
        if (result.errors.length > 5) {
          message += `\n... and ${result.errors.length - 5} more errors`;
        }
      }
      alert(message);

      console.log('Import result:', result);
    } catch (error: any) {
      console.error('Failed to import user data:', error);
      alert(`Import failed: ${error.message}`);
    } finally {
      // Reset file input
      e.target.value = '';
    }
  };

  // Handle batch annotate all unknown words (currently unused, kept for future use)
  // const handleBatchAnnotate = async () => {
  //   if (!currentDocument) return;

  //   const unknownWords = new Set<string>();

  //   // Collect all unknown words from document
  //   displayParagraphs.forEach(paragraph => {
  //     paragraph.sentences.forEach(sentence => {
  //       sentence.tokens.forEach(token => {
  //         if (token.type === 'word' && token.text.length > 1) {
  //           const normalized = token.text.toLowerCase();
  //           if (!knownWords.has(normalized) && !learntWords.has(normalized)) {
  //             unknownWords.add(token.text);
  //           }
  //         }
  //       });
  //     });
  //   });

  //   const totalWords = unknownWords.size;
  //   console.log(`Starting batch annotation for ${totalWords} words...`);

  //   let completed = 0;
  //   let failed = 0;

  //   for (const word of unknownWords) {
  //     try {
  //       await handleWordClick(word);
  //       completed++;
  //       console.log(`Progress: ${completed}/${totalWords}`);
  //       // Small delay to avoid rate limiting
  //       await new Promise(resolve => setTimeout(resolve, 200));
  //     } catch (error) {
  //       failed++;
  //       console.error(`Failed to annotate "${word}":`, error);
  //     }
  //   }

  //   alert(`Batch annotation complete!\\nSuccess: ${completed}\\nFailed: ${failed}`);
  // };

  // Load known words on mount
  useEffect(() => {
    const initKnownWords = async () => {
      try {
        // Load basic known words first (fast)
        const basicWords = ['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'in', 'for', 'on', 'with', 'and', 'or', 'but', 'not', 'at', 'by', 'from', 'as', 'if', 'this', 'that', 'it', 'they', 'we', 'you', 'he', 'she', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must'];
        loadKnownWords(basicWords);
        console.log('Loaded basic known words');

        // Then try to load from IndexedDB in background
        setTimeout(async () => {
          try {
            const cachedWords = await getAllKnownWords();
            if (cachedWords.length > 0) {
              console.log(`Loaded ${cachedWords.length} known words from IndexedDB`);
              loadKnownWords(cachedWords);
            } else {
              // If empty, load from JSON file
              const words = await loadKnownWordsFromFile('/known-words-3000.json');
              console.log(`Loaded ${words.length} known words from file`);
              loadKnownWords(words);
            }
          } catch (error) {
            console.error('Failed to load extended known words:', error);
          }
        }, 100);
      } catch (error) {
        console.error('Failed to initialize:', error);
      }
    };

    initKnownWords();

    // Load cached annotations
    const loadCachedAnnotations = async () => {
      try {
        const cached = await getAllCachedAnnotations();
        console.log(`Loading ${cached.length} cached annotations from IndexedDB`);
        for (const item of cached) {
          const sourceWord = normalizeWordFormValue(item.lemmaWord || item.word);
          const canonicalWord = sourceWord;
          const wordCardIdentity = getWordCardIdentity({
            word: canonicalWord,
            cardKey: item.cardKey,
            baseForm: item.baseForm,
            partOfSpeech: item.partOfSpeech,
            definition: item.definition,
          }, sourceWord);
          const annotation: WordAnnotation = {
            word: canonicalWord,
            cardKey: wordCardIdentity,
            baseForm: item.baseForm,
            bncRank: item.bncRank,
            ipa: item.ipa,
            chinese: item.chinese,
            definition: item.definition,
            example: item.example,
            level: item.level,
            partOfSpeech: item.partOfSpeech,
            wordForms: item.wordForms,
            // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鍨鹃幇浣圭稁缂傚倷鐒﹁摫闁告瑥绻橀弻鐔碱敍閿濆洣姹楅悷婊呭鐢帡姊婚鐐寸厓鐟滃繘骞嗛　绀縤闂傚倸鍊搁崐鐑芥嚄閸洖纾块柣銏㈩焾閻ょ偓绻濋棃娑卞剬闁逞屽墾缁犳挸鐣锋總绋课ㄩ柕澹懎骞€闂佽崵鍠愮划宀€鎹㈠鈧畷娲焵椤掍降浜滈柟鍝勭Х閸忓矂鏌嶉娑欑闁靛洤瀚版俊鎼佸Ψ閿旂粯锛嗘俊?
            emoji: item.emoji,
            emojiImagePath: item.emojiImagePath,
            emojiModel: item.emojiModel,
            // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鍨鹃幇浣圭稁缂傚倷鐒﹁摫闁告瑥绻橀弻鐔碱敍閿濆洣姹楅悷婊呭鐢帡鎮欐繝鍥ㄧ厪濠电倯鈧崑鎾绘煛鐎ｎ偆澧紒缁樼箞閹粙妫冨ù璁圭節閺屻倝宕橀懠顒€鐓熼梺璇″枤閸忔﹢鐛Ο鑲╃＜婵☆垳鍘ч獮鎰版⒒娴ｄ警鐒鹃柡鍫墰閸犲﹤顓兼径濠勵啇闂佽澹嗘晶妤呮偂閻斿吋鐓冩い鏍ㄧ〒閹冲啴鏌涢悢鍝勨枅鐎?
            sentence: item.sentence,
            documentTitle: item.documentTitle,
            encounteredForms: buildEncounteredForms(sourceWord, {
              word: canonicalWord,
              baseForm: item.baseForm,
              wordForms: item.wordForms,
              encounteredForms: item.encounteredForms,
            }),
            encounteredMeanings: item.encounteredMeanings,
            activeMeaningId: item.activeMeaningId,
            cachedAt: item.cachedAt,
          };
          if (shouldDebugWord(item.word, item.baseForm, annotation.word, annotation.baseForm)) {
            logWordDebug('App.loadCachedAnnotations:item', {
              cachedItem: item,
              hydratedAnnotation: annotation,
            });
          }
          const storageKey = normalizeWordFormValue(item.word);
          if (storageKey && storageKey !== wordCardIdentity) {
            await cacheAnnotation(wordCardIdentity, annotation);
            await deleteAnnotation(storageKey);
          }
          addAnnotation(wordCardIdentity, annotation);
        }
        if (cached.length > 0) {
          console.log('[OK] Cached annotations loaded');
        }
      } catch (error) {
        console.error('Failed to load cached annotations:', error);
      }
    };

    // Load learnt words
    const loadLearntWordsFromDB = async () => {
      try {
        const learnt = await getAllLearntWords();
        learnt.forEach(word => addLearntWord(word));
        if (learnt.length > 0) {
          console.log(`[OK] Loaded ${learnt.length} learnt words from IndexedDB`);
        }
      } catch (error) {
        console.error('Failed to load learnt words:', error);
      }
    };

    loadCachedAnnotations();
    loadLearntWordsFromDB();
    
    // Load cached phrase annotations
    const loadCachedPhraseAnnotations = async () => {
      try {
        const cached = await getAllCachedPhraseAnnotations();
        console.log(`Loading ${cached.length} cached phrase annotations from IndexedDB`);
        const phraseMap = new Map<string, PhraseAnnotation>();
        cached.forEach(item => {
          phraseMap.set(item.phrase, {
            phrase: item.phrase,
            cardType: item.cardType || 'phrase',
            chinese: item.chinese,
            explanation: item.explanation,
            usagePattern: item.usagePattern,
            usagePatternChinese: item.usagePatternChinese,
            isCommonUsage: item.isCommonUsage,
            grammarPoints: item.grammarPoints,
            focusWordNotes: item.focusWordNotes,
            sentenceContext: item.sentenceContext,
            documentTitle: item.documentTitle,  // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鍨鹃幇浣圭稁缂傚倷鐒﹁摫闁告瑥绻橀弻鐔碱敍閿濆洣姹楅悷婊呭鐢帡鎮欐繝鍐︿簻闁瑰搫妫楁禍鎯р攽閳藉棗浜濋柨鏇樺灲瀵鈽夐姀鐘栥劑鏌曡箛濠傚⒉闁绘繃鐗犻幃宄邦煥閸曨剛鍑″┑鐐点€嬬换婵嗩嚕婵犳艾鐏抽柟棰佺閹垿姊洪崨濠佺繁闁哥姵鐗犲鎼佹偐瀹割喗瀵?
            cachedAt: item.cachedAt,
          });
        });
        setPhraseAnnotations(phraseMap);
        if (cached.length > 0) {
          console.log('[OK] Cached phrase annotations loaded');
        }
      } catch (error) {
        console.error('Failed to load cached phrase annotations:', error);
      }
    };
    
    loadCachedPhraseAnnotations();
  }, [loadKnownWords]);

  useEffect(() => {
    let cancelled = false;
    void getAllSavedDocuments().then((savedDocs) => {
      if (cancelled || savedDocs.length === 0 || documents.length > 0) return;
      const restoredDocs = savedDocs
        .filter((doc) => doc.type === 'text' || doc.type === 'epub')
        .map((doc) => ({
          id: doc.id,
          type: doc.type || 'text',
          format: inferSavedDocumentFormat(doc),
          title: doc.title,
          content: doc.content,
          paragraphs: doc.paragraphs,
          chapters: doc.chapters,
          currentChapterId: doc.currentChapterId,
          author: doc.author,
          createdAt: doc.createdAt,
        })) as Document[];
      if (restoredDocs.length > 0) {
        const storedCurrentId = localStorage.getItem('currentDocumentId');
        const currentId = storedCurrentId && restoredDocs.some((doc) => doc.id === storedCurrentId)
          ? storedCurrentId
          : restoredDocs[0].id;
        loadDocuments(restoredDocs, currentId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [documents.length, loadDocuments]);

  useEffect(() => {
    if (documents.length === 0) return;
    void Promise.all(documents.map((doc) => saveDocument(doc)));
  }, [documents]);

  useEffect(() => {
    if (!currentDocumentId) return;
    void touchDocument(currentDocumentId);
  }, [currentDocumentId]);

  const handleLoadSample = async () => {
    const fallbackSampleText = `covered / cover
walled / wall
wore / wear
tugged / tug
writes / wrote / written / write`;

    let sampleText = fallbackSampleText;

    try {
      const response = await fetch('/sample-lemma-test.txt', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Failed to load sample file: ${response.status}`);
      }
      sampleText = await response.text();
    } catch (error) {
      console.warn('[SampleText] Falling back to inline sample text', error);
    }

    const paragraphs = tokenizeParagraphs(sampleText);

    addDocument({
      id: 'sample-document',
      type: 'text',
      title: 'Sample Lemma Test',
      content: sampleText,
      paragraphs,
      createdAt: Date.now(),
    });
  };

  const handleNewDocument = () => {
    setNewDocTitle('Untitled Document');
    setNewDocContent('');
    setShowNewDocModal(true);
  };

  const handleCreateDocument = () => {
    if (!newDocTitle.trim()) {
      alert('Please enter a document title');
      return;
    }

    const paragraphs = newDocContent.trim() ? tokenizeParagraphs(newDocContent) : [];
    
    // Use title as consistent ID
    const documentId = `custom-${newDocTitle.trim().replace(/\s+/g, '-').toLowerCase()}`;

    addDocument({
      id: documentId,
      type: 'text',
      format: 'plain',
      title: newDocTitle.trim(),
      content: newDocContent.trim(),
      paragraphs,
      createdAt: Date.now(),
    });

    setShowNewDocModal(false);
    setNewDocTitle('');
    setNewDocContent('');
  };

  const handleFileImport = () => {
    fileInputRef.current?.click();
  };

  const inferSavedDocumentFormat = (doc: {
    format?: 'plain' | 'markdown';
    content?: string;
    paragraphs?: Array<{ blockType?: string }>;
  }): 'plain' | 'markdown' => {
    if (doc.format === 'plain' || doc.format === 'markdown') {
      return doc.format;
    }

    if (doc.paragraphs?.some((paragraph) => paragraph.blockType && paragraph.blockType !== 'paragraph')) {
      return 'markdown';
    }

    if (doc.content && /(^|\n)(#{1,6}\s|>\s|[-*+]\s|\d+\.\s|```)/m.test(doc.content)) {
      return 'markdown';
    }

    return 'plain';
  };

  const normalizeImportedText = (rawContent: string, fileName: string) => {
    const normalized = rawContent.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const isMarkdown = /\.(md|markdown)$/i.test(fileName);

    if (!isMarkdown) {
      return normalized;
    }

    return normalized
      .replace(/^---\n[\s\S]*?\n---\n*/m, '')
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\n{3,}/g, '\n\n');
  };

  const loadTextDocument = (content: string, fileName: string, documentPrefix: string) => {
    const normalizedContent = normalizeImportedText(content, fileName);
    const isMarkdown = /\.(md|markdown)$/i.test(fileName);
    const paragraphs = isMarkdown
      ? tokenizeMarkdownParagraphs(normalizedContent)
      : tokenizeParagraphs(normalizedContent);

    const documentId = `${documentPrefix}-${fileName.replace(/\.[^/.]+$/, '')}`;

    addDocument({
      id: documentId,
      type: 'text',
      format: isMarkdown ? 'markdown' : 'plain',
      title: fileName.replace(/\.[^/.]+$/, ''),
      content: normalizedContent,
      paragraphs,
      createdAt: Date.now(),
    });
  };

  const loadEpubDocument = async (file: File, documentPrefix: string) => {
    const { parseEpubFile } = await import('./utils/epubParser');
    const { title, author, chapters } = await parseEpubFile(file);

    const documentId = `${documentPrefix}-${file.name.replace(/\.epub$/i, '')}`;

    addDocument({
      id: documentId,
      type: 'epub',
      title,
      author,
      chapters,
      currentChapterId: chapters[0]?.id,
      createdAt: Date.now(),
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check if it's an EPUB file
    if (file.name.toLowerCase().endsWith('.epub')) {
      try {
        console.log('[App] Loading EPUB file:', file.name);
        await loadEpubDocument(file, 'epub');
        console.log(`[App] EPUB loaded: ${file.name}`);
      } catch (error) {
        console.error('[App] Failed to load EPUB:', error);
        alert(`Failed to load EPUB file: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } else {
      // Handle text file
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = (event.target?.result as string) || '';
        loadTextDocument(content, file.name, 'txt');
      };
      reader.readAsText(file);
    }
  };

  const handleLoadServerBook = async (book: ServerLibraryBook) => {
    try {
      setLoadingServerBookName(book.fileName);
      const response = await fetch(book.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch server book: ${response.status}`);
      }

      if (book.type === 'epub') {
        const blob = await response.blob();
        const file = new File([blob], book.fileName, {
          type: 'application/epub+zip',
        });
        await loadEpubDocument(file, 'server-epub');
      } else {
        const content = await response.text();
        loadTextDocument(content, book.fileName, 'server-text');
      }
    } catch (error) {
      console.error('[App] Failed to load server book:', error);
      alert(`Failed to load server book: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoadingServerBookName(null);
    }
  };

  const handleJumpToParagraph = (paragraphIndex: number) => {
    const scrollContainer = document.getElementById('main-scroll-container');
    const target = scrollContainer?.querySelector(`[data-paragraph-index="${paragraphIndex}"]`) as HTMLElement | null;
    if (!target) return;

    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleDeleteLoadedDocument = async (doc: Document) => {
    await deleteSavedDocument(doc.id);
    removeDocument(doc.id);
    setPendingDeleteDocumentId((current) => (current === doc.id ? null : current));
  };

  // Speech synthesis handlers
  const handlePlayPause = () => {
    if (!currentDocument) return;

    if (isSpeaking) {
      // Stop current playback
      console.log('[TTS] Stopping current playback...');
      shouldStopRef.current = true;
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      // Don't clear currentSentenceIndex so next play starts from here
    } else {
      // Start/Resume playing from current position or beginning
      console.log('[TTS] Starting playback from:', currentSentenceIndex);
      const startIndex = currentSentenceIndex ?? 0;
      speakFromSentence(startIndex);
    }
  };

  const handleStop = () => {
      console.log('[TTS] Stopping and resetting...');
      shouldStopRef.current = true;
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      setCurrentSentenceIndex(null);
      setCurrentWordIndex(-1);
      if (speechSynthesisRef.current) {
        speechSynthesisRef.current = null;
      }
    };

    const handlePrevSentence = () => {
      if (currentSentenceIndex !== null && currentSentenceIndex > 0) {
        console.log('[TTS] Going to previous sentence');
        shouldStopRef.current = true;
        window.speechSynthesis.cancel();
        setTimeout(() => {
          shouldStopRef.current = false;
          speakFromSentence(currentSentenceIndex - 1);
        }, 50);
      }
    };

    const handleNextSentence = () => {
      if (currentSentenceIndex !== null) {
        console.log('[TTS] Going to next sentence');
        shouldStopRef.current = true;
        window.speechSynthesis.cancel();
        setTimeout(() => {
          shouldStopRef.current = false;
          speakFromSentence(currentSentenceIndex + 1);
        }, 50);
      }
    };

  const speakFromSentence = (startIndex: number) => {
    if (!currentDocument) return;

    // Reset stop flag when starting new speech
    shouldStopRef.current = false;

    const allSentences: { paragraphIndex: number; sentenceIndex: number; text: string }[] = [];
    displayParagraphs.forEach((para: ParagraphType, pIdx: number) => {
      para.sentences.forEach((sent: Sentence, sIdx: number) => {
        allSentences.push({
          paragraphIndex: pIdx,
          sentenceIndex: sIdx,
          text: sent.text
        });
      });
    });

    if (startIndex >= allSentences.length) {
      handleStop();
      return;
    }

    const sentence = allSentences[startIndex];
    const utterance = new SpeechSynthesisUtterance(sentence.text);

    // Configure speech
    utterance.rate = speechRate;
    utterance.pitch = speechPitch;
    utterance.volume = 1.0;
    utterance.lang = 'en-US';

    // Set voice if selected
    if (selectedVoice) {
      const voice = availableVoices.find(v => v.name === selectedVoice);
      if (voice) {
        utterance.voice = voice;
      }
    }

    utterance.onstart = () => {
      console.log('[TTS] Started speaking sentence:', startIndex);
      setIsSpeaking(true);
      setCurrentSentenceIndex(startIndex);
      setCurrentWordIndex(0);
      addBookmark(
        currentDocument.id,
        currentDocument.type === 'epub' ? currentDocument.currentChapterId : undefined,
        sentence.paragraphIndex,
        sentence.sentenceIndex
      );
      
      // Note: Auto-show cards logic moved to onboundary to show cards as each word is read
    };

    // Track word-level progress
    utterance.onboundary = (event) => {
      if (event.name === 'word') {
        const charIndex = event.charIndex;
        console.log('[TTS] Word boundary at charIndex:', charIndex, 'in sentence:', sentence.text);

        // Find which word index corresponds to this character position
        const sentenceData = displayParagraphs
          .flatMap((p: ParagraphType) => p.sentences)[startIndex];
        if (sentenceData && sentenceData.tokens) {
          // Extract only word tokens
          const wordTokens = sentenceData.tokens.filter((t: Token) => t.type === 'word');

          // Find the word that contains this character index
          for (let i = 0; i < wordTokens.length; i++) {
            const token = wordTokens[i];
            // startIndex and endIndex are relative to the sentence
            const tokenStart = token.startIndex - sentenceData.startIndex;
            const tokenEnd = token.endIndex - sentenceData.startIndex;

            if (charIndex >= tokenStart && charIndex < tokenEnd) {
              console.log('[TTS] Setting currentWordIndex to:', i, 'word:', token.text, 'tokenStart:', tokenStart, 'tokenEnd:', tokenEnd);
              setCurrentWordIndex(i);
              
              // Auto-show card for this word if enabled
              if (autoShowCardOnPlay) {
                const word = token.text.toLowerCase();
                
                // Check for word annotations (but skip if marked as known/learnt)
                if (findAnnotationEntry(annotations, word)) {
                  // Only show if not marked as known/learnt
                  if (!learntWords.has(word)) {
                    const entry = findAnnotationEntry(annotations, word);
                    const canonicalHistoryWord = entry?.annotation
                      ? getWordCardIdentity(entry.annotation as WordAnnotation)
                      : word;
                    addToCardHistory('word', canonicalHistoryWord);
                  }
                }
                
                // Check for phrase annotations starting with this word
                // Check phrases of length 2-5 words starting from current position
                for (let len = 2; len <= Math.min(5, wordTokens.length - i); len++) {
                  const phraseTokens = wordTokens.slice(i, i + len);
                  const phraseText = phraseTokens.map((t: Token) => t.text).join(' ').trim();
                  if (phraseAnnotations.has(phraseText.toLowerCase())) {
                    addToCardHistory('phrase', phraseText);
                    break; // Only show the first matching phrase
                  }
                }
              }
              
              break;
            }
          }
        }
      }
    };

    utterance.onend = () => {
      console.log('[TTS] onend triggered, shouldStop:', shouldStopRef.current);

      // Check stop flag first (most reliable)
      if (shouldStopRef.current) {
        console.log('[TTS] Stopped by user');
        return;
      }

      // Move to next sentence
      const nextIndex = startIndex + 1;
      if (nextIndex < allSentences.length) {
        speakFromSentence(nextIndex);
      } else {
        handleStop();
      }
    };

    utterance.onerror = (error) => {
      console.error('Speech synthesis error:', error);
      handleStop();
    };

    speechSynthesisRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  };

  const getCollapsedFilteredEmojis = () => {
    if (!collapsedEmojiSearchQuery.trim()) return collapsedCommonEmojis;
    const query = collapsedEmojiSearchQuery.toLowerCase().trim();
    const results: string[] = [];
    for (const [keyword, emoji] of keywordToEmoji.entries()) {
      if (keyword.includes(query) && !results.includes(emoji)) {
        results.push(emoji);
      }
    }
    return results.slice(0, 120);
  };

  const openCollapsedWebMenu = (e: React.MouseEvent, word: string, cardLookupKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const panelWidth = 336;
    const panelHeight = 320;
    const gap = 8;
    const padding = 12;
    let left = rect.right + gap;
    if (left + panelWidth > window.innerWidth - padding) {
      left = rect.left - panelWidth - gap;
    }
    left = Math.max(padding, Math.min(left, window.innerWidth - panelWidth - padding));
    let top = rect.top;
    top = Math.max(padding, Math.min(top, window.innerHeight - panelHeight - padding));
    setCollapsedGoogleKeyword(`${word} photo`);
    setCollapsedImageMenu({ panel: 'web', word, cardLookupKey, top, left });
  };

  const handleCollapsedSelectEmoji = async (emoji: string) => {
    if (!collapsedImageMenu?.word) return;
    await updateEmoji(collapsedImageMenu.cardLookupKey, emoji, (updates) => {
      updateAnnotation(collapsedImageMenu.cardLookupKey, updates);
    });
    setCollapsedUnsplashLockedWords(prev => {
      const next = new Set(prev);
      next.delete(collapsedImageMenu.word.toLowerCase());
      return next;
    });
    setCollapsedImageMenu(null);
  };

  const openCollapsedWebImage = () => {
    if (!collapsedImageMenu) return;
    setCollapsedImageMenu({ ...collapsedImageMenu, panel: 'web' });
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

  const handleCollapsedOpenGoogleImages = () => {
    const q = (collapsedGoogleKeyword.trim() || `${collapsedImageMenu?.word || ''} photo`);
    const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const saveCollapsedClipboardBlob = async (blob: Blob) => {
    if (!collapsedImageMenu?.word) return;
    const dataUrl = await blobToDataUrl(blob);
    const result = await savePastedImage(collapsedImageMenu.word, dataUrl);
    if (!result.success || !result.data?.imageUrl) {
      throw new Error(result.error || 'Failed to save pasted image');
    }
    await addEmojiImagePathToActiveMeaning(collapsedImageMenu.cardLookupKey, result.data.imageUrl, 'web-clipboard', (updates) => {
      updateAnnotation(collapsedImageMenu.cardLookupKey, updates);
    });
    setCollapsedUnsplashLockedWords(prev => {
      const next = new Set(prev);
      next.delete(collapsedImageMenu.word.toLowerCase());
      return next;
    });
    setCollapsedImageMenu(null);
  };

  const handleCollapsedUnsplashRightClick = async (
    e: React.MouseEvent,
    word: string,
    cardLookupKey: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const normalized = word.toLowerCase();
    if (collapsedUnsplashLockedWords.has(normalized)) {
      return;
    }
    try {
      const result = await searchImage(word);
      if (result.success && result.data?.imageUrl) {
        await addEmojiImagePathToActiveMeaning(cardLookupKey, result.data.imageUrl, undefined, (updates) => {
          updateAnnotation(cardLookupKey, updates);
        });
        setCollapsedUnsplashLockedWords(prev => {
          const next = new Set(prev);
          next.add(normalized);
          return next;
        });
      } else {
        alert(result.error || 'No image found for this word');
      }
    } catch (error) {
      console.error('[Collapsed Unsplash Right Click] Error:', error);
      alert('Failed to search image');
    }
  };

  const handleCollapsedPasteFromClipboard = async () => {
    if (collapsedClipboardSaving) return;
    setCollapsedClipboardSaving(true);
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
      await saveCollapsedClipboardBlob(imageBlob);
      alert('Pasted image saved successfully.');
    } catch (error: any) {
      alert(error?.message || 'Failed to save pasted image');
    } finally {
      setCollapsedClipboardSaving(false);
    }
  };

  const handleCollapsedPasteEvent = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items || items.length === 0 || collapsedClipboardSaving) return;
    const imageItem = Array.from(items).find((item) => item.type.startsWith('image/'));
    if (!imageItem) return;
    e.preventDefault();
    e.stopPropagation();
    setCollapsedClipboardSaving(true);
    try {
      const blob = imageItem.getAsFile();
      if (!blob) throw new Error('Failed to read pasted image data');
      await saveCollapsedClipboardBlob(blob);
      alert('Pasted image saved successfully.');
    } catch (error: any) {
      alert(error?.message || 'Failed to save pasted image');
    } finally {
      setCollapsedClipboardSaving(false);
    }
  };

  const handleReviewBucketClick = (bucket: StatsBucket) => {
    setReviewSelectedBucketKey(bucket.key);
    setReviewSortMode('stats');
    setExpandedCardKeys(new Set());
  };

  const renderReviewStatsPanel = () => {
    const maxCount = Math.max(...reviewStatsBuckets.map(bucket => bucket.count), 1);

    return (
      <div className="mb-4 border border-border rounded-2xl bg-white p-4">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <div className="text-sm font-semibold text-gray-900">Annotation Stats</div>
            <div className="text-xs text-muted">Click a bar to load cards from that day or month into the pool.</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setReviewStatsRange('week')}
              className={`px-3 py-1.5 rounded-lg text-xs border ${
                reviewStatsRange === 'week'
                  ? 'bg-indigo-500 text-white border-indigo-500'
                  : 'border-border hover:bg-hover'
              }`}
            >
              Week
            </button>
            <button
              onClick={() => setReviewStatsRange('month')}
              className={`px-3 py-1.5 rounded-lg text-xs border ${
                reviewStatsRange === 'month'
                  ? 'bg-indigo-500 text-white border-indigo-500'
                  : 'border-border hover:bg-hover'
              }`}
            >
              Month
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-3 items-end h-56">
          {reviewStatsBuckets.map((bucket) => {
            const isSelected = reviewSelectedBucketKey === bucket.key;
            const barHeight = `${Math.max((bucket.count / maxCount) * 100, bucket.count > 0 ? 10 : 4)}%`;

            return (
              <button
                key={bucket.key}
                onClick={() => handleReviewBucketClick(bucket)}
                className={`h-full rounded-xl border px-2 py-3 flex flex-col justify-end items-center transition-colors ${
                  isSelected
                    ? 'border-indigo-500 bg-indigo-50'
                    : 'border-border hover:bg-gray-50'
                }`}
                title={`${bucket.label} ${bucket.sublabel}: ${bucket.count}`}
              >
                <div className="text-xs font-semibold text-gray-700 mb-2">{bucket.count}</div>
                <div className="w-full rounded-t-lg bg-indigo-400" style={{ height: barHeight }} />
                <div className="mt-3 text-xs font-semibold text-gray-800">{bucket.label}</div>
                <div className="text-[11px] text-muted">{bucket.sublabel}</div>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderCardItem = (item: ReviewCardItem, mode: 'read' | 'review') => {
    const annotation = item.annotation;
    const cardKey = item.cardKey;
    const isExpanded = expandedCardKeys.has(cardKey);

    return (
      <div
        key={cardKey}
        className={`border-2 rounded-lg relative bg-white ${
          isExpanded ? 'border-blue-500' : 'border-border'
        }`}
      >
        {!isExpanded && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (mode === 'read') {
                removeFromCardHistory(item.lookupKey);
              } else {
                setReviewHiddenCardKeys(prev => {
                  const next = new Set(prev);
                  next.add(cardKey);
                  return next;
                });
              }
            }}
            className="absolute top-2 right-2 z-10 w-6 h-6 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full"
            title={mode === 'read' ? 'Remove from history' : 'Remove from current pool'}
          >
            x
          </button>
        )}

        {isExpanded ? (
          item.type === 'word' ? (
            <WordCard
              annotation={annotation as WordAnnotation}
              displayWord={item.word}
              isLearnt={learntWords.has(item.word.toLowerCase())}
              onClose={() => closeCard(cardKey)}
              onMarkKnown={handleMarkKnown}
              onDelete={handleDeleteFromCards}
              onRegenerateAI={(word, sentence) => handleRegenerateAI(word, sentence, 'word')}
            />
          ) : (
            <PhraseCard
              annotation={annotation as PhraseAnnotation}
              isInserted={phraseTranslationInserts.get(item.word.toLowerCase()) || false}
              onClose={() => closeCard(cardKey)}
              onToggleInsert={handleTogglePhraseInsert}
              onRegenerateAI={(phrase, sentence) => handleRegenerateAI(phrase, sentence, item.type)}
              onDelete={(phrase) => handleDeletePhraseFromCards(phrase)}
            />
          )
        ) : (
          <div
            className="p-2 hover:bg-gray-50 cursor-pointer pr-8"
            onClick={() => {
              if (mode === 'read') {
                expandSingleCard(cardKey);
              } else {
                setExpandedCardKeys(prev => {
                  const next = new Set(prev);
                  next.add(cardKey);
                  return next;
                });
              }
            }}
          >
            {item.type === 'word' ? (
              <div className="flex items-center gap-2 flex-wrap">
                {(() => {
                  const wordAnnotation = annotation as WordAnnotation;
                  const wordCardLookupKey = wordAnnotation.cardKey || item.lookupKey;
                  const collapsedLemmaWord = wordAnnotation.word;
                  const encounteredSurfaceForms = getEncounteredSurfaceForms(wordAnnotation, item.word);

                  return (
                    <>
                <div
                  className="w-7 h-7 flex-shrink-0 flex items-center justify-center text-xl bg-gray-100 rounded hover:ring-2 hover:ring-blue-300 transition-all"
                  onClick={(e) => {
                    openCollapsedWebMenu(e, item.word, wordCardLookupKey);
                  }}
                  onContextMenu={(e) => {
                    void handleCollapsedUnsplashRightClick(e, item.word, wordCardLookupKey);
                  }}
                  onMouseDown={(e) => {
                    if (e.button !== 0) return;
                    const timer = window.setTimeout(async () => {
                      e.preventDefault();
                      e.stopPropagation();
                      try {
                        const sentence = (annotation as WordAnnotation).sentence || '';
                        const result = await generateEmojiImage(item.word, sentence);
                        if (result.success && result.data?.imageUrl) {
                          await addEmojiImagePathToActiveMeaning(wordCardLookupKey, result.data.imageUrl, result.data.model, (updates) => {
                            updateAnnotation(wordCardLookupKey, updates);
                          });
                        } else {
                          alert('Failed to generate AI image');
                        }
                      } catch (error) {
                        console.error('[AI Image] Error:', error);
                      }
                    }, 800);

                    const clearTimer = () => {
                      clearTimeout(timer);
                      document.removeEventListener('mouseup', clearTimer);
                    };
                    document.addEventListener('mouseup', clearTimer);
                  }}
                >
                  {(annotation as WordAnnotation).emojiImagePath?.[0] ? (
                    <img
                      src={resolveAssetUrl((annotation as WordAnnotation).emojiImagePath![0])}
                      alt="emoji"
                      className="w-full h-full object-cover rounded"
                    />
                  ) : (annotation as WordAnnotation).emoji ? (
                    <span>{(annotation as WordAnnotation).emoji}</span>
                  ) : (
                    <span>{getWordEmoji(annotation as WordAnnotation)}</span>
                  )}
                </div>

                <div className="min-w-0 flex-shrink">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm flex-shrink-0">{item.displayLabel || collapsedLemmaWord}</span>
                    <span
                      className={`text-[11px] font-semibold flex-shrink-0 ${
                        wordAnnotation.bncRank && wordAnnotation.bncRank > 0
                          ? wordAnnotation.bncRank <= 10000
                            ? 'text-emerald-600'
                            : wordAnnotation.bncRank <= 30000
                              ? 'text-lime-600'
                              : wordAnnotation.bncRank <= 50000
                                ? 'text-amber-600'
                                : 'text-orange-600'
                          : 'text-orange-600'
                      }`}
                    >
                      {wordAnnotation.bncRank && wordAnnotation.bncRank > 0 ? `#${wordAnnotation.bncRank}` : '50k+'}
                    </span>
                  </div>
                </div>

                {wordAnnotation.ipa && (
                  <span
                    className="text-xs text-blue-600 cursor-pointer hover:underline flex-shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      const utterance = new SpeechSynthesisUtterance(collapsedLemmaWord);
                      utterance.lang = 'en-US';
                      utterance.rate = 0.9;
                      window.speechSynthesis.speak(utterance);
                    }}
                  >
                    /{wordAnnotation.ipa}/
                  </span>
                )}

                <span
                  className={`text-sm flex-1 min-w-0 break-words cursor-pointer select-none ${
                    hiddenTranslations.has(cardKey) ? 'text-muted bg-muted' : 'text-muted'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setHiddenTranslations(prev => {
                      const next = new Set(prev);
                      if (next.has(cardKey)) {
                        next.delete(cardKey);
                      } else {
                        next.add(cardKey);
                      }
                      return next;
                    });
                  }}
                  title={hiddenTranslations.has(cardKey) ? 'Click to show translation' : 'Click to hide translation'}
                >
                  {hiddenTranslations.has(cardKey) ? '......' : wordAnnotation.chinese}
                </span>

                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    const sentence = wordAnnotation.sentence;
                    const regenerateWord = encounteredSurfaceForms[0] || wordAnnotation.word;
                    await handleRegenerateAI(regenerateWord, sentence || '', 'word');
                  }}
                  className="text-xs px-1.5 py-0.5 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded border border-purple-200 flex-shrink-0"
                  title="Re-generate with AI"
                >
                  AI
                </button>
                    </>
                  );
                })()}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-purple-600 bg-purple-50 border border-purple-200 rounded px-1.5 py-0.5 flex-shrink-0">
                    {item.type === 'sentence' ? 'SEN' : item.type === 'paragraph' ? 'PAR' : item.type === 'grammar' ? 'GR' : 'PH'}
                  </span>
                  <span className="font-bold text-sm flex-1">{item.word}</span>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm flex-1 cursor-pointer select-none ${
                      hiddenTranslations.has(cardKey) ? 'text-muted bg-muted' : 'text-muted'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setHiddenTranslations(prev => {
                        const next = new Set(prev);
                        if (next.has(cardKey)) {
                          next.delete(cardKey);
                        } else {
                          next.add(cardKey);
                        }
                        return next;
                      });
                    }}
                    title={hiddenTranslations.has(cardKey) ? 'Click to show translation' : 'Click to hide translation'}
                  >
                    {hiddenTranslations.has(cardKey) ? '......' : (annotation as PhraseAnnotation).chinese}
                  </span>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      const sentence = (annotation as PhraseAnnotation).sentenceContext;
                      await handleRegenerateAI(item.word, sentence || '', item.type);
                    }}
                    className="text-xs px-1.5 py-0.5 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded border border-purple-200 flex-shrink-0"
                    title="Re-generate with AI"
                  >
                    AI
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderReviewBoard = () => (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      {reviewDisplayRows.map((row) => {
        if (row.type === 'divider') {
          return (
            <div
              key={row.key}
              className="lg:col-span-2 text-xs text-gray-400 font-semibold tracking-wide pt-2"
            >
              {row.label}
            </div>
          );
        }

        return renderCardItem(row.item, 'review');
      })}
    </div>
  );

  return (
    <div className="h-screen flex flex-col">
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md,.markdown,.epub"
        onChange={handleFileChange}
        className="hidden"
      />
      <input
        ref={importInputRef}
        type="file"
        accept=".json"
        onChange={handleImportFileChange}
        className="hidden"
      />

      {/* Top Bar */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-border px-4 py-2.5 flex items-center gap-3 flex-wrap">
        {/* Hamburger Menu Button - Notion Style */}
        <button
          onClick={() => setIsOutlineCollapsed(!isOutlineCollapsed)}
          className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded transition-colors"
          title={isOutlineCollapsed ? 'Show outline' : 'Hide outline'}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold">Lexiland</div>
          <button
            onClick={() => setViewMode(prev => prev === 'read' ? 'review' : 'read')}
            className="px-3 py-1 border border-border rounded-lg hover:bg-hover text-xs font-semibold"
          >
            {viewMode}
          </button>
        </div>

        {viewMode === 'read' ? (
          <>
            <button
              className="px-2 py-1 border border-border rounded-lg hover:bg-hover text-xs"
              title="Previous sentence"
              onClick={handlePrevSentence}
              disabled={!currentDocument || currentSentenceIndex === null || currentSentenceIndex === 0}
            >
              &lt;
            </button>
            <button
              className={`px-2 py-1 border rounded-lg text-xs ${
                isSpeaking
                  ? 'border-active bg-active hover:bg-indigo-100'
                  : 'border-border hover:bg-hover'
              }`}
              title="Play"
              onClick={handlePlayPause}
              disabled={!currentDocument}
            >
              {isSpeaking ? 'Pause' : 'Play'}
            </button>
            <button
              className="px-2 py-1 border border-border rounded-lg hover:bg-hover text-xs"
              title="Next sentence"
              onClick={handleNextSentence}
              disabled={!currentDocument || currentSentenceIndex === null}
            >
              &gt;
            </button>
            <button
              className="px-2 py-1 border border-border rounded-lg hover:bg-hover text-xs"
              title="Stop"
              onClick={handleStop}
              disabled={!isSpeaking}
            >
              Stop
            </button>

            <div className="relative">
              <button
                className="px-2 py-1 border border-border rounded-lg hover:bg-hover text-xs"
                title="Speed"
                onClick={() => setShowSpeedControl(!showSpeedControl)}
              >
                {speechRate.toFixed(1)}x
              </button>
              {showSpeedControl && (
                <div className="absolute top-full mt-2 p-3 bg-white border border-border rounded-lg shadow-lg z-10 min-w-[200px]">
                  <label className="block text-sm mb-2">Speed: {speechRate.toFixed(1)}x</label>
                  <input
                    type="range"
                    min="0.5"
                    max="2.0"
                    step="0.1"
                    value={speechRate}
                    onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>
              )}
            </div>

            <button
              onClick={() => setImmersiveMode(prev => !prev)}
              className={`px-2 py-1 border rounded-lg text-xs ${
                immersiveMode ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-border hover:bg-hover'
              }`}
              title="Focus current sentence or paragraph"
            >
              Focus
            </button>

            <button
              onClick={toggleVoiceCommands}
              className={`px-2 py-1 border rounded-lg text-xs ${
                isVoiceListening ? 'border-red-500 bg-red-50 text-red-700' : 'border-border hover:bg-hover'
              }`}
              title={voiceStatus}
            >
              Voice
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setAutoAnnotate(!autoAnnotate)}
                className="w-6 h-6 flex items-center justify-center rounded-full border-2 border-indigo-500 hover:bg-indigo-50 transition-colors"
                title={autoAnnotate ? "Auto-annotate: ON" : "Auto-annotate: OFF"}
              >
                <div className={`w-2 h-2 rounded-full transition-all ${autoAnnotate ? 'bg-indigo-500' : 'bg-gray-300'}`} />
              </button>

              <button
                onClick={() => handleAnnotate(false)}
                disabled={markedWords.size === 0 && phraseMarkedRanges.length === 0}
                className="px-3 py-1 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-xs font-semibold"
              >
                Annotate ({markedWords.size + phraseMarkedRanges.length})
              </button>

              {isVoiceListening && (
                <span className="text-xs text-red-600 max-w-[180px] truncate" title={voiceStatus}>
                  {voiceStatus}
                </span>
              )}

              <div className="flex items-center gap-3 text-xs text-muted">
                <button
                  onClick={() => {
                    if (todayAnnotations.count > 0 && todayAnnotations.words.length > 0) {
                      todayAnnotations.words.forEach(item => addToCardHistory(item.type, item.word));
                    } else if (todayAnnotations.count > 0 && todayAnnotations.words.length === 0) {
                      alert('Today\'s word list is empty. This might be from an old version. New annotations will be tracked.');
                    } else {
                      alert('No annotations today yet!');
                    }
                  }}
                  className="hover:bg-indigo-50 px-1 py-0.5 rounded cursor-pointer transition-colors"
                  title="Click to show today's cards"
                >
                  Today: <span className="font-semibold text-indigo-600">{todayAnnotations.count}</span>
                </button>
                <span>Known: <span className="font-semibold text-green-600">{knownWords.size}</span></span>
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setReviewSortMode(prev => prev === 'stats' ? 'date' : 'stats')}
              className={`px-3 py-1.5 rounded-lg text-xs border font-semibold ${
                reviewSortMode === 'stats'
                  ? 'bg-indigo-500 text-white border-indigo-500'
                  : 'border-border hover:bg-hover'
              }`}
            >
              Statistics
            </button>
            <button
              onClick={() => setReviewSortMode('date')}
              className={`px-3 py-1.5 rounded-lg text-xs border font-semibold ${
                reviewSortMode === 'date'
                  ? 'bg-indigo-500 text-white border-indigo-500'
                  : 'border-border hover:bg-hover'
              }`}
            >
              By Date
            </button>
            <button
              onClick={() => setReviewSortMode('alphabet')}
              className={`px-3 py-1.5 rounded-lg text-xs border font-semibold ${
                reviewSortMode === 'alphabet'
                  ? 'bg-indigo-500 text-white border-indigo-500'
                  : 'border-border hover:bg-hover'
              }`}
            >
              A-Z
            </button>
          </div>
        )}

        <div className="flex-1"></div>

        {/* Bookmark Button */}
        {viewMode === 'read' && currentDocument && (
          <button
            onClick={handleJumpToBookmark}
            className="px-2 py-1 border border-red-300 bg-red-500 text-white rounded-lg hover:bg-red-600 text-xs font-semibold"
            title="Jump to latest bookmark"
            disabled={!getLatestBookmark(currentDocument.id)}
          >
            M
          </button>
        )}

        {/* Settings Button */}
        <button
          onClick={() => setShowSettings(true)}
          className="px-2 py-1 border border-border rounded-lg hover:bg-hover text-xs"
          title="Settings"
        >
          SET
        </button>
      </div>

      {/* Main Layout: Three Columns */}
      <div className="flex-1 flex gap-3 p-3 min-h-0">
        {/* Left Panel: Outline - Notion Style Sidebar */}
        {!isOutlineCollapsed && (
          <aside 
            className="w-[260px] border border-border rounded-2xl overflow-hidden bg-white flex flex-col min-h-0 transition-all duration-300 ease-in-out"
            style={{ minWidth: '260px' }}
            onMouseEnter={() => setIsOutlineHovered(true)}
            onMouseLeave={() => setIsOutlineHovered(false)}
          >
            <div className="px-3 py-3 border-b border-border bg-panel font-bold flex items-center justify-between">
              <span>Outline</span>
              {/* Collapse button - only visible on hover */}
              <button
                onClick={() => setIsOutlineCollapsed(true)}
                className={`w-6 h-6 flex items-center justify-center hover:bg-gray-200 rounded transition-all flex-shrink-0 ${
                  isOutlineHovered ? 'opacity-100' : 'opacity-0'
                }`}
                title="Hide outline"
              >
                <span className="text-gray-600 text-sm font-bold">x</span>
              </button>
            </div>
            <div className="flex-1 p-3 overflow-auto">
              {/* 婵犵數濮烽弫鍛婃叏閻戝鈧倹绂掔€ｎ亞鍔﹀銈嗗坊閸嬫捇鏌涢悢閿嬪仴闁糕斁鍋撳銈嗗坊閸嬫挾绱撳鍜冭含妤犵偛鍟灒閻犲洩灏欑粣鐐烘煙閻撳海鎽犵紒瀣姇鏁堟俊銈呮噺閳锋垿鎮峰▎蹇擃仼闁告柣鍊濋弻娑㈡偄闁垮浠撮悹渚灦閺屾稑鈽夊Ο鍏兼喖闂佺粯鎸婚惄顖炲蓟濞戞矮娌柛鎾楀本娈瑰┑鐘灱濞夋稓鈧矮鍗冲濠氬即閵忕姴鑰垮┑掳鍊愰崑鎾绘煃瑜滈崜娆撴倶濠靛鏁?EPUB闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熸潏鍓х暠閻庢艾顦伴妵鍕箳閸℃ぞ澹曢梺鍙ョ串缁蹭粙鈥︾捄銊﹀磯闁惧繐婀辨导鍥⒑濞茶骞栨俊顐ｇ箞瀵槒顦剁紒鐘崇洴楠炴澹曠€ｎ剦鏀ㄩ梺鑽ゅ枑缁秴顭垮Ο渚劷闁跨喓濮撮拑鐔兼煏閸繍妲稿ù鑲╁█閺屾盯寮撮妸銉ょ爱闂佺顑嗛幑鍥嵁閺嶃劍濯寸紒瀣硶閳ь剦鍘奸—鍐Χ閸涱垳顔囧┑鈽嗗亝閻熲晛鐣?*/}
              {currentDocument?.type === 'epub' && currentDocument.chapters ? (
                <>
                  {/* EPUB 婵犵數濮烽弫鎼佸磻閻愬搫鍨傞悹杞扮秿濞戙垹绠ｉ柣鎰缁犳岸姊洪幖鐐插姶闁告挻宀稿畷鏇㈠箻缂佹鍘遍梺鍝勬储閸斿矂鎮橀悩缁樼厱闁硅埇鍔屾禍楣冩⒒閸屾瑧鍔嶉柟顔肩埣瀹曟洖煤椤忓嫮顦梺鎸庢礀閸婄效?*/}
                  <button
                    onClick={() => setCurrentDocument('')}
                    className="w-full mb-3 px-3 py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-800 text-sm font-semibold flex items-center gap-2"
                  >
                    Back to Documents
                  </button>
                  <div className="px-3 py-2 mb-2 font-bold text-lg border-b border-border">
                    Book {currentDocument.title}
                  </div>
                  {currentDocument.author && (
                    <div className="px-3 py-1 mb-3 text-xs text-muted">
                      by {currentDocument.author}
                    </div>
                  )}
                  
                  {/* 缂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏇楀亾妞ゎ偄绻掔槐鎺懳熺拠鎻掍紟闂備胶绮崝锕傚礂濞戞碍宕查柛鈩兦滄禍婊堟煙閹冭埞闁诲繆鏅濈槐鎺楀焵椤掑嫬骞㈡俊顖氭贡缁犳岸姊洪棃娑氬闁瑰啿閰ｉ、鏃堝Ψ閳哄倻鍘?*/}
                  <div className="text-xs text-muted mb-2 px-3">Chapters ({currentDocument.chapters.length})</div>
                  {currentDocument.chapters.map((chapter: Chapter, idx: number) => {
                    // Check if this chapter contains the bookmark
                    const currentBookmark = getLatestBookmark(currentDocument.id);
                    const hasBookmark = currentBookmark && 
                      currentBookmark.chapterId === chapter.id;
                    
                    return (
                      <div
                        key={chapter.id}
                        onClick={() => setCurrentChapter(chapter.id)}
                        className={`px-3 py-2 rounded-lg cursor-pointer flex items-start gap-2 ${
                          chapter.id === currentDocument.currentChapterId
                            ? 'bg-active font-semibold'
                            : 'hover:bg-hover'
                        }`}
                      >
                        <span className="text-muted min-w-[24px]">{idx + 1}.</span>
                        <span className="flex-1">{chapter.title}</span>
                        {hasBookmark && (
                          <span className="text-[10px] font-semibold text-white bg-red-500 rounded px-1.5 py-0.5">
                            M
                          </span>
                        )}
                      </div>
                    );
                  })}
                  
                  {/* 闂傚倸鍊风粈渚€骞栭位鍥敃閿曗偓閻ょ偓绻濇繝鍌滃闁藉啰鍠栭弻鏇熺箾閸喖澹勫┑鐐叉▕娴滄粓宕橀埀顒€顪冮妶鍡樺暗闁稿鍋よ棢婵犻潧顑嗛埛鎴︽煙閼测晛浠滈柛鏃€锕㈤弻娑㈠棘閸柭ゅ惈闂佺硶鏂侀崑鎾愁渻閵堝棗鍧婇柛瀣崌閺屾稒绻濋崒婊€铏庨梺浼欑到閸㈡煡锝炲┑瀣垫晞闁冲搫鍊归ˉ鍫⑩偓瑙勬礈閸犳牠宕洪悙鍝勭畾鐟滃本绔熼弴銏♀拺闁告稑锕ゆ慨锕傛煕閻樺磭澧辩紒顔碱煼瀵泛鈻庨崜褍鏁搁梻浣稿悑閹倸顭囪閹便劑宕奸妷锕€鈧?*/}
                </>
              ) : currentDocument?.format === 'markdown' && markdownOutlineEntries.length > 0 ? (
                <>
                  <button
                    onClick={() => setCurrentDocument('')}
                    className="w-full mb-3 px-3 py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-800 text-sm font-semibold flex items-center gap-2"
                  >
                    Back to Documents
                  </button>
                  <div className="px-3 py-2 mb-2 font-bold text-lg border-b border-border">
                    {currentDocument.title}
                  </div>
                  <div className="text-xs text-muted mb-2 px-3">Headings ({markdownOutlineEntries.length})</div>
                  {markdownOutlineEntries.map((entry, idx) => (
                    <button
                      key={`${entry.paragraphIndex}-${idx}`}
                      onClick={() => handleJumpToParagraph(entry.paragraphIndex)}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-hover flex items-start gap-2 min-w-0"
                      style={{ paddingLeft: `${0.75 + Math.max(0, entry.level - 1) * 0.85}rem` }}
                      title={entry.title}
                    >
                      <span className="text-[10px] font-semibold text-stone-500 min-w-[28px] pt-0.5">
                        H{entry.level}
                      </span>
                      <span
                        className={`flex-1 min-w-0 truncate ${entry.level === 1 ? 'font-bold' : entry.level === 2 ? 'font-semibold' : 'text-sm'}`}
                        title={entry.title}
                      >
                        {entry.title}
                      </span>
                    </button>
                  ))}
                </>
              ) : (
                /* 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐蹭簻濡炪倖甯掗崐缁樼▔瀹ュ鐓欓弶鍫濆⒔閻ｉ亶鏌涢妸銉モ偓褰掑Φ閸曨垰鍐€妞ゆ劦婢€缁爼姊洪崨濠勬噧闁挎洦浜璇测槈閵忕姷顔掑┑锛勫仧閸嬫捇藝妞嬪海纾兼い鏃傚亾閺嗩剚鎱ㄦ繝鍐┿仢鐎规洦鍋婂畷鐔碱敃閻旇渹澹曠紓浣割儐閿涙洖煤椤忓懏娅囬梺绋挎湰椤曢亶濡烽埡鍌滃幈閻庡厜鍋撻柍褜鍓熷畷鎴濃槈濮樿京鐒奸梺绯曞墲鐪夌紒璇叉閺屾洟宕煎┑鍥ф濡炪倕绻堥崕鐢稿蓟?*/
                <>
                  {documents.map((doc: Document) => (
                    <div
                      key={doc.id}
                      onClick={() => {
                        if (pendingDeleteDocumentId === doc.id) return;
                        setCurrentDocument(doc.id);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setPendingDeleteDocumentId((current) => (current === doc.id ? null : doc.id));
                      }}
                      className={`px-3 py-2 rounded-lg flex items-center justify-between gap-2 cursor-pointer ${
                        pendingDeleteDocumentId === doc.id
                          ? 'bg-red-50 border border-red-200'
                          : doc.id === currentDocumentId
                            ? 'bg-active font-bold'
                            : 'hover:bg-hover'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0 flex-1">
                        <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                          doc.type === 'epub'
                            ? 'bg-amber-100 text-amber-800'
                            : doc.format === 'markdown'
                              ? 'bg-zinc-100 text-zinc-700'
                              : 'bg-sky-100 text-sky-700'
                        }`}>
                          {doc.type === 'epub' ? 'EPUB' : doc.format === 'markdown' ? 'MD' : 'TXT'}
                        </span>
                        <span className="truncate" title={doc.title}>{doc.title}</span>
                      </span>
                      {pendingDeleteDocumentId === doc.id ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeleteLoadedDocument(doc);
                          }}
                          className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-600 text-white hover:bg-red-700 flex-shrink-0"
                          title="Remove from loaded documents"
                        >
                          ×
                        </button>
                      ) : doc.type === 'epub' && doc.chapters ? (
                        <span className="text-xs text-muted">{doc.chapters.length} ch</span>
                      ) : null}
                      {pendingDeleteDocumentId !== doc.id && (
                        <span className="sr-only">Right click to show remove action</span>
                      )}
                    </div>
                  ))}

                  <div className="text-xs text-muted mt-3 mb-1">Documents</div>
                  <div
                    className="px-3 py-2 rounded-lg hover:bg-hover flex items-center justify-between cursor-pointer text-sm"
                    onClick={handleNewDocument}
                  >
                    <span>+ New document</span>
                  </div>
                  <div
                    className="px-3 py-2 rounded-lg hover:bg-hover flex items-center justify-between cursor-pointer text-sm"
                    onClick={handleFileImport}
                  >
                    <span>Import file</span>
                  </div>
                  <div className="text-xs text-muted mt-3 mb-1">{serverLibraryStatus}</div>
                  {serverLibraryBooks.map((book) => (
                    <div
                      key={book.fileName}
                      onClick={() => void handleLoadServerBook(book)}
                      className="px-3 py-2 rounded-lg hover:bg-hover flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <span className="flex items-center gap-2 min-w-0 flex-1">
                        <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                          book.type === 'epub'
                            ? 'bg-amber-100 text-amber-800'
                            : book.format === 'markdown'
                              ? 'bg-zinc-100 text-zinc-700'
                              : 'bg-sky-100 text-sky-700'
                        }`}>
                          {book.type === 'epub' ? 'EPUB' : book.format === 'markdown' ? 'MD' : 'TXT'}
                        </span>
                        <span className="truncate" title={book.title}>{book.title}</span>
                      </span>
                      <span className="text-xs text-muted whitespace-nowrap">
                        {loadingServerBookName === book.fileName ? 'Loading...' : new Date(book.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </aside>
        )}

        {/* Center Panel */}
        <main className="flex-1 border border-border rounded-2xl overflow-hidden bg-white flex flex-col min-h-0">
          <div
            id="main-scroll-container"
            className="flex-1 p-3 overflow-auto"
            onMouseUp={viewMode === 'read' ? handleTextSelection : undefined}
          >
            {viewMode === 'read' ? (currentDocument ? (
              <>
                <div className="text-2xl font-extrabold mb-2 flex items-center justify-between">
                  {/* Previous chapter button */}
                  {currentDocument.type === 'epub' && currentDocument.chapters && currentDocument.currentChapterId && (() => {
                    const currentChapterIndex = currentDocument.chapters.findIndex(
                      (c: Chapter) => c.id === currentDocument.currentChapterId
                    );
                    const hasPrevChapter = currentChapterIndex > 0;
                    return (
                      <button
                        onClick={() => {
                          if (hasPrevChapter && currentDocument.chapters) {
                            const prevChapter = currentDocument.chapters[currentChapterIndex - 1];
                            setCurrentChapter(prevChapter.id);
                            setTimeout(() => {
                              const scrollContainer = document.getElementById('main-scroll-container');
                              if (scrollContainer) {
                                scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
                              }
                            }, 200);
                          }
                        }}
                        disabled={!hasPrevChapter}
                        className={`w-8 h-8 flex items-center justify-center rounded-lg ${
                          hasPrevChapter 
                            ? 'hover:bg-gray-100 cursor-pointer' 
                            : 'opacity-30 cursor-not-allowed'
                        }`}
                        title="Previous chapter"
                      >
                        &lt;
                      </button>
                    );
                  })()}
                  
                  {/* Chapter title */}
                  <div className={`flex-1 ${currentDocument.format === 'markdown' ? 'text-left pl-1' : 'text-center'}`}>
                    {currentDocument.type === 'epub' && currentChapter
                      ? currentChapter.title
                      : currentDocument.title}
                  </div>
                  
                  {/* Next chapter button */}
                  {currentDocument.type === 'epub' && currentDocument.chapters && currentDocument.currentChapterId && (() => {
                    const currentChapterIndex = currentDocument.chapters.findIndex(
                      (c: Chapter) => c.id === currentDocument.currentChapterId
                    );
                    const hasNextChapter = currentChapterIndex !== -1 && currentChapterIndex < currentDocument.chapters.length - 1;
                    return (
                      <button
                        onClick={() => {
                          if (hasNextChapter && currentDocument.chapters) {
                            const nextChapter = currentDocument.chapters[currentChapterIndex + 1];
                            setCurrentChapter(nextChapter.id);
                            setTimeout(() => {
                              const scrollContainer = document.getElementById('main-scroll-container');
                              if (scrollContainer) {
                                scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
                              }
                            }, 200);
                          }
                        }}
                        disabled={!hasNextChapter}
                        className={`w-8 h-8 flex items-center justify-center rounded-lg ${
                          hasNextChapter 
                            ? 'hover:bg-gray-100 cursor-pointer' 
                            : 'opacity-30 cursor-not-allowed'
                        }`}
                        title="Next chapter"
                      >
                        &gt;
                      </button>
                    );
                  })()}
                </div>
                <div className="text-xs text-muted mb-4 leading-relaxed">
                  {currentDocument.type === 'epub' && currentChapter ? (
                    <>
                      Book {currentDocument.title}
                      {currentDocument.author && <> by {currentDocument.author}</>}
                      <span className="mx-2">?</span>
                      {displayParagraphs.length} paragraphs
                    </>
                  ) : (
                    <>{displayParagraphs.length} paragraphs</>
                  )}
                </div>

                {displayParagraphs.map((paragraph: ParagraphType, pIdx: number) => {
                  const currentLocationForFocus = currentSentenceIndex !== null
                    ? getAllSentenceLocations()[currentSentenceIndex]
                    : null;
                  const hideForFocus = immersiveMode && currentLocationForFocus && currentLocationForFocus.paragraphIndex !== pIdx;
                  // Calculate global sentence indices for this paragraph
                  let sentencesBeforeThisPara = 0;
                  for (let i = 0; i < pIdx; i++) {
                    sentencesBeforeThisPara += displayParagraphs[i].sentences.length;
                  }

                  // Check if this paragraph has a bookmark
                  const currentBookmark = currentDocument ? getLatestBookmark(currentDocument.id) : null;
                  const hasBookmark = currentBookmark && 
                    currentBookmark.paragraphIndex === pIdx &&
                    // For EPUB, also check chapter matches
                    (!currentDocument.currentChapterId || currentBookmark.chapterId === currentDocument.currentChapterId);

                  return (
                    <div
                      key={paragraph.id}
                      data-paragraph-index={pIdx}
                      onContextMenu={(e) => handleContextMenu(e, pIdx, 0)}
                      className={`relative group transition-all hover:bg-gray-100 ${hideForFocus ? 'hidden' : ''}`}
                    >
                      {/* Bookmark indicator */}
                      {hasBookmark && (
                        <div className="absolute left-[-20px] top-1 w-2.5 h-6 rounded bg-red-500 shadow-sm">
                        </div>
                      )}
                      
                      <Paragraph
                        paragraph={paragraph}
                        renderMode={currentDocument.format === 'markdown' ? 'markdown' : 'default'}
                        paragraphIndex={pIdx}
                        knownWords={knownWords}
                        markedWords={markedWords}
                        phraseMarkedRanges={phraseMarkedRanges}
                        annotatedPhraseRanges={annotatedPhraseRanges}
                        underlinePhraseRanges={underlinePhraseRanges}
                      learntWords={learntWords}
                      annotations={annotations}
                      phraseAnnotations={phraseAnnotations}
                      phraseTranslationInserts={phraseTranslationInserts}
                      sentenceCardKeys={sentenceCardKeys}
                      showIPA={showIPA}
                      showChinese={showChinese}
                      autoMark={autoMark}
                      autoPronounceSetting={autoPronounceSetting}
                      onWordClick={handleWordClick}
                      onPhraseClick={handlePhraseClick}
                      onSentenceCardClick={handleSentenceCardClick}
                      onMarkKnown={handleMarkKnown}
                      onSentenceContextMenu={(e, payload) => handleContextMenu(e, payload.pIndex, payload.sIndex, payload.text, payload.focusWords)}
                      currentSentenceIndex={currentSentenceIndex}
                      currentWordIndex={currentWordIndex}
                      sentencesBeforeThisPara={sentencesBeforeThisPara}
                    />
                    </div>
                  );
                })}
                
                {/* Finish Button at the bottom of document */}
                {currentDocument && (() => {
                  // Check if there's a next chapter
                  let hasNextChapter = false;
                  if (currentDocument.type === 'epub' && currentDocument.chapters && currentDocument.currentChapterId) {
                    const currentChapterIndex = currentDocument.chapters.findIndex(
                      (c: Chapter) => c.id === currentDocument.currentChapterId
                    );
                    if (currentChapterIndex !== -1 && currentChapterIndex < currentDocument.chapters.length - 1) {
                      hasNextChapter = true;
                    }
                  }
                  
                  return (
                    <div className="mt-6 pb-6 flex justify-center">
                      <button
                        onClick={handleFinishDocument}
                        className="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 font-semibold shadow-md"
                        title="Mark all unannotated words as known"
                      >
                        {hasNextChapter ? 'Finish -> Next Chapter' : 'Finish Reading'}
                      </button>
                    </div>
                  );
                })()}
              </>
            ) : (
              <>
                <div className="text-2xl font-extrabold mb-2">Welcome to LexiLand Read</div>
                <div className="text-xs text-muted mb-4 leading-relaxed">
                  A language learning assistant powered by AI.
                </div>
                <div className="text-sm text-muted">
                  Click "Load sample" or "Import file" to start reading.
                </div>
              </>
            )) : (
              <>
                <div className="text-2xl font-extrabold mb-2">Review Cards</div>
                <div className="text-xs text-muted mb-4 leading-relaxed">
                  Browse every saved word card and phrase card in a two-column review board.
                </div>

                {reviewSortMode === 'stats' && renderReviewStatsPanel()}

                <div className="flex items-center justify-between gap-3 mb-4 text-xs text-muted">
                  <div>
                    Cards (<span className="font-semibold text-gray-700">{reviewVisibleCards.length}</span>)
                  </div>
                  <div className="flex items-center gap-2">
                    {reviewSortMode === 'stats' && reviewVisibleCards.length > 0 && (
                      <button
                        onClick={() => {
                          handleClearReviewCards();
                        }}
                        className="px-3 py-1 border border-red-300 text-red-600 rounded-lg hover:bg-red-50"
                        title="Clear all expanded cards"
                      >
                        Clear all
                      </button>
                    )}
                    {reviewSortMode === 'stats' && reviewSelectedBucketKey && (
                      <button
                        onClick={() => {
                          setReviewSelectedBucketKey(null);
                          setExpandedCardKeys(new Set());
                        }}
                        className="px-3 py-1 border border-border rounded-lg hover:bg-hover"
                      >
                        Clear selection
                      </button>
                    )}
                  </div>
                </div>

                {reviewVisibleCards.length === 0 ? (
                  <div className="text-sm text-muted leading-relaxed">
                    {reviewSortMode === 'stats'
                      ? 'Card pool is empty. Click a day or month above to load cards in collapsed view.'
                      : 'No cards yet. Annotate words or phrases in `read` mode first.'}
                  </div>
                ) : (
                  renderReviewBoard()
                )}
              </>
            )}
          </div>
        </main>

        {/* Right Panel: Cards */}
        {viewMode === 'read' && (
        <aside className="w-[360px] flex flex-col min-h-0 overflow-auto" style={{ minWidth: '360px' }}>
          {isLoadingAnnotation && (
            <div className="border border-border rounded-2xl p-3 bg-white mb-3">
              <div className="text-sm text-muted">Loading annotation...</div>
            </div>
          )}

          {/* Card History - 婵犵數濮烽弫鍛婃叏閻㈠壊鏁婇柡宥庡幖缁愭鏌″搴″季闁轰礁瀚伴弻娑㈠Ψ閵忊剝鐝旈梺鎼炲妽缁诲牓寮婚悢鐓庣闁逛即娼у▓顓㈡⒑閸涘﹦鎳冮柨鏇ㄤ邯瀵鈽夐姀鐘殿啋濠碉紕鍋熼崑鎾凰囨搴ｇ＜妞ゆ梻鍋撻弳顒佹叏婵犲啯銇濈€规洜鍏橀、妯款槼婵絽鐭傚铏圭矙濞嗘儳鍓遍梺鍦嚀濞差厼顕ｆ繝姘櫢闁绘ɑ鐓￠崬璺衡攽閻樿尙浠涢柛鏃€鐗滈悷褔姊虹拠鏌ヮ€楁繝鈧柆宥佲偓锕傚醇閵夆懇鍋撻敃鈧悾锟犲箥椤旇姤顔曢梻浣瑰缁诲倿藝椤栨粎涓嶉柣銏犳啞閻撴瑩鏌ｉ幋鐏活亪鎮橀妷鈺傜厾闁哄瀵ч崑銉︽叏?*/}
          <div className="border border-border rounded-2xl p-3 bg-white mb-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-muted">Cards ({cardHistory.length})</div>
                {cardHistory.length > 0 && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        if (hiddenTranslations.size === 0) {
                          // Hide all translations
                          const allWords = cardHistory.map(item => `${item.type}-${item.word}`);
                          setHiddenTranslations(new Set(allWords));
                        } else {
                          // Show all translations
                          setHiddenTranslations(new Set());
                        }
                      }}
                      className="text-xs px-2 py-0.5 text-blue-600 hover:bg-blue-50 rounded border border-blue-300"
                      title={hiddenTranslations.size === 0 ? "Hide all translations for self-testing" : "Show all translations"}
                    >
                      {hiddenTranslations.size === 0 ? 'Hide' : 'Show'}
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('Clear all cards from history?')) {
                          // Clear all cards
                          cardHistory.forEach(item => removeFromCardHistory(item.word));
                          setHiddenTranslations(new Set());
                        }
                      }}
                      className="text-xs px-2 py-0.5 text-red-600 hover:bg-red-50 rounded border border-red-300"
                      title="Clear all cards"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
              <div className="h-px bg-border my-2"></div>
              
              {cardHistory.length === 0 ? (
                <div className="text-sm text-muted leading-relaxed">
                  Double-click an orange word to see its card, or select a phrase and click Annotate.
                </div>
              ) : (
                <div className="space-y-2 max-h-[calc(100vh-200px)] overflow-y-auto">
                  {cardHistory.map((item: { type: LearningCardType; word: string; timestamp: number }) => {
                    const annotation = item.type === 'word' 
                      ? (annotations.get(item.word) || findAnnotationEntry(annotations, item.word)?.annotation)
                      : phraseAnnotations.get(item.word.toLowerCase());

                    if (!annotation) return null;

                    const reviewItem: ReviewCardItem = item.type === 'word'
                      ? {
                          type: 'word',
                          word: (annotation as WordAnnotation).word,
                          normalizedWord: getWordCardIdentity(annotation as WordAnnotation),
                          lookupKey: item.word,
                          cardKey: `word-${item.word}`,
                          displayLabel: getWordCardDisplayLabel(annotation as WordAnnotation),
                          annotation: annotation as WordAnnotation,
                          cachedAt: (annotation as WordAnnotation).cachedAt || 0,
                        }
                      : {
                          type: (annotation as PhraseAnnotation).cardType || item.type,
                          word: item.word,
                          normalizedWord: item.word.toLowerCase(),
                          cardKey: `${(annotation as PhraseAnnotation).cardType || item.type}-${item.word.toLowerCase()}`,
                          lookupKey: item.word.toLowerCase(),
                          annotation: annotation as PhraseAnnotation,
                          cachedAt: (annotation as PhraseAnnotation).cachedAt || 0,
                        };

                    return renderCardItem(reviewItem, 'read');
                  })}
                </div>
              )}
            </div>
        </aside>
        )}
      </div>

      {/* New Document Modal */}
      {showNewDocModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-[600px] max-h-[80vh] flex flex-col shadow-2xl">
            <h2 className="text-xl font-bold mb-4">Create New Document</h2>

            <label className="text-sm font-semibold mb-2 block">Title</label>
            <input
              type="text"
              value={newDocTitle}
              onChange={(e) => setNewDocTitle(e.target.value)}
              className="border border-border rounded-lg px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter document title..."
              autoFocus
            />

            <label className="text-sm font-semibold mb-2 block">Content</label>
            <textarea
              value={newDocContent}
              onChange={(e) => setNewDocContent(e.target.value)}
              className="border border-border rounded-lg px-3 py-2 flex-1 min-h-[300px] resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
              placeholder="Paste or type your text here...&#10;&#10;You can use multiple paragraphs.&#10;Press Enter to create new lines."
            />

            <div className="flex gap-3 mt-4 justify-end">
              <button
                onClick={() => {
                  setShowNewDocModal(false);
                  setNewDocTitle('');
                  setNewDocContent('');
                }}
                className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateDocument}
                className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white font-semibold"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-[600px] max-h-[80vh] overflow-auto shadow-2xl">
            <h2 className="text-xl font-bold mb-4">Settings</h2>

            {/* Reading Startup */}
            <div className="mb-6 p-4 border border-border rounded-lg">
              <h3 className="text-sm font-bold mb-3">Reading Startup</h3>
              <div className="space-y-3">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={autoResumeOnOpen}
                    onChange={(e) => setAutoResumeOnOpen(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Resume last reading position</span>
                </label>
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={autoReadOnOpen}
                    onChange={(e) => setAutoReadOnOpen(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Start reading aloud after resume</span>
                </label>
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={immersiveMode}
                    onChange={(e) => setImmersiveMode(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Focus only on current paragraph</span>
                </label>
                <div>
                  <label className="block text-sm mb-1 text-muted">Preferred auto-start time</label>
                  <input
                    type="time"
                    value={autoStartTime}
                    onChange={(e) => setAutoStartTime(e.target.value)}
                    className="px-3 py-2 border border-border rounded-lg bg-white text-sm"
                  />
                </div>
              </div>
            </div>

            {/* Speech Settings */}
            <div className="mb-6 p-4 border border-border rounded-lg">
              <h3 className="text-sm font-bold mb-3">Speech Settings</h3>
              
              {/* Pitch control */}
              <div className="mb-4">
                <label className="block text-sm mb-2">Pitch: {speechPitch.toFixed(1)}</label>
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={speechPitch}
                  onChange={(e) => setSpeechPitch(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
              
              {/* Voice selector */}
              <div className="mb-4">
                <label className="block text-sm mb-2">Voice</label>
                <select
                  className="w-full px-3 py-2 border border-border rounded-lg bg-white text-sm"
                  value={selectedVoice}
                  onChange={(e) => setSelectedVoice(e.target.value)}
                >
                  {availableVoices.map((voice) => (
                    <option key={voice.name} value={voice.name}>
                      {voice.name}
                    </option>
                  ))}
                </select>
              </div>
              
              {/* Auto Pronounce Setting */}
              <label className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoPronounceSetting}
                  onChange={(e) => setAutoPronounceSetting(e.target.checked)}
                  className="w-4 h-4"
                />
                <div>
                  <div className="font-semibold text-sm">Auto Pronounce Words</div>
                  <div className="text-xs text-muted">Automatically read aloud when hovering over a word for 1 second or when clicking it</div>
                </div>
              </label>
              
              {/* Auto Show Card on Play */}
              <label className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoShowCardOnPlay}
                  onChange={(e) => setAutoShowCardOnPlay(e.target.checked)}
                  className="w-4 h-4"
                />
                <div>
                  <div className="font-semibold text-sm">Auto Show Cards During Playback</div>
                  <div className="text-xs text-muted">Show word/phrase cards in the right panel when reading words with annotations (excludes words marked as known)</div>
                </div>
              </label>
            </div>

            {/* Display Settings */}
            <div className="mb-6 p-4 border border-border rounded-lg">
              <h3 className="text-sm font-bold mb-3">Display Settings</h3>
              
              <div className="space-y-3">
                <label className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={showIPA} 
                    onChange={(e) => setShowIPA(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <div>
                    <div className="font-semibold text-sm">Show IPA</div>
                    <div className="text-xs text-muted">Display phonetic transcription for words</div>
                  </div>
                </label>
                
                <label className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={showChinese} 
                    onChange={(e) => setShowChinese(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <div>
                    <div className="font-semibold text-sm">Show Chinese Translation</div>
                    <div className="text-xs text-muted">Display Chinese translations inline</div>
                  </div>
                </label>
              </div>
            </div>

            <div className="mb-6 p-4 border border-border rounded-lg">
              <h3 className="text-sm font-bold mb-3">Book Export Settings</h3>

              <label className="block text-sm mb-2 text-muted">Export format</label>
              <select
                className="w-full px-3 py-2 mb-4 border border-border rounded-lg bg-white text-sm"
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as 'epub' | 'pdf')}
              >
                <option value="epub">EPUB</option>
                <option value="pdf">PDF</option>
              </select>

              <div className="space-y-3">
                <label className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={exportIncludeIPA}
                    onChange={(e) => setExportIncludeIPA(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <div>
                    <div className="font-semibold text-sm">Include IPA</div>
                    <div className="text-xs text-muted">Export phonetic transcription above annotated words</div>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={exportIncludeChinese}
                    onChange={(e) => setExportIncludeChinese(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <div>
                    <div className="font-semibold text-sm">Include Chinese</div>
                    <div className="text-xs text-muted">Embed Chinese annotations directly in the exported text</div>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={exportIncludePhraseTranslations}
                    onChange={(e) => setExportIncludePhraseTranslations(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <div>
                    <div className="font-semibold text-sm">Include Phrase Translations</div>
                    <div className="text-xs text-muted">Keep inserted phrase Chinese inline and show translations in phrase summaries</div>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={exportIncludePhraseList}
                    onChange={(e) => setExportIncludePhraseList(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <div>
                    <div className="font-semibold text-sm">Include Phrase List</div>
                    <div className="text-xs text-muted">List marked phrases at the end of each chapter, preferring reusable patterns</div>
                  </div>
                </label>
              </div>
            </div>

            {/* Reading Level */}
            <div className="mb-6 p-4 border border-border rounded-lg">
              <h3 className="text-sm font-bold mb-3">Reading Level</h3>
              <label className="block text-sm mb-2 text-muted">Words below this level will be automatically marked as known</label>
              <select
                className="w-full px-3 py-2 border border-border rounded-lg bg-white text-sm"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
              >
                <option value="A2">A2 - Elementary</option>
                <option value="B1">B1 - Intermediate</option>
                <option value="B2">B2 - Upper Intermediate</option>
                <option value="C1">C1 - Advanced</option>
              </select>
            </div>

            {/* Annotation Mode Setting */}
            <div className="mb-6 p-4 border border-border rounded-lg">
              <h3 className="text-sm font-bold mb-3">Word Annotation Mode</h3>
              <div className="text-xs text-muted mb-3">
                Choose how words are annotated. (Phrases always use AI)
              </div>
              
              <div className="space-y-2">
                <label className="flex items-start gap-3 p-3 border border-border rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input
                    type="radio"
                    name="annotationMode"
                    value="local-first"
                    checked={annotationMode === 'local-first'}
                    onChange={(e) => setAnnotationMode(e.target.value as 'ai' | 'local' | 'local-first')}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-semibold text-sm">Local Dictionary First (Recommended)</div>
                    <div className="text-xs text-muted">Try local dictionary first, fallback to AI if not found. Fast and cost-effective.</div>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3 border border-border rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input
                    type="radio"
                    name="annotationMode"
                    value="ai"
                    checked={annotationMode === 'ai'}
                    onChange={(e) => setAnnotationMode(e.target.value as 'ai' | 'local' | 'local-first')}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-semibold text-sm">AI Only</div>
                    <div className="text-xs text-muted">Always use AI for word annotation. Slower but provides context-aware definitions.</div>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3 border border-border rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input
                    type="radio"
                    name="annotationMode"
                    value="local"
                    checked={annotationMode === 'local'}
                    onChange={(e) => setAnnotationMode(e.target.value as 'ai' | 'local' | 'local-first')}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-semibold text-sm">Local Dictionary Only</div>
                    <div className="text-xs text-muted">Only use local dictionary. Very fast, free, but limited vocabulary (core ~5000 words).</div>
                  </div>
                </label>
              </div>
            </div>

            <div className="mb-6 p-4 border border-border rounded-lg">
              <h3 className="text-sm font-bold mb-3">Sentence Card AI Provider</h3>
              <div className="text-xs text-muted mb-3">
                Right-click a sentence and choose `Translate & Analyze`. The analysis is written in English, while the sentence translation stays in Chinese.
              </div>

              <div className="space-y-2">
                <label className="flex items-start gap-3 p-3 border border-border rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input
                    type="radio"
                    name="sentenceCardProvider"
                    value="local"
                    checked={sentenceCardProvider === 'local'}
                    onChange={(e) => setSentenceCardProvider(e.target.value as 'openai' | 'local')}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-semibold text-sm">Local Qwen 2.5 7B</div>
                    <div className="text-xs text-muted">Use the local Ollama model for sentence translation and grammar analysis.</div>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3 border border-border rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input
                    type="radio"
                    name="sentenceCardProvider"
                    value="openai"
                    checked={sentenceCardProvider === 'openai'}
                    onChange={(e) => setSentenceCardProvider(e.target.value as 'openai' | 'local')}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-semibold text-sm">OpenAI API</div>
                    <div className="text-xs text-muted">Use the cloud API for sentence cards when you want stronger analysis quality.</div>
                  </div>
                </label>
              </div>
            </div>

            <div className="mb-6 p-4 border border-border rounded-lg">
              <h3 className="text-sm font-bold mb-3">Phrase Card AI Provider</h3>
              <div className="text-xs text-muted mb-3">
                Controls phrase, grammar, and paragraph card generation. Switch this to OpenAI if the local model is too slow.
              </div>

              <div className="space-y-2">
                <label className="flex items-start gap-3 p-3 border border-border rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input
                    type="radio"
                    name="phraseCardProvider"
                    value="openai"
                    checked={phraseCardProvider === 'openai'}
                    onChange={(e) => setPhraseCardProvider(e.target.value as 'openai' | 'local')}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-semibold text-sm">OpenAI API</div>
                    <div className="text-xs text-muted">Faster and generally better for phrase cards if you have API access.</div>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3 border border-border rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input
                    type="radio"
                    name="phraseCardProvider"
                    value="local"
                    checked={phraseCardProvider === 'local'}
                    onChange={(e) => setPhraseCardProvider(e.target.value as 'openai' | 'local')}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-semibold text-sm">Local Qwen 2.5 7B</div>
                    <div className="text-xs text-muted">Uses the local Ollama model. No API cost, but slower on longer phrase analysis.</div>
                  </div>
                </label>
              </div>
            </div>

            {/* Dictionary Info */}
            <div className="mb-6 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="text-sm font-semibold text-blue-900 mb-1">Local Dictionary Status</div>
              <div className="text-xs text-blue-700">
                {localDictionary.getStats().isLoaded 
                  ? `? Loaded: ${localDictionary.getStats().totalWords} words` 
                  : '? Not loaded yet'}
              </div>
            </div>
            
            {/* Data Management */}
            <div className="mb-6 p-4 border border-border rounded-lg">
              <h3 className="text-sm font-bold mb-3">Data Management</h3>
              
              <div className="space-y-2">
                <button
                  onClick={handleLoadSample}
                  className="w-full px-4 py-2 border border-border rounded-lg hover:bg-hover text-sm"
                >
                  Load Sample Text
                </button>

                <button
                  onClick={handleDeleteSampleLemmaTestCards}
                  className="w-full px-4 py-2 border border-red-500 bg-red-50 text-red-700 hover:bg-red-100 rounded-lg text-sm font-semibold"
                  title='Delete all word cards whose document title is "Sample Lemma Test"'
                >
                  Delete Sample Lemma Test Cards
                </button>
                
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowExportMenu(!showExportMenu);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowExportMenu(!showExportMenu);
                    }}
                    className="w-full px-4 py-2 border border-green-500 bg-green-50 text-green-700 hover:bg-green-100 rounded-lg text-sm font-semibold"
                    title="Export book or data"
                  >
                    Export
                  </button>
                  
                  {/* Export Context Menu */}
                  {showExportMenu && (
                    <div 
                      className="absolute top-full left-0 mt-1 bg-white border border-border rounded-lg shadow-lg z-20 min-w-full"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => {
                          handleExportBook();
                          setShowExportMenu(false);
                        }}
                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 rounded-t-lg"
                      >
                        Export Book ({exportFormat.toUpperCase()})
                      </button>
                      <button
                        onClick={() => {
                          handleExportBook('epub');
                          setShowExportMenu(false);
                        }}
                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100"
                      >
                        Export Book as EPUB
                      </button>
                      <button
                        onClick={() => {
                          handleExportBook('pdf');
                          setShowExportMenu(false);
                        }}
                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100"
                      >
                        Export Book as PDF
                      </button>
                      <button
                        onClick={() => {
                          handleExportData();
                          setShowExportMenu(false);
                        }}
                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100"
                      >
                        Export All Data (JSON)
                      </button>
                      <button
                        onClick={() => {
                          handleExportLLIF();
                          setShowExportMenu(false);
                        }}
                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100"
                      >
                        Export LLIF (Universal)
                      </button>
                      <button
                        onClick={() => {
                          handleExportKnownWords();
                          setShowExportMenu(false);
                        }}
                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 rounded-b-lg"
                      >
                        Export Known Words (TXT)
                      </button>
                    </div>
                  )}
                </div>
                
                <button
                  onClick={handleImportData}
                  className="w-full px-4 py-2 border border-blue-500 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-sm font-semibold"
                  title="Import user data from JSON file"
                >
                  Import Data
                </button>

                <div className="h-px bg-border my-2" />

                <button
                  onClick={handleSaveToFixedStorage}
                  className="w-full px-4 py-2 border border-purple-500 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-lg text-sm font-semibold"
                  title="Save current user data to fixed learning folder"
                >
                  Save to Fixed Storage
                </button>

                <button
                  onClick={handleLoadFromFixedStorage}
                  className="w-full px-4 py-2 border border-indigo-500 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg text-sm font-semibold"
                  title="Load latest backup from fixed learning folder"
                >
                  Load from Fixed Storage
                </button>

                <button
                  onClick={handleCheckFixedStorageStatus}
                  className="w-full px-4 py-2 border border-gray-400 bg-gray-50 text-gray-700 hover:bg-gray-100 rounded-lg text-xs"
                  title="Check fixed storage status"
                >
                  Fixed Storage Status: {fixedStorageStatus}
                </button>

                <label className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg bg-white">
                  <input
                    type="checkbox"
                    checked={autoFixedBackupEnabled}
                    onChange={(e) => setAutoFixedBackupEnabled(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-xs text-gray-700">
                    Auto backup to fixed storage (on startup + every 5 min)
                  </span>
                </label>
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={handleSetCurrentAsDefault}
                className="px-4 py-2 rounded-lg border border-emerald-500 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-semibold"
                title="Save the current settings as the startup default"
              >
                Set Current as Default
              </button>
              <button
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Collapsed Card Emoji Tools (right-click) */}
      {collapsedImageMenu && (
        <>
          <div
            className="fixed inset-0 z-[9998]"
            onClick={() => setCollapsedImageMenu(null)}
          />
          <div
            className="fixed z-[9999] bg-white border-2 border-gray-300 rounded-lg shadow-2xl p-3 w-[21rem] max-h-96 overflow-hidden flex flex-col"
            style={{ top: collapsedImageMenu.top, left: collapsedImageMenu.left }}
            onClick={(e) => e.stopPropagation()}
            onPaste={collapsedImageMenu.panel === 'web' ? handleCollapsedPasteEvent : undefined}
          >
            {collapsedImageMenu.panel === 'emoji' ? (
              <>
                <div className="text-xs text-gray-600 mb-2 font-semibold">Select an emoji:</div>
                <input
                  type="text"
                  value={collapsedEmojiSearchQuery}
                  onChange={(e) => setCollapsedEmojiSearchQuery(e.target.value)}
                  placeholder="Search emoji (e.g., hand, smile)..."
                  className="w-full px-3 py-2 mb-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
                <div className="overflow-y-auto max-h-56 mb-2">
                  <div className="grid grid-cols-10 gap-1">
                    {getCollapsedFilteredEmojis().map((emoji, index) => (
                      <button
                        key={`${emoji}-${index}`}
                        onClick={() => handleCollapsedSelectEmoji(emoji)}
                        className="text-2xl hover:bg-gray-100 rounded p-1 transition-colors"
                        title={emoji}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  onClick={openCollapsedWebImage}
                  className="w-full py-1 mb-2 text-sm bg-blue-100 text-blue-700 hover:bg-blue-200 rounded"
                >
                  Web Image Helper
                </button>
                <button
                  onClick={() => setCollapsedImageMenu(null)}
                  className="w-full py-1 text-sm bg-gray-200 hover:bg-gray-300 rounded"
                >
                  Close
                </button>
              </>
            ) : (
              <>
                <div className="text-xs text-gray-700 mb-2 font-semibold">Web Image Helper</div>
                <div className="text-xs text-gray-500 mb-2 leading-relaxed">
                  1) Open Google Images with keyword
                  <br />
                  2) Copy an image
                  <br />
                  3) Click "Paste from Clipboard" or press Ctrl/Cmd+V directly
                </div>
                <input
                  type="text"
                  value={collapsedGoogleKeyword}
                  onChange={(e) => setCollapsedGoogleKeyword(e.target.value)}
                  onPaste={handleCollapsedPasteEvent}
                  className="w-full px-3 py-2 mb-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Search keyword"
                />
                <button
                  onClick={handleCollapsedOpenGoogleImages}
                  className="w-full py-1 mb-2 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded"
                >
                  Open Google Images
                </button>
                <button
                  onClick={handleCollapsedPasteFromClipboard}
                  disabled={collapsedClipboardSaving}
                  className={`w-full py-1 mb-2 text-sm rounded ${
                    collapsedClipboardSaving
                      ? 'bg-gray-200 text-gray-500 cursor-wait'
                      : 'bg-green-600 text-white hover:bg-green-700'
                  }`}
                >
                  {collapsedClipboardSaving ? 'Saving...' : 'Paste from Clipboard'}
                </button>
                <button
                  onClick={() => setCollapsedImageMenu((prev) => prev ? { ...prev, panel: 'emoji' } : prev)}
                  className="w-full py-1 mb-2 text-sm bg-purple-100 text-purple-700 hover:bg-purple-200 rounded"
                >
                  Back to Emoji Picker
                </button>
                <button
                  onClick={() => setCollapsedImageMenu(null)}
                  className="w-full py-1 text-sm bg-gray-200 hover:bg-gray-300 rounded"
                >
                  Close
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* Context Menu - 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐蹭画闂佹寧姊婚弲顐ょ不閹€鏀介柣妯哄级閹兼劙鏌＄€ｂ晝鍔嶉柕鍥у楠炴﹢宕￠悙鍏哥棯闂備焦鎮堕崐鏍哄Ο鍏煎床婵犻潧娲ㄧ弧鈧梺绋挎湰绾板秴鈻撻鐘电＝濞达絾褰冩禍?*/}
      {contextMenu && (
        <>
          {/* 闂傚倸鍊搁崐鎼佸磹妞嬪孩顐介柨鐔哄Т缁€鍫ユ煥閺囩偛鈧摜绮ｅΔ浣瑰弿婵☆垱瀵х涵鍓х棯閸欍儳鐭欓柡宀嬬秮婵偓闁绘ê寮堕崐搴♀攽?*/}
          <div 
            className="fixed inset-0 z-40"
            onClick={() => setContextMenu(null)}
          />
          
          {/* 闂傚倸鍊搁崐椋庣矆娓氣偓瀹曘儳鈧綆鍏橀崑鎾剁箔濞戞ɑ鍣归柛銊︾箞閹﹢鎮欓崹顐ｇ彧闂?*/}
          <div
            className="fixed z-50 bg-white border-2 border-gray-300 rounded-lg shadow-2xl py-1 min-w-[160px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {contextMenu.sentenceText && (
              <button
                onClick={() => {
                  void handleSentenceTranslateAnalyze();
                }}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
              >
                Translate & Analyze
              </button>
            )}
            <button
              onClick={handleAddBookmark}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
            >
              Add Bookmark
            </button>
            <button
              onClick={() => {
                handlePlayFromParagraph(contextMenu.pIndex);
                setContextMenu(null);
              }}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
            >
              Play from here
            </button>
            {isSpeaking && (
              <button
                onClick={() => {
                  handleStopReading();
                  setContextMenu(null);
                }}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2 text-red-600"
              >
                Stop reading
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default App
