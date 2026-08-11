export interface Product {
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
