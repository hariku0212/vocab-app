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

  // キャンバスのリサイズ（Retina 対応）
  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // px 座標で描けるように

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctxRef.current = ctx;

    resizeCanvas();

    const handlePointerDown = (e: PointerEvent) => {
      // マウスは左クリックのみ、ペン・タッチはそのまま
      if (e.pointerType === 'mouse' && e.buttons !== 1) return;

      e.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      isDrawingRef.current = true;
      lastPointRef.current = { x, y };

      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Safari で失敗することもあるので握りつぶす
      }

      ctx.beginPath();
      ctx.moveTo(x, y);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!isDrawingRef.current) return;

      e.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

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

    const handlePointerUpOrCancel = (e: PointerEvent) => {
      if (!isDrawingRef.current) return;
      e.preventDefault();

      isDrawingRef.current = false;
      lastPointRef.current = null;

      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // 無視
      }
    };

    // passive: false を指定して preventDefault を効かせる
    canvas.addEventListener('pointerdown', handlePointerDown, {
      passive: false,
    });
    canvas.addEventListener('pointermove', handlePointerMove, {
      passive: false,
    });
    canvas.addEventListener('pointerup', handlePointerUpOrCancel, {
      passive: false,
    });
    canvas.addEventListener('pointercancel', handlePointerUpOrCancel, {
      passive: false,
    });
    canvas.addEventListener('pointerleave', handlePointerUpOrCancel, {
      passive: false,
    });

    // リサイズ時も再スケール
    const handleResize = () => {
      resizeCanvas();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUpOrCancel);
      canvas.removeEventListener('pointercancel', handlePointerUpOrCancel);
      canvas.removeEventListener('pointerleave', handlePointerUpOrCancel);
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
        border: '1px solid #ccc',
        borderRadius: 4,
        padding: 4,
        background: '#fff',
        touchAction: 'none', // ジェスチャー無効
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        // width / height は CSS ではなく、実際の描画サイズと連動させたいので
        // 実際のピクセルは useEffect 内の resizeCanvas で設定
        style={{
          width: '100%',
          height: `${height}px`,
          display: 'block',
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
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
