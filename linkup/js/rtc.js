(function () {
  "use strict";

  /*
    WebRTC — аудио/видео звонок.
    Сигнализация через WebSocket (LinkUpCall + LinkUpWS) — работает между разными устройствами.
  */

  let pc = null;
  let localStream = null;
  let remoteStream = null;
  let waitAnswer = false;
  const pendingIce = [];
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
        console.warn("rtc handler error", e);
      }
    });
  }

  const STUN = [{ urls: "stun:stun.l.google.com:19302" }];

  async function getMedia(kind) {
    return navigator.mediaDevices.getUserMedia({
      audio: true,
      video: kind === "video",
    });
  }

  function setupPc() {
    pc = new RTCPeerConnection({ iceServers: STUN });

    pc.onicecandidate = (e) => {
      const call = LinkUpCall.get();
      if (e.candidate && call) {
        LinkUpCall.sendIce(call.peerId, call.callId, e.candidate);
      }
    };
    pc.ontrack = (e) => {
      if (e.streams[0]) {
        remoteStream = e.streams[0];
        emit("remoteStream", remoteStream);
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (
        pc.iceConnectionState === "disconnected" ||
        pc.iceConnectionState === "failed" ||
        pc.iceConnectionState === "closed"
      ) {
        emit("disconnected");
      }
    };

    return pc;
  }

  async function attachLocal(kind) {
    localStream = await getMedia(kind);
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
    emit("localStream", localStream);
  }

  async function applyPendingIce() {
    while (pendingIce.length) {
      const c = pendingIce.shift();
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (e) {
        console.warn("ICE apply error", e);
      }
    }
  }

  async function startCall(chatId, peerId, kind) {
    if (pc) await stopInternal();
    kind = kind || "audio";

    const callId = await LinkUpCall.createCall(chatId, peerId, kind);
    if (!callId) return { ok: false };

    try {
      await attachLocal(kind);
    } catch (e) {
      console.warn("media error", e);
      emit("error", "Не удалось получить доступ к микрофону/камере");
      LinkUpCall.endCall();
      return { ok: false };
    }

    waitAnswer = true;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    LinkUpCall.sendOffer(peerId, callId, { sdp: offer, kind });
    return { ok: true };
  }

  async function acceptIncoming(callInfo) {
    if (pc) await stopInternal();

    const { callId, from: callerId, kind } = callInfo;
    const chatId = callInfo.chatId;

    await LinkUpCall.acceptCall(callId, callerId, kind, chatId);

    try {
      await attachLocal(kind);
    } catch (e) {
      emit("error", "Не удалось получить доступ к микрофону/камере");
      LinkUpCall.declineCall(callId, callerId);
      return;
    }

    // Ждём offer от звонящего (приходит через WS)
  }

  async function handleOffer(peerId, callId, payload) {
    if (!pc) return;
    // Уже должны быть role=callee и attached media
    await pc.setRemoteDescription(
      new RTCSessionDescription({ type: "offer", sdp: payload.sdp })
    );
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    LinkUpCall.sendAnswer(peerId, callId, { sdp: answer });
    await applyPendingIce();
  }

  function handleIncomingSignal(msg) {
    if (!pc) return;
    const me = LinkUpAuth.currentUser();
    if (!me) return;

    if (msg.t === "call:answer" && waitAnswer) {
      waitAnswer = false;
      pc.setRemoteDescription(
        new RTCSessionDescription({
          type: "answer",
          sdp: msg.payload.sdp,
        })
      ).catch((e) => console.warn("set answer error", e));
    } else if (msg.t === "call:ice") {
      if (pc.remoteDescription && pc.remoteDescription.type) {
        pc.addIceCandidate(new RTCIceCandidate(msg.payload)).catch((e) =>
          console.warn("ICE error", e)
        );
      } else {
        pendingIce.push(msg.payload);
      }
    } else if (msg.t === "call:offer") {
      handleOffer(msg.from, msg.callId, msg.payload);
    }
  }

  async function stopInternal() {
    if (pc) {
      try {
        pc.close();
      } catch (e) {}
      pc = null;
    }
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    remoteStream = null;
    waitAnswer = false;
    pendingIce.length = 0;
  }

  async function endCall() {
    await LinkUpCall.endCall();
    await stopInternal();
  }

  function getLocalStream() {
    return localStream;
  }

  function getRemoteStream() {
    return remoteStream;
  }

  function toggleMic() {
    if (!localStream) return false;
    const t = localStream.getAudioTracks()[0];
    if (t) {
      t.enabled = !t.enabled;
      return t.enabled;
    }
    return false;
  }

  function toggleVideo() {
    if (!localStream) return false;
    const t = localStream.getVideoTracks()[0];
    if (t) {
      t.enabled = !t.enabled;
      return t.enabled;
    }
    return false;
  }

  function isMicOn() {
    const t = localStream && localStream.getAudioTracks()[0];
    return t ? t.enabled : true;
  }

  function isVideoOn() {
    const t = localStream && localStream.getVideoTracks()[0];
    return t ? t.enabled : true;
  }

  function setupHandlers() {
    // Сигналы звонков через WS
    LinkUpWS.on("call:answer", (msg) => handleIncomingSignal(msg));
    LinkUpWS.on("call:ice", (msg) => handleIncomingSignal(msg));
    LinkUpWS.on("call:offer", (msg) => handleIncomingSignal(msg));
    LinkUpWS.on("call:accept", () => {
      waitAnswer = false;
      emit("accepted");
    });
    LinkUpWS.on("call:decline", () => {
      emit("declined");
    });
    LinkUpWS.on("call:end", () => {
      emit("remote-end");
    });
  }

  function cleanup() {
    stopInternal();
    LinkUpCall.cleanup();
  }

  window.LinkUpRTC = {
    on,
    emit,
    startCall,
    acceptIncoming,
    handleIncomingSignal,
    endCall,
    getLocalStream,
    getRemoteStream,
    toggleMic,
    toggleVideo,
    isMicOn,
    isVideoOn,
    setupHandlers,
    cleanup,
  };
})();