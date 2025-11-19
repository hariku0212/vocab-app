import { useEffect, useState } from 'react';
import HandwritingCanvas from './HandwritingCanvas';

const GAS_ENDPOINT =
  'https://script.google.com/macros/s/AKfycbw5_IGof9wirpNIhkBNEPxh8kwsLKFqaSRWwQumQ2z5xqt5YspochMmccRtfE4fD2ZQSg/exec';

const GOOGLE_CLIENT_ID =
  '141623918894-f9kmkrrk7640lqhupp25nfhcog2jihim.apps.googleusercontent.com';

declare global {
  interface Window {
    google?: any;
    [key: string]: any;
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
type MainTab = 'practice' | 'mypage' | 'ranking';

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

function App() {
  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);

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
  const [mainTab, setMainTab] = useState<MainTab>('practice');

  const [sessionBookId, setSessionBookId] = useState<string | null>(null);
  const [sessionDeckId, setSessionDeckId] = useState<string | null>(null);
  const [sessionItems, setSessionItems] = useState<WordItem[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [pageSize, setPageSize] = useState<number>(15);

  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [marks, setMarks] = useState<Record<number, 'correct' | 'wrong'>>({});
  const [showAnswers, setShowAnswers] = useState<boolean>(false);
  const [isSavingPage, setIsSavingPage] = useState<boolean>(false);

  const [cardIndex, setCardIndex] = useState<number>(0);
  const [showCardAnswer, setShowCardAnswer] = useState<boolean>(false);

  const [ranking, setRanking] = useState<RankingEntry[] | null>(null);
  const [isLoadingRanking, setIsLoadingRanking] = useState<boolean>(false);

  const [userOverview, setUserOverview] = useState<UserOverview | null>(null);
  const [isLoadingOverview, setIsLoadingOverview] = useState<boolean>(false);
  const [myPageWrongItems, setMyPageWrongItems] = useState<
    WrongItemStat[] | null
  >(null);
  const [isLoadingMyPageWrong, setIsLoadingMyPageWrong] =
    useState<boolean>(false);

  const [displayNameEdit, setDisplayNameEdit] = useState<string>('');
  const [message, setMessage] = useState<string | null>(null);

  const [englishVoice, setEnglishVoice] = useState<SpeechSynthesisVoice | null>(
    null
  );

  /***************
   * Google ログイン
   ***************/
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
        setMessage('Google ログインしました: ' + localDisplay);
      } catch (e) {
        console.error(e);
        setMessage('Google ログイン情報の送信に失敗しました');
      }
    } catch (e) {
      console.error(e);
      setMessage('Google ログイン時にエラーが発生しました');
    }
  }

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
  }, []);

  /***************
   * 単語データ読み込み（BASE_URL 対応）
   ***************/
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

  /***************
   * 音声読み上げ用の英語 voice 選択
   ***************/
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const synth = window.speechSynthesis;

    const pickVoice = () => {
      const voices = synth.getVoices();
      if (!voices || voices.length === 0) return;

      const langLower = (v: SpeechSynthesisVoice) =>
        (v.lang || '').toLowerCase();
      const enVoices = voices.filter((v) => langLower(v).startsWith('en'));

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

  const speakEnglish = (text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const synth = window.speechSynthesis;
    if (!synth) {
      alert('このブラウザは音声読み上げに対応していません');
      return;
    }
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

  /***************
   * デバッグログイン
   ***************/
  const handleDebugLogin = () => {
    const id = 'debug_user';
    setUserId(id);
    setDisplayName(id);
    setMessage('デバッグ用ユーザーとしてログインしました');

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

  /***************
   * 出題ロジック
   ***************/
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
        `番号指定モード: ${deck.labelJa} / 範囲 ${start}〜${end} / 想定問題数: ${expectedCount}（実際: ${filtered.length} 問）`
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
    setMainTab('practice');
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
        return;
      }

      const deck = wordsData.decks[deckId];
      if (!deck) {
        setMessage('デッキが見つかりません: ' + deckId);
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
      setMainTab('practice');

      setMessage(`苦手単語モード開始: ${wordList.length} 問`);
    } catch (e) {
      console.error(e);
      setMessage('苦手単語モード取得時にエラーが発生しました');
    }
  };

  /***************
   * ページング
   ***************/
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

      setMessage(
        `${displayName ?? userId} さんのこのページの成績を保存リクエストしました`
      );

      if (currentPage + 1 < totalPages) {
        setCurrentPage((prev) => prev + 1);
        setShowAnswers(false);
      } else {
        setMessage(
          `${displayName ?? userId} さんのセッションが終了しました（全ページ保存済み）`
        );
      }
    } catch (e) {
      console.error(e);
      setMessage('成績保存リクエストの送信に失敗しました');
    } finally {
      setIsSavingPage(false);
    }
  };

  /***************
   * ランキング
   ***************/
  const handleFetchRanking = async () => {
    setIsLoadingRanking(true);
    try {
      const res = await jsonp<RankingResponse>({
        action: 'getRanking',
      });

      if (!res.ok || !res.ranking) {
        setMessage('ランキングの取得に失敗しました');
        setRanking(null);
        return;
      }

      setRanking(res.ranking);
    } catch (e) {
      console.error(e);
      setMessage('ランキング取得時にエラーが発生しました');
    } finally {
      setIsLoadingRanking(false);
    }
  };

  /***************
   * マイページ
   ***************/
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
        const items = [...wrongRes.items].filter((i) => i.wrong_total > 0);
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

  /***************
   * 単語カード
   ***************/
  useEffect(() => {
    setCardIndex(0);
    setShowCardAnswer(false);
  }, [viewMode, sessionItems]);

  /***************
   * JSX
   ***************/
  return (
    <div
      style={{
        maxWidth: 960,
        margin: '0 auto',
        padding: '1.5rem 1rem 2rem',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      {/* ヘッダー */}
      <header
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          marginBottom: '1.25rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            gap: '0.5rem',
            alignItems: 'center',
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: '1.6rem' }}>
              金のフレーズ Web 単語テスト
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: '0.9rem',
                color: '#555',
              }}
            >
              TOEIC「金のフレーズ」を PC / iPad でサクサク復習
            </p>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div
              style={{
                fontSize: '0.85rem',
                marginBottom: '0.25rem',
                color: '#444',
              }}
            >
              {userId ? (
                <>
                  ログイン中:{' '}
                  <strong>{displayName ?? userId}</strong>
                </>
              ) : (
                'ログインしていません'
              )}
            </div>
            <div>
              <div
                id="googleSignInDiv"
                style={{ display: 'inline-block', marginRight: 8 }}
              />
              <button
                onClick={handleDebugLogin}
                style={{ fontSize: '0.8rem' }}
              >
                デバッグログイン
              </button>
            </div>
          </div>
        </div>

        {/* タブナビゲーション */}
        <nav
          style={{
            display: 'flex',
            gap: '0.5rem',
            borderBottom: '1px solid #e0e0e0',
            paddingBottom: '0.25rem',
          }}
        >
          {(
            [
              { id: 'practice', label: '学習' },
              { id: 'mypage', label: 'マイページ' },
              { id: 'ranking', label: 'ランキング' },
            ] as { id: MainTab; label: string }[]
          ).map((tab) => {
            const active = mainTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setMainTab(tab.id)}
                style={{
                  border: 'none',
                  borderBottom: active ? '2px solid #0070f3' : '2px solid transparent',
                  background: 'transparent',
                  padding: '0.4rem 0.75rem',
                  cursor: 'pointer',
                  fontSize: '0.95rem',
                  color: active ? '#0070f3' : '#555',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </header>

      {/* メッセージ */}
      {message && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.6rem 0.8rem',
            borderRadius: 6,
            background: '#f4f7ff',
            color: '#1b2a4a',
            border: '1px solid #c9d7ff',
            fontSize: '0.9rem',
          }}
        >
          {message}
        </div>
      )}

      {/* メインタブ */}
      <main>
        {/* 学習タブ */}
        {mainTab === 'practice' && (
          <>
            {/* 出題設定 */}
            <section
              style={{
                marginBottom: '1.5rem',
                padding: '1rem',
                border: '1px solid #e0e0e0',
                borderRadius: 8,
                background: '#fafafa',
              }}
            >
              <h2 style={{ fontSize: '1.05rem', marginTop: 0, marginBottom: '0.5rem' }}>
                出題設定
              </h2>

              {/* サブモード */}
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
                    border: '1px solid #ddd',
                    overflow: 'hidden',
                  }}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setSessionConfig((prev) => ({ ...prev, mode: 'index' }))
                    }
                    style={{
                      padding: '0.25rem 0.7rem',
                      border: 'none',
                      background:
                        sessionConfig.mode === 'index' ? '#fff' : 'transparent',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                    }}
                  >
                    番号指定
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSessionConfig((prev) => ({ ...prev, mode: 'level' }))
                    }
                    style={{
                      padding: '0.25rem 0.7rem',
                      border: 'none',
                      background:
                        sessionConfig.mode === 'level' ? '#fff' : 'transparent',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                    }}
                  >
                    レベル別
                  </button>
                </div>

                <div
                  style={{
                    display: 'inline-flex',
                    borderRadius: 999,
                    border: '1px solid #ddd',
                    overflow: 'hidden',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setViewMode('test')}
                    style={{
                      padding: '0.25rem 0.7rem',
                      border: 'none',
                      background:
                        viewMode === 'test' ? '#fff' : 'transparent',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                    }}
                  >
                    テスト
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('flash')}
                    style={{
                      padding: '0.25rem 0.7rem',
                      border: 'none',
                      background:
                        viewMode === 'flash' ? '#fff' : 'transparent',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                    }}
                  >
                    単語カード
                  </button>
                </div>

                <label style={{ fontSize: '0.85rem' }}>
                  入力方法：
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
              </div>

              {/* 詳細設定 */}
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
                    <option value="core">本体（金のフレーズ）</option>
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
                              e.target.value || prev.startIndex || 1
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
                        direction: e.target.value as Direction,
                      }))
                    }
                    style={{ marginLeft: '0.25rem' }}
                  >
                    <option value="en_to_jp">英 → 日</option>
                    <option value="jp_to_en">日 → 英</option>
                  </select>
                </label>

                <label>
                  1ページの問題数：
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
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
                    value={sessionConfig.shuffle ? 'random' : 'sequential'}
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
                        showExamples: e.target.value as ShowExamplesMode,
                      }))
                    }
                    style={{ marginLeft: '0.25rem' }}
                  >
                    <option value="auto">多義語のみ</option>
                    <option value="always">常に表示</option>
                    <option value="never">表示しない</option>
                  </select>
                </label>
              </div>

              <div style={{ marginTop: '0.75rem' }}>
                <button onClick={handleStartSession}>
                  通常セッション開始
                </button>
                <button
                  onClick={handleStartWrongSession}
                  style={{ marginLeft: '0.5rem' }}
                >
                  苦手単語モードで開始
                </button>
                {sessionItems.length > 0 && (
                  <span style={{ marginLeft: '0.75rem', fontSize: '0.85rem' }}>
                    現在: {sessionItems.length} 問 / {totalPages} ページ
                  </span>
                )}
              </div>
            </section>

            {/* ガイド */}
            {!wordsData && <div>単語データを読み込み中…</div>}
            {wordsData && sessionItems.length === 0 && (
              <p style={{ marginBottom: '1rem', fontSize: '0.9rem' }}>
                出題設定を調整して、セッションを開始してください。
              </p>
            )}

            {/* テストモード */}
            {wordsData &&
              sessionItems.length > 0 &&
              viewMode === 'test' && (
                <section
                  style={{
                    marginBottom: '2rem',
                    padding: '1rem',
                    border: '1px solid #e0e0e0',
                    borderRadius: 8,
                  }}
                >
                  <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>
                    テストモード
                  </h2>
                  <p style={{ fontSize: '0.9rem', marginTop: 0 }}>
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
                          borderBottom: '1px solid #f0f0f0',
                        }}
                      >
                        <div style={{ fontSize: '1.05rem' }}>
                          問題 {absIndex + 1}.{' '}
                          <strong>
                            {isEnToJp ? word.english : word.japanese}
                          </strong>
                          {isEnToJp && (
                            <button
                              type="button"
                              onClick={() =>
                                speakEnglish(word.audio_text || word.english)
                              }
                              style={{
                                marginLeft: '0.5rem',
                                fontSize: '0.8rem',
                              }}
                            >
                              🔊 単語
                            </button>
                          )}
                          {word.example_en && (
                            <button
                              type="button"
                              onClick={() => speakEnglish(word.example_en)}
                              style={{
                                marginLeft: '0.25rem',
                                fontSize: '0.8rem',
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
                                    [absIndex]: e.target.value,
                                  }))
                                }
                                style={{
                                  marginLeft: '0.5rem',
                                  width: '60%',
                                  maxWidth: 400,
                                }}
                                placeholder={
                                  isEnToJp ? '日本語の意味' : '英語の単語'
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
                              borderRadius: 6,
                              border: '1px solid #f0f0f0',
                              background: '#fafafa',
                            }}
                          >
                            <div>
                              正解：
                              {isEnToJp ? word.japanese : word.english}
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
                    <button onClick={handleShowAnswersForPage}>
                      このページの解答を表示
                      <span style={{ fontSize: '0.85rem' }}>
                        （未採点はデフォルトで○）
                      </span>
                    </button>
                  </div>

                  <div style={{ marginTop: '0.75rem' }}>
                    <button
                      onClick={handleSaveCurrentPage}
                      disabled={isSavingPage || pageItems.length === 0}
                    >
                      このページを保存して
                      {currentPage + 1 < totalPages
                        ? '次のページへ'
                        : 'セッション終了'}
                    </button>
                  </div>
                </section>
              )}

            {/* 単語カード */}
            {wordsData &&
              sessionItems.length > 0 &&
              viewMode === 'flash' && (
                <section
                  style={{
                    marginBottom: '2rem',
                    padding: '1rem',
                    border: '1px solid #e0e0e0',
                    borderRadius: 8,
                  }}
                >
                  <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>
                    単語カードモード
                  </h2>
                  <p style={{ fontSize: '0.9rem', marginTop: 0 }}>
                    全 {sessionItems.length} 枚 / 現在 {cardIndex + 1} 枚目（
                    {isEnToJp ? '英 → 日' : '日 → 英'}
                    ）
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
                      <div
                        style={{
                          fontSize: '1.2rem',
                          marginBottom: '0.5rem',
                        }}
                      >
                        Q:{' '}
                        <strong>
                          {isEnToJp
                            ? sessionItems[cardIndex].english
                            : sessionItems[cardIndex].japanese}
                        </strong>
                      </div>

                      <div style={{ marginBottom: '0.5rem' }}>
                        {isEnToJp && (
                          <button
                            type="button"
                            onClick={() =>
                              speakEnglish(
                                sessionItems[cardIndex].audio_text ||
                                  sessionItems[cardIndex].english
                              )
                            }
                            style={{
                              marginRight: '0.5rem',
                              fontSize: '0.85rem',
                            }}
                          >
                            🔊 単語
                          </button>
                        )}
                        {sessionItems[cardIndex].example_en && (
                          <button
                            type="button"
                            onClick={() =>
                              speakEnglish(
                                sessionItems[cardIndex].example_en
                              )
                            }
                            style={{ fontSize: '0.85rem' }}
                          >
                            🔊 例文
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          setShowCardAnswer((prev) => !prev)
                        }
                      >
                        {showCardAnswer ? '答えを隠す' : '答えを表示'}
                      </button>

                      {showCardAnswer && (
                        <div style={{ marginTop: '0.75rem' }}>
                          <div>
                            答え：
                            <strong>
                              {isEnToJp
                                ? sessionItems[cardIndex].japanese
                                : sessionItems[cardIndex].english}
                            </strong>
                          </div>
                          <div
                            style={{
                              marginTop: '0.25rem',
                              fontSize: '0.95rem',
                            }}
                          >
                            例文（日本語）：
                            {sessionItems[cardIndex].example_jp}
                          </div>
                          <div style={{ fontSize: '0.95rem' }}>
                            例文（英語）：
                            {sessionItems[cardIndex].example_en}
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
                    >
                      ← 前へ
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCardIndex((prev) =>
                          prev + 1 >= sessionItems.length
                            ? 0
                            : prev + 1
                        );
                        setShowCardAnswer(false);
                      }}
                    >
                      次へ →
                    </button>
                  </div>
                </section>
              )}
          </>
        )}

        {/* マイページタブ */}
        {mainTab === 'mypage' && (
          <section
            style={{
              padding: '1rem',
              border: '1px solid #e0e0e0',
              borderRadius: 8,
              marginBottom: '2rem',
            }}
          >
            <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>
              マイページ（自分の記録）
            </h2>
            <button
              onClick={handleFetchMyPage}
              disabled={isLoadingOverview || isLoadingMyPageWrong}
            >
              {isLoadingOverview || isLoadingMyPageWrong
                ? '読み込み中…'
                : '自分の記録を更新'}
            </button>

            {userOverview && (
              <div style={{ marginTop: '0.75rem', fontSize: '0.9rem' }}>
                <div>
                  ユーザー：{' '}
                  <strong>{userOverview.display_name}</strong>
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
                  {formatDateTime(userOverview.last_answered_at ?? undefined)}
                </div>
              </div>
            )}

            {/* 表示名変更 */}
            <div style={{ marginTop: '1rem' }}>
              <h3 style={{ fontSize: '1rem', marginTop: 0 }}>
                表示名の変更
              </h3>
              <div>
                <input
                  type="text"
                  value={displayNameEdit}
                  onChange={(e) => setDisplayNameEdit(e.target.value)}
                  placeholder="ランキングなどに表示する名前"
                  style={{
                    width: '60%',
                    maxWidth: 280,
                    marginRight: '0.5rem',
                  }}
                />
                <button type="button" onClick={handleUpdateDisplayName}>
                  保存
                </button>
              </div>
              <p
                style={{
                  fontSize: '0.85rem',
                  color: '#555',
                  marginTop: '0.25rem',
                }}
              >
                ランキングやマイページに表示される名前です。
              </p>
            </div>

            {/* よく間違える単語 */}
            <div style={{ marginTop: '1rem' }}>
              <h3 style={{ fontSize: '1rem', marginTop: 0 }}>
                よく間違える単語 Top10
              </h3>
              {!myPageWrongItems && !isLoadingMyPageWrong && (
                <p style={{ fontSize: '0.9rem' }}>
                  まだ苦手単語が記録されていません。
                </p>
              )}
              {myPageWrongItems &&
                myPageWrongItems.length === 0 &&
                !isLoadingMyPageWrong && (
                  <p style={{ fontSize: '0.9rem' }}>
                    まだ苦手単語が記録されていません。
                  </p>
                )}
              {myPageWrongItems &&
                myPageWrongItems.length > 0 &&
                wordsData && (
                  <ol style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
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
                          style={{ marginBottom: '0.3rem' }}
                        >
                          {word ? (
                            <>
                              <strong>{word.english}</strong> /{' '}
                              {word.japanese}（間違え{' '}
                              {stat.wrong_total} 回 / 正解{' '}
                              {stat.correct_total} 回）
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
          </section>
        )}

        {/* ランキングタブ */}
        {mainTab === 'ranking' && (
          <section
            style={{
              padding: '1rem',
              border: '1px solid #e0e0e0',
              borderRadius: 8,
              marginBottom: '2rem',
            }}
          >
            <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>
              ランキング（今週の正解数）
            </h2>
            <button
              onClick={handleFetchRanking}
              disabled={isLoadingRanking}
            >
              {isLoadingRanking ? 'ランキング取得中…' : 'ランキングを更新'}
            </button>

            {ranking && ranking.length === 0 && (
              <p style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
                まだ今週の正解記録がありません。
              </p>
            )}

            {ranking && ranking.length > 0 && (
              <ol
                style={{
                  marginTop: '0.75rem',
                  fontSize: '0.9rem',
                }}
              >
                {ranking.slice(0, 20).map((entry, index) => (
                  <li
                    key={entry.user_id}
                    style={{ marginBottom: '0.25rem' }}
                  >
                    {index + 1}位：{entry.display_name} さん（
                    {entry.weekly_correct_total} 問）
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
