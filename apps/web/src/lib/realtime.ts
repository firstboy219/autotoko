import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { getToken } from "./api";

let socket: Socket | null = null;

/** Shared same-origin socket.io connection (nginx proxies /socket.io/ → API). */
function getSocket(): Socket | null {
  const token = getToken();
  if (!token) return null;
  if (!socket) {
    socket = io({
      path: "/socket.io",
      transports: ["websocket"],
      auth: { token },
      reconnection: true,
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

/** Live connection status for the dashboard indicator. */
export function useConnectionStatus(): boolean {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    setConnected(s.connected);
    const on = () => setConnected(true);
    const off = () => setConnected(false);
    s.on("connect", on);
    s.on("disconnect", off);
    return () => {
      s.off("connect", on);
      s.off("disconnect", off);
    };
  }, []);
  return connected;
}

type RealtimeHandler = (type: "new_order" | "order_update", data: unknown) => void;

/** Subscribe to live order events. Multiple callers share one connection. */
export function useRealtime(handler: RealtimeHandler): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onNew = (d: unknown) => ref.current("new_order", d);
    const onUpd = (d: unknown) => ref.current("order_update", d);
    s.on("new_order", onNew);
    s.on("order_update", onUpd);
    return () => {
      s.off("new_order", onNew);
      s.off("order_update", onUpd);
    };
  }, []);
}
