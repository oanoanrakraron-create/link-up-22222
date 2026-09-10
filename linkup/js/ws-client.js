(function () {
  "use strict";

  // WebSocket-клиент с автопереподключением

  let ws = null;
  let reconnectTimer = null;
  let destroyed = false;
  const handlers = {};

  function on(ev, fn) {
    if (!handlers[ev]) handlers[ev] = [];
    handlers[ev].push(fn);
    return () => {
      handlers[ev] = handlers[ev].filter((f) => f !== fn);
    };
  }

  function emit(ev, data) {
    (handlers[ev] || []).forEach((fn) => {
      try {
        fn(data);
      } catch (e) {
        console.warn("ws handler error", e);
      }
    });
  }

  function connect() {
    if (destroyed) return;
    const token = window.LinkUpAPI.getToken();
    if (!token) return;

    const loc = window.location;
    const proto = loc.protocol === "https:" ? "wss:" : "ws:";
    const url = proto + "//" + loc.host + "/ws?token=" + encodeURIComponent(token);

    ws = new WebSocket(url);
    ws.isAlive = true;

    ws.onopen = () => {
      emit("open");
    };

    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch (err) {
        return;
      }
      handleIncoming(msg);
    };

    ws.onclose = () => {
      emit("close");
      ws = null;
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose сработает следом
    };
  }

  function handleIncoming(msg) {
    switch (msg.t) {
      case "users":
        emit("users", msg.users || []);
        break;
      case "chat:message":
        emit("message", msg.message);
        break;
      case "call:ring":
        emit("call:ring", msg);
        break;
      case "call:offer":
        emit("call:offer", msg);
        break;
      case "call:answer":
        emit("call:answer", msg);
        break;
      case "call:ice":
        emit("call:ice", msg);
        break;
      case "call:accept":
        emit("call:accept", msg);
        break;
      case "call:decline":
        emit("call:decline", msg);
        break;
      case "call:end":
        emit("call:end", msg);
        break;
      default:
        emit(msg.t, msg);
    }
  }

  function scheduleReconnect() {
    if (destroyed) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 3000);
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function disconnect() {
    destroyed = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
      ws = null;
    }
  }

  function reconnect() {
    destroyed = false;
    disconnect(); // clear old state
    destroyed = false;
    connect();
  }

  window.LinkUpWS = {
    connect,
    disconnect,
    reconnect,
    send,
    on,
  };
})();