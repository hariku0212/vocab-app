import React, { useRef, useState } from 'react';

type HandwritingCanvasProps = {
  height?: number;
};

const HandwritingCanvas: React.FC<HandwritingCanvasProps> = ({
  height = 160,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  // キャンバス内の座標に変換
  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const setupContext = (canvas: HTMLCanvasElement): CanvasRenderingContext2D | null => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // 線のスタイル
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
    return ctx;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // マウスの場合は左クリックのみ許可
    if (e.pointerType === 'mouse' && e.buttons !== 1) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    e.preventDefault();

    const ctx = setupContext(canvas);
    if (!ctx) return;

    // このポインタをキャンバスにキャプチャ
    canvas.setPointerCapture(e.pointerId);

    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    lastPointRef.current = { x, y };
    setIsDrawing(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    e.preventDefault();

    const ctx = setupContext(canvas);
    if (!ctx) return;

    const { x, y } = getPos(e);
    const last = lastPointRef.current;

    if (!last) {
      ctx.lineTo(x, y);
      ctx.stroke();
      lastPointRef.current = { x, y };
      return;
    }

    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(x, y);
    ctx.stroke();

    lastPointRef.current = { x, y };
  };

  const stopDrawing = (e?: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (canvas && e) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
    setIsDrawing(false);
    lastPointRef.current = null;
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  // Retina 対応などをきっちりやるなら useEffect で DPR を考慮しますが、
  // ひとまずシンプルに width=800 を 100% 表示にしています。
  const canvasHeight = height;

  return (
    <div
      style={{
        border: '1px solid #ccc',
        borderRadius: 4,
        padding: 4,
        background: '#fff',
        touchAction: 'none', // ← スクロールなどのジェスチャー無効
        userSelect: 'none',  // ← テキスト選択無効
      }}
    >
      <canvas
        ref={canvasRef}
        width={800}
        height={canvasHeight}
        style={{
          width: '100%',
          display: 'block',
          touchAction: 'none', // iPad での描画に重要
          userSelect: 'none',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDrawing}
        onPointerCancel={stopDrawing}
        onPointerLeave={stopDrawing}
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
