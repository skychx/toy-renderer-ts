import { Frame, Color } from './frame';

const red: Color = [255, 0, 0];

// 创建一个 100×100 的画布，在 (52, 41) 这个坐标上画一个红色的点
const frame = new Frame(100, 100);
frame.set(52, 41, red);

frame.render(document.querySelector<HTMLCanvasElement>('#dot')!);
