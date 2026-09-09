(function () {
  "use strict";

  // Регистрация/вход/выход через серверный API

  async function register({ first, username, email, password }) {
    return LinkUpAPI.post("/register", { first, username, email, password });
  }

  async function login(loginId, password) {
    return LinkUpAPI.post("/login", { loginId, password });
  }

  function currentUser() {
    const raw = localStorage.getItem("linkup_me");
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function setCurrentUser(u) {
    if (u) localStorage.setItem("linkup_me", JSON.stringify(u));
    else localStorage.removeItem("linkup_me");
  }

  async function logout() {
    window.LinkUpAPI.setToken(null);
    setCurrentUser(null);
    // Сервер помечает offline при закрытии WS через heartbeat;
    // принудительно отправим сообщение о выходе (если сокет открыт)
    try {
      LinkUpWS.send({ t: "logout" });
    } catch (e) {}
    LinkUpWS.disconnect();
  }

  window.LinkUpAuth = {
    register,
    login,
    logout,
    currentUser,
    setCurrentUser,
  };
})();