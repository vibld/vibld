import { useEffect, useRef } from 'react';

/**
 * A slowly turning spiral of soft points in the page's colors, drawn with
 * WebGL, that tilts toward the pointer. Written by Vibld: it fills its
 * nearest positioned ancestor, behind that ancestor's content.
 */
export interface ParticleFieldProps {
  /** Extra classes for the box; it already fills its positioned parent. */
  className?: string;
  /** Two CSS colors, core then rim; defaults to the project's tokens. */
  colors?: readonly string[];
  /** 1 is a slow turn, 0 holds still. */
  speed?: number;
  /** How many points, from 500 to 20000. */
  count?: number;
}

type Rgb = [number, number, number];

const DEFAULT_COLORS = ['var(--accent)', 'var(--primary)'];

/** Any CSS color, including var(--token) and oklch(), as sRGB from 0 to 1. */
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

const VERTEX = [
  'attribute vec3 aPos; attribute float aMix;',
  'uniform float uTime; uniform vec2 uTilt; uniform float uScale; uniform float uAspect;',
  'varying float vMix; varying float vFade;',
  'void main() {',
  '  float a = uTime * 0.05;',
  '  vec3 p = vec3(aPos.x * cos(a) - aPos.z * sin(a), aPos.y, aPos.x * sin(a) + aPos.z * cos(a));',
  '  float tx = 0.45 + uTilt.y * 0.25;',
  '  p = vec3(p.x, p.y * cos(tx) - p.z * sin(tx), p.y * sin(tx) + p.z * cos(tx));',
  '  p.x += uTilt.x * 0.15;',
  '  float depth = 2.6 + p.z;',
  '  gl_Position = vec4(p.x / depth / uAspect * 1.9, p.y / depth * 1.9, 0.0, 1.0);',
  '  gl_PointSize = uScale * (1.0 + aMix) / depth;',
  '  vMix = aMix; vFade = clamp(1.4 - depth * 0.35, 0.15, 1.0);',
  '}',
].join('\n');

const FRAGMENT = [
  'precision mediump float;',
  'uniform vec3 uCore; uniform vec3 uRim;',
  'varying float vMix; varying float vFade;',
  'void main() {',
  '  float d = length(gl_PointCoord - 0.5);',
  '  float alpha = smoothstep(0.5, 0.0, d) * vFade;',
  '  gl_FragColor = vec4(mix(uCore, uRim, vMix), alpha);',
  '}',
].join('\n');

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

/** Points on three spiral arms, denser at the core, as x, y, z and a mix. */
function galaxy(count: number): { positions: Float32Array; mixes: Float32Array } {
  const positions = new Float32Array(count * 3);
  const mixes = new Float32Array(count);
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < count; i++) {
    const radius = Math.pow(random(), 0.6) * 1.4;
    const arm = (i % 3) * ((Math.PI * 2) / 3);
    const angle = arm + radius * 2.4 + (random() - 0.5) * 0.6;
    const spread = (random() - 0.5) * 0.12 * (1.4 - radius);
    positions[i * 3] = Math.cos(angle) * radius + (random() - 0.5) * 0.08;
    positions[i * 3 + 1] = spread;
    positions[i * 3 + 2] = Math.sin(angle) * radius + (random() - 0.5) * 0.08;
    mixes[i] = Math.min(1, radius / 1.2);
  }
  return { positions, mixes };
}

export function ParticleField({
  className = '',
  colors = DEFAULT_COLORS,
  speed = 1,
  count = 6000,
}: ParticleFieldProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorKey = colors.join('|');
  const points = Math.round(Math.min(20000, Math.max(500, count)));

  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    // Without WebGL the box keeps its CSS glow, which is the fallback.
    const gl = canvas.getContext('webgl', { antialias: false, alpha: true });
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
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    const { positions, mixes } = galaxy(points);
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    const mixBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, mixBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mixes, gl.STATIC_DRAW);
    const aMix = gl.getAttribLocation(program, 'aMix');
    gl.enableVertexAttribArray(aMix);
    gl.vertexAttribPointer(aMix, 1, gl.FLOAT, false, 0, 0);

    const uniform = (name: string) => gl.getUniformLocation(program, name);
    const uTime = uniform('uTime');
    const uTilt = uniform('uTilt');
    const uScale = uniform('uScale');
    const uAspect = uniform('uAspect');
    const palette = colorKey.split('|');
    gl.uniform3fv(uniform('uCore'), resolveColor(palette[0] ?? 'white', [1, 1, 1]));
    gl.uniform3fv(
      uniform('uRim'),
      resolveColor(palette[1] ?? palette[0] ?? 'white', [1, 1, 1]),
    );

    const still =
      speed <= 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const target = { x: 0, y: 0 };
    const tilt = { x: 0, y: 0 };
    let time = 20;
    let last = performance.now();
    let frame = 0;
    let onScreen = true;

    const draw = () => {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uTime, time);
      gl.uniform2f(uTilt, tilt.x, tilt.y);
      gl.drawArrays(gl.POINTS, 0, points);
    };
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const rect = box.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1f(uScale, 3.2 * ratio);
      gl.uniform1f(uAspect, canvas.width / canvas.height);
      draw();
    };
    const running = () => !still && onScreen && !document.hidden;
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      time += dt * speed;
      const ease = 1 - Math.exp(-dt * 3);
      tilt.x += (target.x - tilt.x) * ease;
      tilt.y += (target.y - tilt.y) * ease;
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
      target.x = (event.clientX / Math.max(window.innerWidth, 1)) * 2 - 1;
      target.y = (event.clientY / Math.max(window.innerHeight, 1)) * 2 - 1;
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
      gl.deleteBuffer(positionBuffer);
      gl.deleteBuffer(mixBuffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
  }, [colorKey, speed, points]);

  return (
    <div
      ref={boxRef}
      aria-hidden="true"
      className={'pointer-events-none absolute inset-0 -z-10 overflow-hidden ' + className}
      style={{
        background:
          'radial-gradient(45% 40% at 50% 50%, color-mix(in oklab, var(--accent) 30%, transparent), transparent 70%), var(--background)',
      }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
