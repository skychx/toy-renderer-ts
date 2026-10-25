# toy-renderer-ts

「十天自制软渲染器」的配套代码（TypeScript 版）。

参考经典图形学教程 [tinyrenderer](https://github.com/ssloy/tinyrenderer)，用 TypeScript + canvas 从零实现一个软渲染器：不依赖任何第三方库，所有的点、线、三角形都是自己一个像素一个像素算出来的，canvas 只用来显示最后的结果。

## 运行

先安装 [Bun](https://bun.sh/)，然后：

```bash
bun install   # 只安装类型声明，渲染器不依赖第三方运行库
bun dev
```

打开 http://localhost:8080 就能看到每一天的渲染结果。

GPU 番外使用 [WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)，分为[未优化版](days/extra-webgpu)和[优化版](days/extra-webgpu-optimized)；旧教程链接仍然保留。
使用支持 WebGPU 的浏览器，通过 localhost 或 HTTPS 打开，即可对比 CPU 软渲染与 GPU 渲染的实时帧率。
代码中用 [WGSL](https://www.w3.org/TR/WGSL/) 对照 TypeScript 着色器，并注释了资源绑定、矩阵上传和深度范围的区别。

## 目录结构

```bash
.
├── days        # 每一天的代码，每个文件夹都是一份完整的、能单独运行的代码
├── embed       # 博客 iframe 的单画布页面
├── obj         # 模型和贴图（来自 tinyrenderer，贴图从 tga 转成了 png）
├── scripts     # 准备素材用的脚本
├── shared      # 页面布局、加载状态和章节导航，不参与渲染计算
├── index.html  # 目录页
└── server.ts   # 本地开发服务器
```

想知道某一天改了什么，直接 diff 前后两个文件夹就行：

```bash
diff -r days/day04 days/day05
```

教程页左侧有章节目录，窄屏下折叠到顶部；首页居中显示课程列表，目录条目统一维护在 `shared/chapters.ts`。
画布在 HTML 中声明真实宽高，先显示加载占位，收到各自的首帧通知后再展示结果，避免加载时页面跳动。
各章节通过外部入口 `page.ts` 启动，再加载 `main.ts`；保持外部 `script src`，让 Bun 正确打包模块导入。

day2～day7 只使用头部网格，专注各章的核心概念。
从 day8 开始，借助 `Asset` 加入独立双眼 `african_head_eye_inner.obj`，演示多网格与独立材质；模型坐标已经对齐。
头部和双眼使用各自的贴图，共用帧缓冲和深度缓冲，让眼睑正确遮挡眼球。
day10 的环境光遮蔽采样也包含双眼；两个 WebGPU 番外的 CPU、GPU 均绘制同一组网格和材质。

## 在博客中嵌入 Canvas

所有 14 个章节、51 个演示都支持 `/embed/<章节>/<演示>/` 独立地址，例如：

- `/embed/day08/tangent/`：切线空间法线贴图
- `/embed/day09/depth/`：光源深度图
- `/embed/extra-webgpu/webgpu/`：只运行 WebGPU
- `/embed/extra-webgpu-optimized/software/`：只运行优化后的 CPU 软渲染

教程页每张画布下都有「单独查看」链接；完整地址清单在 `/embeds.json`。
iframe 页面只显示选中的 Canvas 和必要的加载状态、FPS，动画移出视野或页面进入后台时暂停。
静态示例仍只渲染一次，缩放 iframe 不会改变教学算法的内部渲染分辨率。

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

构建并预览部署产物：

```bash
bun run build
bun run preview  # http://localhost:8081
```

将 `dist/` 部署到独立域名的根目录，通过 HTTPS 供博客引用，无需在线运行 Bun。
开发服务器默认用 8080，预览默认用 8081，均可通过 `PORT=8082 bun dev` 这样的方式指定其他端口。
更多地址、架构约定和部署配置见 [iframe 嵌入说明](docs/embedding.md)。

## 软渲染性能对照

先打开 http://localhost:8080/extra-webgpu，观察左侧未优化的 Canvas 2D 软渲染与右侧 WebGPU 的差距。
再打开 http://localhost:8080/extra-webgpu-optimized，观察优化后的软渲染帧率。

两版使用相同的模型、贴图、Phong 光照、初始相机和 800×800 内部分辨率，WebGPU 的实现也相同。
Canvas 2D 只负责显示 CPU 算出的像素，优化版没有把光栅化或光照交给 GPU。
比较时在同一个标签页切换两版，在相同视角、资源加载完成后读取 FPS，避免两个软渲染 Worker 同时运行带来的资源竞争。

优化版完整复制原版，保留每篇代码可独立阅读、运行的结构，集中做三组优化：

| 优化               | Before                                         | After                                                    | 主要文件                    |
| ------------------ | ---------------------------------------------- | -------------------------------------------------------- | --------------------------- |
| 切线基预计算       | 每个像素重复求逆、计算切线和副切线             | 每个三角形计算一次，片元复用                             | `software.ts`               |
| 重心坐标与光栅化   | 每个候选像素重新做叉乘、除法和数组分配         | 预计算边与面积，逐行增量更新分子，先做内外判断和深度测试 | `gl.ts`                     |
| 片元计算与纹理采样 | 向量函数创建中间数组，三张贴图分别计算像素下标 | 热点计算展开成分量，同尺寸贴图共用下标、直接读取通道     | `software.ts`、`texture.ts` |

直接比较两个章节，能看到每组改动对应的公式和 Before/After 注释：

```bash
diff -ru days/extra-webgpu days/extra-webgpu-optimized
```

帧率随设备、视角和浏览器变化；WebGPU 一侧统计浏览器调度的绘制帧数，不能当成 GPU 的极限吞吐量。

## 教程

| 章节                                                                                                        | 代码                                                       |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [day1：环境搭建](https://supercodepower.com/docs/toy-renderer/day1-env-setup)                               | [days/day01](days/day01)                                   |
| [day2：画一条线](https://supercodepower.com/docs/toy-renderer/day2-draw-line)                               | [days/day02](days/day02)                                   |
| [day3：画一个三角形](https://supercodepower.com/docs/toy-renderer/day3-draw-triangle)                       | [days/day03](days/day03)                                   |
| [day4：Z-buffering](https://supercodepower.com/docs/toy-renderer/day4-Z-buffering)                          | [days/day04](days/day04)                                   |
| [day5：透视投影](https://supercodepower.com/docs/toy-renderer/day5-Perspective-projection)                  | [days/day05](days/day05)                                   |
| [day6：移动相机](https://supercodepower.com/docs/toy-renderer/day6-Moving-the-camera)                       | [days/day06](days/day06)                                   |
| [day7：着色器](https://supercodepower.com/docs/toy-renderer/day7-Shaders)                                   | [days/day07](days/day07)                                   |
| [day8：Phong 光照与法线贴图](https://supercodepower.com/docs/toy-renderer/day8-Normal-mapping)              | [days/day08](days/day08)                                   |
| [day9：阴影](https://supercodepower.com/docs/toy-renderer/day9-Shadow-mapping)                              | [days/day09](days/day09)                                   |
| [day10：环境光遮蔽](https://supercodepower.com/docs/toy-renderer/day10-Ambient-occlusion)                   | [days/day10](days/day10)                                   |
| [番外：透视校正插值](https://supercodepower.com/docs/toy-renderer/extra1-Perspective-correct-interpolation) | [days/extra-perspective](days/extra-perspective)           |
| [番外：卡通渲染](https://supercodepower.com/docs/toy-renderer/extra2-Toon-shading)                          | [days/extra-toon](days/extra-toon)                         |
| [番外：用 WebGPU 重写一遍](https://supercodepower.com/docs/toy-renderer/extra3-WebGL)                       | [days/extra-webgpu](days/extra-webgpu)                     |
| 番外：软渲染器性能优化                                                                                      | [days/extra-webgpu-optimized](days/extra-webgpu-optimized) |

## 致谢

- [ssloy/tinyrenderer](https://github.com/ssloy/tinyrenderer)：本项目参考了它的教程和实现思路，代码用 TypeScript 重新写了一遍
- 模型和贴图都来自 tinyrenderer 仓库，版权归原作者所有，详见 `obj` 目录下的 `readme.txt`
