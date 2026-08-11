import { Telegraf, Markup } from "telegraf";
import { NextResponse } from "next/server";
import axios from "axios";
import SMSGateway from "android-sms-gateway";

// ==========================================
// 1. ОГОЛОШЕННЯ ТИПІВ
// ==========================================

interface Product {
  id: number;
  name: string;
  sku: string;
  price: string;
  quantity: number;
  name_multilang?: {
    ru?: string;
    uk?: string;
  };
}

interface DeliveryProviderData {
  provider: string;
  declaration_number?: string | null;
}

interface Order {
  id: number;
  status: string;
  status_name: string;
  client_first_name: string | null;
  client_last_name: string | null;
  phone: string | null;
  delivery_provider_data?: DeliveryProviderData | null;
  products: Product[];
  full_price: string;
}

// ==========================================
// 2. ІНІЦІАЛІЗАЦІЯ
// ==========================================

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

// Спеціальна функція для виводу списку зі згенерованими кнопками редагування
async function sendListMessage(ctx: any, text: string) {
  // Знаходимо всі номери замовлень у тексті списку
  const orderIds = [...text.matchAll(/📦 №(\d+)/g)].map((m) => m[1]);
  const buttons = [];

  // Головна кнопка відправки
  buttons.push([
    Markup.button.callback(
      `📨 Відправити всі SMS (${orderIds.length})`,
      "send_all_sms",
    ),
  ]);

  // Генеруємо кнопки редагування (по 2 в ряд)
  let editRow = [];
  for (const id of orderIds) {
    editRow.push(Markup.button.callback(`✏️ Ред. №${id}`, `edit_${id}`));
    if (editRow.length === 2) {
      buttons.push(editRow);
      editRow = [];
    }
  }
  if (editRow.length > 0) buttons.push(editRow);

  // Використовуємо звичайний текст (без HTML), щоб легше робити заміни тексту
  return ctx.reply(text, Markup.inlineKeyboard(buttons));
}

// ==========================================
// 4. ЛОГІКА БОТА
// ==========================================

bot.start((ctx) => {
  ctx.reply(
    "Привіт! Я бот для обробки замовлень.\n/orders - отримати список розсилки.",
  );
});

bot.command("ping", (ctx) => {
  ctx.reply("🟢 Бот працює та готовий до відправки SMS!");
});

bot.command("orders", async (ctx) => {
  const PROM_TOKEN = process.env.PROM_API_TOKEN;
  if (!PROM_TOKEN) return ctx.reply("❌ Токен Prom API не налаштовано");

  const loadingMsg = await ctx.reply("⏳ Завантажую замовлення...");

  try {
    const apiUrl =
      "https://my.prom.ua/api/v1/orders/list?limit=50&status=received";
    const response = await axios.get(apiUrl, {
      headers: { Authorization: `Bearer ${PROM_TOKEN}` },
    });

    const orders: Order[] = response.data.orders || [];
    const targetOrders = orders.filter(
      (order) => order.status === "custom-172548",
    );

    await ctx.telegram.deleteMessage(loadingMsg.chat.id, loadingMsg.message_id);

    if (targetOrders.length === 0) {
      return ctx.reply('📭 Немає замовлень у статусі "На відправлення".');
    }

    let combinedText = `📋 Список для розсилки (${targetOrders.length} шт):\n\n`;

    for (const order of targetOrders) {
      const orderId = order.id;
      const clientName = order.client_first_name || "Без імені";
      const phone = order.phone || "Немає номеру";
      const ttn =
        order.delivery_provider_data?.declaration_number || "Немає ТТН";

      const orderType = getOrderType(order.products);
      const smsText = `${orderType} від optotorg.com.ua: ${ttn}`;

      // Використовуємо емодзі замість жирного шрифту, щоб працювало редагування
      combinedText += `📦 №${orderId}\n`;
      combinedText += `👤 Клієнт: ${clientName}\n`;
      combinedText += `📞 ${phone}\n`;
      combinedText += `🏷 Тип: ${orderType}\n`;
      combinedText += `💬 SMS: ${smsText}\n`;
      combinedText += `〰️〰️〰️〰️〰️〰️〰️〰️\n`;
    }

    // Відправляємо список з кнопками
    await sendListMessage(ctx, combinedText);
  } catch (error: any) {
    ctx.reply(`❌ Помилка: ${error.message}`);
  }
});

// ОБРОБКА КНОПКИ РЕДАГУВАННЯ
bot.action(/edit_(\d+)/, async (ctx) => {
  const orderId = ctx.match[1];
  // Безпечне отримання тексту:
  const message = ctx.callbackQuery.message;
  const fullText = message && "text" in message ? message.text : "";

  // Знаходимо поточний текст SMS саме для цього замовлення
  const regex = new RegExp(
    `📦 №${orderId}[\\s\\S]*?💬 SMS: ([\\s\\S]*?)(?=\\n〰️)`,
  );
  const match = fullText.match(regex);
  const currentSms = match ? match[1] : "";

  await ctx.answerCbQuery();

  // Видаляємо старий список, щоб не плутатись
  try {
    await ctx.deleteMessage();
  } catch (e) {}

  // Запитуємо новий текст. Ховаємо старий список в самому низу повідомлення.
  await ctx.reply(
    `✍️ Редагування замовлення №${orderId}\n\nПоточний текст:\n${currentSms}\n\nНадішліть новий текст SMS у відповідь на це повідомлення.\n\n👇 Не видаляти (пам'ять бота) 👇\n${fullText}`,
    { reply_markup: { force_reply: true } },
  );
});

// ОБРОБКА НОВОГО ТЕКСТУ ВІД КОРИСТУВАЧА
bot.on("text", async (ctx) => {
  const replyTo = ctx.message.reply_to_message;

  // Якщо це повідомлення є відповіддю на наш запит редагування
  if (
    replyTo &&
    "text" in replyTo &&
    replyTo.text.includes("Редагування замовлення №")
  ) {
    const orderIdMatch = replyTo.text.match(/замовлення №(\d+)/);
    if (!orderIdMatch) return;

    const orderId = orderIdMatch[1];
    const newSmsText = ctx.message.text;

    // Дістаємо старий список з "пам'яті" бота
    const splitMarker = "👇 Не видаляти (пам'ять бота) 👇\n";
    const parts = replyTo.text.split(splitMarker);
    if (parts.length < 2) return;
    const oldFullText = parts[1];

    // Замінюємо СТАРИЙ текст SMS на НОВИЙ тільки для потрібного замовлення
    const regex = new RegExp(
      `(📦 №${orderId}[\\s\\S]*?💬 SMS: )([\\s\\S]*?)(?=\\n〰️)`,
    );
    const updatedText = oldFullText.replace(regex, `$1${newSmsText}`);

    // Прибираємо сліди редагування з чату
    try {
      await ctx.deleteMessage(replyTo.message_id);
      await ctx.deleteMessage(ctx.message.message_id);
    } catch (e) {}

    // Видаємо оновлений список
    await sendListMessage(ctx, updatedText);
  }
});

// ВІДПРАВКА ВСІХ SMS
bot.action("send_all_sms", async (ctx) => {
  const message = ctx.callbackQuery.message;
  let messageText = "";
  if (message && "text" in message) messageText = message.text;

  if (!messageText) return ctx.answerCbQuery("Помилка читання тексту");

  // Витягуємо телефони та тексти SMS. Оновлений Regex підтримує багаторядкові SMS!
  const phoneRegex = /📞\s*(\+?\d+)/g;
  const smsRegex = /💬 SMS: ([\s\S]*?)(?=\n〰️)/g;

  const phones = [...messageText.matchAll(phoneRegex)].map((m) => m[1]);
  const smsTexts = [...messageText.matchAll(smsRegex)].map((m) => m[1]);

  if (phones.length === 0 || phones.length !== smsTexts.length) {
    return ctx.answerCbQuery("❌ Помилка парсингу. Спробуйте оновити /orders", {
      show_alert: true,
    });
  }

  await ctx.answerCbQuery("Починаю відправку...");
  const statusMsg = await ctx.reply(`⏳ Відправляю ${phones.length} SMS...`);

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < phones.length; i++) {
    try {
      await smsgate.send({
        phoneNumbers: [phones[i]],
        message: smsTexts[i].trim(),
      });
      successCount++;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`Помилка відправки на ${phones[i]}:`, error);
      errorCount++;
    }
  }

  await ctx.telegram.editMessageText(
    statusMsg.chat.id,
    statusMsg.message_id,
    undefined,
    `✅ Розсилка завершена!\nУспішно: ${successCount}\nПомилок: ${errorCount}`,
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
