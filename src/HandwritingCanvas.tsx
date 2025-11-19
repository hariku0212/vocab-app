import { useEffect, useRef } from 'react';

type HandwritingCanvasProps = {
  height?: number;   // 表示高さ（px）
  lineWidth?: number; // 線の太さ
};

type Point = { x: number; y: number };

export default function HandwritingCanvas({
  height = 140,
  lineWidth = 2.4,
}: HandwritingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);
  const dprRef = useRef(1);

  // Canvas 初期化（高解像度対応 + 線設定）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;

    const rect = canvas.getBoundingClientRect();
    // 見た目サイズ × DPR で内部解像度を確保
    const width = rect.width || 400;
    const h = rect.height || height;

    canvas.width = width * dpr;
    canvas.height = h * dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0); // スケールをリセット
    ctx.scale(dpr, dpr); // 描画は CSS ピクセルで行う
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = '#000000';
  }, [height, lineWidth]);

  const getCanvasPoint = (
    e: React.PointerEvent<HTMLCanvasElement>
  ): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const p = getCanvasPoint(e);
    if (!p) return;

    drawingRef.current = true;
    lastPointRef.current = p;

    ctx.beginPath();
    ctx.moveTo(p.x, p.y);

    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const p = getCanvasPoint(e);
    const last = lastPointRef.current;
    if (!p || !last) return;

    // 前回点と今回点の中点を取って、Quadratic Curve でつなぐ → ちょっとなめらか
    const midX = (last.x + p.x) / 2;
    const midY = (last.y + p.y) / 2;

    ctx.quadraticCurveTo(last.x, last.y, midX, midY);
    ctx.stroke();

    lastPointRef.current = p;
    e.preventDefault();
  };

  const finishStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    try {
      (e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    e.preventDefault();
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    finishStroke(e);
  };

  const handlePointerLeave = (e: React.PointerEvent<HTMLCanvasElement>) => {
    finishStroke(e);
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = dprRef.current || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = '#000000';
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: `${height}px`,
          border: '1px solid #ddd',
          borderRadius: 4,
          backgroundColor: '#fff',
          touchAction: 'none', // これが iPad / iPhone で超重要（スクロール抑止）
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
      />
      <button
        type="button"
        onClick={handleClear}
        style={{ marginTop: '0.25rem', fontSize: '0.85rem' }}
      >
        クリア
      </button>
    </div>
  );
}
