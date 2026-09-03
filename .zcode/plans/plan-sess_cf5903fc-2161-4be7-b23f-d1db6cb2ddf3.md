## Bug：记一笔页选「其他」二级分类时，一级分类不跟随

### 根因
`miniprogram/pages/addBill/index.js:403`（`selectCategory2`）用二级分类**名称**反查父级：`categories.find(item => item.children.some(c => c.name === child.name))`。「其他」在多个一级分类下同名存在时，`find` 永远命中第一个含「其他」的一级分类，导致表单的一级分类不是用户当前浏览的那个（可能存错账单分类）。

同根因的第二处：`selectRecentCategory`（`miniprogram/pages/addBill/index.js:371-391`）点击「最近使用」时忽略记录里已保存的 `category1`，同样按名称反查，同名二级分类会解析到错误的一级分类。

### 修复方案（仅改前端一个文件）

1. **`selectCategory2`**（index.js:401-414）——父级解析改为三级兜底：
   - ① 优先按二级分类唯一 `id` 在全部分类树中反查父级（`normalizeCategories` 已保证子项带 `id`，`data-child` 会传入）；
   - ② 失败则按当前侧边栏选中的一级分类 `selectedCategory1` 定位父级，并校验其 children 确实含该子项；
   - ③ 仍失败才按名称反查（保留旧行为兜底）。

2. **`selectRecentCategory`**（index.js:371-391）——优先用最近使用记录里已保存的 `item.category1` 定位父级（校验该子项仍存在）；找不到（一级分类被改名/停用）再回退到现有的按名称反查 + 「该分类已停用」提示逻辑。

3. 两处均在命中正确父级后照旧写入 `category1/category1Icon` 并关闭弹窗，不动保存/记忆最近使用等其余逻辑。

### 影响范围
- 仅 `miniprogram/pages/addBill/index.js` 一个文件，纯前端改动，无云函数改动、无需部署。
- 正向影响：保存账单的 `category1` 字段将正确（统计页、账单筛选按一级分类聚合的数据随之准确）。
- 不改动但相关的：`applyDefaults`（index.js:227-248，父级按 remembered.category1 先定位再找子项，逻辑正确无需改）；`updateLocalCacheAfterSave`、分类管理页不受影响。

### 验证清单（微信开发者工具/真机）
1. 记一笔 → 打开分类选择器，切到一个**非第一个**含「其他」的一级分类（如娱乐/购物），点「其他」→ 表单分类行显示「该一级分类 › 其他」，保存后账单详情一级分类正确。
2. 选过一次后，重开选择器点「最近使用」里的「其他」→ 一级分类正确。
3. 回归：正常唯一命名的二级分类（如午餐/打车）选择不受影响；支出/收入切换后默认分类正常。