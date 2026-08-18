# 家庭记账本小程序

[![WeChat MiniProgram](https://img.shields.io/badge/WeChat-MiniProgram-07C160?logo=wechat&logoColor=white)](https://developers.weixin.qq.com/miniprogram/dev/framework/)
[![Cloud Functions](https://img.shields.io/badge/WeChat-CloudBase-2764E8)](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/guide/functions/getting-started.html)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

一个面向家庭/多人协作的记账微信小程序，支持通过邀请码或二维码加入同一家庭账本，协同记录日常收支。

## 目录

- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
- [页面说明](#页面说明)
- [云数据库集合](#云数据库集合)
- [核心业务规则](#核心业务规则)
- [编码规范](#编码规范)
- [文档](#文档)
- [当前状态](#当前状态)
- [License](#license)

## 功能特性

- [x] 多账本切换：创建/加入多个家庭账本
- [x] 账单管理：收支记录、连续记账、再记一笔
- [x] 分类管理：固定两级分类，支持新增、修改、停用
- [x] 账户管理：账户仅作为标签，不管理余额
- [x] 预算管理：按月设置预算，首页预算概览，预算预警与超支提示
- [x] 统计：收支汇总、分类占比、趋势、成员统计
- [x] 搜索与筛选：按日期、分类、账户、成员、金额区间等多维筛选
- [x] 邀请机制：管理员生成邀请码，成员扫码/点击加入
- [x] 权限控制：管理员可管理账本、成员、分类、账户、预算；普通成员只能编辑/删除自己创建的账单
- [x] 数据导入：兼容随手记导出的 xlsx 格式

## 技术栈

| 技术 | 说明 |
|------|------|
| 微信小程序原生开发 | WXML + WXSS + JavaScript |
| 微信云开发 | 云函数（Node.js）+ 云数据库 + 云存储 |
| 图表 | ec-canvas（ECharts 微信小程序版） |
| 表格解析 | 云函数内使用 `xlsx` npm 包 |

## 项目结构

```
miniprogram-1/
├── miniprogram/                    # 小程序前端代码
│   ├── app.js                      # 小程序入口，云开发初始化
│   ├── app.json                    # 全局配置（pages、tabBar、window）
│   ├── app.wxss                    # 全局样式
│   ├── envList.js                  # 云环境 ID 配置
│   ├── pages/                      # 页面目录
│   │   ├── index/                  # 记账首页
│   │   ├── stats/                  # 统计页
│   │   ├── bills/                  # 账单列表
│   │   ├── profile/                # 我的
│   │   ├── addBill/                # 记账表单
│   │   ├── family/                 # 家庭管理
│   │   ├── category/               # 分类管理
│   │   ├── budget/                 # 预算设置
│   │   ├── account/                # 账户管理
│   │   ├── import/                 # 数据导入
│   │   ├── search/                 # 搜索页
│   │   └── ...
│   └── components/                 # 自定义组件
├── cloudfunctions/                 # 云函数目录
│   ├── accountingFunctions/        # 记账与统计相关
│   ├── ledgerFunctions/            # 账本、成员、邀请、初始化等
│   └── resetTestData/              # 测试数据重置
├── project.config.json             # 项目配置
├── 需求基线.md                      # 已确认业务规则（最高优先级参考）
└── 需求文档.md                      # 产品需求文档
```

## 快速开始

### 环境要求

- [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)（推荐使用最新稳定版）
- 已开通微信云开发的小程序项目
- AppID：`wx96cb7e5c5b71584a`
- 基础库最低版本：2.2.3

### 本地开发

1. **克隆仓库**

```bash
git clone https://github.com/<your-username>/family-ledger-miniprogram.git
cd family-ledger-miniprogram
```

2. **用微信开发者工具打开项目**

使用微信开发者工具打开项目根目录。

3. **配置云环境**

在 `miniprogram/app.js` 和 `miniprogram/envList.js` 中填写实际云环境 ID。

4. **上传并部署云函数**

依次进入 `cloudfunctions/` 下各函数目录，右键选择「上传并部署：云端安装依赖」。

5. **编译预览**

在微信开发者工具中点击「编译」，即可在模拟器中预览。

## 页面说明

| 页面 | 路径 | 说明 |
|------|------|------|
| 记账 | `pages/index/index` | 首页，最近账单 + 快速记账入口 |
| 统计 | `pages/stats/index` | 收支汇总、分类占比、趋势、成员统计 |
| 账单 | `pages/bills/index` | 账单列表、搜索与筛选 |
| 我的 | `pages/profile/index` | 用户信息、账本管理、设置 |
| 记账表单 | `pages/addBill/index` | 新增/编辑账单 |
| 家庭管理 | `pages/family/index` | 账本信息、成员管理、邀请管理 |
| 分类管理 | `pages/category/index` | 一级/二级分类管理 |
| 预算设置 | `pages/budget/index` | 按月预算、预算概览 |
| 账户管理 | `pages/account/index` | 账户标签管理 |
| 数据导入 | `pages/import/index` | 导入随手记 xlsx |
| 搜索 | `pages/search/index` | 账单搜索 |

## 云数据库集合

| 集合名 | 说明 | 权限 |
|--------|------|------|
| `users` | 用户信息（openid、昵称、头像） | 仅创建者可读写 |
| `families` | 家庭账本（名称、创建者、创建时间） | 仅创建者可读写 |
| `family_members` | 账本成员关系（familyId、openid、角色、加入时间） | 仅创建者可读写 |
| `family_invites` | 家庭邀请码（familyId、code、状态、过期时间） | 仅创建者可读写 |
| `bills` | 账单记录 | 仅创建者可读写 |
| `categories` | 分类（两级结构，含图标） | 仅创建者可读写 |
| `accounts` | 账户标签（familyId、名称） | 仅创建者可读写 |
| `budgets` | 预算（familyId、月份、金额） | 仅创建者可读写 |
| `operation_logs` | 操作日志 | 仅创建者可读写 |

> 所有集合权限设为「仅创建者可读写」，前端不直接操作数据库，所有数据读写通过云函数中转。

## 核心业务规则

- **单币种**：仅人民币 CNY
- **账户仅标签**：不管理余额，仅用于筛选
- **不拆分**：一笔账只对应一个分类
- **成员即记账人**：不再保留独立的“记账人”字段
- **多账本**：一个用户可加入多个家庭账本，支持切换
- **导入兼容**：兼容随手记导出的 xlsx 格式

详细规则见 [需求基线.md](./需求基线.md)。

## 编码规范

- 缩进：2 空格
- 字符串：双引号
- 语句结束：分号不省略
- 命名：变量/函数 camelCase，常量 UPPER_SNAKE_CASE
- 注释：中文，简洁明了
- 前端绝不直接读写数据库，全部走云函数

## 文档

- [需求基线.md](./需求基线.md)：已确认业务规则，最高优先级参考
- [需求文档.md](./需求文档.md)：产品需求详情

## 当前状态

项目持续开发中，核心页面、云函数和基础能力已接入。

## License

MIT
