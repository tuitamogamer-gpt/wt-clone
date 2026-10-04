import { useCallback, useEffect, useRef, useState } from "react";

export type ServiceState = "checking" | "ready" | "unavailable" | "offline";

export function useTransferService() {
  const [state, setState] = useState<ServiceState>("checking");
  const request = useRef<AbortController | null>(null);
  const check = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (!navigator.onLine) {
      setState("offline");
      return;
    }
    setState("checking");
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch("/api/config", {
        signal: controller.signal,
        cache: "no-store",
      });
      const config = await response.json();
      if (request.current === controller) {
        setState(
          response.ok && ["local", "blob"].includes(config.uploadMode)
            ? "ready"
            : "unavailable",
        );
      }
    } catch {
      if (request.current === controller)
        setState(navigator.onLine ? "unavailable" : "offline");
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    void check();
    const offline = () => {
      request.current?.abort();
      request.current = null;
      setState("offline");
    };
    window.addEventListener("online", check);
    window.addEventListener("offline", offline);
    return () => {
      request.current?.abort();
      request.current = null;
      window.removeEventListener("online", check);
      window.removeEventListener("offline", offline);
    };
  }, [check]);
  return { state, check };
}
