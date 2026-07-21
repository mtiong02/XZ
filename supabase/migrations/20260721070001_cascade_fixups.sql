-- 修复家庭数据删除（隐私合规，docs/02 §15.3）时的级联缺口。
-- inventory_transaction_entries.lot_id 原先无 on delete 行为，导致删除家庭时
-- inventory_lots 被引用而无法级联删除。交易明细不应脱离其批次存在，改为 CASCADE。

alter table inventory_transaction_entries
  drop constraint inventory_transaction_entries_lot_id_fkey,
  add constraint inventory_transaction_entries_lot_id_fkey
    foreign key (lot_id) references inventory_lots (id) on delete cascade;

-- 交易自引用（撤销链）：删除家庭级联删除交易时，避免被自身引用阻塞。
alter table inventory_transactions
  drop constraint inventory_transactions_reversed_transaction_id_fkey,
  add constraint inventory_transactions_reversed_transaction_id_fkey
    foreign key (reversed_transaction_id) references inventory_transactions (id) on delete set null;
