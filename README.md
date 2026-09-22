# dsh-theme-doubao · 豆包主题

把 DeepSeek Harness Web 客户端伪装成豆包：侧栏品牌换成豆包，新会话首屏换成豆包人物，
人物背后是移植自 [deepseek.com/harness](https://www.deepseek.com/harness/en/) 的
「点阵 DeepSeek 鲸鱼」粒子场。

这是一个 DSH **客户端插件**（browser-only），不向模型注册任何东西，不发送任何请求。

> 非官方个人主题，与豆包 / 字节跳动、DeepSeek 深度求索均无关联。素材来源与声明见文末。

## 效果

| 位置 | 改前 | 改后 |
| --- | --- | --- |
| 侧栏品牌行 | 鲸鱼标志 + `DeepSeek Harness` | 豆包 App 图标 + `豆包` |
| 新会话首屏 | 鱼形标志 + 「探索未至之境 预览版」 | 豆包人物（无背景、无文字）+ 人物后方的点阵 DeepSeek 鲸鱼 |
| 鼠标划过鲸鱼 | — | 粒子被径向推开并回弹（原站同款「飞舞」动效） |

预览图见 `docs/`：`hero-light.png`（浅色）、`hero-dark.png`（深色）、
`hero-pointer.png`（鼠标划过时的散射）、`hero-narrow.png`（1100×720）。

## 实现要点

三层贡献，全部通过**声明感知**的 `ctx.slots.inject()` 安装，因此无论主题先于还是后于
宿主外壳激活都能生效：

| 槽位 | 占用者 | 说明 |
| --- | --- | --- |
| `sidebar.brand.mark` | `DoubaoBrandMark` | 豆包图标，尺寸取自宿主传入的 `{ size }` |
| `sidebar.brand.name` | `DoubaoBrandName` | 纯文本 `豆包`，继承侧栏品牌排版 |
| `conversation.hero.brand.mark` | `DoubaoHeroMark` | 人物 + 点阵场 |

两个关键细节：

- **优先级 `-1`**：single 槽位渲染「优先级最低」的那条注册，而随包发布的
  `dsh-client-ui-brand-official` 已用默认优先级 `0` 占住了两个侧栏品牌槽位。
  按框架报错指引换一个更低的优先级就是替换品牌占用者的正规做法。
- **不依赖任何哈希类名**：宿主 CSS Module 的类名是按构建内容哈希的，所以
  「隐藏首屏标题」「把人物对齐到对话框」这些必须落到具体元素上的改动，
  一律通过 `[data-slot=...]` 标记和结构关系（单子元素包裹链、卡片的前一个兄弟节点）
  去定位，不写死类名，也不写死祖先层级。

### 首屏场景的几何

宿主只给了插槽一个 34px 的行内座位，所以场景做成**零高度覆盖层**：所有东西都在
`[data-doubao-hero]` 内绝对定位，对话框的位置和尺寸完全不受影响 —— 这是「胳膊不遮挡
输入框」的结构性保证，而不是靠调像素。

- 舞台 `[data-doubao-stage]` 从零高度的标题行向下长到「英雄控制行」（工作区 / 预设 /
  权限那一排 chip）的上沿；人物底边就站在那条线上，底部按立绘高度的 9% 用 `mask-image`
  淡出，遮掉立绘自身的横向裁切边。
- 为什么站在这排 chip 上而不是直接站在输入框上：那排 chip 的绘制层级在场景之上，
  人物压过去会让深色文字落在黑 T 恤上、深色主题里落在手臂上，两边都看不清。
- 空出来的高度通过给滚动容器设 `justify-content: flex-end` 加底部内边距
  （`clamp(16px, 9vh, 96px)`）得到，于是对话框整体上移、上方留给场景；只在首屏挂载期间
  生效，卸载时按原值恢复。
- 人物与点阵场按可用区间自适应：`ResizeObserver` 每次重算尺寸与位置，窄窗口自动缩小，
  并且保证画布不越出滚动容器（否则会凭空长出一条滚动条）。

### 像素渲染：任何窗口都不糊

立绘是 804×625 的位图，渲染时守三条规则（都在 `hero.js` 的 `layout()` 里）：

1. **不放大**：请求宽度不超过 `源宽 / devicePixelRatio`，所以在任何屏幕缩放比例下都是
   降采样而不是插值放大 —— 这是「不同窗口大小像素渲染合适」的关键。
2. **整数 CSS 像素**：宽高都取整（高度由取整后的宽度按比例推出，保持长宽比），
   避免浏览器在半像素框上重采样。
3. **居中不用 transform**：用 `left:0; right:0; margin:auto` 取代 `translateX(-50%)`，
   否则元素会落在半像素边界上，1x 屏上每条边都会发虚。

窗口被拖到另一块缩放比例不同的屏幕、或浏览器缩放变化时，`devicePixelRatio` 会变但尺寸
不会变，所以另有一个 1.2s 的观察间隔专门在这种情况触发重排。

### 点阵鲸鱼：从 three.js 到裸 WebGL2

原站是 react-three-fiber 的 `instancedMesh`：把鲸鱼 SVG 采样到 60×60 的画布上，
逐格生成小方块，用自定义顶点/片元着色器做组装、游动、光照和鼠标推散。

`src/client/digitile.js` 把 three.js 那层管线换成裸 WebGL2，**着色器两段、以及全部
上游常量（采样 60、格距 0.18、方块 0.06×0.06×0.018、相机 (0,0,18) fov 50、
光照 (4.5,5.5,3) range 14 shade .28–2.79 followX 1.05、鼠标 radius 4.9 strength .8
decay .2 distort 5、组装 `1-(1-x)^3` 并 0.3s 后启动 2.5s、30fps 帧率上限）都按原值
逐字保留**。唯一改写的是把 three.js 的逐实例矩阵换成它实际携带的两个值
（中心点 + 均匀缩放），这样就不需要 `mat4` 实例属性。

**唯一有意偏离**：原站是黑底、粒子用加法混合的白光，在浅色界面上等于不可见。所以
浅色界面保持同一套着色器，改成 alpha 混合 + DeepSeek 蓝油墨，并把光照区间收窄
（上游下限接近纯黑，在白色背景上会像脏点）；深色界面走原站的加法混合原样。
两条分支都在 `src/client/hero.js` 的 `appearanceFor()` 里，一眼可改。

## 目录

```
package.json              客户端插件清单（dsh.bundle.patch + dsh.client.inject）
cordis.patch.yml          把这个插件插进 profile 的层栈
lib/index.js              node 半侧：空 Loader 座位
client/client.js          浏览器 bundle（由 tools/build-client.mjs 生成，勿手改）
src/client/
  index.js                三个槽位占用者与 apply/inject
  hero.js                 首屏场景、几何、明暗分支
  digitile.js             点阵鲸鱼 WebGL2 移植
  styles.js               注入的样式表
  artwork.js              素材 data URL 占位符（构建期替换）
assets/                   豆包图标、人物立绘（已抠图）、DeepSeek 鲸鱼 SVG
tools/                    构建与验证工具（见下）
docs/                     预览截图
```

## 安装

```powershell
dsh plugin --profile web add C:\Users\DongZhi\Desktop\vibcode\dsh_theme_doubao
```

然后**重启 DSH**（客户端 bundle 在启动时快照，热更只对源码启动 + `pnpm run dev:web` 生效），
刷新页面即可。卸载：

```powershell
dsh plugin --profile web remove dsh-theme-doubao
```

## 改主题

想调尺寸、位置、颜色，改这三处即可：

| 想改什么 | 改哪里 |
| --- | --- |
| 人物大小 / 场大小 / 与 chip 的间距 / 底部内边距 | `src/client/hero.js` 的 `CONFIG` |
| 人物底部淡出长度、投影、场的内联尺寸变量 | `src/client/styles.js` 的 `--doubao-character-fade` 等 |
| 明暗两套颜色与混合模式 | `src/client/hero.js` 的 `appearanceFor()` |
| 点阵密度 / 格距 / 光照 / 鼠标力度 | `src/client/digitile.js` 顶部的常量（都标了上游出处） |

改完重新构建并重启：

```powershell
node tools/build-client.mjs
```

## 工具（验证回路）

| 脚本 | 作用 |
| --- | --- |
| `tools/build-client.mjs` | 把 `src/client/*` 包进 `window.__ModuleLoader__` 信封，内联素材 |
| `tools/cutout.mjs` + `tools/pixdump.ps1` | 立绘抠图：三阶多项式拟合蓝底 → 距离抠像 → 描边去溢色 → 连通域去投影 |
| `tools/shoot.mjs` | 无头 Chrome + CDP 截图（支持 `--dark` 模拟深色、`--move x,y` 模拟指针、`--eval` 取数） |
| `tools/probe.mjs` | 一次性探针：把插槽周围宿主布局和主题自己写的内联样式打成 JSON |
| `tools/whale-shape.mjs` | 用浏览器同一条采样代码把鲸鱼 60×60 采样结果打成 ASCII，验证点阵形状 |

无头浏览器需要先用调试端口启动一次 Chrome：

```powershell
& 'C:\Program Files\Google\Chrome\Application\chrome.exe' --headless=new --remote-debugging-port=9222 `
  --enable-unsafe-swiftshader --hide-scrollbars --window-size=1440,900 --user-data-dir=$env:TEMP\doubao-chrome about:blank
```

## 已知限制

- **素材是位图**：人物立绘来自参考图（1080×1919）抠图后裁到 804×625 内联进 bundle，
  所以 `client/client.js` 约 650 KiB。想更小可以换更小的立绘。
- **首屏布局是改过的**：仅在主题挂载的首屏阶段，滚动容器被临时改成
  `justify-content: flex-end`；不装主题时行为完全不变，卸载即恢复。
- **浅色/深色分支**：深色走原站加法混合，浅色走 alpha 混合（原因见上）。
- **点阵密度**：与上游同为 60×60 采样；因为本场景里鲸鱼画得比原站更大，
  同一采样下点距看起来更疏。想更细可以调 `digitile.js` 的 `SAMPLE` 与 `CELL`
  （两者要同比缩放才能保持鲸鱼世界尺寸不变）。

## 素材来源与声明

- `assets/doubao-mark@2x.png` — 豆包官方 App 图标
  （`lf-flow-web-cdn.doubao.com/obj/flow-doubao/favicon/new-doubao/192x192.png`）。
- `assets/doubao-character.png` — 从参考宣传图抠出的人物立绘（抠图脚本见 `tools/`）。
- `assets/deepseek-whale.svg` — `deepseek.com/harness/images/hero-whale.svg`。

**本仓库是非官方的个人主题插件，与豆包 / 字节跳动、DeepSeek 深度求索均无关联，也未获其授权。**
上述品牌素材的版权与商标归各自权利人所有，仅在本地渲染时内联使用；仓库中的代码部分按
MIT 许可（见 `LICENSE`），品牌素材不在此列。若权利人提出异议，请自行替换
`assets/` 下的素材或下架相关内容。
