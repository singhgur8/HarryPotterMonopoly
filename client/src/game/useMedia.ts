import { useEffect, useState } from "react";

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatch(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return match;
}

/** Matches the phone breakpoint in table.css. */
export const usePhone = () => useMedia("(max-width: 860px)");
/** Tall enough screens get the big hand cards. */
export const useTall = () => useMedia("(min-height: 1000px)");
