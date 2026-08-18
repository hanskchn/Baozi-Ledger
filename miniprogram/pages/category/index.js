const app = getApp();


const EXPENSE_ICON_GROUPS = [
  { name: "餐饮", icons: ["🍔","🍜","🍲","🥘","🍱","🍙","🍚","🍛","🥟","🥗","🍕","🥪","🌮","🍣","🍤","🥙"] },
  { name: "饮品甜点", icons: ["☕","🍵","🥤","🍺","🍷","🍰","🍿","🍩","🍪","🍦","🧋","🍮","🍫","🍬"] },
  { name: "购物", icons: ["🛒","🧺","🛍️","👕","👖","👗","👟","🧥","👜","💄","💅","⌚","👓","🧦","🧢","💍"] },
  { name: "交通出行", icons: ["🚕","🚗","🚌","🚇","✈️","🚄","⛴️","⛽","🅿️","🛵","🚲","🚙","🚁","🚦"] },
  { name: "居家水电", icons: ["🏠","🏘️","💡","🔌","🚿","🛋️","🪑","🧴","🧻","🪒","🧹","🧼","🪣","🧯"] },
  { name: "医疗健康", icons: ["💊","🩺","🏥","💉","🩹","🧬","🦷","👓","🏋️","🧘","🏃","💆"] },
  { name: "娱乐数码", icons: ["🎮","🎯","🎲","🎨","🎵","🎸","🎤","🎬","📺","📱","💻","🖥️","📷","🎧","🕹️"] },
  { name: "学习教育", icons: ["📚","✏️","📝","📐","🎓","💡","📖","🖊️","📒","🧮"] },
  { name: "育儿宠物", icons: ["👶","🧸","🍼","🐱","🐶","🐟","🐰","🐹","🐦","🦴"] },
  { name: "美容运动", icons: ["💇","💅","🌸","🌿","🏋️","🏃","🧘","🚴","⚽","🏀","🏸","🎳","🥊","🧗"] },
  { name: "工具维修", icons: ["🔧","🔨","📦","🔑","🧰","🧲","🕯️","🧪","🔔","📌"] },
  { name: "金融费用", icons: ["💰","🧧","💸","🪙","🧾","💳","🏦","📊","📅","📎"] },
  { name: "其他", icons: ["🎁","💎","🎉","🎊","🏅","⭐","🔥","💪","☂️","🌂"] }
];

const INCOME_ICON_GROUPS = [
  { name: "工资现金", icons: ["💰","💵","💴","💶","💷","💸","🪙","🧧"] },
  { name: "银行理财", icons: ["💳","🏦","📈","📊","💹","🏧"] },
  { name: "奖金奖励", icons: ["🏆","🥇","🥈","🥉","🎁","💎","🏅","🎖️","👑"] },
  { name: "经营收入", icons: ["💼","🚀","🏭","🏢","🏬","🤝","📝","✏️","⚒️","🛠️"] },
  { name: "兼职副业", icons: ["🛒","📦","🚚","✈️","🚢","🎤","🎬","📺","📷","🎸","🎵","🎮","🎨","💻"] },
  { name: "投资收益", icons: ["📈","📊","💹","⭐","🌟","✨","🔥","💪"] },
  { name: "礼金红包", icons: ["🧧","🎁","🎉","🎊","💌"] },
  { name: "其他", icons: ["🌈","☀️","🌙","🍀","🌻","🌺","🍎","🍇","🍞","🥛","🏠","📚"] }
];

const findGroupForIcon = (groups, icon) => {
  for (const g of groups) { if (g.icons.includes(icon)) return g; }
  return null;
};

Page({
  data: {
    type: "expense",
    categories: [],
    familyId: "",
    isAdmin: false,
    expandedMap: {},
    showEditor: false,
    editorMode: "add1",
    editorTitle: "",
    editorName: "",
    editorIcon: "",
    editorParentId: "",
    editorCategoryId: "",
    iconGroups: EXPENSE_ICON_GROUPS,
    editorExtraIcon: ""
  },

  async onShow() {
    await app.ensureInitialized();
    this.setData({
      familyId: app.globalData.currentFamilyId,
      isAdmin: app.globalData.currentFamily?.role === "admin"
    });
    this.load();
  },

  onFamilyChanged() {
    const newFamilyId = app.globalData.currentFamilyId;
    if (newFamilyId && newFamilyId === this.data.familyId) return;
    this.setData({
      categories: [],
      familyId: newFamilyId,
      isAdmin: app.globalData.currentFamily?.role === "admin",
      expandedMap: {}
    });
    this.load();
  },

  async load() {
    const result = await this.call("listAllCategories", {
      familyId: this.data.familyId,
      type: this.data.type
    });
    const parents = result.categories.filter((item) => !item.parentId);
    const categories = parents.map((parent) => ({
      ...parent,
      id: parent._id,
      children: result.categories
        .filter((item) => item.parentId === parent._id)
        .map((item) => ({ ...item, id: item._id }))
    }));
    // 默认展开所有有子分类的分组
    const expandedMap = {};
    categories.forEach((item) => { expandedMap[item.id] = true; });
    this.setData({ categories, expandedMap });
  },

  switchType(event) {
    const type = event.currentTarget.dataset.type;
    if (type === this.data.type) return;
    this.setData({ type, expandedMap: {} });
    this.load();
  },

  // ========== 展开/收起 ==========
  toggleExpand(event) {
    const id = event.currentTarget.dataset.id;
    const expandedMap = { ...this.data.expandedMap };
    expandedMap[id] = !expandedMap[id];
    this.setData({ expandedMap });
  },

  stopPropagation() {},

  // ========== 弹层 ==========
  openAddCategory1() {
    const groups = this.data.type === "income" ? INCOME_ICON_GROUPS : EXPENSE_ICON_GROUPS;
    this.setData({
      showEditor: true,
      editorMode: "add1",
      editorTitle: "新增一级分类",
      editorName: "",
      editorIcon: "",
      editorExtraIcon: "",
      editorParentId: "",
      editorCategoryId: "",
      iconGroups: groups
    });
  },

  openAddCategory2(event) {
    const groups = this.data.type === "income" ? INCOME_ICON_GROUPS : EXPENSE_ICON_GROUPS;
    this.setData({
      showEditor: true,
      editorMode: "add2",
      editorTitle: "新增二级分类",
      editorName: "",
      editorIcon: "",
      editorExtraIcon: "",
      editorParentId: event.currentTarget.dataset.pid,
      editorCategoryId: "",
      iconGroups: groups
    });
  },

  openEditCategory1(event) {
    const id = event.currentTarget.dataset.id;
    const current = this.data.categories.find((item) => item.id === id);
    if (!current) return;
    const groups = this.data.type === "income" ? INCOME_ICON_GROUPS : EXPENSE_ICON_GROUPS;
    const extra = current.icon && !findGroupForIcon(groups, current.icon) ? current.icon : "";
    this.setData({
      showEditor: true,
      editorMode: "edit1",
      editorTitle: "编辑一级分类",
      editorName: current.name,
      editorIcon: current.icon || "",
      editorParentId: "",
      editorCategoryId: id,
      editorExtraIcon: extra,
      iconGroups: groups
    });
  },

  openEditCategory2(event) {
    const id = event.currentTarget.dataset.id;
    const current = this.data.categories
      .flatMap((item) => item.children)
      .find((item) => item.id === id);
    if (!current) return;
    const groups = this.data.type === "income" ? INCOME_ICON_GROUPS : EXPENSE_ICON_GROUPS;
    const extra = current.icon && !findGroupForIcon(groups, current.icon) ? current.icon : "";
    this.setData({
      showEditor: true,
      editorMode: "edit2",
      editorTitle: "编辑二级分类",
      editorName: current.name,
      editorIcon: current.icon || "",
      editorParentId: current.parentId,
      editorCategoryId: id,
      editorExtraIcon: extra,
      iconGroups: groups
    });
  },

  closeEditor() {
    this.setData({ showEditor: false });
  },

  onEditorNameInput(e) {
    this.setData({ editorName: e.detail.value });
  },

  selectIcon(e) {
    this.setData({ editorIcon: e.currentTarget.dataset.icon, editorExtraIcon: "" });
  },

  async confirmEditor() {
    const name = (this.data.editorName || "").trim();
    if (!name) {
      wx.showToast({ title: "请输入分类名称", icon: "none" });
      return;
    }
    if (name.length > 20) {
      wx.showToast({ title: "名称不超过20字", icon: "none" });
      return;
    }
    const icon = this.data.editorIcon || (this.data.type === "income" ? "💰" : "📝");
    try {
      if (this.data.editorMode === "add1") {
        await this.call("createCategory", {
          familyId: this.data.familyId,
          type: this.data.type,
          name,
          icon
        });
      } else if (this.data.editorMode === "add2") {
        await this.call("createCategory", {
          familyId: this.data.familyId,
          type: this.data.type,
          parentId: this.data.editorParentId,
          name,
          icon
        });
      } else if (this.data.editorMode === "edit1" || this.data.editorMode === "edit2") {
        await this.call("renameCategory", {
          familyId: this.data.familyId,
          categoryId: this.data.editorCategoryId,
          name,
          icon
        });
      }
      this.setData({ showEditor: false });
      this.load();
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  toggleCategory(event) {
    const enabled = event.currentTarget.dataset.enabled !== false;
    wx.showModal({
      title: enabled ? "删除或停用分类" : "恢复分类",
      content: enabled
        ? "未被账单使用的分类将删除，已使用分类将停用且保留历史。确定继续吗？"
        : "恢复后可在新增账单中重新使用，确定继续吗？",
      success: async (result) => {
        if (!result.confirm) return;
        try {
          await this.call(
            enabled ? "deleteCategory" : "setCategoryEnabled",
            {
              familyId: this.data.familyId,
              categoryId: event.currentTarget.dataset.id,
              enabled: true
            }
          );
          this.load();
        } catch (error) {
          wx.showToast({ title: error.message, icon: "none" });
        }
      }
    });
  },

  async call(action, data) {
    const response = await wx.cloud.callFunction({
      name: "accountingFunctions",
      data: { ...data, action }
    });
    if (!response.result?.success) throw new Error(response.result?.message || "操作失败");
    return response.result;
  }
});
