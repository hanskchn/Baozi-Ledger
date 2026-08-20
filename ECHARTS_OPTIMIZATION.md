# ECharts 1MB 优化方案（V1.2 素材）

> 本文档分析 `miniprogram/ec-canvas/echarts.js` 体积问题（占主包 54%），列出 V1.2 候选方案。
> **不在 V1.1 实施**（V1.1 Phase 7 已通过主包 1880KB < 2MB，余量 168KB 足够支撑 Phase 8-10）。

---

## 1. 现状

| 项 | 值 |
|---|---|
| `echarts.js` 大小 | **1017 KB**（1.0 MB） |
| 主包总大小 | 1880 KB |
| ECharts 占主包比例 | **54%** |
| 主包余量 | 168 KB（2MB - 1880KB） |
| ECharts 实际用到的图表 | **pie（饼图）+ line（折线图）** |
| ECharts 包含的图表类型 | pie / line / bar / scatter / heatmap / treemap / sunburst / graph / sankey / funnel / gauge / boxplot / parallel / radar / map / 等等 |

**核心矛盾**：用了 1MB 的库，仅画 2 种最基础的图。

---

## 2. 优化方案对比

### 方案 A：自定义 ECharts 构建（推荐）

**做法**：
1. `npm install echarts@5.3.3`（独立安装，不通过 ec-canvas 集成包）
2. 用 webpack 写一个 entry 只 import 需要的模块
3. 构建产物替换 `ec-canvas/echarts.js`

**示例 webpack.config.js**：
```js
module.exports = {
  mode: 'production',
  entry: './echarts-custom.js',
  output: {
    path: __dirname,
    filename: 'echarts.custom.js',
    libraryTarget: 'umd'
  },
  resolve: { alias: { zrender: 'zrender' } }
};
```

**`echarts-custom.js`**（仅 import 需要的）：
```js
import * as echarts from 'echarts/lib/echarts';
import 'echarts/lib/chart/pie';
import 'echarts/lib/chart/line';
import 'echarts/lib/component/title';
import 'echarts/lib/component/tooltip';
import 'echarts/lib/component/legend';
import 'echarts/lib/component/grid';
import 'echarts/lib/component/dataset';
import 'zrender/lib/zrender';
export default echarts;
```

**预估产物**：~250-350 KB（**节省 ~700 KB**）

**优点**：
- 保留 ECharts 全功能
- 官方推荐做法
- 未来扩展图表无需重构

**缺点**：
- 需要 npm + webpack 工具链
- `ec-canvas` 组件源码要小幅调整（换 import 路径）
- 引入新依赖增加维护成本

**实施成本**：0.5 人天

---

### 方案 B：替换为 wx-charts（最轻量）

**做法**：
1. `npm install wx-charts` 或下载 `wxcharts-min.js` 单文件
2. 替换 `pages/stats/index.js` 中的 `import * as echarts` 为 `import wxCharts from "wx-charts"`
3. 改写 `setOption` 为 `wxCharts` 的 options 格式
4. 改 `ec-canvas` 组件 → 用 `<canvas>` 直接画

**预估产物**：~50 KB（**节省 ~970 KB**）

**wx-charts 支持**：pie / line / bar / column / area / scatter / ring / radar

**优点**：
- 体积最小
- API 简单，专注移动端
- 无需 webpack

**缺点**：
- 样式定制能力较弱（颜色、tooltip 都是预设）
- 不支持 areaStyle 渐变（折线图面积填充需手算）
- 库作者已停止维护（最新版本 2019 年），但社区 fork 仍可用（`wx-charts-fork`）
- 需要重写约 200 行统计页代码

**实施成本**：1-1.5 人天

---

### 方案 C：替换为 uCharts（功能 + 体积平衡）

**做法**：
1. `npm install @qiun/vue-ucharts` 或下载 `uCharts` 单文件
2. 替换 echarts 为 uCharts
3. API 与 ECharts 相似（命令式 setOption）

**预估产物**：~150 KB（**节省 ~870 KB**）

**uCharts 支持**：60+ 图表类型（pie / line / bar / area / column / mount / rose / radar / gauge / word / funnel / map / 等等）

**优点**：
- 功能比 wx-charts 强，比 ECharts 体积小
- 仍在活跃维护（@qiun 大神 2023-2024 持续更新）
- 支持跨端（H5 / 小程序 / App）
- 性能优化（适合大数据量）

**缺点**：
- API 与 ECharts 不完全兼容，需要适配
- 文档以 H5 为主，小程序 demo 较少
- 仍需替换 ec-canvas 组件

**实施成本**：1-1.5 人天

---

### 方案 D：云存储按需加载（不改库，挪位置）

**做法**：
1. 把 `echarts.js` 上传到云存储（路径 `assets/echarts.js`）
2. 在 `pages/stats/index.js` 的 `onLoad` 中：
   ```js
   const { tempFileURL } = await wx.cloud.getTempFileURL({ fileList: ['cloud://xxx/assets/echarts.js'] });
   // 动态 require（小程序不支持动态 require，需提前 import）
   ```
3. **小程序不支持运行时动态 require** → 必须用 `<script>` 注入或提前打包为 chunk

**结论**：**该方案不可行**。微信小程序的 JS 模块必须在编译时确定，无法运行时下载 JS。

---

### 方案 E：手写 SVG 图表（极限轻量）

**做法**：
1. 删除 `ec-canvas/echarts.js` 整套
2. 删除 `ec-canvas` 组件
3. 在 `pages/stats/index.wxml` 用 `<view>` 容器 + CSS/SVG 画饼图和折线图
4. 饼图：算每个扇区角度，用 SVG `<path>` 画
5. 折线图：用 `<view>` 加 transform 画点和线

**预估节省**：~1000 KB（完全去掉 echarts + ec-canvas）

**优点**：
- 体积最小
- 完美契合设计系统
- 性能好（纯 SVG）

**缺点**：
- 手写 SVG 饼图 + 折线图约 200-300 行代码
- 失去所有 ECharts 高级功能（动画、tooltip、事件）
- 适配器（不同尺寸/数据）要自己写
- 后续要加新图表都得手写

**实施成本**：2-3 人天（含适配器）

---

## 3. 推荐方案

**短期（V1.1 之前，不做）**：保持 ECharts 全量，主包余量足够

**中期（V1.2 视用户反馈决定）**：
- 如果用户**经常反馈"统计页加载慢"** → 方案 A（自定义 ECharts）
- 如果用户**反馈"统计页用得少"** → 方案 B（换 wx-charts 极限压缩）
- 如果用户**反馈"想看更多图表"** → 方案 C（换 uCharts）

**长期（V1.3+）**：保持方案 A + 持续 tree-shake 优化

---

## 4. 实施步骤（以方案 A 为例）

### A.1 准备工具链
```bash
npm install --save-dev echarts@5.3.3 webpack webpack-cli
```

### A.2 写自定义 entry
新建 `scripts/build-echarts.js`（参考 §2.A 示例）

### A.3 构建
```bash
node_modules/.bin/webpack --config scripts/build-echarts.js
# 产物输出到 miniprogram/ec-canvas/echarts.custom.js
```

### A.4 改 import 路径
```js
// pages/stats/index.js
- import * as echarts from "../../ec-canvas/echarts";
+ import * as echarts from "../../ec-canvas/echarts.custom";
```

### A.5 验证
- npm run verify 12 步
- npm test 63+ 项
- 开发者工具中打开统计页 → 饼图 + 折线图正常

### A.6 复测主包
期望：主包从 1880 KB 降到 **1180-1280 KB**（节省 600+ KB）

---

## 5. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| ECharts 升级破坏 API | 自定义构建失败 | 锁定版本（5.3.3），每次升级前用 mock 数据跑测试 |
| 自定义构建漏掉模块 | 统计页某功能失效 | 逐图表功能测试（hover/tooltip/animation） |
| 体积虽小但仍不够 | 后续加资源又超 2MB | 把 ECharts 阈值降到 600 KB（主包上限 1500 KB 给其他资源） |
| 切换图表库 API 不兼容 | 大改 stats 页面 | 保留 ec-canvas 组件，仅替换 echarts 入口 |

---

## 6. 决策依据

| 维度 | 评分（1-5） |
|---|---|
| 体积节省 | A: 4 / B: 5 / C: 4 / D: 0 / E: 5 |
| 实施成本 | A: 3 / B: 2 / C: 2 / D: 1 / E: 1 |
| 维护性 | A: 4 / B: 2 / C: 3 / D: 1 / E: 1 |
| 功能丰富度 | A: 5 / B: 2 / C: 4 / D: 5 / E: 1 |
| 风险 | A: 2 / B: 3 / C: 3 / D: 5 / E: 4 |

**总分**：A: 16 / B: 14 / C: 14 / D: 12 / E: 12

**最优**：**方案 A（自定义 ECharts 构建）** —— 体积与功能平衡最好

---

## 7. 实施记录

> V1.2 启动时填充：

- 2026-XX-XX：（待 V1.2 启动后填写）
