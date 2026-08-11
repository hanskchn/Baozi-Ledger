# AGENTS.md — 家庭记账本小程序

本文件为 AI 编程助手提供项目约定和工作指南。开发任何代码前请先阅读本文件。

**同时必须阅读项目根目录的 `需求基线.md`。** 该文件记录用户已确认的全部业务规则，是当前产品需求的最高优先级参考。发生冲突时，按"用户最新明确确认 > 需求基线.md > 本文件 > 需求文档.md > 现有实现"处理；发现无法自行消解的冲突时，先向用户报告并暂停相关实现。

## 项目概述

家庭共享记账微信小程序，支持多人通过邀请码/二维码加入同一家庭账本，协同记录日常收支。详见 `需求文档.md`。

## 技术栈

- 微信小程序原生开发（WXML + WXSS + JS）
- 微信云开发（云函数 Node.js + 云数据库 + 云存储）
- 图表：ec-canvas（ECharts 微信小程序版）
- xlsx 解析：云函数中使用 `xlsx` npm 包
- AppID: `wx96cb7e5c5b71584a`
- 基础库最低版本：2.2.3（云开发要求）

## 目录结构

```
miniprogram-1/
├── miniprogram/              # 小程序前端代码
│   ├── app.js                # 小程序入口，云开发初始化
│   ├── app.json              # 全局配置（pages、tabBar、window）
│   ├── app.wxss              # 全局样式
│   ├── envList.js            # 云环境 ID 配置
│   ├── pages/                # 页面目录
│   │   └── index/            # 每个页面一个文件夹（.js .json .wxml .wxss）
│   ├── components/           # 自定义组件
│   └── images/               # 图片资源
├── cloudfunctions/           # 云函数目录
│   └── quickstartFunctions/  # 每个云函数一个文件夹（index.js + package.json + config.json）
├── project.config.json       # 项目配置
└── 需求文档.md                # 产品需求文档
```

## 页面规划

4 个 Tab 页（需在 `app.json` 的 `tabBar` 中配置）：

1. 首页（记账）—— `pages/index/index`
2. 统计页 —— `pages/stats/index`
3. 账单页 —— `pages/bills/index`
4. 我的页 —— `pages/profile/index`

子页面（非 Tab）：
- 记账表单 —— `pages/addBill/index`
- 家庭管理 —— `pages/family/index`
- 分类管理 —— `pages/category/index`
- 预算设置 —— `pages/budget/index`
- 账户管理 —— `pages/account/index`
- 数据导入 —— `pages/import/index`
- 搜索页 —— `pages/search/index`

## 云数据库集合

| 集合名 | 说明 | 权限 |
|--------|------|------|
| `users` | 用户信息（openid、昵称、头像） | 仅创建者可读写 |
| `families` | 家庭账本（名称、创建者openid、创建时间） | 仅创建者可读写 |
| `family_members` | 账本成员关系（familyId、openid、角色、加入时间） | 仅创建者可读写 |
| `family_invites` | 家庭邀请码（familyId、code、状态、创建时间、过期时间） | 仅创建者可读写 |
| `bills` | 账单记录 | 仅创建者可读写 |
| `categories` | 分类（familyId、一级分类、一级图标、二级分类、二级图标、类型） | 仅创建者可读写 |
| `accounts` | 账户标签（familyId、名称） | 仅创建者可读写 |
| `budgets` | 预算（familyId、月份、金额） | 仅创建者可读写 |

> 所有集合权限设为「仅创建者可读写」，数据读写均通过云函数中转，在云函数内做权限校验。绝不直接在前端操作数据库。

## 云函数规范

### 动作参数约定（必须遵守）

云函数分发动作统一使用 `action` 字段；业务字段 `type` 仅表示业务类型（例如账单的 `expense` / `income`）。前端调用辅助函数必须使用 `{ ...data, action: actionName }`，禁止使用 `{ type: actionName, ...data }`，避免业务字段覆盖云函数动作导致 `UNKNOWN_ACTION`。云函数入口应优先读取 `event.action`，并可兼容回退到 `event.type`。

### 目录结构

每个云函数独立一个目录，包含：
- `index.js` — 函数入口
- `package.json` — 依赖声明
- `config.json` — 权限配置（如需要调用开放接口）

### 入口模式

沿用项目现有模式，单云函数通过 `event.type` 分发：

```javascript
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  switch (event.type) {
    case "actionName":
      return await actionName(event);
    // ...
  }
};
```

### 权限校验

所有涉及写操作的云函数必须：
1. 通过 `cloud.getWXContext()` 获取当前用户 openid
2. 查询 `family_members` 确认用户是否为该账本成员
3. 检查用户角色（admin/member）是否有权执行该操作
4. 普通成员只能编辑/删除自己创建的账单；管理员可操作所有

### 依赖安装

云函数依赖通过在该函数目录下 `npm install` 安装，依赖会随函数一起上传部署。

## 编码规范

### 通用

- 缩进：2 空格（`project.config.json` 中 `tabIndent: "insertSpaces"`, `tabSize: 2`）
- 字符串：双引号
- 语句结束：分号不省略
- 命名：变量/函数用 camelCase，常量用 UPPER_SNAKE_CASE
- 中文注释，简洁明了

### 页面/组件

- 每个页面/组件一个独立目录，包含 `.js` `.json` `.wxml` `.wxss` 四件套
- 页面在 `app.json` 的 `pages` 数组中注册
- Tab 页在 `app.json` 的 `tabBar` 中配置
- 组件放在 `miniprogram/components/` 下，使用时在页面 `.json` 中声明

### WXML

- 使用 `wx:if` / `wx:for`，`wx:for` 必须加 `wx:key`
- 数据绑定用双花括号 `{{ }}`
- 事件绑定用 `bindtap` / `bindinput` 等

### WXSS

- 尺寸单位优先使用 `rpx`（750rpx = 屏幕宽度）
- 字体大小等可酌情用 `px`
- 全局样式放 `app.wxss`，页面特有样式放页面 `.wxss`

### JavaScript

- 使用 `const` / `let`，不用 `var`
- 异步操作使用 `async/await`
- 云函数入口统一用 `exports.main = async (event, context) => {}`
- 前端调用云函数：`wx.cloud.callFunction({ name, data })`

## 分类图标

所有分类使用 Emoji 图标，存储在 `categories` 集合的 `一级图标` 和 `二级图标` 字段中。预设分类和图标见 `需求文档.md` 第 3.3 节。用户新增分类时可自选 Emoji。

## 关键业务规则

1. **单币种**：仅人民币 CNY，无需汇率处理
2. **账户仅标签**：账户不管理余额，仅用于筛选
3. **不拆分**：一笔账只对应一个分类，不支持多分类拆分
4. **成员即记账人**：加入账本的用户自动成为成员，不单独添加不登录的成员；账单不再保留独立的"记账人"字段，成员字段同时表示归属成员
5. **权限**：管理员可增删改所有账单和设置；普通成员只能编辑/删除自己记的账
6. **多账本**：一个用户可加入多个家庭账本，支持切换
7. **导入兼容**：需兼容随手记导出的 xlsx 格式（两个 Sheet：支出、收入）

## 数据导入字段映射（随手记 xlsx）

| xlsx 字段 | 映射到 | 说明 |
|-----------|--------|------|
| 交易类型 | bills.type | 支出/收入 |
| 日期 | bills.date | 转为时间戳 |
| 一级分类 | bills.category1 | 不存在则自动创建 |
| 二级分类 | bills.category2 | 不存在则自动创建 |
| 支出账户/收入账户 | bills.account | 不存在则自动创建 |
| 账户币种 | 忽略 | 固定 CNY |
| 金额 | bills.amount | 数值 |
| 成员 | bills.member | 匹配账本成员，不匹配归导入者 |
| 商家 | bills.merchant | 可空 |
| 项目分类 | 忽略 | |
| 项目 | 忽略 | |
| 备注 | bills.remark | |

## 开发注意事项

- 修改云函数后需在微信开发者工具中右键「上传并部署」
- `envList.js` 和 `app.js` 中的 `env` 需填入实际云环境 ID
- 新增页面后记得在 `app.json` 注册
- `lazyCodeLoading: "requiredComponents"` 已开启，组件按需加载
- 图片资源放 `miniprogram/images/`，分类图标用 Emoji 不需要图片
- 不要在前端直接读写数据库，一律走云函数
