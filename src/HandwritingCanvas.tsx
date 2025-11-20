import React, { useEffect, useRef } from 'react';

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
  const activePointerIdRef = useRef<number | null>(null);

  // DPR対応でキャンバスを初期化
  const setupContext = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3; // 少し太め
    ctx.strokeStyle = '#000';

    ctxRef.current = ctx;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setupContext();

    const resizeObserver = new ResizeObserver(() => {
      // リサイズ時に再設定（既存線は消えるが、現状用途ならOKなはず）
      setupContext();
    });
    resizeObserver.observe(canvas);

    const ctx = ctxRef.current;
    if (!ctx) return;

    const getPoint = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };

    const beginStroke = (x: number, y: number, pointerId: number) => {
      isDrawingRef.current = true;
      activePointerIdRef.current = pointerId;
      lastPointRef.current = { x, y };
      ctx.beginPath();
      ctx.moveTo(x, y);

      // ★ ペン描画中だけスクロール禁止
      canvas.style.touchAction = 'none';
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
      activePointerIdRef.current = null;

      // ★ 描画が終わったら指スクロールOKに戻す
      canvas.style.touchAction = 'pan-y';
    };

    // pointer events を使って pen/mouse のみ描画、touchは完全無視
    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        // 指はスクロール専用 → 描画しない
        return;
      }
      e.preventDefault();
      const p = getPoint(e);
      beginStroke(p.x, p.y, e.pointerId);
      canvas.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!isDrawingRef.current) return;
      if (activePointerIdRef.current !== e.pointerId) return;
      e.preventDefault();
      const p = getPoint(e);
      extendStroke(p.x, p.y);
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (activePointerIdRef.current !== e.pointerId) return;
      e.preventDefault();
      endStroke();
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {}
    };

    canvas.addEventListener('pointerdown', handlePointerDown, { passive: false });
    canvas.addEventListener('pointermove', handlePointerMove, { passive: false });
    canvas.addEventListener('pointerup', handlePointerUp, { passive: false });
    canvas.addEventListener('pointercancel', handlePointerUp, { passive: false });

    return () => {
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointercancel', handlePointerUp);
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
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: `${height}px`,
          display: 'block',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          background: '#fff',
          border: '1px solid #ccc',
          borderRadius: 4,
          // 初期状態は指スクロール可
          touchAction: 'pan-y',
        }}
      />
      <div style={{ textAlign: 'right', marginTop: 4 }}>
        <button
          type="button"
          onClick={handleClear}
          style={{ fontSize: '0.8rem' }}
        >
          クリア
        </button>
      </div>
    </div>
  );
};

export default HandwritingCanvas;
