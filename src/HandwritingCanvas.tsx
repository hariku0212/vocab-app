import React, { useEffect, useRef } from "react";

type HandwritingCanvasProps = {
  height?: number;
};

const HandwritingCanvas: React.FC<HandwritingCanvasProps> = ({
  height = 160,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number; p: number } | null>(null);

  // 描画中の手のタッチ(指)を全体でブロックするためのフラグ
  const blockPalmRef = useRef(false);

  // 一度だけセットアップ
  const setupContext = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctxRef.current = ctx;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    // dprに追従
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // ★少し太く
    ctx.lineWidth = 4.0;
    ctx.strokeStyle = "#000";
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setupContext();

    const ctx = ctxRef.current;
    if (!ctx) return;

    const getLocal = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      return {
        x: (e.clientX - rect.left) * dpr,
        y: (e.clientY - rect.top) * dpr,
        p: e.pressure || 0.5,
      };
    };

    const beginStroke = (x: number, y: number, p: number) => {
      isDrawingRef.current = true;
      lastPointRef.current = { x, y, p };
      ctx.beginPath();
      ctx.moveTo(x, y);

      // 描画中は選択させない
      blockPalmRef.current = true;
      document.body.style.userSelect = "none";
      (document.body.style as any).webkitUserSelect = "none";
      (document.body.style as any).webkitTouchCallout = "none";
    };

    const extendStroke = (x: number, y: number, p: number) => {
      if (!isDrawingRef.current) return;
      const last = lastPointRef.current;
      if (!last) {
        lastPointRef.current = { x, y, p };
        return;
      }

      // ★pressureで太さ微調整（太め寄り）
      const width = 3.6 + 3.2 * p;
      ctx.lineWidth = width;

      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(x, y);
      ctx.stroke();

      lastPointRef.current = { x, y, p };
    };

    const endStroke = () => {
      isDrawingRef.current = false;
      lastPointRef.current = null;

      blockPalmRef.current = false;
      document.body.style.userSelect = "";
      (document.body.style as any).webkitUserSelect = "";
      (document.body.style as any).webkitTouchCallout = "";
    };

    // ---- Pointer Events（iPad / PC共通・ペンのみ描画） -----------------
    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "pen" && e.pointerType !== "mouse") {
        // 指タッチは無視（スクロール専用）
        return;
      }
      if (e.pointerType === "mouse" && e.buttons !== 1) return;

      e.preventDefault();
      e.stopPropagation();

      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {}

      const { x, y, p } = getLocal(e);
      beginStroke(x, y, p);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!isDrawingRef.current) return;
      if (e.pointerType !== "pen" && e.pointerType !== "mouse") return;

      e.preventDefault();
      e.stopPropagation();

      const evs = e.getCoalescedEvents?.() || [e];
      evs.forEach((ev) => {
        const { x, y, p } = getLocal(ev as PointerEvent);
        extendStroke(x, y, p);
      });
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!isDrawingRef.current) return;
      if (e.pointerType !== "pen" && e.pointerType !== "mouse") return;

      e.preventDefault();
      e.stopPropagation();

      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {}

      endStroke();
    };

    // ---- palm rejection（描画中の指タップを全体でブロック） -------------
    const blockPalm = (e: TouchEvent) => {
      if (!blockPalmRef.current) return;

      const touches = Array.from(e.touches.length ? e.touches : e.changedTouches);
      const supportsTouchType = touches[0] && "touchType" in (touches[0] as any);

      if (supportsTouchType) {
        const hasStylus = touches.some(
          (t) => (t as any).touchType === "stylus"
        );
        if (!hasStylus) {
          e.preventDefault();
          e.stopPropagation();
        }
      } else {
        // touchTypeが無い環境は、描画中の指イベントは全部ブロック
        e.preventDefault();
        e.stopPropagation();
      }
    };

    canvas.addEventListener("pointerdown", handlePointerDown, { passive: false });
    canvas.addEventListener("pointermove", handlePointerMove, { passive: false });
    canvas.addEventListener("pointerup", handlePointerUp, { passive: false });
    canvas.addEventListener("pointercancel", handlePointerUp, { passive: false });

    document.addEventListener("touchstart", blockPalm, {
      passive: false,
      capture: true,
    });
    document.addEventListener("touchmove", blockPalm, {
      passive: false,
      capture: true,
    });
    document.addEventListener("touchend", blockPalm, {
      passive: false,
      capture: true,
    });

    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);

      document.removeEventListener("touchstart", blockPalm, true as any);
      document.removeEventListener("touchmove", blockPalm, true as any);
      document.removeEventListener("touchend", blockPalm, true as any);
    };
  }, []);

  const handleClear = () => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  return (
    <div
      style={{
        userSelect: "none",
        WebkitUserSelect: "none",
        // 指スクロールは許可（縦）
        touchAction: "pan-y",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: `${height}px`,
          display: "block",
          userSelect: "none",
          WebkitUserSelect: "none",
          background: "#fff",
          border: "1px solid #ccc",
          borderRadius: 6,
          // 指スクロールOK、描画時はpreventDefaultで止める
          touchAction: "pan-y",
        }}
      />
      <div style={{ textAlign: "right", marginTop: 4 }}>
        <button
          type="button"
          onClick={handleClear}
          style={{ fontSize: "0.8rem" }}
        >
          クリア
        </button>
      </div>
    </div>
  );
};

export default HandwritingCanvas;
