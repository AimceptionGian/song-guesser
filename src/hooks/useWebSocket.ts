import { useState, useEffect, useCallback, useRef } from 'react';

interface WebSocketMessage {
  type: string;
  payload: unknown;
  timestamp: number;
}

interface UseWebSocketReturn {
  send: (msg: Omit<WebSocketMessage, 'timestamp'>) => void;
  lastMessage: WebSocketMessage | null;
  isConnected: boolean;
  error: string | null;
  reconnect: () => void;
}

/**
 * WebSocket hook that connects to the MatchRoom Durable Object.
 * Falls back to mock mode when the backend is not available.
 */
export function useWebSocket(
  lobbyId: string | null,
  playerId?: string
): UseWebSocketReturn {
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const intentionalCloseRef = useRef(false);
  const isMockRef = useRef(false);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!lobbyId) return;

    // Clean up previous connection
    if (wsRef.current) {
      intentionalCloseRef.current = true;
      wsRef.current.close();
      wsRef.current = null;
    }

    // DO WebSockets are incompatible with Vite WS proxy — connect directly to Worker
    const WS_BASE = import.meta.env.VITE_WS_BASE || (
      window.location.port === '3000' || window.location.port === '3001' || window.location.port === '3002'
        ? `${window.location.hostname}:8787`
        : `${window.location.hostname}:${window.location.port}`
    );
    const wsProtocol = import.meta.env.VITE_WS_BASE ? 'wss:' : (window.location.protocol === 'https:' ? 'wss:' : 'ws:');
    const wsUrl = `${wsProtocol}//${WS_BASE}/api/ws/${lobbyId}${playerId ? `?playerId=${playerId}` : ''}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return; }
        setIsConnected(true);
        setError(null);
        isMockRef.current = false;
        intentionalCloseRef.current = false;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WebSocketMessage;
          setLastMessage(msg);
        } catch {
          // ignore non-JSON messages
        }
      };

      ws.onerror = () => {
        // Will trigger onclose
      };

      ws.onclose = () => {
        setIsConnected(false);
        if (wsRef.current === ws && mountedRef.current && !intentionalCloseRef.current) {
          // Auto-reconnect after 3s
          reconnectRef.current = window.setTimeout(() => {
            if (mountedRef.current) connect();
          }, 3000);
        }
      };
    } catch {
      setIsConnected(true);
      setError(null);
      isMockRef.current = true;
    }
  }, [lobbyId, playerId]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      intentionalCloseRef.current = true;
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  const send = useCallback((msg: Omit<WebSocketMessage, 'timestamp'>) => {
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          ...msg,
          timestamp: Date.now(),
        }));
      } else if (wsRef.current.readyState === WebSocket.CONNECTING) {
        // Queue message until connection is open
        const checkReady = setInterval(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            clearInterval(checkReady);
            wsRef.current.send(JSON.stringify({
              ...msg,
              timestamp: Date.now(),
            }));
          }
        }, 50);
        // Stop trying after 5s
        setTimeout(() => clearInterval(checkReady), 5000);
      }
    } else if (isMockRef.current) {
      console.log('📤 WS Mock Send:', msg);
    }
  }, []);

  const reconnect = useCallback(() => {
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
    }
    connect();
  }, [connect]);

  return { send, lastMessage, isConnected, error, reconnect };
}

export default useWebSocket;
