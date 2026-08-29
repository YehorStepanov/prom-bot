import { Telegraf } from "telegraf";
import { NextResponse } from "next/server";
import axios from "axios";
import SMSGateway from "android-sms-gateway";
import { Order } from "@/types/order";
import { ChatRoom } from "@/types/chat";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import {
  getOrderType,
  getDeliveryType,
  sendListMessage,
} from "@/lib/utils/func";
import dbConnect from "@/lib/mongodb";
import ProductStock from "@/models/ProductStock";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN as string);

const OWNER_ID = process.env.MY_CHAT_ID;

const smsgate = new SMSGateway(
  process.env.SMSGATE_LOGIN as string,
  process.env.SMSGATE_PASSWORD as string,
);

bot.telegram
  .setMyCommands([
    { command: "export", description: "Експортувати замовлення з Prom" },
    { command: "orders", description: "Отримати список розсилки SMS" },
    { command: "ping", description: "Перевірити статус бота" },
  ])
  .catch(console.error);

const isOwner = (ctx: any, next: any) => {
  if (ctx.from?.id !== OWNER_ID) {
    return ctx.reply(
      "⛔️ Доступ заборонено. Тільки власник може керувати складом.",
    );
  }
  return next();
};

bot.command("ping", async (ctx) => {
  ctx.reply("🏓 Pong! Бот працює.");
});

bot.on("document", isOwner, async (ctx) => {
  const document = ctx.message.document;

  // Перевіряємо, чи це Excel файл
  if (
    !document.mime_type?.includes("officedocument.spreadsheetml.sheet") &&
    !document.file_name?.endsWith(".xlsx")
  ) {
    return ctx.reply(
      "❌ Помилка: Я приймаю тільки файли формату Excel (.xlsx).",
    );
  }

  const statusMsg = await ctx.reply("⏳ Завантажую та обробляю файл...");

  try {
    await dbConnect();
    const fileUrl = await ctx.telegram.getFileLink(document.file_id);

    // 2. Скачуємо файл в буфер
    const response = await axios.get(fileUrl.href, {
      responseType: "arraybuffer",
    });
    const buffer = Buffer.from(response.data);

    // 3. Відкриваємо Excel книгу
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const worksheet = workbook.getWorksheet(1);

    if (!worksheet) {
      throw new Error("Файл порожній або не має сторінок.");
    }

    const bulkOps: any[] = [];
    let rowsProcessed = 0;
    const errors: string[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const skuCell = row.getCell(1).value;
      const valueCell = row.getCell(2).value;
      const nameCell = row.getCell(3).value;

      // Чистимо дані
      const sku = skuCell?.toString().trim();
      const valueStr = valueCell?.toString().trim();
      const name = nameCell?.toString().trim();

      if (!sku || !valueStr) {
        if (sku || valueStr)
          errors.push(`Рядок ${rowNumber}: Пропущено SKU або Кількість`);
        return;
      }

      // --- КЛЮЧОВА ЛОГІКА: Перевірка на коригування (+/-) ---
      const adjustmentMatch = valueStr.match(/^([+-])?(\d+)$/);

      if (!adjustmentMatch) {
        errors.push(
          `Рядок ${rowNumber}: Невірний формат кількості '${valueStr}'. Очікувалося число, +число або -число.`,
        );
        return;
      }

      const sign = adjustmentMatch[1]; // '+' або '-' або undefined
      const amount = parseInt(adjustmentMatch[2]);

      const updateOp: any = {
        $set: { sku: sku },
      };

      // Якщо товар новий, додаємо назву
      if (name) {
        updateOp.$setOnInsert = { name: name };
      } else if (!sign && name === undefined) {
        // Якщо SKU існує і ми робимо абсолютний set, але назва не вказана - не міняємо назву
      } else if (name) {
        updateOp.$set.name = name; // Оновити назву існуючого товару
      }

      if (!sign) {
        // 1. Абсолютне значення (напр: 100) -> Встановити точну кількість
        updateOp.$set.quantity = amount;
        // Якщо товар новий, setOnInsert поставить 100. Якщо існує, $set перепише на 100.
      } else {
        // 2. Коригування (напр: +50 або -10) -> Використовуємо $inc
        const adjustment = sign === "+" ? amount : -amount;
        updateOp.$inc = { quantity: adjustment };

        // Якщо товар новий, ініціалізуємо його з 0, а потім $inc зробить його +50 або -10
        if (!updateOp.$setOnInsert) updateOp.$setOnInsert = {};
        updateOp.$setOnInsert.quantity = 0;
      }

      bulkOps.push({
        updateOne: {
          filter: { sku: sku },
          update: updateOp,
          upsert: true,
        },
      });

      rowsProcessed++;
    });

    if (bulkOps.length === 0) {
      await ctx.telegram.deleteMessage(statusMsg.chat.id, statusMsg.message_id);
      return ctx.reply("📭 У файлі не знайдено коректних даних для імпорту.");
    }
    const result = await ProductStock.bulkWrite(bulkOps);

    let report = `✅ **Імпорт завершено!**\n\n`;
    report += `📊 Оброблено рядків: ${rowsProcessed}\n`;
    report += `🔹 Створено нових товарів: ${result.upsertedCount}\n`;
    report += `🔄 Оновлено позицій: ${result.modifiedCount}\n`; // modifiedCount показує тільки змінені $inc або $set

    if (errors.length > 0) {
      report += `\n⚠️ **Помилки (${Math.min(errors.length, 5)} з ${errors.length}):**\n`;
      report += errors.slice(0, 5).join("\n");
      if (errors.length > 5) report += "\n...та інші";
    }

    await ctx.telegram.editMessageText(
      statusMsg.chat.id,
      statusMsg.message_id,
      undefined,
      report,
      { parse_mode: "Markdown" },
    );
  } catch (error: any) {
    console.error("❌ Помилка Excel імпорту:", error);
    await ctx.telegram.editMessageText(
      statusMsg.chat.id,
      statusMsg.message_id,
      undefined,
      `❌ Критична помилка імпорту: ${error.message}`,
    );
  }
});

bot.command("stock", isOwner, async (ctx) => {
  try {
    await dbConnect();
    const stockItems = await ProductStock.find({}).sort({ sku: 1 });

    if (stockItems.length === 0) return ctx.reply("📭 Склад порожній.");

    let text = `📋 **Поточний склад:**\n\n`;
    stockItems.forEach((item) => {
      text += `🔹 \`${item.sku}\`: **${item.quantity}** шт. (${item.name || "Без назви"})\n`;
    });

    // Дробимо довгі повідомлення (для надійності)
    if (text.length > 4000) {
      for (let i = 0; i < text.length; i += 4000) {
        await ctx.reply(text.substring(i, i + 4000), {
          parse_mode: "Markdown",
        });
      }
    } else {
      await ctx.reply(text, { parse_mode: "Markdown" });
    }
  } catch (e: any) {
    ctx.reply(`Помилка: ${e.message}`);
  }
});

bot.command("export", async (ctx) => {
  const PROM_TOKEN = process.env.PROM_API_TOKEN;
  if (!PROM_TOKEN) return ctx.reply("❌ Токен Prom API не налаштовано");

  const loadingMsg = await ctx.reply("⏳ Формую Excel файл...");

  try {
    const headers = { Authorization: `Bearer ${PROM_TOKEN}` };

    const ordersRes = await axios.get(
      "https://my.prom.ua/api/v1/orders/list?limit=100&status=received",
      { headers },
    );
    const orders: Order[] = ordersRes.data.orders || [];
    const targetOrders = orders.filter((o) => o.status === "custom-172802");

    if (targetOrders.length === 0) {
      await ctx.telegram.deleteMessage(
        loadingMsg.chat.id,
        loadingMsg.message_id,
      );
      return ctx.reply('📭 Немає замовлень у статусі "На формування".');
    }
    const ordersData = targetOrders.map((order) => {
      const productsList = order.products
        .map((p) => `${p.sku} (${p.quantity} шт.)`)
        .join(";\n");

      return {
        "Номер замовлення": order.id,
        Телефон: order.phone || "Немає номеру",
        "Спосіб оплати": order.payment_option?.name || "Не вказано",
        Товари: productsList,
        "Сума (грн)":
          Number(order.full_price.replace(/\s/g, "")) || order.full_price, // Пытаемся сделать числом для Excel
      };
    });

    const worksheetOrders = XLSX.utils.json_to_sheet(ordersData);
    worksheetOrders["!cols"] = [
      { wch: 18 }, // Номер
      { wch: 20 }, // Телефон
      { wch: 30 }, // Спосіб оплати
      { wch: 70 }, // Товари (широкая колонка)
      { wch: 15 }, // Сума
    ];

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
    const worksheetWarehouse = XLSX.utils.json_to_sheet(aggregatedProducts);
    worksheetWarehouse["!cols"] = [
      { wch: 15 }, // Артикул
      { wch: 60 }, // Назва
      { wch: 10 }, // Кількість
      { wch: 50 }, // Зображення
    ];
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheetOrders, "Замовлення");
    XLSX.utils.book_append_sheet(workbook, worksheetWarehouse, "Товари");

    const excelBuffer = XLSX.write(workbook, {
      bookType: "xlsx",
      type: "buffer",
    });

    await ctx.telegram.deleteMessage(loadingMsg.chat.id, loadingMsg.message_id);

    await ctx.replyWithDocument(
      {
        source: Buffer.from(excelBuffer),
        filename: `Збірка_Товарів_${new Date().toLocaleDateString("uk-UA").replace(/\./g, "-")}.xlsx`,
      },
      {
        caption: `📦 Звіт згенеровано!\n\n🔹 Замовлень: ${targetOrders.length}\n🔹 Унікальних товарів: ${aggregatedProducts.length}`,
      },
    );
  } catch (error: any) {
    ctx.reply(`❌ Помилка при генерації файлу: ${error.message}`);
  }
});

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
