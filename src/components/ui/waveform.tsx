"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn, formatDuration } from "@/lib/utils";

type Props = {
  peaks: number[] | null | undefined;
  duration: number | null | undefined;
  /** Current position in seconds (static value) */
  time?: number;
  /** Live position getter, polled with requestAnimationFrame while `animate` is true */
  getTime?: () => number;
  animate?: boolean;
  onSeek?: (seconds: number) => void;
  height?: number;
  barWidth?: number;
  gap?: number;
  className?: string;
  /** Show the hover time tooltip */
  hoverTime?: boolean;
  active?: boolean;
};

type Layers = { base: HTMLCanvasElement; prog: HTMLCanvasElement };

function resample(peaks: number[], bars: number): number[] {
  const out = new Array<number>(bars);
  const ratio = peaks.length / bars;
  for (let i = 0; i < bars; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
    let m = 0;
    for (let j = start; j < end && j < peaks.length; j++) m = Math.max(m, peaks[j]);
    out[i] = m;
  }
  return out;
}

function cssVar(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function buildLayers(
  peaks: number[] | null | undefined,
  width: number,
  height: number,
  barWidth: number,
  gap: number,
  active: boolean,
): Layers {
  const dpr = window.devicePixelRatio || 1;
  const step = barWidth + gap;
  const bars = Math.max(1, Math.floor(width / step));
  const data = peaks?.length ? resample(peaks, bars) : new Array<number>(bars).fill(0.04);
  const mid = height / 2;
  const make = (color: string) => {
    const c = document.createElement("canvas");
    c.width = width * dpr;
    c.height = height * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = color;
    for (let i = 0; i < bars; i++) {
      const v = Math.max(0.03, Math.pow(data[i], 0.85));
      const h = Math.max(1.5, v * (height - 2));
      ctx.beginPath();
      ctx.roundRect(i * step, mid - h / 2, barWidth, h, Math.min(barWidth / 2, 1));
      ctx.fill();
    }
    return c;
  };
  return {
    base: make(cssVar("--wave", "#3a3a41")),
    prog: make(active ? cssVar("--accent", "#f2b544") : cssVar("--muted", "#9b9ba3")),
  };
}

function drawFrame(
  canvas: HTMLCanvasElement | null,
  layers: Layers | null,
  duration: number | null | undefined,
  t: number,
  hoverX: number | null,
) {
  if (!canvas || !layers) return;
  const { base, prog } = layers;
  if (canvas.width !== base.width || canvas.height !== base.height) {
    canvas.width = base.width;
    canvas.height = base.height;
  }
  const dpr = window.devicePixelRatio || 1;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(base, 0, 0);
  const frac = duration ? Math.max(0, Math.min(1, t / duration)) : 0;
  const px = Math.round(frac * canvas.width);
  if (px > 0) ctx.drawImage(prog, 0, 0, px, canvas.height, 0, 0, px, canvas.height);
  if (hoverX != null) {
    const hx = Math.round(hoverX * dpr);
    if (hx > px) {
      ctx.globalAlpha = 0.35;
      ctx.drawImage(prog, px, 0, hx - px, canvas.height, px, 0, hx - px, canvas.height);
      ctx.globalAlpha = 1;
    }
  }
}

/**
 * Canvas waveform from precomputed peaks: never downloads or decodes audio.
 * Base and progress layers are pre-rendered once; each frame only composites.
 */
export function Waveform({
  peaks,
  duration,
  time = 0,
  getTime,
  animate,
  onSeek,
  height = 64,
  barWidth = 2,
  gap = 1,
  className,
  hoverTime = true,
  active = true,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layers = useMemo(
    () => (width > 0 ? buildLayers(peaks, width, height, barWidth, gap, active) : null),
    [peaks, width, height, barWidth, gap, active],
  );

  // Static frame (paused / not the playing track)
  useEffect(() => {
    if (!animate || !getTime) drawFrame(canvasRef.current, layers, duration, time, hover);
  }, [animate, getTime, layers, duration, time, hover]);

  // Live frames while playing
  useEffect(() => {
    if (!animate || !getTime) return;
    let raf = 0;
    const loop = () => {
      drawFrame(canvasRef.current, layers, duration, getTime(), hover);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [animate, getTime, layers, duration, hover]);

  const posFromEvent = (e: React.PointerEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(rect.width, e.clientX - rect.left));
  };

  const seekTo = (x: number) => {
    if (!onSeek || !duration || !width) return;
    onSeek((x / width) * duration);
  };

  return (
    <div
      ref={wrapRef}
      className={cn("relative w-full touch-none select-none", onSeek && "cursor-pointer", className)}
      style={{ height }}
      onPointerDown={(e) => {
        if (!onSeek) return;
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        seekTo(posFromEvent(e));
      }}
      onPointerMove={(e) => {
        const x = posFromEvent(e);
        if (onSeek && e.pointerType === "mouse") setHover(x);
        if (dragging.current) seekTo(x);
      }}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
      onPointerLeave={() => setHover(null)}
    >
      <canvas ref={canvasRef} className="absolute inset-0" style={{ width: width || "100%", height }} />
      {hoverTime && hover != null && duration && onSeek ? (
        <div
          className="bg-raised text-fg pointer-events-none absolute -top-6 -translate-x-1/2 rounded px-1.5 py-0.5 font-mono text-[10px] shadow"
          style={{ left: hover }}
        >
          {formatDuration((hover / Math.max(1, width)) * duration)}
        </div>
      ) : null}
    </div>
  );
}
