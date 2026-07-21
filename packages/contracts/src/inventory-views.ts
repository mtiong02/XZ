/**
 * 只读视图类型（docs/03 §6.1）。由 API 返回、Web 消费。
 */

export type ExpiryStatus = 'NORMAL' | 'EXPIRING' | 'EXPIRED' | 'UNKNOWN';

export interface InventoryItemView {
  food_id: string;
  name: string;
  category: string;
  category_code: string;
  total_quantity: string;
  unit: string;
  earliest_expiry: string | null;
  expiry_status: ExpiryStatus;
  lot_count: number;
}

export interface InventoryZoneView {
  zone_id: string;
  code: 'FRIDGE' | 'FREEZER' | 'PANTRY';
  name: string;
  items: InventoryItemView[];
}

export interface InventoryView {
  household_id: string;
  revision: number;
  zones: InventoryZoneView[];
}

export interface TransactionView {
  id: string;
  transaction_type: 'ADD' | 'CONSUME' | 'DISCARD' | 'CORRECT' | 'MOVE' | 'REVERSAL';
  food_id: string;
  food_name: string;
  quantity_delta: string;
  unit: string;
  source_channel: string;
  actor_member_id: string;
  actor_display_name: string;
  reversed_transaction_id: string | null;
  reversed_by_transaction_id: string | null;
  created_at: string;
}

export interface CommandResult {
  command_id: string;
  transaction_id: string;
  idempotent_replay: boolean;
  revision: number;
}
