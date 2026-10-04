# 铁路危险货物运输路径审批与风险复核平台

源提示词编号：8。包含危险货物运输单编组、候选路径生成、MapLibre 路网风险叠加、Turf 里程测算、安全/运营/应急逐区段会签、替代方案与审计基线。

## 多站段会签的版本控制规则

- **路径版本化**：每条运输单带 `routeVersion`，区段或许可每修订一次递增。
- **会签后变更即失效**：进入多站段会签后，路径区段或许可一旦修改，原版本上的「已接受」意见立即退回待确认（`invalidatedByVersion`），须按新版本重新确认；会签前的修订只升版本、不作废意见。
- **审批基线**：锁定基线时对原路径版本、许可与原意见做只读快照，之后升版/失效不改变基线。
- **并发提交**：两个窗口同时提交同一运输单时，服务端先到先得：先提交的区段成为当前版本，后到提交与当前版本逐区段比对，冲突清单精确指出哪个区段、哪个字段不同。
- **失败恢复与审计幂等**：确认保存按 `requestId` 幂等；保存失败后可从服务端恢复待处理确认，重试沿用同一请求号（和原结果），审计时间线按请求号去重，不会出现重复记录。
- **旧意见归版**：没有路径版本号的历史意见，在运输单进入会签时先归入当前版本。

核心纯逻辑在 `src/app/store/route.reducer.ts`，服务端裁决（冲突/幂等/失败恢复）由内存版 `src/app/services/countersign-api.service.ts` 模拟，HTTP 编排见 `src/app/store/route.effects.ts`。

## 验证

```bash
npm run build
node_modules/.bin/esbuild scripts/verify-logic.ts  --bundle --platform=node --format=esm --outfile=/tmp/verify.mjs       --alias:@ngrx/store=scripts/stubs/ngrx-store-stub.mjs && node /tmp/verify.mjs
node_modules/.bin/esbuild scripts/verify-server.ts --bundle --platform=node --format=esm --outfile=/tmp/verify-server.mjs && node /tmp/verify-server.mjs
```

## 技术栈

Angular、Angular Material、NgRx、Angular Router、HttpClient、RxJS、MapLibre GL、Turf.js、TypeScript。

## 运行

```bash
npm install
npm run dev
```

开发地址：http://localhost:62051

```bash
npm run build
```
