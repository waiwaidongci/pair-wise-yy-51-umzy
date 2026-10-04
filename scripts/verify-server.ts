import assert from 'node:assert'
import { CountersignApiService } from '../src/app/services/countersign-api.service.ts'
import type { RiskSegment, RoutePackage } from '../src/app/types.ts'

const seg = (id: string, speed: string, km = '100'): RiskSegment => ({
  id, name: id, from: 'a', to: 'b', km, speed, risks: [], level: '高', status: '待复核', coordinates: [],
})
const route: RoutePackage = {
  id: 'HG-X', cargo: 'x', hazardClass: '3', trainCode: 'X1', origin: 'a', destination: 'b',
  tonnage: 1, wagonCount: 1, permit: 'P', permission: '有效', score: 1, updatedAt: '',
  routeVersion: 1, inCountersign: true, segments: [seg('S-1', '限速 60'), seg('S-2', '限速 80', '200')],
}

const api = new CountersignApiService()

// 并发：两个窗口都基于 v1，但区段内容不同 → A 接受、B 冲突，且冲突精确指出区段
const winA = { windowName: 'A', baseVersion: 1, permit: 'P', segments: [seg('S-1', '限速 50'), seg('S-2', '限速 80', '200')] }
const winB = { windowName: 'B', baseVersion: 1, permit: 'P', segments: [seg('S-1', '限速 40', '105'), seg('S-2', '限速 80', '200')] }
const [rA, rB] = await Promise.all([
  api.submitRouteVersion('HG-X', route, winA),
  api.submitRouteVersion('HG-X', route, winB),
])
assert.equal(rA.outcome, 'accepted', '先提交窗口被接受')
if (rA.outcome !== 'accepted') throw new Error('unreachable')
assert.equal(rA.version, 2)
assert.equal(rB.outcome, 'conflict', '后到窗口冲突')
if (rB.outcome === 'conflict') {
  assert.equal(rB.currentVersion, 2)
  assert.deepEqual(rB.segments.map((s) => s.segmentId), ['S-1'], '仅 S-1 不同')
  assert.ok(rB.segments[0]!.current.includes('限速 50'))
  assert.ok(rB.segments[0]!.incoming.includes('限速 40'))
}
console.log('✔ 服务端：双窗口同时提交，先到成为 v2，后到逐区段指出差异')

// 幂等：同窗口名重放不重复升版
const rAReplay = await api.submitRouteVersion('HG-X', route, winA)
assert.equal(rAReplay.outcome, 'accepted')
if (rAReplay.outcome === 'accepted') assert.equal(rAReplay.version, 2, '重放不产生新版本')
console.log('✔ 服务端：同窗口提交重放幂等，不重复升版')

// 确认保存：正常 → 重复请求 → 离线拒绝 → 恢复待处理 → 重新上线重试
const req = { requestId: 'REQ-9', commentId: 'C-9', routeId: 'HG-X', routeVersion: 2, status: '已接受' as const, author: '甲', role: '安全' }
await api.resolveComment(req)
await api.resolveComment(req) // 重放
assert.equal((await api.fetchPendingResolves('HG-X')).length, 0, '成功后服务端无待处理')
console.log('✔ 服务端：确认保存幂等，重复 requestId 不重复落账')

api.saveOffline.set(true)
await api.resolveComment({ ...req, requestId: 'REQ-10', commentId: 'C-10' }).then(
  () => { throw new Error('离线时应拒绝') },
  () => undefined,
)
// 失败后由 effects 侧 stash（模拟），再恢复
api.stashPendingResolve({ ...req, requestId: 'REQ-10', commentId: 'C-10' })
const pending = await api.fetchPendingResolves('HG-X')
assert.deepEqual(pending.map((p) => p.requestId), ['REQ-10'], '恢复出待处理确认')
api.saveOffline.set(false)
await api.resolveComment(pending[0]!)
assert.equal((await api.fetchPendingResolves('HG-X')).length, 0, '重试成功后待处理清除')
console.log('✔ 服务端：离线保存失败 → 恢复待处理 → 上线后同一 requestId 重试成功')

console.log('\n服务端场景全部通过 ✅')
