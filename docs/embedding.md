# 将教程 Canvas 嵌入博客

## 使用方式

完整教程继续使用 `/day08` 这样的地址。单图使用 `/embed/day08/tangent/`，页面只有 Canvas、加载/错误提示；动画额外显示 FPS，支持拖动旋转。
教程画布下的「单独查看」可直接找到对应地址。`/embeds.json` 提供全部演示的标题、路径、内部尺寸和动画标记。

把下面的域名换成自己的渲染器站点，即可替换博客中的静态图片：

```html
<iframe
  src="https://renderer.example.com/embed/day08/tangent/"
  title="切线空间法线贴图"
  width="800"
  height="800"
  loading="lazy"
  style="display:block;width:100%;height:auto;aspect-ratio:1;border:0"
></iframe>
```

`width`、`height` 和 `aspect-ratio` 为博客预留空间；CSS 负责显示缩放，内部依旧按 800×800 计算。day1 和 day3 的小画布保留原有分辨率与像素风格。
iframe 本身不显示教程标题和导航，可以在博客正文中编写说明。

两个并排的演示可以放进博客自己的网格布局。CPU 与 GPU 独立 iframe 的相机各自独立；完整 WebGPU 章节中的两张画布继续共用相机，方便同步对比。

```html
<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px">
  <iframe
    src="https://renderer.example.com/embed/extra-webgpu-optimized/software/"
    title="优化后的 CPU 软渲染"
    width="800"
    height="800"
    loading="lazy"
    style="width:100%;height:auto;aspect-ratio:1;border:0"
  ></iframe>
  <iframe
    src="https://renderer.example.com/embed/extra-webgpu-optimized/webgpu/"
    title="WebGPU"
    width="800"
    height="800"
    loading="lazy"
    style="width:100%;height:auto;aspect-ratio:1;border:0"
  ></iframe>
</div>
```

## 独立地址清单

地址格式为 `/embed/<章节>/<演示 ID>/`，包括结尾的 `/`，适用于静态托管。

| 章节                   | 演示 ID                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| day01                  | `dot`                                                                                                                   |
| day02                  | `dda`、`bresenham`、`obj`                                                                                               |
| day03                  | `cross-product`、`barycentric`、`random-colors`、`light`                                                                |
| day04                  | `zbuffer-model`、`zbuffer-image`、`texture`                                                                             |
| day05                  | `ortho`、`persp`、`persp-matrix`                                                                                        |
| day06                  | `flat`、`gouraud`、`texture`                                                                                            |
| day07                  | `gouraud`、`toon`、`texture`                                                                                            |
| day08                  | `normal-map`、`ambient`、`diffuse`、`specular`、`phong-gray`、`phong`、`tangent`、`grid`、`diablo-nm`、`diablo-tangent` |
| day09                  | `depth`、`no-shadow`、`no-bias`、`shadow`                                                                               |
| day10                  | `ao-head`、`ao-head-texture`、`ssao`、`final`                                                                           |
| extra-perspective      | `floor-affine`、`floor-correct`、`scene-affine`、`scene-correct`                                                        |
| extra-toon             | `smooth`、`bands`、`edges`、`toon`、`head`                                                                              |
| extra-webgpu           | `software`、`webgpu`                                                                                                    |
| extra-webgpu-optimized | `software`、`webgpu`                                                                                                    |

day10 的暴力 AO 仍需计算 256 个方向的遮挡，首次加载耗时较长，页面显示计算进度。单独嵌入 `ssao`、`final` 时不会执行这项无关计算。

## 本地与部署

```bash
bun install
bun dev          # 开发：http://localhost:8080
bun run build    # 生成 dist/
bun run preview  # 预览：http://localhost:8081
bun run deploy   # 构建并发布到 Cloudflare
```

改动开发路由或 Worker 地址后，需要重启 `bun dev`。占用默认端口时，用 `PORT=8082 bun dev` 或 `PORT=8083 bun run preview` 指定空闲端口。

将 `dist/` 的内容放在独立域名根目录，例如 `https://renderer.example.com/`。构建包含模型、贴图、两个 Worker，以及每个 iframe 地址的真实 `index.html`，无需 SPA 的全站 HTML 回退。
当前资源路径从根目录 `/obj/`、`/embed/` 开始，不支持直接放进 `/some/subpath/` 子路径。
本仓库用 Cloudflare Workers 静态资源发布到 `https://toy-renderer.supercodepower.com/`，配置见 `wrangler.jsonc`，自定义域名的 DNS 记录和证书由 Cloudflare 自动创建。首次部署前需全局安装 wrangler 并执行 `wrangler login`。

博客与渲染器都应通过 HTTPS 访问，WebGPU 还要求浏览器和设备支持；不支持时只在对应画布显示错误，CPU 演示仍能运行。
跨域 iframe 不需要为模型设置 CORS，因为资源由 iframe 内的渲染器站点自己读取。
托管平台需允许博客嵌入页面：避免发送阻止跨域 iframe 的 `X-Frame-Options`；如果设置了 CSP 的 `frame-ancestors`，需包含博客来源。博客自己的 CSP `frame-src` 也需允许渲染器域名。

Nginx 的静态路径规则示例（`root` 指向 `dist`）：

```nginx
location / {
    try_files $uri $uri/ =404;
}
```

## 代码约定

每章 `main.ts` 导出 `demos`，保存标题、尺寸和 `run(canvas, context)`。导入模块只定义算法与入口，不访问页面 DOM，也不加载资源。
`run` 只向传入的画布绘图。模型、贴图和中间结果在使用时准备，并在同一章节页面内缓存。教学算法仍保留在各章自己的文件中。

```text
days/<chapter>/main.ts 的 demos
  ├─ page.ts → shared/lesson.ts → 完整教程中的多张画布
  └─ shared/catalog.ts → embed/main.ts → iframe 中的一张画布
```

`shared/demo.ts` 管理加载状态与生命周期。静态示例绘图一次即可；动画返回 `setActive`、`dispose`，用来暂停 RAF/Worker、清理事件和释放 GPU。
动画根据画布的可见性和页面前后台状态暂停，恢复时重新计算 FPS；真正离开页面则终止 Worker、销毁 GPU device。进入浏览器往返缓存时只暂停，返回后恢复。

新增示例时：在本章 `demos` 注册入口，在教程 HTML 添加对应 ID 与尺寸的画布。新增章节时再加入 `shared/catalog.ts` 和 `shared/chapters.ts`，构建会据此生成独立地址。

```bash
bun test
bun run typecheck
bun run build
```

检查覆盖章节元信息与 HTML 一致性、无副作用导入、模型遮挡与材质、Worker 暂停/恢复、渲染器隔离，以及静态构建中深层入口、JS/CSS、懒加载模块和资源的 HTTP 访问。
