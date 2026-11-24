# COR3 Helper 2.0 — Salta 分支

[English](./README.md) · **简体中文**

这是一个用于 [cor3.gg](https://cor3.gg) 的 Chrome 扩展，可监控市场、任务、远征、日常任务、库存与配装，并提供可选自动化。

当前 `v2` 分支包含 **2.0 发布线**。它不是稳定的 v1 扩展。

> **个人分支：** [SaltApocalypse/cor3-helper](https://github.com/SaltApocalypse/cor3-helper)，基于 [Femtoce11/cor3-helper](https://github.com/Femtoce11/cor3-helper)。并非上游官方发布。
>
> - 本分支发布页：<https://github.com/SaltApocalypse/cor3-helper/releases>
> - 上游项目：<https://github.com/Femtoce11/cor3-helper>

## 当前状态

- 版本：发布版见 `package.json` 的 `version` + `cor3Fork.releaseLabel`；本地构建追加 `cor3Fork.build`
- 分支：`v2`
- 架构：分层、强类型的 2.0 重写（domain / application / infrastructure / contexts）
- 构建输出：`dist/`（Manifest V3）
- 验证状态：`2.0.9-salta.314` 下 typecheck、lint、Vitest（122 个文件 / 1016 个测试）和构建均通过；PR 会运行同样的 CI 检查
- 已知缺口：静态物品目录仍需真实模块转储，后台/内容/portal 与 UI 渲染测试仍不完整；见[功能清单与技术债](./docs/architecture/cor3-helper-2.0-feature-inventory-and-tech-debt.md)

## 环境要求

- Node.js 24+
- npm 11+
- Chrome 120+（Chromium；完整界面可在侧边栏或独立窗口中运行）

## 构建

```bash
npm install
npm run build       # -> dist/
```

加载扩展：

1. 打开 `chrome://extensions`
2. 开启 **开发者模式**
3. 点击 **加载已解压的扩展程序**，选择 `dist/` 目录
4. 打开 <https://cor3.gg>

压缩构建：

```bash
npm run build:min
```

## 发布

发布由 tag 驱动：修改 `package.json` 的 `version`，推送匹配的 tag，GitHub Actions 会自动构建并发布 `COR3 Helper v<version>-salta.zip`。

```bash
# package.json: "version": "2.1.0"
git add package.json
git commit -m "chore(release): v2.1.0-salta"
git tag v2.1.0-salta
git push origin v2
git push origin v2.1.0-salta
```

tag 必须等于 `<version>-<cor3Fork.releaseLabel>`。本地构建使用 `<version>-salta.<build>`；发布版使用 `<version>-salta`。两者共用 `COR3 Helper 2.0` 身份和扩展 key。

## 常用命令

| 命令 | 用途 |
|---|---|
| `npm run build` | 构建到 `dist/` |
| `npm run build:min` | 压缩构建 |
| `npm run typecheck` | 严格 TypeScript 检查 |
| `npm run lint` | 对 `src/` 运行 oxlint |
| `npm test` | 运行 Vitest 单元测试 |
| `npm run format` | 使用 Prettier 格式化源码 |
| `npm run clean` | 删除 `dist/` 与 `dist-tools/` |
| `npm run bump:build` | 功能性更新时递增 `cor3Fork.build` |
| `npm run catalog` | 构建/校验静态物品目录 CLI |

## 目录结构

```
src/
  kernel/          Result、ID、时钟等基础类型
  contracts/       Zod 边界 schema（bridge、storage、game、tab）
  domains/         纯领域模型与规则
  application/     用例与端口
  infrastructure/  Chrome、存储、WebSocket、日志适配器
  contexts/        background、content、main-world、popup、sidepanel、devtools
  ui/              Preact 组件、hooks、view models、i18n
  html/            Popup / 侧边栏 / DevTools HTML 与 CSS
  tools/           目录 CLI 与开发工具
build.js           esbuild 构建脚本
manifest.json      Manifest V3 源文件（构建时注入版本号）
```

`dist/` 为生成目录，已被 git 忽略。

## 文档入口

- [架构说明](./ARCHITECTURE.md)
- [模块状态](./MODULES.md)
- [架构决策记录](./docs/architecture/cor3-helper-2.0-architecture-decision-record.md)
- [架构审计](./docs/architecture/cor3-helper-2.0-architecture-audit.md)
- [功能清单与技术债](./docs/architecture/cor3-helper-2.0-feature-inventory-and-tech-debt.md)
- [H8 后台拆分设计](./docs/architecture/cor3-helper-2.0-h8-background-decomposition-design.md)
- [设置同步评估](./docs/architecture/cor3-helper-2.0-settings-sync-assessment.md)
- [静态物品目录生成](./catalog/README.md)
- [安全说明](./docs/security.md)

## 参与开发

请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 与 [AGENTS.md](./AGENTS.md)，其中包含模块边界、硬性规则和完成标准。

## 免责声明

本扩展与 cor3.gg、Fragmentary Order、Rant Gaming Studios 无任何关联、合作或背书关系。

自动化行为可能被游戏开发者检测到，并可能导致账号风险。启用功能前请确认其作用。作者不对使用后果承担责任。

## 许可证

见 [LICENSE](./LICENSE)。
