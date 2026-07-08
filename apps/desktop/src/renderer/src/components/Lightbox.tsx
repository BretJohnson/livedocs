import { useEffect, useRef, useState } from 'react';

export interface LightboxProps {
  svg: string;
  onClose: () => void;
}

/** Enlarged diagram view with wheel zoom and drag pan. */
export function Lightbox({ svg, onClose }: LightboxProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragging = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null,
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-label="Enlarged diagram">
      <div className="lightbox-toolbar" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => setScale((s) => Math.min(s * 1.25, 10))}>Zoom in +</button>
        <button onClick={() => setScale((s) => Math.max(s / 1.25, 0.2))}>Zoom out −</button>
        <button
          onClick={() => {
            setScale(1);
            setOffset({ x: 0, y: 0 });
          }}
        >
          Reset
        </button>
        <button onClick={onClose}>Close ✕</button>
      </div>
      <div
        className="lightbox-canvas"
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => {
          const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
          setScale((s) => Math.min(Math.max(s * factor, 0.2), 10));
        }}
        onMouseDown={(e) => {
          dragging.current = {
            startX: e.clientX,
            startY: e.clientY,
            baseX: offset.x,
            baseY: offset.y,
          };
        }}
        onMouseMove={(e) => {
          const drag = dragging.current;
          if (!drag) return;
          setOffset({
            x: drag.baseX + (e.clientX - drag.startX),
            y: drag.baseY + (e.clientY - drag.startY),
          });
        }}
        onMouseUp={() => {
          dragging.current = null;
        }}
        onMouseLeave={() => {
          dragging.current = null;
        }}
      >
        <div
          className="lightbox-content"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  );
}
