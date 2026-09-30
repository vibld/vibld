import { useEffect, useRef } from 'react';

/**
 * A slow, cursor-aware field of the page's own colours, drawn by a WebGL
 * fragment shader. Written by Vibld: it fills its nearest positioned
 * ancestor, behind that ancestor's content.
 */
export interface AuroraMeshProps {
  /** Extra classes for the box; it already fills its positioned parent. */
  className?: string;
  /** Up to four CSS colours; defaults to the project's colour tokens. */
  colors?: readonly string[];
  /** 1 is a slow drift, 0 holds still. */
  speed?: number;
}

type Rgb = [number, number, number];

const DEFAULT_COLORS = [
  'var(--background)',
  'var(--primary)',
  'var(--accent)',
  'var(--secondary)',
];

/** Any CSS colour, including var(--token) and oklch(), as sRGB from 0 to 1. */
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
  return [r / 255, g / 255, b / 255];
}

const VERTEX = 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }';

const FRAGMENT = [
  'precision highp float;',
  'uniform vec2 uRes; uniform float uTime; uniform vec2 uPointer;',
  'uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3; uniform vec3 uC4;',
  'float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }',
  'float noise(vec2 p) {',
  '  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);',
  '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),',
  '             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);',
  '}',
  'float fbm(vec2 p) {',
  '  float v = 0.0; float a = 0.5;',
  '  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }',
  '  return v;',
  '}',
  'void main() {',
  '  vec2 uv = gl_FragCoord.xy / uRes;',
  '  float side = min(uRes.x, uRes.y);',
  '  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / side;',
  '  vec2 m = (uPointer - 0.5) * uRes / side;',
  '  p += (p - m) * 0.25 * exp(-2.5 * length(p - m));',
  '  float t = uTime * 0.06;',
  '  vec2 q = vec2(fbm(p * 1.3 + t), fbm(p * 1.3 - t + 4.1));',
  '  vec2 r = vec2(fbm(p * 1.7 + 3.0 * q + vec2(1.7, 9.2) + t * 1.3),',
  '                fbm(p * 1.7 + 3.0 * q + vec2(8.3, 2.8) - t));',
  '  float f = fbm(p * 1.2 + 2.5 * r);',
  '  vec3 col = mix(uC1, uC2, smoothstep(0.2, 0.8, f));',
  '  col = mix(col, uC3, smoothstep(0.45, 1.0, length(q)) * 0.8);',
  '  col = mix(col, uC4, smoothstep(0.55, 1.0, r.x) * 0.55);',
  '  col *= 0.55 + 0.7 * f;',
  '  col *= 1.0 - 0.35 * length(uv - 0.5);',
  '  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;',
  '  gl_FragColor = vec4(col, 1.0);',
  '}',
].join('\n');

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

export function AuroraMesh({
  className = '',
  colors = DEFAULT_COLORS,
  speed = 1,
}: AuroraMeshProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorKey = colors.join('|');

  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    // Without WebGL the box keeps its CSS gradient, which is the fallback.
    const gl = canvas.getContext('webgl', {
      antialias: false,
      premultipliedAlpha: false,
    });
    if (!gl) return;
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const uniform = (name: string) => gl.getUniformLocation(program, name);
    const uRes = uniform('uRes');
    const uTime = uniform('uTime');
    const uPointer = uniform('uPointer');
    const palette = colorKey.split('|');
    ['uC1', 'uC2', 'uC3', 'uC4'].forEach((name, index) => {
      const value = palette[index % palette.length] ?? 'black';
      gl.uniform3fv(uniform(name), resolveColor(value, [0, 0, 0]));
    });

    const still =
      speed <= 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const target = { x: 0.5, y: 0.5 };
    const pointer = { x: 0.5, y: 0.5 };
    let time = 12;
    let last = performance.now();
    let frame = 0;
    let onScreen = true;

    const draw = () => {
      gl.uniform1f(uTime, time);
      gl.uniform2f(uPointer, pointer.x, pointer.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const resize = () => {
      // The field is soft, so it renders below native resolution.
      const ratio = Math.min(window.devicePixelRatio || 1, 2) * 0.6;
      const rect = box.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      draw();
    };
    const running = () => !still && onScreen && !document.hidden;
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      time += dt * speed;
      const ease = 1 - Math.exp(-dt * 4);
      pointer.x += (target.x - pointer.x) * ease;
      pointer.y += (target.y - pointer.y) * ease;
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
      target.x = (event.clientX - rect.left) / Math.max(rect.width, 1);
      target.y = 1 - (event.clientY - rect.top) / Math.max(rect.height, 1);
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
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
  }, [colorKey, speed]);

  return (
    <div
      ref={boxRef}
      aria-hidden="true"
      className={'pointer-events-none absolute inset-0 -z-10 overflow-hidden ' + className}
      style={{
        background:
          'radial-gradient(120% 90% at 25% 15%, color-mix(in oklab, var(--primary) 45%, transparent), transparent 60%), radial-gradient(90% 80% at 80% 75%, color-mix(in oklab, var(--accent) 35%, transparent), transparent 65%), var(--background)',
      }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
