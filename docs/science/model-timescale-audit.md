# SOL 模型时标核查与行星同历元验证

核查基线为科学分支 `374355b38d4563356dbc3f49d926434eab15b958`。当前入口 `App` 挂载 `SolarView`。该画面的 `helioVec` 和 `planetOrbitKm` 都取 `P.simRef.current` 的 `years`，按 `JD_START + years × 365.25` 得到同一个**旧式数值 JD**。这段时钟以 UTC 历元为锚，源码尚无独立的 TDB、TT、UT1 输入。此次使用生产计算公式做离线验证。

## 各模型的时标依据

- **八大行星根数与轨道线使用 TDB。** `legacy-orbits.ts:55` 的 `helioVec` 和 `SolarSystemApp.tsx:3417` 的 `planetOrbitKm` 都按 J2000 起算儒略世纪，调用同一 `orbElems`。JPL 表 1 指定 JDTDB。`earth` 槽沿用地月质心。谷神星、冥王星也走同一计算接口，列入几何一致性测试。JPL 表 1 的适用年代和时标证据不扩展到这两组系数。[JPL 行星近似根数](https://ssd.jpl.nasa.gov/planets/approx_pos.html)
- **截断月球位置可明确采用 TT。** `SolarSystemApp.tsx:2068` 标注 `moonState` 是 Meeus 主要项，平距角、太阳/月球平近点角等系数与 ERFA `moon98` 的 Meeus 项相符。`moon98` 规范接收 TT，注释说明原算法使用动力学时标，以 TT 或 TDB 计算对该近似精度无显著差异，直接代入 UT 会造成误差。SOL 保留了自己的截断项和黄道修正。这里只确定输入时标，未验证位置精度或替换模型。今后位置 `moonVec` 及月球轨道线采样应从同一时刻取得 TT。[ERFA Moon98，参数与注释 2、4、7](https://raw.githubusercontent.com/liberfa/erfa/v2.0.1/src/moon98.c#L13-L77)
- **其他卫星拟合的原始时标待核实。** `SolarSystemApp.tsx:3086` 的 `GAL2`、`SAT2`、`URA2`、`NEP2`、`CHA2` 注明来源为 Horizons。`moonRelAt` 与 `moonOrbitNormal` 将 `jd − 2451545.0` 当作日数使用。搜索仓库与系数历史（引入提交 `eaeaf1f`）只找到模型声明，未找到这组卫星的查询参数、原始样本、拟合记录或 `L0` 历元标注。Horizons 矢量表可选 TDB 或 UT，根数表使用 TDB。服务的动力学自变量不能证明这批系数实际拟合了哪个时标，也不能排除已吸收的相位差。需要拿到包含 `EPHEM_TYPE`、`TIME_TYPE`、样本 JD、`L0` 参考历元和拟合残差的记录，或独立重建并审核拟合。[Horizons API 参数](https://ssd-api.jpl.nasa.gov/doc/horizons.html)
- **IAU 本初子午线 `spinW` 使用 TDB。** `SolarSystemApp.tsx:3245–3274` 的线性 `W` 按 J2000 TDB 日数定义，与 WGCCRE 和 NAIF PCK 的时标一致。源码对部分天体简化了周期项，此处仅核实输入时标。**重复补偿点**在 `:3263` 的 `ROT_DT_DAYS = 69.184 / 86400`，由 `:3273` 的 `spinW` 加到输入日数上。它是旧路径的固定近似。日后若直接传入已经转换好的 TDB，须在自转接线中一并处理这个偏移。按源码木星转速，重复加算会多转约 **0.697074°**。[IAU WGCCRE 2015 报告](https://astropedia.astrogeology.usgs.gov/download/Docs/WGCCRE/WGCCRE2015reprint.pdf) · [NAIF pck00011 木星示例](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc)
- **地球恒星时使用 UT1。** `SolarSystemApp.tsx:11548` 的地球分支使用简化恒星时线性项，绕过 `spinW` 和上述固定补偿。该类恒星时公式的地球自转输入是 UT1，当前 `jd` 只是 UTC 锚定数值。后续需依据 IERS 的 `UT1−UTC` 另行接线。快档视觉自转 `spinAcc` 使用帧时长，保持其独立含义。[ERFA GMST82 的 UT1 输入](https://raw.githubusercontent.com/liberfa/erfa/v2.0.1/src/gmst82.c#L8-L14)
- **潮汐锁定姿态有独立待决项。** `SolarSystemApp.tsx:3329`、`:11895` 通过 `lockPoleOf` 与相对位置向量定向。特里同极轴取自拟合轨道法向，继承该拟合的时标待决项。月球 `moonPoleAt` 采用简化的平均升交点与 Cassini 几何，TT 可作为与月球位置一致的候选输入，但仍缺这套极轴近似的原始模型说明与姿态基准。本轮没有将该分支认定为完整 IAU 姿态模型。

## `SolarView` 同一物理时刻的离线验证

运行 `node scripts/science/test-planet-orbit-epoch.mjs`。脚本从当前源码提取 `SolarView` 实际调用的 `helioVec`、`planetOrbitKm` 及依赖，在离线环境执行，记录两者真正传入 `orbElems` 的儒略世纪数。每个时刻先使用已验收的 UTC→TDB 原型，再用两部分 TDB 减去旧接口的数值起点 `JD_START`、除以 365.25。所得同一个 `years` 同时交给两项计算。这里把 `JD_START` 当作旧接口的数值坐标原点，转换器仍以 UTC 标签表示物理时刻。

- **409 个时刻 × 10 个天体，共 4,090 对。** 两次根数调用的历元严格相等。每条 321 点轨道线的正中顶点与位置向量逐分量完全一致，最大差 **0 km**。
- **4 组等价时区输入，共 50 对天体输出比较。** 覆盖项目历元、J2000 TDB、带偏移的闰秒标签和闰秒表失效边界。两部分 TDB、位置及全部轨道顶点完全一致。超出闰秒表有效期的样本沿用显式「不新增闰秒」假设。2051 样本仅用于计算路径一致性。
- **旧接口舍入单独度量。** 将两部分 TDB 通过 `years` 传回旧接口，最大时间舍入为 **20.096 µs**。旧接口实际使用的历元与 ERFA 最大差 **24.194 µs**，低于 **100 µs** 验收线。
- **反例检查。** 故意将地月质心槽的轨道历元推迟 1 秒，两个根数输入立即分离，中点偏离约 **30.009 km**，表明检查能识别位置与轨道线错用历元。

行星同历元离线验证通过，支持后续审核时将一个 TDB 时刻同时传给位置和轨道线。卫星拟合及部分潮汐锁定姿态的时标证据尚缺，不能把共享 `jd` 整体切换为 TDB。停在此核查阶段，正式接线和地月中心修正分别等待审批。
