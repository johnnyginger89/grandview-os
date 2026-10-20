"use client";
import { useEffect, useRef, useState } from "react";

/** Finger/mouse signature box. Calls onChange with a PNG data URL (or "" when cleared). */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = canvas.current!;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#100599";
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div>
      <div className="relative rounded-md border-2 border-dashed border-border-strong bg-white">
        <canvas
          ref={canvas}
          aria-label="Signature pad: sign with your finger or mouse"
          className="h-40 w-full touch-none"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drawing.current = true;
            const ctx = e.currentTarget.getContext("2d")!;
            const p = point(e);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x + 0.1, p.y + 0.1);
            ctx.stroke();
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const ctx = e.currentTarget.getContext("2d")!;
            const p = point(e);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
          }}
          onPointerUp={(e) => {
            drawing.current = false;
            setEmpty(false);
            onChange(e.currentTarget.toDataURL("image/png"));
          }}
        />
        {empty && <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-subtle">Sign here</span>}
      </div>
      <button
        type="button"
        className="mt-1 text-sm text-brand hover:underline"
        onClick={() => {
          const c = canvas.current!;
          c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
          setEmpty(true);
          onChange("");
        }}
      >
        Clear signature
      </button>
    </div>
  );
}
