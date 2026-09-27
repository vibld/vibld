import { useEffect, useRef } from 'react';

import { GLOW, MOODS, type GlowTheme, type SourceId } from '../glow-palette';

/**
 * The hero's light: soft orbs of ember, amber and teal on the page's ground,
 * bent towards the pointer, drawn with WebGL.
 *
 * It is decoration and is built to be skippable. The hero's own CSS gradient
 * is the picture everyone gets first; this canvas starts transparent and only
 * fades in after it has drawn a frame. So with JavaScript off, without WebGL,
 * with a lost GPU context, or with reduced motion requested, the reader sees
 * the static gradient and loses nothing. The loop stops whenever the hero is
 * off screen or the tab is hidden, and the canvas never takes pointer events,
 * so it cannot get in the way of reading or clicking.
 */
export function GlowField({ source }: { source: SourceId }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const mood = useRef(source);
  mood.current = source;

  useEffect(() => {
    const cv = canvas.current;
    const hero = cv?.parentElement;
    if (!cv || !hero) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const dark = window.matchMedia('(prefers-color-scheme: dark)');
    let field: Field | null = null;

    function sync() {
      if (reduce.matches) {
        field?.destroy();
        field = null;
        return;
      }
      if (!field) field = createField(cv!, hero!, mood);
      field?.setTheme(dark.matches ? GLOW.dark : GLOW.light);
    }

    sync();
    reduce.addEventListener('change', sync);
    dark.addEventListener('change', sync);
    return () => {
      reduce.removeEventListener('change', sync);
      dark.removeEventListener('change', sync);
      field?.destroy();
    };
  }, []);

  return <canvas ref={canvas} className="glow-canvas" aria-hidden="true" />;
}

interface Field {
  setTheme(theme: GlowTheme): void;
  destroy(): void;
}

const VERTEX = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';

/*
 * Every colour the fragment shader writes is `mix(ground, tint, a)`, where
 * `tint` is a weighted average of the three mood colours (a blend of the
 * palette) and `a` never exceeds `strength`. The contrast test relies on
 * exactly that shape, so keep it if you change the look.
 */
const FRAGMENT = `
precision highp float;
uniform vec2 r;
uniform float t;
uniform vec2 m;
uniform float mi;
uniform vec3 ground;
uniform vec3 cA;
uniform vec3 cB;
uniform vec3 cC;
uniform float strength;
uniform float grain;

float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){
  vec2 i=floor(p),f=fract(p);
  vec2 u=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1.,0.)),u.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),u.x),u.y);
}
float fbm(vec2 p){
  float v=0.,a=.5;
  for(int i=0;i<4;i++){v+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}
  return v;
}

void main(){
  vec2 uv=gl_FragCoord.xy/r;
  float asp=r.x/r.y;
  vec2 sc=vec2(asp,1.);
  vec2 p=(uv-.5)*sc;
  vec2 mp=(m-.5)*sc;
  vec2 d=p-mp;
  float dist=length(d);
  float R=.36*clamp(asp,.62,1.);

  // The pointer pushes the field outwards and swirls it a little.
  float infl=exp(-dist*dist/(R*R*.55))*mi;
  p+=normalize(d+1e-4)*infl*.14;
  p+=vec2(-d.y,d.x)*infl*.30;

  float tt=t*.07;
  vec2 q=vec2(fbm(p*1.5+vec2(0.,tt)),fbm(p*1.5+vec2(4.1,-tt)));
  vec2 w=p+(q-.5)*.6;

  vec2 o1=(vec2(.14+.07*sin(tt*3.1),.74+.08*cos(tt*2.3))-.5)*sc;
  vec2 o2=(vec2(.86+.06*cos(tt*2.7),.64+.09*sin(tt*3.4))-.5)*sc;
  vec2 o3=(vec2(.60+.14*sin(tt*1.9),.10+.06*cos(tt*2.9))-.5)*sc;
  vec2 o4=(vec2(.30+.10*cos(tt*2.2),.26+.07*sin(tt*1.7))-.5)*sc;
  float g1=exp(-dot(w-o1,w-o1)/(R*R));
  float g2=exp(-dot(w-o2,w-o2)/(R*R*.9));
  float g3=exp(-dot(w-o3,w-o3)/(R*R*1.2));
  float g4=exp(-dot(w-o4,w-o4)/(R*R*.7))*.6;
  float cl=exp(-dist*dist/(R*R*.28))*mi*.8;

  float sum=g1+g2+g3+g4+cl+1e-4;
  vec3 tint=(cA*(g1+cl)+cB*g2+cC*g3+mix(cA,cC,.5)*g4)/sum;

  float a=clamp(g1*.95+g2*.85+g3*.85+g4+cl,0.,1.);
  a*=.82+.18*smoothstep(.3,.8,fbm(w*2.4+q*1.6+tt*1.5));

  // Keep the middle, where the headline sits, a little calmer.
  vec2 cc=(uv-vec2(.5,.56))*vec2(1.6,2.);
  a*=1.-exp(-dot(cc,cc)*2.4)*.4;

  vec3 col=mix(ground,tint,a*strength);
  col+=(h(gl_FragCoord.xy+fract(t))-.5)*2.*grain;
  gl_FragColor=vec4(col,1.);
}
`;

function rgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1, 7), 16);
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ];
}

function createField(
  cv: HTMLCanvasElement,
  hero: HTMLElement,
  mood: { current: SourceId },
): Field | null {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = cv.getContext('webgl', { antialias: false, alpha: false });
  } catch {
    gl = null;
  }
  if (!gl) return null;

  const program = gl.createProgram();
  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  if (!program || !vs || !fs) return null;
  gl.shaderSource(vs, VERTEX);
  gl.compileShader(vs);
  gl.shaderSource(fs, FRAGMENT);
  gl.compileShader(fs);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  // One triangle that covers the whole viewport.
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  const position = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const u = (name: string) => gl!.getUniformLocation(program, name);
  const U = {
    r: u('r'),
    t: u('t'),
    m: u('m'),
    mi: u('mi'),
    ground: u('ground'),
    cA: u('cA'),
    cB: u('cB'),
    cC: u('cC'),
    strength: u('strength'),
    grain: u('grain'),
  };

  let theme = GLOW.light;
  const current = { a: [0, 0, 0], b: [0, 0, 0], c: [0, 0, 0] };
  let primed = false;

  function target() {
    const [a, b, c] = MOODS[mood.current];
    return {
      a: rgb(theme.palette[a]!),
      b: rgb(theme.palette[b]!),
      c: rgb(theme.palette[c]!),
    };
  }

  const pointer = { x: 0.7, y: 0.4, tx: 0.7, ty: 0.4, i: 0, ti: 0.7 };
  let inside = false;
  function onMove(event: PointerEvent) {
    const box = hero.getBoundingClientRect();
    pointer.tx = (event.clientX - box.left) / box.width;
    pointer.ty = (event.clientY - box.top) / box.height;
    pointer.ti = 1;
    inside = true;
  }
  function onLeave() {
    inside = false;
    pointer.ti = 0.7;
  }
  hero.addEventListener('pointermove', onMove);
  hero.addEventListener('pointerleave', onLeave);

  // Rendered at half resolution: the field is all soft gradients, and a
  // quarter of the pixels is a quarter of the GPU time on a laptop battery.
  const SCALE = 0.5;
  const started = performance.now();
  let frame = 0;
  let onScreen = true;
  let alive = true;

  function draw(now: number) {
    frame = 0;
    if (!alive || !onScreen || document.hidden) return;
    const time = 12 + (now - started) / 1000;
    const width = Math.max(1, Math.round(cv.clientWidth * SCALE));
    const height = Math.max(1, Math.round(cv.clientHeight * SCALE));
    if (cv.width !== width || cv.height !== height) {
      cv.width = width;
      cv.height = height;
      gl!.viewport(0, 0, width, height);
    }

    // With no pointer over the hero, a slow figure of eight stands in for
    // one, so keyboard and touch readers still see the field move.
    if (!inside) {
      pointer.tx = 0.68 + Math.sin(time * 0.21) * 0.2;
      pointer.ty = 0.38 + Math.cos(time * 0.29) * 0.16;
    }
    pointer.x += (pointer.tx - pointer.x) * 0.06;
    pointer.y += (pointer.ty - pointer.y) * 0.06;
    pointer.i += (pointer.ti - pointer.i) * 0.05;

    const goal = target();
    for (const key of ['a', 'b', 'c'] as const) {
      for (let j = 0; j < 3; j++) {
        current[key][j] = primed
          ? current[key][j]! + (goal[key][j]! - current[key][j]!) * 0.035
          : goal[key][j]!;
      }
    }
    primed = true;

    gl!.uniform2f(U.r, width, height);
    gl!.uniform1f(U.t, time);
    gl!.uniform2f(U.m, pointer.x, 1 - pointer.y);
    gl!.uniform1f(U.mi, pointer.i);
    gl!.uniform3fv(U.ground, rgb(theme.ground));
    gl!.uniform3fv(U.cA, current.a);
    gl!.uniform3fv(U.cB, current.b);
    gl!.uniform3fv(U.cC, current.c);
    gl!.uniform1f(U.strength, theme.strength);
    gl!.uniform1f(U.grain, theme.grain);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);

    cv.classList.add('is-live');
    frame = requestAnimationFrame(draw);
  }

  function resume() {
    if (alive && !frame && onScreen && !document.hidden) {
      frame = requestAnimationFrame(draw);
    }
  }

  const observer =
    'IntersectionObserver' in window
      ? new IntersectionObserver((entries) => {
          onScreen = entries[0]?.isIntersecting ?? true;
          resume();
        })
      : null;
  observer?.observe(hero);
  document.addEventListener('visibilitychange', resume);

  // A lost context (a driver reset, a backgrounded mobile tab) hands the
  // hero back to its CSS gradient rather than leaving a frozen frame.
  function onLost(event: Event) {
    event.preventDefault();
    destroy();
  }
  cv.addEventListener('webglcontextlost', onLost);

  function destroy() {
    alive = false;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    observer?.disconnect();
    document.removeEventListener('visibilitychange', resume);
    hero.removeEventListener('pointermove', onMove);
    hero.removeEventListener('pointerleave', onLeave);
    cv.removeEventListener('webglcontextlost', onLost);
    cv.classList.remove('is-live');
  }

  resume();

  return {
    setTheme(next) {
      theme = next;
      primed = false;
    },
    destroy,
  };
}
