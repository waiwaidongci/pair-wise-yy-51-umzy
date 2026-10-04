// 纯逻辑验证：直接驱动 reducer（不经过 Angular），覆盖五条需求
import assert from 'node:assert'
import { initialState, routeReducer } from '../src/app/store/route.reducer.ts'
import * as A from '../src/app/store/route.actions.ts'
import type { RouteState } from '../src/app/store/route.reducer.ts'

const route1 = {
  id: 'HG-1', cargo: '甲醇', hazardClass: '3', trainCode: 'X1', origin: '兰', destination: '宁',
  tonnage: 1, wagonCount: 1, permit: 'P-001', permission: '有效' as const, score: 78, updatedAt: '',
  routeVersion: 3, inCountersign: false,
  segments: [
    { id: 'S-1', name: '甲', from: 'a', to: 'b', km: '10', speed: '限速 60', risks: [], level: '高' as const, status: '待复核' as const, coordinates: [[0, 0], [1, 1]] },
    { id: 'S-2', name: '乙', from: 'b', to: 'c', km: '20', speed: '限速 80', risks: [], level: '低' as const, status: '已确认' as const, coordinates: [[1, 1], [2, 2]] },
  ],
}

function load(): RouteState {
  const s = routeReducer(initialState, A.loadRoutesSuccess({ routes: [route1] }))
  return routeReducer(s, A.selectRoute({ id: 'HG-1' }))
}

function commentCount(s: RouteState, status: string) {
  return s.comments.filter((c) => c.routeId === 'HG-1' && c.status === status).length
}
function auditCount(s: RouteState, requestId: string) {
  return s.audit.filter((e) => e.requestId === requestId).length
}

// ---- 场景 0：旧意见无版本号，进入会签时先归到当前版本 ----
{
  let s = load()
  s = routeReducer(s, A.addComment({ comment: { id: 'C-OLD', routeId: 'HG-1', segmentId: 'S-1', role: '安全', author: '甲', content: '旧意见', status: '待确认' } }))
  assert.equal(s.comments.find((c) => c.id === 'C-OLD')!.routeVersion, undefined, '新增前：历史意见没有版本号')
  s = routeReducer(s, A.enterCountersign({ routeId: 'HG-1' }))
  assert.equal(s.routes[0]!.inCountersign, true)
  assert.equal(s.comments.find((c) => c.id === 'C-OLD')!.routeVersion, 3, '进入会签：旧意见归入当前 v3')
  assert.equal(s.comments.find((c) => c.id === 'C-OLD')!.status, '待确认')
  console.log('✔ 场景5：旧意见无路径版本 → 进入会签时归入当前版本')
}

// ---- 场景 1：会签后路径区段一改，已确认意见立即失效，按新版本重新确认 ----
{
  let s = load()
  s = routeReducer(s, A.enterCountersign({ routeId: 'HG-1' }))
  // 在 v3 上提交并确认接受两条意见
  s = routeReducer(s, A.addComment({ comment: { id: 'C-1', routeId: 'HG-1', segmentId: 'S-1', role: '安全', author: '甲', content: '意见1', status: '待确认', routeVersion: 3 } }))
  s = routeReducer(s, A.addComment({ comment: { id: 'C-2', routeId: 'HG-1', segmentId: 'S-2', role: '应急', author: '乙', content: '意见2', status: '待确认', routeVersion: 3 } }))
  s = routeReducer(s, A.resolveCommentRequested({ requestId: 'REQ-1', commentId: 'C-1', status: '已接受' }))
  s = routeReducer(s, A.resolveCommentSuccess({ requestId: 'REQ-1', commentId: 'C-1', status: '已接受' }))
  s = routeReducer(s, A.resolveCommentRequested({ requestId: 'REQ-1B', commentId: 'C-2', status: '已接受' }))
  s = routeReducer(s, A.resolveCommentSuccess({ requestId: 'REQ-1B', commentId: 'C-2', status: '已接受' }))
  assert.equal(s.comments.find((c) => c.id === 'C-1')!.routeVersion, 3)
  assert.equal(commentCount(s, '已接受'), 2, 'v3 上两条已接受')

  // 区段一改 → v4
  s = routeReducer(s, A.reviseRoute({ routeId: 'HG-1', reason: '限速收紧', segments: [{ ...route1.segments[0]!, speed: '限速 30' }, route1.segments[1]!] }))
  assert.equal(s.routes[0]!.routeVersion, 4)
  assert.equal(commentCount(s, '已接受'), 0, '原版本上的已确认意见全部失效')
  const c1 = s.comments.find((c) => c.id === 'C-1')!
  assert.equal(c1.status, '待确认')
  assert.equal(c1.invalidatedByVersion, 4)
  assert.ok(s.audit.some((e) => e.message.includes('已确认意见立即失效')), '审计记录失效事件')

  // 按 v4 重新确认
  s = routeReducer(s, A.resolveCommentRequested({ requestId: 'REQ-2', commentId: 'C-1', status: '已接受' }))
  s = routeReducer(s, A.resolveCommentSuccess({ requestId: 'REQ-2', commentId: 'C-1', status: '已接受' }))
  assert.equal(s.comments.find((c) => c.id === 'C-1')!.routeVersion, 4, '重新确认锚定 v4')
  assert.equal(s.comments.find((c) => c.id === 'C-1')!.invalidatedByVersion, undefined, '失效标记清除')

  // 许可一变同样作废
  s = routeReducer(s, A.reviseRoute({ routeId: 'HG-1', reason: '许可换发', permit: 'P-002' }))
  assert.equal(s.routes[0]!.routeVersion, 5)
  assert.equal(s.routes[0]!.permit, 'P-002')
  assert.equal(commentCount(s, '已接受'), 0, '许可变更同样使已确认意见失效')
  console.log('✔ 场景1：会签后区段/许可一改 → 版本递增、已确认意见立即失效、可按新版本重新确认')
}

// ---- 场景 1b：会签前的修订只升版本，不作废意见 ----
{
  let s = load()
  s = routeReducer(s, A.updateSegmentLevel({ routeId: 'HG-1', id: 'S-2', level: '中' }))
  assert.equal(s.routes[0]!.routeVersion, 4)
  assert.ok(!s.audit.some((e) => e.message.includes('意见立即失效')), '会签前修订不作废意见')
  console.log('✔ 场景1b：会签前修订只升版本、不作废意见')
}

// ---- 场景 2：锁定基线保留原路径版本和原意见 ----
{
  let s = load()
  s = routeReducer(s, A.enterCountersign({ routeId: 'HG-1' }))
  s = routeReducer(s, A.lockBaseline({ routeId: 'HG-1' }))
  assert.equal(s.baselines.length, 1)
  assert.equal(s.baselines[0]!.routeVersion, 3)
  assert.equal(s.baselines[0]!.permit, 'P-001')
  const snapshotCommentCount = s.baselines[0]!.comments.length
  // 锁定后再改路径、再失效意见
  s = routeReducer(s, A.reviseRoute({ routeId: 'HG-1', reason: '改', permit: 'P-009' }))
  const bl = s.baselines[0]!
  assert.equal(bl.routeVersion, 3, '基线仍是原 v3')
  assert.equal(bl.permit, 'P-001', '基线许可不变')
  assert.equal(bl.comments.length, snapshotCommentCount, '基线原意见快照不变')
  console.log('✔ 场景2：锁定基线只读保留原路径版本与原意见')
}

// ---- 场景 3：并发提交，先提交成为当前版本，后到逐区段指出冲突 ----
{
  let s = load()
  s = routeReducer(s, A.enterCountersign({ routeId: 'HG-1' }))
  const accepted = { outcome: 'accepted' as const, routeId: 'HG-1', windowName: '窗口A · 兰州值班台', version: 4, permit: 'P-001', segments: [{ ...route1.segments[0]!, speed: '限速 50' }, route1.segments[1]!] }
  s = routeReducer(s, A.routeVersionAccepted({ result: accepted }))
  assert.equal(s.routes[0]!.routeVersion, 4)
  assert.equal(s.routes[0]!.segments[0]!.speed, '限速 50')

  s = routeReducer(s, A.routeVersionConflict({
    conflict: {
      routeId: 'HG-1', windowName: '窗口B · 郑州值班台', baseVersion: 3, currentVersion: 4,
      segments: [{ segmentId: 'S-1', segmentName: '甲', current: '限速 50', incoming: '限速 40 · 里程调整' }],
    },
  }))
  assert.equal(s.conflicts.length, 1)
  assert.equal(s.conflicts[0]!.segments[0]!.segmentId, 'S-1', '冲突指出具体区段')
  assert.ok(s.audit.some((e) => e.category === '冲突' && e.message.includes('窗口B')), '审计记录冲突窗口')
  s = routeReducer(s, A.dismissConflict({ routeId: 'HG-1' }))
  assert.equal(s.conflicts.length, 0)
  console.log('✔ 场景3：先提交确立当前版本，后到内容留为冲突并指出差异区段')
}

// ---- 场景 4：保存失败 → 恢复待处理意见 → 重试不产生重复审计 ----
{
  let s = load()
  s = routeReducer(s, A.addComment({ comment: { id: 'C-F1', routeId: 'HG-1', segmentId: 'S-1', role: '安全', author: '甲', content: '意见', status: '待确认', routeVersion: 3 } }))
  const rid = 'REQ-FAIL-1'
  // 发起确认 → 保存失败（请求留在服务端）
  s = routeReducer(s, A.resolveCommentRequested({ requestId: rid, commentId: 'C-F1', status: '已接受' }))
  s = routeReducer(s, A.resolveCommentFailure({ requestId: rid, commentId: 'C-F1', error: '服务端暂不可用' }))
  assert.equal(s.saveError.includes('服务端暂不可用'), true)
  assert.equal(auditCount(s, rid), 0, '失败时没有审计落账')
  assert.equal(s.comments.find((c) => c.id === 'C-F1')!.pendingRequestId, rid)

  // 从服务端恢复
  s = routeReducer(s, A.restorePendingResolvesSuccess({
    pending: [{ requestId: rid, commentId: 'C-F1', routeId: 'HG-1', routeVersion: 3, status: '已接受', author: '甲', role: '安全' }],
  }))
  assert.equal(s.comments.find((c) => c.id === 'C-F1')!.pendingStatus, '已接受', '恢复出待处理结果')

  // 重试成功（同一 requestId）
  s = routeReducer(s, A.resolveCommentSuccess({ requestId: rid, commentId: 'C-F1', status: '已接受' }))
  assert.equal(auditCount(s, rid), 1)
  // 模拟服务端重放/再次回调（网络重试导致重复成功）
  s = routeReducer(s, A.resolveCommentSuccess({ requestId: rid, commentId: 'C-F1', status: '已接受' }))
  s = routeReducer(s, A.resolveCommentSuccess({ requestId: rid, commentId: 'C-F1', status: '已接受' }))
  assert.equal(auditCount(s, rid), 1, '同 requestId 重复成功只有一条审计')

  // 恢复时服务端若没有任何待处理，本地残留也被清掉
  let s2 = load()
  s2 = routeReducer(s2, A.addComment({ comment: { id: 'C-F2', routeId: 'HG-1', segmentId: 'S-2', role: '运营', author: '丙', content: '另一条', status: '待确认', routeVersion: 3 } }))
  const rid2 = 'REQ-ORPHAN'
  s2 = routeReducer(s2, A.resolveCommentRequested({ requestId: rid2, commentId: 'C-F2', status: '已退回' }))
  s2 = routeReducer(s2, A.restorePendingResolvesSuccess({ pending: [] }))
  assert.equal(s2.comments.find((c) => c.id === 'C-F2')!.pendingRequestId, undefined, '服务端无记录则清掉本地待处理标记')
  console.log('✔ 场景4：保存失败恢复待处理意见，重试（同一请求号）不产生重复审计')
}

console.log('\n全部场景通过 ✅')
