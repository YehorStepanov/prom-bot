import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import ProductStock from "@/models/ProductStock";

export async function POST(req: Request) {
  try {
    const productsList = await req.json();

    if (!Array.isArray(productsList) || productsList.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Тіло запиту має бути масивом товарів." },
        { status: 400 },
      );
    }
    await dbConnect();
    const bulkOps = productsList.map((prod) => ({
      updateOne: {
        filter: { sku: prod.sku },
        update: {
          $set: {
            name: prod.name || prod.sku,
            quantity: prod.quantity || 0,
          },
        },
        upsert: true,
      },
    }));

    const result = await ProductStock.bulkWrite(bulkOps);

    console.log(
      `📥 Імпорт завершено: Створено ${result.upsertedCount}, Оновлено ${result.modifiedCount}`,
    );

    return NextResponse.json({
      ok: true,
      message: "Товари успішно імпортовано.",
      details: {
        total: productsList.length,
        created: result.upsertedCount,
        updated: result.modifiedCount,
      },
    });
  } catch (error: any) {
    console.error("❌ Помилка імпорту:", error);
    return NextResponse.json(
      {
        ok: false,
        error: `Помилка сервера: ${error.message}`,
      },
      { status: 500 },
    );
  }
}
