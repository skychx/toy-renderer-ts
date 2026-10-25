import { Color } from './frame';

/**
 * 纹理贴图
 *
 * 浏览器本身就能解码 png 图片，我们只需要把解码后的像素读出来，再按 uv 坐标取颜色就行
 */
export class Texture {
  width: number;
  height: number;
  data: Uint8ClampedArray; // 每个像素 4 个字节：r、g、b、a

  constructor(width: number, height: number, data: Uint8ClampedArray) {
    this.width = width;
    this.height = height;
    this.data = data;
  }

  // 根据 uv 坐标取颜色，u、v 的取值范围都是 [0, 1]
  get(u: number, v: number): Color {
    // uv 坐标的原点在图片的左下角，而图片的像素是从上往下存的，所以 v 要翻转一下
    const x = Math.min(this.width - 1, Math.max(0, Math.floor(u * this.width)));
    const y = Math.min(this.height - 1, Math.max(0, Math.floor((1 - v) * this.height)));
    const i = (y * this.width + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }
}

// 读取 png 贴图
export async function loadTexture(url: string) {
  const blob = await (await fetch(url)).blob();
  // 贴图里存的不一定是颜色（后面我们还会用贴图存法线），所以不能让浏览器做颜色校正
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none' });

  // 先把图片画到一个离屏 canvas 上，再用 getImageData 把像素读出来
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);

  return new Texture(bitmap.width, bitmap.height, data);
}
