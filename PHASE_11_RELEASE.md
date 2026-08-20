# Phase 11 发版候选收尾

> 本清单是 V1.1 发布计划的收尾动作。**前置条件**：Phase 8（部署）+ Phase 9（联调）+ Phase 10（真机）全部执行完毕且结论为"通过"。
> 预计耗时：30-45 分钟。
>
> **相关文档**：
> - [V1.1 发布计划](./家庭记账本_V1.1_发布计划与验收目标.md)
> - [Phase 8 部署清单](./PHASE_8_DEPLOY.md)
> - [Phase 9 联调清单](./PHASE_9_E2E.md)
> - [Phase 10 真机清单](./PHASE_10_DEVICE.md)
> - [ECharts 优化资料（V1.2 素材）](./ECHARTS_OPTIMIZATION.md)

---

## 0. 发版前最终复跑（自动化）

| 步骤 | 命令 | 通过标准 |
|---|---|---|
| 静态验收 12 步 | `npm run verify` | 全部 ✔；主包仍 < 2MB |
| 单元+契约测试 | `npm test` | 63/63 pass，0 fail |
| 3 个云函数语法 | `for d in cloudfunctions/*/; do node --check "$d/index.js" || exit 1; done` | 无 `SyntaxError` |
| 测试 xlsx 生成 | `node scripts/gen-test-xlsx.js /tmp/release-check.xlsx` | 提示 "支出 62 条 / 收入 20 条 / 未来日期 1 / 重复 1" |

如任一步骤失败，**先修复再继续**，禁止带病发版。

---

## 1. 发版说明（Release Notes）模板

在 `家庭记账本_V1.1_发布说明.md`（新建文件）写明：

```markdown
# 家庭记账本 V1.1 发布说明

## 版本
- 版本号：1.1.0
- 提交 SHA：（`git rev-parse HEAD`）
- 发版日期：YYYY-MM-DD

## 核心变更
- （从本 V1.1 计划"核心新增"小节摘录）
- （从 V1.0 末尾"已知问题"摘已修复的）

## 体验改进
- 主页批量加载（`pages/index/index.js` L210-215）
- 统计页趋势/分类图表（`pages/stats/index.js`）
- 7 张品牌资源压缩（816KB → 579KB）
- 导入容错（未来日期拒绝 + 重复指纹去重）

## 暂缓功能（V1.1 不做）
- 排序 UI
- 通知类（每日提醒 / 预算提醒 / 成员记账通知）
- 图片凭证 / 周期记账 / 标签 / 收藏置顶

## 部署信息
- 云环境 ID：cloud1-d1gq4g6a7c2911b56
- AppID：wx96cb7e5c5b71584a
- 11 集合 / 13 索引 / 3 云函数（详见 PHASE_8_DEPLOY.md）
```

---

## 2. 发布动作（微信侧）

| 步骤 | 操作 | 备注 |
|---|---|---|
| 2.1 | 微信开发者工具 → 右上角「上传」 | 版本号填 1.1.0，项目备注写本次核心变更 |
| 2.2 | 微信公众平台 mp.weixin.qq.com → 版本管理 | 找到刚上传的 1.1.0 版本，设为「体验版」 |
| 2.3 | 扫码添加 2-3 个体验成员 | 复跑核心记账流程 |
| 2.4 | （可选）提交审核 → 发布 | 首次需类目与隐私协议；个人主体类目受限 |

---

## 3. 收尾动作（仓库侧）

| 步骤 | 操作 | 命令/位置 |
|---|---|---|
| 3.1 | git status 自查 | `git status --short`（确保无意外脏文件） |
| 3.2 | git diff --check | 与 verify 步骤 12 一致 |
| 3.3 | 合并 commit | `git add -A && git commit -m "release: v1.1.0"` |
| 3.4 | 打 tag | `git tag -a v1.1.0 -m "V1.1.0 发布候选"` |
| 3.5 | 推送到远端 | `git push origin main --tags`（按需） |

> 注意事项：
> - 任何敏感信息（openid、测试账号、个人账单截图）**严禁**入库。
> - 若引入新依赖（npm 包），先 `npm install` 再 `package-lock.json` 一起提交。

---

## 4. 发版后 7 天观察

| 观察项 | 阈值 | 处置 |
|---|---|---|
| 云函数报错率 | < 1% | 查 `cloudfunctions` 日志 |
| 体验成员反馈 | 全部 P3 以下 | 立即修复 P0/P1；P3 入 V1.2 |
| 主包体积 | 仍 < 2MB | 接近 1.9MB 即评估 ECharts 替换（见 [ECHARTS_OPTIMIZATION.md](./ECHARTS_OPTIMIZATION.md) 方案 A） |
| 导入失败率 | < 5% | 走 PHASE_9_E2E 复测 |

---

## 5. V1.2 候选（仅规划，不实施）

> 来源：[ECHARTS_OPTIMIZATION.md](./ECHARTS_OPTIMIZATION.md) 5 方案对比 + 用户偏好

- ECharts 1MB → 替换为轻量图表方案（方案 A：uCharts 0.3MB）
- 排序 UI 入口（服务端 sort 已就位，仅缺 UI）
- 通知类（每日提醒 / 预算提醒 / 成员记账）
- 图片凭证 / 周期记账 / 标签 / 收藏置顶

**进入 V1.2 开发需用户再次确认；任何"已就位未启用"的功能（排序/通知）不得在 V1.1 偷偷启用。**

---

*Phase 11 收尾 · V1.1 计划最后一步*
