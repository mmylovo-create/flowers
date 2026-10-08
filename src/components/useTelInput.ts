import { useEffect, useRef } from 'react';

/** Phone keyboard on mobiles for an Astryx TextInput. */
export function useTelInput() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.setAttribute('inputmode', 'tel');
    ref.current?.setAttribute('type', 'tel');
  }, []);
  return ref;
}
