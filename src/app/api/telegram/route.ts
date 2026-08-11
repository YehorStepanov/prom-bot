import { Telegraf, Markup } from "telegraf";
import { NextResponse } from "next/server";
import axios from "axios";
import SMSGateway from "android-sms-gateway";
import { Product } from "@/types/product";
import { Order } from "@/types/order";
import { ChatRoom } from "@/types/chat";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN as string);

const smsgate = new SMSGateway(
  process.env.SMSGATE_LOGIN as string,
  process.env.SMSGATE_PASSWORD as string,
);

bot.telegram
  .setMyCommands([
    { command: "orders", description: "Отримати список розсилки SMS" },
    { command: "ping", description: "Перевірити статус бота" },
  ])
  .catch(console.error);

// ==========================================
// 3. ДОПОМІЖНІ ФУНКЦІЇ
// ==========================================

function getOrderType(products: Product[]): string {
  const allNames = products
    .map((p) => {
      const nameRu = p.name_multilang?.ru?.toLowerCase() || "";
      const nameUk = p.name_multilang?.uk?.toLowerCase() || "";
      return nameRu + " " + nameUk + " " + p.name.toLowerCase();
    })
    .join(" ");

  if (
    allNames.includes("шнурк") ||
    allNames.includes("липучк") ||
    allNames.includes("блискавк") ||
    allNames.includes("молния") ||
    allNames.includes("ланцюж") ||
    allNames.includes("цепочк")
  )
    return "Фурнітура";
  if (
    allNames.includes("комар") ||
    allNames.includes("раптор") ||
    allNames.includes("москіт") ||
    allNames.includes("фумігатор") ||
    allNames.includes("комах") ||
    allNames.includes("дихлофос") ||
    allNames.includes("тарган") ||
    allNames.includes("мурах") ||
    allNames.includes("моль")
  )
    return "Засоби від комах";
  if (
    allNames.includes("очисник") ||
    allNames.includes("очиститель") ||
    allNames.includes("нейтралізатор") ||
    allNames.includes("засіб") ||
    allNames.includes("мастика") ||
    allNames.includes("біоактиватор")
  )
    return "Побутова хімія";
  if (
    allNames.includes("обкладинк") ||
    allNames.includes("обложка") ||
    allNames.includes("посвідчен") ||
    allNames.includes("удостоверен")
  )
    return "Галантерея";
  if (
    allNames.includes("крем") ||
    allNames.includes("фарба") ||
    allNames.includes("краска") ||
    allNames.includes("губка") ||
    allNames.includes("устілк") ||
    allNames.includes("стельк") ||
    allNames.includes("дезодорант") ||
    allNames.includes("щітка") ||
    allNames.includes("coccine")
  )
    return "Догляд за взуттям";
  if (
    allNames.includes("відро") ||
    allNames.includes("ведро") ||
    allNames.includes("ріжок")
  )
    return "Госптовари";

  return "Замовлення";
}

async function sendListMessage(ctx: any, text: string) {
  const orderIds = [...text.matchAll(/📦 №(\d+)/g)].map((m) => m[1]);
  const buttons = [];

  buttons.push([
    Markup.button.callback(
      `📨 Відправити всі (${orderIds.length})`,
      "send_all_sms",
    ),
  ]);

  let editRow = [];
  for (const id of orderIds) {
    editRow.push(Markup.button.callback(`✏️ Ред. №${id}`, `edit_${id}`));
    if (editRow.length === 2) {
      buttons.push(editRow);
      editRow = [];
    }
  }
  if (editRow.length > 0) buttons.push(editRow);

  return ctx.reply(text, Markup.inlineKeyboard(buttons));
}

bot.command("ping", async (ctx) => {
  ctx.reply("🏓 Pong! Бот працює.");
});
// Спеціальна функція для виводу списку зі згенерованими кнопками редагування
bot.command("orders", async (ctx) => {
  const PROM_TOKEN = process.env.PROM_API_TOKEN;
  if (!PROM_TOKEN) return ctx.reply("❌ Токен Prom API не налаштовано");

  const loadingMsg = await ctx.reply(
    "⏳ Завантажую замовлення та перевіряю чати Prom...",
  );

  try {
    const headers = { Authorization: `Bearer ${PROM_TOKEN}` };

    // 1. Отримуємо замовлення
    const ordersRes = await axios.get(
      "https://my.prom.ua/api/v1/orders/list?limit=50&status=received",
      { headers },
    );
    const orders: Order[] = ordersRes.data.orders || [];
    const targetOrders = orders.filter((o) => o.status === "custom-172548");

    if (targetOrders.length === 0) {
      await ctx.telegram.deleteMessage(
        loadingMsg.chat.id,
        loadingMsg.message_id,
      );
      return ctx.reply('📭 Немає замовлень у статусі "На відправлення".');
    }

    // 2. Отримуємо чати компанії (якщо метод підтримується)
    let chatRooms: ChatRoom[] = [];
    try {
      const chatsRes = await axios.get("https://my.prom.ua/api/v1/chat/rooms", {
        headers,
      });
      chatRooms = chatsRes.data?.data?.rooms || chatsRes.data?.rooms || [];
    } catch (e) {
      console.log("Не вдалося завантажити чати, продовжуємо без них", e);
    }

    await ctx.telegram.deleteMessage(loadingMsg.chat.id, loadingMsg.message_id);
    let combinedText = `📋 Список для розсилки (${targetOrders.length} шт):\n\n`;

    for (const order of targetOrders) {
      const orderId = order.id;
      const clientName = order.client_first_name || "Без імені";
      const phone = order.phone || "Немає номеру";
      const ttn =
        order.delivery_provider_data?.declaration_number || "Немає ТТН";

      const orderType = getOrderType(order.products);
      const textMsg = `${orderType} від optotorg.com.ua: ${ttn}`;

      const room = chatRooms.find((r) => r.buyer_client_id === order.client_id);
      const statusText = room ? `🟢 Пром-чат (${room.id})` : `📱 Тільки SMS`;

      combinedText += `📦 №${orderId}\n`;
      combinedText += `👤 Клієнт: ${clientName}\n`;
      combinedText += `📞 ${phone}\n`;
      combinedText += `💬 Статус: ${statusText}\n`;
      combinedText += `📝 Текст: ${textMsg}\n`;
      combinedText += `〰️〰️〰️〰️〰️〰️〰️〰️\n`;
    }

    await sendListMessage(ctx, combinedText);
  } catch (error: any) {
    ctx.reply(`❌ Помилка: ${error.message}`);
  }
});

// ОБРОБКА КНОПКИ РЕДАГУВАННЯ
bot.action(/edit_(\d+)/, async (ctx) => {
  const orderId = ctx.match[1];
  const message = ctx.callbackQuery.message;
  const fullText = message && "text" in message ? message.text : "";

  // Оновлений Regex для пошуку поля "📝 Текст:"
  const regex = new RegExp(
    `📦 №${orderId}[\\s\\S]*?📝 Текст: ([\\s\\S]*?)(?=\\n〰️)`,
  );
  const match = fullText.match(regex);
  const currentSms = match ? match[1] : "";

  await ctx.answerCbQuery();
  try {
    await ctx.deleteMessage();
  } catch (e) {}

  await ctx.reply(
    `✍️ Редагування замовлення №${orderId}\n\nПоточний текст:\n${currentSms}\n\nНадішліть новий текст у відповідь.\n\n👇 Не видаляти (пам'ять бота) 👇\n${fullText}`,
    { reply_markup: { force_reply: true } },
  );
});

// ОБРОБКА НОВОГО ТЕКСТУ
bot.on("text", async (ctx) => {
  const replyTo = ctx.message.reply_to_message;

  if (
    replyTo &&
    "text" in replyTo &&
    replyTo.text.includes("Редагування замовлення №")
  ) {
    const orderIdMatch = replyTo.text.match(/замовлення №(\d+)/);
    if (!orderIdMatch) return;

    const orderId = orderIdMatch[1];
    const newText = ctx.message.text;

    const parts = replyTo.text.split("👇 Не видаляти (пам'ять бота) 👇\n");
    if (parts.length < 2) return;
    const oldFullText = parts[1];

    const regex = new RegExp(
      `(📦 №${orderId}[\\s\\S]*?📝 Текст: )([\\s\\S]*?)(?=\\n〰️)`,
    );
    const updatedText = oldFullText.replace(regex, `$1${newText}`);

    try {
      await ctx.deleteMessage(replyTo.message_id);
      await ctx.deleteMessage(ctx.message.message_id);
    } catch (e) {}

    await sendListMessage(ctx, updatedText);
  }
});

// ВІДПРАВКА ВСІХ ПОВІДОМЛЕНЬ (Гібридна: Чат + SMS)
bot.action("send_all_sms", async (ctx) => {
  const message = ctx.callbackQuery.message;
  const messageText = message && "text" in message ? message.text : "";

  if (!messageText) return ctx.answerCbQuery("Помилка читання тексту");
  await ctx.answerCbQuery("Починаю відправку...");

  // Розбиваємо весь текст на блоки по кожному замовленню
  const blocks = messageText
    .split("〰️〰️〰️〰️〰️〰️〰️〰️")
    .filter((b) => b.trim().length > 10);

  const statusMsg = await ctx.reply(
    `⏳ Обробляю ${blocks.length} замовлень...`,
  );
  const PROM_TOKEN = process.env.PROM_API_TOKEN;

  let smsCount = 0;
  let chatCount = 0;
  let errorCount = 0;

  for (const block of blocks) {
    const phoneMatch = block.match(/📞\s*(\+?\d+)/);
    const textMatch = block.match(/📝 Текст:\s*([\s\S]*)$/);
    const roomMatch = block.match(/🟢 Пром-чат \((\d+)\)/); // Перевіряємо чи є ID чату

    if (!phoneMatch || !textMatch) continue;

    const phone = phoneMatch[1];
    const textToSend = textMatch[1].trim();

    if (roomMatch && PROM_TOKEN) {
      // 1. ВАРІАНТ: Є Пром-чат -> Відправляємо через API Prom
      const roomId = roomMatch[1];
      try {
        await axios.post(
          `https://my.prom.ua/api/v1/chat/rooms/${roomId}/messages`,
          {
            text: textToSend,
          },
          {
            headers: { Authorization: `Bearer ${PROM_TOKEN}` },
          },
        );
        chatCount++;
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Затримка для Prom API
      } catch (error) {
        console.error(`Помилка Prom-чату для кімнати ${roomId}:`, error);
        errorCount++;
        // Як варіант на майбутнє: тут можна додати fallback на SMS, якщо чат не пройшов
      }
    } else {
      // 2. ВАРІАНТ: Тільки SMS -> Відправляємо через SMSGate
      try {
        await smsgate.send({ phoneNumbers: [phone], message: textToSend });
        smsCount++;
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Затримка для Android SMS
      } catch (error) {
        console.error(`Помилка SMS на номер ${phone}:`, error);
        errorCount++;
      }
    }
  }

  await ctx.telegram.editMessageText(
    statusMsg.chat.id,
    statusMsg.message_id,
    undefined,
    `✅ Розсилка завершена!\n\n💬 У Пром-чат: ${chatCount}\n📱 По SMS: ${smsCount}\n❌ Помилок: ${errorCount}`,
  );

  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await bot.handleUpdate(body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
