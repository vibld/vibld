import { useEffect, useRef } from 'react';

/**
 * Soft blobs of the page's colours drifting under a fine film grain, drawn
 * on a 2D canvas. Written by Vibld: it fills its nearest positioned
 * ancestor, behind that ancestor's content.
 */
export interface GrainBlobsProps {
  /** Extra classes for the box; it already fills its positioned parent. */
  className?: string;
  /** Up to five CSS colours; defaults to the project's colour tokens. */
  colors?: readonly string[];
  /** 1 is a slow drift, 0 holds still. */
  speed?: number;
  /** Grain strength from 0 to 1. */
  grain?: number;
}

type Rgb = [number, number, number];

const DEFAULT_COLORS = ['var(--primary)', 'var(--accent)', 'var(--secondary)'];

// Film grain: SVG turbulence, tiled. No network request, no image file.
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/** Any CSS colour, including var(--token) and oklch(), as sRGB from 0 to 255. */
function resolveColor(value: string, fallback: Rgb): Rgb {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  probe.style.color = value;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  const context = document
    .createElement('canvas')
    .getContext('2d', { willReadFrequently: true });
  if (!context || !resolved) return fallback;
  context.fillStyle = resolved;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

interface Blob {
  x: number;
  y: number;
  radius: number;
  ax: number;
  ay: number;
  fx: number;
  fy: number;
  phase: number;
  color: Rgb;
}

export function GrainBlobs({
  className = '',
  colors = DEFAULT_COLORS,
  speed = 1,
  grain = 0.5,
}: GrainBlobsProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorKey = colors.join('|');

  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const palette = colorKey.split('|').map((value) => resolveColor(value, [128, 128, 128]));
    const blobs: Blob[] = Array.from({ length: 5 }, (_, index) => ({
      x: [0.2, 0.75, 0.5, 0.15, 0.85][index] ?? 0.5,
      y: [0.25, 0.3, 0.7, 0.8, 0.75][index] ?? 0.5,
      radius: [0.55, 0.5, 0.6, 0.4, 0.45][index] ?? 0.5,
      ax: 0.08 + 0.04 * (index % 3),
      ay: 0.06 + 0.03 * ((index + 1) % 3),
      fx: 0.11 + 0.03 * index,
      fy: 0.09 + 0.025 * ((index * 2) % 5),
      phase: index * 1.7,
      color: palette[index % palette.length] ?? [128, 128, 128],
    }));

    const still =
      speed <= 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let time = 8;
    let last = performance.now();
    let frame = 0;
    let onScreen = true;
    let width = 1;
    let height = 1;

    const draw = () => {
      context.clearRect(0, 0, width, height);
      const side = Math.max(width, height);
      for (const blob of blobs) {
        const x = (blob.x + blob.ax * Math.sin(time * blob.fx + blob.phase)) * width;
        const y = (blob.y + blob.ay * Math.cos(time * blob.fy + blob.phase)) * height;
        const radius = blob.radius * side;
        const [r, g, b] = blob.color;
        const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',0.55)');
        gradient.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);
      }
    };
    const resize = () => {
      // Soft shapes, so half resolution is indistinguishable and cheaper.
      const ratio = Math.min(window.devicePixelRatio || 1, 2) * 0.5;
      const rect = box.getBoundingClientRect();
      width = canvas.width = Math.max(1, Math.round(rect.width * ratio));
      height = canvas.height = Math.max(1, Math.round(rect.height * ratio));
      draw();
    };
    const running = () => !still && onScreen && !document.hidden;
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      time += dt * speed;
      draw();
      frame = running() ? requestAnimationFrame(loop) : 0;
    };
    const wake = () => {
      if (frame === 0 && running()) {
        last = performance.now();
        frame = requestAnimationFrame(loop);
      }
    };
    const sleep = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const onVisibility = () => (document.hidden ? sleep() : wake());

    const sizes = new ResizeObserver(resize);
    sizes.observe(box);
    const views = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true;
      if (onScreen) wake();
      else sleep();
    });
    views.observe(box);
    document.addEventListener('visibilitychange', onVisibility);
    resize();
    wake();

    return () => {
      sleep();
      sizes.disconnect();
      views.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [colorKey, speed]);

  return (
    <div
      ref={boxRef}
      aria-hidden="true"
      className={'pointer-events-none absolute inset-0 -z-10 overflow-hidden ' + className}
      style={{
        background:
          'radial-gradient(70% 60% at 20% 25%, color-mix(in oklab, var(--primary) 40%, transparent), transparent 70%), radial-gradient(60% 60% at 80% 75%, color-mix(in oklab, var(--accent) 40%, transparent), transparent 70%), var(--background)',
      }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      <div
        className="absolute inset-0 mix-blend-overlay"
        style={{ backgroundImage: GRAIN, opacity: Math.min(1, Math.max(0, grain)) * 0.35 }}
      />
    </div>
  );
}
