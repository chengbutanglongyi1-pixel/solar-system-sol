# SOL 离线时间原型与接线审核清单

此实验在 `science/phase2-v1` 上独立验证 UTC→TAI→TT→TDB。接口和基准位于 `scripts/science/` 与 `fixtures/science/time-prototype/`。生产源码、轨道根数及原有科学数据保留原样。

## 接口

`convertTime(iso, options)` 接受带 `Z` 或数字时区偏移的公历时间，允许最多 9 位小数秒。等价偏移写法归一为同一 UTC。无时区、未知偏移 `-00:00`、无效日期和未公布的 `:60` 均报错。闰秒合法性在归一到 UTC 后验证。

- `utcIso` 保留 UTC 日期、秒和小数。`utcUnixMs` 是向下截取到毫秒的界面表示，闰秒时返回 `null`。
- `jdUtcQuasi` 是 SOFA 约定的两部分 UTC 准儒略日。闰秒日按该日实际秒数编码日分数。物理时长请在 TAI 或 TT 上相减。
- `jdTai`、`jdTt`、`jdTdb` 均为 `[公历午夜的 JD, 日分数]`，日分数处于 `[0, 1)`。比较时分别相减两部分，再乘 86400，避免合并成单个大 JD 时损失亚毫秒精度。
- `taiMinusUtcSeconds` 来自版本化闰秒表。TT = TAI + 32.184 秒。地心 TDB−TT 采用 USNO Circular 179 式 (2.6) 的七项近似，随日期变化。`provenance` 标记表版本、失效边界及 UTC 是公布值还是未来假设。[USNO 时间尺度公式](https://aa.usno.navy.mil/downloads/Circular_179.pdf)
- 原型没有 UT1 输出。地球自转及地面观测另需 IERS 的 `UT1−UTC` 和 EOP。`years` 若为旧函数的适配参数，须明确以哪个 TDB 历元起算。`simRef` 的播放时长与地心 TDB 的模型输入应保留各自的语义。[SOFA 时间转换手册](https://www.iausofa.org/cookbooks)

## 有效期与参考数据

默认有效区间为 `[1972-01-01T00:00:00Z, 2027-06-28T00:00:00Z)`。上限采用 IERS 数据文件的保守失效日。Bulletin C 72 确认 2026 年 12 月末不插入闰秒。失效日后的预览必须显式传入 `{ future: 'assume-no-new-leaps' }`，结果标为 `assumed-no-new-leaps`，沿用最后已知的 TAI−UTC 37 秒。离线实验覆盖到 2051 年末，2052 年起拒绝转换。1972 年前的历史 UTC 与未来实际闰秒超出本原型的数据支持范围。轨道适用期是另一个约束，JPL 表 1 的 1800–2050 年拟合不涵盖 2051 年。[IERS 数据表](https://hpiers.obspm.fr/iers/bul/bulc/Leap_Second.dat) · [Bulletin C 72](https://datacenter.iers.org/data/html/bulletinc-072.html) · [JPL 行星近似根数](https://ssd.jpl.nasa.gov/planets/approx_pos.html)

`leap-seconds.json` 保存 IERS 版本、取得日期、原始文件 SHA-256 和全部 28 个有效条目。基准由 PyERFA 2.0.1.5 / ERFA 2.0.1（派生自 SOFA 20231011）独立生成。UTC/TAI/TT 使用 ERFA 自带闰秒数据。TDB 用 `dtdb` 的完整周期模型与 `tttdb`，地心设置 `u=v=0`。生成器对照固定版本 wheel 的 SHA-256，临时解包给独立 Python 进程，项目依赖保持不变。[PyERFA 发布记录](https://github.com/liberfa/pyerfa/releases/tag/v2.0.1.5) · [ERFA 地心周期项](https://raw.githubusercontent.com/liberfa/erfa/v2.0.1/src/dtdb.c)

## 验收结果

| ERFA 对照范围 | 样本数 | 地心 TDB 最大绝对差 |
|---|---:|---:|
| IERS 表有效期内 | 309 | 8.9985 µs |
| 未来假设下的预览 | 100 | 8.1159 µs |

所有样本低于 0.1 ms（100 µs）门槛。409 个样本含 1972–2051 每年四季的取样、全部 27 次正闰秒前中后、J2000 TT 与 TDB、项目历元、闰秒表失效边界及预览范围末端。TAI、TT 与 UTC 准 JD 的表示对照误差小于 10 ns。另测等价时区、偏移后的闰秒、非法日期和超范围拒绝。未来列的差值以双方采用同一闰秒假设为前提。

项目历元 `2026-11-01T16:00:00Z` 的 UTC JD 分量为 `[2461345.5, 2/3]`，现有源码将 `JD_START` 存为 `2461346.1666667`，其实际 binary64 值比 UTC 标签晚 **2.88337469 ms**。分量法把该偏差与真正的时标差分开。该时刻 TAI−UTC 为 37 s，原型 TDB−TT 约为 −1.456946 ms，因此 TDB−UTC 约为 69.182543 s。J2000 TDB 的 UTC 标签由 ERFA 反算为 `2000-01-01T11:58:55.816099307Z`。

离线复验运行 `node scripts/science/test-time-prototype.mjs`。从基准库重算用 `python scripts/science/generate-time-reference.py <wheel路径> --verify`，需 Windows x64 Python 3.12、NumPy 与 `erfa-reference.json` 指定的 PyERFA wheel。输出一致后才做接线审核。首次生成使用排他写入，以保护已存对照。

## 生产接线审核清单

源码行号以实验基准提交 `af942ede` 为准。根 `App` 仅挂载 `SolarView`，WebGL 不可用时显示提示。`Scene3D`、`SimView` 和 `Closeup` 是源码保留路径，未由当前入口挂载。

| 路径 | 当前时间参数 | 正式接线前的核对项 |
|---|---|---|
| `SolarView` 时钟与日期（`SolarSystemApp.tsx:11514`, `:12680`） | 真实速度从 `utcNowYears()` 取 UTC 毫秒差。倍速累加限幅的帧时长，暂停冻结。`fmtDate(years)` 用 UTC `START_MS` 格式化 | 先确定统一物理时刻的存储及闰秒显示。保持真实速度回到墙钟、暂停、倍速和帧限幅的现有契约 |
| `SolarView` 行星位置及轨道线（`:11531`, `:11698`，`legacy-orbits.ts:55`） | `helioVec(id, years)` 和 `planetOrbitKm(id, years)` 都以 `JD_START + years × 365.25` 计算动力学根数 | 由同一地心 TDB 派生位置和轨道线所需输入。旧接口仅可在边界换算 `yearsTdb`，用对照测试防止轨道线与天体位置脱节 |
| `SolarView` 月球和其他卫星位置、轨道线（`:11532`, `:11538`, `:11707`, `:11717`） | `moonVec(jd)`、`moonRelAt(gm, jd)` 使用同一个旧 JD，轨道线再加各自的周期日偏移 | 核实当前截断 Meeus 月球模型的 TT/JDE 依据，以及其他卫星拟合使用的时间尺度。按对应模型取同一时刻与周期。地月中心合成另审 |
| `SolarView` 姿态（`:3263`, `:3270`, `:11548`, `:11895`） | 地球恒星时近似直接使用旧 JD。`spinW` 另加固定 69.184 秒。潮汐锁定由位置向量和 `lockPoleOf(jd)` 决定，高倍速可改走视觉累加 | 地球自转需 UT1，完整姿态还需明确 TT/EOP。先核实 IAU 与月球极轴模型的时标，防止将 TDB 接入时再加一次固定时差。保持视觉累加独立 |
| `Scene3D` 旧画面（`:2525`, `:2641`, `:2818`） | `timeRef` 从旧历元按速度累加。行星位置用 `helioVec(years)`，行星轨道线 `orbitPoints` 固定旧历元。月球位置、轨道线与锁定相位用 `moonOffset/State(jd)`，部分卫星用示意周期 | 若恢复此入口，应先明确固定历元轨道线是否保留，再复用统一时刻。区分示意自转与动力学位置，不将其称作当前 WebGL 回退 |
| `SimView` / `Closeup` 旧示意与特写（`:1546`, `:1764`, `:1910`） | `SimView` 用 `helioLon(id,t)` 从旧历元取行星黄经。特写自转按显示时间推进 | 仅在重新启用时审核。显示动画继续使用帧时钟 |

仍待核实截断月球模型、卫星拟合和姿态项的原始时标依据。本次验收停在离线阶段。生产接线与地月中心合成分别提交审核，正式切换前覆盖电脑和 iPhone 的交互、帧率及轨道线对齐。若后续无法重现独立基准、闰秒边界失败或模型时标仍无依据，保留差异与待决项。撤回本实验只需撤销独立的离线提交。
