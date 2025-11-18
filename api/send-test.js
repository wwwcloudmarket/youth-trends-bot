import fetch from "node-fetch";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

// Это серверлесс-функция Vercel
export default async function handler(req, res) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) {
    return res.status(500).json({
      ok: false,
      error: "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID env vars",
    });
  }

  const text = [
    "🔥 Тестовый пост из Vercel → Telegram",
    "",
    "Если ты видишь это сообщение в своем канале, значит связка GitHub + Vercel + Telegram работает.",
  ].join("\n");

  try {
    const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

    const tgRes = await fetch(telegramUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHANNEL_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: false,
      }),
    });

    const data = await tgRes.json();

    if (!data.ok) {
      console.error("Telegram error:", data);
      return res.status(500).json({ ok: false, error: data });
    }

    return res.status(200).json({ ok: true, result: data.result });
  } catch (e) {
    console.error("Unexpected error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
