import mongoose, { Schema, Document } from "mongoose";

export interface IProductStock extends Document {
  sku: string;
  name?: string;
  quantity: number;
}

const ProductStockSchema: Schema = new Schema({
  sku: { type: String, required: true, unique: true, index: true },
  name: { type: String },
  quantity: { type: Number, required: true, default: 0 },
});

export default mongoose.models.ProductStock ||
  mongoose.model<IProductStock>("ProductStock", ProductStockSchema);
