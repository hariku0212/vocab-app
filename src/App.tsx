import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import HandwritingCanvas from './HandwritingCanvas';

const GAS_ENDPOINT =
  'https://script.google.com/macros/s/AKfycbw5_IGof9wirpNIhkBNEPxh8kwsLKFqaSRWwQumQ2z5xqt5YspochMmccRtfE4fD2ZQSg/exec';

const GOOGLE_CLIENT_ID =
  '141623918894-f9kmkrrk7640lqhupp25nfhcog2jihim.apps.googleusercontent.com';

declare global {
  interface Window {
    google?: any;
    [key: string]: any; // JSONP 用
  }
}

// ===== 共通ユーティリティ =====

function decodeJwt(token: string): any {
  const parts = token.split('.');
  if (parts.length < 2) throw new Error('invalid jwt');
  const payload = parts[1];
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(base64);
  const json = decodeURIComponent(
    decoded
      .split('')
      .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join('')
  );
  return JSON.parse(json);
}

function jsonp<T>(
  params: Record<string, string | number | boolean | undefined>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const callbackName = 'jsonp_cb_' + Math.random().toString(36).slice(2);
    const searchParams = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    });
    searchParams.append('callback', callbackName);

    const script = document.createElement('script');

    (window as any)[callbackName] = (data: T) => {
      resolve(data);
      delete (window as any)[callbackName];
      if (script.parentNode) script.parentNode.removeChild(script);
    };

    script.src = `${GAS_ENDPOINT}?${searchParams.toString()}`;
    script.onerror = (err) => {
      reject(err);
      delete (window as any)[callbackName];
      if (script.parentNode) script.parentNode.removeChild(script);
    };

    document.body.appendChild(script);
  });
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP');
}

// ===== 型定義 =====

type WordItem = {
  id: number;
  book: string;
  deck: string;
  bookIndex: number | null;
  level: string | null;
  english: string;
  japanese: string;
  example_en: string;
  example_jp: string;
  audio_text: string;
  tags: string[];
  poly?: {
    group_key: string;
    sense_index: number;
  };
};

type DeckData = {
  id: string;
  labelJa: string;
  items: WordItem[];
};

type WordsData = {
  bookId: string;
  bookName: string;
  decks: Record<string, DeckData>;
};

type LevelFilter = 'all' | '600' | '730' | '860' | '990';
type Direction = 'en_to_jp' | 'jp_to_en';
type Mode = 'index' | 'level';
type InputMode = 'text' | 'handwriting';
type ViewMode = 'test' | 'flash';
type ShowExamplesMode = 'auto' | 'always' | 'never';

type WrongItemStat = {
  user_id: string;
  book_id: string;
  deck: string;
  item_id: number;
  wrong_total: number;
  correct_total: number;
  last_wrong_at?: string;
};

type WrongItemsResponse = {
  ok: boolean;
  items?: WrongItemStat[];
  error?: string;
};

type UserOverview = {
  user_id: string;
  display_name: string;
  weekly_correct_total: number;
  total_correct: number;
  total_wrong: number;
  last_answered_at?: string | null;
};

type UserOverviewResponse = {
  ok: boolean;
  user?: UserOverview;
  error?: string;
};

type SessionConfig = {
  deckId: string;
  mode: Mode;
  startIndex: number;
  endIndex: number;
  level: LevelFilter;
  direction: Direction;
  shuffle: boolean;
  showExamples: ShowExamplesMode;
};

type ViewportKind = 'mobile' | 'tablet' | 'desktop';
type DriveStage = 'word_en' | 'example_en' | 'meaning_jp';

// ===== コンポーネント本体 =====

function App() {
  // ---- 認証 / ユーザー ----
  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);

  // ---- 単語帳 ----
  const [wordsData, setWordsData] = useState<WordsData | null>(null);

  const [sessionConfig, setSessionConfig] = useState<SessionConfig>({
    deckId: 'core',
    mode: 'index',
    startIndex: 1,
    endIndex: 1000,
    level: 'all',
    direction: 'en_to_jp',
    shuffle: true,
    showExamples: 'auto',
  });

  const [inputMode, setInputMode] = useState<InputMode>('text');
  const [viewMode, setViewMode] = useState<ViewMode>('test');

  const [showSettings, setShowSettings] = useState(false);
  const [showMyPage, setShowMyPage] = useState(false);

  const [viewportKind, setViewportKind] =
    useState<ViewportKind>('desktop');

  // ---- 出題セッション ----
  const [sessionBookId, setSessionBookId] = useState<string | null>(null);
  const [sessionDeckId, setSessionDeckId] = useState<string | null>(null);
  const [sessionItems, setSessionItems] = useState<WordItem[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [pageSize, setPageSize] = useState<number>(15);

  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [marks, setMarks] = useState<
    Record<number, 'correct' | 'wrong'>
  >({});
  const [showAnswers, setShowAnswers] = useState<boolean>(false);
  const [isSavingPage, setIsSavingPage] = useState<boolean>(false);

  // ---- 単語カード ----
  const [cardIndex, setCardIndex] = useState<number>(0);
  const [showCardAnswer, setShowCardAnswer] =
    useState<boolean>(false);

  // ---- マイページ ----
  const [userOverview, setUserOverview] =
    useState<UserOverview | null>(null);
  const [isLoadingOverview, setIsLoadingOverview] =
    useState<boolean>(false);
  const [myPageWrongItems, setMyPageWrongItems] = useState<
    WrongItemStat[] | null
  >(null);
  const [isLoadingMyPageWrong, setIsLoadingMyPageWrong] =
    useState<boolean>(false);
  const [displayNameEdit, setDisplayNameEdit] = useState<string>('');

  // ---- メッセージ / 音声 ----
  const [message, setMessage] = useState<string | null>(null);
  const [englishVoice, setEnglishVoice] =
    useState<SpeechSynthesisVoice | null>(null);

  // ---- ドライブモード ----
  const [driveMode, setDriveMode] = useState<boolean>(false);
  const [driveRunning, setDriveRunning] = useState<boolean>(false);
  const [driveIndex, setDriveIndex] = useState<number>(0);
  const [driveStage, setDriveStage] =
    useState<DriveStage>('word_en');
  const [driveInterval, setDriveInterval] = useState<number>(2500);

  // ---- レイアウト用スタイル ----
  const accent = '#2563eb';

  const contentCardStyle: CSSProperties =
    viewportKind === 'mobile'
      ? {
          maxWidth: '100%',
          margin: '0 auto',
          padding: '1rem 0.9rem 1.5rem',
          borderRadius: 0,
          background: '#ffffff',
        }
      : viewportKind === 'tablet'
      ? {
          maxWidth: 960,
          margin: '0 auto',
          padding: '1.4rem 1.4rem 2rem',
          borderRadius: 20,
          background: '#ffffff',
          boxShadow: '0 18px 45px rgba(15,23,42,0.35)',
        }
      : {
          maxWidth: 1120,
          margin: '0 auto',
          padding: '1.4rem 1.6rem 2rem',
          borderRadius: 24,
          background: '#ffffff',
          boxShadow: '0 18px 45px rgba(15,23,42,0.35)',
        };

  // ===== エフェクト類 =====

  // Google ログインボタン初期化
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

    const tryInit = () => {
      if (!window.google || !window.google.accounts?.id) {
        setTimeout(tryInit, 500);
        return;
      }

      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleCredentialResponse,
      });

      const buttonDiv = document.getElementById('googleSignInDiv');
      if (buttonDiv) {
        window.google.accounts.id.renderButton(buttonDiv, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
        });
      }
    };

    tryInit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 単語データ読み込み（BASE_URL 対応）
  useEffect(() => {
    const load = async () => {
      try {
        const url = `${import.meta.env.BASE_URL}words_gold.json`;
        console.log('Loading words from:', url);
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} for ${url}`);
        }
        const data: WordsData = await res.json();
        setWordsData(data);
      } catch (e) {
        console.error(e);
        setMessage('単語データの読み込みに失敗しました');
      }
    };
    load();
  }, []);

  // 英語 voice 選択
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const synth = window.speechSynthesis;

    const pickVoice = () => {
      const voices = synth.getVoices();
      if (!voices || voices.length === 0) return;

      const langLower = (v: SpeechSynthesisVoice) =>
        (v.lang || '').toLowerCase();
      const enVoices = voices.filter((v) =>
        langLower(v).startsWith('en')
      );

      const preferredNames = ['Samantha', 'Karen', 'Daniel', 'Alex', 'Fred'];
      let chosen: SpeechSynthesisVoice | null = null;

      for (const name of preferredNames) {
        const found = enVoices.find((v) => v.name.includes(name));
        if (found) {
          chosen = found;
          break;
        }
      }

      if (!chosen) chosen = enVoices[0] || voices[0];
      setEnglishVoice(chosen);
    };

    pickVoice();
    synth.addEventListener('voiceschanged', pickVoice);
    return () => {
      synth.removeEventListener('voiceschanged', pickVoice);
    };
  }, []);

  // メッセージ自動消去（4秒）
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(id);
  }, [message]);

  // ビューポート種別
  useEffect(() => {
    const update = () => {
      if (typeof window === 'undefined') return;
      const w = window.innerWidth;
      if (w < 640) setViewportKind('mobile');
      else if (w < 1024) setViewportKind('tablet');
      else setViewportKind('desktop');
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // マイページを開いたタイミングで自動取得
  useEffect(() => {
    if (showMyPage) {
      handleFetchMyPage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMyPage]);

  // 単語カードモード切り替え時に位置をリセット
  useEffect(() => {
    setCardIndex(0);
    setShowCardAnswer(false);
  }, [viewMode, sessionItems]);

  // ドライブモード制御
  useEffect(() => {
    if (
      !driveMode ||
      !driveRunning ||
      sessionItems.length === 0 ||
      typeof window === 'undefined' ||
      !window.speechSynthesis
    ) {
      return;
    }

    const current = sessionItems[driveIndex];

    const speakEnglishInternal = (text: string) => {
      if (!text) return;
      const synth = window.speechSynthesis;
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      if (englishVoice) {
        utter.voice = englishVoice;
        utter.lang = englishVoice.lang;
      } else {
        utter.lang = 'en-US';
      }
      utter.rate = 0.9;
      utter.pitch = 1.0;
      synth.speak(utter);
    };

    const speakJapaneseInternal = (text: string) => {
      if (!text) return;
      const synth = window.speechSynthesis;
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'ja-JP';
      synth.speak(utter);
    };

    // ステージに応じて読み上げ
    if (driveStage === 'word_en') {
      speakEnglishInternal(current.audio_text || current.english);
    } else if (driveStage === 'example_en') {
      if (current.example_en) {
        speakEnglishInternal(current.example_en);
      }
    } else if (driveStage === 'meaning_jp') {
      speakJapaneseInternal(current.japanese);
    }

    const timer = setTimeout(() => {
      if (!driveMode || !driveRunning || sessionItems.length === 0)
        return;

      setDriveStage((prevStage) => {
        const hasExample = !!current.example_en;
        if (prevStage === 'word_en') {
          return hasExample ? 'example_en' : 'meaning_jp';
        } else if (prevStage === 'example_en') {
          return 'meaning_jp';
        } else {
          // 日本語表示の次は次の単語へ
          setDriveIndex((prevIndex) => {
            const next = prevIndex + 1;
            return next >= sessionItems.length ? 0 : next;
          });
          return 'word_en';
        }
      });
    }, driveInterval);

    return () => clearTimeout(timer);
  }, [
    driveMode,
    driveRunning,
    driveStage,
    driveIndex,
    driveInterval,
    sessionItems,
    englishVoice,
  ]);

  // ===== 音声系関数 =====

  const speakEnglish = (text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    if (!text) return;

    synth.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    if (englishVoice) {
      utter.voice = englishVoice;
      utter.lang = englishVoice.lang;
    } else {
      utter.lang = 'en-US';
    }
    utter.rate = 0.9;
    utter.pitch = 1.0;
    synth.speak(utter);
  };

  const speakJapanese = (text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    if (!text) return;

    synth.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'ja-JP';
    synth.speak(utter);
  };

  // ===== 認証関連 =====

  async function handleGoogleCredentialResponse(response: any) {
    try {
      const idToken = response.credential as string | undefined;
      if (!idToken) {
        setMessage('Google からの ID トークンが取得できませんでした');
        return;
      }

      const payload = decodeJwt(idToken);
      const sub = String(payload.sub);
      const email = (payload.email as string) || '';
      const name = (payload.name as string) || '';

      const localUserId = 'g_' + sub;
      const localDisplay = name || email || localUserId;

      setUserId(localUserId);
      setDisplayName(localDisplay);
      setShowSettings(false);
      setShowMyPage(false);
      setMessage('ログインしました');

      const body = {
        action: 'upsertUser',
        userId: localUserId,
        googleSub: sub,
        email,
        displayName: localDisplay,
      };

      try {
        await fetch(GAS_ENDPOINT, {
          method: 'POST',
          mode: 'no-cors',
          headers: {
            'Content-Type': 'text/plain;charset=utf-8',
          },
          body: JSON.stringify(body),
        });
      } catch (e) {
        console.error(e);
        setMessage('ユーザー情報の送信に失敗しました');
      }
    } catch (e) {
      console.error(e);
      setMessage('Google ログイン時にエラーが発生しました');
    }
  }

  const handleDebugLogin = () => {
    const id = 'debug_user';
    setUserId(id);
    setDisplayName(id);
    setShowSettings(false);
    setShowMyPage(false);
    setMessage('デバッグ用ユーザーでログインしました');

    const body = {
      action: 'upsertUser',
      userId: id,
      googleSub: '',
      email: '',
      displayName: id,
    };
    fetch(GAS_ENDPOINT, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
    }).catch((e) => console.error(e));
  };

  // ===== 出題ロジック =====

  function shuffleArray<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const handleStartSession = () => {
    if (!wordsData) {
      setMessage('単語データがまだ読み込まれていません');
      return;
    }

    const deck = wordsData.decks[sessionConfig.deckId];
    if (!deck) {
      setMessage('選択されたデッキが見つかりません: ' + sessionConfig.deckId);
      return;
    }

    let filtered: WordItem[] = [];

    if (sessionConfig.mode === 'index') {
      const start = Math.max(1, sessionConfig.startIndex);
      const end = Math.max(start, sessionConfig.endIndex);
      const expectedCount = end - start + 1;

      filtered = deck.items.filter((item) => {
        const idx = item.bookIndex ?? 0;
        return idx >= start && idx <= end;
      });

      setMessage(
        `番号指定モード: ${deck.labelJa} / 範囲 ${start}〜${end} / 想定: ${expectedCount}（実際: ${filtered.length} 問）`
      );
    } else {
      filtered = deck.items.filter((item) => {
        if (sessionConfig.level === 'all') return true;
        return item.level === sessionConfig.level;
      });

      const levelLabel =
        sessionConfig.level === 'all'
          ? '全レベル'
          : `レベル ${sessionConfig.level}`;
      setMessage(
        `レベル別モード: ${deck.labelJa} / ${levelLabel} / 問題数: ${filtered.length}`
      );
    }

    if (sessionConfig.shuffle) {
      filtered = shuffleArray(filtered);
    }

    setSessionItems(filtered);
    setSessionBookId(wordsData.bookId);
    setSessionDeckId(sessionConfig.deckId);
    setCurrentPage(0);
    setAnswers({});
    setMarks({});
    setShowAnswers(false);
    setCardIndex(0);
    setShowCardAnswer(false);

    // ドライブモードリセット
    setDriveMode(false);
    setDriveRunning(false);
    setDriveIndex(0);
    setDriveStage('word_en');
  };

  const handleStartWrongSession = async () => {
    if (!userId) {
      setMessage('苦手単語モードにはログインが必要です');
      return;
    }
    if (!wordsData) {
      setMessage('単語データがまだ読み込まれていません');
      return;
    }

    const bookId = wordsData.bookId;
    const deckId = sessionConfig.deckId;

    try {
      const res = await jsonp<WrongItemsResponse>({
        action: 'getWrongItems',
        userId,
        bookId,
        deck: deckId,
      });

      if (!res.ok || !res.items) {
        setMessage('苦手単語リストの取得に失敗しました');
        setSessionItems([]);
        return;
      }

      const deckData = wordsData.decks[deckId];
      if (!deckData) {
        setMessage('デッキが見つかりません: ' + deckId);
        return;
      }

      const mapById = new Map<number, WordItem>();
      deckData.items.forEach((w) => mapById.set(w.id, w));

      let wordList: WordItem[] = [];
      res.items.forEach((stat) => {
        const item = mapById.get(stat.item_id);
        if (item) wordList.push(item);
      });

      if (wordList.length === 0) {
        setMessage('不正解がある単語がまだありません');
        setSessionItems([]);
        return;
      }

      if (sessionConfig.shuffle) {
        wordList = shuffleArray(wordList);
      }

      setSessionItems(wordList);
      setSessionBookId(bookId);
      setSessionDeckId(deckId);
      setCurrentPage(0);
      setAnswers({});
      setMarks({});
      setShowAnswers(false);
      setCardIndex(0);
      setShowCardAnswer(false);

      setDriveMode(false);
      setDriveRunning(false);
      setDriveIndex(0);
      setDriveStage('word_en');

      setMessage(`苦手単語モード開始: ${wordList.length} 問`);
    } catch (e) {
      console.error(e);
      setMessage('苦手単語モード取得時にエラーが発生しました');
    }
  };

  // ページング
  const totalPages =
    sessionItems.length > 0 ? Math.ceil(sessionItems.length / pageSize) : 0;
  const startIndex = currentPage * pageSize;
  const endIndex = Math.min(startIndex + pageSize, sessionItems.length);
  const pageItems = sessionItems.slice(startIndex, endIndex);
  const isEnToJp = sessionConfig.direction === 'en_to_jp';

  const shouldShowExampleInQuestion = (word: WordItem): boolean => {
    if (sessionConfig.showExamples === 'never') return false;
    if (sessionConfig.showExamples === 'always') return true;
    return !!word.poly;
  };

  const handleShowAnswersForPage = () => {
    setShowAnswers(true);
    setMarks((prev) => {
      const updated: Record<number, 'correct' | 'wrong'> = { ...prev };
      pageItems.forEach((_, idx) => {
        const absIndex = startIndex + idx;
        if (updated[absIndex] === undefined) {
          updated[absIndex] = 'correct';
        }
      });
      return updated;
    });
  };

  const handleSaveCurrentPage = async () => {
    if (!sessionBookId || !sessionDeckId) {
      setMessage('セッションが開始されていません');
      return;
    }
    if (!userId) {
      setMessage('先にログインしてください');
      return;
    }
    if (pageItems.length === 0) {
      setMessage('このページには問題がありません');
      return;
    }

    const missing = pageItems.filter((_, idx) => {
      const absIndex = startIndex + idx;
      return marks[absIndex] === undefined;
    });

    if (missing.length > 0) {
      const ok = window.confirm(
        '自己採点していない問題があります。このまま未採点問題をすべて「×」として記録しますか？'
      );
      if (!ok) return;
    }

    const results = pageItems.map((item, idx) => {
      const absIndex = startIndex + idx;
      const mark = marks[absIndex];
      const isCorrect = mark === 'correct';
      return { itemId: item.id, isCorrect };
    });

    setIsSavingPage(true);
    try {
      const payload = {
        action: 'saveResults',
        userId,
        bookId: sessionBookId,
        deck: sessionDeckId,
        results,
      };

      await fetch(GAS_ENDPOINT, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify(payload),
      });

      setMessage('このページの成績を保存しました（GAS に送信）');

      if (currentPage + 1 < totalPages) {
        setCurrentPage((prev) => prev + 1);
        setShowAnswers(false);
      } else {
        setMessage('セッションが終了しました（全ページ保存済み）');
      }
    } catch (e) {
      console.error(e);
      setMessage('成績保存リクエストの送信に失敗しました');
    } finally {
      setIsSavingPage(false);
    }
  };

  // ===== マイページ =====

  const handleFetchMyPage = async () => {
    if (!userId) {
      setMessage('マイページを表示するにはログインが必要です');
      return;
    }
    if (!wordsData) {
      setMessage('単語データがまだ読み込まれていません');
      return;
    }

    setIsLoadingOverview(true);
    setIsLoadingMyPageWrong(true);

    try {
      const overviewRes = await jsonp<UserOverviewResponse>({
        action: 'getUserOverview',
        userId,
      });

      if (overviewRes.ok && overviewRes.user) {
        setUserOverview(overviewRes.user);
        setDisplayNameEdit(overviewRes.user.display_name);
      } else {
        setUserOverview(null);
        if (overviewRes.error) {
          setMessage('マイページ情報取得エラー: ' + overviewRes.error);
        }
      }

      const wrongRes = await jsonp<WrongItemsResponse>({
        action: 'getWrongItems',
        userId,
        bookId: wordsData.bookId,
        deck: sessionConfig.deckId,
      });

      if (wrongRes.ok && wrongRes.items) {
        const items = [...wrongRes.items].filter(
          (i) => i.wrong_total > 0
        );
        items.sort((a, b) => {
          if (b.wrong_total !== a.wrong_total) {
            return b.wrong_total - a.wrong_total;
          }
          const ad = a.last_wrong_at ? Date.parse(a.last_wrong_at) : 0;
          const bd = b.last_wrong_at ? Date.parse(b.last_wrong_at) : 0;
          return bd - ad;
        });
        setMyPageWrongItems(items.slice(0, 10));
      } else {
        setMyPageWrongItems(null);
      }
    } catch (e) {
      console.error(e);
      setMessage('マイページ情報の取得でエラーが発生しました');
    } finally {
      setIsLoadingOverview(false);
      setIsLoadingMyPageWrong(false);
    }
  };

  const handleUpdateDisplayName = async () => {
    if (!userId) {
      setMessage('ログインしていません');
      return;
    }
    const newName = displayNameEdit.trim();
    if (!newName) {
      setMessage('表示名を入力してください');
      return;
    }

    try {
      const payload = {
        action: 'updateDisplayName',
        userId,
        displayName: newName,
      };

      await fetch(GAS_ENDPOINT, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify(payload),
      });

      setDisplayName(newName);
      setUserOverview((prev) =>
        prev ? { ...prev, display_name: newName } : prev
      );
      setMessage('表示名を更新しました');
    } catch (e) {
      console.error(e);
      setMessage('表示名の更新に失敗しました');
    }
  };

  // ===== JSX: ログイン画面 =====

  if (!userId) {
    return (
      <div
        style={{
          minHeight: '100vh',
          margin: 0,
          padding: '2rem 1rem',
          background:
            'radial-gradient(circle at top, #1d4ed8 0, #0f172a 55%, #020617 100%)',
          color: '#f9fafb',
          fontFamily:
            'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        <div style={contentCardStyle}>
          <header style={{ marginBottom: '1.5rem' }}>
            <h1
              style={{
                margin: 0,
                fontSize: '1.9rem',
                fontWeight: 700,
                letterSpacing: '0.02em',
                color: '#111827',
              }}
            >
              WordDrill 🔤
            </h1>
            <p
              style={{
                margin: '0.35rem 0 0',
                fontSize: '0.95rem',
                color: '#4b5563',
              }}
            >
              TOEIC など複数の英単語帳に対応した、テスト特化の単語トレーニングアプリ
            </p>
          </header>

          {message && (
            <div
              style={{
                marginBottom: '1rem',
                padding: '0.6rem 0.8rem',
                borderRadius: 999,
                background: '#eff6ff',
                color: '#1e3a8a',
                border: '1px solid #bfdbfe',
                fontSize: '0.85rem',
              }}
            >
              {message}
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                viewportKind === 'mobile'
                  ? 'minmax(0, 1fr)'
                  : 'minmax(0, 1.25fr) minmax(0, 1fr)',
              gap: '1.5rem',
              alignItems: 'stretch',
            }}
          >
            <section
              style={{
                padding: '1.25rem 1.2rem',
                borderRadius: 16,
                border: '1px solid #e5e7eb',
                background:
                  'linear-gradient(135deg, #eff6ff, #ffffff)',
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: '1.05rem',
                  marginBottom: '0.75rem',
                  color: '#111827',
                }}
              >
                🔐 ログイン
              </h2>
              <p
                style={{
                  margin: '0 0 0.75rem',
                  fontSize: '0.9rem',
                  color: '#4b5563',
                }}
              >
                Google アカウントでログインすると、学習履歴・苦手単語・ランキングを
                自動で記録できます。
              </p>
              <div
                id="googleSignInDiv"
                style={{ marginBottom: '0.75rem' }}
              />
              <button
                type="button"
                onClick={handleDebugLogin}
                style={{
                  padding: '0.4rem 0.9rem',
                  fontSize: '0.85rem',
                  borderRadius: 999,
                  border: 'none',
                  background: '#e5e7eb',
                  color: '#111827',
                  cursor: 'pointer',
                }}
              >
                🧪 デバッグユーザーで試す
              </button>
            </section>

            <section
              style={{
                padding: '1.25rem 1.2rem',
                borderRadius: 16,
                border: '1px solid #e5e7eb',
                background: '#f9fafb',
                fontSize: '0.9rem',
                color: '#374151',
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: '0.95rem',
                  marginBottom: '0.6rem',
                  color: '#111827',
                }}
              >
                🌟 主な機能
              </h3>
              <ul style={{ paddingLeft: '1.1rem', margin: 0 }}>
                <li>英→日 / 日→英 の単語テスト</li>
                <li>Apple Pencil 対応の手書き入力モード</li>
                <li>苦手単語だけを出題する復習モード</li>
                <li>例文つき単語カード＆ドライブモード</li>
                <li>一週間ごとの正解数ランキング（今後追加）</li>
              </ul>
            </section>
          </div>
        </div>
      </div>
    );
  }

  // ===== JSX: ログイン後 =====

  return (
    <div
      style={{
        minHeight: '100vh',
        margin: 0,
        padding: '2rem 1rem',
        background:
          'radial-gradient(circle at top, #1d4ed8 0, #0f172a 55%, #020617 100%)',
        color: '#0f172a',
        fontFamily:
          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div style={contentCardStyle}>
        {/* ヘッダー */}
        <header
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            gap: '0.75rem',
            alignItems: 'center',
            marginBottom: '1.25rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              alignItems: 'center',
            }}
          >
            <div>
              <h1
                style={{
                  margin: 0,
                  fontSize: '1.6rem',
                  fontWeight: 700,
                  letterSpacing: '0.02em',
                  color: '#111827',
                }}
              >
                WordDrill 🔤
              </h1>
              <p
                style={{
                  margin: '0.3rem 0 0',
                  fontSize: '0.9rem',
                  color: '#6b7280',
                }}
              >
                英単語テストに特化した、自分専用トレーニングアプリ
              </p>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            {/* プロフィールチップ（クリックでマイページ） */}
            <button
              type="button"
              onClick={() => setShowMyPage(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.25rem 0.7rem',
                borderRadius: 999,
                border: 'none',
                background: '#eff6ff',
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  background:
                    'linear-gradient(135deg, #1d4ed8, #4f46e5)',
                  color: '#f9fafb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                {(displayName ?? userId).charAt(0).toUpperCase()}
              </div>
              <span
                style={{
                  fontSize: '0.85rem',
                  color: '#1e3a8a',
                  maxWidth: 120,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={displayName ?? userId}
              >
                {displayName ?? userId}
              </span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMyPage(true);
                }}
                style={{
                  fontSize: '0.85rem',
                  color: '#1d4ed8',
                }}
                title="表示名を編集"
              >
                ✏️
              </span>
            </button>

            {/* 設定ボタン（モーダルで開く） */}
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              style={{
                borderRadius: 999,
                border: 'none',
                background: '#f3f4f6',
                padding: '0.35rem 0.8rem',
                cursor: 'pointer',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span>⚙</span>
              <span>設定</span>
            </button>
          </div>
        </header>

        {/* メッセージ */}
        {message && (
          <div
            style={{
              marginBottom: '1rem',
              padding: '0.65rem 0.9rem',
              borderRadius: 999,
              background: '#eff6ff',
              color: '#1e3a8a',
              border: '1px solid #bfdbfe',
              fontSize: '0.85rem',
            }}
          >
            {message}
          </div>
        )}

        {/* 上部タブ（テスト / 単語カード） */}
        <nav
          style={{
            display: 'inline-flex',
            gap: '0.25rem',
            padding: '0.15rem',
            borderRadius: 999,
            background: '#f3f4f6',
            marginBottom: '1rem',
          }}
        >
          <button
            type="button"
            onClick={() => setViewMode('test')}
            style={{
              borderRadius: 999,
              border: 'none',
              padding: '0.35rem 0.9rem',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: viewMode === 'test' ? 600 : 400,
              background:
                viewMode === 'test' ? accent : 'transparent',
              color: viewMode === 'test' ? '#ffffff' : '#374151',
            }}
          >
            📝 テスト
          </button>
          <button
            type="button"
            onClick={() => setViewMode('flash')}
            style={{
              borderRadius: 999,
              border: 'none',
              padding: '0.35rem 0.9rem',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: viewMode === 'flash' ? 600 : 400,
              background:
                viewMode === 'flash' ? accent : 'transparent',
              color: viewMode === 'flash' ? '#ffffff' : '#374151',
            }}
          >
            🃏 単語カード
          </button>
        </nav>

        {/* メイン部分 */}
        <main>
          {/* 出題設定共通ブロック */}
          <section
            style={{
              marginBottom: '1.5rem',
              padding: '1rem',
              border: '1px solid #e5e7eb',
              borderRadius: 16,
              background: '#f9fafb',
            }}
          >
            <h2
              style={{
                fontSize: '1.05rem',
                marginTop: 0,
                marginBottom: '0.5rem',
              }}
            >
              🎯 出題設定
            </h2>

            {/* 上段：モード・入力・帳票 */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.5rem',
                marginBottom: '0.75rem',
              }}
            >
              <div
                style={{
                  display: 'inline-flex',
                  borderRadius: 999,
                  border: '1px solid #e5e7eb',
                  overflow: 'hidden',
                }}
              >
                <button
                  type="button"
                  onClick={() =>
                    setSessionConfig((prev) => ({
                      ...prev,
                      mode: 'index',
                    }))
                  }
                  style={{
                    padding: '0.25rem 0.7rem',
                    border: 'none',
                    background:
                      sessionConfig.mode === 'index'
                        ? '#ffffff'
                        : 'transparent',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                  }}
                >
                  🔢 番号指定
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSessionConfig((prev) => ({
                      ...prev,
                      mode: 'level',
                    }))
                  }
                  style={{
                    padding: '0.25rem 0.7rem',
                    border: 'none',
                    background:
                      sessionConfig.mode === 'level'
                        ? '#ffffff'
                        : 'transparent',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                  }}
                >
                  📊 レベル別
                </button>
              </div>

              <label style={{ fontSize: '0.85rem' }}>
                ✍ 入力方法：
                <select
                  value={inputMode}
                  onChange={(e) =>
                    setInputMode(e.target.value as InputMode)
                  }
                  style={{ marginLeft: '0.25rem' }}
                >
                  <option value="text">キーボード</option>
                  <option value="handwriting">手書き</option>
                </select>
              </label>

              {wordsData && (
                <label style={{ fontSize: '0.85rem' }}>
                  📚 単語帳：
                  <select
                    value={wordsData.bookId}
                    onChange={() => {}}
                    style={{ marginLeft: '0.25rem' }}
                    disabled
                  >
                    <option value={wordsData.bookId}>
                      {wordsData.bookName}
                    </option>
                  </select>
                </label>
              )}
            </div>

            {/* 中段：詳細設定 */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.75rem',
                alignItems: 'center',
                fontSize: '0.9rem',
              }}
            >
              <label>
                デッキ：
                <select
                  value={sessionConfig.deckId}
                  onChange={(e) =>
                    setSessionConfig((prev) => ({
                      ...prev,
                      deckId: e.target.value,
                    }))
                  }
                  style={{ marginLeft: '0.25rem' }}
                >
                  <option value="core">金のフレーズ（本体）</option>
                  {/* 今後ここに他の本体・派生デッキを追加 */}
                </select>
              </label>

              {sessionConfig.mode === 'index' && (
                <>
                  <label>
                    範囲 from:
                    <input
                      type="number"
                      min={1}
                      value={sessionConfig.startIndex}
                      onChange={(e) =>
                        setSessionConfig((prev) => ({
                          ...prev,
                          startIndex: Number(
                            e.target.value || 1
                          ),
                        }))
                      }
                      style={{
                        width: '4.5rem',
                        marginLeft: '0.25rem',
                      }}
                    />
                  </label>
                  <label>
                    to:
                    <input
                      type="number"
                      min={1}
                      value={sessionConfig.endIndex}
                      onChange={(e) =>
                        setSessionConfig((prev) => ({
                          ...prev,
                          endIndex: Number(
                            e.target.value ||
                              prev.startIndex ||
                              1
                          ),
                        }))
                      }
                      style={{
                        width: '4.5rem',
                        marginLeft: '0.25rem',
                      }}
                    />
                  </label>
                </>
              )}

              {sessionConfig.mode === 'level' && (
                <label>
                  レベル：
                  <select
                    value={sessionConfig.level}
                    onChange={(e) =>
                      setSessionConfig((prev) => ({
                        ...prev,
                        level: e.target.value as LevelFilter,
                      }))
                    }
                    style={{ marginLeft: '0.25rem' }}
                  >
                    <option value="all">全レベル</option>
                    <option value="600">600</option>
                    <option value="730">730</option>
                    <option value="860">860</option>
                    <option value="990">990</option>
                  </select>
                </label>
              )}

              <label>
                出題方向：
                <select
                  value={sessionConfig.direction}
                  onChange={(e) =>
                    setSessionConfig((prev) => ({
                      ...prev,
                      direction:
                        e.target.value as Direction,
                    }))
                  }
                  style={{ marginLeft: '0.25rem' }}
                >
                  <option value="en_to_jp">
                    英 → 日（意味）
                  </option>
                  <option value="jp_to_en">
                    日 → 英（スペル）
                  </option>
                </select>
              </label>

              <label>
                1ページの問題数：
                <select
                  value={pageSize}
                  onChange={(e) =>
                    setPageSize(Number(e.target.value))
                  }
                  style={{ marginLeft: '0.25rem' }}
                >
                  <option value={1}>1</option>
                  <option value={5}>5</option>
                  <option value={15}>15</option>
                  <option value={30}>30</option>
                  <option value={50}>50</option>
                </select>
              </label>

              <label>
                出題順：
                <select
                  value={
                    sessionConfig.shuffle
                      ? 'random'
                      : 'sequential'
                  }
                  onChange={(e) =>
                    setSessionConfig((prev) => ({
                      ...prev,
                      shuffle: e.target.value === 'random',
                    }))
                  }
                  style={{ marginLeft: '0.25rem' }}
                >
                  <option value="sequential">昇順</option>
                  <option value="random">ランダム</option>
                </select>
              </label>

              <label>
                例文の表示：
                <select
                  value={sessionConfig.showExamples}
                  onChange={(e) =>
                    setSessionConfig((prev) => ({
                      ...prev,
                      showExamples:
                        e.target.value as ShowExamplesMode,
                    }))
                  }
                  style={{ marginLeft: '0.25rem' }}
                >
                  <option value="auto">
                    多義語のみ（おすすめ）
                  </option>
                  <option value="always">常に表示</option>
                  <option value="never">表示しない</option>
                </select>
              </label>
            </div>

            {/* 下段：開始ボタン */}
            <div style={{ marginTop: '0.75rem' }}>
              <button
                onClick={handleStartSession}
                style={{
                  background: accent,
                  color: '#ffffff',
                  borderRadius: 999,
                  border: 'none',
                  padding: '0.45rem 1.1rem',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                }}
              >
                ▶ 通常セッション開始
              </button>
              <button
                onClick={handleStartWrongSession}
                style={{
                  marginLeft: '0.5rem',
                  background: '#e5e7eb',
                  color: '#111827',
                  borderRadius: 999,
                  border: 'none',
                  padding: '0.45rem 1.1rem',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                }}
              >
                🔁 苦手単語モードで開始
              </button>
              {sessionItems.length > 0 && (
                <span
                  style={{
                    marginLeft: '0.75rem',
                    fontSize: '0.85rem',
                    color: '#4b5563',
                  }}
                >
                  現在: {sessionItems.length} 問 /{' '}
                  {totalPages} ページ
                </span>
              )}
            </div>
          </section>

          {/* データ読み込み状態 */}
          {!wordsData && <div>単語データを読み込み中…</div>}
          {wordsData && sessionItems.length === 0 && (
            <p
              style={{
                marginBottom: '1rem',
                fontSize: '0.9rem',
                color: '#4b5563',
              }}
            >
              出題設定を調整して、セッションを開始してください。
            </p>
          )}

          {/* テストタブ */}
          {wordsData &&
            sessionItems.length > 0 &&
            viewMode === 'test' && (
              <section
                style={{
                  marginBottom: '2rem',
                  padding: '1rem',
                  border: '1px solid #e5e7eb',
                  borderRadius: 16,
                }}
              >
                <h2
                  style={{
                    fontSize: '1.05rem',
                    marginTop: 0,
                    marginBottom: '0.4rem',
                  }}
                >
                  📝 テストモード
                </h2>
                <p
                  style={{
                    fontSize: '0.9rem',
                    marginTop: 0,
                    color: '#4b5563',
                  }}
                >
                  ページ {currentPage + 1} / {totalPages}（
                  {startIndex + 1}〜{endIndex} 問） /{' '}
                  <strong>
                    {isEnToJp ? '英 → 日' : '日 → 英'}
                  </strong>
                </p>

                {pageItems.map((word, idx) => {
                  const absIndex = startIndex + idx;
                  const answerValue = answers[absIndex] ?? '';
                  const mark = marks[absIndex];

                  return (
                    <div
                      key={word.id}
                      style={{
                        marginBottom: '1rem',
                        paddingBottom: '0.75rem',
                        borderBottom: '1px solid #f3f4f6',
                      }}
                    >
                      <div style={{ fontSize: '1.05rem' }}>
                        問題 {absIndex + 1}.{' '}
                        <strong>
                          {isEnToJp
                            ? word.english
                            : word.japanese}
                        </strong>
                        {isEnToJp && (
                          <button
                            type="button"
                            onClick={() =>
                              speakEnglish(
                                word.audio_text || word.english
                              )
                            }
                            style={{
                              marginLeft: '0.5rem',
                              fontSize: '0.8rem',
                              border: 'none',
                              background: 'transparent',
                              cursor: 'pointer',
                            }}
                          >
                            🔊 単語
                          </button>
                        )}
                        {word.example_en && (
                          <button
                            type="button"
                            onClick={() =>
                              speakEnglish(word.example_en)
                            }
                            style={{
                              marginLeft: '0.25rem',
                              fontSize: '0.8rem',
                              border: 'none',
                              background: 'transparent',
                              cursor: 'pointer',
                            }}
                          >
                            🔊 例文
                          </button>
                        )}
                      </div>

                      {shouldShowExampleInQuestion(word) && (
                        <div
                          style={{
                            fontStyle: 'italic',
                            color: '#555',
                            fontSize: '0.9rem',
                            marginTop: '0.1rem',
                          }}
                        >
                          例文:{' '}
                          {isEnToJp
                            ? word.example_en
                            : word.example_jp}
                        </div>
                      )}

                      <div style={{ marginTop: '0.25rem' }}>
                        {inputMode === 'text' ? (
                          <label>
                            あなたの答え：
                            <input
                              type="text"
                              value={answerValue}
                              onChange={(e) =>
                                setAnswers((prev) => ({
                                  ...prev,
                                  [absIndex]:
                                    e.target.value,
                                }))
                              }
                              style={{
                                marginLeft: '0.5rem',
                                width: '60%',
                                maxWidth: 400,
                              }}
                              placeholder={
                                isEnToJp
                                  ? '日本語の意味'
                                  : '英語の単語'
                              }
                            />
                          </label>
                        ) : (
                          <div>
                            <div
                              style={{
                                marginBottom: '0.25rem',
                                fontSize: '0.9rem',
                              }}
                            >
                              手書きで回答：
                            </div>
                            <HandwritingCanvas height={140} />
                          </div>
                        )}
                      </div>

                      {showAnswers && (
                        <div
                          style={{
                            marginTop: '0.25rem',
                            padding: '0.4rem 0.5rem',
                            borderRadius: 12,
                            border: '1px solid #e5e7eb',
                            background: '#f9fafb',
                          }}
                        >
                          <div>
                            正解：
                            {isEnToJp
                              ? word.japanese
                              : word.english}
                          </div>
                          <div
                            style={{
                              fontSize: '0.9rem',
                              marginTop: '0.2rem',
                            }}
                          >
                            例文（日本語）：{word.example_jp}
                          </div>
                          <div style={{ fontSize: '0.9rem' }}>
                            例文（英語）：{word.example_en}
                          </div>

                          <div style={{ marginTop: '0.25rem' }}>
                            自己採点：
                            <button
                              onClick={() =>
                                setMarks((prev) => ({
                                  ...prev,
                                  [absIndex]: 'correct',
                                }))
                              }
                              style={{
                                marginLeft: '0.5rem',
                                fontSize: '0.85rem',
                                fontWeight:
                                  mark === 'correct'
                                    ? 'bold'
                                    : 'normal',
                              }}
                            >
                              ○ 正解
                            </button>
                            <button
                              onClick={() =>
                                setMarks((prev) => ({
                                  ...prev,
                                  [absIndex]: 'wrong',
                                }))
                              }
                              style={{
                                marginLeft: '0.5rem',
                                fontSize: '0.85rem',
                                fontWeight:
                                  mark === 'wrong'
                                    ? 'bold'
                                    : 'normal',
                              }}
                            >
                              × 不正解
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                <div>
                  <button
                    onClick={handleShowAnswersForPage}
                    style={{
                      borderRadius: 999,
                      border: 'none',
                      padding: '0.4rem 0.8rem',
                      background: '#e5e7eb',
                      cursor: 'pointer',
                      fontSize: '0.9rem',
                    }}
                  >
                    解答を表示（未採点は○扱い）
                  </button>
                </div>

                <div style={{ marginTop: '0.75rem' }}>
                  <button
                    onClick={handleSaveCurrentPage}
                    disabled={
                      isSavingPage || pageItems.length === 0
                    }
                    style={{
                      borderRadius: 999,
                      border: 'none',
                      padding: '0.45rem 1.1rem',
                      background: isSavingPage
                        ? '#9ca3af'
                        : accent,
                      color: '#ffffff',
                      cursor: isSavingPage
                        ? 'default'
                        : 'pointer',
                      fontSize: '0.9rem',
                    }}
                  >
                    このページを保存して
                    {currentPage + 1 < totalPages
                      ? '次へ'
                      : 'セッション終了'}
                  </button>
                </div>
              </section>
            )}

          {/* 単語カードタブ */}
          {wordsData &&
            sessionItems.length > 0 &&
            viewMode === 'flash' && (
              <section
                style={{
                  marginBottom: '2rem',
                  padding: '1rem',
                  border: '1px solid #e5e7eb',
                  borderRadius: 16,
                }}
              >
                <h2
                  style={{
                    fontSize: '1.05rem',
                    marginTop: 0,
                    marginBottom: '0.4rem',
                  }}
                >
                  🃏 単語カード
                </h2>
                <p
                  style={{
                    fontSize: '0.9rem',
                    marginTop: 0,
                    color: '#4b5563',
                  }}
                >
                  全 {sessionItems.length} 枚 / 現在{' '}
                  {cardIndex + 1} 枚目（
                  {isEnToJp ? '英 → 日' : '日 → 英'}
                  ）
                </p>

                {/* ドライブモード設定 */}
                <div
                  style={{
                    marginBottom: '0.75rem',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.75rem',
                    alignItems: 'center',
                  }}
                >
                  <label style={{ fontSize: '0.9rem' }}>
                    <input
                      type="checkbox"
                      checked={driveMode}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        setDriveMode(enabled);
                        if (enabled) {
                          setDriveIndex(0);
                          setDriveStage('word_en');
                          setDriveRunning(true);
                        } else {
                          setDriveRunning(false);
                          if (
                            typeof window !== 'undefined' &&
                            window.speechSynthesis
                          ) {
                            window.speechSynthesis.cancel();
                          }
                        }
                      }}
                      style={{ marginRight: '0.4rem' }}
                    />
                    🚗 ドライブモード（自動再生）
                  </label>

                  {driveMode && (
                    <label
                      style={{
                        fontSize: '0.85rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                      }}
                    >
                      速度：
                      <input
                        type="range"
                        min={1500}
                        max={5000}
                        step={500}
                        value={driveInterval}
                        onChange={(e) =>
                          setDriveInterval(
                            Number(e.target.value)
                          )
                        }
                      />
                      <span
                        style={{
                          fontSize: '0.8rem',
                          color: '#4b5563',
                        }}
                      >
                        {driveInterval / 1000} 秒/ステージ
                      </span>
                    </label>
                  )}
                </div>

                {/* ドライブモード UI */}
                {driveMode ? (
                  <div
                    style={{
                      borderRadius: 16,
                      border: '1px solid #e5e7eb',
                      background: '#0f172a',
                      color: '#e5e7eb',
                      minHeight: viewportKind === 'mobile' ? 260 : 320,
                      padding: '1.2rem 1rem',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                  >
                    {sessionItems[driveIndex] && (
                      <>
                        <div>
                          <div
                            style={{
                              fontSize: '0.9rem',
                              marginBottom: '0.35rem',
                              color: '#9ca3af',
                            }}
                          >
                            {driveStage === 'word_en' &&
                              '英単語'}
                            {driveStage === 'example_en' &&
                              '例文（英語）'}
                            {driveStage === 'meaning_jp' &&
                              '日本語の意味'}
                          </div>
                          <div
                            style={{
                              fontSize:
                                viewportKind === 'mobile'
                                  ? '1.6rem'
                                  : '2rem',
                              fontWeight: 600,
                              marginBottom: '0.6rem',
                            }}
                          >
                            {(() => {
                              const w =
                                sessionItems[driveIndex];
                              if (driveStage === 'word_en') {
                                return w.english;
                              }
                              if (
                                driveStage ===
                                  'example_en' &&
                                w.example_en
                              ) {
                                return w.example_en;
                              }
                              return w.japanese;
                            })()}
                          </div>
                          <div
                            style={{
                              fontSize: '0.85rem',
                              color: '#9ca3af',
                            }}
                          >
                            {(() => {
                              const w =
                                sessionItems[driveIndex];
                              if (driveStage === 'word_en') {
                                return w.japanese;
                              }
                              if (driveStage === 'meaning_jp') {
                                return w.english;
                              }
                              // example_en
                              return w.example_jp || '';
                            })()}
                          </div>
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginTop: '0.75rem',
                          }}
                        >
                          <div
                            style={{
                              fontSize: '0.8rem',
                              color: '#9ca3af',
                            }}
                          >
                            {driveIndex + 1} /{' '}
                            {sessionItems.length}
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              gap: '0.4rem',
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setDriveRunning(false);
                                setDriveMode(false);
                                if (
                                  typeof window !==
                                    'undefined' &&
                                  window.speechSynthesis
                                ) {
                                  window.speechSynthesis.cancel();
                                }
                              }}
                              style={{
                                borderRadius: 999,
                                border: 'none',
                                padding:
                                  '0.35rem 0.85rem',
                                background: '#6b7280',
                                color: '#ffffff',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                              }}
                            >
                              ✕ 終了
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDriveRunning(
                                  (prev) => !prev
                                );
                              }}
                              style={{
                                borderRadius: 999,
                                border: 'none',
                                padding:
                                  '0.35rem 0.85rem',
                                background: '#22c55e',
                                color: '#ffffff',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                              }}
                            >
                              {driveRunning ? '⏸ 停止' : '▶ 再生'}
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  // 通常の単語カード UI
                  <>
                    {sessionItems[cardIndex] && (
                      <div
                        style={{
                          border: '1px solid #e5e7eb',
                          borderRadius: 16,
                          padding: '1rem',
                          background: '#fffdf8',
                          minHeight: 140,
                        }}
                      >
                        <div
                          style={{
                            fontSize: '1.2rem',
                            marginBottom: '0.5rem',
                          }}
                        >
                          Q:{' '}
                          <strong>
                            {isEnToJp
                              ? sessionItems[cardIndex]
                                  .english
                              : sessionItems[cardIndex]
                                  .japanese}
                          </strong>
                        </div>

                        <div
                          style={{ marginBottom: '0.5rem' }}
                        >
                          {isEnToJp && (
                            <button
                              type="button"
                              onClick={() =>
                                speakEnglish(
                                  sessionItems[cardIndex]
                                    .audio_text ||
                                    sessionItems[cardIndex]
                                      .english
                                )
                              }
                              style={{
                                marginRight: '0.5rem',
                                fontSize: '0.85rem',
                                borderRadius: 999,
                                border: 'none',
                                padding:
                                  '0.3rem 0.7rem',
                                background: '#e5e7eb',
                                cursor: 'pointer',
                              }}
                            >
                              🔊 単語
                            </button>
                          )}
                          {sessionItems[cardIndex]
                            .example_en && (
                            <button
                              type="button"
                              onClick={() =>
                                speakEnglish(
                                  sessionItems[cardIndex]
                                    .example_en
                                )
                              }
                              style={{
                                fontSize: '0.85rem',
                                borderRadius: 999,
                                border: 'none',
                                padding:
                                  '0.3rem 0.7rem',
                                background: '#e5e7eb',
                                cursor: 'pointer',
                              }}
                            >
                              🔊 例文
                            </button>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            setShowCardAnswer(
                              (prev) => !prev
                            )
                          }
                          style={{
                            borderRadius: 999,
                            border: 'none',
                            padding: '0.35rem 0.8rem',
                            background: accent,
                            color: '#ffffff',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                          }}
                        >
                          {showCardAnswer
                            ? '答えを隠す'
                            : '答えを表示'}
                        </button>

                        {showCardAnswer && (
                          <div
                            style={{ marginTop: '0.75rem' }}
                          >
                            <div>
                              答え：
                              <strong>
                                {isEnToJp
                                  ? sessionItems[
                                      cardIndex
                                    ].japanese
                                  : sessionItems[cardIndex]
                                      .english}
                              </strong>
                            </div>
                            <div
                              style={{
                                marginTop: '0.25rem',
                                fontSize: '0.95rem',
                              }}
                            >
                              例文（日本語）：
                              {
                                sessionItems[cardIndex]
                                  .example_jp
                              }
                            </div>
                            <div
                              style={{ fontSize: '0.95rem' }}
                            >
                              例文（英語）：
                              {
                                sessionItems[cardIndex]
                                  .example_en
                              }
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div
                      style={{
                        marginTop: '0.75rem',
                        display: 'flex',
                        gap: '0.5rem',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setCardIndex((prev) =>
                            prev === 0
                              ? sessionItems.length - 1
                              : prev - 1
                          );
                          setShowCardAnswer(false);
                        }}
                        style={{
                          borderRadius: 999,
                          border: 'none',
                          padding: '0.35rem 0.8rem',
                          background: '#e5e7eb',
                          cursor: 'pointer',
                        }}
                      >
                        ← 前へ
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCardIndex((prev) =>
                            prev + 1 >=
                            sessionItems.length
                              ? 0
                              : prev + 1
                          );
                          setShowCardAnswer(false);
                        }}
                        style={{
                          borderRadius: 999,
                          border: 'none',
                          padding: '0.35rem 0.8rem',
                          background: '#e5e7eb',
                          cursor: 'pointer',
                        }}
                      >
                        次へ →
                      </button>
                    </div>
                  </>
                )}
              </section>
            )}
        </main>
      </div>

      {/* 設定モーダル */}
      {showSettings && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.55)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 50,
          }}
          onClick={() => setShowSettings(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#ffffff',
              borderRadius: 20,
              maxWidth: 520,
              width: '100%',
              margin:
                viewportKind === 'mobile'
                  ? '0.75rem'
                  : '1rem',
              padding: '1rem 1.25rem 1.25rem',
              boxShadow:
                '0 20px 50px rgba(15,23,42,0.4)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '0.75rem',
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: '1.05rem',
                }}
              >
                ⚙ 設定
              </h2>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                style={{
                  borderRadius: 999,
                  border: 'none',
                  padding: '0.25rem 0.6rem',
                  background: '#e5e7eb',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                ✕ 閉じる
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  viewportKind === 'mobile'
                    ? 'minmax(0, 1fr)'
                    : 'minmax(0, 1.1fr) minmax(0, 1fr)',
                gap: '1rem',
                fontSize: '0.9rem',
              }}
            >
              <div>
                <h3
                  style={{
                    fontSize: '0.95rem',
                    marginTop: 0,
                    marginBottom: '0.5rem',
                  }}
                >
                  入力・出題
                </h3>
                <div style={{ marginBottom: '0.5rem' }}>
                  <label>
                    デフォルト入力方法：
                    <select
                      value={inputMode}
                      onChange={(e) =>
                        setInputMode(
                          e.target.value as InputMode
                        )
                      }
                      style={{ marginLeft: '0.4rem' }}
                    >
                      <option value="text">
                        キーボード
                      </option>
                      <option value="handwriting">
                        手書き
                      </option>
                    </select>
                  </label>
                </div>
                <div style={{ marginBottom: '0.5rem' }}>
                  <label>
                    出題順：
                    <select
                      value={
                        sessionConfig.shuffle
                          ? 'random'
                          : 'sequential'
                      }
                      onChange={(e) =>
                        setSessionConfig((prev) => ({
                          ...prev,
                          shuffle:
                            e.target.value === 'random',
                        }))
                      }
                      style={{ marginLeft: '0.4rem' }}
                    >
                      <option value="sequential">
                        昇順
                      </option>
                      <option value="random">
                        ランダム
                      </option>
                    </select>
                  </label>
                </div>
                <div style={{ marginBottom: '0.5rem' }}>
                  <label>
                    例文の表示：
                    <select
                      value={sessionConfig.showExamples}
                      onChange={(e) =>
                        setSessionConfig((prev) => ({
                          ...prev,
                          showExamples:
                            e.target.value as ShowExamplesMode,
                        }))
                      }
                      style={{ marginLeft: '0.4rem' }}
                    >
                      <option value="auto">
                        多義語のみ（おすすめ）
                      </option>
                      <option value="always">
                        常に表示
                      </option>
                      <option value="never">
                        表示しない
                      </option>
                    </select>
                  </label>
                </div>
              </div>

              <div>
                <h3
                  style={{
                    fontSize: '0.95rem',
                    marginTop: 0,
                    marginBottom: '0.5rem',
                  }}
                >
                  表示・サウンド
                </h3>
                <p
                  style={{
                    margin: 0,
                    fontSize: '0.85rem',
                    color: '#6b7280',
                  }}
                >
                  今後、読み上げの自動再生の詳細設定やテーマ切り替えなども
                  ここに追加していく予定です。
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* マイページモーダル */}
      {showMyPage && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.55)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 60,
          }}
          onClick={() => setShowMyPage(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#ffffff',
              borderRadius: 20,
              maxWidth: 640,
              width: '100%',
              margin:
                viewportKind === 'mobile'
                  ? '0.75rem'
                  : '1rem',
              padding: '1rem 1.25rem 1.2rem',
              maxHeight: '90vh',
              overflow: 'auto',
              boxShadow:
                '0 20px 50px rgba(15,23,42,0.4)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '0.75rem',
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: '1.05rem',
                }}
              >
                👤 マイページ
              </h2>
              <button
                type="button"
                onClick={() => setShowMyPage(false)}
                style={{
                  borderRadius: 999,
                  border: 'none',
                  padding: '0.25rem 0.6rem',
                  background: '#e5e7eb',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                ✕ 閉じる
              </button>
            </div>

            {/* 概要 */}
            <section
              style={{
                marginBottom: '1rem',
                fontSize: '0.9rem',
                color: '#374151',
              }}
            >
              <h3
                style={{
                  fontSize: '0.95rem',
                  marginTop: 0,
                  marginBottom: '0.35rem',
                }}
              >
                📈 学習サマリー
              </h3>
              {isLoadingOverview && (
                <p>読み込み中です…</p>
              )}
              {userOverview && (
                <div>
                  <div>
                    ユーザー：{' '}
                    <strong>
                      {userOverview.display_name}
                    </strong>
                  </div>
                  <div style={{ marginTop: '0.25rem' }}>
                    累計 正解：
                    {userOverview.total_correct} / 不正解：
                    {userOverview.total_wrong}
                  </div>
                  <div>
                    累計 問題数：
                    {userOverview.total_correct +
                      userOverview.total_wrong}
                    （
                    {userOverview.total_correct +
                    userOverview.total_wrong >
                    0
                      ? Math.round(
                          (userOverview.total_correct /
                            (userOverview.total_correct +
                              userOverview.total_wrong)) *
                            100
                        )
                      : 0}
                    % 正解）
                  </div>
                  <div>
                    今週の正解数：
                    {userOverview.weekly_correct_total}
                  </div>
                  <div>
                    最終回答日時：
                    {formatDateTime(
                      userOverview.last_answered_at ?? undefined
                    )}
                  </div>
                </div>
              )}
            </section>

            {/* 表示名変更 */}
            <section
              style={{
                marginBottom: '1rem',
                fontSize: '0.9rem',
              }}
            >
              <h3
                style={{
                  fontSize: '0.95rem',
                  marginTop: 0,
                  marginBottom: '0.35rem',
                }}
              >
                ✏️ 表示名の変更
              </h3>
              <div>
                <input
                  type="text"
                  value={displayNameEdit}
                  onChange={(e) =>
                    setDisplayNameEdit(e.target.value)
                  }
                  placeholder="ランキングなどに表示する名前"
                  style={{
                    width: '60%',
                    maxWidth: 280,
                    marginRight: '0.5rem',
                  }}
                />
                <button
                  type="button"
                  onClick={handleUpdateDisplayName}
                  style={{
                    borderRadius: 999,
                    border: 'none',
                    padding: '0.35rem 0.9rem',
                    background: '#e5e7eb',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                  }}
                >
                  保存
                </button>
              </div>
              <p
                style={{
                  fontSize: '0.85rem',
                  color: '#6b7280',
                  marginTop: '0.25rem',
                }}
              >
                ランキングやマイページに表示される名前です。
              </p>
            </section>

            {/* よく間違える単語 */}
            <section
              style={{
                marginBottom: '1rem',
                fontSize: '0.9rem',
              }}
            >
              <h3
                style={{
                  fontSize: '0.95rem',
                  marginTop: 0,
                  marginBottom: '0.35rem',
                }}
              >
                ❌ よく間違える単語 Top10
              </h3>
              {isLoadingMyPageWrong && (
                <p>読み込み中です…</p>
              )}
              {!isLoadingMyPageWrong &&
                (!myPageWrongItems ||
                  myPageWrongItems.length === 0) && (
                  <p
                    style={{
                      fontSize: '0.9rem',
                      color: '#4b5563',
                    }}
                  >
                    まだ苦手単語が記録されていません。
                  </p>
                )}
              {myPageWrongItems &&
                myPageWrongItems.length > 0 &&
                wordsData && (
                  <ol
                    style={{
                      marginTop: '0.5rem',
                      fontSize: '0.9rem',
                      color: '#374151',
                    }}
                  >
                    {myPageWrongItems.map((stat) => {
                      const deck =
                        wordsData.decks[stat.deck] ||
                        wordsData.decks['core'];
                      const word = deck.items.find(
                        (w) => w.id === stat.item_id
                      );
                      return (
                        <li
                          key={stat.item_id}
                          style={{
                            marginBottom: '0.3rem',
                          }}
                        >
                          {word ? (
                            <>
                              <strong>
                                {word.english}
                              </strong>{' '}
                              / {word.japanese}（間違え{' '}
                              {stat.wrong_total} 回 / 正解{' '}
                              {stat.correct_total} 回）
                            </>
                          ) : (
                            <>
                              item_id: {stat.item_id}
                              （単語データなし）
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
            </section>

            {/* ランキング案内（現時点では非表示扱い） */}
            <section
              style={{
                marginBottom: 0,
                fontSize: '0.9rem',
              }}
            >
              <h3
                style={{
                  fontSize: '0.95rem',
                  marginTop: 0,
                  marginBottom: '0.35rem',
                }}
              >
                🏆 ランキング（準備中）
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: '0.85rem',
                  color: '#6b7280',
                }}
              >
                今後、ここから「今週の正解数ランキング」を確認できるようにする予定です。
              </p>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
