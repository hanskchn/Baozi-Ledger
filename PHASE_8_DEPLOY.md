# Phase 8 云端部署操作清单

> 本清单是 V1.1 发布计划 Phase 8 的逐步操作指引。所有操作均需在**微信开发者工具**或**云开发控制台**手动完成。
> 预计耗时：30-60 分钟（首次部署）/ 10 分钟（每次重新部署）。
>
> **相关文档**：
> - [V1.1 发布计划](./家庭记账本_V1.1_发布计划与验收目标.md)
> - [V1.0 云开发部署与验收清单](./云开发部署与验收清单.md)（V1.0 版本，仅参考）
> - 下一步：[PHASE_9_E2E.md](./PHASE_9_E2E.md)（真实数据联调）

---

## 0. 部署前预检（已完成 ✅）

| 检查项 | 状态 | 备注 |
|---|---|---|
| `miniprogram/app.js` 环境 ID | ✅ `cloud1-d1gq4g6a7c2911b56` | 与 `envList.js` 一致 |
| 云函数目录结构 | ✅ | `accountingFunctions` + `ledgerFunctions` + `resetTestData` |
| `accountingFunctions/node_modules` | ✅ xlsx 0.18.5 已装 | 部署时云端会再装一次 |
| 死代码已清理 | ✅ | 已删 `initCategories.js` / `billFunctions` / `initFunctions` |
| `npm run verify` 12 步 | ✅ | 主包 1880 KB < 2MB |
| `npm test` 63 项 | ✅ | 0 失败 |
| `node --check` 云函数语法 | ✅ | 3 个云函数全部通过 |

---

## 1. 云开发控制台：创建 11 个集合

打开**微信开发者工具** → 顶部「云开发」按钮 → 「数据库」标签页 → 左侧「集合管理」。（如果用云开发独立控制台也行：访问 https://console.cloud.tencent.com/tcb 并扫码登录同一个微信账号，环境 ID 是 `cloud1-d1gq4g6a7c2911b56`。）

依次创建以下 11 个集合（**权限统一设为「仅创建者可读写」**）：

| # | 集合名 | 用途 |
|---|---|---|
| 1 | `users` | 用户信息 |
| 2 | `families` | 家庭账本 |
| 3 | `family_members` | 账本成员关系 |
| 4 | `family_invites` | 邀请码 |
| 5 | `categories` | 分类 |
| 6 | `accounts` | 账户 |
| 7 | `bills` | 账单 |
| 8 | `budgets` | 预算 |
| 9 | `bill_preferences` | 分类/账户记忆 |
| 10 | `operation_logs` | 操作记录 |
| 11 | `initialization_locks` | 初始化幂等锁 |

**创建步骤**（每个集合重复）：
1. 点「+ 添加集合」
2. 输入集合名
3. 权限选「**仅创建者可读写**」
4. 确定

---

## 2. 云开发控制台：配置 13 条索引（仅手动可行）

「数据库」→ 选中集合 → 「索引管理」→ 「+ 添加索引」。

> **自动化不可行（2026-08-19 验证结论）**：尝试过 2 条自动化路径，**全部失败**。当前必须手动添加 13 条索引。
>
> - ❌ **`@cloudbase/cli`（`tcb`）批量建索引**：sandbox 不让写 `~/.config/.cloudbase` 配置目录；即使 escalate，`tcb login` 仍需用户终端扫码，省不了事。
> - ❌ **一次性云函数 `setupIndexes` 自举**：尝试在 `wx-server-sdk` 调 `db.collection().createIndex()`，**该方法不存在**（13 条全部抛 `createIndex is not a function`）。`wx-server-sdk` 服务端 SDK 不暴露任何索引管理 API。
>
> **结论**：微信云开发的索引管理**只**走控制台 GUI 或 HTTP API（`https://api.weixin.qq.com/tcb/createindex`，需 access_token），SDK 内部不可达。任何"自动化批量建索引"方案都依赖外部工具或 access_token，得不偿失。
>
> 后续如要重新评估自动化，候选：① 在云开发控制台用「可视化数据库管理工具」（截图右下角链接）尝试批量；② 写一个 Node 脚本用 access_token 调 HTTP API 一次性建完。


| # | 集合 | 索引名称 | 索引字段 | 属性 | 用途 |
|---|---|---|---|---|---|
| 1 | `family_members` | `member_permission_check` | `familyId` (升) + `openid` (升) + `status` (升) | 非唯一 | 成员与权限校验 |
| 2 | `family_members` | `init_and_list` | `openid` (升) + `status` (升) | 非唯一 | 初始化和账本列表 |
| 3 | `bills` | `bill_list` | `familyId` (升) + `deleted` (升) + `date` (**降**) | 非唯一 | 首页/账单分页/统计 |
| 4 | `bills` | `import_rollback` | `familyId` (升) + `importBatchId` (升) + `deleted` (升) | 非唯一 | 导入撤销 |
| 5 | `bills` | `import_dedup` | `familyId` (升) + `importFingerprint` (升) + `deleted` (升) | 非唯一 | 导入去重 |
| 6 | `categories` | `category_mgmt` | `familyId` (升) + `type` (升) + `parentId` (升) + `name` (升) | 非唯一 | 分类校验和管理 |
| 7 | `accounts` | `account_mgmt` | `familyId` (升) + `name` (升) | 非唯一 | 账户校验和管理 |
| 8 | `budgets` | `month_budget` | `familyId` (升) + `month` (升) | 非唯一 | 月预算 |
| 9 | `operation_logs` | `op_log_paging` | `familyId` (升) + `createdAt` (**降**) | 非唯一 | 操作日志分页 |
| 10 | `family_invites` | `invite_code_check` | `code` (升) + `status` (升) | 非唯一 | 邀请码验证 |
| 11 | `initialization_locks` | `init_lock` | `openid` (升) | **唯一** | 默认账本初始化幂等锁 |
| 12 | `families` | `admin_family` | `adminOpenid` (升) | 非唯一 | 管理员账本查询 |
| 13 | `operation_logs` | `op_log_dedup` | `familyId` (升) + `action` (升) + `targetId` (升) | 非唯一 | 解散/注销日志去重 |

**添加步骤**（每个索引重复）：
1. 选集合 → 「索引管理」→ 「+ 添加索引」
2. 输入「索引名称」（用表格第 3 列的英文名）
3. 依次点「+」加字段，每行输入字段名 + 选「升序」或「降序」
4. 「索引属性」选「**非唯一**」（仅 #11 选「**唯一**」）
5. 点「确定」

**推荐批次顺序**（最少切换集合）：
- 批次 1：`family_members` → #1 + #2
- 批次 2：`bills` → #3 + #4 + #5
- 批次 3：`categories` + `accounts` + `budgets` → #6 + #7 + #8
- 批次 4：`operation_logs` → #9 + #13
- 批次 5：`family_invites` + `initialization_locks` + `families` → #10 + #11 + #12

**核对标准（13 条全建好后）**：
- 8 个有自定义索引的集合总 13 条：`family_members` 2 / `bills` 3 / `categories` `accounts` `budgets` `family_invites` `initialization_locks` `families` 各 1 / `operation_logs` 2
- `users` / `bill_preferences` 集合只有系统自带的 `_openid` 索引（清单不要求，正常）
- 容易踩坑：#3 的 `date` 字段是**降序**（匹配代码 `orderBy("date", "desc")`）；#11 是**唯一**索引

> **注意**：云开发控制台添加复合索引可能需要几分钟生效；批量添加可减少来回切换。

---

## 3. 微信开发者工具：上传并部署云函数

打开微信开发者工具 → 加载项目 `miniprogram-1` → 「云开发」面板。

### 3.1 上传 `ledgerFunctions`（先上传，被 `accountingFunctions` 间接依赖）

1. 在「云开发」面板左侧树中找到 `cloudfunctions/ledgerFunctions`
2. 右键 → 「上传并部署：云端安装依赖（不上传 node_modules）」
3. 等待 1-2 分钟，直到显示「上传成功」

### 3.2 上传 `accountingFunctions`（含 xlsx 依赖，会自动安装）

1. 右键 `cloudfunctions/accountingFunctions` → 「上传并部署：云端安装依赖（不上传 node_modules）」
2. 等待 2-3 分钟（xlsx 依赖较多）
3. 看到「上传成功」即可

### 3.3 （可选）上传 `resetTestData`

仅 Phase 9 联调时需要：
1. 右键 `cloudfunctions/resetTestData` → 「上传并部署」
2. 联调完成后可删除

---

## 4. 验证云函数部署

在云开发控制台 → 「云函数」→ 选中 `ledgerFunctions` / `accountingFunctions`，确认：
- 在线状态：✅
- 最后部署时间：刚才
- 环境：cloud1-d1gq4g6a7c2911b56

**快速 smoke test**（云开发控制台 → 云函数 → ledgerFunctions → 「云端测试」）：

```json
{ "action": "initUser" }
```

期望返回：`{ success: true, user: {...}, family: {...} }` 或 `{ success: true, invalidInvite: {...} }`（无邀请码时不应有未捕获错误）。

---

## 5. 上传小程序代码

微信开发者工具 → 工具栏右上角「上传」按钮：
- 版本号：`1.0.0`（首次）
- 项目备注：`V1.0 MVP 首版 - 2026-08-18`
- 确定 → 等待上传完成

---

## 6. 清除 2 个测试账号的旧数据（仅首次部署）

打开云开发控制台 → 「数据库」→ 选中每个集合 → 「数据管理」→ 选中所有文档 → 删除。

> 或者更便捷：用 `resetTestData` 云函数：
> 1. 在云函数 → resetTestData → 「云端测试」
> 2. 看到 `results: { users: "removed N", ... }` 表示成功
>
> **生产环境严禁调用**，仅限测试环境。

---

## 7. 部署后冒烟测试清单

在开发者工具中打开预览，确认以下 5 个核心流程无错误：

| # | 流程 | 验证点 |
|---|---|---|
| 1 | 首次打开 | 不报错；显示待处理邀请或默认账本 |
| 2 | 创建一笔记账 | 列表 + 首页最近账单实时刷新 |
| 3 | 切换账本 | 概览/账单/统计全部切到新账本 |
| 4 | 邀请码加入 | 新成员能正常加入；老成员不重复创建 |
| 5 | 注销账号 | 数据清理 + 历史账单显示"已注销用户" |

> 5 个全部通过 → Phase 8 完成 → 进入 Phase 9 真实数据联调。

---

## 8. 部署失败排查

| 现象 | 原因 | 解决 |
|---|---|---|
| 上传时「找不到 wx-server-sdk」 | 没选「云端安装依赖」 | 改用「上传并部署：云端安装依赖」 |
| 「云函数执行失败：InternalError」 | 索引未生效或事务 SDK 限制 | 看云函数日志；补索引；考虑重构事务写法 |
| 初始化返回 `DATABASE_COLLECTION_NOT_EXIST` | 集合未创建或名字拼错 | 回到第 1 节核对 |
| 集合权限「所有用户可读」导致数据被前前端绕过 | 权限设置错 | 改为「仅创建者可读写」 |
| 索引「操作失败：字段已存在其他索引」 | 重复添加 | 删除重复索引 |

---

## 9. 部署完成后的下一步

- ✅ 部署完成 → 进入 **Phase 9 真实数据联调**
- 📝 部署结果（成功/失败/修复内容）记录到本文件末尾的「部署日志」

---

## 部署日志

> 部署完成后在此追加日期和结果：

- 2026-08-19：部署成功
