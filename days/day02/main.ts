import type { Demo } from '../../shared/demo';
import { Frame, Color } from './frame';
import { loadModel } from './model';

const white: Color = [255, 255, 255];
const width = 800;
const height = 800;

// DDA 直线算法
// 缺点：涉及大量的浮点运算
function lineDDA(x1: number, y1: number, x2: number, y2: number, frame: Frame, color: Color) {
  let x = x1;
  let y = y1;
  const dx = x2 - x1;
  const dy = y2 - y1;

  // 根据 dx 和 dy 的长度决定基准
  const step = Math.max(Math.abs(dx), Math.abs(dy));
  const dlx = dx / step;
  const dly = dy / step;

  // 起点和终点都要画上，所以一共画 step + 1 个点
  for (let i = 0; i <= step; i++) {
    // x、y 都是小数，取离它最近的像素
    frame.set(Math.round(x), Math.round(y), color);
    x = x + dlx;
    y = y + dly;
  }
}

// Bresenham's 直线算法
// 具体实现参考 https://www.wikiwand.com/en/Bresenham%27s_line_algorithm#/All_cases
function line(x1: number, y1: number, x2: number, y2: number, frame: Frame, color: Color) {
  // 处理斜率的绝对值大于 1 的直线：交换 x 和 y，让它变「平」
  let steep = false;
  if (Math.abs(x1 - x2) < Math.abs(y1 - y2)) {
    [x1, y1] = [y1, x1];
    [x2, y2] = [y2, x2];
    steep = true;
  }
  // 保证从左往右画：起点在终点右边时，交换起点和终点
  if (x1 > x2) {
    [x1, x2] = [x2, x1];
    [y1, y2] = [y2, y1];
  }

  let y = y1;
  let eps = 0;
  const dx = x2 - x1;
  let dy = y2 - y1;
  let yi = 1;

  // 处理 [-1, 0) 范围内的斜率：y 每次往下走
  if (dy < 0) {
    yi = -1;
    dy = -dy;
  }

  for (let x = x1; x <= x2; x++) {
    if (steep) {
      frame.set(y, x, color); // 前面交换过 x 和 y，画的时候要换回来
    } else {
      frame.set(x, y, color);
    }

    eps += dy;
    // 这里用位运算 << 1 代替 * 2
    if (eps << 1 >= dx) {
      y = y + yi;
      eps -= dx;
    }
  }
}

// 从画布中心向四周画几条不同斜率的直线
function drawLines(canvas: HTMLCanvasElement, drawLine: typeof line) {
  const frame = new Frame(width, height);

  drawLine(400, 400, 800, 600, frame, white);
  drawLine(400, 400, 600, 800, frame, white);
  drawLine(400, 400, 200, 800, frame, white);
  drawLine(400, 400, 0, 600, frame, white);
  drawLine(400, 400, 0, 200, frame, white);
  drawLine(400, 400, 200, 0, frame, white);
  drawLine(400, 400, 600, 0, frame, white);
  drawLine(400, 400, 800, 200, frame, white);
  drawLine(0, 400, 800, 400, frame, white);
  drawLine(400, 0, 400, 800, frame, white);

  frame.render(canvas);
}

// 每个入口只绘制指定画布，供完整教程和单图 iframe 共用。
export const demos: Record<string, Demo> = {
  dda: {
    title: 'DDA 直线算法',
    width: 800,
    height: 800,
    run: canvas => drawLines(canvas, lineDDA),
  },
  bresenham: {
    title: "Bresenham's 直线算法",
    width: 800,
    height: 800,
    run: canvas => drawLines(canvas, line),
  },
  obj: { title: '模型线框', width: 800, height: 800, run: drawObj },
};
// 画出模型的线框
async function drawObj(canvas: HTMLCanvasElement) {
  const model = await loadModel('/obj/african_head/african_head.obj');
  const frame = new Frame(width, height);

  // 循环模型里的所有三角形
  for (let i = 0; i < model.nfaces(); i++) {
    const face = model.face(i);

    // 循环三角形的三个顶点，每两个顶点连一条线
    for (let j = 0; j < 3; j++) {
      const v0 = model.vert(face[j]);
      const v1 = model.vert(face[(j + 1) % 3]);

      // 因为模型空间取值范围是 [-1, 1]^3，我们要把模型坐标平移到屏幕坐标中
      // 下面 (point + 1) * width(height) / 2 的操作学名为视口变换（Viewport Transformation）
      const x0 = Math.floor(((v0[0] + 1) * width) / 2);
      const y0 = Math.floor(((v0[1] + 1) * height) / 2);
      const x1 = Math.floor(((v1[0] + 1) * width) / 2);
      const y1 = Math.floor(((v1[1] + 1) * height) / 2);

      // 画线
      line(x0, y0, x1, y1, frame, white);
    }
  }

  frame.render(canvas);
}
