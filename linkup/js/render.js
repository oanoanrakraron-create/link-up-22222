(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  function esc(t) {
    const d = document.createElement("div");
    d.textContent = t;
    return d.innerHTML;
  }

  function avatarLetters(u) {
    const f = u.first || u.username || "?";
    return f.charAt(0).toUpperCase();
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday =
      d.getFullYear() === yesterday.getFullYear() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getDate() === yesterday.getDate();
    if (sameDay)
      return d.toLocaleTimeString("ru", {
        hour: "2-digit",
        minute: "2-digit",
      });
    if (isYesterday) return "вчера";
    return d.toLocaleDateString("ru", { day: "numeric", month: "short" });
  }

  function fmtDate(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) return "Сегодня";
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday =
      d.getFullYear() === yesterday.getFullYear() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getDate() === yesterday.getDate();
    if (isYesterday) return "Вчера";
    return d.toLocaleDateString("ru", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  function peerOf(chat, meId) {
    if (!chat || chat.type !== "dm") return null;
    const pid = chat.memberIds.find((id) => id !== meId);
    return pid ? LinkUpDB.getUser(pid) : null;
  }

  function chatTitle(chat, meId) {
    if (!chat) return "—";
    if (chat.type === "group") return chat.name || "Группа";
    const peer = peerOf(chat, meId);
    return peer ? peer.first + " " + (peer.last || "") : "—";
  }

  function chatAvatar(chat, meId) {
    if (!chat) return "?";
    if (chat.type === "group") return (chat.name || "G")[0].toUpperCase();
    const peer = peerOf(chat, meId);
    return peer ? avatarLetters(peer) : "?";
  }

  function chatSub(chat, meId) {
    const lm = LinkUpDB.getLastMessage(chat.id);
    if (!lm) return "Нет сообщений";
    const sender = LinkUpDB.getUser(lm.senderId);
    const prefix =
      chat.type === "group" && sender
        ? sender.id === meId
          ? "Вы: "
          : sender.first + ": "
        : "";
    return prefix + (lm.text || "").replace(/\n/g, " ");
  }

  function renderChatList(meId) {
    const el = document.getElementById("chats-list");
    const chatList = LinkUpDB.getChats();
    const sorted = chatList
      .filter((c) => c.memberIds && c.memberIds.includes(meId))
      .sort((a, b) => {
        const la = LinkUpDB.getLastMessage(a.id);
        const lb = LinkUpDB.getLastMessage(b.id);
        const ta = la ? Number(la.ts) : Number(a.createdAt);
        const tb = lb ? Number(lb.ts) : Number(b.createdAt);
        return tb - ta;
      });

    const activeChatId = el._activeChatId;

    if (!sorted.length) {
      el.innerHTML = '<div class="empty-state">Нет чатов</div>';
      return;
    }

    el.innerHTML =
      `<div class="list-section">Все чаты</div>` +
      sorted
        .map((c) => {
          const title = chatTitle(c, meId);
          const sub = chatSub(c, meId);
          const lm = LinkUpDB.getLastMessage(c.id);
          const time = lm ? fmtTime(Number(lm.ts)) : "";
          const a = chatAvatar(c, meId);
          const isActive = c.id === activeChatId;
          const isGroup = c.type === "group";
          return `<div class="list-item${isActive ? " active" : ""}" data-chat-id="${c.id}">
            <div class="avatar">${esc(a)}</div>
            <div class="item-body">
              <div class="item-title">${esc(title)}${isGroup ? " <span style='color:var(--text-dim);font-size:12px'>👥</span>" : ""}</div>
              <div class="item-sub">${esc(sub)}</div>
            </div>
            <div class="item-time">${time}</div>
          </div>`;
        })
        .join("");

    el.querySelectorAll(".list-item").forEach((item) => {
      item.addEventListener("click", () => {
        const cid = item.dataset.chatId;
        el._activeChatId = cid;
        if (window.LinkUpApp) LinkUpApp.openChat(cid);
      });
    });
  }

  function renderContacts(meId, search) {
    const el = document.getElementById("contacts-list");
    let list = LinkUpDB.getUsersList().filter((u) => u.id !== meId);

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (u) =>
          u.first.toLowerCase().includes(q) ||
          u.username.toLowerCase().includes(q) ||
          (u.last && u.last.toLowerCase().includes(q))
      );
    }

    if (!list.length) {
      el.innerHTML = '<div class="empty-state">Никого не найдено</div>';
      return;
    }

    el.innerHTML =
      `<div class="list-section">Люди — ${list.length}</div>` +
      list
        .map((u) => {
          return `<div class="list-item" data-user-id="${u.id}">
            <div class="avatar">${esc(avatarLetters(u))}</div>
            <div class="item-body">
              <div class="item-title">${esc(u.first + " " + (u.last || ""))}</div>
              <div class="item-sub">@${esc(u.username)}${u.about ? " · " + esc(u.about) : ""}</div>
            </div>
            <div class="item-time">${u.online ? "🟢" : ""}</div>
          </div>`;
        })
        .join("");

    el.querySelectorAll(".list-item").forEach((item) => {
      item.addEventListener("click", () => {
        const uid = item.dataset.userId;
        LinkUpApp.startDm(uid);
      });
    });
  }

  function renderMessages(chatId, meId) {
    const el = document.getElementById("messages");
    const msgs = LinkUpDB.getMessages(chatId);
    const chat = LinkUpDB.getChat(chatId);

    if (!msgs.length) {
      el.innerHTML =
        '<div class="empty-state" style="padding:60px 20px">Нет сообщений. Напишите что-нибудь!</div>';
      return;
    }

    let lastDate = "";
    let html = "";

    msgs.forEach((m) => {
      const t = Number(m.ts);
      const d = fmtDate(t);
      if (d !== lastDate) {
        html += `<div class="date-divider">${esc(d)}</div>`;
        lastDate = d;
      }
      const isMine = m.senderId === meId;
      const sender = LinkUpDB.getUser(m.senderId);
      const time = fmtTime(t);
      const isGroup = chat && chat.type === "group";

      html += `<div class="msg ${isMine ? "out" : "in"}${isGroup ? " group" : ""}">
        ${isGroup && !isMine ? `<div class="sender">${esc(sender ? sender.first : "")}</div>` : ""}
        <span class="msg-text">${esc(m.text)}</span>
        <span class="msg-time">${time}</span>
      </div>`;
    });

    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
  }

  function renderChatWindow(chatId, meId) {
    const chat = LinkUpDB.getChat(chatId);
    if (!chat) return;

    const title = chatTitle(chat, meId);
    const a = chatAvatar(chat, meId);
    const isGroup = chat.type === "group";
    const peer = peerOf(chat, meId);

    const cw = document.getElementById("chat-window");
    cw.classList.remove("hidden");
    document.getElementById("chat-empty").classList.add("hidden");

    let meta = "";
    if (isGroup) {
      const members = (chat.memberIds || [])
        .map((id) => {
          const u = LinkUpDB.getUser(id);
          return u ? u.first : "—";
        })
        .join(", ");
      meta = "Группа · " + members;
    } else {
      meta = peer ? "@" + peer.username : "";
    }

    cw.innerHTML = `
      <div class="chat-header">
        <div class="avatar">${esc(a)}</div>
        <div class="chat-title" data-chat-id="${chatId}">
          <div class="name">${esc(title)}</div>
          <div class="meta">${esc(meta)}</div>
        </div>
        <div class="chat-actions">
          <button class="round-btn call" id="btn-call-audio" title="Аудиозвонок">🎧</button>
          <button class="round-btn call" id="btn-call-video" title="Видеозвонок">📹</button>
          ${isGroup ? `<button class="round-btn" id="btn-group-info" title="О группе">ℹ️</button>` : ""}
        </div>
      </div>
      <div class="messages" id="messages"></div>
      <div class="chat-input-bar">
        <button class="round-btn" id="btn-emoji" title="Эмодзи">😊</button>
        <textarea id="msg-input" rows="1" placeholder="Сообщение..." enterkeyhint="send"></textarea>
        <button class="round-btn send" id="btn-send" title="Отправить">➤</button>
      </div>
    `;

    renderMessages(chatId, meId);

    document.getElementById("msg-input").focus();
    document.getElementById("btn-send").addEventListener("click", () => {
      LinkUpApp.sendMessage(chatId);
    });
    document.getElementById("msg-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        LinkUpApp.sendMessage(chatId);
      }
    });
    document.getElementById("btn-call-audio").addEventListener("click", () => {
      LinkUpApp.startCall(chatId, "audio");
    });
    document.getElementById("btn-call-video").addEventListener("click", () => {
      LinkUpApp.startCall(chatId, "video");
    });
    document.getElementById("btn-emoji").addEventListener("click", () => {
      LinkUpApp.toggleEmoji();
    });

    if (isGroup) {
      const infoBtn = document.getElementById("btn-group-info");
      if (infoBtn) {
        infoBtn.addEventListener("click", () => {
          LinkUpApp.showGroupInfo(chatId);
        });
      }
    }
  }

  function renderCallOverlay(peer, kind) {
    const overlay = document.getElementById("call-overlay");
    overlay.classList.remove("hidden");
    document.getElementById("call-avatar").textContent = peer
      ? avatarLetters(peer)
      : "?";
    document.getElementById("call-name").textContent = peer
      ? peer.first + " " + (peer.last || "")
      : "—";
    document.getElementById("call-state").textContent =
      kind === "video" ? "Видеозвонок..." : "Аудиозвонок...";
    document.getElementById("call-timer").textContent = "00:00";

    const videos = overlay.querySelector(".call-videos");
    if (kind === "video") {
      videos.classList.add("on");
    } else {
      videos.classList.remove("on");
    }

    document.getElementById("call-hangup").onclick = () => {
      LinkUpRTC.endCall();
    };
    document.getElementById("call-toggle-mic").onclick = () => {
      const on = LinkUpRTC.toggleMic();
      document.getElementById("call-toggle-mic").classList.toggle("off", !on);
    };
    document.getElementById("call-toggle-video").onclick = () => {
      const on = LinkUpRTC.toggleVideo();
      document.getElementById("call-toggle-video").classList.toggle("off", !on);
    };
  }

  function showIncomingOverlay(callInfo) {
    const peer = LinkUpDB.getUser(callInfo.callerId);
    const overlay = document.getElementById("incoming-overlay");
    overlay.classList.remove("hidden");
    document.getElementById("incoming-avatar").textContent = peer
      ? avatarLetters(peer)
      : "?";
    document.getElementById("incoming-name").textContent = peer
      ? peer.first + " " + (peer.last || "")
      : "—";
    document.getElementById("incoming-state").textContent =
      callInfo.kind === "video" ? "Видеозвонок..." : "Аудиозвонок...";

    document.getElementById("incoming-accept").onclick = () => {
      overlay.classList.add("hidden");
      LinkUpApp.acceptCall(callInfo);
    };
    document.getElementById("incoming-decline").onclick = () => {
      overlay.classList.add("hidden");
      LinkUpApp.declineCall(callInfo);
    };
  }

  function hideIncomingOverlay() {
    document.getElementById("incoming-overlay").classList.add("hidden");
  }

  function hideCallOverlay() {
    document.getElementById("call-overlay").classList.add("hidden");
    const lv = document.getElementById("local-video");
    const rv = document.getElementById("remote-video");
    if (lv) lv.srcObject = null;
    if (rv) rv.srcObject = null;
  }

  function showModal(html) {
    const root = document.getElementById("modal-root");
    root.innerHTML = `<div class="modal-backdrop"><div class="modal">${html}</div></div>`;
    root.querySelector(".modal-backdrop").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeModal();
    });
  }

  function closeModal() {
    document.getElementById("modal-root").innerHTML = "";
  }

  window.LinkUpRender = {
    renderChatList,
    renderContacts,
    renderMessages,
    renderChatWindow,
    renderCallOverlay,
    showIncomingOverlay,
    hideIncomingOverlay,
    hideCallOverlay,
    showModal,
    closeModal,
    fmtTime,
    fmtDate,
    avatarLetters,
    chatTitle,
    chatAvatar,
    esc,
  };
})();