// 颜色，依次是 r、g、b 三个分量，取值范围都是 0~255
export type Color = [number, number, number];

/**
 * 帧缓冲（Framebuffer），可以理解为一块 width × height 的「画布」
 *
 * 我们只把 canvas 当成一块显示像素的屏幕，不会用它自带的 lineTo、fillRect 这些绘图 API：
 * 所有的点、线、三角形都由我们自己一个像素一个像素地算出来，最后再一次性显示到 canvas 上
 */
export class Frame {
  width: number;
  height: number;
  // canvas 的像素数据，每个像素占 4 个字节，依次是 r、g、b、a
  imageData: ImageData;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.imageData = new ImageData(width, height);
    this.clear([0, 0, 0]);
  }

  // 用一种颜色填满整个画布
  clear(color: Color) {
    // Before：逐像素调用 set()，反复做取整、越界检查和 y 轴翻转
    // After：清屏时所有像素颜色相同，直接按 RGBA 顺序写满数组即可
    const data = this.imageData.data;
    const [r, g, b] = color;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255; // 清屏也保持不透明，不能把 alpha 一起清成 0
    }
  }

  // 给 (x, y) 处的像素上色
  set(x: number, y: number, color: Color) {
    // 像素的坐标只能是整数，小数直接舍掉
    x = Math.floor(x);
    y = Math.floor(y);
    // 超出画布的点直接忽略
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return;
    }

    // canvas 的原点在左上角，y 轴朝下；我们习惯的坐标系原点在左下角，y 轴朝上
    // 所以这里要把 y 翻转一下
    const i = ((this.height - 1 - y) * this.width + x) * 4;

    const data = this.imageData.data;
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
    data[i + 3] = 255; // 不透明
  }

  // 把画布上的像素显示到 canvas 元素上
  render(canvas: HTMLCanvasElement) {
    canvas.width = this.width;
    canvas.height = this.height;
    canvas.getContext('2d')!.putImageData(this.imageData, 0, 0);
  }
}
