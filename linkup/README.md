# LinkUp — мессенджер (Node.js + WebSocket)

Мессенджер в стиле Telegram: личные чаты, группы, поиск людей, регистрация/вход, аудио- и видеозвонки (WebRTC). Свой бэкенд: **Node.js + Express + WebSocket + SQLite** — без Firebase, без внешних сервисов для данных.

Переписка и звонки работают между разными устройствами и разными людьми через интернет.

## Как запустить локально

Требуется Node.js 18+ (проверьте: `node -v`).

```bash
cd server
npm install
node index.js
```

Откройте http://localhost:3000

## Как задеплоить на Render (бесплатно)

1. Залейте папку `linkup` целиком в **GitHub** (репозиторий):
   ```bash
   cd linkup
   git init
   git add .
   git commit -m "LinkUp"
   # создать репозиторий на github.com, затем:
   git remote add origin https://github.com/ВАШ_ЛОГИН/linkup.git
   git push -u origin main
   ```
2. Откройте [render.com](https://render.com) → Sign up (GitHub) → **New** → **Web Service**
3. Подключите репозиторий → Render сам увидит файл `render.yaml`
4. Нажмите **Apply** — через 1–2 минуты сайт будет на `https://linkup.onrender.com`

Управление: Dashboard → ваш сервис. Render бесплатно даёт один web service (спит при неактивности ~15 мин, при запросе просыпается).

## Демо-аккаунты

| Логин | Пароль |
|-------|--------|
| `demo`  | `demo123` |
| `alex`  | `alex123` |
| `kira`  | `kira123` |
| `max`   | `max123`  |

## Как найти друзей

- Все зарегистрированные пользователи видны всем (вкладка **«Люди»**)
- Откройте вкладку «Люди» → нажмите на человека → личный чат
- Договоритесь с друзьями об общем фрагменте логина, чтобы легко искать (например, `my_...`)

## Звонки

- WebRTC + WebSocket-сигнализация — работают между разными устройствами
- Требуется доступ к микрофону/камере в обоих браузерах
- Без TURN-сервера звонок может не пройти у пользователей за строгим NAT (описано ниже)

## Структура

```
linkup/
├─ server/            — бэкенд
│  ├─ index.js        — Express + WebSocket + SQLite (API, сигнализация)
│  ├─ package.json
│  └─ linkup.db       — создаётся автоматически
├─ index.html         — интерфейс (подключает js/api.js, js/ws-client.js)
├─ styles.css
├─ icon.svg
├─ manifest.webmanifest
├─ render.yaml        — конфиг деплоя Render
└─ js/
   ├─ api.js          — fetch-клиент к серверу
   ├─ ws-client.js    — WebSocket-клиент (автопереподключение)
   ├─ storage.js      — слой данных: пользователи, чаты, сообщения
   ├─ signaling.js    — сигнализация звонков через WS
   ├─ rtc.js          — WebRTC аудио/видео
   ├─ auth.js         — вход/регистрация (через api.js)
   ├─ render.js       — отрисовка
   └─ app.js          — логика приложения
```

## Ограничения

- Поиск людей — простая фильтрация (не полнотекстовый)
- Без TURN-сервера звонки могут не работать за строгим NAT (для продакшена добавьте coturn/turnserver)
- Групповые звонки (3+) не реализованы — только 1-на-1

## TURN-сервер (для надёжных звонков)

В `js/rtc.js` в массиве `iceServers` добавьте свой TURN:

```js
{ urls: "turn:your-turn.example.com:3478", username: "user", credential: "pass" }
```

Бесплатные варианты: coturn на своём VPS, Open Relay Project (https://www.metered.ca/tools/openrelay/).