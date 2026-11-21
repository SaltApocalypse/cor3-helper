# Phase D0-1C-FIX-4B FINAL 执行报告：Unknown / Completion Lifecycle Closure

> 项目：COR3 Helper - SaltA fork  
> 分支：`v2-test`  
> 基线版本：`2.0.6-salta.309`  
> 基线 HEAD：`3ec7881`  
> 最终结论：**PASS WITH RELEASE GATE**（代码与自动化验收通过，Chrome 实机验证尚未执行，列为发布前阻塞项）  
> 本阶段未提交、未推送、未修改版本号

---

## 1. 最终结论

代码层面的 Unknown / Completion / Storage Health 生命周期收敛已完成：

- Completion fallback `'unknown'` 不再永久阻塞。
- 只有明确完成证据 + 成功写入 Completion Store 才解除 fallback。
- Reset 变化、prune、读取失败、partial 数据都不会清除 fallback。
- corrupt / unavailable 的 Completion Store 不会被写路径覆盖成空数据。
- Reconciler 只在完整健康读取时执行状态迁移。
- Projection / Barrier / Status 继续使用健康读取。
- 所有既有测试与新增生命周期测试通过。

唯一未完成项：真实 Chrome Storage 环境验证。当前环境没有 Chrome/Chromium 可执行文件，因此 FINAL-5 的浏览器实机场景列为 **release gate**，不能直接宣布发布封板。

---

## 2. 实际 branch / HEAD / version

```text
branch: v2-test
HEAD: 3ec7881
package version: 2.0.6
package cor3Fork.build: 308
dist/manifest.json version_name: 2.0.6-salta.309
```

- 未 reset、未 clean、未丢弃已有修改。
- 未提交、未推送。
- 未修改版本号。
- `git diff --check` 通过。

---

## 3. FINAL-1 审计发现

### 3.1 当前 fallback 数据结构

```ts
unconfirmedByMarket: {
    [marketKey]: {
        [jobId]: knownResetAt | 'unknown'
    }
}
```

- 已知 Reset 的 fallback 保存实际 `resetAt` 字符串。
- 无法确认 Reset 的 fallback 保存 `'unknown'`。
- 没有独立 `createdAt`、来源、状态枚举或 legacy 标记。
- 数据结构同时存在于 `MarketCompletedJobsState` 与 Completion Sidecar。

### 3.2 写入点

| 位置 | 行为 |
|---|---|
| `execution-service.ts` `rememberUnconfirmedCompletion()` | Complete 未确认且 Job State 写入失败时写 fallback |
| `auto-finish.ts` `markDirectUnconfirmed()` | Direct bridge Complete 未确认时写 fallback |
| `jobs.ts` handler | Direct Complete 失败或 completion 写入失败时调用 `markDirectUnconfirmed()` |
| `market-completed-jobs-store.ts` `markUnconfirmed()` | 实际持久化入口；按 `marketKey + jobId` 覆盖写入 |
| Reconciler / ExecutionService | 不直接写 fallback，只通过 `recordCompletion()` 解除 |

### 3.3 读取点

| 位置 | 行为 |
|---|---|
| `market-completed-jobs-store.ts` `getUnconfirmedState()` | 旧读取，兼容 UI / 测试 |
| `market-completed-jobs-store.ts` `getStateWithHealth()` | 健康读取，Barrier / Projection / Reconciler 使用 |
| `auto-finish.ts` `loadCompletionBarrier()` | 将 fallback 转成 exact / unknown barrier |
| `execution-service.ts` `completionBarrier()` | 当前任务 fallback 阻塞判断 |
| `unknown-jobs.ts` `projectUnknownJobs()` | 将 fallback 投影为 Unknown |
| `job-state-reconciler.ts` `readCompletionBarriers()` | Reconciliation 使用 fallback |
| `job-state-reconciler.ts` `bridgeCompletion()` | 完成确认前读取当前 completion |
| `job-market-sync.ts` / `auto-jobs-sync.ts` | 传递 Reconciliation 健康状态 |

### 3.4 删除 / 解除点

| 位置 | 行为 |
|---|---|
| `market-completed-jobs-store.ts` `withoutUnconfirmed()` | 唯一的自动解除点，由 `recordCompletion()` 调用 |
| `market-completed-jobs-store.ts` `clear()` | 显式清空全部 Completion Store，包括 fallback；只由用户 clear local state 触发 |
| `pruneMarketBeforeReset()` | **不删除 fallback**，只清理旧 completion records |
| `markUnconfirmed()` | 覆盖同一 `marketKey + jobId` 的旧 fallback |

### 3.5 永久阻塞根因

修复前存在两个叠加问题：

1. `withoutUnconfirmed()` 只在：

```ts
storedFallback === resetAt
```

时解除。`'unknown'` 永远不等于任何已知 Reset，因此不会被解除。

2. Reconciler 的 fallback 处理只接受：

```ts
barrierReset === resetAt
```

`'unknown'` 永远不匹配，Reconciler 永远不会尝试解决它。

结果：一旦产生 `'unknown'` fallback，即使市场明确显示任务 completed、Completion Store 成功写入，fallback 仍然永久存在，Barrier 永久阻塞。

### 3.6 其他风险

- `recordCompletion()` / `markUnconfirmed()` / `pruneMarketBeforeReset()` 修复前使用 legacy `read()`，corrupt Store 会被当作空 Store，再写入时可能覆盖 fallback。
- `auto-finish-finalize.ts` 修复前使用 `getState()`，corrupt Store 会被当作空 Store，可能继续执行 completion 写入。
- 同 `jobId` 不同 Market 已隔离。
- 同 Market 不同 Reset 的已知 fallback 已隔离。
- 身份不明的 `'unknown'` fallback 无法按 Reset 隔离；只能采用保守策略。
- Service Worker 重启后 fallback 会从持久化 Store 恢复；旧测试已覆盖。

### 3.7 状态转换图（修复前）

```text
Unknown detected
  execution-service.ts rememberUnconfirmedCompletion()
  auto-finish.ts markDirectUnconfirmed()
        |
        v
Fallback created
  market-completed-jobs-store.ts markUnconfirmed()
        |
        v
Persisted (known reset or 'unknown')
        |
        +--> Read unavailable / corrupt
        |       |
        |       v
        |   Prior code: legacy read() -> EMPTY -> possible overwrite
        |
        +--> Barrier
        |       auto-finish.ts loadCompletionBarrier()
        |       execution-service.ts completionBarrier()
        |       |
        |       v
        |   Blocks every matching market/job
        |
        +--> Reconciliation
                job-state-reconciler.ts bridgeCompletion()
                |
                +--> barrierReset !== resetAt
                        |
                        v
                    'unknown' skipped forever  <-- 永久阻塞根因
```

---

## 4. FINAL-2 最终状态契约

### 4.1 身份模型

保持现有最小身份模型：

```text
marketKey
jobId
resetAt
```

- 已知 Reset fallback 必须精确匹配 `resetAt` 才能解除。
- `'unknown'` fallback 没有可靠 Reset 身份，不允许猜测。
- 不允许仅凭出现新 Reset 就删除 `'unknown'` fallback。
- 不允许仅凭 UI 不显示就删除 fallback。

### 4.2 最终状态模型

| 状态 | 含义 |
|---|---|
| Unknown | Job State 或 Completion fallback 已知状态不确定 |
| Fallback Unknown | Completion Store 保存的额外安全保护 |
| Complete Confirmed | 有可信证据确认当前 market/job/reset 已完成 |
| Resolved | fallback 已通过可信 completion 确认解除 |
| Stale | 已知属于旧 Reset 的 fallback，不影响新 Reset |
| Unverifiable | 缺少 Reset 身份的 legacy fallback，只能保守处理 |

### 4.3 解除规则

1. 已知 Reset fallback：
   - 只有完成确认的 `resetAt` 与 fallback 完全一致时才解除。
   - 旧 Reset 完成不能解除新 Reset fallback。
2. `'unknown'` fallback：
   - 只有同一 `marketKey + jobId` 出现明确 completed 证据，并且 Completion Store 成功写入/已存在对应 completion 时才解除。
   - Reset 变化、prune、读取失败、partial 数据都不会解除。
   - 解除后不会重新投影。
3. 写入失败：
   - 不得报告解除成功。
   - fallback 必须保留。
4. corrupt / unavailable：
   - 写路径直接失败，不覆盖原数据。
5. manual clear：
   - `clear()` 仍是唯一的全量显式清理路径，只由用户 clear local state 触发。

### 4.4 Legacy 兼容规则

- 不修改 storage key。
- 不修改 schemaVersion。
- 不引入 migration。
- `'unknown'` 旧数据继续按 `'unknown'` 读取。
- 旧数据不会因为缺少新字段而失效。
- 无法确认身份的旧 fallback 不会被自动清理；只有明确 completion 证据才能解除。

### 4.5 数据一致性规则

- JobStateStore 负责 durable Unknown / 生命周期记录。
- CompletionStore 负责 Completion 记录与 fallback 安全信息。
- 写路径必须先健康读取；corrupt/unavailable 不允许写。
- `missing` 是唯一允许当作空 Store 的读取结果。
- Completion 写入成功后才允许解除 fallback。
- Job State 写入失败不会重新制造 fallback；Completion 记录仍作为权威完成证据。

### 4.6 需要修改的最小文件

- `market-completed-jobs-store.ts`
- `job-state-reconciler.ts`
- `auto-finish-finalize.ts`
- 对应测试

不修改 Storage key、schemaVersion、Sidecar 业务语义、ACK/retry、Reset 定义。

---

## 5. FINAL-3 生命周期实现

### 5.1 `withoutUnconfirmed()` 支持显式解除 legacy fallback

`src/infrastructure/storage/market-completed-jobs-store.ts`

```ts
const stored = markets?.[marketKey]?.[jobId];
if (stored === undefined || (stored !== resetAt && stored !== JOB_STATE_UNKNOWN_RESET)) return state;
```

效果：

- 已知 Reset fallback 仍只接受精确匹配。
- `'unknown'` fallback 只有在 `recordCompletion()` 成功确认同一 market/job 完成时才解除。
- 其他 Reset、prune、读取失败不会解除。

### 5.2 Reconciler 处理 identity-less fallback

`src/application/auto-job/job-state-reconciler.ts`

```ts
const matchesReset = barrierReset === resetAt || barrierReset === JOB_STATE_UNKNOWN_RESET;
```

只有 `observation === 'completed'` 时才调用 `bridgeCompletion()`。

效果：

- `'unknown'` fallback 不再被永久跳过。
- 只有当前 market/reset 的明确 completed 证据才能触发解除。
- 任务仍存在、available、taken、absent 等观察都不会解除 fallback。

### 5.3 `bridgeCompletion()` 幂等解除

`bridgeCompletion()` 不再在 `current === resetAt` 时直接返回 `already-recorded`，而是继续通过 `CompletionRecordWriter.record()`：

- 若 completion 已存在，`recordCompletion()` 返回 `already-recorded`，并同时执行 fallback 解除。
- 若 completion 写入失败，fallback 保留。
- 重复 Reconciliation 保持幂等。

### 5.4 写路径健康保护

`market-completed-jobs-store.ts` 新增：

```ts
private async readForWrite(): Promise<MarketCompletedJobsState>
```

- `ok` → 返回 state
- `missing` → 返回空 Store
- `corrupt` / `unavailable` → throw

已用于：

- `recordCompletion()`
- `markUnconfirmed()`
- `pruneMarketBeforeReset()`

效果：

- corrupt / unavailable Store 不会被 legacy `read()` 当作空 Store 后覆盖。
- fallback 不会因写路径误读而丢失。
- 写入失败时不会报告解除成功。

### 5.5 AutoFinish finalize 健康读取

`src/contexts/background/automation/auto-finish-finalize.ts`

- 优先 `getStateWithHealth()`。
- `ok` / `missing` 才继续写入。
- `corrupt` / `unavailable` 直接跳过 completion 写入并标记 `available: false`。

---

## 6. FINAL-4 集成变化

### Unknown Projection

- 继续使用 `listWithHealth()` / `getStateWithHealth()`。
- partial 保留成功来源的 Unknown。
- unavailable 不伪装空数据。
- fallback 解除后不再投影；未解除时继续保留。
- 未改变 Unknown / Ready / Done 优先级。

### Reconciler

- 只有完整健康读取允许状态迁移。
- partial / unavailable / corrupt 不执行危险清理。
- `'unknown'` fallback 只由明确 completed 证据解除。
- 旧 Reset 已知 fallback 不受新 Reset completion 影响。
- 重复执行幂等。
- 故障恢复后下一次完整读取可以重新 Reconciliation。

### AutoFinish

- `loadCompletionBarrier()` 继续读取 `getStateWithHealth()`。
- `restore()` / `loadCompletedByMarket()` 不把 corrupt/unavailable 当 loaded empty。
- `completionStateStatus` / `unknownStateStatus` 保持健康语义。
- 未改变 Reset 后刷新调度。

### ExecutionService / Manual Queue

- 当前 Job、全局 JobState、Completion Store 均使用健康读取。
- unresolved fallback 继续 blocked。
- fallback 安全解除后允许执行。
- `runtimeBarrierFailures` 行为未变。
- Manual Queue 不绕过 Barrier。

### JobMarketSync

- `reconciliationStatus` 继续传递。
- partial / unavailable 不会静默视为完整成功。
- 下一次完整同步会重新执行 Reconciliation。

### Popup Bridge

- 未进行 UI 视觉改造。
- `unknownStateStatus` / `completionStateStatus` / `reconciliationStatus` 契约保持兼容。
- 未新增不必要的状态枚举。

---

## 7. 修改文件清单

本 FINAL 阶段修改：

```text
src/infrastructure/storage/market-completed-jobs-store.ts
src/infrastructure/storage/market-completed-jobs-store.test.ts
src/application/auto-job/job-state-reconciler.ts
src/application/auto-job/job-state-reconciler.test.ts
src/application/auto-job/session-failure-barrier.test.ts
src/contexts/background/automation/unknown-jobs.test.ts
src/contexts/background/automation/auto-finish-finalize.ts
PHASE_D0-1C-FIX-4B_FINAL_REPORT.md
```

此前阶段的未提交修改全部保留，包括：

```text
B1 / B2
D0-1A / D0-1B / D0-1C
FIX-4B-1 / FIX-4B-2A / FIX-4B-2B / FIX-4B-2C
```

---

## 8. 数据兼容与迁移说明

- 未修改 Storage key。
- 未修改 schemaVersion。
- 未引入 migration。
- 未修改 Completion Sidecar 数据格式。
- `unconfirmedByMarket` 仍为 `Record<marketKey, Record<jobId, resetAt | 'unknown'>>`。
- 旧 `'unknown'` 数据可直接读取。
- 旧已知 Reset fallback 继续精确匹配。
- 无新增必填字段。
- 无历史数据批量迁移。

---

## 9. 测试矩阵

### 9.1 新增 Completion Fallback Lifecycle 测试

| 测试 | 场景 | 结果 |
|---|---|---|
| F01 | identity-less fallback 跨重启持久化、重复写入幂等 | PASS |
| F02 | Reset 变化 / prune 不解除 identity-less fallback | PASS |
| F03 | 明确 completion 后解除 identity-less fallback，重启后不恢复 | PASS |
| F04 | 旧 Reset completion 不解除不同 Reset fallback | PASS |
| F05 | Completion 写入失败时不报告解除，fallback 保留 | PASS |
| F06 | 不同 Market / 不同 Job 的 fallback 严格隔离 | PASS |
| F07 | Reconciler 通过明确 current-reset completed 解除 identity-less fallback | PASS |
| F08 | 任务仅仍存在时保留 identity-less fallback | PASS |
| F09 | Completion 写入失败时 Reconciler 保留 fallback | PASS |
| F10 | Completion 已存在时仍可解除 identity-less fallback | PASS |
| F11 | 旧已知 Reset fallback 不被新 Reset completion 解除 | PASS |
| F12 | fallback 解除后重复 Reconciliation 幂等 | PASS |
| F13 | unresolved fallback 阻断执行，安全解除后允许执行 | PASS |
| F14 | Projection 在解除前显示 fallback，解除后不再显示 | PASS |
| F15 | corrupt Completion Store 的写路径拒绝覆盖原数据 | PASS |

### 9.2 既有回归覆盖

- B1 / B2 测试全部通过。
- D0-1A / D0-1B / D0-1C 测试全部通过。
- FIX-4B-1 retention 测试全部通过。
- FIX-4B-2B health / barrier 测试全部通过。
- FIX-4B-2C projection / reconciler / sync / bridge 测试全部通过。
- Unknown / Ready / Done 优先级测试全部通过。
- Manual Queue / runtimeBarrierFailures 测试全部通过。

---

## 10. 完整自动化验证

| 验证 | 结果 | 详情 |
|---|---|---|
| `npm run typecheck` | PASS | `tsc --noEmit` |
| `npm run lint` | PASS | `oxlint src` |
| `npm test` | PASS | `117 files / 908 tests` |
| `npm run build` | PASS | `Built 2.0.6-salta.309 into dist` |
| `git diff --check` | PASS | 无 whitespace 错误 |

测试数量变化：

```text
FIX-4B-2C 后: 117 files / 893 tests
FINAL 后:     117 files / 908 tests
新增:          +15 tests
```

构建版本：

```text
package version: 2.0.6
package cor3Fork.build: 308
dist/manifest.json version_name: 2.0.6-salta.309
```

---

## 11. Chrome Runtime 验证结果

当前环境没有 Chrome / Chromium 可执行文件：

```text
no chrome binary
```

因此以下 Chrome Storage 实机场景 **未执行**，列为发布前阻塞项。

### 场景 A：正常启动

- 正常读取 JobState。
- 正常读取 Completion Store。
- Unknown 状态正确投影。
- Barrier 正常工作。

### 场景 B：JobState shard 损坏

- 在 Chrome Storage 中破坏一个 `v2.job.state.N` envelope。
- 验证 `listWithHealth()` 为 partial/unavailable。
- 验证成功 shard 数据仍可读取。
- 验证 Reconciler 不执行危险变更。
- 验证 Barrier 不 fail-open。

### 场景 C：Completion Store 损坏

- 破坏 `v2.auto-finish.completedJobs` 的 schema。
- 验证 `completionStateStatus` 为 unavailable。
- 验证 fallback 不被清理。
- 验证不会产生错误 Done。

### 场景 D：Storage API reject

- 通过扩展环境模拟 `chrome.storage` 读取 reject。
- 验证不会转换为空状态。
- 验证执行入口被阻断。

### 场景 E：Service Worker 重启

- 写入 Unknown / fallback。
- 重启 Service Worker。
- 重新读取状态。
- 确认 fallback 没有丢失或错误解除。

### 场景 F：Reset 隔离

- 创建旧 Reset fallback。
- 开始新 Reset。
- 确认旧 fallback 不影响新 Reset 执行判断。
- 确认旧数据不会被无证据清理。

### Release Gate

在真实 Chrome 环境完成上述 A–F 之前，不应宣布整个 FIX-4B 发布封板。

---

## 12. 未解决问题

1. Chrome Runtime 实机验证未执行。
2. `'unknown'` fallback 的解除依赖明确 completed 证据；如果任务永远不再出现在任何市场快照中，fallback 会继续保留（安全但可能长期存在）。
3. 已知 Reset 的旧 fallback 不会被新 Reset 清理，会作为 stale 数据保留；它不会阻塞新 Reset，但没有独立诊断 UI。
4. 没有新增 fallback 年龄、创建来源或人工恢复入口。

---

## 13. 剩余风险

1. **身份不明的 fallback 无法按 Reset 精确归属**
   - 当前策略是保守保留，只有明确完成证据才解除。
   - 不会误清理，但可能长期保留。
2. **Completion Store 与 JobStateStore 非原子**
   - Completion 写入成功后 Job State 写入仍可能失败。
   - 此时 Completion 记录已是权威完成证据，Job State 保持 pending；下次 Reconciliation 可继续修正。
3. **Chrome 底层 corruption/reject 行为未实机验证**
   - 单元测试使用 MemoryStorageArea、显式健康结果和 rejecting decorator。
   - 真实 Chrome 行为仍是发布前验证项。
4. **UI 未展示 `reconciliationStatus` / stale fallback 诊断**
   - 数据契约已具备，视觉展示未扩展。
5. **显式 clear local state 仍会清空 fallback**
   - 这是用户主动操作，不属于自动清理；未改变既有语义。

---

## 14. Git 状态

```text
branch: v2-test
HEAD: 3ec7881
```

确认：

- 没有意外 commit。
- 没有意外 push。
- 没有 reset / clean。
- 没有丢失此前未提交修改。
- 没有修改版本号。
- 所有预期修改都在当前工作区。
- `git diff --check` 通过。

---

## 15. 是否建议封板

**PASS WITH RELEASE GATE**

代码、自动化测试、构建与静态检查均通过，Unknown / Completion Lifecycle 的核心安全问题已收敛。

但在真实 Chrome Storage 环境完成场景 A–F 验证之前，不建议直接宣布整个 FIX-4B 发布封板。Chrome Runtime 验证是唯一的发布前阻塞项。
