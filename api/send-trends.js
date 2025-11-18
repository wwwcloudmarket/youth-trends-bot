import fetch from "node-fetch";
import { XMLParser } from "fast-xml-parser";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// Источники: мода / кроссовки / музыка.
// Потом легко поменяем на свои любимые медиа.
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

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_"
});

// Вытаскиваем картинку из item (enclosure, media:content, <img> в описании)
function extractImageFromItem(it) {
  // <enclosure url="...">
  if (it.enclosure && it.enclosure["@_url"]) {
    const type = it.enclosure["@_type"] || "";
    if (!type || type.startsWith("image/")) {
      return it.enclosure["@_url"];
    }
  }

  // <media:content url="...">
  const media = it["media:content"] || it["media:thumbnail"];
  if (media) {
    if (Array.isArray(media)) {
      const m = media.find(
        (x) => x["@_url"] && (!x["@_type"] || x["@_type"].startsWith("image/"))
      );
      if (m) return m["@_url"];
    } else if (
      media["@_url"] &&
      (!media["@_type"] || media["@_type"].startsWith("image/"))
    ) {
      return media["@_url"];
    }
  }

  // Пробуем достать <img src="..."> из description / content
  const html =
    it["content:encoded"] ||
    it.description ||
    it.summary ||
    it.content ||
    "";

  const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch && imgMatch[1]) {
    return imgMatch[1];
  }

  return null;
}

// Убираем HTML-теги
function stripHtml(html) {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function truncate(text, maxLen) {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + "…";
}

// Забираем последние записи из одного RSS-источника
async function fetchRssItems(source) {
  try {
    const res = await fetch(source.url);
    if (!res.ok) {
      console.error("RSS HTTP error for", source.url, res.status);
      return [];
    }

    const xml = await res.text();
    const data = parser.parse(xml);

    let items = data?.rss?.channel?.item || data?.channel?.item;
    if (!items) {
      console.warn("No items in RSS for", source.url);
      return [];
    }

    if (!Array.isArray(items)) {
      items = [items];
    }

    return items
      .filter((it) => it.title && it.link)
      .map((it) => {
        const rawDate =
          it.pubDate ||
          it["dc:date"] ||
          it.date ||
          it.updated ||
          it["atom:updated"];

        let date = rawDate ? new Date(rawDate) : new Date();
        if (isNaN(date.getTime())) date = new Date();

        const descriptionRaw =
          it["content:encoded"] || it.description || it.summary || "";
        const description = stripHtml(descriptionRaw);
        const image = extractImageFromItem(it);

        return {
          title: it.title,
          link: it.link,
          date,
          description,
          image,
          source
        };
      });
  } catch (e) {
    console.error("Error fetching RSS for", source.url, e);
    return [];
  }
}

// Собираем все источники и выбираем ОДНУ самую свежую новость
async function getTopItem() {
  const lists = await Promise.all(RSS_SOURCES.map(fetchRssItems));
  const allItems = lists.flat().filter(Boolean);

  if (!allItems.length) return null;

  allItems.sort((a, b) => b.date - a.date);
  return allItems[0]; // самая свежая
}

// Формируем красивый текст на русском для подписи
function buildCaption(item) {
  const title = item.title || "Без названия";
  const descShort = truncate(item.description, 400); // кратко
  const sourceName = item.source.section || item.source.name || "";
  const link = item.link || "";

  const lines = [];

  lines.push("📰 Новость из мира молодежной культуры");
  lines.push("");
  lines.push(`💥 <b>${title}</b>`);
  lines.push("");

  if (descShort) {
    lines.push(descShort);
    lines.push("");
  }

  if (sourceName) {
    lines.push(`Источник: ${sourceName}`);
  }

  if (link) {
    lines.push(link);
  }

  lines.push("");
  lines.push("#мода #музыка #streetwear #youthculture");

  return lines.join("\n");
}

// Vercel handler: 1 запуск = 1 пост = 1 новость
export default async function handler(req, res) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) {
    return res.status(500).json({
      ok: false,
      error: "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID env vars"
    });
  }

  try {
    const item = await getTopItem();

    if (!item) {
      const fallbackText =
        "Сегодня не удалось найти свежие новости по моде и музыке.";
      const tgRes = await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHANNEL_ID,
          text: fallbackText
        })
      });
      const data = await tgRes.json();
      return res.status(200).json({ ok: data.ok, result: data });
    }

    const caption = buildCaption(item);

    // Если есть картинка — шлём sendPhoto, иначе sendMessage
    if (item.image) {
      const tgRes = await fetch(`${TELEGRAM_API}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHANNEL_ID,
          photo: item.image,
          caption,
          parse_mode: "HTML"
        })
      });
      const data = await tgRes.json();

      if (!data.ok) {
        console.error("Telegram sendPhoto error:", data);
        return res.status(500).json({ ok: false, error: data });
      }

      return res.status(200).json({ ok: true, result: data.result });
    } else {
      const tgRes = await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHANNEL_ID,
          text: caption,
          parse_mode: "HTML",
          disable_web_page_preview: false
        })
      });
      const data = await tgRes.json();

      if (!data.ok) {
        console.error("Telegram sendMessage error:", data);
        return res.status(500).json({ ok: false, error: data });
      }

      return res.status(200).json({ ok: true, result: data.result });
    }
  } catch (e) {
    console.error("Unexpected error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
