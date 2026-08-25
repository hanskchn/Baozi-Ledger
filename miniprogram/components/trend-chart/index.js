const COLOR_EXPENSE = '#FF6B35';
const COLOR_INCOME = '#4CAF50';
const GRID_COLOR = '#F2E9E0';
const AXIS_LABEL_COLOR = '#A58D80';
const LEGEND_COLOR = '#8D6E63';
const AXIS_LINE_COLOR = '#E8DDD1';
const ANIM_MS = 250;

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

Component({
  properties: {
    data: { type: Array, value: [] },
    smooth: { type: Boolean, value: true }
  },
  observers: {
    'data, smooth'() {
      if (!this._ready) return;
      // 数据或绘制模式变化时，取消未完成的动画帧，避免旧帧用旧参数重绘
      if (this._raf) {
        cancelAnimationFrame(this._raf);
        this._raf = null;
      }
      this._oldData = null;
      this._scheduleDraw();
    }
  },
  data: {},
  lifetimes: {
    ready() {
      this._ready = true;
      this._touchIndex = -1;
      wx.nextTick(() => {
        if (this._ready) this._scheduleDraw(true);
      });
    },
    detached() {
      this._canvas = null;
      this._layout = null;
      this._oldData = null;
      if (this._raf) {
        cancelAnimationFrame(this._raf);
        this._raf = null;
      }
    }
  },
  methods: {
    redraw() {
      if (this._ready) this._scheduleDraw(true);
    },
    onTouch(e) {
      if (!this._layout || !this.data.data || this.data.data.length === 0) return;
      const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
      if (!t) return;
      const { points, padL, padR, chartW } = this._layout;
      const x = t.x;
      if (x < padL || x > padL + chartW) {
        this._touchIndex = -1;
        this._scheduleDraw();
        return;
      }
      // 找最近的 x 点
      let nearest = 0;
      let minDist = Infinity;
      points.forEach((p, i) => {
        const d = Math.abs(p.x - x);
        if (d < minDist) { minDist = d; nearest = i; }
      });
      this._touchIndex = nearest;
      this._scheduleDraw();
    },
    onTouchEnd() {
      this._touchIndex = -1;
      this._scheduleDraw();
    },
    _scheduleDraw(noAnim) {
      if (this._pending) return;
      this._pending = true;
      const query = this.createSelectorQuery();
      query.select('#trendCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          this._pending = false;
          if (!res || !res[0] || !res[0].node || !res[0].width || !res[0].height) return;
          this._canvas = res[0].node;
          this._canvasW = res[0].width;
          this._canvasH = res[0].height;
          this._animStart = noAnim ? 0 : Date.now();
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
      const items = this.data.data || [];

      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, W, H);

      if (items.length === 0) {
        this._layout = null;
        return;
      }

      // 动画插值
      let progress = 1;
      if (this._animStart > 0) {
        progress = Math.min((Date.now() - this._animStart) / ANIM_MS, 1);
      }
      const eased = easeOutCubic(progress);

      const expenseData = items.map((d) => Math.max(0, Number(d.expense || 0)));
      const incomeData = items.map((d) => Math.max(0, Number(d.income || 0)));

      // 旧数据插值
      let curExpense = expenseData;
      let curIncome = incomeData;
      if (this._oldData && this._oldData.length === items.length && this._animStart > 0) {
        curExpense = expenseData.map((v, i) => {
          const old = this._oldData[i].expense || 0;
          return old + (v - old) * eased;
        });
        curIncome = incomeData.map((v, i) => {
          const old = this._oldData[i].income || 0;
          return old + (v - old) * eased;
        });
      }

      const maxVal = Math.max(1, ...curExpense, ...curIncome);
      // Y 轴 nice max：取整到合适刻度
      const yMax = this._niceMax(maxVal);

      // 布局参数
      const padL = 48;
      const padR = 12;
      const padT = 32;
      const padB = 24;
      const chartW = W - padL - padR;
      const chartH = H - padT - padB;

      // Y 轴刻度（4 段）
      const ySteps = 4;
      const yValues = [];
      for (let i = 0; i <= ySteps; i++) {
        yValues.push((yMax / ySteps) * i);
      }

      // 计算坐标点
      const n = items.length;
      const stepX = n > 1 ? chartW / (n - 1) : 0;
      const points = curExpense.map((v, i) => ({
        x: padL + i * stepX,
        y: padT + chartH - (v / yMax) * chartH,
        expense: curExpense[i],
        income: curIncome[i],
        label: items[i].label
      }));
      const incomePoints = curIncome.map((v, i) => ({
        x: padL + i * stepX,
        y: padT + chartH - (v / yMax) * chartH
      }));

      this._layout = { points, padL, padR, chartW, chartH, padT, padB };

      // === 绘制 ===

      // 1. 网格线 + Y 轴标签
      ctx.font = '20rpx sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      yValues.forEach((val) => {
        const y = padT + chartH - (val / yMax) * chartH;
        ctx.strokeStyle = GRID_COLOR;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + chartW, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = AXIS_LABEL_COLOR;
        ctx.fillText('¥' + this._formatYLabel(val), padL - 6, y);
      });

      // 2. X 轴标签（稀疏显示，避免重叠）
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = AXIS_LABEL_COLOR;
      const labelStep = this._xLabelStep(n, chartW);
      points.forEach((p, i) => {
        if (i % labelStep === 0 || i === n - 1) {
          ctx.fillText(p.label, p.x, padT + chartH + 6);
        }
      });

      // 3. X 轴线
      ctx.strokeStyle = AXIS_LINE_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, padT + chartH);
      ctx.lineTo(padL + chartW, padT + chartH);
      ctx.stroke();

      // 4-5. 面积 + 折线（裁剪到图表区域，防止曲线越界）
      ctx.save();
      ctx.beginPath();
      ctx.rect(padL, padT, chartW, chartH);
      ctx.clip();
      const smooth = this.data.smooth !== false;
      this._drawAreaAndLine(ctx, points, padT + chartH, COLOR_EXPENSE, 'rgba(255,107,53,0.12)', smooth);
      this._drawAreaAndLine(ctx, incomePoints, padT + chartH, COLOR_INCOME, 'rgba(76,175,80,0.10)', smooth);
      ctx.restore();

      // 6. 数据点（≤7 个时显示）
      if (n <= 7) {
        points.forEach((p, i) => {
          if (curExpense[i] > 0) this._drawDot(ctx, p.x, p.y, COLOR_EXPENSE);
          if (curIncome[i] > 0) this._drawDot(ctx, incomePoints[i].x, incomePoints[i].y, COLOR_INCOME);
        });
      }

      // 7. 图例（右上角）
      this._drawLegend(ctx, W, padR);

      // 8. 触摸提示
      if (this._touchIndex >= 0 && this._touchIndex < n) {
        this._drawTooltip(ctx, points[this._touchIndex], incomePoints[this._touchIndex], items[this._touchIndex]);
      }

      // 动画继续
      if (progress < 1) {
        this._raf = (canvas.requestAnimationFrame || wx.requestAnimationFrame || ((cb) => setTimeout(cb, 16)))(() => this._drawFrame());
      } else {
        this._animStart = 0;
        this._oldData = items.map((d) => ({ expense: Number(d.expense || 0), income: Number(d.income || 0) }));
        this._raf = null;
      }
    },
    _drawAreaAndLine(ctx, pts, baselineY, lineColor, areaColor, smooth) {
      if (pts.length === 0) return;
      const buildSegment = (ctx, pts) => {
        if (pts.length === 1) {
          ctx.lineTo(pts[0].x, pts[0].y);
          return;
        }
        if (!smooth) {
          for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x, pts[i].y);
          }
          return;
        }
        for (let i = 0; i < pts.length - 1; i++) {
          const p0 = pts[i - 1] || pts[i];
          const p1 = pts[i];
          const p2 = pts[i + 1];
          const p3 = pts[i + 2] || p2;
          const cp1x = p1.x + (p2.x - p0.x) / 6;
          const cp1y = p1.y + (p2.y - p0.y) / 6;
          const cp2x = p2.x - (p3.x - p1.x) / 6;
          const cp2y = p2.y - (p3.y - p1.y) / 6;
          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
        }
      };
      // 面积
      ctx.beginPath();
      ctx.moveTo(pts[0].x, baselineY);
      ctx.lineTo(pts[0].x, pts[0].y);
      buildSegment(ctx, pts);
      ctx.lineTo(pts[pts.length - 1].x, baselineY);
      ctx.closePath();
      ctx.fillStyle = areaColor;
      ctx.fill();

      // 折线
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      buildSegment(ctx, pts);
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    },
    _drawDot(ctx, x, y, color) {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    },
    _drawLegend(ctx, W, padR) {
      ctx.font = '22rpx sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      // 收入
      const incomeText = '收入';
      const incomeW = ctx.measureText(incomeText).width;
      ctx.fillStyle = LEGEND_COLOR;
      ctx.fillText(incomeText, W - padR, 14);
      ctx.fillStyle = COLOR_INCOME;
      ctx.beginPath();
      ctx.arc(W - padR - incomeW - 10, 14, 4, 0, Math.PI * 2);
      ctx.fill();
      // 支出
      const expenseText = '支出';
      const expenseW = ctx.measureText(expenseText).width;
      ctx.fillStyle = LEGEND_COLOR;
      ctx.fillText(expenseText, W - padR - incomeW - 30, 14);
      ctx.fillStyle = COLOR_EXPENSE;
      ctx.beginPath();
      ctx.arc(W - padR - incomeW - 30 - expenseW - 10, 14, 4, 0, Math.PI * 2);
      ctx.fill();
    },
    _drawTooltip(ctx, expPt, incPt, item) {
      const W = this._canvasW;
      const H = this._canvasH;
      const x = expPt.x;
      const padT = this._layout.padT;
      const baselineY = this._layout.padT + this._layout.chartH;

      // 垂直线
      ctx.strokeStyle = '#E8DDD1';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, baselineY);
      ctx.stroke();
      ctx.setLineDash([]);

      // 高亮点（0 值不高亮）
      if (Number(item.expense) > 0) this._drawHaloDot(ctx, x, expPt.y, COLOR_EXPENSE);
      if (Number(item.income) > 0) this._drawHaloDot(ctx, x, incPt.y, COLOR_INCOME);

      // 气泡内容
      const title = item.fullLabel || item.label || "";
      const lines = [];
      if (title) lines.push({ color: '#FFFFFF', text: title, title: true });
      if (Number(item.expense) > 0) lines.push({ color: COLOR_EXPENSE, text: '支出 ¥' + Number(item.expense).toFixed(2) });
      if (Number(item.income) > 0) lines.push({ color: COLOR_INCOME, text: '收入 ¥' + Number(item.income).toFixed(2) });
      if (lines.length === 0) return;

      ctx.font = '20rpx sans-serif';
      const bubblePadX = 14;
      const bubblePadY = 10;
      const lineH = 28;
      const maxTextW = Math.max(...lines.map((l) => ctx.measureText(l.text).width));
      const bubbleW = maxTextW + bubblePadX * 2 + 8;
      const bubbleH = lines.length * lineH + bubblePadY * 2;
      const gap = 14;

      // 气泡水平居中于触点
      let bx = x - bubbleW / 2;
      // 左右边界保护
      if (bx < 4) bx = 4;
      if (bx + bubbleW > W - 4) bx = W - 4 - bubbleW;

      // 气泡在触点上方；如果上方空间不够则放下方
      const touchY = Math.min(
        Number(item.expense) > 0 ? expPt.y : Infinity,
        Number(item.income) > 0 ? incPt.y : Infinity
      );
      let by = touchY - bubbleH - gap;
      if (by < padT) by = touchY + gap;
      // 下方也放不下时 clamp 到可视区内
      if (by + bubbleH > H - 2) by = Math.max(padT, H - bubbleH - 2);

      // 气泡背景
      ctx.fillStyle = 'rgba(93,64,55,0.9)';
      this._roundRect(ctx, bx, by, bubbleW, bubbleH, 8);
      ctx.fill();

      // 气泡文字
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      lines.forEach((l, i) => {
        const ty = by + bubblePadY + i * lineH + lineH / 2;
        if (l.title) {
          ctx.fillStyle = 'rgba(255,255,255,0.65)';
          ctx.font = '18rpx sans-serif';
          ctx.fillText(l.text, bx + bubblePadX, ty);
          ctx.font = '20rpx sans-serif';
        } else {
          ctx.fillStyle = l.color;
          ctx.beginPath();
          ctx.arc(bx + bubblePadX, ty, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#FFFFFF';
          ctx.fillText(l.text, bx + bubblePadX + 12, ty);
        }
      });
    },
    _drawHaloDot(ctx, x, y, color) {
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fillStyle = color + '25';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.stroke();
    },
    _roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r);
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
    },
    _niceMax(val) {
      if (val <= 10) return Math.ceil(val);
      if (val <= 100) return Math.ceil(val / 10) * 10;
      if (val <= 1000) return Math.ceil(val / 100) * 100;
      if (val <= 10000) return Math.ceil(val / 500) * 500;
      if (val <= 100000) return Math.ceil(val / 5000) * 5000;
      return Math.ceil(val / 10000) * 10000;
    },
    _formatYLabel(val) {
      if (val >= 10000) return (val / 10000).toFixed(1) + 'w';
      return String(Math.round(val));
    },
    _xLabelStep(n, chartW) {
      // 每个标签至少需要 60rpx 宽度
      const minLabelW = 60;
      const maxLabels = Math.max(2, Math.floor(chartW / minLabelW));
      return Math.max(1, Math.ceil(n / maxLabels));
    }
  }
});
