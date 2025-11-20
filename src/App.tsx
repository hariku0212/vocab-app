import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

/* ================================
   設定
================================ */
const API_URL =
  "https://script.google.com/macros/s/AKfycbw5_IGof9wirpNIhkBNEPxh8kwsLKFqaSRWwQumQ2z5xqt5YspochMmccRtfE4fD2ZQSg/exec";

const CLIENT_ID =
  "141623918894-f9kmkrrk7640lqhupp25nfhcog2jihim.apps.googleusercontent.com";

declare global {
  interface Window {
    google?: any;
    [key: string]: any;
  }
}

/* ================================
   型
================================ */
type WordItem = {
  id: number;
  book: string;
  deck: string;
  bookIndex: number;
  level?: string;
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
  labelJa: string;
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
  email?: string;
};

type WrongItem = {
  user_id: string;
  item_id: number;
  book_id: string;
  deck: string;
  total_count: number;
  correct_total: number;
  wrong_total: number;
  weekly_correct: number;
  weekly_wrong: number;
  last_result: string;
  last_answered_at: string;
  last_wrong_at: string;
};

type UserOverview = {
  user_id: string;
  display_name: string;
  weekly_correct_total: number;
  total_correct: number;
  total_wrong: number;
  last_answered_at: string | null;
};

type Settings = {
  pageSize: 1 | 5 | 15 | 30 | 50;
  randomOrder: boolean;
  showExamplesMode: "polysemyOnly" | "always" | "never";
  inputMethod: "keyboard" | "handwrite" | "both";
  driveDelayMs: number;
  driveRate: number;
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
   JSONP GET（CORS回避で必須）
================================ */
function apiGet<T>(
  action: string,
  params: Record<string, any> = {}
): Promise<T> {
  return new Promise((resolve, reject) => {
    const cbName = "__cb_" + Math.random().toString(36).slice(2);

    const url = new URL(API_URL);
    url.searchParams.set("action", action);
    url.searchParams.set("callback", cbName);
    Object.keys(params).forEach((k) =>
      url.searchParams.set(k, String(params[k]))
    );

    const script = document.createElement("script");
    script.src = url.toString();
    script.async = true;

    window[cbName] = (data: T) => {
      try {
        resolve(data);
      } finally {
        delete window[cbName];
        script.remove();
      }
    };

    script.onerror = () => {
      delete window[cbName];
      script.remove();
      reject(new Error(`JSONP GET failed: ${action}`));
    };

    document.body.appendChild(script);
  });
}

/* ================================
   POST（GAS doPost）
================================ */
async function apiPost<T>(
  action: string,
  body: Record<string, any>
): Promise<T> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
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
    if (supportsFs) await el.requestFullscreen();
    setIsFs(true);
  };

  const exit = async () => {
    if (supportsFs && document.fullscreenElement) await document.exitFullscreen();
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
   手書き（高性能版へ復帰）
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
        const w = Math.max(1.2, 2.8 * (p0.pressure || 0.5));
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

  useEffect(() => {
    const canvas = canvasRef.current!;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = rect.width * dpr;
      const h = rect.height * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
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
    onChangeDataUrl?.(canvas.toDataURL("image/png"));
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
    const evs = e.nativeEvent.getCoalescedEvents?.() || [e.nativeEvent];
    evs.forEach((ev: PointerEvent) => {
      curRef.current!.push(getLocalPoint(ev, canvas));
    });
    requestRedraw();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    if (e.pointerType !== "pen") return;
    e.preventDefault();

    const canvas = canvasRef.current!;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

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
        touchAction: "pan-y",
        userSelect: "none",
        WebkitUserSelect: "none",
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
          touchAction: "none",
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
   JWT デコード
================================ */
const decodeJwtPayload = (jwt: string) => {
  const base64Url = jwt.split(".")[1];
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const json = decodeURIComponent(
    atob(base64)
      .split("")
      .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
      .join("")
  );
  return JSON.parse(json);
};

/* ================================
   メイン App
================================ */
export default function App() {
  /* ------------------------------
     端末向き/背景（iPad文字バグ対策でフォント/色を明示）
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
    fontFamily:
      '"Noto Sans JP", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    color: "#111827",
  };

  const containerStyle: CSSProperties = {
    width: "100%",
    maxWidth: isPortrait ? 720 : 1100,
  };

  /* ------------------------------
     ログイン
  ------------------------------ */
  const [user, setUser] = useState<User | null>(null);
  const [loginReady, setLoginReady] = useState(false);
  const googleBtnRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
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

  /* ------------------------------
     設定（ローカル + サーバ同期）
  ------------------------------ */
  const [settings, setSettings] = useState<Settings>(() => {
    const s = localStorage.getItem("settings_json");
    return s ? (JSON.parse(s) as Settings) : DEFAULT_SETTINGS;
  });
  const settingsSyncReadyRef = useRef(false);

  useEffect(() => {
    localStorage.setItem("settings_json", JSON.stringify(settings));
  }, [settings]);

  // login時にサーバの settings_json を読み込む
  const loadSettingsFromServer = async (userId: string) => {
    try {
      const r = await apiGet<{ ok: boolean; settings: any }>(
        "getUserSettings",
        { userId }
      );
      if (r.ok && r.settings) {
        const merged = { ...DEFAULT_SETTINGS, ...r.settings };
        setSettings(merged);
        localStorage.setItem("settings_json", JSON.stringify(merged));
      }
    } catch (e) {
      console.warn("getUserSettings failed", e);
    } finally {
      settingsSyncReadyRef.current = true;
    }
  };

  // settings変更時にサーバへ保存（デバウンス）
  useEffect(() => {
    if (!user) return;
    if (!settingsSyncReadyRef.current) return;

    const t = setTimeout(() => {
      apiPost("saveUserSettings", {
        userId: user.user_id,
        settings,
      }).catch((e) => console.warn("saveUserSettings failed", e));
    }, 500);

    return () => clearTimeout(t);
  }, [settings, user]);

  useEffect(() => {
    if (!loginReady || user) return;
    if (!window.google?.accounts?.id || !googleBtnRef.current) return;

    window.google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: async (res: any) => {
        try {
          const payload = decodeJwtPayload(res.credential);
          const userId = payload.sub;
          const email = payload.email || "";
          const displayName =
            payload.name || payload.given_name || "user";

          const out = await apiPost<{ ok: boolean }>("upsertUser", {
            userId,
            googleSub: payload.sub,
            email,
            displayName,
          });
          if (!out.ok) throw new Error("upsertUser failed");

          const newUser: User = {
            user_id: userId,
            display_name: displayName,
            weekly_correct_total: 0,
            email,
          };
          setUser(newUser);

          // ★設定をサーバから復元
          await loadSettingsFromServer(userId);
        } catch (e) {
          console.error("google login failed", e);
        }
      },
    });

    window.google.accounts.id.renderButton(googleBtnRef.current, {
      theme: "outline",
      size: "large",
      type: "standard",
      text: "signin_with",
      shape: "pill",
    });
  }, [loginReady, user]);

  /* ------------------------------
     単語データ読み込み（subCategory正規化）
  ------------------------------ */
  const [books, setBooks] = useState<Book[]>([]);
  const [loadingWords, setLoadingWords] = useState(false);
  const [wordsError, setWordsError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoadingWords(true);
      setWordsError(null);
      try {
        const base = (import.meta as any).env?.BASE_URL || "/";
        const url = base.endsWith("/")
          ? base + "words_gold.json"
          : base + "/words_gold.json";

        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok)
          throw new Error(`words_gold.json fetch failed: ${res.status}`);

        const json = await res.json();

        let loaded: Book[] = [];
        if (Array.isArray(json.books)) {
          loaded = json.books;
        } else if (json.bookId && json.decks) {
          loaded = [json as Book];
        } else {
          throw new Error("words_gold.json format mismatch");
        }

        // ★ subCategory 正規化（昔動いてた方式に合わせる）
        loaded.forEach((b) => {
          Object.values(b.decks).forEach((d) => {
            d.items = d.items.map((it: any) => {
              const sc =
                it.subCategory ??
                it.sub_category ??
                it.subcategory ??
                (() => {
                  const tag = (it.tags || []).find((t: string) =>
                    t.startsWith("sub:")
                  );
                  return tag ? tag.replace("sub:", "") : undefined;
                })();

              return {
                ...it,
                subCategory: sc,
              } as WordItem;
            });
          });
        });

        setBooks(loaded);
      } catch (e: any) {
        console.error("load words json error", e);
        setWordsError(String(e?.message || e));
        setBooks([]);
      } finally {
        setLoadingWords(false);
      }
    })();
  }, []);

  /* ------------------------------
     Book/Set選択
  ------------------------------ */
  const [selectedBookId, setSelectedBookId] = useState<string>("");
  const [selectedSetId, setSelectedSetId] = useState<string>("core");
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

  const polysemyCount = useMemo(() => {
    const m = new Map<string, number>();
    allItems.forEach((it) =>
      m.set(it.english, (m.get(it.english) || 0) + 1)
    );
    return m;
  }, [allItems]);

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
     MyPage（JSONP GET復活で動く）
  ------------------------------ */
  const [wrongItems, setWrongItems] = useState<WrongItem[]>([]);
  const [overview, setOverview] = useState<UserOverview | null>(null);
  const [loadingMyPage, setLoadingMyPage] = useState(false);

  const weakItemIds = useMemo(
    () => new Set(wrongItems.map((w) => w.item_id)),
    [wrongItems]
  );

  const openMyPage = async () => {
    if (!user) return;
    setShowMyPage(true);
    setLoadingMyPage(true);
    try {
      const o = await apiGet<{ ok: boolean; user: UserOverview }>(
        "getUserOverview",
        { userId: user.user_id }
      );
      if (o.ok) setOverview(o.user);

      const w = await apiGet<{ ok: boolean; items: WrongItem[] }>(
        "getWrongItems",
        {
          userId: user.user_id,
          bookId: selectedBookId,
          deck: selectedSetId,
        }
      );
      if (w.ok) setWrongItems(w.items);
    } catch (e) {
      console.error("openMyPage error", e);
    } finally {
      setLoadingMyPage(false);
    }
  };

  const updateDisplayName = async (name: string) => {
    if (!user) return;
    try {
      const out = await apiPost<{ ok: boolean }>("updateDisplayName", {
        userId: user.user_id,
        displayName: name,
      });
      if (out.ok) {
        setUser({ ...user, display_name: name });
        setOverview((p) => (p ? { ...p, display_name: name } : p));
      }
    } catch (e) {
      console.error(e);
    }
  };

  /* ------------------------------
     テスト設定
  ------------------------------ */
  const [testMode, setTestMode] = useState<"level" | "number">("level");
  const [level, setLevel] = useState<string>("600");
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(1000);
  const [subCat, setSubCat] = useState<string>("all");
  const [mistakeOnly, setMistakeOnly] = useState(false);

  const isCoreSelected = selectedSetId === "core";
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

    if (mistakeOnly) list = list.filter((it) => weakItemIds.has(it.id));

    if (isCoreSelected) {
      if (testMode === "level") {
        list = list.filter((it) => it.level === level);
      } else {
        list = list.filter(
          (it) => it.bookIndex >= rangeStart && it.bookIndex <= rangeEnd
        );
      }
    } else {
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
    testTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    const newRes: Record<number, boolean> = { ...results };
    pageQuestions.forEach((q) => {
      if (newRes[q.id] == null) newRes[q.id] = true;
    });
    setResults(newRes);
  };

  const submitPageAndNext = async () => {
    if (user) {
      try {
        const payload = pageQuestions.map((q) => ({
          itemId: q.id,
          isCorrect: results[q.id] ?? true,
        }));
        await apiPost("saveResults", {
          userId: user.user_id,
          bookId: selectedBookId,
          deck: selectedSetId,
          results: payload,
        });
      } catch (e) {
        console.error("saveResults error", e);
      }
    }

    if (pageIndex < pages - 1) {
      setPageIndex(pageIndex + 1);
      setGrading(false);
    } else {
      setTestStarted(false);
      setGrading(false);
      if (user) openMyPage();
    }
  };

  const prevPage = () => {
    if (pageIndex === 0) return;
    setPageIndex(pageIndex - 1);
    setGrading(false);
  };

  /* ------------------------------
     単語カード設定（UI復活）
  ------------------------------ */
  const [cardsStarted, setCardsStarted] = useState(false);
  const [cardMode, setCardMode] = useState<"level" | "number">("level");
  const [cardLevel, setCardLevel] = useState("600");
  const [cardRangeStart, setCardRangeStart] = useState(1);
  const [cardRangeEnd, setCardRangeEnd] = useState(1000);
  const [cardSubCat, setCardSubCat] = useState("all");
  const [cardMistakeOnly, setCardMistakeOnly] = useState(false);

  useEffect(() => {
    if (!isCoreSelected && cardMode === "number") setCardMode("level");
  }, [isCoreSelected, cardMode]);

  const [cardsList, setCardsList] = useState<WordItem[]>([]);
  const [cardIndex, setCardIndex] = useState(0);
  const [cardSide, setCardSide] = useState<"front" | "back">("front");
  const cardFs = useSimpleFullscreen<HTMLDivElement>();

  const buildCardsList = () => {
    let list = [...allItems];

    if (cardMistakeOnly) list = list.filter((it) => weakItemIds.has(it.id));

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
     ドライブモード
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

      if (driveFieldIndex < driveFields.length - 1) {
        setDriveFieldIndex((i) => i + 1);
      } else {
        setDriveFieldIndex(0);
        setCardIndex((i) => (i < cardsList.length - 1 ? i + 1 : 0));
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
     ログイン前UI
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

  /* ------------------------------
     ログイン後UI
  ------------------------------ */
  return (
    <div style={shellStyle}>
      <div style={containerStyle}>
        {/* ヘッダー */}
        <header
          style={{
            background: "rgba(255,255,255,0.96)",
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
              style={{ fontSize: 14, padding: "6px 10px", borderRadius: 10 }}
            >
              ⚙️ 設定
            </button>
            <button
              onClick={openMyPage}
              style={{ fontSize: 14, padding: "6px 10px", borderRadius: 10 }}
            >
              👤 {user.display_name}
            </button>
          </div>
        </header>

        {/* タブ（トップのみ切替） */}
        {!testStarted && !cardsStarted && (
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
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
            background: "rgba(255,255,255,0.97)",
            borderRadius: 14,
            padding: isPortrait ? 10 : 14,
            boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
          }}
        >
          {loadingWords && <div>単語データ読み込み中...</div>}
          {wordsError && (
            <div style={{ color: "crimson", fontWeight: 700 }}>
              単語データ取得エラー: {wordsError}
            </div>
          )}

          {/* ==========================
              テストタブ
          ========================== */}
          {!loadingWords && activeTab === "test" && (
            <>
              {!testStarted && (
                <section style={{ marginBottom: 12 }}>
                  <h2 style={{ fontSize: 18, marginBottom: 6 }}>🧩 出題設定</h2>

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

                      <div style={{ marginTop: 8 }}>
                        {settings.inputMethod !== "handwrite" && (
                          <input
                            type="text"
                            placeholder="日本語で答える"
                            style={{ width: "100%", padding: 8, fontSize: 16 }}
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

          {/* ==========================
              単語カードタブ
          ========================== */}
          {!loadingWords && activeTab === "cards" && (
            <>
              {!cardsStarted && (
                <section style={{ marginBottom: 12 }}>
                  <h2 style={{ fontSize: 18, marginBottom: 6 }}>🃏 カード設定</h2>
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
                          範囲指定：
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

                    <label>
                      間違えた単語だけ：
                      <input
                        type="checkbox"
                        checked={cardMistakeOnly}
                        onChange={(e) => setCardMistakeOnly(e.target.checked)}
                        style={{ marginLeft: 6 }}
                      />
                    </label>

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
                      🃏 カード開始
                    </button>

                    <div style={{ fontSize: 12, color: "#555" }}>
                      想定カード数：{buildCardsList().length} 枚
                    </div>
                  </div>
                </section>
              )}

              {cardsStarted && currentCard && (
                <section ref={cardFs.ref}>
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
                      {cardFs.supportsFs && (
                        <button
                          onClick={() =>
                            cardFs.isFs ? cardFs.exit() : cardFs.enter()
                          }
                        >
                          {cardFs.isFs ? "全画面解除" : "全画面"}
                        </button>
                      )}
                      <button onClick={openDrive}>🚗 ドライブモード</button>
                    </div>
                  </div>

                  <div
                    style={{
                      padding: 16,
                      borderRadius: 14,
                      border: "1px solid #e5e7eb",
                      background: "#fff",
                      textAlign: "center",
                      minHeight: cardFs.isFs ? "70vh" : 220,
                      display: "grid",
                      placeItems: "center",
                      fontSize: cardFs.isFs ? 52 : 28,
                      fontWeight: 800,
                    }}
                    onClick={() =>
                      setCardSide((s) => (s === "front" ? "back" : "front"))
                    }
                  >
                    {cardSide === "front"
                      ? currentCard.english
                      : currentCard.japanese}
                  </div>

                  <div
                    style={{
                      marginTop: 10,
                      display: "flex",
                      justifyContent: "space-between",
                    }}
                  >
                    <button
                      onClick={() => {
                        setCardIndex((i) =>
                          i > 0 ? i - 1 : cardsList.length - 1
                        );
                        setCardSide("front");
                      }}
                    >
                      ← 前
                    </button>

                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() =>
                          speak(currentCard.english, "en-US")
                        }
                      >
                        🔊 英語
                      </button>
                      <button
                        onClick={() =>
                          speak(currentCard.japanese, "ja-JP")
                        }
                      >
                        🔊 日本語
                      </button>
                    </div>

                    <button
                      onClick={() => {
                        setCardIndex((i) =>
                          i < cardsList.length - 1 ? i + 1 : 0
                        );
                        setCardSide("front");
                      }}
                    >
                      次 →
                    </button>
                  </div>
                </section>
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

              <label>
                ドライブ速度：
                <input
                  type="range"
                  min={0.6}
                  max={1.4}
                  step={0.1}
                  value={settings.driveRate}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      driveRate: Number(e.target.value),
                    })
                  }
                />
                {settings.driveRate.toFixed(1)}x
              </label>

              <label>
                ドライブの次表示までの待ち(ms)：
                <input
                  type="number"
                  min={200}
                  max={3000}
                  step={100}
                  value={settings.driveDelayMs}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      driveDelayMs: Number(e.target.value),
                    })
                  }
                />
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
            {!loadingMyPage && overview && (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontWeight: 700 }}>
                  今週の正解数：{overview.weekly_correct_total}
                </div>
                <div style={{ fontWeight: 700 }}>
                  累計の正解数：{overview.total_correct}
                </div>

                <div>
                  <div style={{ fontWeight: 800, marginBottom: 4 }}>
                    表示名を変更
                  </div>
                  <NameEditor
                    initial={overview.display_name}
                    onSave={updateDisplayName}
                  />
                </div>

                <div>
                  <div style={{ fontWeight: 800, marginBottom: 4 }}>
                    苦手な単語
                  </div>
                  {wrongItems.length === 0 && (
                    <div style={{ fontSize: 14, color: "#555" }}>
                      まだありません
                    </div>
                  )}
                  {wrongItems.map((w) => {
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

        {/* ドライブモード overlay */}
        {driveOpen && currentCard && (
          <div
            ref={driveFs.ref}
            onClick={() => setDriveOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.9)",
              display: "grid",
              placeItems: "center",
              zIndex: 99999,
              color: "#fff",
              padding: 16,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%",
                maxWidth: 900,
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: driveFs.isFs ? "min(12vw, 88px)" : 44,
                  fontWeight: 900,
                  lineHeight: 1.2,
                  marginBottom: 16,
                  whiteSpace: "pre-wrap",
                }}
              >
                {getFieldText(currentCard, driveFields[driveFieldIndex])}
              </div>

              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                <button
                  onClick={() => setDrivePlaying((p) => !p)}
                  style={{ padding: "8px 14px", fontWeight: 800 }}
                >
                  {drivePlaying ? "⏸ 停止" : "▶ 再生"}
                </button>
                <button
                  onClick={() => {
                    setDriveFieldIndex(0);
                    setCardIndex((i) =>
                      i > 0 ? i - 1 : cardsList.length - 1
                    );
                  }}
                  style={{ padding: "8px 14px", fontWeight: 800 }}
                >
                  ⏮ 前
                </button>
                <button
                  onClick={() => {
                    setDriveFieldIndex(0);
                    setCardIndex((i) =>
                      i < cardsList.length - 1 ? i + 1 : 0
                    );
                  }}
                  style={{ padding: "8px 14px", fontWeight: 800 }}
                >
                  ⏭ 次
                </button>
                {driveFs.supportsFs && (
                  <button
                    onClick={() =>
                      driveFs.isFs ? driveFs.exit() : driveFs.enter()
                    }
                    style={{ padding: "8px 14px", fontWeight: 800 }}
                  >
                    {driveFs.isFs ? "全画面解除" : "全画面"}
                  </button>
                )}
                <button
                  onClick={() => setDriveOpen(false)}
                  style={{ padding: "8px 14px", fontWeight: 800 }}
                >
                  ✖ 閉じる
                </button>
              </div>
            </div>
          </div>
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
        style={{ flex: 1, padding: 8, fontSize: 16 }}
      />
      <button onClick={() => onSave(v)} style={{ fontWeight: 800 }}>
        保存
      </button>
    </div>
  );
}
