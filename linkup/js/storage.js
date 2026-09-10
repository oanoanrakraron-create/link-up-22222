(function () {
  "use strict";

  /*
    Клиентский слой данных.
    - Локальный кэш (пользователи, чаты, сообщения)
    - Загрузка с сервера через API
    - Реактивные события (для перерисовки)
  */

  let cache = {
    users: {},      // id -> user
    chats: [],      // full chat objects
    messages: {},   // chatId -> [message]
  };

  const listeners = {};

  function on(ev, fn) {
    if (!listeners[ev]) listeners[ev] = [];
    listeners[ev].push(fn);
    return () => {
      listeners[ev] = listeners[ev].filter((f) => f !== fn);
    };
  }

  function emit(ev, data) {
    (listeners[ev] || []).forEach((fn) => {
      try {
        fn(data);
      } catch (e) {
        console.warn("store listener error", e);
      }
    });
  }

  function cleanup() {
    Object.keys(listeners).forEach((k) => delete listeners[k]);
    cache = { users: {}, chats: [], messages: {} };
  }

  /* ===== Загрузка с сервера ===== */

  async function fetchAll() {
    const [usersRes, chatsRes] = await Promise.all([
      LinkUpAPI.get("/users"),
      LinkUpAPI.get("/chats"),
    ]);

    const userMap = {};
    (usersRes.users || []).forEach((u) => {
      userMap[u.id] = u;
    });
    cache.users = userMap;

    cache.chats = chatsRes.chats || [];

    emit("users");
    emit("chats");
  }

  async function fetchMessages(chatId) {
    const res = await LinkUpAPI.get("/chats/" + chatId + "/messages");
    cache.messages[chatId] = res.messages || [];
    emit("messages", chatId);
    return cache.messages[chatId];
  }

  /* ===== Пользователи ===== */

  function getUser(id) {
    return cache.users[id] ? { ...cache.users[id] } : null;
  }

  function getUsersList() {
    return Object.values(cache.users).map((u) => ({ ...u }));
  }

  /* ===== Чаты ===== */

  function getChat(id) {
    return cache.chats.find((c) => c.id === id) || null;
  }

  function getChats() {
    return cache.chats.map((c) => ({ ...c }));
  }

  /* ===== Сообщения ===== */

  function getMessages(chatId) {
    return (cache.messages[chatId] || []).map((m) => ({ ...m }));
  }

  function getLastMessage(chatId) {
    const list = cache.messages[chatId];
    if (!list || !list.length) return null;
    return { ...list[list.length - 1] };
  }

  /* ===== Вставка из WebSocket (пуш-события) ===== */

  function upsertUser(user) {
    if (user && user.id) {
      cache.users[user.id] = { ...cache.users[user.id], ...user };
      emit("users");
    }
  }

  function upsertUsers(users) {
    if (!users) return;
    users.forEach((u) => {
      if (u.id) cache.users[u.id] = { ...cache.users[u.id], ...u };
    });
    emit("users");
  }

  function appendMessage(msg) {
    if (!msg || !msg.chatId) return;
    if (!cache.messages[msg.chatId]) cache.messages[msg.chatId] = [];
    cache.messages[msg.chatId].push(msg);
    emit("messages", msg.chatId);
  }

  async function ensureChat(id) {
    // если чата нет в кэше — перезагрузить список
    if (!cache.chats.find((c) => c.id === id)) {
      await fetchAll();
    }
  }

  window.LinkUpDB = {
    fetchAll,
    fetchMessages,
    getUser,
    getUsersList,
    getChat,
    getChats,
    getMessages,
    getLastMessage,
    upsertUser,
    upsertUsers,
    appendMessage,
    ensureChat,
    on,
    emit,
    cleanup,
  };
})();