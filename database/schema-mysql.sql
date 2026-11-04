-- =============================================================
-- SupplyMind 供应链管理系统 · 数据库建表脚本（MySQL 8.0+）
-- 19 张表，由 E-R 图导出，字段注释与图一一对应
-- 生成时间：2026-11-01
-- =============================================================
--
-- 用法：整段执行即可建库；末尾的初始账号需要先生成密码哈希再取消注释。
--
-- 【登录账号】users.password 只存 bcrypt 哈希，不要存明文。
--   生成哈希（任选其一）：
--     node -e "console.log(require('bcryptjs').hashSync('123456',10))"
--     Java: new BCryptPasswordEncoder().encode("123456")
--   把生成的 $2a$10$... 字符串填到文件末尾的 INSERT 里。
--
-- 【权限】users.role 只有两个值：
--   GM    总经理：所有模块可见
--   SALES 业务员：只可见「采购订单」「物流跟踪」
--   菜单过滤在前端，接口校验在后端，Dify 工作流入口按同一份 role 分支。
--
-- 【delayed 字段】不要用生成列：CURRENT_DATE 不是 immutable，
--   MySQL 与 PostgreSQL 都拒绝这种生成列。由应用在查询时计算，
--   或用文件末尾的视图 v_logistics_delayed 取实时值。
-- =============================================================


SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------- 清理（幂等，可重复执行） ----------
DROP TABLE IF EXISTS logistics_events;
DROP TABLE IF EXISTS logistics_orders;
DROP TABLE IF EXISTS system_configs;
DROP TABLE IF EXISTS operation_logs;
DROP TABLE IF EXISTS ai_messages;
DROP TABLE IF EXISTS ai_reports;
DROP TABLE IF EXISTS ai_tasks;
DROP TABLE IF EXISTS ai_conversations;
DROP TABLE IF EXISTS purchase_receipt_items;
DROP TABLE IF EXISTS purchase_receipts;
DROP TABLE IF EXISTS purchase_order_items;
DROP TABLE IF EXISTS purchase_orders;
DROP TABLE IF EXISTS stock_transfers;
DROP TABLE IF EXISTS inventory_transactions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS warehouse_stock;
DROP TABLE IF EXISTS warehouses;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS suppliers;
DROP VIEW IF EXISTS v_logistics_delayed;

SET FOREIGN_KEY_CHECKS = 1;

-- ---------- 建表 ----------
-- 供应商（采购主数据）
CREATE TABLE suppliers (
  id VARCHAR(16) NOT NULL COMMENT '供应商ID',
  code VARCHAR(32) NOT NULL COMMENT '供应商编码',
  name VARCHAR(120) NOT NULL COMMENT '供应商名称',
  contact VARCHAR(40) COMMENT '联系人',
  phone VARCHAR(32) COMMENT '联系电话',
  categories JSON COMMENT '供货品类',
  address VARCHAR(200) COMMENT '联系地址',
  status VARCHAR(16) NOT NULL DEFAULT 'active' COMMENT '状态：启用/停用',
  remark VARCHAR(500) COMMENT '备注',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_suppliers_code (code),
  UNIQUE KEY uk_suppliers_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='供应商';

-- 商品（采购主数据）
CREATE TABLE products (
  id VARCHAR(16) NOT NULL COMMENT '商品ID',
  code VARCHAR(32) NOT NULL COMMENT '商品编码',
  name VARCHAR(120) NOT NULL COMMENT '商品名称',
  category VARCHAR(40) COMMENT '所属分类（商品大类）',
  sub_category VARCHAR(40) COMMENT '商品小类',
  spec VARCHAR(80) COMMENT '规格型号',
  unit VARCHAR(16) COMMENT '计量单位',
  safety_stock INT NOT NULL DEFAULT 0 COMMENT '安全库存',
  purchase_price DECIMAL(12,2) COMMENT '参考进价',
  status VARCHAR(16) NOT NULL DEFAULT 'active' COMMENT '状态：启用/停用',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_products_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='商品';

-- 仓库（采购主数据）
CREATE TABLE warehouses (
  id VARCHAR(16) NOT NULL COMMENT '仓库ID',
  code VARCHAR(16) NOT NULL COMMENT '仓库编码',
  name VARCHAR(80) NOT NULL COMMENT '仓库名称',
  address VARCHAR(200) COMMENT '仓库地址',
  manager VARCHAR(40) COMMENT '负责人',
  phone VARCHAR(32) COMMENT '联系电话',
  status VARCHAR(16) NOT NULL DEFAULT 'active' COMMENT '状态：启用/停用',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_warehouses_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='仓库';

-- 库存结存（商品与库存）
CREATE TABLE warehouse_stock (
  id BIGINT AUTO_INCREMENT NOT NULL COMMENT '结存ID',
  product_id VARCHAR(16) NOT NULL COMMENT '商品ID',
  warehouse_id VARCHAR(16) NOT NULL COMMENT '仓库ID',
  qty INT NOT NULL DEFAULT 0 COMMENT '现存数量',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_warehouse_stock_product_id_warehouse_id (product_id, warehouse_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='库存结存';

-- 用户账号（账号与系统）
CREATE TABLE users (
  username VARCHAR(40) NOT NULL COMMENT '登录账号',
  password VARCHAR(255) NOT NULL COMMENT '密码哈希',
  display_name VARCHAR(50) NOT NULL COMMENT '显示姓名',
  role VARCHAR(16) NOT NULL COMMENT '角色：GM/SALES',
  status SMALLINT NOT NULL DEFAULT 1 COMMENT '状态：启用/停用',
  PRIMARY KEY (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='用户账号';

-- 库存流水（商品与库存）
CREATE TABLE inventory_transactions (
  id VARCHAR(24) NOT NULL COMMENT '流水ID',
  type VARCHAR(16) NOT NULL COMMENT '流水类型',
  product_id VARCHAR(16) NOT NULL COMMENT '商品ID',
  product_name VARCHAR(120) COMMENT '商品名称',
  warehouse_id VARCHAR(16) NOT NULL COMMENT '仓库ID',
  warehouse_name VARCHAR(80) COMMENT '仓库名称',
  qty INT NOT NULL COMMENT '变动数量',
  before_qty INT COMMENT '变动前',
  after_qty INT COMMENT '变动后',
  ref_code VARCHAR(32) COMMENT '关联单号',
  operator VARCHAR(40) COMMENT '经办人账号',
  remark VARCHAR(200) COMMENT '备注',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记账时间',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='库存流水';

-- 库存调拨单（商品与库存）
CREATE TABLE stock_transfers (
  id VARCHAR(16) NOT NULL COMMENT '调拨ID',
  code VARCHAR(32) NOT NULL COMMENT '调拨单号',
  from_warehouse_id VARCHAR(16) NOT NULL COMMENT '调出仓库',
  from_warehouse_name VARCHAR(80) COMMENT '调出仓名',
  to_warehouse_id VARCHAR(16) NOT NULL COMMENT '调入仓库',
  to_warehouse_name VARCHAR(80) COMMENT '调入仓名',
  product_id VARCHAR(16) NOT NULL COMMENT '商品ID',
  product_name VARCHAR(120) COMMENT '商品名称',
  qty INT NOT NULL COMMENT '调拨数量',
  operator VARCHAR(40) COMMENT '经办人账号',
  remark VARCHAR(200) COMMENT '备注',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_stock_transfers_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='库存调拨单';

-- 采购订单（采购单据）
CREATE TABLE purchase_orders (
  id VARCHAR(32) NOT NULL COMMENT '采购单ID',
  code VARCHAR(32) NOT NULL COMMENT '采购单号',
  supplier_id VARCHAR(16) NOT NULL COMMENT '供应商ID',
  supplier_name VARCHAR(120) COMMENT '供应商名',
  status VARCHAR(16) NOT NULL DEFAULT 'draft' COMMENT '单据状态',
  total_amount DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT '订单金额',
  created_by VARCHAR(40) NOT NULL COMMENT '创建人账号',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  expected_arrival DATE NOT NULL COMMENT '预计到货',
  approver VARCHAR(40) COMMENT '审批人账号',
  approved_at DATETIME COMMENT '审批时间',
  reject_reason VARCHAR(500) COMMENT '驳回原因',
  remark VARCHAR(500) COMMENT '备注',
  logistics_id VARCHAR(32) COMMENT '关联物流单',
  PRIMARY KEY (id),
  UNIQUE KEY uk_purchase_orders_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='采购订单';

-- 采购订单明细（采购单据）
CREATE TABLE purchase_order_items (
  id VARCHAR(32) NOT NULL COMMENT '明细ID',
  po_id VARCHAR(32) NOT NULL COMMENT '采购单ID',
  product_id VARCHAR(16) NOT NULL COMMENT '商品ID',
  product_name VARCHAR(120) COMMENT '商品名称',
  spec VARCHAR(80) COMMENT '规格型号',
  unit VARCHAR(16) COMMENT '计量单位',
  qty INT NOT NULL DEFAULT 0 COMMENT '采购数量',
  received_qty INT NOT NULL DEFAULT 0 COMMENT '已收数量',
  price DECIMAL(12,2) NOT NULL COMMENT '成交单价',
  amount DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT '行小计',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='采购订单明细';

-- 采购收货单（采购单据）
CREATE TABLE purchase_receipts (
  id VARCHAR(16) NOT NULL COMMENT '收货单ID',
  code VARCHAR(32) NOT NULL COMMENT '收货单号',
  po_id VARCHAR(32) NOT NULL COMMENT '采购单ID',
  warehouse_id VARCHAR(16) NOT NULL COMMENT '入库仓库',
  received_by VARCHAR(40) NOT NULL COMMENT '收货人账号',
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '收货时间',
  remark VARCHAR(300) COMMENT '备注',
  PRIMARY KEY (id),
  UNIQUE KEY uk_purchase_receipts_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='采购收货单';

-- 收货明细（采购单据）
CREATE TABLE purchase_receipt_items (
  id BIGINT AUTO_INCREMENT NOT NULL COMMENT '明细ID',
  receipt_id VARCHAR(16) NOT NULL COMMENT '收货单ID',
  po_item_id VARCHAR(32) NOT NULL COMMENT '采购明细ID',
  qty INT NOT NULL DEFAULT 0 COMMENT '本次收货量',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='收货明细';

-- AI 会话（AI 智能中心）
CREATE TABLE ai_conversations (
  id VARCHAR(16) NOT NULL COMMENT '会话ID',
  username VARCHAR(40) NOT NULL COMMENT '用户账号',
  title VARCHAR(120) COMMENT '会话标题',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间',
  dify_conversation_id VARCHAR(64) COMMENT 'Dify 会话ID',
  PRIMARY KEY (id),
  UNIQUE KEY uk_ai_conversations_dify_conversation_id (dify_conversation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='AI 会话';

-- Agent 任务（AI 智能中心）
CREATE TABLE ai_tasks (
  id VARCHAR(16) NOT NULL COMMENT '任务ID',
  name VARCHAR(120) NOT NULL COMMENT '任务名称',
  type VARCHAR(24) NOT NULL COMMENT '任务类型',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT '任务状态',
  created_by VARCHAR(40) NOT NULL COMMENT '创建人账号',
  summary VARCHAR(500) NOT NULL COMMENT '任务摘要',
  payload JSON COMMENT '草稿载荷',
  tool_calls JSON COMMENT '工具调用',
  result_text TEXT COMMENT '结果说明',
  error VARCHAR(500) COMMENT '失败原因',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  dify_run_id VARCHAR(64) COMMENT 'Dify 运行ID',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Agent 任务';

-- AI 分析报告（AI 智能中心）
CREATE TABLE ai_reports (
  id VARCHAR(16) NOT NULL COMMENT '报告ID',
  type VARCHAR(24) NOT NULL COMMENT '报告类型',
  title VARCHAR(160) NOT NULL COMMENT '报告标题',
  target_id VARCHAR(32) COMMENT '分析对象ID',
  target_name VARCHAR(120) COMMENT '分析对象',
  conclusion TEXT NOT NULL COMMENT '结论',
  evidence JSON NOT NULL COMMENT '数据依据',
  cause TEXT NOT NULL COMMENT '原因分析',
  suggestions JSON NOT NULL COMMENT '建议清单',
  created_by VARCHAR(40) NOT NULL COMMENT '生成人账号',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '生成时间',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='AI 分析报告';

-- AI 消息（AI 智能中心）
CREATE TABLE ai_messages (
  id VARCHAR(32) NOT NULL COMMENT '消息ID',
  conversation_id VARCHAR(16) NOT NULL COMMENT '会话ID',
  role VARCHAR(12) NOT NULL COMMENT '说话方',
  content TEXT NOT NULL COMMENT '消息内容',
  conclusion TEXT COMMENT '结论',
  evidence JSON COMMENT '数据依据',
  cause TEXT COMMENT '原因分析',
  actions JSON COMMENT '建议动作',
  draft_payload JSON COMMENT '采购草稿',
  tool_calls JSON COMMENT '工具调用',
  task_id VARCHAR(16) COMMENT '关联任务',
  report_id VARCHAR(16) COMMENT '关联报告',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发送时间',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='AI 消息';

-- 操作日志（账号与系统）
CREATE TABLE operation_logs (
  id BIGINT AUTO_INCREMENT NOT NULL COMMENT '日志ID',
  username VARCHAR(40) NOT NULL COMMENT '操作人账号',
  module VARCHAR(32) NOT NULL COMMENT '业务模块',
  action VARCHAR(32) NOT NULL COMMENT '操作动作',
  target_type VARCHAR(32) NOT NULL COMMENT '对象类型',
  target_id VARCHAR(32) NOT NULL COMMENT '对象ID',
  detail JSON NOT NULL COMMENT '变更详情',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='操作日志';

-- 业务规则参数（账号与系统）
CREATE TABLE system_configs (
  id VARCHAR(32) NOT NULL COMMENT '参数键',
  label VARCHAR(80) NOT NULL COMMENT '参数名称',
  config_value VARCHAR(200) NOT NULL COMMENT '参数值',
  value_type VARCHAR(16) NOT NULL COMMENT '值类型',
  updated_by VARCHAR(40) NOT NULL COMMENT '修改人账号',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '修改时间',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='业务规则参数';

-- 物流单（物流跟踪）
CREATE TABLE logistics_orders (
  id VARCHAR(16) NOT NULL COMMENT '物流单ID',
  code VARCHAR(32) NOT NULL COMMENT '物流单号',
  po_id VARCHAR(32) NOT NULL COMMENT '采购单ID',
  po_code VARCHAR(32) COMMENT '采购单号',
  supplier_id VARCHAR(16) NOT NULL COMMENT '供应商ID',
  supplier_name VARCHAR(120) COMMENT '供应商名',
  carrier VARCHAR(40) COMMENT '承运商',
  tracking_no VARCHAR(64) COMMENT '运单号',
  expected_arrival DATE COMMENT '预计到达',
  status VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT '物流状态',
  is_delayed TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否延迟（原名 delayed，保留字）',
  remark VARCHAR(300) COMMENT '备注',
  PRIMARY KEY (id),
  UNIQUE KEY uk_logistics_orders_code (code),
  UNIQUE KEY uk_logistics_orders_po_id (po_id),
  UNIQUE KEY uk_logistics_orders_tracking_no (tracking_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='物流单';

-- 物流轨迹节点（物流跟踪）
CREATE TABLE logistics_events (
  id VARCHAR(24) NOT NULL COMMENT '节点ID',
  logistics_id VARCHAR(16) NOT NULL COMMENT '物流单ID',
  time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '节点时间',
  node VARCHAR(40) NOT NULL COMMENT '节点名称',
  description VARCHAR(300) NOT NULL COMMENT '节点说明（原名 desc，保留字）',
  location VARCHAR(80) COMMENT '所在位置',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='物流轨迹节点';

-- ---------- 外键 ----------
ALTER TABLE warehouse_stock ADD CONSTRAINT fk_warehouse_stock_product_id FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE warehouse_stock ADD CONSTRAINT fk_warehouse_stock_warehouse_id FOREIGN KEY (warehouse_id) REFERENCES warehouses (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE inventory_transactions ADD CONSTRAINT fk_inventory_transactions_product_id FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE inventory_transactions ADD CONSTRAINT fk_inventory_transactions_warehouse_id FOREIGN KEY (warehouse_id) REFERENCES warehouses (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE inventory_transactions ADD CONSTRAINT fk_inventory_transactions_operator FOREIGN KEY (operator) REFERENCES users (username) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE stock_transfers ADD CONSTRAINT fk_stock_transfers_from_warehouse_id FOREIGN KEY (from_warehouse_id) REFERENCES warehouses (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE stock_transfers ADD CONSTRAINT fk_stock_transfers_to_warehouse_id FOREIGN KEY (to_warehouse_id) REFERENCES warehouses (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE stock_transfers ADD CONSTRAINT fk_stock_transfers_product_id FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE stock_transfers ADD CONSTRAINT fk_stock_transfers_operator FOREIGN KEY (operator) REFERENCES users (username) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE purchase_orders ADD CONSTRAINT fk_purchase_orders_supplier_id FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE purchase_orders ADD CONSTRAINT fk_purchase_orders_created_by FOREIGN KEY (created_by) REFERENCES users (username) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE purchase_orders ADD CONSTRAINT fk_purchase_orders_approver FOREIGN KEY (approver) REFERENCES users (username) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE purchase_order_items ADD CONSTRAINT fk_purchase_order_items_po_id FOREIGN KEY (po_id) REFERENCES purchase_orders (id) ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE purchase_order_items ADD CONSTRAINT fk_purchase_order_items_product_id FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE purchase_receipts ADD CONSTRAINT fk_purchase_receipts_po_id FOREIGN KEY (po_id) REFERENCES purchase_orders (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE purchase_receipts ADD CONSTRAINT fk_purchase_receipts_warehouse_id FOREIGN KEY (warehouse_id) REFERENCES warehouses (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE purchase_receipts ADD CONSTRAINT fk_purchase_receipts_received_by FOREIGN KEY (received_by) REFERENCES users (username) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE purchase_receipt_items ADD CONSTRAINT fk_purchase_receipt_items_receipt_id FOREIGN KEY (receipt_id) REFERENCES purchase_receipts (id) ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE purchase_receipt_items ADD CONSTRAINT fk_purchase_receipt_items_po_item_id FOREIGN KEY (po_item_id) REFERENCES purchase_order_items (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE ai_conversations ADD CONSTRAINT fk_ai_conversations_username FOREIGN KEY (username) REFERENCES users (username) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE ai_tasks ADD CONSTRAINT fk_ai_tasks_created_by FOREIGN KEY (created_by) REFERENCES users (username) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE ai_reports ADD CONSTRAINT fk_ai_reports_created_by FOREIGN KEY (created_by) REFERENCES users (username) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE ai_messages ADD CONSTRAINT fk_ai_messages_conversation_id FOREIGN KEY (conversation_id) REFERENCES ai_conversations (id) ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE ai_messages ADD CONSTRAINT fk_ai_messages_task_id FOREIGN KEY (task_id) REFERENCES ai_tasks (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE ai_messages ADD CONSTRAINT fk_ai_messages_report_id FOREIGN KEY (report_id) REFERENCES ai_reports (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE operation_logs ADD CONSTRAINT fk_operation_logs_username FOREIGN KEY (username) REFERENCES users (username) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE system_configs ADD CONSTRAINT fk_system_configs_updated_by FOREIGN KEY (updated_by) REFERENCES users (username) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE logistics_orders ADD CONSTRAINT fk_logistics_orders_po_id FOREIGN KEY (po_id) REFERENCES purchase_orders (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE logistics_orders ADD CONSTRAINT fk_logistics_orders_supplier_id FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE logistics_events ADD CONSTRAINT fk_logistics_events_logistics_id FOREIGN KEY (logistics_id) REFERENCES logistics_orders (id) ON DELETE CASCADE ON UPDATE RESTRICT;

-- ---------- 业务约束（CHECK） ----------
ALTER TABLE users ADD CONSTRAINT chk_users_role CHECK (role IN ('GM','SALES'));
ALTER TABLE users ADD CONSTRAINT chk_users_status CHECK (status IN (0,1));
ALTER TABLE suppliers ADD CONSTRAINT chk_supplier_status CHECK (status IN ('active','disabled'));
ALTER TABLE products ADD CONSTRAINT chk_product_status CHECK (status IN ('active','disabled'));
ALTER TABLE warehouses ADD CONSTRAINT chk_warehouse_status CHECK (status IN ('active','disabled'));
ALTER TABLE inventory_transactions ADD CONSTRAINT chk_tx_type CHECK (type IN ('purchase_in','transfer_in','transfer_out'));
ALTER TABLE stock_transfers ADD CONSTRAINT chk_transfer_warehouses CHECK (from_warehouse_id <> to_warehouse_id);
ALTER TABLE stock_transfers ADD CONSTRAINT chk_transfer_qty CHECK (qty > 0);
ALTER TABLE purchase_orders ADD CONSTRAINT chk_po_status CHECK (status IN ('draft','pending','approved','partial','completed','rejected','cancelled'));
-- 注意：不要加「approver <> created_by」这类 CHECK。
-- 管理者（GM）提交采购单是免审批直接通过，approver 会等于 created_by；
-- 加了这条约束后 GM 提交自己的单会直接 500（MySQL 3819）。
-- 「谁不能审批谁」由 app/services/purchase_service.py 在业务层判断。
ALTER TABLE purchase_order_items ADD CONSTRAINT chk_item_qty CHECK (qty > 0);
ALTER TABLE purchase_order_items ADD CONSTRAINT chk_item_received CHECK (received_qty >= 0 AND received_qty <= qty);
ALTER TABLE logistics_orders ADD CONSTRAINT chk_logistics_status CHECK (status IN ('pending','in_transit','arrived','delivered','exception'));
ALTER TABLE ai_messages ADD CONSTRAINT chk_msg_role CHECK (role IN ('user','assistant'));
ALTER TABLE ai_tasks ADD CONSTRAINT chk_task_status CHECK (status IN ('pending','running','waiting_confirm','done','failed'));
ALTER TABLE ai_reports ADD CONSTRAINT chk_report_type CHECK (type IN ('supplier_risk','replenishment','logistics_anomaly'));

-- ---------- 索引 ----------
CREATE INDEX idx_po_status ON purchase_orders (status);
CREATE INDEX idx_po_supplier ON purchase_orders (supplier_id);
CREATE INDEX idx_po_created ON purchase_orders (created_at);
CREATE INDEX idx_poi_po ON purchase_order_items (po_id);
CREATE INDEX idx_poi_product ON purchase_order_items (product_id);
CREATE INDEX idx_receipt_po ON purchase_receipts (po_id);
CREATE INDEX idx_receipt_warehouse ON purchase_receipts (warehouse_id);
CREATE INDEX idx_logistics_status ON logistics_orders (status);
CREATE INDEX idx_event_po ON logistics_events (logistics_id, time);
CREATE INDEX idx_stock_product ON warehouse_stock (product_id);
CREATE INDEX idx_stock_warehouse ON warehouse_stock (warehouse_id);
CREATE INDEX idx_tx_product ON inventory_transactions (product_id, created_at);
CREATE INDEX idx_tx_warehouse ON inventory_transactions (warehouse_id);
CREATE INDEX idx_transfer_from ON stock_transfers (from_warehouse_id);
CREATE INDEX idx_transfer_to ON stock_transfers (to_warehouse_id);
CREATE INDEX idx_log_user ON operation_logs (username);
CREATE INDEX idx_log_created ON operation_logs (created_at);
CREATE INDEX idx_conv_user ON ai_conversations (username);
CREATE INDEX idx_msg_conv ON ai_messages (conversation_id);
CREATE INDEX idx_task_status ON ai_tasks (status);
CREATE INDEX idx_report_type ON ai_reports (type);
-- 注意：MySQL 的 JSON 列没有 GIN，按品类筛选用 JSON_CONTAINS，或二期改关联表

-- ---------- 物流延迟视图（delayed 实时算） ----------
CREATE VIEW v_logistics_delayed AS
SELECT o.id, o.code, o.po_id, o.po_code, o.supplier_name, o.carrier, o.tracking_no,
       o.expected_arrival, o.status,
       CASE WHEN o.status <> 'delivered' AND o.expected_arrival < CURDATE() THEN 1 ELSE 0 END AS is_delayed,
       DATEDIFF(CURDATE(), o.expected_arrival) AS delay_days
FROM logistics_orders o;

-- ---------- 初始账号（先替换哈希再取消注释） ----------
-- 密码统一为 123456，哈希用上面的命令生成后替换下面的占位串。
-- INSERT INTO users (username, password, display_name, role, status) VALUES
--   ('gm',      '$2a$10$REPLACE_WITH_REAL_HASH', '张伟', 'GM',    1),
--   ('sales01', '$2a$10$REPLACE_WITH_REAL_HASH', '李娜', 'SALES', 1);
