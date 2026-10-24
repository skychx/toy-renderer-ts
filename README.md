# toy-renderer-ts

「十天自制软渲染器」的配套代码（TypeScript 版）。

参考经典图形学教程 [tinyrenderer](https://github.com/ssloy/tinyrenderer)，用 TypeScript + canvas 从零实现一个软渲染器：不依赖任何第三方库，所有的点、线、三角形都是自己一个像素一个像素算出来的，canvas 只用来显示最后的结果。

## 运行

先安装 [Bun](https://bun.sh/)，然后：

```bash
bun install   # 只装了 Bun 的类型声明，渲染器本身不依赖任何第三方库
bun dev
```

打开 http://localhost:8080 就能看到每一天的渲染结果。

## 目录结构

```bash
.
├── days        # 每一天的代码，每个文件夹都是一份完整的、能单独运行的代码
├── obj         # 模型和贴图（来自 tinyrenderer，贴图从 tga 转成了 png）
├── scripts     # 准备素材用的脚本
├── index.html  # 目录页
└── server.ts   # 本地开发服务器
```

想知道某一天改了什么，直接 diff 前后两个文件夹就行：

```bash
diff -r days/day04 days/day05
```

## 教程

| 章节                                                                                                        | 代码                                             |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| [day1：环境搭建](https://supercodepower.com/docs/toy-renderer/day1-env-setup)                               | [days/day01](days/day01)                         |
| [day2：画一条线](https://supercodepower.com/docs/toy-renderer/day2-draw-line)                               | [days/day02](days/day02)                         |
| [day3：画一个三角形](https://supercodepower.com/docs/toy-renderer/day3-draw-triangle)                       | [days/day03](days/day03)                         |
| [day4：Z-buffering](https://supercodepower.com/docs/toy-renderer/day4-Z-buffering)                          | [days/day04](days/day04)                         |
| [day5：透视投影](https://supercodepower.com/docs/toy-renderer/day5-Perspective-projection)                  | [days/day05](days/day05)                         |
| [day6：移动相机](https://supercodepower.com/docs/toy-renderer/day6-Moving-the-camera)                       | [days/day06](days/day06)                         |
| [day7：着色器](https://supercodepower.com/docs/toy-renderer/day7-Shaders)                                   | [days/day07](days/day07)                         |
| [day8：Phong 光照与法线贴图](https://supercodepower.com/docs/toy-renderer/day8-Normal-mapping)              | [days/day08](days/day08)                         |
| [day9：阴影](https://supercodepower.com/docs/toy-renderer/day9-Shadow-mapping)                              | [days/day09](days/day09)                         |
| [day10：环境光遮蔽](https://supercodepower.com/docs/toy-renderer/day10-Ambient-occlusion)                   | [days/day10](days/day10)                         |
| [番外：透视校正插值](https://supercodepower.com/docs/toy-renderer/extra1-Perspective-correct-interpolation) | [days/extra-perspective](days/extra-perspective) |
| [番外：卡通渲染](https://supercodepower.com/docs/toy-renderer/extra2-Toon-shading)                          | [days/extra-toon](days/extra-toon)               |
| [番外：用 WebGL 重写一遍](https://supercodepower.com/docs/toy-renderer/extra3-WebGL)                        | [days/extra-webgl](days/extra-webgl)             |

## 致谢

- [ssloy/tinyrenderer](https://github.com/ssloy/tinyrenderer)：本项目参考了它的教程和实现思路，代码用 TypeScript 重新写了一遍
- 模型和贴图都来自 tinyrenderer 仓库，版权归原作者所有，详见 `obj` 目录下的 `readme.txt`
