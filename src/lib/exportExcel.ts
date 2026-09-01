import { Order } from "@/types/order";
import ExcelJS from "exceljs";
import axios from "axios";
import { mainMenu } from "@/app/api/telegram/route";

export async function exportOrdersExcel(
  ctx: any,
  filterType: "received" | "paid" | "processing",
) {
  const PROM_TOKEN = process.env.PROM_API_TOKEN;
  if (!PROM_TOKEN)
    return ctx.reply("❌ Токен Prom API не налаштовано", mainMenu);

  let typeName = "";
  if (filterType === "received") typeName = "Нові (Прийняті)";
  if (filterType === "paid") typeName = "Оплачені";
  if (filterType === "processing") typeName = "В обробці";

  const loadingMsg = await ctx.reply(
    `⏳ Завантажую замовлення [${typeName}] та формую Excel...`,
  );

  try {
    const headers = { Authorization: `Bearer ${PROM_TOKEN}` };
    let targetOrders: Order[] = [];
    if (filterType === "received") {
      const ordersRes = await axios.get(
        "https://my.prom.ua/api/v1/orders/list?limit=100&status=received",
        { headers },
      );
      targetOrders = ordersRes.data.orders;
    }
    if (filterType === "paid") {
      const ordersRes = await axios.get(
        "https://my.prom.ua/api/v1/orders/list?limit=100&status=paid",
        { headers },
      );
      targetOrders = ordersRes.data.orders;
    } else {
      const ordersRes = await axios.get(
        "https://my.prom.ua/api/v1/orders/list?limit=100&status=received",
        { headers },
      );
      const orders: Order[] = ordersRes.data.orders || [];
      targetOrders = orders.filter((o) => o.status === "custom-172802");
    }

    if (targetOrders.length === 0) {
      await ctx.telegram.deleteMessage(
        loadingMsg.chat.id,
        loadingMsg.message_id,
      );
      return ctx.reply(
        `📭 Немає замовлень у категорії "${typeName}".`,
        mainMenu,
      );
    }

    const workbook = new ExcelJS.Workbook();
    const sheetOrders = workbook.addWorksheet("Замовлення (Менеджер)");
    sheetOrders.columns = [
      { header: "Номер", key: "id", width: 15 },
      { header: "Телефон", key: "phone", width: 20 },
      { header: "Оплата", key: "payment", width: 25 },
      { header: "Товари", key: "products", width: 60 },
      { header: "Сума", key: "price", width: 15 },
    ];
    sheetOrders.getRow(1).font = { bold: true };

    targetOrders.forEach((order) => {
      const productsList = order.products
        .map((p) => `${p.name} (${p.quantity} шт.)`)
        .join(";\n");
      sheetOrders.addRow({
        id: order.id,
        phone: order.phone || "Немає номеру",
        payment: order.payment_option?.name || "Не вказано",
        products: productsList,
        price: Number(order.full_price.replace(/\s/g, "")) || order.full_price,
      });
    });

    const productMap = new Map<string, any>();
    for (const order of targetOrders) {
      for (const product of order.products) {
        const key = product.sku || product.id.toString();
        if (productMap.has(key)) {
          productMap.get(key).Кількість += product.quantity;
        } else {
          productMap.set(key, {
            Артикул: product.sku || "Немає",
            Назва: product.name || "Без назви",
            Кількість: product.quantity,
            Зображення: product.image || null,
          });
        }
      }
    }

    const aggregatedProducts = Array.from(productMap.values());
    const sheetWarehouse = workbook.addWorksheet("Збірка (Склад)");
    sheetWarehouse.columns = [
      { header: "Артикул", key: "sku", width: 15 },
      { header: "Назва товару", key: "name", width: 60 },
      { header: "Кількість", key: "qty", width: 12 },
      { header: "Фото", key: "image", width: 15 },
    ];
    sheetWarehouse.getRow(1).font = { bold: true };

    for (let i = 0; i < aggregatedProducts.length; i++) {
      const prod = aggregatedProducts[i];
      const row = sheetWarehouse.addRow({
        sku: prod["Артикул"],
        name: prod["Назва"],
        qty: prod["Кількість"],
      });
      row.height = 80;

      const imageUrl = prod["Зображення"];
      if (imageUrl && imageUrl.startsWith("http")) {
        try {
          const imageRes = await axios.get(imageUrl, {
            responseType: "arraybuffer",
          });
          const imageId = workbook.addImage({
            buffer: imageRes.data,
            extension: "jpeg",
          });
          sheetWarehouse.addImage(imageId, {
            tl: { col: 3, row: i + 1 },
            ext: { width: 75, height: 75 },
          });
        } catch (e) {
          console.log(`Не завантажилось фото: ${prod["Артикул"]}`);
        }
      }
    }

    const excelBuffer = await workbook.xlsx.writeBuffer();
    await ctx.telegram.deleteMessage(loadingMsg.chat.id, loadingMsg.message_id);

    await ctx.replyWithDocument(
      {
        source: Buffer.from(excelBuffer),
        filename: `Звіт_${typeName}_${new Date().toLocaleDateString("uk-UA").replace(/\./g, "-")}.xlsx`,
      },
      {
        caption: `📊 **Звіт згенеровано!**\n\n🔹 Категорія: ${typeName}\n🔹 Замовлень: ${targetOrders.length}\n🔹 Унікальних товарів: ${aggregatedProducts.length}`,
        ...mainMenu,
      },
    );
  } catch (error: any) {
    ctx.telegram.editMessageText(
      loadingMsg.chat.id,
      loadingMsg.message_id,
      undefined,
      `❌ Помилка: ${error.message}`,
    );
  }
}
