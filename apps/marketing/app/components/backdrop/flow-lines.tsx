import { useEffect, useRef } from 'react';

/**
 * Three thin traces of light that drift like signals on a scope and lean
 * toward the pointer, drawn on a 2D canvas. Written by Vibld: it fills its
 * nearest positioned ancestor, behind that ancestor's content.
 */
export interface FlowLinesProps {
  /** Extra classes for the box; it already fills its positioned parent. */
  className?: string;
  /** One CSS colour per line; defaults to the project's colour tokens. */
  colors?: readonly string[];
  /** 1 is a slow drift, 0 holds still. */
  speed?: number;
}

type Rgb = [number, number, number];

const DEFAULT_COLORS = ['var(--primary)', 'var(--accent)', 'var(--secondary)'];

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

const LINES = [
  { base: 0.42, amp: [0.08, 0.035, 0.015], freq: [1.3, 3.1, 6.2], rate: [0.35, 0.6, 1.1] },
  { base: 0.55, amp: [0.06, 0.04, 0.012], freq: [1.7, 2.6, 7.4], rate: [0.28, 0.75, 0.9] },
  { base: 0.66, amp: [0.07, 0.03, 0.018], freq: [1.1, 3.7, 5.3], rate: [0.42, 0.5, 1.3] },
];

export function FlowLines({
  className = '',
  colors = DEFAULT_COLORS,
  speed = 1,
}: FlowLinesProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorKey = colors.join('|');

  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const palette = colorKey.split('|').map((value) => resolveColor(value, [200, 200, 200]));

    const still =
      speed <= 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let time = 5;
    let last = performance.now();
    let frame = 0;
    let onScreen = true;
    let width = 1;
    let height = 1;
    let ratio = 1;
    let lean = 0;
    let leanTarget = 0;

    const draw = () => {
      context.clearRect(0, 0, width, height);
      LINES.forEach((line, index) => {
        const [r, g, b] = palette[index % palette.length] ?? [200, 200, 200];
        context.beginPath();
        const steps = 96;
        for (let s = 0; s <= steps; s++) {
          const u = s / steps;
          let y = line.base + lean * 0.06 * Math.sin(u * Math.PI);
          line.amp.forEach((amp, k) => {
            y += amp * Math.sin(u * Math.PI * 2 * (line.freq[k] ?? 1) + time * (line.rate[k] ?? 1) + index);
          });
          const x = u * width;
          if (s === 0) context.moveTo(x, y * height);
          else context.lineTo(x, y * height);
        }
        // A wide faint stroke for the glow, then the line itself.
        context.strokeStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.12)';
        context.lineWidth = 10 * ratio;
        context.stroke();
        context.strokeStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.85)';
        context.lineWidth = 1.5 * ratio;
        context.stroke();
      });
    };
    const resize = () => {
      ratio = Math.min(window.devicePixelRatio || 1, 2);
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
      lean += (leanTarget - lean) * (1 - Math.exp(-dt * 3));
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
    const onPointer = (event: PointerEvent) => {
      const rect = box.getBoundingClientRect();
      leanTarget = ((event.clientY - rect.top) / Math.max(rect.height, 1) - 0.5) * 2;
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
    window.addEventListener('pointermove', onPointer, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    resize();
    wake();

    return () => {
      sleep();
      sizes.disconnect();
      views.disconnect();
      window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [colorKey, speed]);

  return (
    <div
      ref={boxRef}
      aria-hidden="true"
      className={'pointer-events-none absolute inset-0 -z-10 overflow-hidden ' + className}
      style={{ background: 'var(--background)' }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
