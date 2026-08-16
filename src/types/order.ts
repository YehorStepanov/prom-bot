import { Product } from "./product";

export interface DeliveryProviderData {
  provider: string;
  declaration_number?: string | null;
}

export interface Order {
  id: number;
  status: string;
  status_name: string;
  client_id: number;
  client_first_name: string | null;
  client_last_name: string | null;
  phone: string | null;
  email?: string | null;
  payment_option?: { name: string };
  delivery_provider_data?: DeliveryProviderData | null;
  products: Product[];
  full_price: string;
}
