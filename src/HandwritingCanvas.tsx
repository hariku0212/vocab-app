import React, { useEffect, useRef, useState } from "react";

type Point = { x: number; y: number };
type Stroke = Point[];

type Props = {
  height?: number;
  onChangeStrokes?: (strokes: Stroke[]) => void;
};

export default function HandwritingCanvas({ height = 160, onChangeStrokes }: Props) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [current, setCurrent] = useState<Stroke | null>(null);

  // penで描いてる間だけスクロール禁止にするためのフラグ
  const drawingPointerIdRef = useRef<number | null>(null);

  // DPR対応でキャンバスをリサイズ
  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const rect = wrapper.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.style.width = rect.width + "px";
    canvas.style.height = height + "px";

    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(height * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    redrawAll();
  };

  useEffect(() => {
    resizeCanvas();
    const ro = new ResizeObserver(resizeCanvas);
    if (wrapperRef.current) ro.observe(wrapperRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, strokes]);

  const getPoint = (e: PointerEvent): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    // rect基準で座標を取る（offsetX/Yはズレの原因になりやすい）
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const redrawAll = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // DPRスケール後なので clearRect はCSS座標でOK
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;

    const drawStroke = (s: Stroke) => {
      if (s.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(s[0].x, s[0].y);
      for (let i = 1; i < s.length; i++) {
        ctx.lineTo(s[i].x, s[i].y);
      }
      ctx.stroke();
    };

    strokes.forEach(drawStroke);
    if (current) drawStroke(current);
  };

  useEffect(() => {
    redrawAll();
    onChangeStrokes?.(current ? [...strokes, current] : strokes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, current]);

  const setScrollLock = (locked: boolean) => {
    // pen描画中だけスクロール禁止
    if (!wrapperRef.current) return;
    wrapperRef.current.style.touchAction = locked ? "none" : "pan-y";
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // 指はスクロール専用 → 描画しない
    if (e.pointerType === "touch") return;

    // pen/mouseだけ描画対象
    drawingPointerIdRef.current = e.pointerId;
    setScrollLock(true);

    const p = getPoint(e.nativeEvent);
    setCurrent([p]);

    // ブラウザの既定動作（スクロール等）を止める
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drawingPointerIdRef.current !== e.pointerId) return;
    if (!current) return;

    const p = getPoint(e.nativeEvent);
    setCurrent((prev) => (prev ? [...prev, p] : [p]));
    e.preventDefault();
  };

  const endStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drawingPointerIdRef.current !== e.pointerId) return;
    drawingPointerIdRef.current = null;
    setScrollLock(false);

    if (current && current.length > 0) {
      setStrokes((prev) => [...prev, current]);
    }
    setCurrent(null);

    e.currentTarget.releasePointerCapture(e.pointerId);
    e.preventDefault();
  };

  const clear = () => {
    setStrokes([]);
    setCurrent(null);
  };

  return (
    <div
      ref={wrapperRef}
      style={{
        width: "100%",
        height,
        border: "1px solid #ccc",
        borderRadius: 8,
        background: "#fff",
        // ふだんは指スクロール可
        touchAction: "pan-y",
        position: "relative",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
      />
      <button
        type="button"
        onClick={clear}
        style={{
          position: "absolute",
          right: 8,
          bottom: 8,
          fontSize: 12,
          padding: "4px 8px",
        }}
      >
        クリア
      </button>
    </div>
  );
}
