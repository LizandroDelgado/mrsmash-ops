import { create } from 'zustand';

export const useAppStore = create((set, get) => ({
  // Negocio del usuario logueado
  negocio: null,
  setNegocio: (negocio) => set({ negocio }),

  // Productos del menú
  productos: [],
  setProductos: (productos) => set({ productos }),

  // Pedidos del día
  pedidosHoy: [],
  setPedidosHoy: (pedidos) => set({ pedidosHoy: pedidos }),
  updatePedidoEstado: (id, estado) =>
    set((state) => ({
      pedidosHoy: state.pedidosHoy.map((p) =>
        p.id === id ? { ...p, estado } : p
      ),
    })),
  addPedido: (pedido) =>
    set((state) => ({ pedidosHoy: [pedido, ...state.pedidosHoy] })),
}));
