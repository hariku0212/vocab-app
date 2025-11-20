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
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const originalOverflowRef = useRef<string | null>(null);

  const lockScroll = () => {
    if (originalOverflowRef.current === null) {
      originalOverflowRef.current = document.body.style.overflow || "";
      document.body.style.overflow = "hidden";
    }
  };

  const unlockScroll = () => {
    if (originalOverflowRef.current !== null) {
      document.body.style.overflow = originalOverflowRef.current;
      originalOverflowRef.current = null;
    }
  };

  const setupCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctxRef.current = ctx;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#000";
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setupCanvas();

    const ctx = ctxRef.current;
    if (!ctx) return;

    const beginStroke = (x: number, y: number) => {
      isDrawingRef.current = true;
      lastPointRef.current = { x, y };
      ctx.beginPath();
      ctx.moveTo(x, y);
    };

    const extendStroke = (x: number, y: number) => {
      if (!isDrawingRef.current) return;
      const last = lastPointRef.current;
      if (!last) {
        lastPointRef.current = { x, y };
        return;
      }
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      lastPointRef.current = { x, y };
    };

    const endStroke = () => {
      isDrawingRef.current = false;
      lastPointRef.current = null;
      unlockScroll();
    };

    // ---- touch: stylusのみ描画、指はスクロール可 ----
    const handleTouchStart = (e: TouchEvent) => {
      const rect = canvas.getBoundingClientRect();
      const touches = e.touches.length ? e.touches : e.changedTouches;
      if (!touches.length) return;

      const arr = Array.from(touches);
      const supportsTouchType = "touchType" in arr[0];

      let stylus: Touch | null = null;

      if (supportsTouchType) {
        for (const t of arr) {
          const tt = t as any;
          if (tt.touchType === "stylus") {
            stylus = t;
            break;
          }
        }
        if (!stylus) return; // 指だけなら描かない
      } else {
        stylus = arr[0]; // 互換
      }

      e.preventDefault();
      lockScroll();

      beginStroke(stylus.clientX - rect.left, stylus.clientY - rect.top);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDrawingRef.current) return;

      const rect = canvas.getBoundingClientRect();
      const touches = e.touches.length ? e.touches : e.changedTouches;
      if (!touches.length) return;

      const arr = Array.from(touches);
      const supportsTouchType = "touchType" in arr[0];

      let stylus: Touch | null = null;
      if (supportsTouchType) {
        for (const t of arr) {
          const tt = t as any;
          if (tt.touchType === "stylus") {
            stylus = t;
            break;
          }
        }
        if (!stylus) return;
      } else {
        stylus = arr[0];
      }

      e.preventDefault();
      extendStroke(stylus.clientX - rect.left, stylus.clientY - rect.top);
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const arr = Array.from(e.changedTouches);
      const supportsTouchType = arr[0] && "touchType" in arr[0];

      let stylusEnded = false;
      if (supportsTouchType) {
        stylusEnded = arr.some((t) => (t as any).touchType === "stylus");
      } else {
        stylusEnded = true;
      }

      if (!stylusEnded) return;

      e.preventDefault();
      endStroke();
    };

    // ---- mouse（PC互換） ----
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      beginStroke(e.clientX - rect.left, e.clientY - rect.top);
    };
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDrawingRef.current) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      extendStroke(e.clientX - rect.left, e.clientY - rect.top);
    };
    const handleMouseUp = (e: MouseEvent) => {
      if (!isDrawingRef.current) return;
      e.preventDefault();
      endStroke();
    };

    canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    canvas.addEventListener("touchend", handleTouchEnd, { passive: false });
    canvas.addEventListener("touchcancel", handleTouchEnd, { passive: false });

    canvas.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      unlockScroll();
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("touchend", handleTouchEnd);
      canvas.removeEventListener("touchcancel", handleTouchEnd);

      canvas.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [height]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: `${height}px`,
        display: "block",
        background: "#fff",
        border: "1px solid #ccc",
        borderRadius: 4,
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    />
  );
};

export default HandwritingCanvas;
