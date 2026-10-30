// Etiquetas visibles de los canales de venta. La clave es el valor guardado en la base
// ('salon' sigue siendo 'salon'); cambiar cómo se llama un canal en la app es editar sólo aquí.
export const CANAL_LABEL = { whatsapp: 'WhatsApp', salon: 'Local', didi: 'Didi', manual: 'Manual' };

// Versión corta para chips estrechos (lista de pedidos)
export const CANAL_CORTO = { ...CANAL_LABEL, whatsapp: 'WA' };

// Canales que se capturan hoy, en el orden en que se muestran
export const CANALES = ['whatsapp', 'salon', 'didi'].map((key) => ({ key, label: CANAL_LABEL[key] }));

export const canalLabel = (canal) => CANAL_LABEL[canal] || canal;
