import fetch from "node-fetch";
import { XMLParser } from "fast-xml-parser";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// Источники: мода / кроссовки / музыка
// (можно потом заменить под свои любимые медиа)
const RSS_SOURCES = [
  {
    name: "Crisp Culture",
    section: "Мода / streetwear",
    url: "https://crispculture.com/feed"
  },
  {
    name: "JustFreshKicks",
    section: "Кроссовки",
    url: "https://justfreshkicks.com/feed"
  },
  {
    name: "UPROXX Music",
    section: "Музыка",
    url: "https://uproxx.com/music/feed"
  }
];

// Настройки парсера XML
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_"
});

async function fetchRssItems(source) {
  try {
    const res = await fetch(source.url);
    if (!res.ok) {
      console.error("RSS HTTP error for", source.url, res.status);
      return [];
    }

    const xml = await res.text();
    const data = parser.parse(xml);

    // Типичная структура RSS 2.0: rss -> channel -> item[]
    let items = data?.rss?.channel?.item || data?.channel?.item;

    if (!items) {
      // На всякий случай, если это Atom или другой формат — просто выходим
      console.warn("No items in RSS for", source.url);
      return [];
    }

    // Если один объект, делаем массив
    if (!Array.isArray(items)) {
      items = [items];
    }

    // Берём только первые 5 записей с нормальными заголовками
    return items
      .filter((it) => it.title && it.link)
      .slice(0, 5)
      .map((it) => {
        const rawDate =
          it.pubDate ||
          it["dc:date"] ||
          it.date ||
          it.updated ||
          it["atom:updated"];

        let date = rawDate ? new Date(rawDate) : new Date();

        // Если дата не распарсилась — ставим сейчас
        if (isNaN(date.getTime())) {
          date = new Date();
        }

        return {
          title: it.title,
          link: it.link,
          date,
          source
        };
      });
  } catch (e) {
    console.error("Error fetching RSS for", source.url, e);
    return [];
  }
}

async function fetchTrendsText() {
  const lists = await Promise.all(RSS_SOURCES.map(fetchRssItems));
  const allItems = lists.flat();

  if (!allItems.length) {
    return "Сегодня не удалось собрать новости по моде и музыке — источники ничего не вернули.";
  }

  // Сортируем по дате: от новых к старым
  allItems.sort((a, b) => b.date - a.date);

  // Берём, например, топ-6 свежих
  const top = allItems.slice(0, 6);

  const lines = [];
  lines.push("⚡ Свежие тренды: мода, кроссовки, музыка");
  lines.push("");

  top.forEach((item, index) => {
    lines.push(
      `${index + 1}. ${item.title} — ${item.source.section}`
    );
    if (item.link) {
      lines.push(item.link);
    }
    lines.push("");
  });

  lines.push("#мода #музыка #streetwear #youthculture");

  return lines.join("\n");
}

// Сам handler для Vercel
export default async function handler(req, res) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) {
    return res.status(500).json({
      ok: false,
      error: "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID env vars"
    });
  }

  try {
    const text = await fetchTrendsText();

    const tgRes = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHANNEL_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: false
      })
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
