// Real refracting glass via liquid-gl (WebGPU → WebGL, CSS blur as its own fallback).
// `snapshot` limits what the lens refracts: the hero button only sees the hero photo,
// so text from other sections never shows up inside it while scrolling.
import { useEffect, type RefObject } from 'react';

type Lens = { destroy?: () => void };
let counter = 0;

export interface GlassOptions {
  snapshot: string;
  zIndex: number;
  /** re-create the lens when this changes (e.g. after a photo loads) */
  key?: string | number;
  resolution?: number;
  /** white dye strength: more = calmer glass behind busy content */
  tint?: number;
  /** create the lens only while the element is on screen */
  onlyWhenVisible?: boolean;
}

/** Software-rendered WebGL (no GPU) can't run the lens smoothly: keep the CSS glass there.
 *  `?glass=force` in the address forces the real lens anyway (for checks). */
let softwareGpu: boolean | null = null;
export function glassMode(): 'gl' | 'css' {
  if (typeof window === 'undefined') return 'css';
  if (new URLSearchParams(location.search).get('glass') === 'force') return 'gl';
  if (softwareGpu === null) {
    try {
      const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      const renderer = gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : gl ? '' : 'none';
      softwareGpu = renderer === 'none' || /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      softwareGpu = true;
    }
  }
  return softwareGpu ? 'css' : 'gl';
}

function imagesReady(root: Element | null): Promise<void> {
  if (!root) return Promise.resolve();
  const imgs = Array.from(root.querySelectorAll('img')).filter((i) => !i.complete);
  return Promise.all(imgs.map((i) => new Promise<void>((r) => { i.addEventListener('load', () => r(), { once: true }); i.addEventListener('error', () => r(), { once: true }); }))).then(() => undefined);
}

export function useLiquidGlass(ref: RefObject<HTMLElement | null>, opts: GlassOptions) {
  const { snapshot, zIndex, key, resolution, tint, onlyWhenVisible } = opts;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === 'undefined') return;
    if ((window as unknown as { __NO_LIQUID_GL__?: boolean }).__NO_LIQUID_GL__ || glassMode() === 'css') return;
    const cls = `lg-${++counter}`;
    el.classList.add(cls);
    let lens: Lens | Lens[] | undefined;
    let cancelled = false;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let starting = false;
    const start = async () => {
      if (starting || lens) return;
      starting = true;
      try {
        await startLens();
      } finally {
        starting = false;
      }
    };
    const startLens = async () => {
      await imagesReady(document.querySelector(snapshot));
      if (cancelled) return;
      const { default: liquidGL } = await import('liquid-gl');
      if (cancelled || !liquidGL || lens) return;
      try {
        lens = liquidGL({
          target: `.${cls}`,
          snapshot,
          // only the lens draws the glass: the button text stays real, crisp DOM text
          content: false,
          resolution: resolution ?? Math.min(2, window.devicePixelRatio || 1),
          zIndex,
          refraction: 0.012,
          bevelDepth: 0.06,
          bevelWidth: 0.22,
          frost: 2,
          shadow: true,
          specular: !reduce,
          reveal: reduce ? 'none' : 'fade',
          tilt: false,
          tint: `rgba(255, 255, 255, ${tint ?? 0.18})`,
          on: { init: () => el.classList.add('glass--gl') },
        }) as Lens | Lens[];
      } catch (e) {
        console.warn('glass effect unavailable', e);
      }
    };
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const destroy = () => {
      const all = Array.isArray(lens) ? lens : lens ? [lens] : [];
      for (const l of all) l.destroy?.();
      lens = undefined;
      el.classList.remove('glass--gl');
    };
    let io: IntersectionObserver | null = null;
    if (onlyWhenVisible && 'IntersectionObserver' in window) {
      // a lens that scrolled away costs GPU time for nothing: drop it, bring it back on return
      io = new IntersectionObserver(([e]) => {
        if (e.isIntersecting && !lens) void start();
        else if (!e.isIntersecting && lens) destroy();
      });
      io.observe(el);
    } else if (idle) idle(() => void start(), { timeout: 800 });
    else setTimeout(() => void start(), 200);
    return () => {
      io?.disconnect();
      cancelled = true;
      el.classList.remove(cls);
      destroy();
    };
  }, [ref, snapshot, zIndex, key, resolution, tint, onlyWhenVisible]);
}
