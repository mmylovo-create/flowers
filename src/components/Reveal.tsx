import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Fades a section in when it scrolls into view. Respects "reduce motion". */
export function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() =>
    typeof window === 'undefined' || !('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (visible || !ref.current) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [visible]);
  return (
    <div ref={ref} className={`reveal${visible ? ' is-visible' : ''}`} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}
