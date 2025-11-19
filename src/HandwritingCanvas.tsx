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

  const isTouchDeviceRef = useRef(false);

  const setupContext = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctxRef.current = ctx;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    isTouchDeviceRef.current =
      'ontouchstart' in window || navigator.maxTouchPoints > 0;

    setupContext();

    const ctx = ctxRef.current;
    if (!ctx) return;

    // ---- 共通：ストローク処理 -----------------------------------
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
    };

    // ---- touch（iPad 等） ----------------------------------------
    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const touches = e.touches.length ? e.touches : e.changedTouches;
      if (!touches.length) return;

      let t = touches[0];
      for (let i = 0; i < touches.length; i++) {
        const tt = touches[i] as any;
        if (tt.touchType === 'stylus') {
          t = touches[i];
          break;
        }
      }

      const x = t.clientX - rect.left;
      const y = t.clientY - rect.top;
      beginStroke(x, y);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDrawingRef.current) return;
      e.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const touches = e.touches.length ? e.touches : e.changedTouches;
      if (!touches.length) return;

      let t = touches[0];
      for (let i = 0; i < touches.length; i++) {
        const tt = touches[i] as any;
        if (tt.touchType === 'stylus') {
          t = touches[i];
          break;
        }
      }

      const x = t.clientX - rect.left;
      const y = t.clientY - rect.top;
      extendStroke(x, y);
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!isDrawingRef.current) return;
      e.preventDefault();
      endStroke();
    };

    // ---- mouse（PC） ---------------------------------------------
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      beginStroke(x, y);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDrawingRef.current) return;
      e.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      extendStroke(x, y);
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!isDrawingRef.current) return;
      e.preventDefault();
      endStroke();
    };

    // ---- イベント登録 --------------------------------------------
    if (isTouchDeviceRef.current) {
      canvas.addEventListener('touchstart', handleTouchStart, {
        passive: false,
      });
      canvas.addEventListener('touchmove', handleTouchMove, {
        passive: false,
      });
      canvas.addEventListener('touchend', handleTouchEnd, {
        passive: false,
      });
      canvas.addEventListener('touchcancel', handleTouchEnd, {
        passive: false,
      });
    } else {
      canvas.addEventListener('mousedown', handleMouseDown);
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    const handleResize = () => {
      setupContext();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      if (isTouchDeviceRef.current) {
        canvas.removeEventListener('touchstart', handleTouchStart);
        canvas.removeEventListener('touchmove', handleTouchMove);
        canvas.removeEventListener('touchend', handleTouchEnd);
        canvas.removeEventListener('touchcancel', handleTouchEnd);
      } else {
        canvas.removeEventListener('mousedown', handleMouseDown);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      }
      window.removeEventListener('resize', handleResize);
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
        touchAction: 'none',
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
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          background: '#fff', // 白い「書ける」エリアはここだけ
          border: '1px solid #ccc',
          borderRadius: 4,
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
