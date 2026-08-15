export interface Product {
  id: number;
  name: string;
  sku: string;
  price: string;
  quantity: number;
  image?: string;
  name_multilang?: {
    ru?: string;
    uk?: string;
  };
}
