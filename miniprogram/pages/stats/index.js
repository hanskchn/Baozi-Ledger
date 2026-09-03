const { debounce } = require("../../utils/perf");

const app = getApp();

const STATS_CACHE_TTL_MS = 60 * 1000;

const chartColors = ["#FF8C42", "#F6B84C", "#E5784B", "#C96B45", "#A98254", "#E9A968"];
const COLORS_EXPENSE = ["#FF8C42", "#F6B84C", "#E5784B", "#C96B45", "#A98254", "#E9A968", "#D96A23", "#7BA585", "#9F7AEA", "#5B8FF9"];
const COLORS_INCOME = ["#4CAF50", "#66BB6A", "#81C784", "#A5D6A7", "#43A047", "#7CB342", "#388E3C", "#2E7D32", "#9CCC65", "#AED581"];

Page({
  data: { currentMonth: "", dateStart: "", dateEnd: "", tempMonth: "", tempDateStart: "", tempDateEnd: "", showTimeSheet: false, periodMode: "month", timeMode: "month", quick: "thisMonth", displayMonth: "", monthExpense: "0.00", monthIncome: "0.00", monthBalance: "0.00", expenseCategoryStats: [], incomeCategoryStats: [], categoryStats: [], dailyTrend: [], categorySlicesForChart: [], chartType: "expense", chartMode: "pie", loading: true, members: [], accounts: [], memberOptions: ["全部成员"], accountOptions: ["全部账户"], memberPickerIndex: 0, accountPickerIndex: 0, filterMember: "", filterMemberLabel: "", filterAccount: "", loadedFamilyId: "", trendGranularity: "day", trendSmooth: true },
  onLoad() {
    const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const month = shifted.getUTCFullYear() + "-" + String(shifted.getUTCMonth() + 1).padStart(2, "0");
    this.setData({ currentMonth: month, displayMonth: shifted.getUTCFullYear() + "年" + (shifted.getUTCMonth() + 1) + "月", tempMonth: month, quick: "thisMonth", timeMode: "month" });
    this._debouncedLoadStats = debounce(() => this.loadStats(), 200);
  },
  buildStatsCacheKey() {
    const familyId = app.globalData.currentFamilyId;
    if (!familyId) return null;
    let period = this.data.currentMonth;
    if (this.data.periodMode === "custom") period = this.data.dateStart + "_" + this.data.dateEnd;
    else if (this.data.periodMode === "all") period = "all";
    const filterObj = {
      periodMode: this.data.periodMode,
      period,
      filterMember: this.data.filterMember,
      filterAccount: this.data.filterAccount,
      chartType: this.data.chartType,
      chartMode: this.data.chartMode
    };
    const filterKey = Object.keys(filterObj).sort().map((k) => k + "=" + (filterObj[k] || "")).join("|");
    return `stats:${familyId}:${filterKey}`;
  },
  onShow() {
    const dirty = app.globalData.billsDirty === true;
    if (dirty) app.globalData.billsDirty = false;
    this.loadOptions().then(() => this.loadStats({ forceRefresh: dirty }));
  },
  async onPullDownRefresh() {
    try {
      this.loadOptions();
      await this.loadStats({ forceRefresh: true });
    } finally {
      wx.stopPullDownRefresh();
    }
  },
  async loadOptions() { try { await app.ensureInitialized(); const familyId = app.globalData.currentFamilyId; if (!familyId) return; if (this.data.loadedFamilyId && this.data.loadedFamilyId !== familyId) this.setData({ filterMember: "", filterMemberLabel: "", filterAccount: "", memberPickerIndex: 0, accountPickerIndex: 0 }); const res = await wx.cloud.callFunction({ name: "accountingFunctions", data: { action: "listFormOptions", familyId } }); const members = res.result?.members || []; const accounts = res.result?.accounts || []; this.setData({ members, accounts, memberOptions: ["全部成员"].concat(members.map((item) => item.nickName || "微信用户")), accountOptions: ["全部账户"].concat(accounts.map((item) => item.name)), loadedFamilyId: familyId }); } catch (error) { console.warn("加载统计筛选项失败", error); } },
  async loadStats(options) {
    const forceRefresh = options && options.forceRefresh === true;
    const requestId = (this._statsRequestId = (this._statsRequestId || 0) + 1);
    this.setData({ loading: true });
    try {
      await app.ensureInitialized();
      if (requestId !== this._statsRequestId) return;
      // 缓存命中：60s 内 + 非 forceRefresh 直接渲染并刷新图表
      const cacheKey = this.buildStatsCacheKey();
      if (!forceRefresh && cacheKey) {
        let cached = null;
        try { cached = wx.getStorageSync(cacheKey); } catch (error) { cached = null; }
        if (cached && cached.payload && Date.now() - cached.ts < STATS_CACHE_TTL_MS) {
          const p = cached.payload;
          if (requestId !== this._statsRequestId) return;
          this.setData({
            monthExpense: p.monthExpense, monthIncome: p.monthIncome, monthBalance: p.monthBalance,
            expenseCategoryStats: p.expense, incomeCategoryStats: p.income, categoryStats: p.categories,
            dailyTrend: p.trend, trendGranularity: p.granularity || "day", trendSmooth: p.granularity === "day"
          });
          return;
        }
      }

      const granularity = this._resolveGranularity();
      const stats = await this._fetchStats(granularity);
      if (requestId !== this._statsRequestId) return;

      // 全部时间按月查询后，若跨度超过 3 年则切换为按年重新查询
      let finalGranularity = granularity;
      let rawTrend = stats.dailyTrend || [];
      if (granularity === "month" && this.data.periodMode === "all" && rawTrend.length >= 2) {
        const firstMonth = rawTrend[0].date.slice(0, 7);
        const lastMonth = rawTrend[rawTrend.length - 1].date.slice(0, 7);
        const spanMonths = (Number(lastMonth.slice(0, 4)) - Number(firstMonth.slice(0, 4))) * 12
          + (Number(lastMonth.slice(5, 7)) - Number(firstMonth.slice(5, 7))) + 1;
        if (spanMonths > 36) {
          finalGranularity = "year";
          const yearStats = await this._fetchStats("year");
          if (requestId !== this._statsRequestId) return;
          rawTrend = yearStats.dailyTrend || [];
          // 总额仍以第一次查询为准（分类聚合不受粒度影响），只替换趋势数据
        }
      }

      const expense = stats.expenseCategoryStats || stats.categoryStats || [];
      const income = stats.incomeCategoryStats || [];
      const categories = this.decorateCategories(this.data.chartType === "expense" ? expense : income, this.data.chartType);
      const trend = this._zeroFillTrend(rawTrend, finalGranularity);
      const newSlices = this.groupForPie(this.data.chartType === "expense" ? expense : income);
      this.setData({ monthExpense: Number(stats.totalExpense || 0).toFixed(2), monthIncome: Number(stats.totalIncome || 0).toFixed(2), monthBalance: Number(stats.balance || 0).toFixed(2), expenseCategoryStats: expense, incomeCategoryStats: income, categoryStats: categories, dailyTrend: trend, categorySlicesForChart: newSlices, trendGranularity: finalGranularity, trendSmooth: finalGranularity === "day" });
      // 写缓存
      if (cacheKey) {
        try {
          wx.setStorageSync(cacheKey, {
            ts: Date.now(),
            payload: {
              monthExpense: this.data.monthExpense, monthIncome: this.data.monthIncome, monthBalance: this.data.monthBalance,
              expense, income, categories, trend, granularity: finalGranularity
            }
          });
        } catch (storageError) {
          console.warn("统计缓存写入失败", storageError);
        }
      }
    } catch (error) { wx.showToast({ title: error.message || "加载统计失败", icon: "none" }); }
    finally { if (requestId === this._statsRequestId) this.setData({ loading: false }); }
  },

  async _fetchStats(trendGranularity) {
    const data = { action: "getStats", familyId: app.globalData.currentFamilyId, trendGranularity };
    if (this.data.periodMode === "all") {
      data.allTime = true;
      data.dateStart = "0000-01-01";
      data.dateEnd = "9999-12-31";
    } else if (this.data.periodMode === "custom") {
      data.dateStart = this.data.dateStart;
      data.dateEnd = this.data.dateEnd;
    } else {
      data.month = this.data.currentMonth;
    }
    data.memberId = this.data.filterMember;
    data.account = this.data.filterAccount;
    const response = await wx.cloud.callFunction({ name: "accountingFunctions", data });
    if (!response.result?.success) throw new Error(response.result?.message || "加载失败");
    return response.result;
  },

  _resolveGranularity() {
    if (this.data.periodMode === "month") return "day";
    if (this.data.periodMode === "all") return "month";
    const { dateStart, dateEnd } = this.data;
    if (!dateStart || !dateEnd) return "day";
    const startTs = new Date(dateStart + "T00:00:00+08:00").getTime();
    const endTs = new Date(dateEnd + "T00:00:00+08:00").getTime();
    const daySpan = Math.round((endTs - startTs) / 86400000) + 1;
    return daySpan <= 60 ? "day" : "month";
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
      categorySlicesForChart: [],
      loading: true, loadedFamilyId: newFamilyId
    });
    this.loadOptions().then(() => this.loadStats({ forceRefresh: true })).catch(() => {});
  },

  // 给分类列表加 percent / displayAmount / color（不分组，rank 列表保持完整）
  decorateCategories(items, scheme) {
    const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    if (!total) return [];
    const COLORS = scheme === "income" ? COLORS_INCOME : COLORS_EXPENSE;
    return items.map((item, i) => ({
      ...item,
      displayAmount: Number(item.amount || 0).toFixed(2),
      percent: Math.max(1, Math.round(Number(item.amount || 0) / total * 100)),
      color: COLORS[i % COLORS.length]
    }));
  },
  // 仅给饼图用：扇区上限 MAX_SLICES - 1 + 「其他」
  // 1) Top TOP_N 一定显示
  // 2) Top 之外、占比 >= MIN_PERCENT 的中间档也单独显示（避免被吞）
  // 3) Top 之外、占比 < MIN_PERCENT 的尾部合并为「其他」
  // rank 列表仍用 decorateCategories 全量，避免「其他」点了查不到账
  groupForPie(items) {
    const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    if (!total) return [];
    const TOP_N = 6;
    const MAX_SLICES = 10;
    const MIN_PERCENT = 2;
    const sorted = items.slice().sort((a, b) => Number(b.amount) - Number(a.amount));
    const top = sorted.slice(0, TOP_N);
    const middle = sorted.slice(TOP_N).filter((item) => Number(item.amount) / total * 100 >= MIN_PERCENT);
    const tail = sorted.slice(TOP_N).filter((item) => Number(item.amount) / total * 100 < MIN_PERCENT);
    // 合并 top + middle，超过 MAX_SLICES - 1 时把多余的挤进 tail
    const shown = top.concat(middle);
    const kept = shown.slice(0, MAX_SLICES - 1);
    const overflow = shown.slice(MAX_SLICES - 1).concat(tail);
    const result = kept.map((item) => ({ name: item.name, value: Number(item.amount), icon: item.icon || '' }));
    if (overflow.length > 0) {
      const overflowValue = overflow.reduce((s, x) => s + Number(x.amount || 0), 0);
      if (overflowValue > 0) result.push({ name: "其他", value: overflowValue });
    }
    return result;
  },
  changePeriod(e) {
    if (this.data.periodMode !== "month") return;
    const delta = Number(e.currentTarget.dataset.delta);
    const [year, mon] = this.data.currentMonth.split("-").map(Number);
    const next = new Date(Date.UTC(year, mon - 1 + delta, 1));
    const newMonth = next.getUTCFullYear() + "-" + String(next.getUTCMonth() + 1).padStart(2, "0");
    this._applyTime({ periodMode: "month", currentMonth: newMonth, displayMonth: this._formatMonth(newMonth), quick: "custom", timeMode: "month" });
  },
  openTimeSheet() {
    this.setData({
      showTimeSheet: true,
      tempMonth: this.data.currentMonth || this._thisMonthString(),
      tempDateStart: this.data.dateStart,
      tempDateEnd: this.data.dateEnd,
      timeMode: this.data.periodMode === "custom" ? "range" : "month"
    });
  },
  closeTimeSheet() {
    this.setData({ showTimeSheet: false }, () => {
      // hidden 切换后部分机型 canvas 内容丢失，主动重绘
      wx.nextTick(() => {
        const pie = this.selectComponent("#pieChart");
        const trend = this.selectComponent("#trendChart");
        if (pie && pie.redraw) pie.redraw();
        if (trend && trend.redraw) trend.redraw();
      });
    });
  },
  stopPropagation() {},
  selectQuick(e) {
    const key = e.currentTarget.dataset.key;
    const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const y = now.getUTCFullYear();
    const thisMonth = this._thisMonthString();
    const prev = new Date(Date.UTC(y, now.getUTCMonth() - 1, 1));
    const lastMonth = prev.getUTCFullYear() + "-" + String(prev.getUTCMonth() + 1).padStart(2, "0");
    if (key === "thisMonth") {
      this._applyTime({ periodMode: "month", currentMonth: thisMonth, displayMonth: this._formatMonth(thisMonth), dateStart: "", dateEnd: "", quick: "thisMonth", timeMode: "month" });
      this.closeTimeSheet();
    } else if (key === "lastMonth") {
      this._applyTime({ periodMode: "month", currentMonth: lastMonth, displayMonth: this._formatMonth(lastMonth), dateStart: "", dateEnd: "", quick: "lastMonth", timeMode: "month" });
      this.closeTimeSheet();
    } else if (key === "thisYear") {
      this._applyTime({ periodMode: "custom", currentMonth: "", displayMonth: y + "年", dateStart: y + "-01-01", dateEnd: y + "-12-31", quick: "thisYear", timeMode: "range" });
      this.closeTimeSheet();
    } else if (key === "all") {
      this._applyTime({ periodMode: "all", currentMonth: "", displayMonth: "全部时间", dateStart: "", dateEnd: "", quick: "all", timeMode: "month" });
      this.closeTimeSheet();
    } else if (key === "customMonth") {
      this.setData({ quick: "custom", timeMode: "month" });
    } else if (key === "customRange") {
      const today = this.getShanghaiDate();
      const fallbackStart = this.data.currentMonth ? this.data.currentMonth + "-01" : today;
      this.setData({ quick: "custom", timeMode: "range", tempDateStart: this.data.tempDateStart || fallbackStart, tempDateEnd: this.data.tempDateEnd || today });
    }
  },
  onTempMonthChange(e) {
    const value = e.detail.value;
    this._applyTime({ periodMode: "month", currentMonth: value, displayMonth: this._formatMonth(value), dateStart: "", dateEnd: "", quick: "custom", timeMode: "month" });
  },
  onTempStartChange(e) {
    const value = e.detail.value;
    if (this.data.tempDateEnd && value > this.data.tempDateEnd) {
      wx.showToast({ title: "开始日期不能晚于结束日期", icon: "none" });
      return;
    }
    this.setData({ tempDateStart: value, quick: "custom", timeMode: "range" });
    if (this.data.tempDateEnd) {
      this._applyTime({ periodMode: "custom", currentMonth: "", displayMonth: this._formatRange(value, this.data.tempDateEnd), dateStart: value, dateEnd: this.data.tempDateEnd, quick: "custom", timeMode: "range" });
      this.closeTimeSheet();
    }
  },
  onTempEndChange(e) {
    const value = e.detail.value;
    if (this.data.tempDateStart && value < this.data.tempDateStart) {
      wx.showToast({ title: "结束日期不能早于开始日期", icon: "none" });
      return;
    }
    this.setData({ tempDateEnd: value, quick: "custom", timeMode: "range" });
    if (this.data.tempDateStart) {
      this._applyTime({ periodMode: "custom", currentMonth: "", displayMonth: this._formatRange(this.data.tempDateStart, value), dateStart: this.data.tempDateStart, dateEnd: value, quick: "custom", timeMode: "range" });
      this.closeTimeSheet();
    }
  },
  _applyTime(patch) {
    this.setData(patch);
    this._debouncedLoadStats();
  },
  _thisMonthString() {
    const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
    return now.getUTCFullYear() + "-" + String(now.getUTCMonth() + 1).padStart(2, "0");
  },
  _zeroFillTrend(rawData, granularity) {
    if (!rawData || rawData.length === 0) return [];
    const today = this.getShanghaiDate();
    const map = {};
    rawData.forEach((item) => { map[item.date] = item; });

    if (granularity === "year") {
      const startY = Number(rawData[0].date.slice(0, 4));
      const endY = Math.max(Number(rawData[rawData.length - 1].date.slice(0, 4)), Number(today.slice(0, 4)));
      const result = [];
      for (let y = startY; y <= endY; y++) {
        const key = String(y);
        const item = map[key] || { date: key, expense: 0, income: 0 };
        result.push({ ...item, label: key, fullLabel: key + "年" });
      }
      return result;
    }

    if (granularity === "month") {
      let startYM, endYM;
      if (this.data.periodMode === "all") {
        startYM = rawData[0].date.slice(0, 7);
        endYM = rawData[rawData.length - 1].date.slice(0, 7);
      } else {
        const bounds = this._getRangeBounds();
        startYM = bounds.start.slice(0, 7);
        endYM = bounds.end.slice(0, 7);
      }
      if (this.data.periodMode === "all") {
        const lastDataYM = rawData[rawData.length - 1].date.slice(0, 7);
        if (endYM < lastDataYM) endYM = lastDataYM;
      }
      if (startYM > endYM) return [];
      const [sy, sm] = startYM.split("-").map(Number);
      const [ey, em] = endYM.split("-").map(Number);
      const crossYear = sy !== ey;
      const result = [];
      let y = sy, m = sm;
      while (y < ey || (y === ey && m <= em)) {
        const mm = String(m).padStart(2, "0");
        const key = y + "-" + mm;
        const item = map[key] || { date: key, expense: 0, income: 0 };
        result.push({
          ...item,
          label: crossYear ? String(y).slice(2) + "/" + m : m + "月",
          fullLabel: y + "年" + m + "月"
        });
        m++;
        if (m > 12) { m = 1; y++; }
      }
      return result;
    }

    // day
    const bounds = this._getRangeBounds();
    let startStr = bounds.start;
    let endStr = bounds.end;
    if (this.data.periodMode === "all") {
      startStr = rawData[0].date.slice(0, 10);
      endStr = rawData[rawData.length - 1].date.slice(0, 10);
      if (endStr < today) endStr = today;
    }
    if (startStr > endStr) return [];
    const crossYear = startStr.slice(0, 4) !== endStr.slice(0, 4);
    const result = [];
    const cur = new Date(startStr + "T00:00:00Z");
    const end = new Date(endStr + "T00:00:00Z");
    while (cur.getTime() <= end.getTime()) {
      const y = cur.getUTCFullYear();
      const m = cur.getUTCMonth() + 1;
      const d = cur.getUTCDate();
      const key = y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      const item = map[key] || { date: key, expense: 0, income: 0 };
      result.push({
        ...item,
        label: crossYear ? String(y).slice(2) + "/" + m + "/" + d : m + "/" + d,
        fullLabel: y + "年" + m + "月" + d + "日"
      });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return result;
  },
  _getRangeBounds() {
    if (this.data.periodMode === "month" && this.data.currentMonth) {
      const [y, m] = this.data.currentMonth.split("-").map(Number);
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return {
        start: y + "-" + String(m).padStart(2, "0") + "-01",
        end: y + "-" + String(m).padStart(2, "0") + "-" + String(lastDay).padStart(2, "0")
      };
    }
    return { start: this.data.dateStart, end: this.data.dateEnd };
  },
  _formatMonth(month) {
    if (!month) return "全部时间";
    const [y, m] = month.split("-");
    return y + "年" + Number(m) + "月";
  },
  _formatRange(start, end) {
    const fmt = (d) => {
      if (!d) return "";
      const [y, m, day] = d.split("-");
      return Number(y) + "年" + Number(m) + "月" + Number(day) + "日";
    };
    const shortFmt = (d) => {
      if (!d) return "";
      const [, m, day] = d.split("-");
      return Number(m) + "月" + Number(day) + "日";
    };
    if (!start && !end) return "全部时间";
    if (start && end && start === end) return fmt(start);
    if (start && end && start.substring(0, 4) === end.substring(0, 4)) {
      return start.substring(0, 4) + "年" + shortFmt(start) + " ~ " + shortFmt(end);
    }
    if (start && end) return fmt(start) + " ~ " + fmt(end);
    return fmt(start) || fmt(end);
  },
  getShanghaiDate() {
    const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const pad = (v) => String(v).padStart(2, "0");
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
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
  switchChartType(event) {
    const chartType = event.currentTarget.dataset.type;
    const source = chartType === "expense" ? this.data.expenseCategoryStats : this.data.incomeCategoryStats;
    const categoryStats = this.decorateCategories(source, chartType);
    const newSlices = this.groupForPie(source);
    this.setData({ chartType, categoryStats, categorySlicesForChart: newSlices });
  },
  switchChartMode(event) {
    const chartMode = event.currentTarget.dataset.mode;
    if (chartMode === this.data.chartMode) return;
    this.setData({ chartMode });
  },
  _navigateToCategory(name) {
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
    if (this.data.periodMode === "custom") {
      filter.filterDateStart = this.data.dateStart;
      filter.filterDateEnd = this.data.dateEnd;
    } else if (this.data.periodMode === "all") {
      // 全部时间：不过滤日期
    } else {
      filter.filterMonth = this.data.currentMonth;
    }
    app.globalData.pendingBillsFilter = filter;
    wx.switchTab({ url: "/pages/bills/index" });
  },
  onCategoryTap(event) {
    this._navigateToCategory(event.currentTarget.dataset.name);
  },
  onPieTap(event) {
    this._navigateToCategory(event.detail && event.detail.name);
  },

});
