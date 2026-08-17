const app = getApp();
const { debounce, throttle } = require("../../utils/perf");

const BILLS_CACHE_TTL_MS = 60 * 1000;

Page({
  data: {
    bills: [],
    filterMonth: "",
    filterCategory: "",
    filterCategoryLevel: "",
    filterMember: "",
    filterMemberLabel: "",
    filterAccount: "",
    filterType: "",
    filterDateStart: "",
    filterDateEnd: "",
    filterMinAmount: "",
    filterMaxAmount: "",
    sort: "dateDesc",
    merchant: "",
    remark: "",
    activeFilterTags: [],
    hasActiveFilters: false,
    activeFilterCount: 0,
    periodDisplay: "",
    categories: [],
    members: [],
    accounts: [],
    isAdmin: false,
    offset: 0,
    hasMore: true,
    loadingMore: false,
    loadedFamilyId: "",
    slidBillId: "",
    swipeOffsetMap: {},
    swipeAnimating: false
  },

  onLoad() {
    const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const month = now.getUTCFullYear() + "-" + String(now.getUTCMonth() + 1).padStart(2, "0");
    this.setData({ filterMonth: month });
    this._debouncedLoadBills = debounce(() => this.loadBills(), 200);
    this._throttledLoadMore = throttle(() => this.loadBills(true), 200);
  },

  buildBillsCacheKey() {
    const familyId = app.globalData.currentFamilyId;
    if (!familyId) return null;
    const filterObj = {
      month: this.data.filterMonth,
      category: this.data.filterCategory,
      categoryLevel: this.data.filterCategoryLevel,
      member: this.data.filterMember,
      account: this.data.filterAccount,
      type: this.data.filterType,
      dateStart: this.data.filterDateStart,
      dateEnd: this.data.filterDateEnd,
      minAmount: this.data.filterMinAmount,
      maxAmount: this.data.filterMaxAmount,
      merchant: this.data.merchant,
      remark: this.data.remark,
      sort: this.data.sort
    };
    const filterKey = Object.keys(filterObj).sort().map((k) => k + "=" + (filterObj[k] || "")).join("|");
    return `bills:${familyId}:${filterKey}`;
  },

  async onShow() {
    try {
      await app.ensureInitialized();
      const familyId = app.globalData.currentFamilyId;
      const pendingFilter = app.globalData.pendingBillsFilter;
      if (pendingFilter) app.globalData.pendingBillsFilter = null;
      if (this.data.loadedFamilyId && this.data.loadedFamilyId !== familyId) {
        this.setData({
          filterCategory: "", filterCategoryLevel: "", filterMember: "", filterMemberLabel: "",
          filterAccount: "", filterType: "",
          filterDateStart: "", filterDateEnd: "",
          filterMinAmount: "", filterMaxAmount: "",
          merchant: "", remark: "", sort: "dateDesc",
          offset: 0
        });
      }
      this.setData({ loadedFamilyId: familyId });
      this.setData({ isAdmin: app.globalData.currentFamily?.role === "admin" });
      if (pendingFilter) {
        const hasDateRange = !!pendingFilter.filterDateStart || !!pendingFilter.filterDateEnd;
        this.setData({
          filterMonth: hasDateRange ? "" : (pendingFilter.filterMonth || ""),
          filterDateStart: pendingFilter.filterDateStart || "",
          filterDateEnd: pendingFilter.filterDateEnd || "",
          filterCategory: pendingFilter.filterCategory || "",
          filterCategoryLevel: pendingFilter.filterCategoryLevel || "",
          filterAccount: pendingFilter.filterAccount || "",
          filterType: pendingFilter.filterType || "",
          filterMember: pendingFilter.filterMember || "",
          filterMemberLabel: pendingFilter.filterMemberLabel || "",
          merchant: pendingFilter.merchant || "",
          filterMinAmount: pendingFilter.minAmount || "",
          filterMaxAmount: pendingFilter.maxAmount || "",
          remark: pendingFilter.remark || "",
          offset: 0
        });
        this._updateActiveFilterTags();
        await this.loadOptions();
        this._debouncedLoadBills();
        return;
      }
      if (app.globalData.billsDirty === true) {
        app.globalData.billsDirty = false;
        this.setData({ offset: 0 });
        this._updateActiveFilterTags();
        if (this.data.categories.length === 0 || this.data.accounts.length === 0 || this.data.members.length === 0) {
          await this.loadOptions();
        }
        await this.loadBills(false, true);
        return;
      }
      this._updateActiveFilterTags();
      const optionsReady = this.data.categories.length > 0 && this.data.accounts.length > 0 && this.data.members.length > 0;
      await Promise.all([optionsReady ? Promise.resolve() : this.loadOptions(), this.loadBills()]);
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
  },

  onFamilyChanged() {
    const newFamilyId = app.globalData.currentFamilyId;
    if (newFamilyId && newFamilyId === this.data.loadedFamilyId) return;
    try {
      wx.getStorageInfoSync && (() => {
        const info = wx.getStorageInfoSync();
        info.keys.forEach((k) => { if (k.startsWith("bills:")) wx.removeStorageSync(k); });
      })();
    } catch (error) { /* ignore */ }
    this.setData({
      bills: [], filterCategory: "", filterCategoryLevel: "", filterMember: "", filterMemberLabel: "",
      filterAccount: "", filterType: "", filterDateStart: "", filterDateEnd: "",
      filterMinAmount: "", filterMaxAmount: "", merchant: "", remark: "",
      sort: "dateDesc", offset: 0, hasMore: true, loadingMore: false,
      loadedFamilyId: newFamilyId
    });
    this.loadOptions().then(() => this.loadBills()).catch(() => {});
  },

  async loadOptions() {
    try {
      const familyId = app.globalData.currentFamilyId;
      if (!familyId) return;
      const [catRes, memRes, accRes] = await Promise.all([
        wx.cloud.callFunction({ name: "accountingFunctions", data: { action: "listCategories", familyId } }),
        wx.cloud.callFunction({ name: "accountingFunctions", data: { action: "listMembers", familyId } }),
        wx.cloud.callFunction({ name: "accountingFunctions", data: { action: "listAccounts", familyId } })
      ]);
      this.setData({
        categories: catRes.result.categories || [],
        members: memRes.result.members || [],
        accounts: accRes.result.accounts || []
      });
    } catch (error) {
      console.error("加载选项失败", error);
    }
  },

  async loadBills(append, forceRefresh) {
    try {
      const familyId = app.globalData.currentFamilyId;
      if (!familyId) return;
      const cacheKey = this.buildBillsCacheKey();
      if (!forceRefresh && !append && this.data.offset === 0 && cacheKey) {
        let cached = null;
        try { cached = wx.getStorageSync(cacheKey); } catch (error) { cached = null; }
        if (cached && cached.bills && Date.now() - cached.ts < BILLS_CACHE_TTL_MS) {
          const bills = cached.bills.map(bill => ({ ...bill, displayTime: (bill.date || "").substring(11, 16) }));
          this.setData({ bills, billGroups: this._groupBills(bills), hasMore: bills.length === 20, loadingMore: false });
          return;
        }
      }
      const result = await this.callFunction("listBills", {
        familyId,
        month: this.data.filterMonth,
        category: this.data.filterCategory,
        categoryLevel: this.data.filterCategoryLevel,
        memberId: this.data.filterMember,
        account: this.data.filterAccount,
        type: this.data.filterType,
        dateStart: this.data.filterDateStart,
        dateEnd: this.data.filterDateEnd,
        minAmount: this.data.filterMinAmount,
        maxAmount: this.data.filterMaxAmount,
        merchant: this.data.merchant,
        remark: this.data.remark,
        sort: this.data.sort,
        offset: this.data.offset,
        limit: 20
      });
      const incoming = (result.bills || []).map(bill => ({
        ...bill,
        displayAmount: (bill.amount / 100).toFixed(2),
        displayTime: (bill.date || "").substring(11, 16)
      }));
      const bills = append ? this.data.bills.concat(incoming) : incoming;
      this.setData({ bills, billGroups: this._groupBills(bills), hasMore: incoming.length === 20, loadingMore: false });
      if (!append && this.data.offset === 0 && cacheKey) {
        try { wx.setStorageSync(cacheKey, { ts: Date.now(), bills }); } catch (storageError) { console.warn("账单缓存写入失败", storageError); }
      }
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
      if (append) this.setData({ offset: Math.max(0, this.data.offset - 20), loadingMore: false });
      else this.setData({ loadingMore: false });
    }
  },

  changeMonth(e) {
    const delta = Number(e.currentTarget.dataset.delta);
    if (!this.data.filterMonth) {
      const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
      this.setData({
        filterMonth: this._shiftMonth(now.getUTCFullYear(), now.getUTCMonth() + 1, delta),
        filterDateStart: "",
        filterDateEnd: ""
      });
      this._updateActiveFilterTags();
      this._debouncedLoadBills();
      return;
    }
    const [year, mon] = this.data.filterMonth.split("-").map(Number);
    const newMonth = this._shiftMonth(year, mon, delta);
    this.setData({ filterMonth: newMonth, filterDateStart: "", filterDateEnd: "" });
    this._updateActiveFilterTags();
    this._debouncedLoadBills();
  },

  _shiftMonth(year, monthOneBased, delta) {
    const totalMonths = year * 12 + (monthOneBased - 1) + delta;
    const nextYear = Math.floor(totalMonths / 12);
    const nextMonth = totalMonths % 12 + 1;
    return nextYear + "-" + String(nextMonth).padStart(2, "0");
  },

  onMonthPickerChange(e) {
    const value = e.detail.value;
    if (!value) return;
    this.setData({ filterMonth: value, filterDateStart: "", filterDateEnd: "" });
    this._updateActiveFilterTags();
    this._debouncedLoadBills();
  },

  clearFilters() {
    const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const thisMonth = now.getUTCFullYear() + "-" + String(now.getUTCMonth() + 1).padStart(2, "0");
    this.setData({
      filterMonth: thisMonth,
      filterDateStart: "", filterDateEnd: "",
      filterCategory: "", filterCategoryLevel: "", filterAccount: "", filterType: "",
      filterMember: "", filterMemberLabel: "",
      merchant: "", filterMinAmount: "", filterMaxAmount: "", remark: "",
      offset: 0
    });
    this._updateActiveFilterTags();
    this._debouncedLoadBills();
  },

  removeFilterTag(e) {
    const key = e.currentTarget.dataset.key;
    const patch = { offset: 0 };
    if (key === "category") { patch.filterCategory = ""; patch.filterCategoryLevel = ""; }
    else if (key === "member") { patch.filterMember = ""; patch.filterMemberLabel = ""; }
    else if (key === "account") patch.filterAccount = "";
    else if (key === "type") patch.filterType = "";
    else if (key === "merchant") patch.merchant = "";
    else if (key === "amount") { patch.filterMinAmount = ""; patch.filterMaxAmount = ""; }
    else if (key === "remark") patch.remark = "";
    this.setData(patch);
    this._updateActiveFilterTags();
    this._debouncedLoadBills();
  },

  openFilter() {
    const params = [
      "filterMonth=" + encodeURIComponent(this.data.filterMonth || ""),
      "filterDateStart=" + encodeURIComponent(this.data.filterDateStart || ""),
      "filterDateEnd=" + encodeURIComponent(this.data.filterDateEnd || ""),
      "filterCategory=" + encodeURIComponent(this.data.filterCategory || ""),
      "filterCategoryLevel=" + encodeURIComponent(this.data.filterCategoryLevel || ""),
      "filterAccount=" + encodeURIComponent(this.data.filterAccount || ""),
      "filterType=" + encodeURIComponent(this.data.filterType || ""),
      "filterMember=" + encodeURIComponent(this.data.filterMember || ""),
      "filterMemberLabel=" + encodeURIComponent(this.data.filterMemberLabel || ""),
      "merchant=" + encodeURIComponent(this.data.merchant || ""),
      "minAmount=" + encodeURIComponent(this.data.filterMinAmount || ""),
      "maxAmount=" + encodeURIComponent(this.data.filterMaxAmount || ""),
      "remark=" + encodeURIComponent(this.data.remark || "")
    ].join("&");
    wx.navigateTo({ url: "/pages/filter/index?" + params });
  },

  onFilterConfirm(result) {
    const {
      filterMonth, filterDateStart, filterDateEnd,
      filterCategory, filterCategoryLevel, filterAccount, filterType,
      filterMember, filterMemberLabel,
      merchant, minAmount, maxAmount, remark
    } = result;
    this.setData({
      filterMonth, filterDateStart, filterDateEnd,
      filterCategory, filterCategoryLevel, filterAccount, filterType,
      filterMember, filterMemberLabel,
      merchant, minAmount, maxAmount, remark,
      offset: 0
    });
    this._updateActiveFilterTags();
    this._debouncedLoadBills();
  },

  _computePeriodDisplay() {
    if (this.data.filterDateStart || this.data.filterDateEnd) {
      return (this.data.filterDateStart || "") + " ~ " + (this.data.filterDateEnd || "");
    }
    const month = this.data.filterMonth;
    if (/^\d{4}-\d{2}$/.test(month || "")) {
      const [year, mon] = month.split("-").map(Number);
      return year + "年" + mon + "月";
    }
    return month || "全部时间";
  },

  _groupBills(bills) {
    const weekdayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const groups = [];
    const indexMap = {};
    (bills || []).forEach((bill) => {
      const day = (bill.date || "").substring(0, 10);
      if (!day) return;
      if (indexMap[day] === undefined) {
        const [year, month, date] = day.split("-").map(Number);
        const weekday = new Date(year, month - 1, date).getDay();
        indexMap[day] = groups.length;
        groups.push({
          day,
          title: year + "年" + month + "月" + date + "日 " + weekdayNames[weekday],
          expense: 0,
          income: 0,
          items: []
        });
      }
      const group = groups[indexMap[day]];
      const amountYuan = Number(bill.amount || 0) / 100;
      if (bill.type === "expense") group.expense += amountYuan;
      else if (bill.type === "income") group.income += amountYuan;
      group.items.push(bill);
    });
    groups.forEach((group) => {
      group.expense = group.expense.toFixed(2);
      group.income = group.income.toFixed(2);
    });
    return groups;
  },

  _updateActiveFilterTags() {
    const tags = [];
    if (this.data.filterCategory) tags.push({ key: "category", label: this.data.filterCategory });
    if (this.data.filterMember) tags.push({ key: "member", label: this.data.filterMemberLabel || "成员" });
    if (this.data.filterAccount) tags.push({ key: "account", label: this.data.filterAccount });
    if (this.data.filterType) tags.push({ key: "type", label: this.data.filterType === "expense" ? "支出" : "收入" });
    if (this.data.merchant) tags.push({ key: "merchant", label: this.data.merchant });
    if (this.data.filterMinAmount || this.data.filterMaxAmount) tags.push({ key: "amount", label: (this.data.filterMinAmount || "0") + "~" + (this.data.filterMaxAmount || "∞") });
    if (this.data.remark) tags.push({ key: "remark", label: this.data.remark });
    this.setData({
      activeFilterTags: tags,
      activeFilterCount: tags.length,
      hasActiveFilters: tags.length > 0,
      periodDisplay: this._computePeriodDisplay()
    });
  },

  async callFunction(type, data = {}) {
    const response = await wx.cloud.callFunction({ name: "accountingFunctions", data: { ...data, action: type } });
    if (!response.result || !response.result.success) throw new Error(response.result?.message || "操作失败");
    return response.result;
  },

  goSearch() {
    wx.navigateTo({ url: "/pages/search/index" });
  },

  async exportCurrentFilters() {
    if (!this.data.isAdmin) return;
    try {
      const result = await wx.cloud.callFunction({
        name: "accountingFunctions",
        data: {
          action: "exportBills",
          familyId: app.globalData.currentFamilyId,
          month: this.data.filterMonth,
          category: this.data.filterCategory,
          categoryLevel: this.data.filterCategoryLevel,
          memberId: this.data.filterMember,
          account: this.data.filterAccount,
          type: this.data.filterType,
          dateStart: this.data.filterDateStart,
          dateEnd: this.data.filterDateEnd,
          minAmount: this.data.filterMinAmount,
          maxAmount: this.data.filterMaxAmount
        }
      });
      if (!result.result?.success || !result.result.tempFileURL) throw new Error(result.result?.message || "导出失败");
      const downloaded = await wx.downloadFile({ url: result.result.tempFileURL });
      await wx.openDocument({ filePath: downloaded.tempFilePath, showMenu: true });
    } catch (error) { wx.showToast({ title: error.message || "导出失败", icon: "none" }); }
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    this.setData({ offset: this.data.offset + 20, loadingMore: true });
    this._throttledLoadMore();
  },

  async onPullDownRefresh() {
    this.setData({ offset: 0 });
    app.globalData.billsDirty = true;
    const cacheKey = this.buildBillsCacheKey();
    if (cacheKey) { try { wx.removeStorageSync(cacheKey); } catch (error) { /* ignore */ } }
    await this.loadBills(false, true);
    wx.stopPullDownRefresh();
  },

  onSwipeStart(e) {
    const billId = e.currentTarget.dataset.id;
    const canOperate = e.currentTarget.dataset.canOperate === "true" || e.currentTarget.dataset.canOperate === true;
    if (!canOperate) return;
    if (this.data.slidBillId && this.data.slidBillId !== billId) { this.setData({ slidBillId: "" }); }
    const touch = e.touches[0];
    this._swipeStartX = touch.clientX;
    this._swipeStartY = touch.clientY;
    this._swipeBillId = billId;
    this._swipeBaseX = this.data.slidBillId === billId ? -180 : 0;
    this._isDragging = false;
    this._dragDirection = null;
    this.setData({ swipeAnimating: true });
  },

  onSwipeMove(e) {
    const billId = e.currentTarget.dataset.id;
    if (!this._swipeBillId || this._swipeBillId !== billId) return;
    const canOperate = e.currentTarget.dataset.canOperate === "true" || e.currentTarget.dataset.canOperate === true;
    if (!canOperate) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - this._swipeStartX;
    const deltaY = touch.clientY - this._swipeStartY;
    if (!this._dragDirection) {
      if (Math.abs(deltaX) < 6 && Math.abs(deltaY) < 6) return;
      if (Math.abs(deltaY) > Math.abs(deltaX)) { this._dragDirection = "vertical"; this._swipeBillId = null; return; }
      this._dragDirection = "horizontal";
      this._isDragging = true;
    }
    if (this._dragDirection !== "horizontal") return;
    const sysInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const rpxRatio = 750 / sysInfo.windowWidth;
    let offsetRpx = this._swipeBaseX + deltaX * rpxRatio;
    if (offsetRpx > 0) offsetRpx = offsetRpx * 0.2;
    if (offsetRpx < -220) offsetRpx = -220 + (offsetRpx + 220) * 0.2;
    const map = {};
    map[billId] = Math.round(offsetRpx);
    this.setData({ swipeOffsetMap: Object.assign({}, this.data.swipeOffsetMap, map) });
  },

  onSwipeEnd(e) {
    const billId = e.currentTarget.dataset.id;
    if (!this._swipeBillId || this._swipeBillId !== billId) return;
    const canOperate = e.currentTarget.dataset.canOperate === "true" || e.currentTarget.dataset.canOperate === true;
    this._swipeBillId = null;
    if (!canOperate) { this.setData({ slidBillId: "", swipeAnimating: false, swipeOffsetMap: {} }); return; }
    const currentOffset = this.data.swipeOffsetMap[billId] !== undefined
      ? this.data.swipeOffsetMap[billId]
      : (this.data.slidBillId === billId ? -180 : 0);
    const shouldOpen = currentOffset < -90;
    this.setData({ slidBillId: shouldOpen ? billId : "", swipeAnimating: false, swipeOffsetMap: {} });
  },

  onItemTap(e) {
    const billId = e.currentTarget.dataset.id;
    if (this.data.slidBillId === billId) { this.setData({ slidBillId: "" }); return; }
    const canOperate = e.currentTarget.dataset.canOperate === "true" || e.currentTarget.dataset.canOperate === true;
    const bill = this.data.bills.find((item) => item._id === billId);
    if (canOperate) {
      wx.navigateTo({ url: "/pages/addBill/index?billId=" + billId + (bill ? "&type=" + bill.type : "") });
    } else {
      wx.navigateTo({ url: "/pages/billDetail/index?id=" + billId });
    }
  },

  onDeleteTap(e) {
    const billId = e.currentTarget.dataset.id;
    const canOperate = e.currentTarget.dataset.canOperate === "true" || e.currentTarget.dataset.canOperate === true;
    if (!canOperate) { wx.showToast({ title: "无删除权限", icon: "none" }); return; }
    const bill = this.data.bills.find((item) => item._id === billId);
    if (!bill) return;
    const self = this;
    wx.showModal({
      title: "删除账单",
      content: "删除后不可恢复，确定删除这笔账单吗？",
      success: async (modal) => {
        if (!modal.confirm) { self.setData({ slidBillId: "" }); return; }
        try {
          await wx.cloud.callFunction({ name: "accountingFunctions", data: { action: "deleteBill", familyId: app.globalData.currentFamilyId, billId, version: bill.version } });
          self.setData({ slidBillId: "" });
          app.globalData.billsDirty = true;
          app.globalData.homeSummaryDirty = true;
          wx.showToast({ title: "已删除", icon: "success" });
          self.setData({ offset: 0 });
          await self.loadBills(false, true);
        } catch (error) { wx.showToast({ title: error.message || "删除失败", icon: "none" }); self.setData({ slidBillId: "" }); }
      }
    });
  },

  closeDelete() { this.setData({ slidBillId: "" }); }
});
