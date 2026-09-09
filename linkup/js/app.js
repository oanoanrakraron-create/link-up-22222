(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const R = window.LinkUpRender;
  const DB = window.LinkUpDB;
  const AUTH = window.LinkUpAuth;
  const RTC = window.LinkUpRTC;
  const CALL = window.LinkUpCall;

  const Emojis = [
    "😀","😁","😂","🤣","😊","😍","😘","😎","🤩","🥳","😢","😭","😡","🥺","😴","🤔",
    "👍","👎","👏","🙏","💪","🤝","✌️","🤞","👌","🤙","❤️","💔","💯","🔥","✨","🎉",
    "🎂","🎁","⚽","🏀","🎮","🎧","☕","🍕","🍔","🌹","⭐","✅","❌","❗","❓","💬",
    "🚀","🌍","🌈","🍀","🐱","🐶","🦊","🐼","🍎","🍌","🍉","🥑","🚗","✈️","🏠","🌙",
  ];

  let meId = null;
  let currentChatId = null;
  let currentTab = "chats";
  let emojiOpen = false;
  let callTimer = null;
  let activeIncoming = null;

  function init() {
    bindAuthEvents();
    bindSidebarEvents();
    bindCallUIEvents();
    RTC.setupHandlers();
    document.addEventListener("click", handleGlobalClick);
    document.addEventListener("keydown", handleGlobalKey);
    addGroupButton();

    // WS-события: входящие звонки
    LinkUpWS.on("call:ring", onIncomingCall);

    // WS-события: сообщения
    LinkUpWS.on("message", (msg) => {
      DB.appendMessage(msg);
      if (msg.chatId === currentChatId) {
        const me = AUTH.currentUser();
        if (me) R.renderMessages(currentChatId, me.id);
      }
    });

    // WS-события: обновление пользователей (online)
    LinkUpWS.on("users", (users) => {
      DB.upsertUsers(users);
      if (currentTab === "contacts") renderContactsState();
    });

    LinkUpWS.on("open", () => {
      // при (пере)подключении загружаем данные
      loadInitialData();
    });

    // Проверяем, есть ли уже токен (сессия сохранена)
    const token = LinkUpAPI.getToken();
    const savedMe = AUTH.currentUser();
    if (token && savedMe) {
      meId = savedMe.id;
      enterApp();
    }
  }

  /* ===== Данные ===== */

  async function loadInitialData() {
    try {
      await DB.fetchAll();
      refreshChats();
      if (currentTab === "contacts") renderContactsState();
      if (currentChatId) {
        const me = AUTH.currentUser();
        if (me) openChat(currentChatId);
      }
    } catch (e) {
      console.warn("load error", e);
    }
  }

  /* ===== Auth UI ===== */

  function bindAuthEvents() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById("form-login").classList.toggle("hidden", tab !== "login");
        document.getElementById("form-register").classList.toggle("hidden", tab !== "register");
      });
    });

    $("#form-login").addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = $("#login-id").value.trim();
      const pass = $("#login-pass").value;
      const btn = $("#form-login button[type=submit]");
      btn.disabled = true;
      const hint = $("#login-hint");
      try {
        const res = await AUTH.login(id, pass);
        LinkUpAPI.setToken(res.token);
        AUTH.setCurrentUser(res.user);
        meId = res.user.id;
        hint.className = "auth-hint";
        btn.disabled = false;
        enterApp();
      } catch (err) {
        hint.textContent = err.data ? err.data.error : "Ошибка входа";
        hint.className = "auth-hint error";
        btn.disabled = false;
      }
    });

    $("#form-register").addEventListener("submit", async (e) => {
      e.preventDefault();
      const first = $("#reg-first").value;
      const username = $("#reg-username").value;
      const email = $("#reg-email").value;
      const pass = $("#reg-pass").value;
      const btn = $("#form-register button[type=submit]");
      btn.disabled = true;
      const hint = $("#reg-hint");
      try {
        const res = await AUTH.register({ first, username, email, password: pass });
        LinkUpAPI.setToken(res.token);
        AUTH.setCurrentUser(res.user);
        meId = res.user.id;
        hint.className = "auth-hint";
        btn.disabled = false;
        enterApp();
      } catch (err) {
        hint.textContent = err.data ? err.data.error : "Ошибка регистрации";
        hint.className = "auth-hint error";
        btn.disabled = false;
      }
    });

    $("#btn-logout").addEventListener("click", async () => {
      LinkUpWS.disconnect();
      await AUTH.logout();
      meId = null;
      currentChatId = null;
      DB.cleanup();
      showAuth();
    });
  }

  function showAuth() {
    document.getElementById("screen-auth").classList.remove("hidden");
    document.getElementById("screen-app").classList.add("hidden");
  }

  function enterApp() {
    document.getElementById("screen-auth").classList.add("hidden");
    document.getElementById("screen-app").classList.remove("hidden");

    const me = AUTH.currentUser();
    if (!me) return;
    meId = me.id;
    updateMe();

    // Подключаем WS (авторизация через токен в URL)
    LinkUpWS.connect();

    // Загружаем данные и перерисовываем
    loadInitialData();
    refreshChats();
    switchTab("chats");
  }

  function updateMe() {
    const me = AUTH.currentUser();
    if (!me) return;
    document.getElementById("me-name").textContent = (me.first || "") + " " + (me.last || "");
    document.getElementById("me-username").textContent = "@" + (me.username || "");
    document.getElementById("me-avatar").textContent = R.avatarLetters(me);
  }

  /* ===== Sidebar ===== */

  function bindSidebarEvents() {
    document.querySelectorAll(".sb-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        switchTab(btn.dataset.tab);
      });
    });

    $("#search-input").addEventListener("input", () => {
      const q = $("#search-input").value.trim();
      if (currentTab === "chats") {
        const items = document.querySelectorAll("#chats-list .list-item");
        items.forEach((it) => {
          const title = it.querySelector(".item-title").textContent.toLowerCase();
          it.style.display = title.includes(q.toLowerCase()) ? "flex" : "none";
        });
      } else {
        renderContactsState(q);
      }
    });
  }

  function addGroupButton() {
    const tabs = document.querySelector(".sidebar-tabs");
    const btn = document.createElement("button");
    btn.className = "sb-tab";
    btn.textContent = "＋ Группа";
    btn.style.flex = "0 1 auto";
    btn.style.padding = "8px 12px";
    btn.addEventListener("click", () => showCreateGroupModal());
    tabs.appendChild(btn);
  }

  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll(".sb-tab").forEach((b) =>
      b.classList.toggle("active", b.dataset.tab === tab)
    );
    document.getElementById("chats-list").classList.toggle("hidden", tab !== "chats");
    document.getElementById("contacts-list").classList.toggle("hidden", tab !== "contacts");
    if (tab === "contacts") renderContactsState($("#search-input").value.trim());
  }

  function refreshChats() {
    if (!meId) return;
    R.renderChatList(meId);
  }

  function renderContactsState(search) {
    if (!meId) return;
    R.renderContacts(meId, search);
  }

  /* ===== Чат ===== */

  async function openChat(chatId) {
    currentChatId = chatId;
    // загружаем сообщения
    await DB.fetchMessages(chatId);
    if (!AUTH.currentUser()) return;
    R.renderChatWindow(chatId, meId);
    document.body.classList.add("chat-open");
    document.querySelectorAll("#chats-list .list-item").forEach((it) => {
      it.classList.toggle("active", it.dataset.chatId === chatId);
    });
  }

  async function startDm(userId) {
    try {
      const res = await LinkUpAPI.post("/chats/dm", { otherId: userId });
      // обновляем кэш
      await DB.fetchAll();
      refreshChats();
      switchTab("chats");
      if (res.chat) openChat(res.chat.id);
    } catch (e) {
      console.warn("start dm error", e);
    }
  }

  function sendMessage(chatId) {
    const input = $("#msg-input");
    const text = input.value.trim();
    if (!text) return;
    // отправляем через WS
    LinkUpWS.send({ t: "chat:message", chatId, text });
    input.value = "";
    input.style.height = "auto";
    closeEmoji();
  }

  function toggleEmoji() {
    const panel = $("#emoji-panel");
    if (emojiOpen) { closeEmoji(); return; }
    emojiOpen = true;
    panel.innerHTML = Emojis.map((e) => `<button data-e="${e}">${e}</button>`).join("");
    panel.classList.remove("hidden");
    panel.querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => {
        const input = $("#msg-input");
        input.value += b.dataset.e;
        input.focus();
        input.style.height = "auto";
        input.style.height = input.scrollHeight + "px";
      });
    });
  }

  function closeEmoji() {
    emojiOpen = false;
    $("#emoji-panel").classList.add("hidden");
  }

  /* ===== Группы ===== */

  async function showCreateGroupModal() {
    const users = DB.getUsersList().filter((u) => u.id !== meId);
    R.showModal(`
      <h3>Новая группа</h3>
      <input id="grp-name" type="text" placeholder="Название группы">
      <div class="pick-title">Участники</div>
      <div id="grp-users">
        ${users
          .map(
            (u) => `
          <div class="pick-item" data-uid="${u.id}">
            <div class="avatar">${R.esc(R.avatarLetters(u))}</div>
            <div class="info">
              <div class="nm">${R.esc(u.first + " " + (u.last || ""))}</div>
              <div class="un">@${R.esc(u.username || "")}</div>
            </div>
            <div class="check">✓</div>
          </div>`
          )
          .join("")}
      </div>
      <p class="modal-hint" id="grp-hint"></p>
      <div class="modal-row">
        <button class="btn" id="grp-cancel">Отмена</button>
        <button class="btn primary" id="grp-create">Создать</button>
      </div>
    `);

    const selected = new Set();
    document.querySelectorAll("#grp-users .pick-item").forEach((item) => {
      item.addEventListener("click", () => {
        const uid = item.dataset.uid;
        if (selected.has(uid)) {
          selected.delete(uid);
          item.classList.remove("selected");
        } else {
          selected.add(uid);
          item.classList.add("selected");
        }
      });
    });

    $("#grp-cancel").addEventListener("click", () => R.closeModal());
    $("#grp-create").addEventListener("click", async () => {
      const name = $("#grp-name").value.trim();
      if (!name) {
        $("#grp-hint").textContent = "Введите название группы";
        $("#grp-hint").className = "modal-hint error";
        return;
      }
      if (selected.size === 0) {
        $("#grp-hint").textContent = "Выберите хотя бы одного участника";
        $("#grp-hint").className = "modal-hint error";
        return;
      }
      try {
        const ids = [meId, ...selected];
        const res = await LinkUpAPI.post("/chats/group", { name, memberIds: ids });
        R.closeModal();
        await DB.fetchAll();
        refreshChats();
        switchTab("chats");
        if (res.chat) openChat(res.chat.id);
      } catch (e) {
        console.warn("group create error", e);
      }
    });
  }

  function showGroupInfo(chatId) {
    const chat = DB.getChat(chatId);
    if (!chat) return;
    const members = (chat.memberIds || [])
      .map((id) => {
        const u = DB.getUser(id);
        return u ? { id: u.id, name: u.first + " " + (u.last || ""), un: u.username } : null;
      })
      .filter(Boolean);

    R.showModal(`
      <h3>${R.esc(chat.name || "Группа")}</h3>
      <div class="pick-title">Участники — ${members.length}</div>
      ${members
        .map(
          (m) => `
        <div class="pick-item">
          <div class="avatar">${R.esc(R.avatarLetters({ first: m.name }))}</div>
          <div class="info">
            <div class="nm">${R.esc(m.name)}</div>
            <div class="un">@${R.esc(m.un)}</div>
          </div>
        </div>`
        )
        .join("")}
      <div class="modal-row">
        <button class="btn danger" id="grp-leave">Покинуть группу</button>
        <button class="btn" id="grp-close">Закрыть</button>
      </div>
    `);

    $("#grp-close").addEventListener("click", () => R.closeModal());
    $("#grp-leave").addEventListener("click", async () => {
      try {
        await LinkUpAPI.post("/chats/" + chatId + "/leave", {});
        await DB.fetchAll();
        R.closeModal();
        currentChatId = null;
        document.getElementById("chat-window").classList.add("hidden");
        document.getElementById("chat-empty").classList.remove("hidden");
        refreshChats();
      } catch (e) {
        console.warn(e);
      }
    });
  }

  /* ===== Звонки ===== */

  async function startCall(chatId, kind) {
    const chat = DB.getChat(chatId);
    if (!chat) return;

    if (chat.type === "group") {
      R.showModal(`<h3>Групповые звонки</h3><p style="color:var(--text-dim);margin-bottom:14px">В этой версии звонки работают в личных чатах (1-на-1).</p><div class="modal-row"><button class="btn" id="grp-close">Понятно</button></div>`);
      $("#grp-close").addEventListener("click", () => R.closeModal());
      return;
    }

    const peerId = chat.memberIds.find((id) => id !== meId);
    if (!peerId) return;

    const peer = DB.getUser(peerId);
    R.renderCallOverlay(peer, kind);
    const res = await RTC.startCall(chatId, peerId, kind);
    if (!res.ok) R.hideCallOverlay();
  }

  function onIncomingCall(callInfo) {
    if (activeIncoming) return;
    activeIncoming = callInfo;
    R.showIncomingOverlay(callInfo);
  }

  async function acceptCall(callInfo) {
    activeIncoming = null;
    R.hideIncomingOverlay();
    const peer = DB.getUser(callInfo.from);
    R.renderCallOverlay(peer, callInfo.kind);
    await RTC.acceptIncoming(callInfo);
  }

  async function declineCall(callInfo) {
    activeIncoming = null;
    R.hideIncomingOverlay();
    await CALL.declineCall(callInfo.callId, callInfo.from);
  }

  function bindCallUIEvents() {
    RTC.on("localStream", (stream) => {
      const v = document.getElementById("local-video");
      if (v) v.srcObject = stream;
    });
    RTC.on("remoteStream", (stream) => {
      const v = document.getElementById("remote-video");
      if (v) v.srcObject = stream;
      document.getElementById("call-state").textContent = "Соединено";
      startTimer();
    });
    RTC.on("accepted", () => {
      document.getElementById("call-state").textContent = "Соединение...";
    });
    RTC.on("declined", () => {
      hideCall();
      showToast("Собеседник отклонил звонок");
    });
    RTC.on("remote-end", () => {
      hideCall();
      showToast("Звонок завершён");
    });
    RTC.on("disconnected", () => {
      hideCall();
      showToast("Соединение потеряно");
    });
    RTC.on("error", (msg) => {
      console.warn("call error:", msg);
      hideCall();
      showToast(msg || "Ошибка звонка");
    });
  }

  function startTimer() {
    const start = Date.now();
    if (callTimer) clearInterval(callTimer);
    callTimer = setInterval(() => {
      const s = Math.floor((Date.now() - start) / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      const el = document.getElementById("call-timer");
      if (el) el.textContent = mm + ":" + ss;
    }, 1000);
  }

  function hideCall() {
    if (callTimer) clearInterval(callTimer);
    callTimer = null;
    R.hideCallOverlay();
  }

  function showToast(msg) {
    const t = document.createElement("div");
    t.textContent = msg;
    t.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#2a3441;color:#fff;padding:10px 18px;border-radius:10px;z-index:200;font-size:14px;box-shadow:0 8px 30px rgba(0,0,0,.4)";
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  /* ===== Глобальные ===== */

  function handleGlobalClick(e) {
    if (emojiOpen && !e.target.closest("#emoji-panel") && !e.target.closest("#btn-emoji")) {
      closeEmoji();
    }
  }

  function handleGlobalKey(e) {
    if (e.key === "Escape") {
      R.closeModal();
      closeEmoji();
      if (!document.querySelector("#call-overlay.hidden")) {
        RTC.endCall();
      } else if (document.body.classList.contains("chat-open") && window.innerWidth <= 820) {
        document.body.classList.remove("chat-open");
      }
    }
  }

  window.LinkUpApp = {
    init,
    openChat,
    startDm,
    sendMessage,
    toggleEmoji,
    showCreateGroupModal,
    showGroupInfo,
    startCall,
    acceptCall,
    declineCall,
    refreshChats,
    renderContactsState,
  };
})();