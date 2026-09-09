(function () {
  "use strict";

  /*
    Сигнализация звонков через WebSocket.
    CallID генерируется на клиенте (чтобы дозвон и ответ знали свой callId).
  */

  let currentCall = null; // { callId, chatId, peerId, kind, role }
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
        console.warn("call handler error", e);
      }
    });
  }

  function get() {
    return currentCall;
  }

  function uid(prefix) {
    return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  async function createCall(chatId, calleeId, kind) {
    const me = window.LinkUpAuth.currentUser();
    if (!me) return null;

    const callId = uid("call");
    currentCall = { callId, chatId, peerId: calleeId, kind, role: "caller" };

    // Уведомляем собеседника
    LinkUpWS.send({
      t: "call:ring",
      to: calleeId,
      callId,
      kind,
      chatId,
    });

    return callId;
  }

  async function acceptCall(callId, callerId, kind, chatId) {
    currentCall = { callId, chatId, peerId: callerId, kind, role: "callee" };

    LinkUpWS.send({
      t: "call:accept",
      to: callerId,
      callId,
    });

    return currentCall;
  }

  async function declineCall(callId, peerId) {
    LinkUpWS.send({
      t: "call:decline",
      to: peerId,
      callId,
    });
    cleanup();
  }

  async function endCall() {
    if (currentCall) {
      LinkUpWS.send({
        t: "call:end",
        to: currentCall.peerId,
        callId: currentCall.callId,
      });
    }
    cleanup();
  }

  function sendOffer(peerId, callId, payload) {
    LinkUpWS.send({ t: "call:offer", to: peerId, callId, payload });
  }

  function sendAnswer(peerId, callId, payload) {
    LinkUpWS.send({ t: "call:answer", to: peerId, callId, payload });
  }

  function sendIce(peerId, callId, payload) {
    LinkUpWS.send({ t: "call:ice", to: peerId, callId, payload });
  }

  function cleanup() {
    currentCall = null;
  }

  window.LinkUpCall = {
    on,
    emit,
    get,
    createCall,
    acceptCall,
    declineCall,
    endCall,
    sendOffer,
    sendAnswer,
    sendIce,
    cleanup,
  };
})();