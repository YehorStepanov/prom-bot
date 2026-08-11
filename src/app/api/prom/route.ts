import { Telegraf, Markup } from "telegraf";
import { NextResponse } from "next/server";

// Инициализируем бота и берем ваш ID из настроек
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN as string);

export async function POST(req: Request) {
  try {
    // Получаем данные от Prom
    const body = await req.json();

    // Prom присылает данные в объекте "order".
    // Делаем безопасное извлечение, чтобы бот не упал, если какого-то поля нет
    const order = body.order || {};
    const orderId = order.id || "Неизвестно";
    const clientName =
      order.client_first_name || order.client_name || "Без имени";
    const phone = order.phone || "Нет номера";
    const price = order.price || "0";

    // Формируем текст с HTML-разметкой
    const orderText = `📦 <b>Новый заказ №${orderId}</b>\n\n👤 Клиент: ${clientName}\n📞 Телефон: ${phone}\n💰 Сумма: ${price} грн`;

    // Отправляем сообщение напрямую вам (по ID), добавляя кнопки
    await bot.telegram.sendMessage(
      process.env.MY_CHAT_ID as string,
      orderText,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "💳 Отправить реквизиты",
              `send_req_${orderId}`,
            ),
          ],
          [
            Markup.button.callback(
              "🚚 Ввести номер ТТН",
              `enter_ttn_${orderId}`,
            ),
          ],
        ]),
      },
    );

    // Возвращаем 200 OK, чтобы Prom знал, что мы всё получили
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Ошибка обработки заказа с Prom:", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
