import { create } from "zustand";
import { fetchWhatsappInstancesAtendimento } from "./whatsappInstancesService";

export const useWhatsappInstancesStore = create((set, get) => ({
  instances: [],
  hasMultiple: false,
  loaded: false,
  loading: false,

  load: async (force = false) => {
    if (!force && (get().loaded || get().loading)) return get();
    set({ loading: true });
    try {
      const result = await fetchWhatsappInstancesAtendimento({ silent: true });
      set({
        instances: result.instances || [],
        hasMultiple: result.hasMultipleWhatsappInstances === true,
        loaded: true,
        loading: false,
      });
    } catch {
      set({ instances: [], hasMultiple: false, loaded: true, loading: false });
    }
    return get();
  },

  reset: () =>
    set({ instances: [], hasMultiple: false, loaded: false, loading: false }),
}));
