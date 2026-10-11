import type { ProjectFile } from '@vibld/core';

import { importSpecifiers, importTarget, mentions } from './backdrops.ts';

/**
 * 3D scenes, for a build to put in a hero or behind a section (D205).
 *
 * Chris wants range, not a small library of repeated designs, so the model
 * writes every scene itself, designed for the site it is building. What it
 * gets wrong from memory is the part around the scene: a three.js renderer
 * that does not type-check against @types/three, renders at full device
 * resolution, never pauses, ignores reduced motion and has no fallback.
 * That part is one file Vibld writes, the stage (`STAGE_SOURCE`), on the
 * terms of the animated backgrounds (D75, `backdrops.ts`): it is added to
 * the project when a file imports it (`sceneFiles`), three and
 * @types/three are added to package.json because it imports three
 * (`extraDependencies`), and the model never plans, writes or edits it.
 *
 * The stage:
 * - loads three.js with a dynamic import after the page has painted, so
 *   the first paint carries none of it (about 300 KB gzipped, in its own
 *   chunk);
 * - draws with WebGPU where the browser has a working WebGPU, and WebGL 2
 *   where it does not, including a WebGPU that throws on the first frame;
 * - fills its nearest positioned ancestor and shows a CSS glow until the
 *   first frame, and for good without either API;
 * - resolves the page's colors (--primary, --accent, --secondary and
 *   --foreground, or `colors`) and --background, inside the scene's box,
 *   and rebuilds when the theme changes them;
 * - caps the pixel ratio at 2, pauses off screen and in a background tab,
 *   draws one still frame under prefers-reduced-motion and speed 0, and
 *   disposes the scene when it unmounts;
 * - is aria-hidden and never takes pointer events;
 * - exports helpers a scene from memory tends to get wrong: a seeded
 *   random sequence, points spread evenly on a sphere, smooth noise, and
 *   mending the normals of a deformed sphere's seams.
 *
 * The four scenes in `SCENE_EXAMPLES` are tested examples of scenes built
 * on it, not components a build imports. The guidance shows one of them,
 * the one a request names or else one picked by the request's text, so
 * builds do not all start from the same scene.
 */

/** Where the stage goes, and what a project imports it as. */
export const SCENE_DIR = 'src/components/scene';
export const STAGE_PATH = SCENE_DIR + '/stage.tsx';
export const STAGE_IMPORT = '@/components/scene/stage';

/**
 * Words that ask for 3D without naming a subject. A request with one of
 * these, or with an example's hints, is told about the stage.
 */
const ANY_SCENE = [
  '3d',
  '3-d',
  'three.js',
  'threejs',
  'three dimensional',
  'three-dimensional',
  'webgpu',
] as const;

export interface SceneExample {
  id: string;
  /** What a visitor sees. */
  looks: string;
  /**
   * Lowercase words or phrases in a request that ask for 3D and fit this
   * example best. Kept narrow: worldwide shipping, Earth Day, a Chrome
   * extension, liquid staking, blob storage, all-terrain bikes, iridescent
   * nail polish and holographic stickers are not requests for a scene.
   */
  hints: readonly string[];
  /** A whole scene file, as the model would write one. */
  source: string;
}

/** The stage, exactly as it is written into a project. */
export const STAGE_SOURCE = String.raw`/**
 * The stage every 3D scene in this project is built on. Written by Vibld
 * (three.js): edit the scenes, not this file.
 *
 * <ThreeScene build={...} /> fills its nearest positioned ancestor. It
 * loads three.js after the page has painted, in its own chunk, and draws
 * with WebGPU where the browser has a working WebGPU and WebGL 2 where it
 * does not. Until the first frame, and for good without either, the box
 * shows its CSS glow. It caps the pixel ratio at 2, pauses off screen and
 * in a hidden tab, draws one still frame under prefers-reduced-motion or
 * speed 0, rebuilds in new colors when the theme changes them, and
 * disposes every geometry and material in the scene when it unmounts.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import type * as Three from 'three/webgpu';

export type ThreeModule = typeof Three;

/** What a scene is built into, and what it can read each frame. */
export interface Stage {
  THREE: ThreeModule;
  scene: Three.Scene;
  camera: Three.PerspectiveCamera;
  /** The page's colors, resolved from the props or the color tokens. */
  palette: Three.Color[];
  /** The page background, for fog and for anything that hides the far side. */
  background: Three.Color;
  /** The pointer, eased, from -1 to 1 across the viewport. */
  pointer: { x: number; y: number };
  /** A repeatable random sequence from the seed, the same on every load. */
  random: () => number;
}

export interface SceneHandle {
  /** Moves everything to time t (seconds, scaled by speed). */
  update: (t: number) => void;
  /** Fits the scene to a box of this width over height. */
  fit?: (aspect: number) => void;
}

/**
 * Any CSS color, including var(--token) and oklch(), as a three.js color,
 * read inside host, so a token set on the scene's box or section counts.
 */
function resolveColor(
  THREE: ThreeModule,
  value: string,
  fallback: string,
  host: HTMLElement,
) {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  probe.style.color = fallback;
  probe.style.color = value;
  host.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  const context = document
    .createElement('canvas')
    .getContext('2d', { willReadFrequently: true });
  if (!context) return new THREE.Color(fallback);
  context.fillStyle = fallback;
  context.fillStyle = resolved;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
  return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
}

/** What each color computes to inside host right now (var(--x) included). */
function computedColors(values: readonly string[], host: HTMLElement) {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  host.appendChild(probe);
  const out = values.map((value) => {
    probe.style.color = '';
    probe.style.color = value;
    return getComputedStyle(probe).color;
  });
  probe.remove();
  return out.join('|');
}

/**
 * Changes when the page's theme changes what these colors compute to: a
 * class, style or attribute on the box or any element around it (a
 * light/dark toggle on html, a themed section) or the system color scheme.
 * The scene is rebuilt in the new colors. Checks run at most once a frame.
 */
function useThemeKey(
  values: readonly string[],
  hostRef: RefObject<HTMLElement | null>,
) {
  const key = values.join('|');
  const [theme, setTheme] = useState(() =>
    computedColors(values, document.body),
  );
  useEffect(() => {
    const list = key.split('|');
    const host = hostRef.current ?? document.body;
    const check = () => setTheme(computedColors(list, host));
    let pending = 0;
    const schedule = () => {
      if (pending === 0) {
        pending = requestAnimationFrame(() => {
          pending = 0;
          check();
        });
      }
    };
    check();
    const watcher = new MutationObserver(schedule);
    for (let element: HTMLElement | null = host; element; element = element.parentElement) {
      watcher.observe(element, { attributes: true });
    }
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', schedule);
    return () => {
      cancelAnimationFrame(pending);
      watcher.disconnect();
      scheme.removeEventListener('change', schedule);
    };
  }, [key]);
  return theme;
}

/** A repeatable random sequence, so a scene looks the same on every load. */
export function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEFAULT_COLORS = [
  'var(--primary)',
  'var(--accent)',
  'var(--secondary)',
  'var(--foreground)',
];

const FALLBACKS = ['#6d5efc', '#22d3ee', '#f472b6', '#e5e7eb'];

/**
 * Mounts a three.js scene in a box that fills its positioned parent.
 *
 * three.js loads after the page has painted, in its own chunk, and draws
 * with WebGPU where the browser has a working WebGPU and WebGL 2 where it
 * does not. Until the first frame is drawn, and for good without either,
 * the box shows its CSS glow. It caps the pixel ratio at 2, pauses off
 * screen and in a hidden tab, and draws one still frame under
 * prefers-reduced-motion or speed 0.
 */
function useThreeScene(
  build: (stage: Stage) => SceneHandle,
  colors: readonly string[],
  speed: number,
  seed: number,
) {
  const boxRef = useRef<HTMLDivElement>(null);
  const buildRef = useRef(build);
  buildRef.current = build;
  const colorKey = colors.join('|');
  const themeKey = useThemeKey([...colors, 'var(--background)'], boxRef);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    let disposed = false;
    let stop = () => {};
    let canvas: HTMLCanvasElement | null = null;

    // A canvas holds one kind of context, so a fallback gets a new one.
    const freshCanvas = () => {
      canvas?.remove();
      canvas = document.createElement('canvas');
      canvas.style.cssText =
        'display:block;width:100%;height:100%;opacity:0;transition:opacity 700ms ease-out';
      box.appendChild(canvas);
      return canvas;
    };

    const start = async () => {
      const THREE = await import('three/webgpu');
      if (disposed) return;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
      camera.position.set(0, 0, 6);
      const given = colorKey.split('|').filter(Boolean);
      const palette = FALLBACKS.map((fallback, index) =>
        resolveColor(THREE, given[index % Math.max(given.length, 1)] ?? fallback, fallback, box),
      );
      const background = resolveColor(THREE, 'var(--background)', '#0b0b12', box);
      const target = { x: 0, y: 0 };
      const pointer = { x: 0, y: 0 };
      const handle = buildRef.current({
        THREE,
        scene,
        camera,
        palette,
        background,
        pointer,
        random: seeded(seed),
      });

      const open = async (forceWebGL: boolean) => {
        const renderer = new THREE.WebGPURenderer({
          canvas: freshCanvas(),
          antialias: true,
          alpha: true,
          forceWebGL,
        });
        try {
          await renderer.init();
        } catch (error) {
          renderer.dispose();
          throw error;
        }
        renderer.setClearColor(0x000000, 0);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        return renderer;
      };
      let drawing: Three.WebGPURenderer | null = null;
      const size = () => {
        const renderer = drawing;
        if (!renderer) return;
        const rect = box.getBoundingClientRect();
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height));
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        handle.fit?.(camera.aspect);
        camera.updateProjectionMatrix();
      };
      // A browser whose WebGPU three.js cannot drive rejects on init or
      // throws on the first frame; the scene is drawn with WebGL 2 instead.
      handle.update(0);
      try {
        drawing = await open(false);
        size();
        drawing.render(scene, camera);
      } catch {
        drawing?.dispose();
        drawing = await open(true);
      }
      const renderer = drawing;
      if (disposed) {
        renderer.dispose();
        canvas?.remove();
        return;
      }

      const still =
        speed <= 0 ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      let time = 4;
      let last = performance.now();
      let frame = 0;
      let onScreen = true;
      let broken = false;

      const draw = () => {
        if (broken) return;
        handle.update(time);
        try {
          renderer.render(scene, camera);
          if (canvas) canvas.style.opacity = '1';
        } catch {
          // Leave the glow rather than a frozen or half-drawn scene.
          broken = true;
          if (canvas) canvas.style.opacity = '0';
        }
      };
      const resize = () => {
        size();
        draw();
      };
      const running = () => !still && !broken && onScreen && !document.hidden;
      const loop = (now: number) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        time += dt * speed;
        const ease = 1 - Math.exp(-dt * 3);
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
        target.x = (event.clientX / Math.max(window.innerWidth, 1)) * 2 - 1;
        target.y = 1 - (event.clientY / Math.max(window.innerHeight, 1)) * 2;
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

      stop = () => {
        sleep();
        sizes.disconnect();
        views.disconnect();
        window.removeEventListener('pointermove', onPointer);
        document.removeEventListener('visibilitychange', onVisibility);
        scene.traverse((object) => {
          const mesh = object as Three.Mesh;
          mesh.geometry?.dispose();
          const material = mesh.material;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material?.dispose();
        });
        renderer.dispose();
      };
    };

    // Without WebGPU or WebGL 2 the box keeps its CSS glow, the fallback.
    start().catch(() => canvas?.remove());
    return () => {
      disposed = true;
      stop();
      canvas?.remove();
    };
    // themeKey: rebuilt in the new colors when the theme changes them.
  }, [colorKey, themeKey, speed, seed]);

  return boxRef;
}

export interface SceneProps {
  /** Extra classes for the box; it already fills its positioned parent. */
  className?: string;
  /** Up to four CSS colors; defaults to the project's color tokens. */
  colors?: readonly string[];
  /** 1 is the designed pace, 0 holds still. */
  speed?: number;
}

export interface ThreeSceneProps extends SceneProps {
  /**
   * Builds the scene into the stage once three.js has loaded, and again
   * when the colors or the theme change.
   */
  build: (stage: Stage) => SceneHandle;
  /** The CSS background shown until the scene draws, and without WebGL. */
  glow?: string;
  /** Seeds stage.random. */
  seed?: number;
}

const DEFAULT_GLOW =
  'radial-gradient(closest-side, color-mix(in oklab, var(--primary) 28%, transparent), transparent 75%)';

/** A three.js scene in a box that fills its positioned parent. */
export function ThreeScene({
  build,
  className = '',
  colors = DEFAULT_COLORS,
  speed = 1,
  glow = DEFAULT_GLOW,
  seed = 1,
}: ThreeSceneProps) {
  const boxRef = useThreeScene(build, colors, speed, seed);
  return (
    <div
      ref={boxRef}
      aria-hidden="true"
      className={'pointer-events-none absolute inset-0 ' + className}
      style={{ background: glow }}
    />
  );
}

/**
 * count points spread evenly over a sphere of radius 1 (a Fibonacci
 * lattice), as [x, y, z].
 */
export function spherePoints(count: number): [number, number, number][] {
  const points: [number, number, number][] = [];
  for (let i = 0; i < count; i += 1) {
    const y = count === 1 ? 0 : 1 - (i / (count - 1)) * 2;
    const ring = Math.sqrt(1 - y * y);
    const theta = i * 2.399963;
    points.push([Math.cos(theta) * ring, y, Math.sin(theta) * ring]);
  }
  return points;
}

/**
 * Smooth 3D value noise from -1 to 1, the same for the same point: for
 * terrain, drifting particles and surfaces that breathe.
 */
export function noise3(x: number, y: number, z: number): number {
  const hash = (i: number, j: number, k: number) => {
    let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 2147483587);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 2147483647.5 - 1;
  };
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const fz = Math.floor(z);
  const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const u = ease(x - fx);
  const v = ease(y - fy);
  const w = ease(z - fz);
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  const corner = (i: number, j: number, k: number) => hash(fx + i, fy + j, fz + k);
  return mix(
    mix(mix(corner(0, 0, 0), corner(1, 0, 0), u), mix(corner(0, 1, 0), corner(1, 1, 0), u), v),
    mix(mix(corner(0, 0, 1), corner(1, 0, 1), u), mix(corner(0, 1, 1), corner(1, 1, 1), u), v),
    w,
  );
}

/**
 * For a geometry whose positions an update moves (a breathing sphere):
 * call the returned function after geometry.computeVertexNormals() and the
 * seams where three.js repeats a vertex (a sphere's meridian and poles)
 * show no crease.
 */
export function mendSeams(geometry: Three.BufferGeometry): () => void {
  const position = geometry.getAttribute('position') as Three.BufferAttribute;
  const shared = new Map<string, number[]>();
  for (let i = 0; i < position.count; i += 1) {
    const key =
      position.getX(i).toFixed(4) + ',' + position.getY(i).toFixed(4) + ',' + position.getZ(i).toFixed(4);
    const group = shared.get(key);
    if (group) group.push(i);
    else shared.set(key, [i]);
  }
  const seams = [...shared.values()].filter((group) => group.length > 1);
  return () => {
    const normal = geometry.getAttribute('normal') as Three.BufferAttribute;
    for (const group of seams) {
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (const index of group) {
        nx += normal.getX(index);
        ny += normal.getY(index);
        nz += normal.getZ(index);
      }
      const length = Math.hypot(nx, ny, nz) || 1;
      for (const index of group) normal.setXYZ(index, nx / length, ny / length, nz / length);
    }
    normal.needsUpdate = true;
  };
}
`;

export const SCENE_EXAMPLES: readonly SceneExample[] = [
  {
    id: 'globe',
    looks:
      'A dotted globe turning slowly, with arcs of light traveling between points on it, tilting toward the pointer.',
    hints: [
      'globe',
      '3d earth',
      '3d planet',
      'spinning earth',
      'rotating earth',
    ],
    source: String.raw`import type * as Three from 'three/webgpu';

import {
  ThreeScene,
  spherePoints,
  type SceneHandle,
  type SceneProps,
  type Stage,
} from '@/components/scene/stage';

/**
 * A dotted globe that turns slowly, with arcs of light traveling between
 * points on it, tilting toward the pointer.
 */
export function Globe(props: SceneProps) {
  return (
    <ThreeScene
      {...props}
      build={buildGlobe}
      glow="radial-gradient(closest-side, color-mix(in oklab, var(--primary) 28%, transparent), transparent 75%)"
    />
  );
}

function buildGlobe({ THREE, scene, camera, palette, background, pointer, random }: Stage): SceneHandle {
  const [primary, accent, secondary, foreground] = palette as [
    Three.Color, Three.Color, Three.Color, Three.Color,
  ];
  const radius = 1.3;
  const globe = new THREE.Group();
  globe.rotation.z = 0.35;
  scene.add(globe);

  // The far side shows faintly through a sphere the color of the page.
  globe.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.985, 64, 48),
      new THREE.MeshBasicMaterial({
        color: background,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        toneMapped: false,
      }),
    ),
  );
  // A thin halo of the primary color around the rim.
  scene.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.14, 64, 48),
      new THREE.MeshBasicMaterial({
        color: primary,
        transparent: true,
        opacity: 0.06,
        side: THREE.BackSide,
        depthWrite: false,
        toneMapped: false,
      }),
    ),
  );

  // Dots spread evenly over the sphere; a smooth pattern raises "land".
  const count = 2600;
  const dots = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.011, 6),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }),
    count,
  );
  const placer = new THREE.Object3D();
  const color = new THREE.Color();
  spherePoints(count).forEach(([x, y, z], i) => {
    const land =
      Math.sin(x * 3.1 + 1.2) * Math.cos(y * 2.7 - 0.4) +
      Math.sin(z * 4.3 + x * 1.7) * 0.6;
    const isLand = land > 0.15;
    placer.position.set(x, y, z).multiplyScalar(radius);
    placer.lookAt(0, 0, 0);
    placer.scale.setScalar(isLand ? 1.25 : 0.7);
    placer.updateMatrix();
    dots.setMatrixAt(i, placer.matrix);
    color.copy(isLand ? foreground : secondary).lerp(primary, isLand ? 0.25 : 0.55);
    if (!isLand) color.lerp(background, 0.45);
    dots.setColorAt(i, color);
  });
  globe.add(dots);

  // Arcs between points, each a tube a moving window of which is drawn.
  const point = () => {
    const u = random() * 2 - 1;
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    return new THREE.Vector3(Math.cos(a) * r, u, Math.sin(a) * r);
  };
  const tubular = 64;
  const radial = 6;
  const arcs: { mesh: Three.Mesh; offset: number; length: number }[] = [];
  for (let i = 0; i < 7; i += 1) {
    const from = point();
    const to = point();
    if (from.angleTo(to) < 0.6) to.negate().lerp(from, 0.3).normalize();
    const lift = 0.06 + from.angleTo(to) * 0.1;
    const points: Three.Vector3[] = [];
    for (let s = 0; s <= 32; s += 1) {
      const t = s / 32;
      const p = from.clone().lerp(to, t).normalize();
      points.push(p.multiplyScalar(radius * (1 + Math.sin(Math.PI * t) * lift)));
    }
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), tubular, 0.0065, radial, false),
      new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? secondary : accent, toneMapped: false }),
    );
    globe.add(mesh);
    arcs.push({ mesh, offset: random() * 3, length: 2.2 + random() * 1.2 });
  }
  const perSegment = radial * 6;

  return {
    update(t) {
      globe.rotation.y = t * 0.12 + pointer.x * 0.35;
      globe.rotation.x = -pointer.y * 0.2;
      for (const arc of arcs) {
        // Grows from one end, holds, then drains from the other end.
        const phase = ((t + arc.offset) % (arc.length + 1.2)) / arc.length;
        const head = Math.min(1, phase * 1.6);
        const tail = Math.max(0, Math.min(1, (phase - 0.55) * 2.2));
        const start = Math.floor(tail * tubular);
        const end = Math.floor(head * tubular);
        arc.mesh.geometry.setDrawRange(start * perSegment, Math.max(0, end - start) * perSegment);
      }
    },
    fit(aspect) {
      camera.position.z = aspect < 1 ? 6.2 / aspect : 6.2;
    },
  };
}
`,
  },
  {
    id: 'floating-shapes',
    looks:
      "Glossy geometric shapes in the page's colors, floating and turning, leaning toward the pointer.",
    hints: [
      'floating shapes',
      'geometric shapes',
      '3d shapes',
      '3d objects',
      'abstract 3d',
      'playful 3d',
      'torus',
    ],
    source: String.raw`import type * as Three from 'three/webgpu';

import {
  ThreeScene,
  type SceneHandle,
  type SceneProps,
  type Stage,
} from '@/components/scene/stage';

/**
 * Glossy geometric shapes in the page's colors, floating and turning, the
 * whole group leaning toward the pointer.
 */
export function FloatingShapes(props: SceneProps) {
  return (
    <ThreeScene
      {...props}
      build={buildShapes}
      glow="radial-gradient(60% 55% at 50% 50%, color-mix(in oklab, var(--primary) 22%, transparent), transparent 75%)"
    />
  );
}

function buildShapes({ THREE, scene, camera, palette, pointer }: Stage): SceneHandle {
  const [primary, accent, secondary, foreground] = palette as [
    Three.Color, Three.Color, Three.Color, Three.Color,
  ];
  scene.add(new THREE.HemisphereLight(0xffffff, foreground.clone().multiplyScalar(0.25), 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(3, 4, 5);
  scene.add(key);
  const rim = new THREE.PointLight(accent, 40, 0, 2);
  rim.position.set(-3.5, -1.5, 2.5);
  scene.add(rim);
  const back = new THREE.PointLight(secondary, 30, 0, 2);
  back.position.set(3.5, -2, -1.5);
  scene.add(back);

  const material = (color: Three.Color) =>
    new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.26,
      metalness: 0.12,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
    });
  const shapes: [Three.BufferGeometry, Three.Color, [number, number, number]][] = [
    [new THREE.TorusKnotGeometry(0.42, 0.15, 180, 28), primary, [-1.7, 0.55, 0]],
    [new THREE.IcosahedronGeometry(0.58, 0), accent, [1.55, 0.75, -0.4]],
    [new THREE.TorusGeometry(0.42, 0.16, 32, 96), secondary, [0.15, -0.95, 0.5]],
    [new THREE.SphereGeometry(0.34, 48, 32), primary, [1.95, -0.85, 0.6]],
    [new THREE.OctahedronGeometry(0.4, 0), secondary, [-1.45, -1.05, -0.7]],
    [new THREE.CapsuleGeometry(0.2, 0.5, 8, 24), accent, [0.25, 1.25, -1]],
  ];
  const group = new THREE.Group();
  scene.add(group);
  const meshes = shapes.map(([geometry, color, position], index) => {
    const mesh = new THREE.Mesh(geometry, material(color));
    mesh.position.set(...position);
    mesh.rotation.set(index * 0.7, index * 1.3, 0);
    group.add(mesh);
    return { mesh, base: position[1], rate: 0.18 + (index % 3) * 0.08 };
  });

  return {
    update(t) {
      meshes.forEach(({ mesh, base, rate }, index) => {
        mesh.position.y = base + Math.sin(t * 0.7 + index * 1.7) * 0.12;
        mesh.rotation.x = index * 0.7 + t * rate;
        mesh.rotation.y = index * 1.3 + t * rate * 1.3;
      });
      group.rotation.y = pointer.x * 0.35;
      group.rotation.x = -pointer.y * 0.25;
    },
    fit(aspect) {
      camera.position.z = aspect < 1.5 ? (7 * 1.5) / aspect : 7;
    },
  };
}
`,
  },
  {
    id: 'dot-wave',
    looks:
      'A field of dots rolling like a sea toward a low horizon, rippling where the pointer is.',
    hints: [
      'dot wave',
      'particle wave',
      'wave of dots',
      'wave grid',
      '3d terrain',
      'wireframe terrain',
      'synthwave',
      'retrowave',
      'data wave',
    ],
    source: String.raw`import type * as Three from 'three/webgpu';

import {
  ThreeScene,
  noise3,
  type SceneHandle,
  type SceneProps,
  type Stage,
} from '@/components/scene/stage';

/**
 * A field of dots rolling like a sea toward a low horizon, rippling where
 * the pointer is.
 */
export function DotWave(props: SceneProps) {
  return (
    <ThreeScene
      {...props}
      build={buildWave}
      glow="radial-gradient(90% 60% at 50% 80%, color-mix(in oklab, var(--primary) 22%, transparent), transparent 75%)"
    />
  );
}

function buildWave({ THREE, scene, camera, palette, background, pointer }: Stage): SceneHandle {
  const [primary, accent] = palette as [Three.Color, Three.Color];
  scene.fog = new THREE.Fog(background, 5, 13);
  camera.position.set(0, 1.5, 6);
  camera.lookAt(0, -0.3, 0);

  const columns = 96;
  const rows = 44;
  const count = columns * rows;
  const dots = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.022, 6, 4),
    new THREE.MeshBasicMaterial({ toneMapped: false }),
    count,
  );
  dots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(dots);
  const placer = new THREE.Object3D();
  const color = new THREE.Color();
  const grid: [number, number][] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      grid.push([(column / (columns - 1) - 0.5) * 14, 2 - (row / (rows - 1)) * 10]);
    }
  }

  return {
    update(t) {
      const px = pointer.x * 4;
      const pz = 1 - pointer.y * 2.5;
      for (let i = 0; i < count; i += 1) {
        const [x, z] = grid[i]!;
        const d = Math.hypot(x - px, z - pz);
        const y =
          Math.sin(x * 0.55 + t * 0.9) * Math.cos(z * 0.45 + t * 0.6) * 0.32 +
          noise3(x * 0.35, z * 0.35, t * 0.25) * 0.18 +
          Math.exp(-d * d * 0.35) * Math.sin(d * 3 - t * 3) * 0.22 -
          0.6;
        placer.position.set(x, y, z);
        placer.updateMatrix();
        dots.setMatrixAt(i, placer.matrix);
        dots.setColorAt(i, color.copy(primary).lerp(accent, Math.min(1, Math.max(0, (y + 1) * 1.1))));
      }
      dots.instanceMatrix.needsUpdate = true;
      if (dots.instanceColor) dots.instanceColor.needsUpdate = true;
    },
    fit(aspect) {
      camera.fov = aspect < 1 ? 55 : 35;
    },
  };
}
`,
  },
  {
    id: 'liquid-orb',
    looks:
      "A liquid, iridescent orb in the page's colors that breathes and swells toward the pointer.",
    hints: [
      'orb',
      'iridescent sphere',
      'holographic sphere',
      'glossy sphere',
      'liquid orb',
      'liquid metal',
      'liquid chrome',
      'chrome orb',
      'chrome sphere',
      '3d blob',
    ],
    source: String.raw`import type * as Three from 'three/webgpu';

import {
  ThreeScene,
  mendSeams,
  type SceneHandle,
  type SceneProps,
  type Stage,
} from '@/components/scene/stage';

/**
 * A liquid, iridescent orb in the page's colors that breathes and swells
 * toward the pointer.
 */
export function LiquidOrb(props: SceneProps) {
  return (
    <ThreeScene
      {...props}
      build={buildOrb}
      glow="radial-gradient(closest-side, color-mix(in oklab, var(--primary) 35%, transparent), transparent 70%)"
    />
  );
}

function buildOrb({ THREE, scene, camera, palette, pointer }: Stage): SceneHandle {
  const [primary, accent, secondary] = palette as [Three.Color, Three.Color, Three.Color];
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2, 3, 4);
  scene.add(key);
  const left = new THREE.PointLight(accent, 45, 0, 2);
  left.position.set(-3, 1, 2);
  scene.add(left);
  const right = new THREE.PointLight(secondary, 45, 0, 2);
  right.position.set(3, -1.5, 1.5);
  scene.add(right);

  const radius = 1.2;
  // 64 by 48 is about 3,100 vertices, deformed on the CPU each frame:
  // smooth at this size, and light enough for a phone.
  const geometry = new THREE.SphereGeometry(radius, 64, 48);
  const position = geometry.getAttribute('position') as Three.BufferAttribute;
  const base = Float32Array.from(position.array as Float32Array);
  // A sphere repeats its seam and pole vertices; mended after each update.
  const mend = mendSeams(geometry);
  const orb = new THREE.Mesh(
    geometry,
    new THREE.MeshPhysicalMaterial({
      color: primary,
      roughness: 0.16,
      metalness: 0.25,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      iridescence: 1,
      iridescenceIOR: 1.35,
    }),
  );
  scene.add(orb);
  const toward = new THREE.Vector3();

  return {
    update(t) {
      toward.set(pointer.x, pointer.y, 0.6).normalize();
      for (let i = 0; i < position.count; i += 1) {
        const x = base[i * 3]! / radius;
        const y = base[i * 3 + 1]! / radius;
        const z = base[i * 3 + 2]! / radius;
        const swell = Math.max(0, x * toward.x + y * toward.y + z * toward.z);
        const s =
          1 +
          Math.sin(x * 2.6 + t * 0.9) * Math.sin(y * 2.2 + t * 1.1) * 0.09 +
          Math.sin(z * 3.4 - t * 1.3 + x * 1.8) * 0.06 +
          swell * swell * 0.08;
        position.setXYZ(i, x * radius * s, y * radius * s, z * radius * s);
      }
      position.needsUpdate = true;
      geometry.computeVertexNormals();
      mend();
      orb.rotation.y = t * 0.15;
    },
    fit(aspect) {
      camera.position.z = aspect < 1 ? 6 / aspect : 6;
    },
  };
}
`,
  },
];

/** Whether `path` is the stage, the one scene file Vibld writes. */
export function isScenePath(path: string): boolean {
  return path === STAGE_PATH;
}

/**
 * "3D" that names a business, not a look: a 3D printing service or a 3-D
 * scanner shop asks for no scene.
 */
const NOT_A_LOOK = /\b(?:3-?d|three[\s-]dimensional)[\s-]*(?:print|scan)\w*/gi;

/**
 * The examples a request names, or every one when it asks for 3D without
 * naming a subject, or none when it does not ask for 3D.
 */
export function selectScenes(promptText: string): readonly SceneExample[] {
  const text = promptText.replace(NOT_A_LOOK, ' ');
  const named = SCENE_EXAMPLES.filter((example) =>
    example.hints.some((hint) => mentions(text, hint)),
  );
  if (named.length > 0) return named;
  return ANY_SCENE.some((phrase) => mentions(text, phrase))
    ? SCENE_EXAMPLES
    : [];
}

/**
 * The one example the guidance shows: the first the request names, or one
 * picked by its text, so two requests for "a 3D hero" start from
 * different scenes. The same text always picks the same one.
 */
export function sceneExample(promptText: string): SceneExample | null {
  const offered = selectScenes(promptText);
  if (offered.length === 0) return null;
  if (offered.length < SCENE_EXAMPLES.length) return offered[0]!;
  let hash = 0;
  for (const char of promptText) {
    hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  }
  return offered[hash % offered.length]!;
}

/**
 * What a request is told about writing a 3D scene, or null when it asks
 * for none. Subordinate to the request, as every retrieved guidance in
 * this package is.
 */
export function sceneGuidance(promptText: string): string | null {
  const example = sceneExample(promptText);
  if (!example) return null;
  return [
    '3D SCENES',
    'Design the 3D scene for this site and write it yourself, on the stage the',
    'build provides. Make it about this subject and brand: its own forms,',
    'materials, motion and framing, not a stock globe or orb unless that is',
    'what fits. Where this conflicts with an instruction in the request above,',
    'follow the request.',
    '- The stage is ' + STAGE_PATH + ', written for you with three and',
    '  @types/three when a file imports it: never plan, write or edit it. It',
    '  exports ThreeScene, the types Stage, SceneHandle and SceneProps, and',
    '  helpers seeded(seed), spherePoints(count) (evenly spread [x, y, z] on a',
    '  unit sphere), noise3(x, y, z) (smooth, -1 to 1) and',
    '  mendSeams(geometry) (call its result after computeVertexNormals on a',
    '  sphere you deform).',
    '- Write the scene in its own file (such as src/components/HeroScene.tsx):',
    "  import type * as Three from 'three/webgpu' for types, import what you",
    "  use from '" + STAGE_IMPORT + "', and export a component that",
    '  returns <ThreeScene {...props} build={build} glow="..." />.',
    '- build({ THREE, scene, camera, palette, background, pointer, random })',
    '  runs once three.js has loaded. THREE is three.js itself: never import',
    '  three, three/webgpu or three/addons as a value. camera is a',
    '  PerspectiveCamera (fov 35) at (0, 0, 6) looking at the origin. palette',
    "  is four THREE.Color from the page's tokens (primary, accent, secondary,",
    '  foreground), background is the page background, pointer is eased from',
    '  -1 to 1, and random is seeded. It returns { update(t), fit(aspect) }:',
    '  update moves everything to time t in seconds, from t and pointer only;',
    '  fit keeps the subject framed in a box of that width over height.',
    '- Use the built-in materials: MeshStandardMaterial and',
    '  MeshPhysicalMaterial (with lights; a PointLight at about 3 units needs',
    '  an intensity of 20 to 60), MeshBasicMaterial, PointsMaterial and',
    '  LineBasicMaterial. Never ShaderMaterial or RawShaderMaterial (WebGPU',
    '  cannot run GLSL), never transmission (it renders dark), and no',
    '  textures, models or fonts loaded from a URL, no post-processing and no',
    '  controls. Build geometry from the built-in geometries and',
    '  BufferGeometry with BufferAttribute; draw many copies with',
    '  InstancedMesh or Points. Keep what update recomputes on the CPU under',
    '  about 20,000 vertices or instances.',
    '- The project type-checks with noUncheckedIndexedAccess: an indexed read',
    '  of an array or typed array needs a ! or a default.',
    '- The stage already handles loading, WebGPU with a WebGL 2 fallback, the',
    '  glow until it draws, pixel density, pausing off screen and in',
    '  background tabs, reduced motion, theme changes and disposal. Add',
    '  nothing for those.',
    '- It fills its nearest positioned ancestor: render it inside a box with',
    '  "relative" and a size (such as "relative aspect-square w-full" in a',
    '  hero column), or as the first child of a section with "relative',
    '  isolate overflow-hidden" and className="-z-10" to sit behind the',
    "  section's content. Keep text readable over it, with a scrim if needed.",
    "- Use at most one per page, and add it to the spec's motion table as an",
    '  "always" row.',
    'An example scene on the stage (' +
      example.looks.replace(/\.$/, '') +
      ') to learn the API from, not to copy:',
    example.source.trimEnd(),
  ].join('\n');
}

/** Whether the project's own files import the stage, by alias or path. */
export function importsStage(files: readonly ProjectFile[]): boolean {
  return files.some(
    (file) =>
      !isScenePath(file.path) &&
      /\.(tsx|ts|jsx|js)$/.test(file.path) &&
      importSpecifiers(file.content).some((specifier) =>
        /(?:^|\/)components\/scene\/stage(?:\.tsx?)?$/.test(
          importTarget(file.path, specifier),
        ),
      ),
  );
}

/** The stage, when the project's files import it. */
export function sceneFiles(files: readonly ProjectFile[]): ProjectFile[] {
  return importsStage(files)
    ? [{ path: STAGE_PATH, content: STAGE_SOURCE }]
    : [];
}
