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

  // 最初の一回だけコンテキストをセットアップ（スクロール時に再初期化しない）
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

    // マウント時に一度だけセットアップ
    setupContext();

    const ctx = ctxRef.current;
    if (!ctx) return;

    // 共通：ストローク処理
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

    // ---- touch（iPad 等）：ペンだけ描画、指はスクロール専用 --------------------
    const handleTouchStart = (e: TouchEvent) => {
      const rect = canvas.getBoundingClientRect();
      const touchesList = e.touches.length ? e.touches : e.changedTouches;
      if (!touchesList.length) return;

      const touchesArray = Array.from(touchesList);
      const supportsTouchType = 'touchType' in touchesArray[0];

      let stylusTouch: Touch | null = null;

      if (supportsTouchType) {
        // touchType が取れる環境（iPad Safari 等）では stylus のみ描画
        for (const t of touchesArray) {
          const tt = t as any;
          if (tt.touchType === 'stylus') {
            stylusTouch = t;
            break;
          }
        }
        if (!stylusTouch) {
          // ペンが含まれていない → 指で触っているだけ → 描画しない・スクロールさせる
          return;
        }
      } else {
        // 古いブラウザ等：とりあえず最初のタッチを使う（互換用）
        stylusTouch = touchesArray[0];
      }

      // ここで初めて既定動作を止める（ペンのときだけ）
      e.preventDefault();

      const x = stylusTouch.clientX - rect.left;
      const y = stylusTouch.clientY - rect.top;
      beginStroke(x, y);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDrawingRef.current) return;

      const rect = canvas.getBoundingClientRect();
      const touchesList = e.touches.length ? e.touches : e.changedTouches;
      if (!touchesList.length) return;

      const touchesArray = Array.from(touchesList);
      const supportsTouchType = 'touchType' in touchesArray[0];

      let stylusTouch: Touch | null = null;

      if (supportsTouchType) {
        for (const t of touchesArray) {
          const tt = t as any;
          if (tt.touchType === 'stylus') {
            stylusTouch = t;
            break;
          }
        }
        if (!stylusTouch) {
          // ペンがない状態の move は無視（finger で動いているだけ）
          return;
        }
      } else {
        stylusTouch = touchesArray[0];
      }

      e.preventDefault();

      const x = stylusTouch.clientX - rect.left;
      const y = stylusTouch.clientY - rect.top;
      extendStroke(x, y);
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const touchesArray = Array.from(e.changedTouches);
      const supportsTouchType =
        touchesArray[0] && 'touchType' in touchesArray[0];

      let hasStylusEnd = false;
      if (supportsTouchType) {
        for (const t of touchesArray) {
          const tt = t as any;
          if (tt.touchType === 'stylus') {
            hasStylusEnd = true;
            break;
          }
        }
      } else {
        // touchType がない環境ではとりあえず end で終わりにする
        hasStylusEnd = true;
      }

      if (!hasStylusEnd) {
        // 指だけ離れた場合はストローク終了扱いにしない
        return;
      }

      e.preventDefault();
      endStroke();
    };

    // ---- mouse（PC）：今までどおりマウスで描画 -------------------------------
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

    // ---- イベント登録 --------------------------------------------------------
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
        // 指でのスクロールは許可したいので touchAction は付けない
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
