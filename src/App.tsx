import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

/* ================================
   設定（あなたの値に合わせてOK）
================================ */
const API_URL =
  "https://script.google.com/macros/s/AKfycbw5_IGof9wirpNIhkBNEPxh8kwsLKFqaSRWwQumQ2z5xqt5YspochMmccRtfE4fD2ZQSg/exec";

const CLIENT_ID =
  "141623918894-f9kmkrrk7640lqhupp25nfhcog2jihim.apps.googleusercontent.com";

/* ================================
   型
================================ */
type WordItem = {
  id: number; // ItemID
  book: string; // bookId
  deck: string; // deckId (core/bonus/...)
  bookIndex: number;
  level?: string; // "600" etc
  subCategory?: string;
  english: string;
  japanese: string;
  example_en?: string;
  example_jp?: string;
  audio_text?: string;
  tags?: string[];
};

type Deck = {
  id: string;
  labelJa: string; // "本編" etc
  items: WordItem[];
};

type Book = {
  bookId: string;
  bookName: string;
  decks: Record<string, Deck>;
};

type User = {
  user_id: string;
  display_name: string;
  weekly_correct_total: number;
  correct_total?: number;
  email?: string;
};

type MyPageData = {
  weekly_correct_total: number;
  correct_total: number;
  weak_items: Array<{
    item_id: number;
    wrong_total: number;
    last_wrong_at?: string;
  }>;
};

type Settings = {
  pageSize: 1 | 5 | 15 | 30 | 50;
  randomOrder: boolean;
  showExamplesMode: "polysemyOnly" | "always" | "never";
  inputMethod: "keyboard" | "handwrite" | "both";
  driveDelayMs: number; // 読み上げ後の待ち時間
  driveRate: number; // 再生速度
  driveOrder: Array<"english" | "japanese" | "example_en" | "example_jp">;
};

const DEFAULT_SETTINGS: Settings = {
  pageSize: 15,
  randomOrder: true,
  showExamplesMode: "polysemyOnly",
  inputMethod: "handwrite",
  driveDelayMs: 800,
  driveRate: 1.0,
  driveOrder: ["english", "japanese", "example_en", "example_jp"],
};

/* ================================
   API ヘルパ
================================ */
async function apiGet<T>(
  action: string,
  params: Record<string, any> = {}
): Promise<T> {
  const url = new URL(API_URL);
  url.searchParams.set("action", action);
  Object.keys(params).forEach((k) => url.searchParams.set(k, String(params[k])));
  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`GET ${action} failed`);
  return (await res.json()) as T;
}

async function apiPost<T>(
  action: string,
  body: Record<string, any>
): Promise<T> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // GAS対策
    body: JSON.stringify({ action, ...body }),
  });
  if (!res.ok) throw new Error(`POST ${action} failed`);
  return (await res.json()) as T;
}

/* ================================
   Fullscreen Hook
================================ */
function useSimpleFullscreen<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [isFs, setIsFs] = useState(false);
  const supportsFs = !!document.documentElement.requestFullscreen;

  const enter = async () => {
    const el = ref.current;
    if (!el) return;
    if (supportsFs) {
      await el.requestFullscreen();
    }
    setIsFs(true);
  };

  const exit = async () => {
    if (supportsFs && document.fullscreenElement) {
      await document.exitFullscreen();
    }
    setIsFs(false);
  };

  useEffect(() => {
    if (!supportsFs) return;
    const onChange = () => setIsFs(document.fullscreenElement === ref.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [supportsFs]);

  return { ref, isFs, enter, exit, supportsFs };
}

/* ================================
   手書き Canvas
   - penのみ描画 / fingerはスクロール
   - rectを毎回取り直す
   - DPR, scroll, resize追従
================================ */
type Point = { x: number; y: number; pressure: number; t: number };
type Stroke = Point[];

function HandwriteBox({
  height = 120,
  valueDataUrl,
  onChangeDataUrl,
  disabled,
}: {
  height?: number;
  valueDataUrl?: string;
  onChangeDataUrl?: (dataUrl: string) => void;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const curRef = useRef<Stroke | null>(null);
  const isDrawingRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const redrawAll = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111";

    const drawStroke = (s: Stroke) => {
      if (s.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(s[0].x, s[0].y);
      for (let i = 1; i < s.length - 1; i++) {
        const p0 = s[i];
        const p1 = s[i + 1];
        const mx = (p0.x + p1.x) / 2;
        const my = (p0.y + p1.y) / 2;
        const w = Math.max(1.2, 2.5 * (p0.pressure || 0.5));
        ctx.lineWidth = w;
        ctx.quadraticCurveTo(p0.x, p0.y, mx, my);
      }
      ctx.stroke();
    };

    strokesRef.current.forEach(drawStroke);
    if (curRef.current) drawStroke(curRef.current);
  };

  const requestRedraw = () => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      redrawAll();
    });
  };

  const getLocalPoint = (e: PointerEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return {
      x: (e.clientX - rect.left) * dpr,
      y: (e.clientY - rect.top) * dpr,
      pressure: e.pressure || 0.5,
      t: performance.now(),
    } as Point;
  };

  // resize/DPR/scroll追従
  useEffect(() => {
    const canvas = canvasRef.current!;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;

      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      requestRedraw();
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    window.addEventListener("scroll", resize, { passive: true });
    window.addEventListener("resize", resize);

    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", resize);
      window.removeEventListener("resize", resize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // value復元（必要なら）
  useEffect(() => {
    if (!valueDataUrl) return;
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = valueDataUrl;
  }, [valueDataUrl]);

  const exportDataUrl = () => {
    const canvas = canvasRef.current!;
    const dataUrl = canvas.toDataURL("image/png");
    onChangeDataUrl?.(dataUrl);
  };

  const clear = () => {
    strokesRef.current = [];
    curRef.current = null;
    requestRedraw();
    exportDataUrl();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    if (e.pointerType !== "pen") return;
    e.preventDefault();

    const canvas = canvasRef.current!;
    canvas.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    curRef.current = [getLocalPoint(e.nativeEvent, canvas)];
    requestRedraw();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    if (!isDrawingRef.current) return;
    if (e.pointerType !== "pen") return;
    e.preventDefault();

    const canvas = canvasRef.current!;
    curRef.current!.push(getLocalPoint(e.nativeEvent, canvas));
    requestRedraw();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    if (e.pointerType !== "pen") return;
    e.preventDefault();

    const canvas = canvasRef.current!;
    canvas.releasePointerCapture(e.pointerId);

    isDrawingRef.current = false;
    if (curRef.current && curRef.current.length > 1) {
      strokesRef.current.push(curRef.current);
    }
    curRef.current = null;
    requestRedraw();
    exportDataUrl();
  };

  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 8,
        background: "#fff",
        padding: 6,
        position: "relative",
        touchAction: "pan-y", // fingerスクロール許可
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height,
          display: "block",
          background: "#fff",
          borderRadius: 6,
          touchAction: "none", // penだけ描画
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <button
        style={{
          position: "absolute",
          right: 8,
          bottom: 8,
          fontSize: 12,
          padding: "4px 8px",
        }}
        onClick={clear}
        disabled={disabled}
      >
        クリア
      </button>
    </div>
  );
}

/* ================================
   メイン App
================================ */
export default function App() {
  /* ------------------------------
     端末向き/背景
  ------------------------------ */
  const [isPortrait, setIsPortrait] = useState(
    window.innerHeight >= window.innerWidth
  );
  useEffect(() => {
    const onResize = () =>
      setIsPortrait(window.innerHeight >= window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const shellStyle: CSSProperties = {
    minHeight: "100vh",
    width: "100vw",
    boxSizing: "border-box",
    padding: isPortrait ? "10px" : "16px",
    display: "flex",
    justifyContent: "center",
    alignItems: "flex-start",
    background:
      "linear-gradient(135deg, #0ea5e9 0%, #6366f1 50%, #a855f7 100%)",
  };

  const containerStyle: CSSProperties = {
    width: "100%",
    maxWidth: isPortrait ? 720 : 1100,
  };

  /* ------------------------------
     ログイン関連
  ------------------------------ */
  const [user, setUser] = useState<User | null>(null);
  const [loginReady, setLoginReady] = useState(false);
  const googleBtnRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // GSI script load
    const id = "google-gsi";
    if (document.getElementById(id)) {
      setLoginReady(true);
      return;
    }
    const script = document.createElement("script");
    script.id = id;
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => setLoginReady(true);
    document.body.appendChild(script);
  }, []);

  useEffect(() => {
    if (!loginReady || user) return;
    const w = window as any;
    if (!w.google?.accounts?.id || !googleBtnRef.current) return;

    w.google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: async (res: any) => {
        try {
          // backend側 action 名に合わせてね
          const out = await apiPost<{ ok: boolean; user: User }>(
            "loginGoogle",
            { credential: res.credential }
          );
          if (out.ok) setUser(out.user);
        } catch (e) {
          console.error("google login failed", e);
        }
      },
    });

    w.google.accounts.id.renderButton(googleBtnRef.current, {
      theme: "outline",
      size: "large",
      type: "standard",
      text: "signin_with",
      shape: "pill",
    });

    // one-tap は今はOFF（うざいので）
    // w.google.accounts.id.prompt();
  }, [loginReady, user]);

  /* ------------------------------
     データ・設定
  ------------------------------ */
  const [books, setBooks] = useState<Book[]>([]);
  const [loadingWords, setLoadingWords] = useState(false);
  const [settings, setSettings] = useState<Settings>(() => {
    const s = localStorage.getItem("settings_json");
    return s ? (JSON.parse(s) as Settings) : DEFAULT_SETTINGS;
  });

  useEffect(() => {
    localStorage.setItem("settings_json", JSON.stringify(settings));
    if (user) {
      // backendに保存したい場合
      apiPost("saveSettings", {
        user_id: user.user_id,
        settings_json: settings,
      }).catch(() => {});
    }
  }, [settings, user]);

  useEffect(() => {
    (async () => {
      try {
        setLoadingWords(true);
        const out = await apiGet<{
          ok: boolean;
          books: Book[];
        }>("getWords");
        if (out.ok) setBooks(out.books);
      } catch (e) {
        console.error("getWords error", e);
      } finally {
        setLoadingWords(false);
      }
    })();
  }, []);

  /* ------------------------------
     Book/Set選択（共通）
  ------------------------------ */
  const [selectedBookId, setSelectedBookId] = useState<string>("");
  const [selectedSetId, setSelectedSetId] = useState<string>("core"); // "セット"

  // 初期 book
  useEffect(() => {
    if (books.length && !selectedBookId) {
      setSelectedBookId(books[0].bookId);
      const firstDeck = Object.keys(books[0].decks)[0] || "core";
      setSelectedSetId(firstDeck);
    }
  }, [books, selectedBookId]);

  const selectedBook = useMemo(
    () => books.find((b) => b.bookId === selectedBookId),
    [books, selectedBookId]
  );
  const selectedDeck = useMemo(
    () => selectedBook?.decks[selectedSetId],
    [selectedBook, selectedSetId]
  );

  const allItems = selectedDeck?.items ?? [];

  // 多義語カウント（english重複）
  const polysemyCount = useMemo(() => {
    const m = new Map<string, number>();
    allItems.forEach((it) =>
      m.set(it.english, (m.get(it.english) || 0) + 1)
    );
    return m;
  }, [allItems]);

  // subCategory一覧
  const subCategoryList = useMemo(() => {
    const s = new Set<string>();
    allItems.forEach((it) => {
      if (it.subCategory) s.add(it.subCategory);
    });
    return ["all", ...Array.from(s)];
  }, [allItems]);

  /* ------------------------------
     画面状態
  ------------------------------ */
  const [activeTab, setActiveTab] = useState<"test" | "cards">("test");
  const [showSettings, setShowSettings] = useState(false);
  const [showMyPage, setShowMyPage] = useState(false);

  /* ------------------------------
     MyPage
  ------------------------------ */
  const [myPage, setMyPage] = useState<MyPageData | null>(null);
  const [loadingMyPage, setLoadingMyPage] = useState(false);
  const weakItemIds = useMemo(
    () => new Set(myPage?.weak_items.map((w) => w.item_id) || []),
    [myPage]
  );

  const openMyPage = async () => {
    if (!user) return;
    setShowMyPage(true);
    setLoadingMyPage(true);
    try {
      const out = await apiGet<{ ok: boolean; data: MyPageData }>("getMyPage", {
        user_id: user.user_id,
      });
      if (out.ok) setMyPage(out.data);
    } catch (e) {
      console.error("getMyPage error", e);
    } finally {
      setLoadingMyPage(false);
    }
  };

  const updateDisplayName = async (name: string) => {
    if (!user) return;
    try {
      const out = await apiPost<{ ok: boolean; display_name: string }>(
        "updateDisplayName",
        { user_id: user.user_id, display_name: name }
      );
      if (out.ok) setUser({ ...user, display_name: out.display_name });
    } catch (e) {
      console.error(e);
    }
  };

  /* ------------------------------
     テスト設定（出題設定）
  ------------------------------ */
  const [testMode, setTestMode] = useState<"level" | "number">("level");
  const [level, setLevel] = useState<string>("600");
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(1000);
  const [subCat, setSubCat] = useState<string>("all");
  const [mistakeOnly, setMistakeOnly] = useState(false);

  const isCoreSelected = selectedSetId === "core";

  // core以外なら番号指定不可
  useEffect(() => {
    if (!isCoreSelected && testMode === "number") {
      setTestMode("level");
    }
  }, [isCoreSelected, testMode]);

  /* ------------------------------
     テスト進行
  ------------------------------ */
  const [testStarted, setTestStarted] = useState(false);
  const [grading, setGrading] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);

  const [questions, setQuestions] = useState<WordItem[]>([]);
  const [answersText, setAnswersText] = useState<Record<number, string>>({});
  const [answersInk, setAnswersInk] = useState<Record<number, string>>({});
  const [results, setResults] = useState<Record<number, boolean>>({});

  const testTopRef = useRef<HTMLDivElement | null>(null);

  const buildTestList = () => {
    let list = [...allItems];

    // 間違えた単語だけ
    if (mistakeOnly) {
      list = list.filter((it) => weakItemIds.has(it.id));
    }

    if (isCoreSelected) {
      if (testMode === "level") {
        list = list.filter((it) => it.level === level);
      } else {
        list = list.filter(
          (it) => it.bookIndex >= rangeStart && it.bookIndex <= rangeEnd
        );
      }
    } else {
      // core以外は subCategory
      if (subCat !== "all") {
        list = list.filter((it) => it.subCategory === subCat);
      }
    }

    if (settings.randomOrder) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [list[i], list[j]] = [list[j], list[i]];
      }
    } else {
      list.sort((a, b) => a.bookIndex - b.bookIndex);
    }

    return list;
  };

  const startTest = () => {
    setQuestions(buildTestList());
    setAnswersText({});
    setAnswersInk({});
    setResults({});
    setPageIndex(0);
    setGrading(false);
    setTestStarted(true);
  };

  const pageSize = settings.pageSize;
  const pages = Math.ceil(questions.length / pageSize);
  const pageQuestions = questions.slice(
    pageIndex * pageSize,
    (pageIndex + 1) * pageSize
  );

  const showExampleForItem = (it: WordItem) => {
    const isPoly = (polysemyCount.get(it.english) || 1) > 1;
    if (settings.showExamplesMode === "always") return true;
    if (settings.showExamplesMode === "never") return false;
    return isPoly;
  };

  const beginGrading = () => {
    setGrading(true);
    // 上まで戻す
    testTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // デフォルト正解にする
    const newRes: Record<number, boolean> = { ...results };
    pageQuestions.forEach((q) => {
      if (newRes[q.id] == null) newRes[q.id] = true;
    });
    setResults(newRes);
  };

  const submitPageAndNext = async () => {
    if (!user) {
      setPageIndex((p) => Math.min(p + 1, pages - 1));
      setGrading(false);
      return;
    }
    try {
      const payload = pageQuestions.map((q) => ({
        item_id: q.id,
        correct: results[q.id] ?? true,
        answer_text: answersText[q.id] ?? "",
      }));
      await apiPost("recordTest", {
        user_id: user.user_id,
        items: payload,
      });
    } catch (e) {
      console.error("recordTest error", e);
    }

    if (pageIndex < pages - 1) {
      setPageIndex(pageIndex + 1);
      setGrading(false);
    } else {
      setTestStarted(false);
      setGrading(false);
      // MyPageの週合計など更新
      if (user) {
        openMyPage().catch(() => {});
      }
    }
  };

  const prevPage = () => {
    if (pageIndex === 0) return;
    setPageIndex(pageIndex - 1);
    setGrading(false);
  };

  /* ------------------------------
     単語カード設定
  ------------------------------ */
  const [cardsStarted, setCardsStarted] = useState(false);
  const [cardMode, setCardMode] = useState<"level" | "number">("level");
  const [cardLevel, setCardLevel] = useState("600");
  const [cardRangeStart, setCardRangeStart] = useState(1);
  const [cardRangeEnd, setCardRangeEnd] = useState(1000);
  const [cardSubCat, setCardSubCat] = useState("all");

  useEffect(() => {
    if (!isCoreSelected && cardMode === "number") setCardMode("level");
  }, [isCoreSelected, cardMode]);

  const [cardsList, setCardsList] = useState<WordItem[]>([]);
  const [cardIndex, setCardIndex] = useState(0);
  const [cardSide, setCardSide] = useState<"front" | "back">("front");

  const buildCardsList = () => {
    let list = [...allItems];

    if (isCoreSelected) {
      if (cardMode === "level") {
        list = list.filter((it) => it.level === cardLevel);
      } else {
        list = list.filter(
          (it) =>
            it.bookIndex >= cardRangeStart && it.bookIndex <= cardRangeEnd
        );
      }
    } else {
      if (cardSubCat !== "all") {
        list = list.filter((it) => it.subCategory === cardSubCat);
      }
    }

    if (settings.randomOrder) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [list[i], list[j]] = [list[j], list[i]];
      }
    } else {
      list.sort((a, b) => a.bookIndex - b.bookIndex);
    }
    return list;
  };

  const startCards = () => {
    const list = buildCardsList();
    setCardsList(list);
    setCardIndex(0);
    setCardSide("front");
    setCardsStarted(true);
  };

  const currentCard = cardsList[cardIndex];

  /* ------------------------------
     読み上げ
  ------------------------------ */
  const speak = (text: string, lang: "en-US" | "ja-JP" = "en-US") => {
    if (!text) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = settings.driveRate;
      window.speechSynthesis.speak(u);
    } catch (e) {
      console.error("speech", e);
    }
  };

  /* ------------------------------
     ドライブモード（カード側）
  ------------------------------ */
  const driveFs = useSimpleFullscreen<HTMLDivElement>();
  const [driveOpen, setDriveOpen] = useState(false);
  const [drivePlaying, setDrivePlaying] = useState(false);
  const [driveFieldIndex, setDriveFieldIndex] = useState(0);

  const driveFields = settings.driveOrder;

  const getFieldText = (it: WordItem, field: Settings["driveOrder"][0]) => {
    if (!it) return "";
    if (field === "english") return it.english;
    if (field === "japanese") return it.japanese;
    if (field === "example_en") return it.example_en || "";
    if (field === "example_jp") return it.example_jp || "";
    return "";
  };

  // 自動再生ループ
  useEffect(() => {
    if (!driveOpen || !drivePlaying || !currentCard) return;
    let cancelled = false;

    const playLoop = async () => {
      const field = driveFields[driveFieldIndex];
      const txt = getFieldText(currentCard, field);
      if (txt) {
        speak(
          txt,
          field === "english" || field === "example_en" ? "en-US" : "ja-JP"
        );
      }

      // 読み上げが終わったのち待って次
      const waitSpeechEnd = () =>
        new Promise<void>((resolve) => {
          const check = () => {
            if (cancelled) return resolve();
            if (!window.speechSynthesis.speaking) return resolve();
            requestAnimationFrame(check);
          };
          check();
        });

      await waitSpeechEnd();
      await new Promise((r) => setTimeout(r, settings.driveDelayMs));

      if (cancelled) return;

      // 次フィールド or 次カード
      if (driveFieldIndex < driveFields.length - 1) {
        setDriveFieldIndex((i) => i + 1);
      } else {
        setDriveFieldIndex(0);
        setCardIndex((i) =>
          i < cardsList.length - 1 ? i + 1 : 0
        );
      }
    };

    playLoop();

    return () => {
      cancelled = true;
    };
  }, [
    driveOpen,
    drivePlaying,
    driveFieldIndex,
    currentCard,
    cardsList.length,
    driveFields,
    settings.driveDelayMs,
    settings.driveRate,
  ]);

  const openDrive = () => {
    setDriveOpen(true);
    setDriveFieldIndex(0);
    setDrivePlaying(false);
  };

  /* ------------------------------
     UI
  ------------------------------ */
  if (!user) {
    return (
      <div style={shellStyle}>
        <div style={containerStyle}>
          <div
            style={{
              background: "#fff",
              borderRadius: 14,
              padding: "24px 18px",
              boxShadow: "0 6px 18px rgba(0,0,0,0.15)",
            }}
          >
            <h1 style={{ fontSize: 28, marginBottom: 8 }}>📚 Vocab Sprint</h1>
            <p style={{ marginBottom: 20 }}>
              単語テストと単語カードでサクサク復習しよう
            </p>
            <div ref={googleBtnRef} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={shellStyle}>
      <div style={containerStyle}>
        {/* ヘッダー */}
        <header
          style={{
            background: "rgba(255,255,255,0.95)",
            borderRadius: 14,
            padding: "10px 12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
            marginBottom: 10,
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 20 }}>📘 Vocab Sprint</div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => setShowSettings(true)}
              style={{
                fontSize: 14,
                padding: "6px 10px",
                borderRadius: 10,
              }}
            >
              ⚙️ 設定
            </button>
            <button
              onClick={openMyPage}
              style={{
                fontSize: 14,
                padding: "6px 10px",
                borderRadius: 10,
              }}
            >
              👤 {user.display_name}
            </button>
          </div>
        </header>

        {/* タブ（トップのみ切替） */}
        {!testStarted && !cardsStarted && (
          <div
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <button
              onClick={() => setActiveTab("test")}
              style={{
                flex: 1,
                padding: "10px 0",
                borderRadius: 12,
                fontWeight: 700,
                background: activeTab === "test" ? "#111827" : "#fff",
                color: activeTab === "test" ? "#fff" : "#111827",
              }}
            >
              ✍️ テスト
            </button>
            <button
              onClick={() => setActiveTab("cards")}
              style={{
                flex: 1,
                padding: "10px 0",
                borderRadius: 12,
                fontWeight: 700,
                background: activeTab === "cards" ? "#111827" : "#fff",
                color: activeTab === "cards" ? "#fff" : "#111827",
              }}
            >
              🃏 単語カード
            </button>
          </div>
        )}

        {/* メイン */}
        <main
          style={{
            background: "rgba(255,255,255,0.96)",
            borderRadius: 14,
            padding: isPortrait ? 10 : 14,
            boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
          }}
        >
          {loadingWords && <div>単語データ読み込み中...</div>}

          {!loadingWords && activeTab === "test" && (
            <>
              {/* 出題設定（テスト開始後は隠す） */}
              {!testStarted && (
                <section style={{ marginBottom: 12 }}>
                  <h2 style={{ fontSize: 18, marginBottom: 6 }}>🧩 出題設定</h2>

                  {/* 単語帳選択 */}
                  <div style={{ display: "grid", gap: 8 }}>
                    <label>
                      単語帳：
                      <select
                        value={selectedBookId}
                        onChange={(e) => {
                          setSelectedBookId(e.target.value);
                          const b = books.find(
                            (x) => x.bookId === e.target.value
                          );
                          const first = b ? Object.keys(b.decks)[0] : "core";
                          setSelectedSetId(first);
                        }}
                      >
                        {books.map((b) => (
                          <option key={b.bookId} value={b.bookId}>
                            {b.bookName}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      セット：
                      <select
                        value={selectedSetId}
                        onChange={(e) => setSelectedSetId(e.target.value)}
                      >
                        {selectedBook &&
                          Object.values(selectedBook.decks).map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.id === "core" ? "本編" : d.labelJa}
                            </option>
                          ))}
                      </select>
                    </label>

                    {/* coreならレベル/番号 */}
                    {isCoreSelected ? (
                      <>
                        <label>
                          出題モード：
                          <select
                            value={testMode}
                            onChange={(e) =>
                              setTestMode(e.target.value as any)
                            }
                          >
                            <option value="level">レベル別</option>
                            <option value="number">番号範囲</option>
                          </select>
                        </label>

                        {testMode === "level" ? (
                          <label>
                            レベル：
                            <select
                              value={level}
                              onChange={(e) => setLevel(e.target.value)}
                            >
                              {["600", "730", "860", "990"].map((lv) => (
                                <option key={lv} value={lv}>
                                  {lv}点
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <div style={{ display: "flex", gap: 8 }}>
                            <label style={{ flex: 1 }}>
                              範囲開始：
                              <input
                                type="number"
                                value={rangeStart}
                                min={1}
                                max={1000}
                                onChange={(e) =>
                                  setRangeStart(Number(e.target.value))
                                }
                              />
                            </label>
                            <label style={{ flex: 1 }}>
                              範囲終了：
                              <input
                                type="number"
                                value={rangeEnd}
                                min={1}
                                max={1000}
                                onChange={(e) =>
                                  setRangeEnd(Number(e.target.value))
                                }
                              />
                            </label>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <label>
                          サブカテゴリ：
                          <select
                            value={subCat}
                            onChange={(e) => setSubCat(e.target.value)}
                          >
                            {subCategoryList.map((s) => (
                              <option key={s} value={s}>
                                {s === "all" ? "すべて" : s}
                              </option>
                            ))}
                          </select>
                        </label>
                      </>
                    )}

                    <label>
                      間違えた単語だけ出す：
                      <input
                        type="checkbox"
                        checked={mistakeOnly}
                        onChange={(e) => setMistakeOnly(e.target.checked)}
                        style={{ marginLeft: 6 }}
                      />
                    </label>

                    <button
                      onClick={startTest}
                      style={{
                        marginTop: 6,
                        padding: "10px 0",
                        borderRadius: 12,
                        fontWeight: 800,
                        background: "#111827",
                        color: "#fff",
                      }}
                    >
                      🚀 テスト開始
                    </button>

                    <div style={{ fontSize: 12, color: "#555" }}>
                      想定問題数：{buildTestList().length} 問
                    </div>
                  </div>
                </section>
              )}

              {/* テスト本体 */}
              {testStarted && (
                <section ref={testTopRef}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>
                      ページ {pageIndex + 1}/{pages}（{questions.length}問）
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={prevPage} disabled={pageIndex === 0}>
                        ← 前へ
                      </button>
                      <button
                        onClick={() =>
                          setPageIndex((p) => Math.min(p + 1, pages - 1))
                        }
                        disabled={pageIndex >= pages - 1}
                      >
                        次へ →
                      </button>
                    </div>
                  </div>

                  {pageQuestions.map((q, idx) => (
                    <div
                      key={q.id}
                      style={{
                        padding: 10,
                        borderRadius: 12,
                        border: "1px solid #e5e7eb",
                        marginBottom: 10,
                        background: "#fff",
                      }}
                    >
                      <div style={{ fontWeight: 800, marginBottom: 4 }}>
                        問題 {pageIndex * pageSize + idx + 1}
                      </div>

                      <div style={{ fontSize: 20, fontWeight: 800 }}>
                        {q.english}
                      </div>

                      {showExampleForItem(q) && q.example_en && (
                        <div style={{ color: "#444", marginTop: 6 }}>
                          例文: {q.example_en}
                        </div>
                      )}

                      {/* 入力 */}
                      <div style={{ marginTop: 8 }}>
                        {settings.inputMethod !== "handwrite" && (
                          <input
                            type="text"
                            placeholder="日本語で答える"
                            style={{ width: "100%", padding: 8 }}
                            value={answersText[q.id] || ""}
                            onChange={(e) =>
                              setAnswersText({
                                ...answersText,
                                [q.id]: e.target.value,
                              })
                            }
                            disabled={grading}
                          />
                        )}

                        {settings.inputMethod !== "keyboard" && (
                          <div style={{ marginTop: 6 }}>
                            <HandwriteBox
                              height={110}
                              valueDataUrl={answersInk[q.id]}
                              onChangeDataUrl={(d) =>
                                setAnswersInk({
                                  ...answersInk,
                                  [q.id]: d,
                                })
                              }
                              disabled={grading}
                            />
                          </div>
                        )}
                      </div>

                      {/* 採点表示 */}
                      {grading && (
                        <>
                          <div
                            style={{
                              marginTop: 8,
                              padding: 8,
                              background: "#f3f4f6",
                              borderRadius: 8,
                              fontSize: 14,
                            }}
                          >
                            正解：{q.japanese}
                          </div>

                          <div
                            style={{
                              marginTop: 8,
                              display: "flex",
                              gap: 10,
                              alignItems: "center",
                              fontWeight: 700,
                            }}
                          >
                            <label
                              style={{
                                padding: "6px 10px",
                                borderRadius: 999,
                                background:
                                  (results[q.id] ?? true) ? "#dcfce7" : "#fff",
                                border: "1px solid #10b981",
                                cursor: "pointer",
                              }}
                            >
                              <input
                                type="radio"
                                checked={results[q.id] ?? true}
                                onChange={() =>
                                  setResults({ ...results, [q.id]: true })
                                }
                              />
                              正解
                            </label>
                            <label
                              style={{
                                padding: "6px 10px",
                                borderRadius: 999,
                                background:
                                  results[q.id] === false
                                    ? "#fee2e2"
                                    : "#fff",
                                border: "1px solid #ef4444",
                                cursor: "pointer",
                              }}
                            >
                              <input
                                type="radio"
                                checked={results[q.id] === false}
                                onChange={() =>
                                  setResults({ ...results, [q.id]: false })
                                }
                              />
                              不正解
                            </label>
                          </div>
                        </>
                      )}
                    </div>
                  ))}

                  {!grading ? (
                    <button
                      onClick={beginGrading}
                      style={{
                        width: "100%",
                        padding: "10px 0",
                        borderRadius: 12,
                        fontWeight: 800,
                        background: "#111827",
                        color: "#fff",
                      }}
                    >
                      ✅ 採点開始
                    </button>
                  ) : (
                    <button
                      onClick={submitPageAndNext}
                      style={{
                        width: "100%",
                        padding: "10px 0",
                        borderRadius: 12,
                        fontWeight: 800,
                        background: "#111827",
                        color: "#fff",
                      }}
                    >
                      {pageIndex < pages - 1
                        ? "次のページへ"
                        : "テスト終了"}
                    </button>
                  )}
                </section>
              )}
            </>
          )}

          {/* 単語カード */}
          {!loadingWords && activeTab === "cards" && (
            <>
              {/* カード設定 */}
              {!cardsStarted && (
                <section>
                  <h2 style={{ fontSize: 18, marginBottom: 6 }}>
                    🃏 単語カード設定
                  </h2>

                  <div style={{ display: "grid", gap: 8 }}>
                    <label>
                      単語帳：
                      <select
                        value={selectedBookId}
                        onChange={(e) => {
                          setSelectedBookId(e.target.value);
                          const b = books.find(
                            (x) => x.bookId === e.target.value
                          );
                          const first = b ? Object.keys(b.decks)[0] : "core";
                          setSelectedSetId(first);
                        }}
                      >
                        {books.map((b) => (
                          <option key={b.bookId} value={b.bookId}>
                            {b.bookName}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      セット：
                      <select
                        value={selectedSetId}
                        onChange={(e) => setSelectedSetId(e.target.value)}
                      >
                        {selectedBook &&
                          Object.values(selectedBook.decks).map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.id === "core" ? "本編" : d.labelJa}
                            </option>
                          ))}
                      </select>
                    </label>

                    {isCoreSelected ? (
                      <>
                        <label>
                          出題モード：
                          <select
                            value={cardMode}
                            onChange={(e) =>
                              setCardMode(e.target.value as any)
                            }
                          >
                            <option value="level">レベル別</option>
                            <option value="number">番号範囲</option>
                          </select>
                        </label>

                        {cardMode === "level" ? (
                          <label>
                            レベル：
                            <select
                              value={cardLevel}
                              onChange={(e) => setCardLevel(e.target.value)}
                            >
                              {["600", "730", "860", "990"].map((lv) => (
                                <option key={lv} value={lv}>
                                  {lv}点
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <div style={{ display: "flex", gap: 8 }}>
                            <label style={{ flex: 1 }}>
                              範囲開始：
                              <input
                                type="number"
                                value={cardRangeStart}
                                min={1}
                                max={1000}
                                onChange={(e) =>
                                  setCardRangeStart(Number(e.target.value))
                                }
                              />
                            </label>
                            <label style={{ flex: 1 }}>
                              範囲終了：
                              <input
                                type="number"
                                value={cardRangeEnd}
                                min={1}
                                max={1000}
                                onChange={(e) =>
                                  setCardRangeEnd(Number(e.target.value))
                                }
                              />
                            </label>
                          </div>
                        )}
                      </>
                    ) : (
                      <label>
                        サブカテゴリ：
                        <select
                          value={cardSubCat}
                          onChange={(e) => setCardSubCat(e.target.value)}
                        >
                          {subCategoryList.map((s) => (
                            <option key={s} value={s}>
                              {s === "all" ? "すべて" : s}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    <button
                      onClick={startCards}
                      style={{
                        marginTop: 6,
                        padding: "10px 0",
                        borderRadius: 12,
                        fontWeight: 800,
                        background: "#111827",
                        color: "#fff",
                      }}
                    >
                      ▶️ カード開始
                    </button>
                    <div style={{ fontSize: 12, color: "#555" }}>
                      想定カード数：{buildCardsList().length} 枚
                    </div>
                  </div>
                </section>
              )}

              {/* カード本体 */}
              {cardsStarted && currentCard && (
                <section>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>
                      {cardIndex + 1}/{cardsList.length}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() =>
                          setCardIndex((i) => (i > 0 ? i - 1 : i))
                        }
                      >
                        ←
                      </button>
                      <button
                        onClick={() =>
                          setCardIndex((i) =>
                            i < cardsList.length - 1 ? i + 1 : i
                          )
                        }
                      >
                        →
                      </button>
                      <button onClick={openDrive}>🚗 ドライブ</button>
                    </div>
                  </div>

                  <div
                    onClick={() =>
                      setCardSide((s) => (s === "front" ? "back" : "front"))
                    }
                    style={{
                      minHeight: 180,
                      display: "grid",
                      placeItems: "center",
                      background: "#fff",
                      borderRadius: 14,
                      border: "1px solid #e5e7eb",
                      fontSize: isPortrait ? 36 : 42,
                      fontWeight: 900,
                      userSelect: "none",
                      cursor: "pointer",
                    }}
                  >
                    {cardSide === "front"
                      ? currentCard.english
                      : currentCard.japanese}
                  </div>

                  <div
                    style={{
                      marginTop: 8,
                      display: "flex",
                      gap: 6,
                      justifyContent: "center",
                    }}
                  >
                    <button onClick={() => speak(currentCard.english, "en-US")}>
                      🔊 英語
                    </button>
                    <button onClick={() => speak(currentCard.japanese, "ja-JP")}>
                      🔊 日本語
                    </button>
                    <button onClick={() => setCardsStarted(false)}>
                      ⏹ 終了
                    </button>
                  </div>
                </section>
              )}

              {/* ドライブモード全画面 */}
              {driveOpen && currentCard && (
                <div
                  ref={driveFs.ref}
                  style={{
                    ...(driveFs.isFs && !driveFs.supportsFs
                      ? {
                          position: "fixed",
                          inset: 0,
                          zIndex: 9999,
                          background: "#000",
                          color: "#fff",
                        }
                      : {
                          marginTop: 12,
                          borderRadius: 14,
                          background: "#000",
                          color: "#fff",
                          padding: 10,
                        }),
                    display: "flex",
                    flexDirection: "column",
                    minHeight: driveFs.isFs ? "100vh" : 280,
                  }}
                >
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    {!driveFs.isFs ? (
                      <button onClick={driveFs.enter}>全画面</button>
                    ) : (
                      <button onClick={driveFs.exit}>全画面終了</button>
                    )}
                    {!drivePlaying ? (
                      <button
                        onClick={() => setDrivePlaying(true)}
                        style={{ fontWeight: 800 }}
                      >
                        ▶ 再生
                      </button>
                    ) : (
                      <button onClick={() => setDrivePlaying(false)}>
                        ⏸ 停止
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setDriveOpen(false);
                        setDrivePlaying(false);
                      }}
                    >
                      閉じる
                    </button>
                  </div>

                  {/* 手動prev/next */}
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    <button
                      onClick={() =>
                        setCardIndex((i) => (i > 0 ? i - 1 : i))
                      }
                    >
                      ←前の単語
                    </button>
                    <button
                      onClick={() =>
                        setCardIndex((i) =>
                          i < cardsList.length - 1 ? i + 1 : i
                        )
                      }
                    >
                      次の単語→
                    </button>
                  </div>

                  {/* 速度調整 */}
                  <label style={{ fontSize: 14, marginBottom: 6 }}>
                    待ち時間(ms): {settings.driveDelayMs}
                    <input
                      type="range"
                      min={0}
                      max={2000}
                      step={100}
                      value={settings.driveDelayMs}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          driveDelayMs: Number(e.target.value),
                        })
                      }
                      style={{ width: "100%" }}
                    />
                  </label>

                  <label style={{ fontSize: 14, marginBottom: 6 }}>
                    読み上げ速度: {settings.driveRate.toFixed(1)}
                    <input
                      type="range"
                      min={0.5}
                      max={1.5}
                      step={0.1}
                      value={settings.driveRate}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          driveRate: Number(e.target.value),
                        })
                      }
                      style={{ width: "100%" }}
                    />
                  </label>

                  {/* メイン表示（フィールドのみ） */}
                  <div
                    style={{
                      flex: 1,
                      display: "grid",
                      placeItems: "center",
                      textAlign: "center",
                      fontSize: driveFs.isFs
                        ? isPortrait
                          ? 52
                          : 68
                        : 36,
                      fontWeight: 900,
                      padding: 12,
                    }}
                  >
                    {getFieldText(
                      currentCard,
                      driveFields[driveFieldIndex]
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </main>

        {/* 設定モーダル */}
        {showSettings && (
          <Modal onClose={() => setShowSettings(false)} title="⚙️ 設定">
            <div style={{ display: "grid", gap: 10 }}>
              <label>
                1ページの問題数：
                <select
                  value={settings.pageSize}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      pageSize: Number(e.target.value) as any,
                    })
                  }
                >
                  {[1, 5, 15, 30, 50].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                出題順：
                <select
                  value={settings.randomOrder ? "random" : "seq"}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      randomOrder: e.target.value === "random",
                    })
                  }
                >
                  <option value="random">ランダム</option>
                  <option value="seq">番号順</option>
                </select>
              </label>

              <label>
                例文の表示：
                <select
                  value={settings.showExamplesMode}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      showExamplesMode: e.target.value as any,
                    })
                  }
                >
                  <option value="polysemyOnly">多義語のみ</option>
                  <option value="always">常に表示</option>
                  <option value="never">表示しない</option>
                </select>
              </label>

              <label>
                入力方法：
                <select
                  value={settings.inputMethod}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      inputMethod: e.target.value as any,
                    })
                  }
                >
                  <option value="handwrite">手書き</option>
                  <option value="keyboard">キーボード</option>
                  <option value="both">両方</option>
                </select>
              </label>

              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                  ドライブモードの表示順
                </div>
                {["english", "japanese", "example_en", "example_jp"].map(
                  (f) => (
                    <label key={f} style={{ display: "block" }}>
                      <input
                        type="checkbox"
                        checked={settings.driveOrder.includes(f as any)}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setSettings((s) => {
                            const cur = s.driveOrder;
                            const nf = f as any;
                            if (on && !cur.includes(nf))
                              return { ...s, driveOrder: [...cur, nf] };
                            if (!on)
                              return {
                                ...s,
                                driveOrder: cur.filter((x) => x !== nf),
                              };
                            return s;
                          });
                        }}
                      />
                      {f === "english" && "英単語"}
                      {f === "japanese" && "日本語訳"}
                      {f === "example_en" && "例文(英語)"}
                      {f === "example_jp" && "例文(日本語)"}
                    </label>
                  )
                )}
              </div>
            </div>
          </Modal>
        )}

        {/* マイページモーダル */}
        {showMyPage && (
          <Modal onClose={() => setShowMyPage(false)} title="👤 マイページ">
            {loadingMyPage && <div>読み込み中...</div>}
            {!loadingMyPage && myPage && (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontWeight: 700 }}>
                  今週の正解数：{myPage.weekly_correct_total}
                </div>
                <div style={{ fontWeight: 700 }}>
                  累計の正解数：{myPage.correct_total}
                </div>

                <div>
                  <div style={{ fontWeight: 800, marginBottom: 4 }}>
                    表示名を変更
                  </div>
                  <NameEditor
                    initial={user.display_name}
                    onSave={updateDisplayName}
                  />
                </div>

                <div>
                  <div style={{ fontWeight: 800, marginBottom: 4 }}>
                    苦手な単語
                  </div>
                  {myPage.weak_items.length === 0 && (
                    <div style={{ fontSize: 14, color: "#555" }}>
                      まだありません
                    </div>
                  )}
                  {myPage.weak_items.map((w) => {
                    const it = allItems.find((x) => x.id === w.item_id);
                    if (!it) return null;
                    return (
                      <div
                        key={w.item_id}
                        style={{
                          padding: 8,
                          border: "1px solid #eee",
                          borderRadius: 8,
                          marginBottom: 6,
                          background: "#fff",
                        }}
                      >
                        <div style={{ fontWeight: 800 }}>{it.english}</div>
                        <div style={{ color: "#555" }}>{it.japanese}</div>
                        <div style={{ fontSize: 12, color: "#777" }}>
                          間違えた回数: {w.wrong_total}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Modal>
        )}
      </div>
    </div>
  );
}

/* ================================
   小コンポーネント
================================ */
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.25)",
        display: "grid",
        placeItems: "center",
        zIndex: 9999,
        padding: 10,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 560,
          background: "#fff",
          borderRadius: 14,
          padding: 14,
          boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <div style={{ fontWeight: 900 }}>{title}</div>
          <button onClick={onClose}>✖</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function NameEditor({
  initial,
  onSave,
}: {
  initial: string;
  onSave: (name: string) => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        style={{ flex: 1, padding: 8 }}
      />
      <button onClick={() => onSave(v)} style={{ fontWeight: 800 }}>
        保存
      </button>
    </div>
  );
}
