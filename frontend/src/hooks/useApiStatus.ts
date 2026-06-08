import { useState, useEffect, useCallback } from "react";
import { api } from "@/api";

const POLL_INTERVAL_MS = 30_000;

export function useApiStatus() {
  const [isOnline, setIsOnline] = useState(true);

  const checkHealth = useCallback(async () => {
    try {
      await api.healthCheck();
      setIsOnline(true);
      return true;
    } catch {
      setIsOnline(false);
      return false;
    }
  }, []);

  useEffect(() => {
    checkHealth();
    const id = setInterval(checkHealth, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [checkHealth]);

  return { isOnline, isOffline: !isOnline, checkHealth };
}
