# Sophia Company – Telegram Mini App (Frontend -> API -> DB)

Waa hal Node.js service oo isku daya: frontend (`public/`), API (`/api`), bot webhook (`/bot/...`) iyo Supabase PostgreSQL.

## Deploy (Render Web Service)
1. Supabase -> Project -> Connect -> **Session pooler** connection string -> `DATABASE_URL`. (Tables si automatic ah ayaa loo sameeyaa marka server-ku bilowdo; `schema.sql` ayaa la run gareeyaa.)
2. Render -> New Web Service -> upload repo. Build: `npm install` | Start: `npm start`
3. Environment: `BOT_TOKEN`, `DATABASE_URL`, `PUBLIC_URL` (Render URL), `WEBHOOK_SECRET`, `ADMIN_ID` (optional), `FRONTEND_ORIGINS` (optional; `*` by default, or comma-separated frontend origins).
4. Server-ku wuxuu si automatic ah u dejiyaa webhook-ga iyo Menu Button-ka bot-ka.
5. **Muhiim:** @Sophiacompanybot ka dhig **Admin** 30-ka channel ee tasks-ka, haddii kale `getChatMember` ma shaqeyn doono (verification wuu fashilmayaa).

## Rules
- Task reward $1.5 | Daily $1 | Successful referral $2 (marka invited user dhammeeyo dhammaan tasks-ka)
- Withdraw: 10 successful referrals + dhammaan tasks + min $200 | fee $7
- Task verification: 10 ilbiriqsi, server-ku wuxuu hubiyaa membership.
- Referral link: `https://t.me/Sophiacompanybot?start=<userId>` (la tiriyaa kaliya user cusub oo /start sameeya)
