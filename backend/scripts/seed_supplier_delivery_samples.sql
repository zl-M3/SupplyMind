-- ============================================================================
--  准时交付率：补齐样本 + 拉开差距
--
--  两个目标：
--  1) 口径修正后（只统计"已签收"的物流单，在途单不计入分子分母），
--     每家供应商都有足够样本，不再显示"数据不足"；
--  2) 再加 2~4 单「有准时的、也有延迟的」历史订单，让 8 家供应商的准时率
--     参差不齐（40% ~ 83%），方便演示/分析出差距。
--
--  数据全部挂在已有供应商 / 商品 / 仓库 / 账号上，并同步写全套业务单据：
--  采购单 → 明细 → 物流单 → 轨迹 → 收货单 → 收货明细 → 库存 → 库存流水。
--
--  幂等：单号使用 8 段（PO20260831-8xxx）；若已补齐过则本次不插入任何数据。
-- ============================================================================

USE supplymind;

START TRANSACTION;

-- ---------------------------------------------------------------------------
-- 0) 是否已经执行过
-- ---------------------------------------------------------------------------
SET @already := (SELECT COUNT(*) FROM purchase_orders WHERE code LIKE 'PO20260831-8%');

-- ---------------------------------------------------------------------------
-- 1) 每家供应商补几单、其中几单迟到
--    late_cnt = 追加单里"延迟签收"的条数（其余为按时签收）
-- ---------------------------------------------------------------------------
DROP TEMPORARY TABLE IF EXISTS tmp_plan;
CREATE TEMPORARY TABLE tmp_plan (
  supplier_code varchar(32) NOT NULL,
  add_cnt       int         NOT NULL,
  late_cnt      int         NOT NULL,
  PRIMARY KEY (supplier_code)
) ENGINE = InnoDB;

INSERT INTO tmp_plan (supplier_code, add_cnt, late_cnt) VALUES
  ('SUP001', 3, 1),   -- 5/6  = 83.3%
  ('SUP002', 2, 2),   -- 3/5  = 60.0%
  ('SUP003', 3, 1),   -- 4/5  = 80.0%
  ('SUP004', 3, 2),   -- 3/6  = 50.0%
  ('SUP005', 3, 2),   -- 4/6  = 66.7%
  ('SUP006', 2, 2),   -- 2/5  = 40.0%
  ('SUP007', 4, 3),   -- 4/7  = 57.1%
  ('SUP008', 1, 0);   -- 3/4  = 75.0%

-- ---------------------------------------------------------------------------
-- 2) 待生成的行（供应商 × 追加序号）
-- ---------------------------------------------------------------------------
DROP TEMPORARY TABLE IF EXISTS tmp_need;
CREATE TEMPORARY TABLE tmp_need (
  supplier_id   varchar(16)  NOT NULL,
  supplier_name varchar(120) DEFAULT NULL,
  category      varchar(40)  DEFAULT NULL,
  idx           int          NOT NULL,
  late_cnt      int          NOT NULL,
  PRIMARY KEY (supplier_id, idx)
) ENGINE = InnoDB;

INSERT INTO tmp_need (supplier_id, supplier_name, category, idx, late_cnt)
SELECT s.id,
       s.name,
       JSON_UNQUOTE(JSON_EXTRACT(s.categories, '$[0]')),
       n.n,
       p.late_cnt
FROM tmp_plan p
JOIN suppliers s ON s.code = p.supplier_code
JOIN (SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3) n
  ON n.n < p.add_cnt
WHERE @already = 0;

-- ---------------------------------------------------------------------------
-- 3) 采购单骨架
-- ---------------------------------------------------------------------------
DROP TEMPORARY TABLE IF EXISTS tmp_orders;
CREATE TEMPORARY TABLE tmp_orders (
  k                int          NOT NULL,
  supplier_id      varchar(16)  NOT NULL,
  supplier_name    varchar(120) DEFAULT NULL,
  category         varchar(40)  DEFAULT NULL,
  po_id            varchar(32)  NOT NULL,
  po_code          varchar(32)  NOT NULL,
  created_at       datetime     NOT NULL,
  expected_arrival date         NOT NULL,
  created_by       varchar(40)  NOT NULL,
  approver         varchar(40)  NOT NULL,
  received_at      datetime     NOT NULL,
  warehouse_id     varchar(16)  NOT NULL,
  is_late          tinyint      NOT NULL,
  PRIMARY KEY (k),
  UNIQUE KEY uk_po_code (po_code)
) ENGINE = InnoDB;

INSERT INTO tmp_orders
SELECT x.k,
       x.supplier_id,
       x.supplier_name,
       x.category,
       CONCAT('POPO20260831', '8', LPAD(x.k, 3, '0'))                 AS po_id,
       CONCAT('PO20260831-8', LPAD(x.k, 3, '0'))                      AS po_code,
       DATE_SUB('2026-09-28 09:00:00', INTERVAL (x.k * 3) DAY)        AS created_at,
       DATE(DATE_SUB('2026-09-28 09:00:00', INTERVAL (x.k * 3) DAY)) + INTERVAL 10 DAY AS expected_arrival,
       CASE WHEN x.k % 3 = 0 THEN 'sales02' ELSE 'sales01' END        AS created_by,
       CASE WHEN x.k % 5 = 0 THEN 'gm2' ELSE 'gm' END                 AS approver,
       CASE
         WHEN x.idx < x.late_cnt
           THEN DATE(DATE_SUB('2026-09-28 09:00:00', INTERVAL (x.k * 3) DAY)) + INTERVAL 13 DAY
         ELSE DATE(DATE_SUB('2026-09-28 09:00:00', INTERVAL (x.k * 3) DAY)) + INTERVAL 10 DAY - INTERVAL 6 HOUR
       END                                                            AS received_at,
       CASE WHEN x.k % 2 = 0 THEN 'WH002' ELSE 'WH001' END            AS warehouse_id,
       CASE WHEN x.idx < x.late_cnt THEN 1 ELSE 0 END                 AS is_late
FROM (
  SELECT ROW_NUMBER() OVER (ORDER BY n.supplier_id, n.idx) AS k,
         n.supplier_id, n.supplier_name, n.category, n.idx, n.late_cnt
  FROM tmp_need n
) x;

INSERT INTO purchase_orders
  (id, code, supplier_id, supplier_name, status, total_amount,
   created_by, created_at, expected_arrival, approver, approved_at, remark)
SELECT o.po_id, o.po_code, o.supplier_id, o.supplier_name, 'completed', 0,
       o.created_by, o.created_at, o.expected_arrival, o.approver,
       DATE_ADD(o.created_at, INTERVAL 1 DAY),
       '演示数据补齐：已签收的历史采购单'
FROM tmp_orders o;

-- ---------------------------------------------------------------------------
-- 4) 商品池（按供应商主营大类轮选）
-- ---------------------------------------------------------------------------
DROP TEMPORARY TABLE IF EXISTS tmp_products;
CREATE TEMPORARY TABLE tmp_products (
  id             varchar(16)   NOT NULL,
  name           varchar(120)  DEFAULT NULL,
  spec           varchar(80)   DEFAULT NULL,
  unit           varchar(16)   DEFAULT NULL,
  purchase_price decimal(12,2) NOT NULL,
  category       varchar(40)   DEFAULT NULL,
  rn             int           NOT NULL,
  cnt            int           NOT NULL,
  PRIMARY KEY (id)
) ENGINE = InnoDB;

INSERT INTO tmp_products (id, name, spec, unit, purchase_price, category, rn, cnt)
SELECT p.id, p.name, p.spec, p.unit, COALESCE(p.purchase_price, 0), p.category,
       ROW_NUMBER() OVER (PARTITION BY p.category ORDER BY p.id),
       COUNT(*)     OVER (PARTITION BY p.category)
FROM products p
WHERE p.status = 'active';

-- ---------------------------------------------------------------------------
-- 5) 采购明细（每单 2 行）
-- ---------------------------------------------------------------------------
DROP TEMPORARY TABLE IF EXISTS tmp_items;
CREATE TEMPORARY TABLE tmp_items (
  k            int           NOT NULL,
  i            int           NOT NULL,
  po_id        varchar(32)   NOT NULL,
  po_code      varchar(32)   NOT NULL,
  product_id   varchar(16)   NOT NULL,
  product_name varchar(120)  DEFAULT NULL,
  spec         varchar(80)   DEFAULT NULL,
  unit         varchar(16)   DEFAULT NULL,
  qty          int           NOT NULL,
  price        decimal(12,2) NOT NULL,
  amount       decimal(14,2) NOT NULL,
  received_at  datetime      NOT NULL,
  warehouse_id varchar(16)   NOT NULL,
  PRIMARY KEY (k, i)
) ENGINE = InnoDB;

INSERT INTO tmp_items
SELECT o.k, p.i, o.po_id, o.po_code,
       pr.id, pr.name, pr.spec, pr.unit,
       60 + 10 * ((o.k * 7 + p.i * 13) % 6)                       AS qty,
       pr.purchase_price,
       (60 + 10 * ((o.k * 7 + p.i * 13) % 6)) * pr.purchase_price  AS amount,
       o.received_at, o.warehouse_id
FROM tmp_orders o
JOIN (SELECT 0 AS i UNION ALL SELECT 1) p
JOIN tmp_products pr
  ON pr.category = o.category
 AND pr.rn = ((o.k + p.i * 3) % pr.cnt) + 1;

INSERT INTO purchase_order_items
  (id, po_id, product_id, product_name, spec, unit, qty, received_qty, price, amount)
SELECT CONCAT(t.po_id, 'I', LPAD(t.i + 1, 2, '0')),
       t.po_id, t.product_id, t.product_name, t.spec, t.unit,
       t.qty, t.qty, t.price, t.amount
FROM tmp_items t;

UPDATE purchase_orders po
JOIN (SELECT po_id, SUM(amount) AS s FROM tmp_items GROUP BY po_id) a ON a.po_id = po.id
SET po.total_amount = a.s;

-- ---------------------------------------------------------------------------
-- 6) 物流单 + 轨迹（延迟单的签收时间晚于预计到达 3 天）
-- ---------------------------------------------------------------------------
INSERT INTO logistics_orders
  (id, code, po_id, po_code, supplier_id, supplier_name, carrier, tracking_no,
   expected_arrival, status, is_delayed, remark)
SELECT CONCAT('LG8', LPAD(o.k, 6, '0')),
       CONCAT('LG20260831-8', LPAD(o.k, 3, '0')),
       o.po_id, o.po_code, o.supplier_id, o.supplier_name,
       CASE o.k % 3 WHEN 0 THEN '顺丰冷运' WHEN 1 THEN '京东物流' ELSE '中通快运' END,
       CONCAT('SF8', LPAD(o.k, 10, '0')),
       o.expected_arrival, 'delivered', o.is_late,
       CASE WHEN o.is_late = 1 THEN '演示数据补齐：延迟签收' ELSE '演示数据补齐：按时签收' END
FROM tmp_orders o;

UPDATE purchase_orders po
JOIN tmp_orders o ON o.po_id = po.id
SET po.logistics_id = CONCAT('LG8', LPAD(o.k, 6, '0'));

INSERT INTO logistics_events (id, logistics_id, time, node, description, location)
SELECT CONCAT('LG8', LPAD(o.k, 6, '0'), 'E1'),
       CONCAT('LG8', LPAD(o.k, 6, '0')),
       DATE_ADD(o.created_at, INTERVAL 2 DAY),
       '已揽收', '供应商备货完成，承运商已上门提货', '供应商仓库'
FROM tmp_orders o;

INSERT INTO logistics_events (id, logistics_id, time, node, description, location)
SELECT CONCAT('LG8', LPAD(o.k, 6, '0'), 'E2'),
       CONCAT('LG8', LPAD(o.k, 6, '0')),
       o.received_at,
       '已签收',
       CASE WHEN o.is_late = 1 THEN '晚于预计到达时间，已签收入库' ELSE '按时签收入库' END,
       CASE WHEN o.warehouse_id = 'WH002' THEN '东莞分仓' ELSE '深圳中心仓' END
FROM tmp_orders o;

-- ---------------------------------------------------------------------------
-- 7) 收货单 + 收货明细
-- ---------------------------------------------------------------------------
INSERT INTO purchase_receipts (id, code, po_id, warehouse_id, received_by, received_at, remark)
SELECT CONCAT('RC8', LPAD(o.k, 6, '0')),
       CONCAT('RC20260831-8', LPAD(o.k, 3, '0')),
       o.po_id, o.warehouse_id, 'gm', o.received_at,
       '演示数据补齐：一次性全部收货'
FROM tmp_orders o;

INSERT INTO purchase_receipt_items (receipt_id, po_item_id, qty)
SELECT CONCAT('RC8', LPAD(t.k, 6, '0')),
       CONCAT(t.po_id, 'I', LPAD(t.i + 1, 2, '0')),
       t.qty
FROM tmp_items t;

-- ---------------------------------------------------------------------------
-- 8) 库存 + 库存流水（before/after 用累计值算，保证流水连贯）
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO warehouse_stock (product_id, warehouse_id, qty, updated_at)
SELECT DISTINCT t.product_id, t.warehouse_id, 0, NOW() FROM tmp_items t;

UPDATE warehouse_stock ws
JOIN (SELECT product_id, warehouse_id, SUM(qty) AS q FROM tmp_items GROUP BY product_id, warehouse_id) a
  ON a.product_id = ws.product_id AND a.warehouse_id = ws.warehouse_id
SET ws.qty = ws.qty + a.q, ws.updated_at = NOW();

DROP TEMPORARY TABLE IF EXISTS tmp_tx;
CREATE TEMPORARY TABLE tmp_tx (
  k            int          NOT NULL,
  i            int          NOT NULL,
  po_code      varchar(32)  NOT NULL,
  product_id   varchar(16)  NOT NULL,
  product_name varchar(120) DEFAULT NULL,
  warehouse_id varchar(16)  NOT NULL,
  qty          int          NOT NULL,
  received_at  datetime     NOT NULL,
  cum          int          NOT NULL,
  PRIMARY KEY (k, i)
) ENGINE = InnoDB;

INSERT INTO tmp_tx (k, i, po_code, product_id, product_name, warehouse_id, qty, received_at, cum)
SELECT t.k, t.i, t.po_code, t.product_id, t.product_name, t.warehouse_id, t.qty, t.received_at,
       SUM(t.qty) OVER (PARTITION BY t.product_id, t.warehouse_id
                        ORDER BY t.received_at, t.k, t.i
                        ROWS UNBOUNDED PRECEDING)
FROM tmp_items t;

INSERT INTO inventory_transactions
  (id, type, product_id, product_name, warehouse_id, warehouse_name,
   qty, before_qty, after_qty, ref_code, operator, remark, created_at)
SELECT CONCAT('TX', DATE_FORMAT(x.received_at, '%Y%m%d'), '-8', LPAD(x.k, 3, '0'), x.i),
       'purchase_in', x.product_id, x.product_name, x.warehouse_id, w.name,
       x.qty,
       st.qty0 + x.cum - x.qty,
       st.qty0 + x.cum,
       x.po_code, 'gm', '采购收货入库（演示补齐）', x.received_at
FROM tmp_tx x
JOIN warehouses w ON w.id = x.warehouse_id
JOIN (
  SELECT ws.product_id, ws.warehouse_id,
         ws.qty - COALESCE(a.total, 0) AS qty0
  FROM warehouse_stock ws
  LEFT JOIN (SELECT product_id, warehouse_id, SUM(qty) AS total FROM tmp_items
             GROUP BY product_id, warehouse_id) a
    ON a.product_id = ws.product_id AND a.warehouse_id = ws.warehouse_id
) st ON st.product_id = x.product_id AND st.warehouse_id = x.warehouse_id;

COMMIT;

-- ---------------------------------------------------------------------------
-- 9) 结果核对（口径：只统计已签收的物流单）
-- ---------------------------------------------------------------------------
SELECT s.code AS supplier,
       s.name AS supplier_name,
       COUNT(lg.id) AS delivered_samples,
       SUM(CASE WHEN ev.last_time <= lg.expected_arrival THEN 1 ELSE 0 END) AS on_time_orders,
       ROUND(SUM(CASE WHEN ev.last_time <= lg.expected_arrival THEN 1 ELSE 0 END)
             / NULLIF(COUNT(lg.id), 0) * 100, 1) AS on_time_rate_pct
FROM suppliers s
LEFT JOIN purchase_orders po
       ON po.supplier_id = s.id AND po.status = 'completed'
LEFT JOIN logistics_orders lg
       ON lg.po_id = po.id
      AND lg.status = 'delivered'
      AND lg.expected_arrival IS NOT NULL
LEFT JOIN (SELECT logistics_id, MAX(time) AS last_time
           FROM logistics_events GROUP BY logistics_id) ev
       ON ev.logistics_id = lg.id
GROUP BY s.code, s.name
ORDER BY on_time_rate_pct DESC;
