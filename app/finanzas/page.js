'use client';
// Finanzas se unificó en /dashboard (Fase 3): un solo lugar de análisis.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function FinanzasPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/dashboard'); }, [router]);
  return null;
}
