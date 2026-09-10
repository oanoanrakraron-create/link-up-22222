(function () {
  "use strict";

  // API-клиент: fetch с авторизацией к серверу LinkUp

  const BASE = (function () {
    const loc = window.location;
    // На Render/локально сервер отдаёт и API, и статику — всё с одного хоста
    return loc.origin;
  })();

  let _token = localStorage.getItem("linkup_token") || null;

  function setToken(t) {
    _token = t;
    if (t) localStorage.setItem("linkup_token", t);
    else localStorage.removeItem("linkup_token");
  }

  function getToken() {
    return _token;
  }

  function headers() {
    const h = { "Content-Type": "application/json" };
    if (_token) h["Authorization"] = "Bearer " + _token;
    return h;
  }

  async function req(method, path, body) {
    const url = BASE + "/api" + path;
    const opts = { method, headers: headers() };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.error || "Ошибка запроса");
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function get(path) {
    return req("GET", path);
  }

  function post(path, body) {
    return req("POST", path, body);
  }

  window.LinkUpAPI = {
    setToken,
    getToken,
    get,
    post,
    BASE,
  };
})();