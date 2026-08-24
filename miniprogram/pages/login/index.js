const app = getApp();
const brand = require("../../utils/brand");

Page({
  data: {
    hasBrandAssets: brand.available,
    logoSrc: brand.logoLogin,
    logoFailed: false,
    checking: true,
    submitting: false,
    avatarUrl: ""
  },

  onLoad(query) {
    // 邀请链接可能直接落到登录页，先把邀请码存起来，登录成功后再走确认流程
    const inviteCode = query && (query.inviteCode || query.code);
    if (inviteCode) app.enqueuePendingInvite(inviteCode);
    this.nickNameValue = "";
    this.checkLoginState();
  },

  async checkLoginState() {
    try {
      const state = await app.fetchLoginState();
      if (state.loggedIn) {
        this.redirectHome();
        return;
      }
      const user = state.user || {};
      // 历史昵称仅作为兜底值，输入框保持空白以便微信昵称候选正常填充
      this.nickNameValue = user.nickName === "微信用户" ? "" : (user.nickName || "");
      this.setData({ checking: false, avatarUrl: user.avatarUrl || "" });
    } catch (error) {
      this.setData({ checking: false });
      wx.showToast({ title: error.message || "登录状态检查失败", icon: "none" });
    }
  },

  onLogoError() {
    this.setData({ logoFailed: true });
  },

  // type="nickname" 输入框不能把 value 通过 setData 回写，
  // 否则微信昵称候选填入后会被覆盖清空；这里只把值记在实例上。
  onNickNameChange(event) {
    const value = (event.detail?.value || event.detail?.nickname || "").trim();
    if (!value) return;
    this.nickNameValue = value;
  },

  // 一键登录：授权头像后立即登录；昵称为空则先用默认值，登录后可随时修改
  onChooseAvatar(event) {
    const tempFilePath = event.detail?.avatarUrl || "";
    if (!tempFilePath) {
      // 用户在头像选择弹窗中取消：不打断流程，仍可用默认资料登录
      wx.showToast({ title: "未获取到头像，可点下方使用默认资料", icon: "none" });
      return;
    }
    this.setData({ avatarUrl: tempFilePath });
    this.submitLogin({ nickName: this.nickNameValue || "", avatarUrl: "", avatarTempPath: tempFilePath });
  },

  onUseDefault() {
    this.submitLogin({ nickName: this.nickNameValue || "", avatarUrl: "", avatarTempPath: "" });
  },

  async submitLogin(profile) {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    wx.showLoading({ title: "登录中", mask: true });
    let loadingVisible = true;
    const closeLoading = () => {
      // showToast 会自动关闭 loading，这里保证 hideLoading 只调用一次
      if (!loadingVisible) return;
      loadingVisible = false;
      wx.hideLoading();
    };
    try {
      let avatarUrl = profile.avatarTempPath ? "" : profile.avatarUrl;
      if (profile.avatarTempPath) {
        const extension = profile.avatarTempPath.split(".").pop() || "png";
        const upload = await wx.cloud.uploadFile({ cloudPath: "avatars/" + Date.now() + "." + extension, filePath: profile.avatarTempPath });
        avatarUrl = upload.fileID;
      }
      await app.login({ nickName: profile.nickName, avatarUrl });
      closeLoading();
      this.redirectHome();
    } catch (error) {
      closeLoading();
      wx.showToast({ title: error.message || "登录失败，请重试", icon: "none" });
    } finally {
      closeLoading();
      this.setData({ submitting: false });
    }
  },

  redirectHome() {
    // 首页是 tabBar 页面，必须用 switchTab 跳转；
    // 用 reLaunch 会重建整个页面栈并导致 tabBar 图标渲染丢失
    wx.switchTab({
      url: "/pages/index/index",
      fail: () => wx.reLaunch({ url: "/pages/index/index" })
    });
  }
});
