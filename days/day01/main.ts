import type { Demo } from '../../shared/demo';
import { Frame, Color } from './frame';

const red: Color = [255, 0, 0];

// 创建一个 100×100 的画布，在 (52, 41) 这个坐标上画一个红色的点
function drawDot(canvas: HTMLCanvasElement) {
  const frame = new Frame(100, 100);
  frame.set(52, 41, red);
  frame.render(canvas);
}

// 每个入口只绘制指定画布，供完整教程和单图 iframe 共用。
export const demos: Record<string, Demo> = {
  dot: {
    title: '在 (52, 41) 画一个红点（放大 4 倍显示）',
    width: 100,
    height: 100,
    pixelated: true,
    run: drawDot,
  },
};
