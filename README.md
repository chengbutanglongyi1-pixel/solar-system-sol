# 太阳系 SOL

公开的静态网页版。朋友打开页面即可使用，不需要登录。

这是一套示意用的太阳系浏览程序：轨道位置按公开近似星历计算，距离和大小在总览里使用真实数量级，天体表面多数是程序生成或手绘式艺术表现。**它不是 NASA 的官方产品，也不代表 NASA、USGS 或 JPL 的观点。**

## 来源说明

程序里保留的公开资料引用包括：

- 行星物理数：NASA 行星事实表（NSSDC）
- 轨道：JPL 近似根数 / Horizons 拟合
- 自转相位：IAU / NAIF 公开自转模型
- 地球陆地轮廓：Natural Earth 50m
- 手机上的木卫二暖色图：来自 NASA 3D Resources 的 USGS Voyager 全球拼接，署名 USGS、JPL 与 Caltech

这些引用只说明数据或图像从哪里来，不表示本仓库获得了额外的版权许可。仓库没有另加开源许可证。

电脑端固定使用轻量着色器和已经嵌在程序里的预生成图，不会在打开页面时同步编译整套厚着色器，也不会因为页面不在嵌入框里就自动升级。手机上的木卫二使用上述暖色图；其背面仍然模糊，电脑端仍用原来的预生成图。这是当前已发布版本里刻意留下的差别。

## 本地构建

需要 Node.js 22。

```bash
npm ci
npm test
npm run build
npm run preview
```

生产页面的资源前缀是 `/solar-system-sol/`。本地预览地址是 `http://127.0.0.1:4173/solar-system-sol/`。

`npm test` 只核对贴图摘要、路由和安全开关，并用模拟的 DOM / WebGL 跑已发布的表面加载逻辑。它不能代替浏览器画面、像素验收或真机测试。

## GitHub Pages

工作流 `.github/workflows/pages.yml` 在 `main` 分支推送后构建 `dist` 并发布。站点路径是仓库名子路径 `/solar-system-sol/`。Pages 来源需要设为 GitHub Actions。工作流只申请读取代码、写入 Pages 和 OIDC 身份，不使用额外密钥。
