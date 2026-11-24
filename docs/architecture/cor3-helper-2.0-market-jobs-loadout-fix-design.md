# COR3 Helper 2.0 — 市场任务与配装修复设计（审阅稿）

- 状态：**设计审阅稿 v1，未实施**
- 适用范围：Auto Jobs / Auto Finish / 市场数据链路 / 配装（Loadout）
- 依据：`v2` 分支源码（`2.0.8-salta.312` → `2.0.9-salta.314`）+ `auto.log`、`A.log`、`B.log`
- 本文只做根因判断与改动设计，**不包含任何代码修改**

---

## 0. 结论摘要

用户反馈的三个现象，分别对应三条独立但相互放大的缺陷链：

| 编号 | 现象 | 根因判断 | 置信度 |
|---|---|---|---|
| P1 | HOME 市场不刷新 | 只含 options 的**部分市场推送**被当成完整同步，刷新了「新鲜度时钟」，导致 HOME 永远不进入刷新队列 | 高（日志可自证） |
| P2 | 已完成（可领取）不自动领取，同时出现「未知 + 可领取」双 tag | 完成结果 `unconfirmed` 形成的**完成屏障是锁存态**，自动路径没有释放入口；UI 又刻意允许两个 tag 并存 | 高 |
| P3 | 需要 21 点只能配出 20 点 | **已确认主因**：解密路径把游戏返回的「当前功率」`decryptPower` 当成了「需求功率」，导致计划功率恰好等于当前值就被判为可行、永不换装。公式本身已用游戏 `resources.softwarePower` 验证一致。「不可行时保留当前硬件」的排序缺陷是次要问题 | 高（C.log + loadout.json 实证） |

三条链共同暴露的结构性问题：

1. **市场数据没有「来源/分量」概念**，一个 `updatedAt` 同时承担 jobs/options/lots 的新鲜度。
2. **任务生命周期状态机没有单一写者**：Auto Finish、Reconciler、Job State 三处都能影响「是否可领取」，且屏障是锁存而非证据驱动。
3. **能力值计算没有单一实现与可观测性**：取整策略、目标匹配、候选过滤三处都可能让结果低 1 点，但都没有日志。

因此本设计不只修三个 bug，还包含一套静态目录与功率索引方案（第 6 节）以及四组结构收敛（第 7 节）。

---

## 1. 证据与复现

### 1.1 P1：HOME 市场从不刷新

`B.log`（11:16–11:56，约 40 分钟）统计：

```text
grep -o '"market":"[a-z]*"' B.log | sort | uniq -c
     35 "market":"dark"
     35 "market":"soyuz"
     35 "market":"usol"
```

- `grep -i "home\|CORE" B.log` → **0 条**。
- `Market refresh complete` 共 105 条 = 3 市场 × 35 轮，**没有任何 HOME 行，也没有任何 HOME 失败行**。
- 每轮间隔约 67–72 秒，说明 Auto Jobs 在稳定跑，只是刷新集合恒定为 3 个市场。
- 同一时间窗内 `Market information fetch complete ... jobs:0` 36 次。

代码侧的对应事实：

| 位置 | 行为 |
|---|---|
| `src/ui/app/hooks/useGameStatus.ts:40-61` | Overview 页每 60 秒调用一次 `portal.marketOptions(home)`（只为取 credits） |
| `src/contexts/background/handlers/market.ts:15-25` | `market.options` → `fetchOptionsView(marketId)` |
| `src/contexts/background/automation/job-market-sync.ts:316-346` | `fetchOptionsView` 对 home 跳过路由，直接发 `V2_MARKET_OPTIONS` |
| `src/infrastructure/game-ws/game-socket-hub.ts:1316-1328` | `requestMarketOptions` 登记 `pendingMarketActions['get.options']` |
| `src/infrastructure/game-ws/game-socket-hub.ts:541-554` | 响应到达后把**整份缓存快照**（options+lots+jobs）通过 `V2_MARKET_CACHE_UPDATED` 抛给页面 |
| `src/contexts/content/index.ts:35-44,51` | 转发为 `V2_MARKET_CACHE` |
| `src/contexts/background/messaging.ts:24-29` | 转给 `autoJobs.applyMarketCacheSnapshot(marketId, snapshot)` |
| `src/contexts/background/automation/auto-jobs.ts:291-321` | 把该市场标为 `ok:true, stale:false`，`updatedAt=now`，并用快照内容**整体替换**该市场的 jobs 与 `resetAt` |
| `src/application/auto-job/snapshot.ts:27-49` | 合并时 `ok:true` 的市场直接以新行覆盖，且 `resetAt` 不做回退 |
| `src/contexts/background/automation/auto-jobs.ts:486-497,499-505,118-122` | 调度只看 `updatedAt` 与 `resetAt` 判断是否需要刷新 |

**机制**：HOME 的 options 每次被 UI 拉取，都会触发一次「整市场已同步」的写入，把 `updatedAt` 刷新到当前时刻。Auto Jobs 的 `marketsToRefresh()` 因此始终认为 HOME 是新鲜的（或认为其 `resetAt` 缺失但锚点刚更新），于是把 HOME 排除在 `targets` 之外。被排除的市场**没有任何日志**，所以现场只能看到「三个市场在刷，HOME 不动」。

附加证据（同一机制的第二伤害）：`mergeAutoJobsSnapshot` 对 `ok` 市场不回退 `resetAt`，而 `applyMarketCacheSnapshot` 传入的 `resetAt` 是 `mapped.resetAt ?? null`。只要这次推送的 jobs 容器里没有 `nextJobsResetAt`，HOME 的重置时间就会被抹成 `null` —— 这又直接触发第 2 节 P2 的「重置身份不匹配」。

**用户现场补充（2026-11-24）**：用户描述「会看一会儿 Overview，然后切到自动化页看刷新情况，显示旧时间」。这与上述机制完全吻合：停留在 Overview 时，HOME 的 `updatedAt` 被 60 秒一次的 options 轮询不断刷新；切走后轮询停止，时间戳立刻停止前进并开始变旧。也就是说，用户看到的「旧时间」不是数据真的停止更新，而是**时间戳在页面上被推着走、jobs 却从未重新拉取**。这条观察同时否定了「HOME 同步失败」的假设（日志里也没有失败记录）。

### 1.2 P2：未知 + 可领取

链路事实：

| 位置 | 行为 |
|---|---|
| `src/infrastructure/browser/chrome-tab-job-command-adapter.ts:26-38` | `complete` 超时/传输失败一律标 `unconfirmed: true` |
| `src/application/auto-job/execution-service.ts`（完成屏障段） | `unconfirmed` 写入 Job State 与 Completion Sidecar 的屏障 |
| `src/contexts/background/automation/auto-finish.ts:434-443` | `matchesCompletionBarrier()` 命中则任务不可跑 |
| `src/contexts/background/automation/auto-finish.ts:491-511`、`658-677` | **屏障判断在「claim-only 豁免」之前**，因此「已 take 且可领取」也会被拦下，记为 `skipped.completionUnknown` |
| `src/contexts/background/automation/auto-finish.ts:350-432` | 释放屏障的唯一实现 `releaseClaimableCompletionBarriers()` |
| `src/contexts/background/automation/auto-finish.ts:484-486`、`651-653` | 该函数**只在 `options.forceRefresh === true` 时调用** |
| `src/contexts/background/handlers/auto-finish.ts:11-23` | bridge 支持 `force`，但 `PopupPortal` 未暴露，UI 无入口（`grep forceRefresh src/ui` 为空） |
| `src/contexts/background/automation/auto-jobs.ts:374` | 自动周期调用 `autoFinish.run(owner, {}, synced)`，**不带 force** |
| `src/application/auto-job/job-state-reconciler.ts:112-118` | 另一条释放路径：需要 **15 分钟冷却** |
| `src/application/auto-job/job-state-reconciler.ts:370-386` | 且只在「成功的市场同步 + reset 身份相等」时执行 |
| `src/contexts/background/automation/auto-finish.ts:563-574` | 被屏障拦住的任务不产生 retry 计划，调度器没有 wakes |
| `src/ui/app/view-models/job-report.ts:195-201` | `showClaimableBadge()` 明确允许 `unknown + claimable` |
| `src/ui/components/JobMarketList.tsx:186-196` | 两个 tag 同时渲染 |

**机制**：

1. 一次 `complete` 超时 → 本地记为 `unconfirmed` 并上屏障（这是合理的安全设计，防止重复完成）。
2. 游戏侧其实没有完成，行仍显示「已 take 且可领取」。
3. 自动路径（无 force）不会释放屏障；Reconciler 的释放要满足 15 分钟 + 成功同步 + reset 身份一致。
4. **P1 让 HOME 的 `resetAt` 变成 `null`**，Reconciler 的 `local` 匹配（`job-state-reconciler.ts:281-291`）随之失配，HOME 的可领取任务**永久**停留在 unknown。
5. UI 按设计同时显示「未知（unknown）」和「可领取（ready to claim）」，用户看到的就是「其实能领，但插件不领」。
6. 由于没有 retry 计划，Auto Jobs 不会为此提前唤醒；下一轮仍然命中同一条屏障。

**结论**：这不是「多显示了一个 tag」的小问题，而是状态机不收敛。P1 与 P2 在 HOME 上叠加成永久卡死。

**用户现场补充（2026-11-24）**：用户反馈当天「一直都很顺，暂未复现」。这不影响结论：屏障路径是确定性的，只是需要「一次 complete 超时 + 一条可领取行」才触发；修复不依赖现场复现，验收时用构造场景即可。

### 1.3 P3：21 点只能配出 20 点

**2026-11-24 更新：已用 `C.log` + `loadout.json` 定位到明确根因。此前并列的 A/B/C 假设大部分可以排除。**

#### 现场一：`C.log` 的 `.xvct` 解密失败

19:12 两个 `.xvct` 文件，日志完整记录了整条链路：

```text
Decrypt file analysis: canDecrypt=false, power=20
loadout: Loadout plan selected | {"ability":"DECRYPT","target":".xvct","requiredPower":20,"power":20,
  "software":"Lyapun AA8","cpu":"UNO 6.651","gpu":"Force Industry 22C","ram":"X-Vault 6-54 Spec",
  "psu":"IP-Feichang K3S6","switchCost":0,"keptCurrentHardware":true}
auto-job: Decrypt loadout ready | {"requiredPower":20,"power":20,"feasible":true}
auto-job: Decrypt analysis after loadout: canDecrypt=false, power=20
auto-job: Decrypt power still insufficient after loadout | {"decryptPower":20}
```

插件认为「20 ≥ 20，可行」，因此 `keptCurrentHardware=true`、不换任何硬件；换装后游戏仍然 `canDecrypt=false`。

#### 现场二：`loadout.json` 证明公式本身是正确的

导出文件：19 件硬件、13 个软件，`_meta.validation = { ok: true, hardware: 19, software: 13, softwareWithoutAbilities: [], unmappedHardware: [] }`。

游戏在响应的 `resources.softwarePower` 里直接给出了自己对已装备软件的计算：

```json
{ "moduleId": "019d0b28-3af8-7e17-a157-eaa63c016e36", "ratio": 0.9315068493,
  "abilities": [{ "type": "DECRYPT", "computedPower": 36 }] }
```

该模块是 `5CRYPt0L 09`（DECRYPT `[14, 38]`）。按我们的公式：

```text
floor(14 + 0.9315 × (38 − 14)) = floor(36.356) = 36   ← 与游戏完全一致
```

再用 `C.log` 当时的硬件复算 `Lyapun AA8`（DECRYPT `[20, 35]`，支持 `.xvct`）：

```text
瓶颈 cpu_frequency: (12.7 − 12.5) / (16.8 − 12.5) = 0.0465
power = 20 + 0.0465 × (35 − 20) = 20.697 → floor = 20   ← 正是游戏报告的 20
```

而按 `loadout.json` 的 19 件硬件穷举，`.xvct` 的真实最大功率是 **33**（`I-Partner C16-10` + `SupraPix 41.0` + `C-Stack 10.8` 等组合）；即使保持 dump 时的硬件也有 **23**。

> 注：dump 的装备（`8Pro Series 1870` 等）与 `C.log` 失败时刻（`UNO 6.651` 等）不同，但两套硬件都在 `ownedHardware` 里，穷举结果不受影响。

用**生产代码 + 该 dump** 实跑（把当前硬件换成 `C.log` 的 UNO/Force/X-Vault/IP-Feichang，软件设为 Lyapun）：

```text
required=0   → power 20,  kept current (switchCost 0)
required=20  → power 20,  feasible, kept current (switchCost 0)   ← C.log 的现状
required=21  → power 33,  I-Partner C16-10 (switchCost 4)         ← 修复后
```

**结论：不是配不出来，而是插件根本没去配。**

#### 根因：把「当前功率」当成了「需求功率」

`src/application/auto-job/execution-service.ts:494-499`：

```ts
const requiredPower = analysis.ok && analysis.value.canDecrypt === false
    ? analysis.value.decryptPower ?? undefined   // ← 问题在这里
    : undefined;
```

`decryptPower` 是**当前配置对该文件的功率**，不是需求。三处证据互相印证：

1. `auto.log`：换装前 `canDecrypt=false, power=0`（没有可用的 DECRYPT 模块），换装后 `canDecrypt=true, power=27`；
2. `C.log`：**换装后**的分析 `canDecrypt=false, power=20`，恰好等于 `Lyapun AA8` 在当前硬件上的计算值 20；
3. 因此游戏的真实需求只能是 **21 或更高**（当前 20，且 `canDecrypt=false`）。

于是 `requiredPower = 20`，而计划功率刚好 20 → `feasible=true` → `keptCurrentHardware=true` → 永不换硬件 → 永远卡在 20。

补充：即使把 `decryptPower` 理解成「需求」，由于 `canDecrypt=false`，游戏必然使用严格比较（`power > 需求`）。两种解释得到同一个规划下界：`floor(decryptPower) + 1`。因此修复不依赖对该字段语义的最终裁定。

对照 v1：`ensureDecryptOnlyLoadout` 调用
`findBestSoftwareForAbility(loadout, candidates, 'DECRYPT', 0, fileType)`，
即 **requiredPower=0**，在 v1 的 `isBetterPlan` 里会落到「功率最大者胜」。所以 v1 总是取最大功率方案；v2 引入 `decryptPower` 作为需求后反而退化。

#### 假设处置

| 假设 | 结论 | 依据 |
|---|---|---|
| A `Math.floor` 导致少 1 点 | **排除为本例主因** | 游戏 `resources.softwarePower` 与我们的 floor 结果完全一致（36 = 36；20.697 → 20） |
| B 候选软件被静默丢弃 | **本例未发生** | `softwareWithoutAbilities`、`unmappedHardware` 均为空；13 个软件全部解析成功 |
| C 目标名匹配不一致 | **本例未发生** | `.xvct` 正确匹配到 `Lyapun AA8` |
| D `isBetterPlan` 不可行时保留当前硬件 | **仍成立（次要）** | 对 HACK/无法满足需求的场景会低报真实最大值；本例被错误的需求值掩盖，不是主因 |
| E `requiredPower=0` 关闭优化 | **相关** | `decryptPower=0`（无模块）时退化为 0；修复后应至少为 1 |
| F `decryptPower` 语义误用 | **确认主因** | 见上 |

#### 仍未验证：HACK 的 21 点

`C.log` 还有一条 HACK 失败：

```text
19:12:41 auto-jobs: IP Cleanup @ URM7-H: retrying —
ACTION_FAILED: Best available loadout is still below the required power (route)
```

但日志没有记录 `serverDefenceRate`、服务器类型名与尝试的方案功率，因此无法判断它是：

- 同一个 off-by-one（游戏要求 `power > serverDefenceRate`），还是
- 真实硬件不足（最大可达功率确实低于阈值），还是
- 目标类型匹配失败（`serverTypeName` 与软件 `serverTypes` 词表不一致）。

`serverDefenceRate` 在 v1 中按 `power >= rate` 使用。**必须用一次真实服务器验证后才能决定是否也 +1，不能从解密场景直接外推。**

---

## 2. 修复设计总原则

1. **先可观测，再改行为**：三个问题都存在「静默跳过」。任何修复都必须带可验证的 reason code 与计数，否则下次同类问题仍然无法定位。
2. **证据驱动，不猜状态**：市场数据按「来源分量」记账；任务状态按「远程事实」转移；功率按「单一实现 + 原始值」暴露。
3. **单向依赖**：`domains` 不新增浏览器依赖；市场/负载数据的新字段一律在 `contracts` 用 Zod 声明为 optional，向后兼容旧存档。
4. **修复点不得扩大成重构**：P1/P2/P3 的必改项单独可回滚；静态索引（第 6 节）与结构收敛（第 7 节）分批提交。

---

## 3. P1 修复设计：市场数据来源与新鲜度

### 3.1 目标

- 「只含 options/lots 的推送」永远不能把 jobs 置为新鲜，也不能覆盖/清空 jobs 与 reset。
- Auto Jobs 的「是否到期」只看 jobs 的观测时间。
- 被跳过的市场必须留下 reason。

### 3.2 改动点

| # | 位置 | 改动 | 理由 | 风险 |
|---|---|---|---|---|
| P1-1 | `contracts/tab-commands.ts` / `content/index.ts:35-44` / `messaging.ts:24-29` | 推送消息增加 `source: 'jobs' \| 'options' \| 'lots'`（hub 本来就知道是 `get.jobs` 还是 `get.options`） | 当前 background 收到的是「合并后的整份快照」，无法区分这次到底观测到了什么。不修这一点，后面所有新鲜度逻辑都是猜 | 低：新增可选字段，旧 content 不发送时按 `'jobs'` 兼容 |
| P1-2 | `game-socket-hub.ts:541-554` | 改为发送**增量**：`{marketId, action, data}`，由 background 逐分量合并；不再用 `cachedMarket()` 拼一份可能过期的整包 | 现在 options 响应会把上一次缓存的旧 jobs 一起重新发布，制造「数据刚更新」的假象 | 中：需要同步改 content 解析；保留整包模式作为回退 |
| P1-3 | `contracts/auto-jobs.ts:17-34` | `AutoJobsMarket` 增加 `jobsUpdatedAt?: number`，语义 = **最后一次成功观测到 jobs 的时间**；`updatedAt` 保留为 UI 展示用的「任一数据最后更新」 | 调度与展示共用同一个时间戳是 P1 的根因。拆开后，options 推送只能影响展示，不能影响调度 | 低：optional 字段，Zod `.strict()` 兼容 |
| P1-4 | `auto-jobs.ts:486-497`、`118-122`、`499-505` | `marketsToRefresh` 改用 `jobsUpdatedAt ?? updatedAt`；`marketTtlMs` 同样基于 jobs 时间 | 保证「数据新鲜」= 「jobs 新鲜」 | 低 |
| P1-5 | `application/auto-job/snapshot.ts:27-49` | `ok` 市场在合并时：若更新来源不是 jobs，则**保留**上一份 `jobs`、`resetAt`、`skippedJobs`；只有 jobs 观测才能替换 | 当前「ok 即权威」会让任何推送清空市场。这是 P1 的第二伤害（reset 被抹成 null），也直接喂给 P2 | 低：纯合并函数，已有 `snapshot.test.ts` 可扩展 |
| P1-6 | `auto-jobs.ts:291-321`（`applyMarketCacheSnapshot`） | 按 `source` 分派：options/lots 只写 `marketCache`，不写 Auto Jobs 的 jobs/reset；jobs 才更新行 | 与 P1-5 同因，入口处就应该分流 | 低 |
| P1-7 | `job-market-sync.ts:352-361`（`cacheSnapshotView`） | 合并而不是覆盖 `MarketView`（保留未更新的 jobs/lots/recentJobs/nextJobsResetAt） | Progress 页与 market cache 现在会被 options 推送打空 | 低 |
| P1-8 | `game-socket-hub.ts:394`、`1316-1346` | `pendingMarketActions` 的 key 改为 `action + marketId`（或带 requestId） | 当前 key 只有 `'get.options'`，不同市场的并发请求会互相覆盖，导致 A 市场的响应被记到 B 市场 | 低 |
| P1-9 | `auto-jobs.ts:486-497` | 新增强制到期条件：从未做过 jobs 观测的市场、或存在 `alreadyTaken && canComplete` 的市场，忽略 TTL 一律到期 | 「可领取」是必须立刻处理的工作，不应被时间窗挡住 | 低 |
| P1-10 | `auto-jobs.ts:437-448`、`status()` | 记录并暴露 `skippedMarkets: { marketKey, reason, ageMs }`，写入 `auto-jobs.status` 与 debug 日志 | 当前跳过完全静默，是本次排查最贵的成本 | 低（新增 optional 字段） |

### 3.3 不采纳的方案

- **不在 UI 侧限制 credits 轮询**：治标，且其他 UI 以后仍可能请求 options；根因在背景侧的新鲜度模型。
- **不把 HOME 从 `JOB_MARKETS` 里特殊处理**：HOME 需要真实的 jobs 刷新，特殊化会掩盖同类问题（任何被 UI 请求过 options 的市场都会中招）。

### 3.4 测试

1. `snapshot.test.ts`：options-only 更新后，市场 jobs / resetAt / skippedJobs 不变；`jobsUpdatedAt` 不变。
2. 新增 `auto-jobs.snapshot-freshness.test.ts`：连续 10 次 options 推送后，`marketsToRefresh()` 仍把该市场判为到期。
3. `job-market-sync` 集成测试：模拟 `V2_MARKET_CACHE(source:'options')`，断言不覆盖 cache 的 jobs。
4. 回归：现有 `auto-jobs.test.ts`（29 条）与 `job-market-sync.test.ts`（16 条）必须全绿。

### 3.5 验收

- 复现 B.log 场景（Overview 页常驻 + Auto Jobs 开）时，日志中每轮必须出现 4 个市场的 `Market refresh complete`（或明确的 4 条 skip reason）。
- 断网/推送失败时，HOME 仍保留上一份 jobs 与 reset。

---

## 4. P2 修复设计：完成屏障收敛与 UI 状态

### 4.1 目标

- 「可领取」是**正面证据**：它证明奖励尚未领取，因此必须能解除「完成未知」屏障。
- 释放不再依赖 `forceRefresh`；自动路径的每一次运行都能释放。
- 保守边界必须保留：legacy 记录、reset 身份不匹配、Job State 写入失败时仍然阻塞。
- 被拦住的任务在 UI 上是一个**可解释的状态**，而不是两个互相矛盾的 tag（本批暂缓）。

### 4.2 改动点

| # | 位置 | 状态 | 改动 | 理由 | 风险 |
|---|---|---|---|---|---|
| P2-1 | `auto-finish.ts` 两条路径（预取 484、主路径 651） | **已实现** | 去掉 `options.forceRefresh === true` 条件，每次 run 都在选择前调用 `releaseClaimableCompletionBarriers()` | 自动路径原本没有释放入口，用户也没有 force 入口；可领取行与「已完成」互斥 | 中：只对新鲜 `synced.jobs` 生效，`withCachedClaimOnly` 的缓存行不参与 |
| P2-2 | `auto-finish.ts:386-431` | **已实现** | 只释放 `unconfirmed === true` 的显式记录；reset 身份必须严格相等；Job State 写入失败时不清 Completion Sidecar 屏障；Job State 存在但非 unconfirmed 记录时跳过 | 保留 legacy/null-reset 的保守语义，避免「修复」成跨 reset 重复完成 | 低：新增分支均有测试 |
| P2-3 | `job-state-reconciler.ts:112-118`、`370-386` | **保留现状** | 15 分钟冷却 + 成功同步的第二条恢复路径不变 | 主路径已经能即时释放；Reconciler 作为兜底，不再需要改动 | 低 |
| P2-4 | `job-state-reconciler.ts:281-291` | **不采纳** | 不放宽 reset 为 `null` 的匹配 | 既有测试明确要求「null-reset unknown 跨 run 不迁移」；放宽会破坏 reset 隔离 | — |
| P2-5 | `auto-finish-finalize` / `auto-finish-retry.ts` | **已有** | unconfirmed 失败会走 `computeAutoFinishRetry` 的 10 分钟重试；释放后在同一次 run 内直接领取 | 不需要新增短重试机制 | 低 |
| P2-6 | `job-report.ts:195-201`、`JobMarketList.tsx:186-196` | **已实现** | 统一为 9 个规范状态（`pending/running/retry/claimable/done/failed/expired/skipped/unknown`）。`ready`、`ready to claim`、`claim pending` 合并为 `claimable`（成功色）；可领取时即使 `retry` 也以 `claimable` 为主标签；`failed + claimable` 保留双标签；`completed → done`，`invalid/unsupported → skipped` | 现状把「未知」和「可领取」并列，用户无法判断是插件坏了还是在处理中 | 低：纯 view-model，已补状态映射矩阵测试 |
| P2-7 | `handlers/auto-finish.ts:11-23` + 新 bridge/portal | **待办（可选）** | 显式「重试领取」动作 | 给用户确定性出口 | 低 |
| P2-8 | `auto-finish.ts` 预取/主路径 | **已实现** | 两处调用同时修改 | 双路径重复是这类修复最容易漏的地方 | 低 |

> 实现时的关键取舍：测试表明「legacy unknown 不 backfill」「null-reset 不迁移」「Job State 写失败时保留 Completion Store 屏障」是既有安全不变量，因此本批**没有**按原 P2-4 放宽 reset 匹配，也没有改写 legacy 记录。

### 4.3 不采纳的方案

- **不直接删除完成屏障**：`complete` 的幂等性在游戏侧没有保证，重复完成可能带来惩罚（`reputationPenalty`）。屏障必须保留，只改「释放条件」。
- **不在 UI 里隐藏 `unknown`**：那会把「未确认完成」伪装成正常状态，丢失可诊断性。

### 4.4 状态机（建议目标形态）

```text
                 complete 超时/传输失败
   idle ─────────────────────────────► completion-uncertain(barrier, unconfirmed=true)
     ▲                                        │
     │ 游戏行 completed                        │ 新鲜 jobs 观测 = taken+claimable
     └────────────────────────────────────────┤ 且 reset 身份严格相等
                                              ▼
                                        ready-to-claim ──► claiming ──► completed
                                              ▲
                                              └── 领取失败（可重试，带上限）
```

关键不变式：

1. `completion-uncertain` 不能被「行仍然存在」清除（现有行为，保留）。
2. `taken+claimable` 是唯一允许从 `completion-uncertain` 直接进入 `ready-to-claim` 的**非 completed** 证据。
3. 只有本扩展显式写入的 `unconfirmed === true` 记录可以被释放；legacy `unknown` 记录不 backfill、不迁移。
4. reset 身份必须严格相等（`null` 只与 `null` 匹配），跨 reset 不释放。
5. Job State 写入失败时保留 Completion Store 屏障；Job State 存在但非 unconfirmed 记录时跳过释放。

### 4.5 测试

1. `complete-unknown-retry-barrier.test.ts`：claimable + `unconfirmed` → 非 force 也会领取；legacy unknown 保持阻塞；null-reset 不迁移；Job State 写失败时 Completion Store 屏障保留；同一 jobId 在不同市场独立。
2. `auto-finish-lifecycle.test.ts`、`unknown-jobs.test.ts`、`complete-unknown-recovery.integration.test.ts` 回归通过。
3. `job-report.test.ts`：tag 矩阵（待 P2-6 落地后补）。
4. 新增「claim-pending 会安排短重试」调度测试（P2-6 之后）。

### 4.6 验收

- 构造「complete 超时但游戏已可领取」场景：下一次 Auto Finish run（或 10 分钟重试）内自动领取成功，不再永久停在 unknown。
- 构造「确实已完成但超时」场景：不产生重复完成，状态最终由 `completed` 观测收敛。
- legacy/null-reset 记录仍然阻塞，不出现跨 reset 的重复完成。

---

## 5. P3 修复设计：配装功率与选择

### 5.1 目标

- 解密/HACK 的「需求功率」不能被「当前功率」冒充。
- 输出功率与游戏一致（公式已用真实数据验证；floor 保持不变）。
- 需求不可知时，至少要按「严格大于当前值」规划，让优化器有机会换硬件。
- 「最优」在不可行时也必须是真实最大值，并给出缺口（shortfall）。
- 候选软件、目标匹配、排除原因全部可观测。

### 5.2 主修复（P3-A，必改）：解密需求功率

#### 现状

`src/application/auto-job/execution-service.ts:494-499` 在 `canDecrypt === false` 时把 `analysis.decryptPower` 直接当作 `requiredPower` 传给 `beforeDecrypt`，而该字段是**当前功率**（证据见 1.3）。结果是 `requiredPower = 当前值`，当前硬件永远「刚好可行」，`keptCurrentHardware` 恒为真。

#### 改动

| # | 位置 | 改动 | 理由 | 风险 |
|---|---|---|---|---|
| P3-A1 | `execution-service.ts:494-499` | `canDecrypt === false` 时传 `Math.max(1, Math.floor(decryptPower ?? 0) + 1)`；把原始 `decryptPower` 作为 `observedPower` 一并传给 hook/日志 | 当前值只是下界，真实需求严格大于它；+1 让当前方案变为不可行，优化器才会去比较更高的换装方案 | 低：只影响「当前不可解密」的分支，可一行回滚 |
| P3-A2 | `execution-service.ts:495-497` | `decryptPower === null` 时传 `1`（而不是 `undefined`/0） | 0 会让所有方案都 `feasible`，等于关闭优化；1 至少保证会选一个可解密的模块 | 低 |
| P3-A3 | `composition/automation.ts:198-238` | 日志区分 `observedDecryptPower` 与 `requiredPower`，并记录 `requirementSource: 'derived-from-current'` | 下次同类问题能一眼看出「需求是推算的，不是游戏给的」 | 低 |
| P3-A4 | `application/loadout/service.ts` trace | 计划日志增加 `rawPower`、`ratio`、`bottleneck` | 20 → 21 这类边界问题必须能看到浮点原值 | 低 |
| P3-A5 | `domains/loadout/optimizer.ts`、`application/loadout/service.ts`、`composition/automation.ts` | 新增 `maximize`：解密 hook 传 `maximize: true`，优化器优先选择最高功率，而不是「当前硬件刚好满足 requiredPower」。缓存 key 包含该标志 | 2026-11-24 复查：`observed=0` 时 `+1=1`，当前硬件（Lyapun 23）仍被视为可行，结果 `.xvct` 需求 >23 被跳过。实测同一库存 maximize 后选到 33（`I-Partner C16-10`） | 中：解密失败时会换硬件；成功后不再重复换装 |

**可选增强（建议同批）**：给 `LoadoutRequest` 增加 `maximize?: boolean`。当需求未知（解密）时同时传 `requiredPower = current + 1` 与 `maximize: true`；`isBetterPlan` 在 `maximize` 下先比功率再比当前硬件。理由：`+1` 能解决当前场景，但「需求未知」的语义应该显式表达，避免以后有人把 `+1` 当成真实需求。风险：多一个排序分支，需用现有 `loadout.test.ts` 覆盖。

#### 为什么不是别的改法

- **不改 `Math.floor`**：游戏 `resources.softwarePower` 已证明 floor 一致（36 = 36；20.697 → 20）。改成 round 会把不可行方案判成可行。
- **不直接把 `requiredPower` 设为极大值**：会让所有方案 `feasible=false`，优化器在 `requiredPower>0` 时直接返回 `INFEASIBLE`，连尝试都不做。
- **不对 HACK 直接 +1**：`serverDefenceRate` 是游戏明确给出的阈值，语义未验证；见 1.3 末尾。

### 5.3 诊断与自检（P3-B，强烈建议）

| # | 位置 | 改动 | 理由 |
|---|---|---|---|
| P3-B1 | `application/loadout/view.ts` / `contracts` | `LoadoutView` 增加 `diagnostics`：`{ droppedSoftware: [{id,name,reason}], targetCandidates, maxCatalogPower, shortfall }` | 「模块消失」必须可见；`loadout.json` 本次为空，但不代表以后不会发生 |
| P3-B2 | `application/loadout/raw-mapper.ts` | 解析失败保留原因（`unknown-spec-shape` / `unsupported-ability-type` / `bad-power`），而不是静默 `return []` | 同类问题的唯一证据来源 |
| P3-B3 | `calculator.ts` + `service.ts` trace | 输出 `rawPower`、`ratio`、`bottleneck`；与游戏 `resources.softwarePower` 对比，不一致时记录 `LOADOUT_POWER_MISMATCH` | 游戏已经给出 `ratio`/`computedPower`，这是零成本的公式自检 |
| P3-B4 | `loadout-mapper.ts` | 把 `resources.softwarePower` 解析出来（仅诊断，不参与决策） | 让日志能直接对照游戏计算，不用再抓 WS |

### 5.4 次要改动（按优先级）

| # | 位置 | 改动 | 理由 | 风险 |
|---|---|---|---|---|
| P3-1 | `optimizer.ts:174-213` | 不可行分支改为**先比功率**，再比当前硬件/切换成本（与 v1 `isBetterPlan` 对齐）；结果增加 `bestAvailablePower` 与 `shortfall` | 解密主因修复后，这条主要影响 HACK/确实不可行的场景：现状会低报真实最大值，让「20」这个结论不可信 | 中：不可行时可能推荐换硬件；建议只在「换硬件能提升功率」时采用，并在 UI 标明「仍不足」 |
| P3-2 | `calculator.ts:112` + 新 `power.ts` | 抽出单一 `evaluatePower()`，返回 `{ raw, rounded, mode, ratio, bottleneck }`；floor 保持不变 | 公式已验证，但散落实现仍会导致 UI/服务各算各的；集中后便于自检与 fixture | 中：必须用现有测试兜底 |
| P3-3 | `optimizer.ts:45-54`、`model.ts:87-92` | 目标匹配规范化 + 显式别名表；匹配失败返回 `NO_TARGET_SOFTWARE` 并列出尝试值 | HACK target 来自地图，模块 serverTypes 来自另一套词表；本次 `.xvct` 未触发，但 HACK 的 21 点可能与此有关 | 中：别名表需要真实数据；先做大小写/空白/连字符归一 |
| P3-4 | `raw-mapper.ts:49-64`、`loadout-mapper.ts:12-13` | 支持 `specs` 为「按能力分组的 map」形状；无法解析的软件保留并带 `parseWarning` | 本次账号未触发，但这是「最强模块消失」的唯一解释路径 | 中：保留但不可用的软件不能参与优化 |
| P3-5 | `service.ts:60-74` | 指纹加入 software `consuming` + `abilities`，以及 hardware 全部 specs | 同 id 定义变更会复用最多 60s 的旧计划 | 低 |
| P3-6 | `optimizer.ts:82,133` + 调用方 | 区分「无需求」与「未知需求」；未知时用 `maximize`，不要用 0 静默关闭优化 | 当前 0 会让所有方案 feasible | 低 |
| P3-7 | `service.ts:356-360`、`475-480` | **已裁定（2026-11-24）**：游戏允许多装，但多装会互相挤占资源、只有单软件才能满释放；产品决定「一次只装 1 个软件以获得最大性能」。保留「恰好 1 个」的校验语义，但要在 ADR 写明依据，并在因自动化卸下其它软件时留下 trace | 这是产品决策，不是缺陷 | 低：行为不变，只补文档与日志 |
| P3-8 | `service.ts:130` | `psuPower <= 0` 不再视为无限，改为「未知 → 保守顺序 + 告警」 | 缺 specs 时可能给出不安全的换装顺序 | 低 |
| P3-9 | `static-catalog.ts:9-23` + `catalog/` | 失败缓存可重试；补齐 H4 静态目录，让 Loadout 页能为「未拥有」软件选择目标 | 目标下拉当前只能列已拥有软件 | 低 |

### 5.5 不采纳的方案

- **直接 `Math.floor` → `Math.round`**：已被真实数据否定（游戏与 floor 一致）。这会把不可行方案判成可行，导致实际解密/入侵失败。
- **让 HACK 在功率不足时强行尝试**：只会把「确定失败」变成「随机失败 + 时长消耗」。
- **把 `requiredPower` 设为 `Number.MAX_SAFE_INTEGER` 以强制最大化**：会让所有方案不可行，优化器直接返回 `INFEASIBLE`，连尝试都不做。

### 5.6 测试

1. **解密需求推导**：`analysis = { canDecrypt: false, decryptPower: 20 }` → `beforeDecrypt` 收到 `requiredPower = 21`；当前方案 power 20 必须被判为不可行，并选择更高的换装方案。
2. **真实 fixture**：用 `loadout.json` 的 19 件硬件 + `C.log` 的硬件组合冻结 `Lyapun AA8` 对 `.xvct` 的 `rawPower`/`power`（20.697 → 20），以及最大可达功率（33）。
3. **公式对拍**：`5CRYPt0L 09` 的 `computing` 结果必须等于游戏 `resources.softwarePower` 的 36。
4. **`decryptPower = null`**：`requiredPower` 为 1，且会选择一个可解密模块。
5. **不可行场景**：所有方案 < required 时，`bestAvailablePower` 是真实最大值，`shortfall > 0`。
6. `optimizer` 属性测试：任意同一软件的候选硬件集合中，`best.power` 必须等于该软件可达最大功率（不可行时也成立）。
7. 回归 `loadout.test.ts`、`service.test.ts`（9 条）、`view.test.ts`、`decrypt-pipeline.integration.test.ts`（2 条）、`execution-service.test.ts`（67 条）。

### 5.7 验收

- 用 `C.log` 的 `.xvct` 场景复跑：首次分析 `canDecrypt=false, power=20` → 规划出 21+（本库存可达 33）→ 换装 → `canDecrypt=true`。
- 若真实需求高于可达最大值：日志给出 `bestAvailablePower` 与 `shortfall`，不再谎报 `feasible=true`。
- `Loadout plan selected` 日志能同时看到 `observedDecryptPower`、`requiredPower`、`rawPower`、`ratio`、`bottleneck`。

---

## 6. 静态目录与功率索引（新增设计）

### 6.1 直接回答：可行，但不要做「全组合数值表」

- 功率只依赖 6 个资源供给 + 软件消耗表；PSU 不影响功率，只影响能否启动（`calculator.ts:45-83`）。
- 组合规模：`|software| × |cpu| × |gpu| × |ram|`。以全目录约 200 × 30 × 30 × 30 计 ≈ 540 万个值，JSON 数十 MB；每次平衡性更新全部失效；而单次求值只需 6 次比较 + 一次线性插值。
- 结论：全组合表**买不到速度，只买到维护负担**。真正稳定可静态化的是「定义」（消耗表、功率区间、目标词表、硬件 specs），不是「某个组合的数值」。
- 玩家持有集合是动态的，以组合为键的表还要随账号变化重建，等于把动态状态固化进静态文件。

### 6.2 三层数据

| 层 | 内容 | 静态？ | 现有基础 |
|---|---|---|---|
| 定义层 | 硬件/软件定义（consuming、power 区间、serverTypes/fileTypes、specs） | 是（随游戏版本） | `contracts/catalog.ts`、`catalog/README.md`、`src/tools/catalog/cli.ts`（H4） |
| 派生层 | 每个 (software, ability) 的**功率阈值索引**、槽位 Pareto 前沿、目标别名表 | 可由定义层确定性生成 | 本设计新增 |
| 玩家层 | owned / equipped / 当前端点 | 否 | `InventorySnapshot` |

静态目录与运行时目录的合并已存在：`mergeCatalogs`，runtime 定义优先、static-only 补齐（`application/catalog/catalog.ts`）。静态目录**只提供定义**，不提供所有权；优化仍然只使用已拥有物品。

### 6.3 阈值索引：等价、紧凑、可缓存

对某个 (software, ability)：

- `Δ = pmax - pmin`；要达到整数功率 `p`，需要 `r ≥ (p - pmin) / Δ`（因为 `floor(pmin + r·Δ) ≥ p`）。
- 每个资源维度 `k` 的最小供给：`T_k(p) = min_k + r_p · (max_k - min_k)`；当 `max_k == min_k` 时退化为「只需 ≥ min_k」。
- 一条记录只有 6 个数；典型 `Δ ≤ 60`，所以每个 ability 至多 60 条。200 软件 × 3 ability × 60 × 6 ≈ 21.6 万个数，压缩后很小；更推荐**不落盘**，在拿到目录后用纯函数在内存里生成（毫秒级，可缓存到 `catalogVersion` 变化为止）。

查询：

- `maxPower(sw) = pmax`（比例上限）→ 先剪掉 `pmax < required` 的候选。
- `canReach(sw, p)`：存在一套已拥有 (cpu, gpu, ram) 同时满足全部 `T_k(p)`；PSU 单独检查 `psuPower ≥ cpuConsuming + gpuConsuming`。
- 槽位可做 Pareto 剪枝：CPU A 支配 B（freq≥、cores≥、consuming≤）；GPU/RAM 同理。剪枝后候选通常只剩个位数。

### 6.4 它能带来什么

1. **候选剪枝**：需求 21 时，全目录里绝大多数软件在第一轮就被 `pmax` 淘汰，不必进入四层循环。
2. **快速可行性判断**：`canSatisfy`/preflight 从「枚举 + 计算」变为「阈值 + 支配检查」，适合 MV3 频繁唤醒。
3. **可解释的缺口**：能直接回答「差哪个资源、差多少」，而不是只给一个 `INFEASIBLE`。
4. **目标下拉与「未拥有查看」**：依赖定义层（P3-9），让用户能看到「理论上能到 21 的是哪个模块」。
5. **只读优化**：静态目录可用于「如果我解锁 X 会怎样」的展示，但**绝不能**把未拥有物品用于实际 apply。

### 6.5 落地形态

| 产物 | 位置 | 说明 |
|---|---|---|
| `catalog/item-catalog.json` + manifest | `catalog/`（H4，已有 CLI） | 定义层；带 `catalogVersion`/`gameVersion`/checksum |
| 可选 `catalog/power-index.json` | 构建期生成 | 仅用于冷启动加速；运行时缺省不依赖它 |
| `domains/loadout/power-index.ts` | 纯函数 | `buildPowerIndex(catalog)`、`maxPowerFor`、`canReachWith` |
| `LoadoutView.diagnostics` | `application/loadout/view.ts` | 暴露 `catalogVersion`、`droppedSoftware`、`maxCatalogPower`、`shortfall` |

硬性 DoD：**索引结果与直接枚举必须逐条一致**（等价性测试），否则索引只是把错误加速。

### 6.6 风险与边界

| 风险 | 处理 |
|---|---|
| 公式仍有未覆盖的能力/道具形状 | 公式已用一份真实样例对齐（36 = 36；20.697 → 20），但样本只覆盖 DECRYPT；索引上线前用 P3-B3 的自检继续收集反例 |
| 游戏版本更新导致静态值过期 | 校验 `catalogVersion`/`gameVersion`/checksum；不匹配时降级为 runtime-only 并提示，禁止用旧值静默压低功率 |
| 采集前提（maxed account、数据来源） | 沿用 `catalog/README.md` 的流程；人工抽检至少一条真实功率 |
| 静态目录含未拥有物品 | 优化仍以 `ownedHardwareIds`/`ownedSoftwareIds` 过滤；静态项只用于展示与诊断 |
| 多软件 | 产品已裁定单软件（见 P3-7），索引按 `otherBase=0` 计算；若未来改变，索引需按 `max uplift` 重算并重新验证 |

### 6.7 结论

- 推荐路线：**定义层（H4）+ 内存阈值索引 + Pareto 剪枝**。
- 如果确实需要离线预生成，只生成「每个软件在各功率档位的最小供给向量」与「每槽位 Pareto 前沿」，不要生成 `|cpu|×|gpu|×|ram|` 的笛卡尔积。
- 这样既能满足「提前知道每个软件的数值」，又不会把扩展体积和维护成本绑定到组合数量上。

---

## 7. 结构优化（跨问题，建议分阶段）

### 7.1 S1 市场数据「来源分量」契约

- 新增 `MarketDataEvent = { marketId, component: 'jobs'|'options'|'lots', data, observedAt }`。
- 唯一的合并函数 `mergeMarketData(previous, event)`，纯函数、可属性测试。
- 不变式：
  1. `options`/`lots` 事件永不修改 `jobs` 与 `resetAt`。
  2. 只有 `jobs` 事件能推进 `jobsUpdatedAt`。
  3. 任何事件都不能把已知 `resetAt` 改成 `null`（只能由新的 jobs 事件显式提供或保持）。

### 7.2 S2 任务生命周期单一写者

- 现状：`JobStateReconciler`、`AutoFinishCoordinator`、`JobExecutionService` 都写 Job State / Completion Sidecar。
- 目标：定义 `JobLifecycleStore`（写）+ `JobLifecycleView`（读），所有状态转移只能通过 `transition(jobKey, evidence)`；Auto Finish 只读，不直接写。
- 收益：P2 的规则只实现一次；防止「两处都能清屏障」的竞态；便于审计。

### 7.3 S3 消除 Auto Finish 双路径

- `auto-finish.ts:469-611`（预取快路径）与 `621-923`（主路径）几乎重复。
- 抽出 `selectRunnable(jobs, context) -> { runnable, skipped, blocked }`，两个入口共用。
- 理由：P2 的规则如果只改一条路径，会留下「某个开关下行为不一致」的隐形 bug。

### 7.4 S4 调度器区分「数据新鲜」与「有活可干」

- `computeSchedule()` 现在把「所有市场已完成」与「下次 reset」混在一起，并可能落到 2 小时 fallback。
- 目标：`nextWakeAt = min(数据到期, 可领取待处理, retryAt, reset, 用户间隔)`；每个分支带 reason。
- 理由：P2 的 blocked-claimable 目前不会唤醒调度；P1 的星荒也源于「新鲜度」被误用。

### 7.5 S5 UI 标签由单一矩阵派生

- 新增 `jobTagView()`，输入 `{ job, lifecycle, report, retryAt }`，输出 `{ primary, secondary?, tone, title }`。
- 不变式：最多一个 `primary`；`claimable` 只有在「可以立刻执行领取」时才是 primary，否则作为 secondary + 原因。
- 理由：当前 tag 是分散的三处拼接（job-report、JobMarketList、statusClass），语义冲突无法从结构上避免。

### 7.6 S6 配装单一实现与诊断

- `evaluatePower()` 唯一入口；`LoadoutPlan.powerRaw` + `power`；`PlanDiagnostics` 进入 view。
- 「优化目标」写成 ADR：`requirement > feasibility > current-hardware > power > switchCost`，并明确不可行时的排序。

### 7.7 S7 可观测性与测试

- 统一 reason code：
  - `market-skip:snapshot-fresh-by-options` / `market-skip:not-due` / `market-skip:no-tab`
  - `job-blocked:completion-unknown` / `job-blocked:claim-pending`
  - `loadout-excluded:target-mismatch` / `loadout-excluded:spec-parse` / `loadout-excluded:not-owned`
- 每轮周期输出计数（可用于线上统计与回归断言）。
- 测试策略：
  - 合并函数：属性测试（partial 永不丢 jobs）。
  - 状态机：决策表全组合。
  - 功率：golden fixture。
  - UI：tag 矩阵快照。
  - 端到端：一条「HOME options 轮询 + Auto Jobs」集成测试。

---

## 8. 实施顺序与里程碑

| 阶段 | 内容 | 状态 | 风险 | 交付判据 |
|---|---|---|---|---|
| 0 | P3-A（解密需求 +1）、P3-B 诊断字段、P1-10、S7 reason code | **已完成** | 低 | C.log 场景：20 点方案被判不可行并换装；日志能回答「为什么跳过」（P3-B 仅完成日志部分，`LoadoutView.diagnostics` 待办） |
| 1 | P1-1…P1-9（来源分量 + 新鲜度 + 合并不变式） | **已完成（最小实现）** | 中 | 推送带 `source`，options/lots 不再更新 jobs 新鲜度；`merge` 保留 reset；无到期市场时输出 debug 选择日志 |
| 2 | P2-1…P2-8（屏障释放 + 短重试 + tag 矩阵） | **已完成（P2-7 可选待办）** | 中 | 非 force 路径即时释放 claimable 屏障；legacy/null-reset/写失败仍阻塞；UI 单一主标签 |
| 3 | P3-1…P3-6 + P3-8（排序、功率集中、目标匹配、候选可见性） | **部分完成** | 中 | P3-1（不可行真实最大值 + shortfall）、P3-2（rawPower/ratio/bottleneck）、P3-5（缓存指纹）已完成；P3-3/4/6/8 待办 |
| 4 | P3-7 文档化（单软件产品决策）、P3-9 静态目录定义层（H4） | **待办** | 中 | 目录可 validate，UI 可选未拥有目标 |
| 5 | 第 6 节功率阈值索引 + Pareto 剪枝（可选离线产物） | **待办** | 中 | 索引与直接枚举逐条等价 |
| 6 | S1–S7 结构收敛、文档/ADR 更新 | **部分完成** | 中 | 市场来源分量已落地；其余待办 |

建议 **P3-A 单独作为热修**先发（改动一行 + 测试，风险最低、用户可见收益最大）；1、2 合并为一个发布（它们互为前提）；3 单独发布并带诊断；4、5 只在公式对齐后再做，避免把错误结论加速。HACK 的 `serverDefenceRate` 语义需要一次真实服务器验证，暂不放进热修。

---

## 9. 需求与验收清单（DoD）

每个阶段都必须满足仓库既有 DoD：

- `npm run typecheck`
- `npm test`
- `npm run lint`
- `npm run build`
- 行为对齐检查（P1/P2/P3 各自的构造场景）
- 文档：`MODULES.md` / 相关 ADR 增补

本设计额外要求：

1. 新增/修改的每个行为都有对应测试，且测试名包含 reason code。
2. 任何「跳过/排除」路径都必须有日志或诊断字段（禁止静默）。
3. 新增持久化字段一律 optional，并能从旧快照恢复。
4. 不得引入 `chrome`/`window` 到 `domains` 或 `application`。

---

## 10. 待确认信息（阻塞 P3 定案）

1. **HACK 的 21 点样例**（仍未获得）：失败服务器类型名、`serverDefenceRate`、该时刻的装备快照、以及游戏内显示的功率。解密场景已经结案，但 HACK 是否同样「严格大于阈值」尚未验证。
2. **取整规则**：已用 `loadout.json` 的 `resources.softwarePower` 验证为 floor（`5CRYPt0L 09`：36 = 36；`Lyapun AA8`：20.697 → 20）。若以后遇到反例再更新。
3. **静态目录采集**：已提供导出工具（侧栏 Developer → Loadout dump，或 Chrome DevTools 面板同款按钮）。用户已提供 `loadout.json`（19 硬件 / 13 软件，无解析失败）。完整目录仍建议用满配账号导出一次。
4. **P2 现场**：用户 2026-11-24 反馈「今天一直很顺，暂未复现」。代码路径仍是确定性缺陷，修复不依赖复现；但验收时需要一次构造场景。

**已确认（2026-11-24）**

- **P3 解密主因**：`decryptPower` 是当前功率，不是需求；C.log 与 loadout.json 已闭环（见 1.3）。
- **多软件**：允许，但多装会互相挤占资源、单软件才能满释放；扩展默认一次只装 1 个以保证最大性能（P3-7）。
- **P1 现场**：用户会停留在 Overview，再切到自动化页；切走后 HOME 显示旧时间。与「options 轮询推动 `updatedAt`」的判断一致（见 1.1）。

---

## 11. 文档与 ADR 更新计划

| 文档 | 更新内容 |
|---|---|
| `MODULES.md` | 「Automation and loadout pipeline」补充市场数据来源分量、生命周期单一写者、功率单一实现、静态目录与阈值索引 |
| `docs/architecture/...decision-record.md` | 新增 ADR：市场数据 provenance 与新鲜度；新增 ADR：单软件产品决策与静态目录/功率索引；修订 D-007 的 PSU 版本漂移（`psu-policy.ts` 已是 v3） |
| `docs/architecture/...feature-inventory-and-tech-debt.md` | 关闭/更新 H3、H4、H5、H10、M11、M13、O-016 的状态；记录本次三个根因 |
| `catalog/README.md` | 增加「派生索引」说明：定义层是唯一真源，`power-index` 只是可选加速产物 |
| 本文档 | 实施后追加「实施记录」章节，保留判断依据与偏差 |

---

## 12. 附：本次审查顺带发现的疑似问题（不阻塞三问）

按「与三问的相关度」排序，建议至少排期到 P1/P2 之后：

1. **解密任务每次都走 `decrypt.file timed out`**（`auto.log` 7 次、`A.log` 8 次，`execution-service.ts:550-599`）。功能靠 `waitForClaimableJob` 兜底完成，但每个解密任务多等 30–60 秒；且日志显示 `config-hack solved=false` 仍被判为可完成，存在误判风险。
2. **`COMPLETE_FAILED: market-not-reachable`**（`A.log`、`auto.log`）：任务在非市场服务器结算，`complete` 前缺少回市场路由。
3. **端点竞态（H3）**：`job-market-sync.ts:316-324` 与 `handlers/market.ts:15-25` 绕过 `runBridgeExclusive`。
4. **快照写入乱序**：`auto-jobs.ts:277` 的 `void store.set()` 无写队列，旧快照可能后写覆盖新快照。
5. **UI 快照乱序**：`useJobs.ts:118-143` 缺少 request sequence 保护。
6. **Valuable 部分失败当成功**：`chrome-tab-valuable-action-adapter.ts:132-150`。
7. **Helper Mode 覆盖不全**：`job.take/complete/dismiss`、`market.options`、`loadout.equip*`。
8. **配装页不会自动刷新**：`useLoadout.ts:49-51` 只在挂载时加载；自动化改装备后 UI 陈旧。建议新增 `loadout.changed` 事件（与 S2 同一批）。
9. **静态目录缺失**（H4）：`catalog/item-catalog.json` 不存在，且 `static-catalog.ts` 永久缓存失败结果。
10. **`Date.now()` 直接调用**（L5）：`service.ts` 多处，不利于测试与时钟注入。

以上均只记录，不在本次设计范围内实施。

---

## 13. 实施记录（2026-11-24）

本轮按阶段 0–2 落地，所有检查通过：`typecheck`、`lint`、`build`、`vitest`（122 文件 / 1002 测试）。

### 13.1 已实施

| 类别 | 改动 | 文件 |
|---|---|---|
| P3-A | `canDecrypt === false` 时用 `floor(decryptPower) + 1` 作为规划下界；`null` → 1；trace 区分 `observedDecryptPower` / `requiredPower`；`Decrypt loadout ready` 记录 `requirementSource` | `application/auto-job/execution-service.ts`、`contexts/background/composition/automation.ts` |
| P3-A 测试 | 新增「当前 20 → 规划 21」用例；现有 68 条执行测试全绿 | `application/auto-job/execution-service.test.ts` |
| P1 | `V2_MARKET_CACHE_UPDATED` / `V2_MARKET_CACHE` 增加 `source`；只有 `jobs` 推送更新 Auto Jobs 快照与 `updatedAt`，options/lots 只更新 market cache | `infrastructure/game-ws/game-socket-hub.ts`、`contexts/content/index.ts`、`contracts/tab-commands.ts`、`contexts/background/messaging.ts`、`contexts/background/automation/auto-jobs.ts` |
| P1 合并保护 | `ok` 市场缺少 `resetAt` 时保留上一份值，避免把已知 reset 抹成 null | `application/auto-job/snapshot.ts` |
| P1 诊断 | 无市场需要刷新时输出每个市场的 `state` / `updatedAt` / `ageMs` | `contexts/background/automation/auto-jobs.ts` |
| P1 测试 | `options` 推送不更新 jobs/`updatedAt`；`jobs` 推送正常；reset 保留 | `contexts/background/automation/auto-jobs.test.ts`、`application/auto-job/snapshot.test.ts` |
| P2 | 去掉 `forceRefresh` 条件，每次 Auto Finish run 都对新鲜 claimable 行释放屏障 | `contexts/background/automation/auto-finish.ts` |
| P2 安全边界 | 只释放显式 `unconfirmed === true`；reset 身份严格相等；Job State 写失败/非 unconfirmed 记录时保留屏障；legacy 不 backfill | `contexts/background/automation/auto-finish.ts` |
| P2 测试 | 非 force 释放并领取；legacy 仍阻塞；null-reset 不迁移；写失败保留 Completion Store 屏障；跨市场独立 | `contexts/background/automation/complete-unknown-retry-barrier.test.ts` |

### 13.2 与设计稿的偏差

1. **P1 未引入 `jobsUpdatedAt` 新字段**：`source` 门控已保证 `updatedAt` 只由 jobs 观测推进，无需 storage schema 迁移。若后续出现其他写入路径，再补独立时间戳。
2. **P1-8（pending 请求 key）未改**：响应体不含可用的 `marketId`，改成 `action:marketId` 无法匹配；当前 UI 只轮询 HOME，并发概率低。列为后续观察项。
3. **P2-4（放宽 null-reset 匹配）不采纳**：既有测试明确要求 null-reset 记录跨 run 不迁移，放宽会破坏 reset 隔离。
4. **P2-3（Reconciler 冷却改短）未改**：主路径已即时释放，Reconciler 保留为第二道恢复。
5. **P3-B 只完成日志部分**：`LoadoutView.diagnostics`、mapper 丢弃原因、`resources.softwarePower` 对拍仍待办（阶段 3）。

### 13.3 仍待办

- P2-7：显式「重试领取」入口。
- P3-3/P3-4/P3-6/P3-8：目标匹配、候选解析诊断、未知需求语义、PSU 缺失保守顺序。
- P3-7/P3-9：单软件决策写入 ADR；静态目录定义层。
- 第 6 节阈值索引。
- HACK `serverDefenceRate` 的严格比较验证（需要真实服务器样例）。

### 13.4 第二批（2026-11-24，阶段 2–3 部分）

| 类别 | 改动 | 文件 |
|---|---|---|
| P2-6 | 新增 `jobTagView()`：unknown+claimable → 单一「等待领取」+ 原因 tooltip；failed+claimable → failed 主标签 + 可领取次标签；done 不显示可领取；无状态不显示 | `ui/app/view-models/job-report.ts`、`ui/components/JobMarketList.tsx`、`ui/i18n-messages.ts` |
| P3-1 | 不可行时先比功率（与 v1 对齐），结果增加 `bestAvailablePower` / `shortfall`；service 在 INFEASIBLE 时记录并在错误里携带 | `domains/loadout/optimizer.ts`、`application/loadout/service.ts` |
| P3-2 | `AbilityAnalysis.rawPower`、`LoadoutPlan.rawPower/ratio/bottleneck`；trace 输出未取整功率与瓶颈；`abilityPowerDetails()` 单一实现 | `domains/loadout/calculator.ts`、`domains/loadout/model.ts`、`domains/loadout/optimizer.ts`、`application/loadout/service.ts` |
| P3-5 | 运行时指纹包含软件 abilities/consuming 与硬件全部 specs | `application/loadout/service.ts` |
| 测试 | tag 矩阵 5 条、不可行真实最大值、rawPower/ratio/bottleneck、同 id 定义变更重算 | `job-report.test.ts`、`loadout.test.ts`、`service.test.ts` |
| 归档 | `loadout.json` 移至 `catalog/captures/loadout-2026-11-24.json`（JSON 已 gitignore，README 提交） | `.gitignore`、`catalog/captures/` |

检查：`typecheck` / `lint` / `build` / `vitest`（122 文件 / 1010 测试）全绿。

### 13.5 第三批（2026-11-24，`maximize` + 状态合并）

| 类别 | 改动 | 文件 |
|---|---|---|
| P3-A5 | 新增 `maximize` 请求标志；解密 hook 传 `maximize: true`；优化器在 maximize 下先比功率；缓存 key 纳入该标志 | `domains/loadout/optimizer.ts`、`application/loadout/service.ts`、`contexts/background/composition/automation.ts` |
| P2-6 收敛 | 新增 `JobDisplayStatus` 与 `normalizeJobStatus()`：`ready/ready to claim/claim pending → claimable`，`completed → done`，`invalid/unsupported → skipped`；`jobTagView` 返回 `claimable` 主标签并使用成功色；可领取时 `retry` 不再并列；`failed + claimable` 保留双标签 | `ui/app/view-models/job-report.ts`、`ui/components/JobMarketList.tsx` |
| 文案 | 新增 `claimable → 可领取`；移除未使用的 `claim pending` 文案，保留「上次完成结果未确认」tooltip | `ui/i18n-messages.ts` |
| 测试 | maximize 的 optimizer/service 用例；状态规范化与 tag 矩阵；`buildJobStatusById` 兜底改为 `claimable` | `loadout.test.ts`、`service.test.ts`、`job-report.test.ts` |
| 实机验证 | 生产代码 + `catalog/captures/loadout-2026-11-24.json`：`requiredPower=1` 时普通模式 23（8Pro），maximize 模式 33（I-Partner C16-10，switchCost 2） | — |

检查：`typecheck` / `lint` / `build` / `vitest`（122 文件 / 1013 测试）全绿。

### 13.6 第四批（2026-11-24，HOME 刷新诊断，构建 314）

| 类别 | 改动 | 文件 |
|---|---|---|
| 选择诊断 | 每个非手动周期输出 `Auto Jobs market selection`，包含每个市场的 `state / ageMs / due / forced / selected`；超过硬上限的市场额外输出 `Market forced after stale jobs window` | `contexts/background/automation/auto-jobs.ts` |
| 状态暴露 | `auto-jobs.status` 增加 `marketSelection` 与 `lastSkipReason`（schema 默认值兼容旧后台） | `contracts/auto-jobs.ts`、`application/popup/portal.ts`、`contexts/background/automation/auto-jobs.ts` |
| 旧脚本防护 | 只有 `source === 'jobs'` 才更新 jobs 新鲜度；缺失 `source` 的旧 content script 推送只暖缓存，并记录一次 `Market cache push without source` 警告 | `contexts/background/automation/auto-jobs.ts` |
| 陈旧兜底 | `ageMs >= max(2×TTL, min(interval, 10min))` 的市场在周期内强制选中（`forced`） | `contexts/background/automation/auto-jobs.ts` |
| UI 乱序 | `useJobs.loadAutoJobsSnapshot` 增加请求序号与 `snapshot.at` 单调保护 | `ui/app/hooks/useJobs.ts` |
| 测试 | 旧脚本无 `source` 不更新快照；watchdog 强制 HOME；`status.marketSelection` 完整性 | `contexts/background/automation/auto-jobs.test.ts` |

说明：watchdog 作用于「周期内选择」，不改变 `computeSchedule` 的 interval 语义；当所有市场 reset 都在未来时，仍然按 `autoJobsIntervalMinutes` 唤醒（默认 60 分钟）。313 的日志场景里其他市场处于 recovery、周期约 68 秒，因此 HOME 在 60 秒 TTL 后会被正常选中。

检查：`typecheck` / `lint` / `build` / `vitest`（122 文件 / 1016 测试）全绿；构建号 314。
