// Small Socket.IO-style client over a plain WebSocket at /ws: on, emit, volatile.emit, id,
// connect/disconnect events and automatic reconnect. Messages are JSON [event, data].
const RETRY_MIN_MS = 500;
const RETRY_MAX_MS = 5000;

export function io({ url, autoConnect = true } = {}) {
  const target = url || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
  const handlers = new Map();
  let ws = null;
  let retryMs = RETRY_MIN_MS;
  let closed = false;
  let queue = [];

  const fire = (event, data) => {
    for (const fn of handlers.get(event) || []) fn(data);
  };

  const socket = {
    id: null,
    connected: false,
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(fn);
      return socket;
    },
    off(event, fn) {
      handlers.set(event, (handlers.get(event) || []).filter((h) => h !== fn));
      return socket;
    },
    // Queued while disconnected and sent on the next connect.
    emit(event, data) {
      const text = JSON.stringify([event, data]);
      if (socket.connected) ws.send(text);
      else queue.push(text);
      return socket;
    },
    connect() {
      closed = false;
      if (!ws) open();
      return socket;
    },
    close() {
      closed = true;
      if (ws) ws.close();
    },
  };
  // Dropped while disconnected; the next update replaces it anyway.
  socket.volatile = {
    emit(event, data) {
      if (socket.connected) ws.send(JSON.stringify([event, data]));
      return socket;
    },
  };

  function open() {
    ws = new WebSocket(target);
    ws.onmessage = (msg) => {
      let event;
      let data;
      try {
        [event, data] = JSON.parse(msg.data);
      } catch {
        return;
      }
      if (event === 'connected') {
        socket.id = data.id;
        socket.connected = true;
        retryMs = RETRY_MIN_MS;
        for (const text of queue) ws.send(text);
        queue = [];
        fire('connect');
        return;
      }
      fire(event, data);
    };
    ws.onclose = () => {
      ws = null;
      const was = socket.connected;
      socket.connected = false;
      if (was) fire('disconnect');
      if (closed) return;
      setTimeout(() => {
        if (!closed && !ws) open();
      }, retryMs);
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
    };
  }

  if (autoConnect) open();
  return socket;
}
