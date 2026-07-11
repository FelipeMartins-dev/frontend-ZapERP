import { forwardRef, memo, useEffect, useLayoutEffect, useRef, useState } from "react";

function useDebounce(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/**
 * Busca isolada da lista: digitação não re-renderiza o ChatList inteiro;
 * o termo debounced sobe para filtro local via onDebounced.
 */
export const ChatListSearchBox = memo(
  forwardRef(function ChatListSearchBox({ onDebounced, clearNonce, className, placeholder }, ref) {
    const [value, setValue] = useState("");
    const debounced = useDebounce(value, 180);
    const onDebouncedRef = useRef(onDebounced);
    onDebouncedRef.current = onDebounced;
    useEffect(() => {
      onDebouncedRef.current(debounced);
    }, [debounced]);

    useLayoutEffect(() => {
      setValue("");
    }, [clearNonce]);

    return (
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
    );
  })
);
