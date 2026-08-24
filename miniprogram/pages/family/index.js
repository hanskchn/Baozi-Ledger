const app = getApp();

// hero 上三个胶囊必须同行不换行：按总字数分档降字号
const CHIP_CLASS_STEPS = [
  { maxLength: 18, className: "chip-lg" },
  { maxLength: 22, className: "chip-md" },
  { maxLength: 26, className: "chip-sm" }
];
const AVATAR_PREVIEW_LIMIT = 5;
const MEMBER_COLLAPSE_LIMIT = 5;
// 与云函数 generateInviteCode 保持一致：8 位，字符集不含 0/1/I/O
const INVITE_CODE_LENGTH = 8;

Page({
  data: {
    families: [],
    currentFamilyId: "",
    currentFamilyName: "",
    memberCount: 0,
    maxMemberCount: 50,
    totalBillCount: 0,
    chipClass: "chip-lg",
    members: [],
    visibleMembers: [],
    avatarPreview: [],
    avatarMoreCount: 0,
    membersCollapsed: false,
    membersExpanded: false,
    isAdmin: false,
    loading: false,
    inviteCode: "",
    // 邀请码归属的账本 id：与 currentFamilyId 不一致时说明是上一个账本的残留，必须丢弃
    inviteFamilyId: "",
    selfMemberId: "",
    settingsVisible: false,
    memberSheetVisible: false,
    activeMember: null,
    canManageActiveMember: false,
    joinVisible: false,
    joinCode: "",
    joinFocus: false,
    inviteSheetVisible: false,
    codeCells: ["", "", "", "", "", "", "", ""]
  },

  async onShow() {
    await this.loadFamilies();
  },

  async callFunction(type, data = {}) {
    const response = await wx.cloud.callFunction({
      name: "ledgerFunctions",
      data: { ...data, action: type }
    });
    if (!response.result || !response.result.success) {
      throw new Error(response.result?.message || "操作失败");
    }
    return response.result;
  },

  async loadFamilies() {
    this.setData({ loading: true });
    try {
      await app.ensureInitialized();
      const result = await this.callFunction("listFamilies");
      const currentFamilyId = wx.getStorageSync("currentFamilyId") || result.families[0]?.id || "";
      app.globalData.currentFamilyId = currentFamilyId;
      wx.setStorageSync("currentFamilyId", currentFamilyId);
      // 账本变了就清掉上一个账本的邀请码，避免展示成新账本的码
      if (this.data.inviteFamilyId && this.data.inviteFamilyId !== currentFamilyId) {
        this.setData({ inviteCode: "", inviteFamilyId: "" });
      }
      this.setData({ families: result.families, currentFamilyId });
      if (currentFamilyId) {
        await this.loadFamilyDetail(currentFamilyId);
      } else {
        this.setData({ members: [], visibleMembers: [], avatarPreview: [], isAdmin: false });
      }
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
    if (this.data.isAdmin && (!this.data.inviteCode || this.data.inviteFamilyId !== this.data.currentFamilyId)) {
      this.ensureInvite();
    }
  },

  async loadFamilyDetail(familyId) {
    const result = await this.callFunction("getFamilyDetail", { familyId });
    if (familyId === app.globalData.currentFamilyId) app.globalData.currentFamily = result.family;
    this.applyFamilyDetail(result);
  },

  // 统一把云函数返回的账本详情落到视图数据，避免多处重复拼装
  applyFamilyDetail(result) {
    const family = result.family || {};
    const selfMemberId = family.memberId || "";
    const members = this.decorateMembers(result.members || [], selfMemberId);
    const memberCount = family.memberCount || members.length;
    const totalBillCount = family.totalBillCount || 0;
    const isAdmin = result.role === "admin";
    this.setData({
      currentFamilyName: family.name || "家庭账本",
      memberCount,
      maxMemberCount: family.maxMemberCount || 50,
      totalBillCount,
      chipClass: this.resolveChipClass(isAdmin, memberCount, totalBillCount),
      members,
      isAdmin,
      selfMemberId,
      avatarPreview: members.slice(0, AVATAR_PREVIEW_LIMIT),
      avatarMoreCount: Math.max(members.length - AVATAR_PREVIEW_LIMIT, 0)
    });
    this.refreshVisibleMembers();
  },

  // 排序：管理员 › 我 › 按加入时间；同时算出「加入时间 · 累计笔数」文案
  decorateMembers(members, selfMemberId) {
    return members
      .map((item) => ({
        ...item,
        isSelf: item.memberId === selfMemberId,
        metaText: this.buildMemberMeta(item)
      }))
      .sort((left, right) => {
        if ((left.role === "admin") !== (right.role === "admin")) return left.role === "admin" ? -1 : 1;
        if (left.isSelf !== right.isSelf) return left.isSelf ? -1 : 1;
        return new Date(left.joinedAt || 0).getTime() - new Date(right.joinedAt || 0).getTime();
      });
  },

  buildMemberMeta(member) {
    const parts = [];
    const joined = this.formatJoinedAt(member.joinedAt);
    if (joined) parts.push(joined + " 加入");
    const count = Number(member.billCount || 0);
    parts.push(count > 0 ? "累计记账 " + count + " 笔" : "尚未记账");
    return parts.join(" · ");
  },

  // 加入时间按上海时区展示到年月日
  formatJoinedAt(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    const pad = (item) => String(item).padStart(2, "0");
    return shifted.getUTCFullYear() + "/" + pad(shifted.getUTCMonth() + 1) + "/" + pad(shifted.getUTCDate());
  },

  resolveChipClass(isAdmin, memberCount, totalBillCount) {
    const length = (isAdmin ? "管理员" : "成员").length
      + String(memberCount).length + "位成员".length
      + String(totalBillCount).length + "累计笔".length;
    const step = CHIP_CLASS_STEPS.find((item) => length <= item.maxLength);
    return step ? step.className : "chip-xs";
  },

  refreshVisibleMembers() {
    const { members, membersExpanded } = this.data;
    const collapsed = !membersExpanded && members.length > MEMBER_COLLAPSE_LIMIT;
    this.setData({
      visibleMembers: collapsed ? members.slice(0, MEMBER_COLLAPSE_LIMIT) : members,
      membersCollapsed: collapsed
    });
  },

  expandMembers() {
    this.setData({ membersExpanded: true }, () => this.refreshVisibleMembers());
  },

  // 账本或角色变化广播：重新拉当前账本详情
  onFamilyChanged(family) {
    if (!family || !family.id) return;
    // 已有请求在途时交给它收尾，避免同一时刻两次 loadFamilies
    if (this.data.loading) return;
    this.setData({ currentFamilyId: family.id, inviteCode: "", inviteFamilyId: "", membersExpanded: false });
    this.loadFamilies();
  },

  goFamilyList() {
    wx.navigateTo({ url: "/pages/familyList/index" });
  },

  // 点「＋ 邀请家人」直接弹出邀请面板：先确保有邀请码，再展示，避免点击后毫无反馈
  async openInviteSheet() {
    if (!this.data.isAdmin) return;
    if (!this.hasFreshInviteCode()) {
      wx.showLoading({ title: "加载邀请码", mask: true });
      const code = await this.ensureInvite();
      wx.hideLoading();
      if (!code) return;
    }
    this.setData({ inviteSheetVisible: true });
  },

  // 邀请码必须既存在、又属于当前账本，才算可用
  hasFreshInviteCode() {
    return Boolean(this.data.inviteCode) && this.data.inviteFamilyId === this.data.currentFamilyId;
  },

  closeInviteSheet() {
    this.setData({ inviteSheetVisible: false });
  },

  openFamilySettings() {
    this.setData({ settingsVisible: true });
  },

  closeFamilySettings() {
    this.setData({ settingsVisible: false });
  },

  openMemberSheet(e) {
    const memberId = e.currentTarget.dataset.memberId;
    const member = this.data.members.find((item) => item.memberId === memberId);
    if (!member) return;
    this.setData({
      activeMember: member,
      memberSheetVisible: true,
      canManageActiveMember: this.data.isAdmin && !member.isSelf && member.role !== "admin"
    });
  },

  closeMemberSheet() {
    this.setData({ memberSheetVisible: false, activeMember: null, canManageActiveMember: false });
  },

  async createFamily() {
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: "创建家庭账本",
        editable: true,
        placeholderText: "例如：坤坤和倩倩",
        success: resolve
      });
    });
    const name = (modal.content || "").trim();
    if (!modal.confirm || !name) return;
    try {
      const result = await this.callFunction("createFamily", { name });
      wx.setStorageSync("currentFamilyId", result.family.id);
      app.globalData.currentFamilyId = result.family.id;
      wx.showToast({ title: "创建成功" });
      await this.loadFamilies();
    } catch (error) {
      wx.showToast({ title: error.message || "创建失败", icon: "none" });
    }
  },

  async renameCurrentFamily() {
    this.setData({ settingsVisible: false });
    const modal = await new Promise((resolve) => wx.showModal({ title: "修改账本名称", editable: true, content: this.data.currentFamilyName || "", success: resolve }));
    const name = (modal.content || "").trim();
    if (!modal.confirm || !name) return;
    try {
      await this.callFunction("renameFamily", { familyId: this.data.currentFamilyId, name });
      app.globalData.currentFamily = { ...app.globalData.currentFamily, name };
      wx.showToast({ title: "已修改" });
      await this.loadFamilies();
    } catch (error) { wx.showToast({ title: error.message || "修改失败", icon: "none" }); }
  },

  // 只读取当前有效邀请码（getFamilyInvite 幂等，不会作废旧码）。
  // 切勿在此调用 createInvite —— 那会让已经发给家人的邀请码失效。
  async ensureInvite() {
    const familyId = this.data.currentFamilyId;
    if (!familyId || !this.data.isAdmin) return null;
    if (this.data.inviteCode && this.data.inviteFamilyId === familyId) return this.data.inviteCode;
    try {
      const result = await this.callFunction("getFamilyInvite", { familyId });
      // 请求期间可能又切了账本，结果过期就丢弃，避免展示错账本的邀请码
      if (familyId !== this.data.currentFamilyId) return null;
      this.setData({ inviteCode: result.code, inviteFamilyId: familyId });
      return result.code;
    } catch (error) {
      wx.showToast({ title: error.message || "获取邀请码失败", icon: "none" });
      return null;
    }
  },

  async regenerateInvite() {
    this.setData({ settingsVisible: false, inviteSheetVisible: false });
    const modal = await new Promise((resolve) => wx.showModal({ title: "重新生成邀请码", content: "生成新码后，旧邀请码将立刻失效。", success: resolve }));
    if (!modal.confirm) return;
    try {
      const familyId = this.data.currentFamilyId;
      const result = await this.callFunction("createInvite", { familyId });
      this.setData({ inviteCode: result.code, inviteFamilyId: familyId });
      wx.showToast({ title: "已生成新邀请码" });
    } catch (error) { wx.showToast({ title: error.message || "生成失败", icon: "none" }); }
  },

  copyInviteCode() {
    if (!this.hasFreshInviteCode()) {
      this.ensureInvite();
      return;
    }
    const code = this.data.inviteCode;
    wx.setClipboardData({
      data: code,
      success: () => {
        this.setData({ inviteSheetVisible: false });
        wx.showToast({ title: "邀请码已复制", icon: "none" });
      }
    });
  },

  async revokeInvite() {
    this.setData({ settingsVisible: false });
    const modal = await new Promise((resolve) => wx.showModal({ title: "撤销邀请码", content: "撤销后，当前邀请码将立刻失效。", success: resolve }));
    if (!modal.confirm) return;
    try {
      await this.callFunction("revokeInvite", { familyId: this.data.currentFamilyId });
      this.setData({ inviteCode: "", inviteFamilyId: "" });
      wx.showToast({ title: "邀请码已撤销" });
    } catch (error) { wx.showToast({ title: error.message || "撤销失败", icon: "none" }); }
  },

  openJoinInput() {
    this.setData({ joinVisible: true, joinCode: "", codeCells: this.buildCodeCells(""), joinFocus: false });
  },

  closeJoinInput() {
    this.setData({ joinVisible: false, joinCode: "", codeCells: this.buildCodeCells(""), joinFocus: false });
  },

  focusJoinInput() {
    this.setData({ joinFocus: true });
  },

  onJoinInputBlur() {
    this.setData({ joinFocus: false });
  },

  buildCodeCells(code) {
    const chars = String(code || "").split("");
    return Array.from({ length: INVITE_CODE_LENGTH }, (item, index) => chars[index] || "");
  },

  normalizeInviteCode(value) {
    return String(value || "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, INVITE_CODE_LENGTH);
  },

  // 注意：bindinput 处理函数不能是 async、不能有返回值
  onJoinCodeInput(e) {
    const code = this.normalizeInviteCode(e.detail.value);
    this.setData({ joinCode: code, codeCells: this.buildCodeCells(code) });
  },

  pasteInviteCode() {
    wx.getClipboardData({
      success: (res) => {
        const code = this.normalizeInviteCode(res.data);
        if (!code) {
          wx.showToast({ title: "剪贴板没有邀请码", icon: "none" });
          return;
        }
        this.setData({ joinCode: code, codeCells: this.buildCodeCells(code) });
        if (code.length === INVITE_CODE_LENGTH) this.submitJoinCode();
      },
      fail: () => wx.showToast({ title: "读取剪贴板失败", icon: "none" })
    });
  },

  async submitJoinCode() {
    const code = this.data.joinCode;
    if (code.length !== INVITE_CODE_LENGTH) {
      wx.showToast({ title: "请输入完整的 8 位邀请码", icon: "none" });
      return;
    }
    wx.showLoading({ title: "校验中", mask: true });
    let invite = null;
    try {
      const result = await this.callFunction("verifyInvite", { code, currentFamilyId: this.data.currentFamilyId });
      invite = result.invite;
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error.message || "邀请码无效", icon: "none" });
      return;
    }
    wx.hideLoading();
    if (invite.isCurrentFamily) {
      wx.showModal({ title: "这是当前账本", content: "「" + invite.familyName + "」就是你正在使用的账本，无需重复加入。", showCancel: false });
      return;
    }
    const modal = await new Promise((resolve) => wx.showModal({
      title: invite.alreadyMember ? "切换到此账本" : "确认加入账本",
      content: invite.familyName + "\n管理员 " + invite.adminName + " · " + invite.memberCount + " 位成员",
      confirmText: invite.alreadyMember ? "切换" : "加入",
      success: resolve
    }));
    if (!modal.confirm) return;
    await this.confirmJoin(code);
  },

  async confirmJoin(code) {
    wx.showLoading({ title: "处理中", mask: true });
    try {
      const result = await this.callFunction("confirmJoinFamily", { code });
      app.removePendingInvite(code);
      // 加入成功后立即切到该账本，并让首页等页面重新初始化
      app.onFamilyChange(result.family);
      app.initializePromise = null;
      this.setData({
        joinVisible: false,
        joinCode: "",
        codeCells: this.buildCodeCells(""),
        joinFocus: false,
        currentFamilyId: result.family.id,
        // 置空后由 loadFamilies 走 getFamilyInvite 只读回填，不会生成新码
        inviteCode: "",
        inviteFamilyId: "",
        membersExpanded: false
      });
      wx.hideLoading();
      wx.showToast({ title: result.alreadyMember ? "已切换账本" : "加入成功" });
      await this.loadFamilies();
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error.message || "加入失败", icon: "none" });
    }
  },

  async removeMember() {
    const member = this.data.activeMember;
    if (!member) return;
    this.setData({ memberSheetVisible: false });
    const modal = await new Promise((resolve) => {
      wx.showModal({ title: "移出账本", content: "移出「" + member.nickName + "」后仍保留其历史账单，确定继续吗？", success: resolve });
    });
    if (!modal.confirm) return;
    try {
      await this.callFunction("removeMember", { familyId: this.data.currentFamilyId, memberId: member.memberId });
      await this.loadFamilyDetail(this.data.currentFamilyId);
    } catch (error) {
      wx.showToast({ title: error.message || "移除失败", icon: "none" });
    }
  },

  async transferAdmin() {
    const member = this.data.activeMember;
    if (!member) return;
    this.setData({ memberSheetVisible: false });
    const modal = await new Promise((resolve) => {
      wx.showModal({ title: "设为管理员", content: "将管理员移交给「" + member.nickName + "」后，你将成为普通成员，确定继续吗？", success: resolve });
    });
    if (!modal.confirm) return;
    try {
      const familyId = this.data.currentFamilyId;
      await this.callFunction("transferAdmin", { familyId, memberId: member.memberId });
      // 自己已降为普通成员：必须广播，否则 globalData / currentFamilyCache 仍是 admin，
      // 返回「我的」页会继续显示管理员。这里跳过 becameAdmin/lostAdmin 弹窗（本人主动操作，已有确认）。
      const detail = await this.callFunction("getFamilyDetail", { familyId });
      app.initializePromise = null;
      this.applyFamilyDetail(detail);
      // onFamilyChange 会广播到本页 onFamilyChanged 完成剩余刷新，此处不再重复 loadFamilies
      app.onFamilyChange(detail.family);
      wx.showToast({ title: "已移交管理员", icon: "none" });
    } catch (error) {
      wx.showToast({ title: error.message || "移交失败", icon: "none" });
    }
  },

  async leaveFamily() {
    this.setData({ settingsVisible: false });
    if (this.data.isAdmin) {
      wx.showToast({ title: "管理员请先转让管理权", icon: "none" });
      return;
    }
    const modal = await new Promise((resolve) => wx.showModal({ title: "退出账本", content: "退出后将无法继续查看该账本，确定继续吗？", success: resolve }));
    if (!modal.confirm) return;
    try {
      await this.callFunction("leaveFamily", { familyId: this.data.currentFamilyId });
      wx.removeStorageSync("currentFamilyId");
      app.globalData.currentFamilyId = "";
      app.initializePromise = null;
      wx.showToast({ title: "已退出" });
      await this.loadFamilies();
    } catch (error) { wx.showToast({ title: error.message || "退出失败", icon: "none" }); }
  },

  onShareAppMessage() {
    const familyName = this.data.currentFamilyName || "家庭账本";
    const code = this.data.inviteCode;
    const path = code
      ? "/pages/index/index?inviteCode=" + encodeURIComponent(code)
      : "/pages/index/index";
    return {
      title: "邀请你加入“" + familyName + "”",
      path: path
    };
  }

});
