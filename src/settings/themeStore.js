import { create } from "zustand"

export const useThemeStore = create((set) => ({
  dark: localStorage.getItem("theme") === "dark",

  toggle: () =>
    set((s) => {
      const next = !s.dark
      localStorage.setItem("theme", next ? "dark" : "light")
      return { dark: next }
    }),
}))
