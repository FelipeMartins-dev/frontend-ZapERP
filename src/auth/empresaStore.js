import { create } from 'zustand'
import { getEmpresa } from '../api/configService'

/**
 * Store global com dados básicos da empresa logada.
 * Carregado uma vez após autenticação; atualizado quando o admin salva configurações.
 */
export const useEmpresaStore = create((set, get) => ({
  empresa: null,
  loaded: false,

  fetchEmpresa: async () => {
    if (get().loaded) return
    try {
      const data = await getEmpresa()
      set({ empresa: data, loaded: true })
    } catch (_) {
      set({ loaded: true })
    }
  },

  setEmpresa: (empresa) => set({ empresa, loaded: true }),

  setLogoUrl: (logo_url) =>
    set((s) => ({
      empresa: s.empresa ? { ...s.empresa, logo_url } : { logo_url },
    })),

  clear: () => set({ empresa: null, loaded: false }),
}))
