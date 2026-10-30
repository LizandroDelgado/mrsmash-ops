'use client';
// Buscador de insumos con alta en línea: escribe, toca el resultado o "Crear" sin salir de la pantalla.
import { useState } from 'react';
import { Search, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { NEGOCIO_ID, vibrar, msgError } from '@/lib/negocio';
import { CATEGORIAS_INSUMO, UNIDADES_ALTA, UNIDAD_GRANDE, NOMBRE_CATEGORIA } from '@/lib/inventario';
import { C, Chips, Label, MontoInput, BotonPrincipal } from '@/components/ui';

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export default function BuscadorInsumos({
  insumos, excluir = [], recientes = [], onElegir, onCreado, permitirCrear = true,
  placeholder = 'Buscar insumo…',
}) {
  const [texto,     setTexto]     = useState('');
  const [creando,   setCreando]   = useState(false);
  const [categoria, setCategoria] = useState('otro');
  const [unidad,    setUnidad]    = useState('g');
  const [costo,     setCosto]     = useState('');
  const [guardando, setGuardando] = useState(false);

  const t = norm(texto);
  const disponibles = insumos.filter((i) => i.activo !== false && !excluir.includes(i.id));
  const resultados  = t ? disponibles.filter((i) => norm(i.nombre).includes(t)).slice(0, 6) : [];
  const existe      = insumos.some((i) => i.activo !== false && norm(i.nombre) === t);
  const chips       = t ? [] : recientes.filter((i) => !excluir.includes(i.id)).slice(0, 8);

  const elegir = (i) => {
    setTexto('');
    setCreando(false);
    onElegir(i);
  };

  const crear = async () => {
    if (!texto.trim()) return;
    setGuardando(true);
    const { data, error } = await supabase.from('insumos').insert({
      negocio_id:     NEGOCIO_ID,
      nombre:         texto.trim(),
      categoria,
      unidad_base:    unidad,
      costo_promedio: costo ? Number(costo) / UNIDAD_GRANDE[unidad].factor : 0,
    }).select().single();
    setGuardando(false);
    if (error) { alert(msgError(error)); return; }
    vibrar();
    setCosto('');
    onCreado?.(data);
    elegir(data);
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: C.dimmer }} />
        <input type="text" value={texto} placeholder={placeholder}
          onChange={(e) => { setTexto(e.target.value); setCreando(false); }}
          className="w-full pl-11 pr-4 py-3 rounded-xl text-ink outline-none"
          style={{ background: C.surface, border: `1px solid ${C.border}`, fontSize: 16, minHeight: 52 }} />
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chips.map((i) => (
            <button key={i.id} type="button" onClick={() => elegir(i)}
              className="px-4 rounded-full text-sm font-bold"
              style={{ background: C.surface2, color: 'var(--ink)', minHeight: 48, border: `1px solid ${C.border}` }}>
              {i.nombre}
            </button>
          ))}
        </div>
      )}

      {resultados.map((i) => (
        <button key={i.id} type="button" onClick={() => elegir(i)}
          className="w-full flex items-center justify-between px-4 rounded-xl text-left"
          style={{ background: C.surface, minHeight: 52, border: `1px solid ${C.border}` }}>
          <span className="font-bold text-ink truncate">{i.nombre}</span>
          <span className="text-xs ml-2 shrink-0" style={{ color: C.dimmer }}>
            {NOMBRE_CATEGORIA[i.categoria]} · {i.unidad_base}
          </span>
        </button>
      ))}

      {permitirCrear && t && !existe && !creando && (
        <button type="button" onClick={() => setCreando(true)}
          className="w-full flex items-center gap-2 px-4 rounded-xl font-bold text-left"
          style={{ background: `${C.brandSoft}`, color: C.brandText, minHeight: 52, border: `1px dashed ${C.brand}` }}>
          <Plus size={18} /> Crear «{texto.trim()}»
        </button>
      )}

      {creando && (
        <div className="rounded-2xl p-3 space-y-3" style={{ background: C.surface, border: `1px solid ${C.brand}` }}>
          <p className="font-bold text-ink">Nuevo insumo: {texto.trim()}</p>
          <div>
            <Label>SE MIDE EN</Label>
            <Chips options={UNIDADES_ALTA} value={unidad} onChange={setUnidad} />
          </div>
          <div>
            <Label>CATEGORÍA</Label>
            <Chips options={CATEGORIAS_INSUMO} value={categoria} onChange={setCategoria} wrap />
          </div>
          <div>
            <Label>COSTO POR {UNIDAD_GRANDE[unidad].label.toUpperCase()} (OPCIONAL)</Label>
            <MontoInput value={costo} onChange={setCosto} />
          </div>
          <BotonPrincipal onClick={crear} disabled={guardando}>
            {guardando ? 'Creando…' : 'Crear y agregar'}
          </BotonPrincipal>
        </div>
      )}
    </div>
  );
}
