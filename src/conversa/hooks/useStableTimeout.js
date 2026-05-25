import { useCallback, useEffect, useRef } from "react";

export function useStableTimeout() {
  const ref = useRef(null);
  const clear = useCallback(() => {
    if (ref.current) {
      clearTimeout(ref.current);
      ref.current = null;
    }
  }, []);
  const set = useCallback(
    (fn, ms) => {
      clear();
      ref.current = setTimeout(fn, ms);
    },
    [clear]
  );

  useEffect(() => clear, [clear]);
  return { set, clear };
}
