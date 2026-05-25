# MR. SMASH — Ops PWA

Dashboard de operaciones para MR. SMASH burgers & shakes.

## Stack
- Next.js 14 (App Router)
- Supabase (PostgreSQL + Realtime)
- Tailwind CSS
- PWA (instalable en Android)

---

## Setup local

### 1. Instalar dependencias
```bash
npm install
```

### 2. Variables de entorno
```bash
cp .env.example .env.local
```

Edita `.env.local` con tus valores de Supabase:
```env
NEXT_PUBLIC_SUPABASE_URL=https://effxuvviyhaksllmcrqh.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_anon_key
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
```

La anon key y service role key las encuentras en:  
**Supabase → Project Settings → API**

### 3. Correr en desarrollo
```bash
npm run dev
```

---

## Deploy en Vercel

### Opción A — Desde el dashboard de Vercel (recomendado)

1. Sube este código a GitHub
2. Ve a [vercel.com](https://vercel.com) → **New Project**
3. Importa el repo de GitHub
4. En **Environment Variables**, agrega:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Click **Deploy**

### Opción B — Vercel CLI
```bash
npm i -g vercel
vercel --prod
```

---

## Instalar como PWA en Android

1. Abrir la URL de Vercel en Chrome
2. Tocar el menú (⋮) → **"Agregar a pantalla de inicio"**
3. Confirmar → aparece el ícono en el home

---

## Estructura de archivos

```
app/
  page.js              → Home: cola de pedidos del día
  nuevo-pedido/        → Registrar nuevo pedido
  insumos/             → Registrar compras de insumos
  finanzas/            → Dashboard de ganancia real
  importar/            → Importar Excel de Didi
  api/
    pedidos/           → POST crear pedido, PATCH cambiar estado, DELETE eliminar
    insumos/           → POST registrar compra, DELETE eliminar
    importar-didi/     → POST procesar Excel de Didi

components/
  BottomNav.js         → Navegación inferior

lib/
  supabase/client.js   → Cliente de Supabase
  parsers/didiParser.js→ Parser del Excel de Didi Food
  calculos.js          → Funciones de cálculo financiero

store/
  index.js             → Zustand store global
```

---

## Supabase — GRANTs requeridos

Ejecutar en **Supabase → SQL Editor** del proyecto `effxuvviyhaksllmcrqh`:

```sql
-- El archivo completo está en supabase/grants.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON pedidos           TO anon;
GRANT SELECT, INSERT, DELETE         ON pedido_items      TO anon;
GRANT SELECT, INSERT, DELETE         ON compras_insumos   TO anon;
GRANT SELECT, INSERT                 ON productos         TO anon;
GRANT SELECT, INSERT, DELETE         ON importaciones_didi TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
```

> Las API routes del servidor (`/api/*`) usan `SUPABASE_SERVICE_ROLE_KEY` y no
> necesitan estos GRANTs, pero aplicarlos permite que el cliente funcione
> aunque haya un problema con la variable de entorno en Vercel.

---

## Notas importantes

- **Íconos PWA**: Necesitas crear `/public/icon-192.png` y `/public/icon-512.png` con el logo de MR. SMASH
- **negocio_id**: El `negocio_id` se obtiene automáticamente del primer negocio en la base de datos
- **Retenciones fiscales**: El parser de Didi asume persona física por defecto (con IVA e ISR retenidos)
- **Columnas del Excel**: Los nombres exactos pueden variar. Si falla la importación, revisar `lib/parsers/didiParser.js` y ajustar los nombres en el array `get([...])`
