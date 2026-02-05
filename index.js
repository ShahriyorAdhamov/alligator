import { Telegraf } from "telegraf";
import { WEMA } from "technicalindicators";
import YahooFinance from "yahoo-finance2";
import dotenv from "dotenv";

dotenv.config(); // Загружаем BOT_TOKEN и CHAT_ID из .env

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const bot = new Telegraf(BOT_TOKEN);

const SYMBOLS = [
  "AAPL","MSFT","NVDA","GOOGL","AMZN",
  "META","TSLA","GIII","SMCI","AMD","NFLX"
];
const TIMEFRAME = "1d";
let isScanning = false;
const delay = (ms) => new Promise(res => setTimeout(res, ms));

const yahooFinance = new YahooFinance();

// ===== Получение свечей =====
async function getCandles(symbol) {
  try {
    const now = new Date();
    const past = new Date();
    past.setFullYear(now.getFullYear() - 1);

    const candles = await yahooFinance.historical(symbol, {
      period1: past,
      period2: now,
      interval: TIMEFRAME
    });

    if (!candles || candles.length < 50) return null;

    return candles.map(c => ({
      hl2: (c.high + c.low) / 2,
      close: c.close,
      date: c.date
    }));
  } catch (e) {
    console.log(`Ошибка ${symbol}:`, e.message);
    return null;
  }
}

// ===== Аллигатор =====
function calculateAlligator(values) {
  return {
    jaw: WEMA.calculate({ period: 13, values }),
    teeth: WEMA.calculate({ period: 8, values }),
    lips: WEMA.calculate({ period: 5, values })
  };
}

// ===== Проверка сигнала =====
// ===== Проверка сигнала =====
async function checkSymbol(symbol) {
  const data = await getCandles(symbol);
  if (!data) return;

  const hl2 = data.map(d => d.hl2);
  const { jaw, teeth, lips } = calculateAlligator(hl2);

  const price = data.at(-1).close;
  const vJaw = jaw.at(-1);
  const vTeeth = teeth.at(-1);
  const vLips = lips.at(-1);

  let signal = null; // Если пересечения нет — null

  // Проверяем последние 3 свечи на пересечение цены с Teeth
  for (let i = 0; i < 3; i++) {
    const idx = data.length - 1 - i;
    const t = teeth.length - 1 - i;

    if (idx < 1 || t < 1) continue;

    const prevClose = data[idx - 1].close;
    const curClose = data[idx].close;
    const prevTeeth = teeth[t - 1];
    const curTeeth = teeth[t];

    // Пересечение снизу вверх → LONG
    if (prevClose < prevTeeth && curClose > curTeeth) {
      signal = `✅ LONG (пересечение Teeth ценой ${i === 0 ? "СЕЙЧАС" : `${i} свечей назад`})`;
      break;
    }

    // Пересечение сверху вниз → SHORT
    if (prevClose > prevTeeth && curClose < curTeeth) {
      signal = `❌ SHORT (пересечение Teeth ценой ${i === 0 ? "СЕЙЧАС" : `${i} свечей назад`})`;
      break;
    }
  }

  // Отправляем сообщение только если есть сигнал
  if (signal) {
    const msg =
`**#${symbol} (1D)**
Цена: ${price.toFixed(2)}

🟢 Lips: ${vLips.toFixed(2)}
🔴 Teeth: ${vTeeth.toFixed(2)}
🔵 Jaw: ${vJaw.toFixed(2)}

Результат: ${signal}`;

    await bot.telegram.sendMessage(CHAT_ID, msg, { parse_mode: "Markdown" });
  }
}


// ===== Сканирование =====
async function scanMarket(ctx = null) {
  if (isScanning) {
    const id = ctx ? ctx.chat.id : CHAT_ID;
    return bot.telegram.sendMessage(id, "⏳ Сканирование уже идёт...");
  }

  isScanning = true;
  const id = ctx ? ctx.chat.id : CHAT_ID;
  await bot.telegram.sendMessage(id, "🐊 Аллигатор: сканирование...");

  for (const s of SYMBOLS) {
    await checkSymbol(s);
    await delay(1500);
  }

  await bot.telegram.sendMessage(id, "✅ Сканирование завершено");
  isScanning = false;
}

// ===== Интерфейс Telegram =====
bot.start(ctx => {
  ctx.reply(
    "🐊 Аллигатор Вильямса\n\nНажмите кнопку для поиска сигналов",
    {
      reply_markup: {
        keyboard: [[{ text: "🔍 Начать сканирование" }]],
        resize_keyboard: true
      }
    }
  );
});

bot.on("text", ctx => {
  if (ctx.message.text === "🔍 Начать сканирование") {
    scanMarket(ctx);
  }
});

// ===== Автосканирование каждый день в 20:00 Ташкент =====
function scheduleTask() {
  const now = new Date();
  const target = new Date();
  target.setUTCHours(15, 0, 0, 0); // 20:00 Ташкент = 15:00 UTC

  if (target <= now) target.setUTCDate(target.getUTCDate() + 1);

  setTimeout(() => {
    scanMarket();
    scheduleTask();
  }, target - now);
}

// ===== Старт =====
bot.launch().then(() => {
  console.log("Бот запущен ✅");
  scheduleTask();
});

process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());
