import { Product } from "@/types/product";
import { Context, Markup } from "telegraf";

export function getOrderType(products: Product[]): string {
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

export function getDeliveryType(provider?: string | null): string {
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

export async function sendListMessage(ctx: Context, text: string) {
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
