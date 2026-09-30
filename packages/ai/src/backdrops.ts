import type { ProjectFile } from '@vibld/core';

/**
 * Animated backgrounds Vibld writes itself, for a build to put behind a
 * section (D75, "animated background layer"; D77, "code-drawn only").
 *
 * A model asked to paint a WebGL shader or a particle field from memory
 * writes one that does not compile, runs at full device resolution, keeps
 * drawing in a background tab and ignores reduced motion. These four are
 * written once, here, with all of that settled, and a build only imports
 * one: the templated file is added to the project when a file imports it
 * (`backdropFiles`), the way package.json declares only the packages a
 * file imports. The model never plans, writes or edits them.
 *
 * They are drawn in code, from the project's own colour tokens, with no
 * video, image or font files and no package beyond React. Each one:
 * - fills its nearest positioned ancestor, behind that ancestor's content
 *   (`absolute inset-0 -z-10`, so the section is `relative isolate`);
 * - reads its colours from --background, --primary, --accent and
 *   --secondary, whatever colour syntax the tokens use, or from `colors`;
 * - caps the pixel ratio at 2 (the soft ones render lower still);
 * - pauses off screen and in a background tab;
 * - draws one still frame under prefers-reduced-motion, and with speed 0;
 * - keeps its box's CSS gradient as the fallback when WebGL is missing;
 * - is aria-hidden, with no text in the canvas.
 *
 * Their starting point is Chris's own clean-room layers in
 * Drummond-IT/designs-v1 (`layers/`): the aurora-mesh gradient, the
 * grain-blobs background, the particle-galaxy scene and Nocturne's
 * oscilloscope ribbons, rewritten as React components and without three.js.
 * Nothing here comes from that repository's upstream library (D75).
 *
 * The set is closed, like every other retrieved guidance in this package:
 * `selectBackdrops` only returns entries from this file.
 */

export type BackdropId =
  'aurora-mesh' | 'particle-field' | 'grain-blobs' | 'flow-lines';

export interface BackdropRecipe {
  id: BackdropId;
  /** The component the file exports. */
  component: string;
  /** What a visitor sees, for the guidance. */
  looks: string;
  /** Its props beyond `className`, `colors` and `speed`, for the guidance. */
  extraProps?: string;
  /** Lowercase words or phrases in a request that call for this one. */
  triggers: readonly string[];
  /** The file, exactly as it is written into a project. */
  source: string;
}

/** Where the files go, and what a project imports them as. */
export const BACKDROP_DIR = 'src/components/backdrop';
export const BACKDROP_IMPORT = '@/components/backdrop';

/**
 * Words that ask for a moving background without saying which, so every
 * recipe is offered and the model picks one.
 */
const ANY_BACKDROP = [
  'animated background',
  'background animation',
  'moving background',
  'living background',
  'dynamic background',
  'interactive background',
  'generative background',
  '3d background',
  'webgl',
  'shader',
  'immersive',
  'heavy animation',
] as const;

export const BACKDROPS: readonly BackdropRecipe[] = [
  {
    id: 'aurora-mesh',
    component: 'AuroraMesh',
    looks:
      "A slow, full-bleed field of the page's colors, like light through smoke, that bends toward the pointer. WebGL shader.",
    triggers: [
      'aurora',
      'northern lights',
      'mesh gradient',
      'gradient mesh',
      'fluid gradient',
      'nebula',
      'smoke',
    ],
    source: String.raw`import { useEffect, useRef } from 'react';

/**
 * A slow, cursor-aware field of the page's own colors, drawn by a WebGL
 * fragment shader. Written by Vibld: it fills its nearest positioned
 * ancestor, behind that ancestor's content.
 */
export interface AuroraMeshProps {
  /** Extra classes for the box; it already fills its positioned parent. */
  className?: string;
  /** Up to four CSS colors; defaults to the project's color tokens. */
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
`,
  },
  {
    id: 'particle-field',
    component: 'ParticleField',
    looks:
      'A slowly turning spiral of soft points on the page background that tilts toward the pointer. WebGL points.',
    extraProps: 'count (500 to 20000 points, default 6000)',
    triggers: [
      'particle',
      'particles',
      'galaxy',
      'starfield',
      'star field',
      'cosmic',
      'constellation',
      'orbit',
    ],
    source: String.raw`import { useEffect, useRef } from 'react';

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
`,
  },
  {
    id: 'grain-blobs',
    component: 'GrainBlobs',
    looks:
      "Large soft blobs of the page's colors drifting under a fine film grain. 2D canvas; calm and warm.",
    extraProps: 'grain (0 to 1, default 0.5)',
    triggers: [
      'blob',
      'blobs',
      'grain',
      'grainy',
      'film grain',
      'lava lamp',
      'soft gradient',
      'gradient blobs',
    ],
    source: String.raw`import { useEffect, useRef } from 'react';

/**
 * Soft blobs of the page's colors drifting under a fine film grain, drawn
 * on a 2D canvas. Written by Vibld: it fills its nearest positioned
 * ancestor, behind that ancestor's content.
 */
export interface GrainBlobsProps {
  /** Extra classes for the box; it already fills its positioned parent. */
  className?: string;
  /** Up to five CSS colors; defaults to the project's color tokens. */
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

/** Any CSS color, including var(--token) and oklch(), as sRGB from 0 to 255. */
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
`,
  },
  {
    id: 'flow-lines',
    component: 'FlowLines',
    looks:
      'Three thin glowing traces drifting like signals on a scope, leaning toward the pointer. 2D canvas; technical and sparse.',
    triggers: [
      'waveform',
      'oscilloscope',
      'signal lines',
      'flowing lines',
      'lines of light',
      'sound wave',
      'sine wave',
      'wave lines',
    ],
    source: String.raw`import { useEffect, useRef } from 'react';

/**
 * Three thin traces of light that drift like signals on a scope and lean
 * toward the pointer, drawn on a 2D canvas. Written by Vibld: it fills its
 * nearest positioned ancestor, behind that ancestor's content.
 */
export interface FlowLinesProps {
  /** Extra classes for the box; it already fills its positioned parent. */
  className?: string;
  /** One CSS color per line; defaults to the project's color tokens. */
  colors?: readonly string[];
  /** 1 is a slow drift, 0 holds still. */
  speed?: number;
}

type Rgb = [number, number, number];

const DEFAULT_COLORS = ['var(--primary)', 'var(--accent)', 'var(--secondary)'];

/** Any CSS color, including var(--token) and oklch(), as sRGB from 0 to 255. */
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
`,
  },
];

const BY_ID = new Map(BACKDROPS.map((recipe) => [recipe.id, recipe]));

/** The file a recipe is written to. */
export function backdropPath(recipe: BackdropRecipe): string {
  return BACKDROP_DIR + '/' + recipe.id + '.tsx';
}

const BACKDROP_PATHS = new Set(BACKDROPS.map(backdropPath));

/** Whether `path` is one of the files Vibld writes for a backdrop. */
export function isBackdropPath(path: string): boolean {
  return BACKDROP_PATHS.has(path);
}

function mentions(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?:^|[^a-z0-9])' + escaped + '(?![a-z0-9])', 'i').test(
    text,
  );
}

/**
 * The recipes a request calls for: the ones it names, or all of them when
 * it asks for a moving background without naming one, or none.
 */
export function selectBackdrops(promptText: string): readonly BackdropRecipe[] {
  const named = BACKDROPS.filter((recipe) =>
    recipe.triggers.some((trigger) => mentions(promptText, trigger)),
  );
  if (named.length > 0) return named;
  return ANY_BACKDROP.some((phrase) => mentions(promptText, phrase))
    ? BACKDROPS
    : [];
}

/**
 * What a request is told about the backdrops it can use, or null when it
 * calls for none. Subordinate to the request, as every retrieved guidance
 * in this package is.
 */
export function backdropGuidance(promptText: string): string | null {
  const recipes = selectBackdrops(promptText);
  if (recipes.length === 0) return null;
  const lines = recipes.map(
    (recipe) =>
      '- ' +
      recipe.component +
      ': import { ' +
      recipe.component +
      " } from '" +
      BACKDROP_IMPORT +
      '/' +
      recipe.id +
      "'. " +
      recipe.looks +
      ' Props: className, colors, speed' +
      (recipe.extraProps ? ', ' + recipe.extraProps : '') +
      '.',
  );
  return [
    'ANIMATED BACKGROUNDS',
    'The build writes these animated backgrounds for you: import one and render',
    'it, and its file is added to the project. Never plan, write or edit',
    'anything in ' + BACKDROP_DIR + '/. Where this conflicts with an',
    'instruction in the request above, follow the request.',
    '- Render it as the first child of the section it fills, and give that',
    '  section "relative isolate overflow-hidden" and a height. It fills the',
    "  section behind the section's content.",
    '- It paints with the color tokens (--background, --primary, --accent,',
    "  --secondary); pass colors (CSS colors, such as 'var(--primary)') to",
    '  choose others, and speed (0 holds it still) to change the pace. Keep',
    '  text readable over its lightest and darkest color, with a scrim if',
    '  needed.',
    '- It already caps pixel density, pauses off screen and in background',
    '  tabs, draws one still frame under reduced motion, and falls back to a',
    '  CSS gradient without WebGL. Add nothing for those.',
    "- Use at most one per page, and add it to the spec's motion table as an",
    '  "always" row.',
    'The ones this request fits:',
    ...lines,
  ].join('\n');
}

/** Module specifiers a file imports, static and dynamic. */
function specifiers(content: string): string[] {
  const found: string[] = [];
  for (const match of content.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g,
  )) {
    found.push(match[1]!);
  }
  return found;
}

/** The recipes the project's own files import, by alias or relative path. */
export function importedBackdrops(
  files: readonly ProjectFile[],
): BackdropRecipe[] {
  const ids = new Set<BackdropId>();
  for (const file of files) {
    if (isBackdropPath(file.path)) continue;
    if (!/\.(tsx|ts|jsx|js)$/.test(file.path)) continue;
    for (const specifier of specifiers(file.content)) {
      const match = /(?:^|\/)components\/backdrop\/([a-z-]+?)(?:\.tsx?)?$/.exec(
        specifier,
      );
      if (match && BY_ID.has(match[1] as BackdropId)) {
        ids.add(match[1] as BackdropId);
      }
    }
  }
  return BACKDROPS.filter((recipe) => ids.has(recipe.id));
}

/** The templated files for the backdrops `files` import, in recipe order. */
export function backdropFiles(files: readonly ProjectFile[]): ProjectFile[] {
  return importedBackdrops(files).map((recipe) => ({
    path: backdropPath(recipe),
    content: recipe.source,
  }));
}
