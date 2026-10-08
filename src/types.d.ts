declare module 'liquid-gl' {
  const liquidGL: (options: Record<string, unknown>) => unknown;
  export default liquidGL;
}
declare module 'virtual:pwa-register' {
  export function registerSW(options?: { immediate?: boolean; onNeedRefresh?: () => void; onOfflineReady?: () => void }): (reload?: boolean) => Promise<void>;
}
