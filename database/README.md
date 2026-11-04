# database/ — 数据库资产

MySQL 库名：**`supplymind`**（MySQL 8.4.5，`utf8mb4`）

| 文件 | 说明 |
|---|---|
| `schema-mysql.sql` | 建表脚本（19 张业务表 + 视图，含索引与外键） |
| `supplymind_demo_data.sql` | 演示数据（约 152 条供应商、商品、仓库、采购单、物流等） |

> `backend/schema-mysql.sql` 与这里的 `schema-mysql.sql` 是同一份文件（后端脚本会引用它）。
> 改结构时**只改一处再同步**，避免两处不一致。

## 一、从零重建数据库

```powershell
# 1) 建库 + 建表
mysql -uroot -p1234 -e "create database if not exists supplymind default charset utf8mb4 collate utf8mb4_general_ci;"
mysql -uroot -p1234 supplymind < database\schema-mysql.sql

# 2) 灌演示数据（可选）
mysql -uroot -p1234 supplymind < database\supplymind_demo_data.sql
```

也可以直接用后端自带的脚本（会读 `backend/.env` 的连接配置）：

```powershell
cd backend
python scripts/apply_schema.py      # 只建表
python scripts/import_sql.py --yes  # 导入演示数据
```

## 二、连接配置

统一在 `backend/.env`：

```ini
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=1234
DB_NAME=supplymind
DB_CHARSET=utf8mb4
```

改完重启后端即可（`AUTO_CREATE_TABLES=true` 时缺失的表会自动补建）。

## 三、注意

- 演示数据脚本体量较大（约 600 KB），是**纯 INSERT**，重复导入前先清空对应表。
- `AUTO_SEED_DEMO_DATA=false`：库被清空时后端不会偷偷写回演示数据；
  页面数据与库里不一致时，先确认真的导过 `supplymind_demo_data.sql`。
