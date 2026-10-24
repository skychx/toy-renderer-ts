/**
 * 把 tinyrenderer 仓库里的 .tga 贴图转成 .png
 *
 * 浏览器不认识 tga 格式，但可以直接解码 png，所以准备素材的时候提前转一下。
 * 这个脚本和渲染器本身没有关系，只在准备素材时跑一次：
 *
 *   bun scripts/tga2png.ts <输出目录> <tga 文件...>
 */
import { basename, join } from 'node:path';
import { deflateSync } from 'node:zlib';

type Image = {
  width: number;
  height: number;
  channels: number; // 1 是灰度图，3 是 RGB 彩色图
  pixels: Uint8Array; // 从上往下逐行存储
};

// 解析 tga 文件
function readTGA(buf: Uint8Array): Image {
  const idLength = buf[0];
  const colorMapType = buf[1];
  const imageType = buf[2]; // 2、3 是未压缩的彩色图、灰度图，10、11 是 RLE 压缩过的彩色图、灰度图
  const width = buf[12] | (buf[13] << 8);
  const height = buf[14] | (buf[15] << 8);
  const bytesPerPixel = buf[16] / 8;
  const topDown = (buf[17] & 0x20) !== 0; // 像素是不是从上往下存的

  if (
    colorMapType !== 0 ||
    ![2, 3, 10, 11].includes(imageType) ||
    ![1, 3, 4].includes(bytesPerPixel)
  ) {
    throw new Error(`不支持的 tga 格式：type=${imageType} bpp=${buf[16]}`);
  }

  // 1. 读出原始像素
  const raw = new Uint8Array(width * height * bytesPerPixel);
  let p = 18 + idLength;
  if (imageType === 2 || imageType === 3) {
    raw.set(buf.subarray(p, p + raw.length));
  } else {
    // RLE 压缩的数据由一个个数据包组成，每个包的第一个字节：
    // 最高位是 1 表示「重复包」，后面跟 1 个像素，重复 n 次；最高位是 0 表示「原始包」，后面跟 n 个像素
    // 低 7 位存的是 n - 1
    let i = 0;
    while (i < raw.length) {
      const header = buf[p++];
      const count = (header & 0x7f) + 1;
      if (header & 0x80) {
        const pixel = buf.subarray(p, p + bytesPerPixel);
        p += bytesPerPixel;
        for (let k = 0; k < count; k++) {
          raw.set(pixel, i);
          i += bytesPerPixel;
        }
      } else {
        const n = count * bytesPerPixel;
        raw.set(buf.subarray(p, p + n), i);
        p += n;
        i += n;
      }
    }
  }

  // 2. tga 的像素是 BGR(A) 顺序，一般从下往上存；转成 RGB 顺序、从上往下存
  // 渲染器用不到透明度，alpha 通道直接丢掉
  const channels = bytesPerPixel === 1 ? 1 : 3;
  const pixels = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y++) {
    const srcY = topDown ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      const s = (srcY * width + x) * bytesPerPixel;
      const d = (y * width + x) * channels;
      if (channels === 1) {
        pixels[d] = raw[s];
      } else {
        pixels[d] = raw[s + 2];
        pixels[d + 1] = raw[s + 1];
        pixels[d + 2] = raw[s];
      }
    }
  }

  return { width, height, channels, pixels };
}

// png 的 Paeth 预测函数
function paeth(a: number, b: number, c: number) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// png 每一行像素压缩前要先做一次 filter，这里 5 种 filter 都试一遍，挑一个压缩效果最好的
function filterRows({ width, height, channels, pixels }: Image) {
  const rowBytes = width * channels;
  const out = new Uint8Array((rowBytes + 1) * height);
  const candidate = new Uint8Array(rowBytes);

  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * rowBytes, (y + 1) * rowBytes);
    const prev =
      y > 0 ? pixels.subarray((y - 1) * rowBytes, y * rowBytes) : new Uint8Array(rowBytes);
    let bestType = 0;
    let bestScore = Infinity;
    let best = new Uint8Array(row);

    for (let type = 0; type < 5; type++) {
      let score = 0;
      for (let i = 0; i < rowBytes; i++) {
        const a = i >= channels ? row[i - channels] : 0; // 左边
        const b = prev[i]; // 上边
        const c = i >= channels ? prev[i - channels] : 0; // 左上
        const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][type];
        candidate[i] = (row[i] - predictor) & 0xff;
        // 经验做法：差值的绝对值之和越小，压缩效果一般越好
        score += candidate[i] < 128 ? candidate[i] : 256 - candidate[i];
      }
      if (score < bestScore) {
        bestScore = score;
        bestType = type;
        best = new Uint8Array(candidate);
      }
    }

    out[y * (rowBytes + 1)] = bestType;
    out.set(best, y * (rowBytes + 1) + 1);
  }
  return out;
}

function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, Bun.hash.crc32(out.subarray(4, 8 + data.length)));
  return out;
}

// 生成 png 文件
function writePNG(image: Image) {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, image.width);
  view.setUint32(4, image.height);
  header[8] = 8; // 每个通道 8 bit
  header[9] = image.channels === 1 ? 0 : 2; // 0 是灰度图，2 是 RGB 彩色图

  return Buffer.concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // png 文件头
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(filterRows(image), { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

const [outDir, ...files] = process.argv.slice(2);
if (!outDir || files.length === 0) {
  console.log('用法：bun scripts/tga2png.ts <输出目录> <tga 文件...>');
  process.exit(1);
}

for (const file of files) {
  const image = readTGA(new Uint8Array(await Bun.file(file).arrayBuffer()));
  const target = join(outDir, basename(file).replace(/\.tga$/i, '.png'));
  await Bun.write(target, writePNG(image));
  console.log(`${file} → ${target}（${image.width}×${image.height}）`);
}
