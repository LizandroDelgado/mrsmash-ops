'use client';
// Lee los tokens de color de globals.css ya resueltos (Recharts pinta en atributos SVG, donde
// var(--…) no siempre se resuelve). Se recalcula si cambia el tema del sistema o data-theme.
import { useEffect, useState } from 'react';

const NOMBRES = {
  ink: 'ink', inkSoft: 'ink-soft', inkMute: 'ink-mute', line: 'line', paper: 'paper', paper2: 'paper-2',
  orange: 'orange', good: 'good', bad: 'bad', warn: 'warn',
  chWhatsapp: 'ch-whatsapp', chDidi: 'ch-didi', chSalon: 'ch-salon',
};

function leer() {
  const cs = getComputedStyle(document.documentElement);
  const t = Object.fromEntries(Object.entries(NOMBRES).map(([k, n]) => [k, cs.getPropertyValue(`--${n}`).trim()]));
  t.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return t;
}

export function useTokens() {
  const [t, setT] = useState(null);
  useEffect(() => {
    const actualizar = () => setT(leer());
    actualizar();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', actualizar);
    const obs = new MutationObserver(actualizar);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { mq.removeEventListener('change', actualizar); obs.disconnect(); };
  }, []);
  return t;
}
