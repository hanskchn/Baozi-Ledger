import * as echarts from "../../ec-canvas/echarts";
const { debounce } = require("../../utils/perf");

const app = getApp();

const STATS_CACHE_TTL_MS = 60 * 1000;
let pieChart;
let trendChart;
let pieData = [];
let trendData = [];

const chartColors = ["#FF8C42", "#F6B84C", "#E5784B", "#C96B45", "#A98254", "#E9A968"];

const updatePieChart = () => {
  if (!pieChart) return;
  pieChart.clear();
  pieChart.setOption({
    color: chartColors,
    tooltip: { trigger: "item", formatter: "{b}\n¥{c} ({d}%)" },
    series: [{
      type: "pie",
      radius: ["44%", "70%"],
      center: ["50%", "50%"],
      avoidLabelOverlap: true,
      label: { color: "#6B5145", fontSize: 11, formatter: "{b} {d}%" },
      labelLine: { length: 8, length2: 7, lineStyle: { color: "#C9B5A8" } },
      data: pieData
    }]
  });
};

const updateTrendChart = () => {
  if (!trendChart) return;
  trendChart.clear();
  trendChart.setOption({
    color: ["#FF6B35", "#4CAF50"],
    tooltip: { trigger: "axis", formatter: (params) => params.map((item) => item.marker + item.seriesName + " ¥" + Number(item.value || 0).toFixed(2)).join("\n") },
    legend: { data: ["支出", "收入"], top: 2, right: 0, textStyle: { color: "#8D6E63", fontSize: 11 } },
    grid: { left: 10, right: 12, top: 36, bottom: 20, containLabel: true },
    xAxis: { type: "category", boundaryGap: false, data: trendData.map((item) => item.label), axisLine: { lineStyle: { color: "#E8DDD1" } }, axisTick: { show: false }, axisLabel: { color: "#A58D80", fontSize: 10 } },
    yAxis: { type: "value", minInterval: 1, axisLabel: { color: "#A58D80", fontSize: 10, formatter: (value) => "¥" + value }, splitLine: { lineStyle: { color: "#F2E9E0", type: "dashed" } }, axisLine: { show: false }, axisTick: { show: false } },
    series: [
      { name: "支出", type: "line", smooth: true, showSymbol: trendData.length <= 7, symbolSize: 6, lineStyle: { width: 2 }, areaStyle: { color: "rgba(255,107,53,0.12)" }, data: trendData.map((item) => item.expense) },
      { name: "收入", type: "line", smooth: true, showSymbol: trendData.length <= 7, symbolSize: 6, lineStyle: { width: 2 }, areaStyle: { color: "rgba(76,175,80,0.10)" }, data: trendData.map((item) => item.income) }
    ]
  });
};

const initPieChart = (canvas, width, height, dpr) => {
  pieChart = echarts.init(canvas, null, { width, height, devicePixelRatio: dpr });
  canvas.setChart(pieChart);
  updatePieChart();
  return pieChart;
};

const initTrendChart = (canvas, width, height, dpr) => {
  console.log("[trend] init size", width, height, "trendDataLen", trendData.length);
  trendChart = echarts.init(canvas, null, { width, height, devicePixelRatio: dpr });
  canvas.setChart(trendChart);
  updateTrendChart();
  return trendChart;
};

Page({
  data: { currentMonth: "", currentYear: "", dateStart: "", dateEnd: "", tempDateStart: "", tempDateEnd: "", showDateRangePicker: false, periodMode: "month", displayMonth: "", monthExpense: "0.00", monthIncome: "0.00", monthBalance: "0.00", expenseCategoryStats: [], incomeCategoryStats: [], categoryStats: [], dailyTrend: [], chartType: "expense", maxTrend: 1, loading: true, members: [], accounts: [], memberOptions: ["全部成员"], accountOptions: ["全部账户"], memberPickerIndex: 0, accountPickerIndex: 0, filterMember: "", filterMemberLabel: "", filterAccount: "", loadedFamilyId: "", pieEc: { onInit: initPieChart }, trendEc: { onInit: initTrendChart } },
  onLoad() {
    const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const month = shifted.getUTCFullYear() + "-" + String(shifted.getUTCMonth() + 1).padStart(2, "0");
    this.setData({ currentMonth: month, currentYear: String(shifted.getUTCFullYear()), displayMonth: shifted.getUTCFullYear() + "年" + (shifted.getUTCMonth() + 1) + "月" });
    this._debouncedLoadStats = debounce(() => this.loadStats(), 200);
  },
  buildStatsCacheKey() {
    const familyId = app.globalData.currentFamilyId;
    if (!familyId) return null;
    let period = this.data.currentMonth;
    if (this.data.periodMode === "year") period = this.data.currentYear;
    else if (this.data.periodMode === "custom") period = this.data.dateStart + "_" + this.data.dateEnd;
    const filterObj = {
      periodMode: this.data.periodMode,
      period,
      filterMember: this.data.filterMember,
      filterAccount: this.data.filterAccount
    };
    const filterKey = Object.keys(filterObj).sort().map((k) => k + "=" + (filterObj[k] || "")).join("|");
    return `stats:${familyId}:${filterKey}`;
  },
  onShow() {
    const dirty = app.globalData.billsDirty === true;
    if (dirty) app.globalData.billsDirty = false;
    this.loadOptions().then(() => this.loadStats({ forceRefresh: dirty }));
  },
  async loadOptions() { try { await app.ensureInitialized(); const familyId = app.globalData.currentFamilyId; if (!familyId) return; if (this.data.loadedFamilyId && this.data.loadedFamilyId !== familyId) this.setData({ filterMember: "", filterMemberLabel: "", filterAccount: "", memberPickerIndex: 0, accountPickerIndex: 0 }); const [memberResult, accountResult] = await Promise.all([wx.cloud.callFunction({ name: "accountingFunctions", data: { action: "listMembers", familyId } }), wx.cloud.callFunction({ name: "accountingFunctions", data: { action: "listAccounts", familyId } })]); const members = memberResult.result?.members || []; const accounts = accountResult.result?.accounts || []; this.setData({ members, accounts, memberOptions: ["全部成员"].concat(members.map((item) => item.nickName || "微信用户")), accountOptions: ["全部账户"].concat(accounts.map((item) => item.name)), loadedFamilyId: familyId }); } catch (error) { console.warn("加载统计筛选项失败", error); } },
  async loadStats(options) {
    const forceRefresh = options && options.forceRefresh === true;
    this.setData({ loading: true });
    try {
      await app.ensureInitialized();
      // 缓存命中：60s 内 + 非 forceRefresh 直接渲染并刷新图表
      const cacheKey = this.buildStatsCacheKey();
      if (!forceRefresh && cacheKey) {
        let cached = null;
        try { cached = wx.getStorageSync(cacheKey); } catch (error) { cached = null; }
        if (cached && cached.payload && Date.now() - cached.ts < STATS_CACHE_TTL_MS) {
          const p = cached.payload;
          pieData = p.pieData;
          trendData = p.trendData;
          this.setData({
            monthExpense: p.monthExpense, monthIncome: p.monthIncome, monthBalance: p.monthBalance,
            expenseCategoryStats: p.expense, incomeCategoryStats: p.income, categoryStats: p.categories,
            dailyTrend: p.trend, maxTrend: p.maxTrend
          }, () => { updatePieChart(); updateTrendChart(); });
          return;
        }
      }
      const data = { action: "getStats", familyId: app.globalData.currentFamilyId };
      if (this.data.periodMode === "year") data.year = this.data.currentYear;
      else if (this.data.periodMode === "custom") { data.dateStart = this.data.dateStart; data.dateEnd = this.data.dateEnd; }
      else data.month = this.data.currentMonth;
      data.memberId = this.data.filterMember;
      data.account = this.data.filterAccount;
      const response = await wx.cloud.callFunction({ name: "accountingFunctions", data });
      if (!response.result?.success) throw new Error(response.result?.message || "加载失败");
      const stats = response.result;
      const expense = stats.expenseCategoryStats || stats.categoryStats || [];
      const income = stats.incomeCategoryStats || [];
      const categories = this.decorateCategories(this.data.chartType === "expense" ? expense : income);
      const trend = (stats.dailyTrend || []).map((item) => ({ ...item, label: item.date.slice(8, 10) }));
      const maxTrend = Math.max(1, ...trend.map((item) => Math.max(Number(item.expense), Number(item.income))));
      pieData = categories.map((item) => ({ value: Number(item.amount || 0), name: item.name }));
      trendData = trend;
      this.setData({ monthExpense: Number(stats.totalExpense || 0).toFixed(2), monthIncome: Number(stats.totalIncome || 0).toFixed(2), monthBalance: Number(stats.balance || 0).toFixed(2), expenseCategoryStats: expense, incomeCategoryStats: income, categoryStats: categories, dailyTrend: trend, maxTrend }, () => { updatePieChart(); updateTrendChart(); });
      // 写缓存
      if (cacheKey) {
        try {
          wx.setStorageSync(cacheKey, {
            ts: Date.now(),
            payload: {
              monthExpense: this.data.monthExpense, monthIncome: this.data.monthIncome, monthBalance: this.data.monthBalance,
              expense, income, categories, trend, maxTrend, pieData: pieData.slice(), trendData: trendData.slice()
            }
          });
        } catch (storageError) {
          console.warn("统计缓存写入失败", storageError);
        }
      }
    } catch (error) { wx.showToast({ title: error.message || "加载统计失败", icon: "none" }); }
    finally { this.setData({ loading: false }); }
  },

  onFamilyChanged() {
    // 账本未变化（如首次初始化广播）：跳过重复加载
    const newFamilyId = app.globalData.currentFamilyId;
    if (newFamilyId && newFamilyId === this.data.loadedFamilyId) return;
    // 切账本：清统计缓存 + 重置筛选
    try {
      const info = wx.getStorageInfoSync();
      info.keys.forEach((k) => { if (k.startsWith("stats:")) wx.removeStorageSync(k); });
    } catch (error) { /* ignore */ }
    this.setData({
      filterMember: "", filterMemberLabel: "", filterAccount: "", memberPickerIndex: 0, accountPickerIndex: 0,
      monthExpense: "0.00", monthIncome: "0.00", monthBalance: "0.00",
      expenseCategoryStats: [], incomeCategoryStats: [], categoryStats: [], dailyTrend: [],
      loading: true, loadedFamilyId: newFamilyId
    });
    pieData = [];
    trendData = [];
    this.loadOptions().then(() => this.loadStats({ forceRefresh: true })).catch(() => {});
  },

  decorateCategories(items) { const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0); return items.map((item) => ({ ...item, displayAmount: Number(item.amount || 0).toFixed(2), percent: total ? Math.max(1, Math.round(item.amount / total * 100)) : 0 })); },
  switchMonth(event) { if (this.data.periodMode !== "month") return; const delta = Number(event.currentTarget.dataset.delta); const parts = this.data.currentMonth.split("-").map(Number); const next = new Date(parts[0], parts[1] - 1 + delta, 1); this.setData({ currentMonth: next.getFullYear() + "-" + String(next.getMonth() + 1).padStart(2, "0"), displayMonth: next.getFullYear() + "年" + (next.getMonth() + 1) + "月" }); this._debouncedLoadStats(); },
  selectPeriod() { wx.showActionSheet({ itemList: ["按月", "按年", "自定义日期范围"], success: (result) => { if (result.tapIndex === 0) { this.setData({ periodMode: "month", displayMonth: this.data.currentMonth.replace("-", "年") + "月" }); this._debouncedLoadStats(); return; } if (result.tapIndex === 1) { const year = this.data.currentYear; this.setData({ periodMode: "year", displayMonth: year + "年" }); this._debouncedLoadStats(); return; } this.openDateRangePicker(); } }); },
  getShanghaiDate() {
    const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const pad = (v) => String(v).padStart(2, "0");
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  },

  openDateRangePicker() {
    const today = this.getShanghaiDate();
    const start = this.data.dateStart || this.data.currentMonth + "-01";
    const end = this.data.dateEnd || today;
    this.setData({ tempDateStart: start, tempDateEnd: end, showDateRangePicker: true });
  },
  closeDateRangePicker() { this.setData({ showDateRangePicker: false }); },
  onTempStartChange(e) { this.setData({ tempDateStart: e.detail.value }); },
  onTempEndChange(e) { this.setData({ tempDateEnd: e.detail.value }); },
  confirmDateRange() {
    const dateStart = this.data.tempDateStart;
    const dateEnd = this.data.tempDateEnd;
    if (!dateStart || !dateEnd) { wx.showToast({ title: "请选择完整日期", icon: "none" }); return; }
    if (dateStart > dateEnd) { wx.showToast({ title: "开始日期不能晚于结束日期", icon: "none" }); return; }
    this.setData({
      periodMode: "custom",
      dateStart,
      dateEnd,
      displayMonth: dateStart + " 至 " + dateEnd,
      showDateRangePicker: false
    });
    this._debouncedLoadStats();
  },
  onMemberChange(event) {
    const index = Number(event.detail.value);
    const member = index > 0 ? (this.data.members || [])[index - 1] : null;
    this.setData({
      memberPickerIndex: index,
      filterMember: member ? member.memberId : "",
      filterMemberLabel: member ? (member.nickName || "微信用户") : ""
    });
    this._debouncedLoadStats();
  },
  onAccountChange(event) {
    const index = Number(event.detail.value);
    const account = index > 0 ? (this.data.accounts || [])[index - 1] : null;
    this.setData({
      accountPickerIndex: index,
      filterAccount: account ? account.name : ""
    });
    this._debouncedLoadStats();
  },
  switchChartType(event) { const chartType = event.currentTarget.dataset.type; const categoryStats = this.decorateCategories(chartType === "expense" ? this.data.expenseCategoryStats : this.data.incomeCategoryStats); pieData = categoryStats.map((item) => ({ value: Number(item.amount || 0), name: item.name })); this.setData({ chartType, categoryStats }, () => updatePieChart()); },
  onCategoryTap(event) {
    const name = event.currentTarget.dataset.name;
    if (!name) return;
    const filter = {
      filterCategory: name,
      filterType: this.data.chartType,
      filterAccount: this.data.filterAccount || "",
      filterMember: this.data.filterMember || "",
      filterMemberLabel: this.data.filterMemberLabel || "",
      filterMonth: "",
      filterDateStart: "",
      filterDateEnd: "",
      merchant: "", minAmount: "", maxAmount: "", remark: ""
    };
    if (this.data.periodMode === "year") {
      filter.filterDateStart = this.data.currentYear + "-01-01";
      filter.filterDateEnd = this.data.currentYear + "-12-31";
    } else if (this.data.periodMode === "custom") {
      filter.filterDateStart = this.data.dateStart;
      filter.filterDateEnd = this.data.dateEnd;
    } else {
      filter.filterMonth = this.data.currentMonth;
    }
    app.globalData.pendingBillsFilter = filter;
    wx.switchTab({ url: "/pages/bills/index" });
  },
  renderTrendChart() { updateTrendChart(); },
  onUnload() { if (pieChart) { pieChart.dispose(); pieChart = null; } if (trendChart) { trendChart.dispose(); trendChart = null; } },
  trendHeight(amount) { return Math.max(8, Math.round(Number(amount || 0) / this.data.maxTrend * 160)); }
});
