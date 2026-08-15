import { Telegraf, Markup } from "telegraf";
import { NextResponse } from "next/server";
import axios from "axios";
import SMSGateway from "android-sms-gateway";
import { Product } from "@/types/product";
import { Order } from "@/types/order";
import { ChatRoom } from "@/types/chat";
import * as XLSX from "xlsx";

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

function getDeliveryType(provider?: string | null): string {
  switch (provider) {
    case "nova_poshta":
      return "(Нова Пошта)";
    case "ukrposhta":
      return "(Укрпошта)";
    case "rozetka_delivery":
      return "(Розетка)";
    case "meest_express":
    case "meest":
      return "(Meest Пошта)";
    default:
      return "";
  }
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

bot.command("export", async (ctx) => {
  const PROM_TOKEN = process.env.PROM_API_TOKEN;
  if (!PROM_TOKEN) return ctx.reply("❌ Токен Prom API не налаштовано");

  const loadingMsg = await ctx.reply(
    "⏳ Збираю товари та формую Excel файл...",
  );

  try {
    const headers = { Authorization: `Bearer ${PROM_TOKEN}` };

    // Загружаем заказы
    const ordersRes = await axios.get(
      "https://my.prom.ua/api/v1/orders/list?limit=100&status=received",
      { headers },
    );
    const orders: Order[] = ordersRes.data.orders || [];

    const targetOrders = orders.filter((o) => o.status === "custom-172548");

    if (targetOrders.length === 0) {
      await ctx.telegram.deleteMessage(
        loadingMsg.chat.id,
        loadingMsg.message_id,
      );
      return ctx.reply(
        '📭 Немає замовлень у статусі "На відправлення" для вивантаження.',
      );
    }

    const productMap = new Map<string, any>();

    for (const order of targetOrders) {
      for (const product of order.products) {
        const key = product.sku || product.id.toString();

        if (productMap.has(key)) {
          const existingProduct = productMap.get(key);
          existingProduct.Кількість += product.quantity;
        } else {
          productMap.set(key, {
            "Артикул (SKU)": product.sku || "Немає",
            "Назва товару": product.name || "Без назви",
            Кількість: product.quantity,
            Зображення: product.image || "Немає фото",
          });
        }
      }
    }
    const aggregatedProducts = Array.from(productMap.values());

    const worksheet = XLSX.utils.json_to_sheet(aggregatedProducts);

    worksheet["!cols"] = [
      { wch: 15 }, // Артикул
      { wch: 50 }, // Назва
      { wch: 10 }, // Кількість
      { wch: 60 }, // Зображення (URL)
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Товари для відправки");

    const excelBuffer = XLSX.write(workbook, {
      bookType: "xlsx",
      type: "buffer",
    });

    await ctx.telegram.deleteMessage(loadingMsg.chat.id, loadingMsg.message_id);

    await ctx.replyWithDocument(
      {
        source: Buffer.from(excelBuffer),
        filename: `Збірка_товарів_${new Date().toLocaleDateString("uk-UA").replace(/\./g, "-")}.xlsx`,
      },
      {
        caption: `📦 **Збірний лист готовий!**\n\nВсього унікальних позицій: ${aggregatedProducts.length}`,
      },
    );
  } catch (error: any) {
    ctx.reply(`❌ Помилка при генерації файлу: ${error.message}`);
  }
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
      "https://my.prom.ua/api/v1/orders/list?limit=100&status=received",
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

    // ==========================================
    // РОЗБИВАЄМО ЗАМОВЛЕННЯ НА БЛОКИ (ПО 10 ШТУК)
    // ==========================================
    const chunkSize = 10;
    const totalOrders = targetOrders.length;

    for (let i = 0; i < totalOrders; i += chunkSize) {
      const chunk = targetOrders.slice(i, i + chunkSize);

      // Заголовок для кожної частини
      let combinedText = `📋 Список (${i + 1}-${Math.min(i + chunkSize, totalOrders)} з ${totalOrders}):\n\n`;

      for (const order of chunk) {
        const orderId = order.id;
        const clientName = order.client_first_name || "Без імені";
        const phone = order.phone || "Немає номеру";
        const ttn =
          order.delivery_provider_data?.declaration_number || "Немає ТТН";
        const orderType = getOrderType(order.products);
        const deliveryType = getDeliveryType(
          order.delivery_provider_data?.provider,
        );
        const textMsg = `${orderType} від optotorg.com.ua ${deliveryType}: ${ttn}`;

        const room = chatRooms.find(
          (r) => r.buyer_client_id === order.client_id,
        );
        const statusText = room ? `🟢 Пром-чат (${room.id})` : `📱 Тільки SMS`;

        combinedText += `📦 №${orderId}\n`;
        combinedText += `👤 Клієнт: ${clientName}\n`;
        combinedText += `📞 ${phone}\n`;
        combinedText += `💬 Статус: ${statusText}\n`;
        combinedText += `📝 Текст: ${textMsg}\n`;
        combinedText += `〰️〰️〰️〰️〰️〰️〰️〰️\n`;
      }

      // Відправляємо кожну частину окремим повідомленням
      await sendListMessage(ctx, combinedText);

      // Робимо паузу 0.5 сек між відправкою повідомлень, щоб Telegram не заблокував за спам
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
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
      try {
        await smsgate.send({ phoneNumbers: [phone], message: textToSend });
        smsCount++;
        await new Promise((resolve) => setTimeout(resolve, 2000));
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
