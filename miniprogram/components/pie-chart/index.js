// 支出：暖橙系；收入：绿色系（AGENTS.md 规定绿色仅用于收入语义）
const COLORS_EXPENSE = ['#FF8C42', '#F6B84C', '#E5784B', '#C96B45', '#A98254', '#E9A968', '#D96A23', '#7BA585', '#9F7AEA', '#5B8FF9'];
const COLORS_INCOME = ['#4CAF50', '#66BB6A', '#81C784', '#A5D6A7', '#43A047', '#7CB342', '#388E3C', '#2E7D32', '#9CCC65', '#AED581'];

const ANIM_MS = 200;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

Component({
  properties: {
    slices: { type: Array, value: [] },
    title: { type: String, value: '总支出' },
    categoryCount: { type: Number, value: 0 },
    scheme: { type: String, value: 'expense' }
  },
  observers: {
    'slices, title, categoryCount, scheme'() {
      if (!this._ready) return;
      this._scheduleDraw();
    }
  },
  data: {},
  lifetimes: {
    ready() {
      this._ready = true;
      wx.nextTick(() => {
        if (this._ready) this._scheduleDraw(true);
      });
    },
    detached() {
      // 销毁时清理：避免 _layout 持有已销毁 canvas 的引用
      this._layout = null;
      this._canvas = null;
      this._animStart = 0;
      this._animRAF = null;
      this._pending = false;
    }
  },
  methods: {
    redraw() {
      if (this._ready) this._scheduleDraw(true);
    },
    onTouch(e) {
      const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
      if (!t) return;
      const layout = this._layout;
      if (!layout || !layout.slices || layout.slices.length === 0) return;
      const { cx, cy, r, innerR, slices } = layout;
      const dx = t.x - cx;
      const dy = t.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < innerR || dist > r) return;
      let angle = Math.atan2(dy, dx);
      if (angle < -Math.PI / 2) angle += Math.PI * 2;
      let rel = angle - (-Math.PI / 2);
      if (rel < 0) rel += Math.PI * 2;
      if (rel >= Math.PI * 2) rel = 0;
      for (const s of slices) {
        if (rel >= s.startAngle && rel < s.endAngle) {
          this.triggerEvent('tap', { name: s.name, names: s.names || [s.name] });
          return;
        }
      }
    },
    _scheduleDraw(noAnimation) {
      if (this._pending) return;
      this._pending = true;
      const query = this.createSelectorQuery();
      query.select('#pieCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          this._pending = false;
          if (!res || !res[0] || !res[0].node || !res[0].width || !res[0].height) return;
          this._canvas = res[0].node;
          this._canvasW = res[0].width;
          this._canvasH = res[0].height;
          this._animStart = noAnimation ? 0 : Date.now();
          this._drawFrame();
        });
    },
    _drawFrame() {
      const canvas = this._canvas;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || (wx.getSystemInfoSync && wx.getSystemInfoSync().pixelRatio) || 1;
      const W = this._canvasW, H = this._canvasH;
      if (W <= 0 || H <= 0) return;
      const slices = this.data.slices || [];
      const title = this.data.title || '总支出';
      const categoryCount = this.data.categoryCount || 0;
      const scheme = this.data.scheme === 'income' ? 'income' : 'expense';
      const COLORS = scheme === 'income' ? COLORS_INCOME : COLORS_EXPENSE;

      // 准备目标角度
      const total = slices.reduce((s, x) => s + Math.max(0, Number(x.value || 0)), 0);

      // canvas.width 赋值会自动清空画布
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.scale(dpr, dpr);

      if (slices.length === 0 || total <= 0) {
        this._layout = null;
        this._oldSlices = null;
        return;
      }

      const cx = W / 2;
      const cy = H / 2;
      const r = Math.min(W, H) / 2 - 24;
      const innerR = r * 0.55;

      // 目标角度
      const targetSlices = slices.map((s) => {
        const value = Math.max(0, Number(s.value || 0));
        return {
          name: s.name,
          icon: s.icon || '',
          value,
          targetAngle: (value / total) * Math.PI * 2
        };
      });

      // 动画进度
      let progress = 1;
      if (this._animStart > 0) {
        const elapsed = Date.now() - this._animStart;
        progress = Math.min(elapsed / ANIM_MS, 1);
      }
      const eased = easeOutCubic(progress);

      // 当前角度（动画插值或直接 = targetAngle）
      let start = -Math.PI / 2;
      const layoutSlices = [];
      targetSlices.forEach((s, i) => {
        let currentAngle = s.targetAngle;
        if (this._oldSlices && this._oldSlices[i] && this._animStart > 0) {
          const oldAngle = Math.max(0, Number(this._oldSlices[i].targetAngle || 0));
          currentAngle = oldAngle + (s.targetAngle - oldAngle) * eased;
        }
        if (currentAngle > 0.001) {
          const color = s.color || COLORS[i % COLORS.length];
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, r, start, start + currentAngle);
          ctx.closePath();
          ctx.fillStyle = color;
          ctx.fill();
        }
        layoutSlices.push({ name: s.name, startAngle: start, endAngle: start + currentAngle });
        start += currentAngle;
      });

      // 中心白色圆
      ctx.beginPath();
      ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();

      // 中心文字
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.fillStyle = '#A58D80';
      ctx.font = '500 20rpx sans-serif';
      ctx.fillText(title, cx, cy - 8);
      // 收入用绿色（与 legend 数字保持一致），支出仍用橙色
      ctx.fillStyle = scheme === 'income' ? '#4CAF50' : '#FF6B35';
      ctx.font = '700 30rpx sans-serif';
      ctx.fillText('¥' + total.toFixed(2), cx, cy + 18);



      // 布局保存：点击命中用当前动画帧的累积角度（视觉和命中一致）
      this._layout = { cx, cy, r, innerR, slices: layoutSlices };

      if (progress < 1) {
        // 继续动画帧
        this._animRAF = (canvas.requestAnimationFrame || wx.requestAnimationFrame || ((cb) => setTimeout(cb, 16)))(() => this._drawFrame());
      } else {
        // 动画完成：保存最终状态
        this._animStart = 0;
        this._animRAF = null;
        this._oldSlices = targetSlices;
      }
    }
  }
});
