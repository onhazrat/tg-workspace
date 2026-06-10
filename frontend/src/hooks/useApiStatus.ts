import { useState, useEffect, useCallback } from "react";
import { api } from "@/api";

import { env } from "@/lib/env";

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
    const id = setInterval(checkHealth, env.apiHealthPollMs);
    return () => clearInterval(id);
  }, [checkHealth]);

  return { isOnline, isOffline: !isOnline, checkHealth };
}
