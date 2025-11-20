import { useEffect, useRef, useState } from 'react';
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

// JWT デコード
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

// JSONP（CORS 回避）
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

// 日時表示
function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP');
}

// 型定義
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

type RankingEntry = {
  user_id: string;
  display_name: string;
  weekly_correct_total: number;
};

type RankingResponse = {
  ok: boolean;
  ranking?: RankingEntry[];
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

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function App() {
  // ---- auth ----
  const [authReady, setAuthReady] = useState(false);
  const [isPostLoginLoading, setIsPostLoginLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);

  // ---- data ----
  const [wordsData, setWordsData] = useState<WordsData | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // ---- session config ----
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
  const [showConfigPanel, setShowConfigPanel] = useState(true);

  // ---- session state ----
  const [sessionBookId, setSessionBookId] = useState<string | null>(null);
  const [sessionDeckId, setSessionDeckId] = useState<string | null>(null);
  const [sessionItems, setSessionItems] = useState<WordItem[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [pageSize, setPageSize] = useState<number>(15);

  // test answers
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [marks, setMarks] = useState<Record<number, 'correct' | 'wrong'>>({});
  const [showAnswers, setShowAnswers] = useState<boolean>(false);
  const [isSavingPage, setIsSavingPage] = useState<boolean>(false);

  // flash cards
  const [cardIndex, setCardIndex] = useState<number>(0);
  const [showCardAnswer, setShowCardAnswer] = useState<boolean>(false);

  // ranking / mypage
  const [ranking, setRanking] = useState<RankingEntry[] | null>(null);
  const [isLoadingRanking, setIsLoadingRanking] = useState<boolean>(false);
  const [userOverview, setUserOverview] = useState<UserOverview | null>(null);
  const [isLoadingOverview, setIsLoadingOverview] = useState<boolean>(false);
  const [myPageWrongItems, setMyPageWrongItems] = useState<WrongItemStat[] | null>(null);
  const [isLoadingMyPageWrong, setIsLoadingMyPageWrong] = useState<boolean>(false);
  const [displayNameEdit, setDisplayNameEdit] = useState<string>('');

  // speech
  const [englishVoice, setEnglishVoice] = useState<SpeechSynthesisVoice | null>(null);

  // google button
  const googleBtnRef = useRef<HTMLDivElement | null>(null);

  // prefetch guard
  const didPrefetchRef = useRef(false);

  // -------------------------
  // Restore auth from localStorage (avoid iPhone re-login / flicker)
  // -------------------------
  useEffect(() => {
    try {
      const saved = localStorage.getItem('auth');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.userId) setUserId(parsed.userId);
        if (parsed?.displayName) setDisplayName(parsed.displayName);
      }
    } catch {}
    setAuthReady(true);
  }, []);

  // -------------------------
  // Load word json (BASE_URL)
  // -------------------------
  useEffect(() => {
    const load = async () => {
      try {
        const url = `${import.meta.env.BASE_URL}words_gold.json`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        const data: WordsData = await res.json();
        setWordsData(data);

        // deckId が存在しない場合は先頭に合わせる
        const deckKeys = Object.keys(data.decks);
        if (deckKeys.length && !data.decks[sessionConfig.deckId]) {
          setSessionConfig((prev) => ({ ...prev, deckId: deckKeys[0] }));
        }
      } catch (e) {
        console.error(e);
        setMessage('単語データの読み込みに失敗しました');
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------
  // Pick English voice (best-effort for iOS too)
  // -------------------------
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const synth = window.speechSynthesis;

    const pickVoice = () => {
      const voices = synth.getVoices();
      if (!voices || voices.length === 0) return;
      const en = voices.filter((v) => (v.lang || '').toLowerCase().startsWith('en'));
      const preferredNames = ['Samantha', 'Karen', 'Daniel', 'Alex', 'Fred'];
      let chosen: SpeechSynthesisVoice | null = null;
      for (const name of preferredNames) {
        const found = en.find((v) => v.name.includes(name));
        if (found) { chosen = found; break; }
      }
      if (!chosen) chosen = en[0] || voices[0];
      setEnglishVoice(chosen);
    };

    pickVoice();
    synth.addEventListener('voiceschanged', pickVoice);
    return () => synth.removeEventListener('voiceschanged', pickVoice);
  }, []);

  const speakEnglish = (text: string) => {
    if (!text) return;
    const synth = window.speechSynthesis;
    if (!synth) {
      alert('このブラウザは音声読み上げに対応していません');
      return;
    }

    // iOS対策：resume してから speak
    try { synth.cancel(); } catch {}
    try { synth.resume(); } catch {}

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

  // -------------------------
  // Google login handler
  // -------------------------
  async function handleGoogleCredentialResponse(response: any) {
    setIsPostLoginLoading(true);
    setMessage(null);
    try {
      const idToken = response.credential as string | undefined;
      if (!idToken) throw new Error('no id token');

      const payload = decodeJwt(idToken);
      const sub = String(payload.sub);
      const email = (payload.email as string) || '';
      const name = (payload.name as string) || '';

      const localUserId = 'g_' + sub;
      const localDisplay = name || email || localUserId;

      setUserId(localUserId);
      setDisplayName(localDisplay);
      localStorage.setItem('auth', JSON.stringify({ userId: localUserId, displayName: localDisplay }));

      const body = {
        action: 'upsertUser',
        userId: localUserId,
        googleSub: sub,
        email,
        displayName: localDisplay,
      };

      // upsert は no-cors で fire-and-forget
      fetch(GAS_ENDPOINT, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
      }).catch((e) => console.error(e));

      // すぐにスプレッドシート情報も取りに行く（ぐるぐる中）
      if (wordsData && !didPrefetchRef.current) {
        await prefetchUserData(localUserId, wordsData.bookId, sessionConfig.deckId);
        didPrefetchRef.current = true;
      }
    } catch (e) {
      console.error(e);
      setMessage('Google ログインに失敗しました');
      setUserId(null);
      setDisplayName(null);
      localStorage.removeItem('auth');
    } finally {
      setIsPostLoginLoading(false);
    }
  }

  // -------------------------
  // Init Google button (render once)
  // -------------------------
  useEffect(() => {
    if (!authReady || userId) return;
    if (!GOOGLE_CLIENT_ID) return;

    const tryInit = () => {
      if (!window.google || !window.google.accounts?.id) {
        setTimeout(tryInit, 400);
        return;
      }

      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleCredentialResponse,
      });

      if (googleBtnRef.current) {
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: 'outline',
          size: 'large',
          type: 'standard',
          text: 'signin_with',
          shape: 'pill',
        });
      }

      // iOSでOne Tapが出ない時の保険
      try { window.google.accounts.id.prompt(); } catch {}
    };

    tryInit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, userId]);

  // -------------------------
  // Debug login
  // -------------------------
  const handleDebugLogin = async () => {
    const id = 'debug_user';
    setIsPostLoginLoading(true);
    setUserId(id);
    setDisplayName(id);
    localStorage.setItem('auth', JSON.stringify({ userId: id, displayName: id }));

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

    if (wordsData && !didPrefetchRef.current) {
      await prefetchUserData(id, wordsData.bookId, sessionConfig.deckId);
      didPrefetchRef.current = true;
    }
    setIsPostLoginLoading(false);
  };

  // -------------------------
  // Prefetch mypage info on (userId + words) ready
  // -------------------------
  const prefetchUserData = async (uid: string, bookId: string, deckId: string) => {
    setIsLoadingOverview(true);
    setIsLoadingMyPageWrong(true);
    try {
      const [overviewRes, wrongRes] = await Promise.all([
        jsonp<UserOverviewResponse>({ action: 'getUserOverview', userId: uid }),
        jsonp<WrongItemsResponse>({ action: 'getWrongItems', userId: uid, bookId, deck: deckId }),
      ]);

      if (overviewRes.ok && overviewRes.user) {
        setUserOverview(overviewRes.user);
        setDisplayNameEdit(overviewRes.user.display_name);
      } else {
        setUserOverview(null);
      }

      if (wrongRes.ok && wrongRes.items) {
        const items = [...wrongRes.items].filter((i) => i.wrong_total > 0);
        items.sort((a, b) => {
          if (b.wrong_total !== a.wrong_total) return b.wrong_total - a.wrong_total;
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
    } finally {
      setIsLoadingOverview(false);
      setIsLoadingMyPageWrong(false);
    }
  };

  useEffect(() => {
    if (!userId || !wordsData || didPrefetchRef.current) return;
    prefetchUserData(userId, wordsData.bookId, sessionConfig.deckId).then(() => {
      didPrefetchRef.current = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, wordsData]);

  // -------------------------
  // Start normal session
  // -------------------------
  const handleStartSession = () => {
    if (!wordsData) {
      setMessage('単語データがまだ読み込まれていません');
      return;
    }

    const deck = wordsData.decks[sessionConfig.deckId];
    if (!deck) {
      setMessage('選択されたセットが見つかりません: ' + sessionConfig.deckId);
      return;
    }

    let filtered: WordItem[] = [];

    if (sessionConfig.mode === 'index') {
      const start = Math.max(1, sessionConfig.startIndex);
      const end = Math.max(start, sessionConfig.endIndex);

      filtered = deck.items.filter((item) => {
        const idx = item.bookIndex ?? 0;
        return idx >= start && idx <= end;
      });
    } else {
      filtered = deck.items.filter((item) => {
        if (sessionConfig.level === 'all') return true;
        return item.level === sessionConfig.level;
      });
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
    setShowConfigPanel(false);
  };

  // -------------------------
  // Start wrong session
  // -------------------------
  const handleStartWrongSession = async () => {
    if (!userId) {
      alert('苦手単語モードにはログインが必要です');
      return;
    }
    if (!wordsData) {
      alert('単語データがまだ読み込まれていません');
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
        alert('苦手単語リストの取得に失敗しました');
        return;
      }

      const deck = wordsData.decks[deckId];
      if (!deck) {
        alert('セットが見つかりません: ' + deckId);
        return;
      }

      const mapById = new Map<number, WordItem>();
      deck.items.forEach((w) => mapById.set(w.id, w));

      let wordList: WordItem[] = [];
      res.items.forEach((stat) => {
        const item = mapById.get(stat.item_id);
        if (item) wordList.push(item);
      });

      if (wordList.length === 0) {
        alert('不正解がある単語がまだありません');
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
      setShowConfigPanel(false);
    } catch (e) {
      console.error(e);
      alert('苦手単語モード取得時にエラーが発生しました');
    }
  };

  // -------------------------
  // Paging
  // -------------------------
  const totalPages = sessionItems.length > 0 ? Math.ceil(sessionItems.length / pageSize) : 0;
  const startIndex = currentPage * pageSize;
  const endIndex = Math.min(startIndex + pageSize, sessionItems.length);
  const pageItems = sessionItems.slice(startIndex, endIndex);
  const isEnToJp = sessionConfig.direction === 'en_to_jp';

  const shouldShowExampleInQuestion = (word: WordItem): boolean => {
    if (sessionConfig.showExamples === 'never') return false;
    if (sessionConfig.showExamples === 'always') return true;
    return !!word.poly; // auto: 多義語のみ
  };

  // -------------------------
  // Show answers for current page
  // -------------------------
  const handleShowAnswersForPage = () => {
    setShowAnswers(true);
    setMarks((prev) => {
      const updated: Record<number, 'correct' | 'wrong'> = { ...prev };
      pageItems.forEach((_, idx) => {
        const absIndex = startIndex + idx;
        if (updated[absIndex] === undefined) updated[absIndex] = 'correct';
      });
      return updated;
    });
    // 採点開始したら自動でトップへ戻る
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // -------------------------
  // Save current page results
  // -------------------------
  const handleSaveCurrentPage = async () => {
    if (!sessionBookId || !sessionDeckId) {
      alert('セッションが開始されていません');
      return;
    }
    if (!userId) {
      alert('先にログインしてください');
      return;
    }
    if (pageItems.length === 0) {
      alert('このページには問題がありません');
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
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });

      alert('このページの成績を保存しました');

      if (currentPage + 1 < totalPages) {
        setCurrentPage((prev) => prev + 1);
        setShowAnswers(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        alert('セッションが終了しました');
      }

      // 週次正解数などが増えるので、マイページも更新しておく
      if (wordsData) {
        didPrefetchRef.current = false;
        prefetchUserData(userId, wordsData.bookId, sessionDeckId);
      }
    } catch (e) {
      console.error(e);
      alert('成績保存リクエストの送信に失敗しました');
    } finally {
      setIsSavingPage(false);
    }
  };

  // -------------------------
  // Ranking
  // -------------------------
  const handleFetchRanking = async () => {
    setIsLoadingRanking(true);
    try {
      const res = await jsonp<RankingResponse>({ action: 'getRanking' });
      if (!res.ok || !res.ranking) {
        setRanking(null);
        alert('ランキングの取得に失敗しました');
        return;
      }
      setRanking(res.ranking);
    } catch (e) {
      console.error(e);
      alert('ランキング取得時にエラーが発生しました');
    } finally {
      setIsLoadingRanking(false);
    }
  };

  // -------------------------
  // MyPage (manual refresh)
  // -------------------------
  const handleFetchMyPage = async () => {
    if (!userId || !wordsData) return;
    await prefetchUserData(userId, wordsData.bookId, sessionConfig.deckId);
  };

  // -------------------------
  // Update display name
  // -------------------------
  const handleUpdateDisplayName = async () => {
    if (!userId) {
      alert('ログインしていません');
      return;
    }
    const newName = displayNameEdit.trim();
    if (!newName) {
      alert('表示名を入力してください');
      return;
    }

    try {
      const payload = { action: 'updateDisplayName', userId, displayName: newName };
      await fetch(GAS_ENDPOINT, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });

      setDisplayName(newName);
      setUserOverview((prev) => (prev ? { ...prev, display_name: newName } : prev));
      localStorage.setItem('auth', JSON.stringify({ userId, displayName: newName }));

      alert('表示名を保存しました');
    } catch (e) {
      console.error(e);
      alert('表示名の更新に失敗しました');
    }
  };

  // reset flash card when items change
  useEffect(() => {
    setCardIndex(0);
    setShowCardAnswer(false);
  }, [viewMode, sessionItems]);

  const goTop = () => {
    setSessionItems([]);
    setCurrentPage(0);
    setShowAnswers(false);
    setAnswers({});
    setMarks({});
    setShowConfigPanel(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // -------------------------
  // UI
  // -------------------------
  return (
    <div
      style={{
        width: '100%',
        maxWidth: 1024,
        margin: '0 auto',
        padding: '1rem 1.25rem',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        lineHeight: 1.55,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1
          style={{ margin: 0, cursor: 'pointer', fontSize: '1.6rem' }}
          onClick={goTop}
          title="トップへ戻る"
        >
          単語テスト
        </h1>
        {userId && (
          <div style={{ fontSize: '0.95rem', color: '#444' }}>
            {displayName ?? userId}
          </div>
        )}
      </header>

      {/* メッセージ（エラー時のみ軽く出す） */}
      {message && (
        <div
          style={{
            margin: '0.75rem 0',
            padding: '0.5rem 0.75rem',
            borderRadius: 8,
            background: '#fff3cd',
            color: '#664d03',
            fontSize: '0.95rem',
          }}
        >
          {message}
        </div>
      )}

      {/* ログイン */}
      <section
        style={{
          marginTop: '1rem',
          marginBottom: '1rem',
          padding: '0.9rem',
          border: '1px solid #e6e6e6',
          borderRadius: 10,
          background: '#fafafa',
        }}
      >
        <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>ログイン</h2>

        {!authReady ? (
          <div>ログイン状態を確認中…</div>
        ) : isPostLoginLoading ? (
          <div>ログイン処理中…</div>
        ) : userId ? (
          <div>ログイン中です ✅</div>
        ) : (
          <div>
            <div ref={googleBtnRef} style={{ marginBottom: '0.5rem' }} />
            <button onClick={handleDebugLogin} style={{ fontSize: '0.9rem' }}>
              （うまくいかないとき用）デバッグログイン
            </button>
          </div>
        )}
      </section>

      {!wordsData && <div style={{ marginTop: '1rem' }}>単語データを読み込み中…</div>}

      {/* 出題設定 */}
      {wordsData && showConfigPanel && (
        <section
          style={{
            marginTop: '1rem',
            marginBottom: '1.25rem',
            padding: '1rem',
            border: '1px solid #eee',
            borderRadius: 12,
            background: '#fff',
          }}
        >
          <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>出題設定</h2>

          {/* モード切り替え */}
          <div style={{ marginBottom: '0.5rem' }}>
            <label style={{ marginRight: '1rem' }}>
              <input
                type="radio"
                value="index"
                checked={sessionConfig.mode === 'index'}
                onChange={() =>
                  setSessionConfig((prev) => ({ ...prev, mode: 'index' }))
                }
              />{' '}
              番号指定
            </label>
            <label>
              <input
                type="radio"
                value="level"
                checked={sessionConfig.mode === 'level'}
                onChange={() =>
                  setSessionConfig((prev) => ({ ...prev, mode: 'level' }))
                }
              />{' '}
              レベル別
            </label>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '0.75rem',
              alignItems: 'center',
            }}
          >
            <label>
              セット：
              <select
                value={sessionConfig.deckId}
                onChange={(e) =>
                  setSessionConfig((prev) => ({
                    ...prev,
                    deckId: e.target.value,
                  }))
                }
                style={{ marginLeft: '0.4rem' }}
              >
                {Object.values(wordsData.decks).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.labelJa || d.id}
                  </option>
                ))}
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
                        startIndex: Number(e.target.value || 1),
                      }))
                    }
                    style={{ width: '6rem', marginLeft: '0.4rem' }}
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
                        endIndex: Number(e.target.value || prev.startIndex || 1),
                      }))
                    }
                    style={{ width: '6rem', marginLeft: '0.4rem' }}
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
                  style={{ marginLeft: '0.4rem' }}
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
                    direction: e.target.value as Direction,
                  }))
                }
                style={{ marginLeft: '0.4rem' }}
              >
                <option value="en_to_jp">英語 → 日本語</option>
                <option value="jp_to_en">日本語 → 英語</option>
              </select>
            </label>

            <label>
              1ページの問題数：
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                style={{ marginLeft: '0.4rem' }}
              >
                <option value={1}>1</option>
                <option value={5}>5</option>
                <option value={15}>15</option>
                <option value={30}>30</option>
                <option value={50}>50</option>
              </select>
            </label>

            <label>
              入力方法：
              <select
                value={inputMode}
                onChange={(e) => setInputMode(e.target.value as InputMode)}
                style={{ marginLeft: '0.4rem' }}
              >
                <option value="text">キーボード入力</option>
                <option value="handwriting">手書き入力</option>
              </select>
            </label>

            <label>
              表示モード：
              <select
                value={viewMode}
                onChange={(e) => setViewMode(e.target.value as ViewMode)}
                style={{ marginLeft: '0.4rem' }}
              >
                <option value="test">テスト</option>
                <option value="flash">単語カード</option>
              </select>
            </label>

            <label>
              出題順：
              <select
                value={sessionConfig.shuffle ? 'random' : 'sequential'}
                onChange={(e) =>
                  setSessionConfig((prev) => ({
                    ...prev,
                    shuffle: e.target.value === 'random',
                  }))
                }
                style={{ marginLeft: '0.4rem' }}
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
                    showExamples: e.target.value as ShowExamplesMode,
                  }))
                }
                style={{ marginLeft: '0.4rem' }}
              >
                <option value="auto">多義語のみ</option>
                <option value="always">常に表示</option>
                <option value="never">表示しない</option>
              </select>
            </label>
          </div>

          <div style={{ marginTop: '0.9rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <button onClick={handleStartSession}>テスト開始</button>
            <button onClick={handleStartWrongSession}>間違えた単語だけ復習</button>
          </div>
        </section>
      )}

      {/* 設定再表示ボタン */}
      {wordsData && !showConfigPanel && (
        <div style={{ marginBottom: '0.75rem' }}>
          <button onClick={() => setShowConfigPanel(true)} style={{ fontSize: '0.9rem' }}>
            出題設定を表示
          </button>
        </div>
      )}

      {wordsData && sessionItems.length === 0 && (
        <div style={{ marginBottom: '1rem' }}>
          出題設定をして「テスト開始」または「間違えた単語だけ復習」を押してください。
        </div>
      )}

      {/* テストモード */}
      {wordsData && sessionItems.length > 0 && viewMode === 'test' && (
        <section
          style={{
            marginBottom: '2rem',
            padding: '1rem',
            border: '1px solid #eee',
            borderRadius: 12,
            background: '#fff',
          }}
        >
          <h2 style={{ marginTop: 0 }}>
            ページ {currentPage + 1} / {totalPages}（{startIndex + 1}〜{endIndex} 問）
          </h2>
          <p>
            <strong>{isEnToJp ? '英語 → 日本語' : '日本語 → 英語'}</strong>
          </p>

          {pageItems.map((word, idx) => {
            const absIndex = startIndex + idx;
            const answerValue = answers[absIndex] ?? '';
            const mark = marks[absIndex];
            const showExample = shouldShowExampleInQuestion(word);

            return (
              <div
                key={word.id}
                style={{
                  marginBottom: '1rem',
                  paddingBottom: '0.75rem',
                  borderBottom: '1px dashed #eee',
                }}
              >
                <div style={{ fontSize: '1.1rem' }}>
                  問題 {absIndex + 1}.{' '}
                  <strong>{isEnToJp ? word.english : word.japanese}</strong>

                  {/* 単語読み上げ（テストモード復活） */}
                  {isEnToJp && (
                    <button
                      type="button"
                      onClick={() => speakEnglish(word.audio_text || word.english)}
                      style={{ marginLeft: '0.5rem', fontSize: '0.8rem' }}
                    >
                      🔊 単語
                    </button>
                  )}

                  {/* 例文読み上げ：表示しているときだけ */}
                  {showExample && word.example_en && (
                    <button
                      type="button"
                      onClick={() => speakEnglish(word.example_en)}
                      style={{ marginLeft: '0.25rem', fontSize: '0.8rem' }}
                    >
                      🔊 例文
                    </button>
                  )}
                </div>

                {showExample && (
                  <div style={{ fontStyle: 'italic', color: '#555' }}>
                    例文: {isEnToJp ? word.example_en : word.example_jp}
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
                            [absIndex]: e.target.value,
                          }))
                        }
                        style={{ marginLeft: '0.5rem', width: '70%', maxWidth: 420 }}
                        placeholder={isEnToJp ? '日本語の意味' : '英語の単語'}
                      />
                    </label>
                  ) : (
                    <div>
                      <div style={{ marginBottom: '0.25rem' }}>手書きで回答：</div>
                      <HandwritingCanvas height={140} />
                    </div>
                  )}
                </div>

                {showAnswers && (
                  <div
                    style={{
                      marginTop: '0.35rem',
                      padding: '0.5rem',
                      border: '1px solid #f0f0f0',
                      borderRadius: 8,
                      background: '#fafafa',
                    }}
                  >
                    <div>
                      正解：{isEnToJp ? word.japanese : word.english}
                    </div>
                    {word.example_jp && (
                      <div style={{ fontSize: '0.9rem', marginTop: '0.2rem' }}>
                        例文（日本語）：{word.example_jp}
                      </div>
                    )}
                    {word.example_en && (
                      <div style={{ fontSize: '0.9rem' }}>
                        例文（英語）：{word.example_en}
                      </div>
                    )}

                    <div style={{ marginTop: '0.35rem' }}>
                      自己採点：
                      <button
                        onClick={() =>
                          setMarks((prev) => ({ ...prev, [absIndex]: 'correct' }))
                        }
                        style={{
                          marginLeft: '0.5rem',
                          fontWeight: mark === 'correct' ? 'bold' : 'normal',
                          background: mark === 'correct' ? '#d1e7dd' : undefined,
                          borderRadius: 6,
                          padding: '0.15rem 0.5rem',
                        }}
                      >
                        ○ 正解
                      </button>
                      <button
                        onClick={() =>
                          setMarks((prev) => ({ ...prev, [absIndex]: 'wrong' }))
                        }
                        style={{
                          marginLeft: '0.5rem',
                          fontWeight: mark === 'wrong' ? 'bold' : 'normal',
                          background: mark === 'wrong' ? '#f8d7da' : undefined,
                          borderRadius: 6,
                          padding: '0.15rem 0.5rem',
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
            <button onClick={handleShowAnswersForPage}>
              このページの解答を表示（未採点はデフォルトで○）
            </button>
          </div>

          <div style={{ marginTop: '0.75rem' }}>
            <button onClick={handleSaveCurrentPage} disabled={isSavingPage || pageItems.length === 0}>
              このページの採点を保存して
              {currentPage + 1 < totalPages ? '次のページへ' : 'セッション終了'}
            </button>
          </div>
        </section>
      )}

      {/* 単語カード */}
      {wordsData && sessionItems.length > 0 && viewMode === 'flash' && (
        <section
          style={{
            marginBottom: '2rem',
            padding: '1rem',
            border: '1px solid #eee',
            borderRadius: 12,
            background: '#fff',
          }}
        >
          <h2 style={{ marginTop: 0 }}>単語カード</h2>
          <p>
            全 {sessionItems.length} 枚 / 現在 {cardIndex + 1} 枚目（
            {isEnToJp ? '英語 → 日本語' : '日本語 → 英語'}）
          </p>

          {sessionItems[cardIndex] && (
            <div
              style={{
                border: '1px solid #ddd',
                borderRadius: 12,
                padding: '1rem',
                background: '#fffdf8',
                minHeight: '140px',
              }}
            >
              <div style={{ fontSize: '1.35rem', marginBottom: '0.5rem' }}>
                <strong>
                  {isEnToJp ? sessionItems[cardIndex].english : sessionItems[cardIndex].japanese}
                </strong>
              </div>

              <div style={{ marginBottom: '0.5rem' }}>
                {isEnToJp && (
                  <button
                    type="button"
                    onClick={() =>
                      speakEnglish(sessionItems[cardIndex].audio_text || sessionItems[cardIndex].english)
                    }
                    style={{ marginRight: '0.5rem', fontSize: '0.85rem' }}
                  >
                    🔊 単語
                  </button>
                )}
                {sessionItems[cardIndex].example_en && (
                  <button
                    type="button"
                    onClick={() => speakEnglish(sessionItems[cardIndex].example_en)}
                    style={{ fontSize: '0.85rem' }}
                  >
                    🔊 例文
                  </button>
                )}
              </div>

              <button type="button" onClick={() => setShowCardAnswer((prev) => !prev)}>
                {showCardAnswer ? '答えを隠す' : '答えを表示'}
              </button>

              {showCardAnswer && (
                <div style={{ marginTop: '0.75rem' }}>
                  <div>
                    答え：
                    <strong>
                      {isEnToJp ? sessionItems[cardIndex].japanese : sessionItems[cardIndex].english}
                    </strong>
                  </div>
                  {sessionItems[cardIndex].example_jp && (
                    <div style={{ marginTop: '0.25rem', fontSize: '0.95rem' }}>
                      例文（日本語）：{sessionItems[cardIndex].example_jp}
                    </div>
                  )}
                  {sessionItems[cardIndex].example_en && (
                    <div style={{ fontSize: '0.95rem' }}>
                      例文（英語）：{sessionItems[cardIndex].example_en}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => {
                setCardIndex((prev) => (prev === 0 ? sessionItems.length - 1 : prev - 1));
                setShowCardAnswer(false);
              }}
            >
              ← 前へ
            </button>
            <button
              type="button"
              onClick={() => {
                setCardIndex((prev) => (prev + 1 >= sessionItems.length ? 0 : prev + 1));
                setShowCardAnswer(false);
              }}
            >
              次へ →
            </button>
          </div>
        </section>
      )}

      {/* マイページ */}
      <section
        style={{
          marginBottom: '2rem',
          padding: '1rem',
          border: '1px solid #eee',
          borderRadius: 12,
          background: '#fff',
        }}
      >
        <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>マイページ</h2>

        {!userId && <div>ログインすると記録が表示されます。</div>}

        {userId && (
          <button
            onClick={handleFetchMyPage}
            disabled={isLoadingOverview || isLoadingMyPageWrong}
            style={{ fontSize: '0.9rem' }}
          >
            {isLoadingOverview || isLoadingMyPageWrong ? '読み込み中…' : '記録を更新'}
          </button>
        )}

        {userOverview && (
          <div style={{ marginTop: '0.75rem' }}>
            <div>
              ユーザー：<strong>{userOverview.display_name}</strong>
            </div>
            <div style={{ marginTop: '0.25rem' }}>
              累計 正解：{userOverview.total_correct} / 不正解：{userOverview.total_wrong}
            </div>
            <div>今週の正解数：{userOverview.weekly_correct_total}</div>
            <div>
              最終回答日時：{formatDateTime(userOverview.last_answered_at ?? undefined)}
            </div>
          </div>
        )}

        {/* 表示名変更 */}
        {userId && (
          <div style={{ marginTop: '1rem' }}>
            <h3 style={{ fontSize: '1rem' }}>表示名の変更</h3>
            <div>
              <input
                type="text"
                value={displayNameEdit}
                onChange={(e) => setDisplayNameEdit(e.target.value)}
                placeholder="ランキングなどに表示する名前"
                style={{ width: '60%', maxWidth: 280, marginRight: '0.5rem' }}
              />
              <button type="button" onClick={handleUpdateDisplayName}>保存</button>
            </div>
          </div>
        )}

        {/* よく間違える単語 */}
        {userId && (
          <div style={{ marginTop: '1rem' }}>
            <h3 style={{ fontSize: '1rem' }}>よく間違える単語 Top10</h3>
            {!myPageWrongItems && !isLoadingMyPageWrong && <p>まだ苦手単語が記録されていません。</p>}
            {myPageWrongItems && myPageWrongItems.length === 0 && <p>まだ苦手単語が記録されていません。</p>}
            {myPageWrongItems && myPageWrongItems.length > 0 && wordsData && (
              <ol style={{ marginTop: '0.5rem' }}>
                {myPageWrongItems.map((stat) => {
                  const deck = wordsData.decks[stat.deck] || wordsData.decks['core'];
                  const word = deck.items.find((w) => w.id === stat.item_id);
                  return (
                    <li key={stat.item_id} style={{ marginBottom: '0.3rem' }}>
                      {word ? (
                        <>
                          <strong>{word.english}</strong> / {word.japanese}（
                          間違え {stat.wrong_total} 回 / 正解 {stat.correct_total} 回）
                        </>
                      ) : (
                        <>item_id: {stat.item_id}（単語データなし）</>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}
      </section>

      {/* ランキング */}
      <section
        style={{
          marginBottom: '2rem',
          padding: '1rem',
          border: '1px solid #eee',
          borderRadius: 12,
          background: '#fff',
        }}
      >
        <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>ランキング（今週の正解数）</h2>
        <button onClick={handleFetchRanking} disabled={isLoadingRanking}>
          {isLoadingRanking ? 'ランキング取得中…' : 'ランキングを更新'}
        </button>

        {ranking && ranking.length === 0 && (
          <p style={{ marginTop: '0.5rem' }}>まだ今週の正解記録がありません。</p>
        )}

        {ranking && ranking.length > 0 && (
          <ol style={{ marginTop: '0.75rem' }}>
            {ranking.slice(0, 20).map((entry, index) => (
              <li key={entry.user_id} style={{ marginBottom: '0.25rem' }}>
                {index + 1}位：{entry.display_name} さん（{entry.weekly_correct_total} 問）
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
