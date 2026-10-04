import { createReducer, on } from '@ngrx/store'
import type { AuditRecord, BaselineSnapshot, ReviewComment, RiskSegment, RouteConflict, RoutePackage } from '../types'
import * as RouteActions from './route.actions'

export interface RouteState {
  routes: RoutePackage[]
  selectedRouteId: string
  selectedSegmentId: string
  comments: ReviewComment[]
  loading: boolean
  error: string
  version: number
  /** 锁定的审批基线，按运输单保存原路径版本与原意见快照 */
  baselines: Record<string, BaselineSnapshot>
  /** 并发提交冲突记录 */
  conflicts: RouteConflict[]
  /** 待服务端保存的意见（发件箱），保存失败后据此恢复重试 */
  pendingComments: { comment: ReviewComment; idempotencyKey: string; attempts: number; lastError: string; status: '待保存' | '保存失败' }[]
  /** 审计时间线，只追加，幂等键去重 */
  auditRecords: AuditRecord[]
}

const now = () => {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const IDEM_PREFIX = 'IDEM-'
export const idempotencyKeyFor = (commentId: string) => `${IDEM_PREFIX}${commentId}`

const defaultPathVersion = (route: RoutePackage): RoutePackage => ({
  ...route,
  pathVersion: route.pathVersion ?? 1,
  countersign: route.countersign ?? false,
  baselineLocked: route.baselineLocked ?? false,
})

/** 按区段归属找运输单 */
const findRouteBySegment = (routes: RoutePackage[], segmentId: string): RoutePackage | undefined =>
  routes.find((route) => route.segments.some((segment) => segment.id === segmentId))

/** 两个路径版本的区段差异：逐区段比对字段，指出哪个区段不同 */
const diffSegments = (winner: RiskSegment[], loser: RiskSegment[]): RouteConflict['differingSegments'] => {
  const labels: Record<string, string> = { name: '名称', from: '起点', to: '终点', km: '里程', speed: '限速', risks: '风险项', level: '风险等级', status: '状态' }
  const fields: (keyof RiskSegment)[] = ['name', 'from', 'to', 'km', 'speed', 'risks', 'level', 'status']
  const diffs: RouteConflict['differingSegments'] = []
  for (const loserSeg of loser) {
    const winnerSeg = winner.find((seg) => seg.id === loserSeg.id)
    if (!winnerSeg) {
      diffs.push({ segmentId: loserSeg.id, segmentName: loserSeg.name, changes: [{ field: 'missing', label: '区段', from: '当前版本无此区段', to: loserSeg.name }] })
      continue
    }
    const changes: { field: string; label: string; from: string; to: string }[] = []
    for (const field of fields) {
      const fromVal = Array.isArray(winnerSeg[field]) ? (winnerSeg[field] as string[]).join('、') : String(winnerSeg[field])
      const toVal = Array.isArray(loserSeg[field]) ? (loserSeg[field] as string[]).join('、') : String(loserSeg[field])
      if (fromVal !== toVal) changes.push({ field, label: labels[field], from: fromVal, to: toVal })
    }
    if (changes.length) diffs.push({ segmentId: loserSeg.id, segmentName: loserSeg.name, changes })
  }
  for (const winnerSeg of winner) {
    if (!loser.some((seg) => seg.id === winnerSeg.id)) diffs.push({ segmentId: winnerSeg.id, segmentName: winnerSeg.name, changes: [{ field: 'added', label: '区段', from: winnerSeg.name, to: '提交版本无此区段' }] })
  }
  return diffs
}

/** 会签中路径变更后，已确认意见立即失效（保留原路径版本，不覆盖原记录） */
const invalidateConfirmedComments = (comments: ReviewComment[], route: RoutePackage): ReviewComment[] =>
  comments.map((comment) => {
    const belongs = route.segments.some((segment) => segment.id === comment.segmentId)
    if (belongs && (comment.status === '已接受' || comment.status === '已退回')) {
      return { ...comment, status: '已失效' as const }
    }
    return comment
  })

/** 旧意见迁移：没有路径版本的意见先归到当前版本 */
const migrateCommentsToCurrent = (comments: ReviewComment[], routes: RoutePackage[]): ReviewComment[] =>
  comments.map((comment) => {
    if (comment.pathVersion != null) return comment
    const route = findRouteBySegment(routes, comment.segmentId)
    return { ...comment, pathVersion: route?.pathVersion ?? 1 }
  })

const audit = (records: AuditRecord[], record: AuditRecord): AuditRecord[] =>
  records.some((item) => item.idempotencyKey && item.idempotencyKey === record.idempotencyKey) ? records : [record, ...records]

export const initialState: RouteState = {
  routes: [], selectedRouteId: '', selectedSegmentId: '', loading: false, error: '', version: 6,
  comments: [
    { id: 'RV-31', segmentId: 'S-203', role: '安全', author: '韩洁', content: '水源地保护段限速 45 km/h，并要求随车配置吸附围油栏。', status: '待确认' },
    { id: 'RV-32', segmentId: 'S-207', role: '应急', author: '罗晋', content: '长隧道出口需增加 15 分钟现场监护窗口，接受后方可放行。', status: '已接受' },
  ],
  baselines: {},
  conflicts: [],
  pendingComments: [],
  auditRecords: [
    { id: 'AUD-1', time: '16:42', actor: '韩洁', action: '新增 S-203 限速与吸附物资要求', detail: '安全专业 · 修改前记录保留' },
    { id: 'AUD-2', time: '16:18', actor: '罗晋', action: '接受隧道出口监护条件', detail: '应急专业 · 审批意见已签章' },
    { id: 'AUD-3', time: '15:50', actor: '系统', action: '生成替代路径 R-ALT-02', detail: '规则引擎 · 风险分由 78 降至 71' },
  ],
}

export const routeReducer = createReducer(
  initialState,
  on(RouteActions.loadRoutes, (state) => ({ ...state, loading: true, error: '' })),
  on(RouteActions.loadRoutesSuccess, (state, { routes }) => {
    const normalized = routes.map(defaultPathVersion)
    return {
      ...state,
      loading: false,
      routes: normalized,
      comments: migrateCommentsToCurrent(state.comments, normalized),
      selectedRouteId: state.selectedRouteId || normalized[0]?.id || '',
      selectedSegmentId: state.selectedSegmentId || normalized[0]?.segments[0]?.id || '',
    }
  }),
  on(RouteActions.loadRoutesFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(RouteActions.selectRoute, (state, { id }) => ({ ...state, selectedRouteId: id, selectedSegmentId: state.routes.find((route) => route.id === id)?.segments[0]?.id ?? '' })),
  on(RouteActions.selectSegment, (state, { id }) => ({ ...state, selectedSegmentId: id })),

  on(RouteActions.addComment, (state, { comment }) => ({ ...state, comments: [comment, ...state.comments] })),
  on(RouteActions.resolveComment, (state, { id, status }) => {
    const comment = state.comments.find((item) => item.id === id)
    if (!comment) return state
    const route = findRouteBySegment(state.routes, comment.segmentId)
    const pathVersion = route?.pathVersion ?? comment.pathVersion ?? 1
    const idempotencyKey = `RS-${id}-v${pathVersion}-${status}`
    return {
      ...state,
      comments: state.comments.map((item) => item.id === id ? { ...item, status, pathVersion, confirmedAt: now() } : item),
      auditRecords: audit(state.auditRecords, { id: `AUD-${Date.now()}`, idempotencyKey, time: now(), actor: comment.author, action: `${status}意见 ${id}`, detail: `锚定路径版本 v${pathVersion}`, routeId: route?.id }),
    }
  }),

  on(RouteActions.enterCountersign, (state, { routeId }) => ({
    ...state,
    routes: state.routes.map((route) => route.id === routeId ? { ...route, countersign: true } : route),
    auditRecords: audit(state.auditRecords, { id: `AUD-${Date.now()}`, time: now(), actor: '当前审阅人', action: '进入多站段会签', detail: '安全 · 运营 · 应急逐区段会签', routeId }),
  })),

  on(RouteActions.lockBaseline, (state, { routeId }) => {
    const route = state.routes.find((item) => item.id === routeId)
    if (!route) return state
    const snapshot: BaselineSnapshot = {
      routeId,
      pathVersion: route.pathVersion,
      permit: route.permit,
      lockedAt: now(),
      segmentIds: route.segments.map((segment) => segment.id),
      segmentCount: route.segments.length,
      comments: state.comments.filter((comment) => route.segments.some((segment) => segment.id === comment.segmentId)).map((comment) => ({ ...comment })),
    }
    return {
      ...state,
      baselines: { ...state.baselines, [routeId]: snapshot },
      routes: state.routes.map((item) => item.id === routeId ? { ...item, baselineLocked: true } : item),
      auditRecords: audit(state.auditRecords, { id: `AUD-${Date.now()}`, time: now(), actor: '当前审阅人', action: `锁定审批基线 v${route.pathVersion}`, detail: '原路径版本与原意见只读保存', routeId }),
    }
  }),

  on(RouteActions.updateRouteContent, (state, { routeId, segments, permit, reason }) => {
    const target = state.routes.find((route) => route.id === routeId)
    if (!target) return state
    const updated: RoutePackage = {
      ...target,
      segments: segments ?? target.segments,
      permit: permit ?? target.permit,
      pathVersion: target.pathVersion + 1,
      updatedAt: now(),
    }
    const invalidated = target.countersign ? invalidateConfirmedComments(state.comments, updated) : state.comments
    return {
      ...state,
      version: state.version + 1,
      routes: state.routes.map((route) => route.id === routeId ? updated : route),
      comments: invalidated,
      auditRecords: audit(state.auditRecords, {
        id: `AUD-${Date.now()}`,
        time: now(),
        actor: '当前审阅人',
        action: target.countersign ? `路径变更，已确认意见失效（v${target.pathVersion}→v${updated.pathVersion}）` : `路径版本更新（v${target.pathVersion}→v${updated.pathVersion}）`,
        detail: reason,
        routeId,
      }),
    }
  }),

  on(RouteActions.submitRouteVersion, (state, { routeId, baseVersion, segments, permit, window }) => {
    const target = state.routes.find((route) => route.id === routeId)
    if (!target) return state
    // 后到的提交：所依据版本已落后于当前版本 → 留成冲突，指出不同区段
    if (baseVersion < target.pathVersion) {
      const differingSegments = diffSegments(target.segments, segments)
      const conflict: RouteConflict = {
        id: `CF-${Date.now()}`,
        routeId,
        winnerVersion: target.pathVersion,
        loserVersion: baseVersion,
        window,
        differingSegments,
        detectedAt: now(),
      }
      return {
        ...state,
        version: state.version + 1,
        conflicts: [conflict, ...state.conflicts],
        auditRecords: audit(state.auditRecords, {
          id: `AUD-${Date.now()}`,
          time: now(),
          actor: `窗口 ${window}`,
          action: `并发提交冲突：窗口 ${window} 版本落后`,
          detail: `当前 v${target.pathVersion} 先提交生效，${differingSegments.length} 个区段不同`,
          routeId,
        }),
      }
    }
    // 先提交（或更新）的路径版本成为当前版本
    const updated: RoutePackage = {
      ...target,
      segments,
      permit,
      pathVersion: baseVersion > target.pathVersion ? baseVersion : target.pathVersion + 1,
      updatedAt: now(),
    }
    const invalidated = target.countersign ? invalidateConfirmedComments(state.comments, updated) : state.comments
    return {
      ...state,
      version: state.version + 1,
      routes: state.routes.map((route) => route.id === routeId ? updated : route),
      comments: invalidated,
      auditRecords: audit(state.auditRecords, {
        id: `AUD-${Date.now()}`,
        time: now(),
        actor: `窗口 ${window}`,
        action: `路径版本生效 v${updated.pathVersion}`,
        detail: `窗口 ${window} 先提交，成为当前版本`,
        routeId,
      }),
    }
  }),

  on(RouteActions.saveComment, (state, { comment }) => {
    const idempotencyKey = idempotencyKeyFor(comment.id)
    const pending = state.pendingComments.some((item) => item.idempotencyKey === idempotencyKey)
      ? state.pendingComments.map((item) => item.idempotencyKey === idempotencyKey ? { ...item, comment: { ...comment, idempotencyKey }, status: '待保存' as const } : item)
      : [...state.pendingComments, { comment: { ...comment, idempotencyKey }, idempotencyKey, attempts: 0, lastError: '', status: '待保存' as const }]
    return { ...state, pendingComments: pending }
  }),
  on(RouteActions.saveCommentSuccess, (state, { comment, audit: auditRecord }) => {
    const idempotencyKey = comment.idempotencyKey ?? idempotencyKeyFor(comment.id)
    const route = findRouteBySegment(state.routes, comment.segmentId)
    const exists = state.comments.some((item) => item.id === comment.id)
    const saved: ReviewComment = { ...comment, status: '待确认', pathVersion: route?.pathVersion ?? comment.pathVersion ?? 1, idempotencyKey }
    return {
      ...state,
      pendingComments: state.pendingComments.filter((item) => item.idempotencyKey !== idempotencyKey),
      comments: exists ? state.comments : [saved, ...state.comments],
      auditRecords: audit(state.auditRecords, { ...auditRecord, idempotencyKey: auditRecord.idempotencyKey ?? idempotencyKey }),
    }
  }),
  on(RouteActions.saveCommentFailure, (state, { idempotencyKey, error }) => ({
    ...state,
    pendingComments: state.pendingComments.map((item) => item.idempotencyKey === idempotencyKey
      ? { ...item, attempts: item.attempts + 1, lastError: error, status: '保存失败' as const }
      : item),
  })),
  on(RouteActions.recoverPendingCommentsSuccess, (state, { comments }) => {
    const known = new Set(state.pendingComments.map((item) => item.idempotencyKey))
    const recovered = comments
      .filter((comment) => !known.has(comment.idempotencyKey ?? idempotencyKeyFor(comment.id)))
      .map((comment) => ({ comment: { ...comment, idempotencyKey: comment.idempotencyKey ?? idempotencyKeyFor(comment.id) }, idempotencyKey: comment.idempotencyKey ?? idempotencyKeyFor(comment.id), attempts: 0, lastError: '', status: '待保存' as const }))
    return { ...state, pendingComments: [...recovered, ...state.pendingComments] }
  }),

  on(RouteActions.reconfirmComment, (state, { id }) => {
    const comment = state.comments.find((item) => item.id === id)
    if (!comment) return state
    const route = findRouteBySegment(state.routes, comment.segmentId)
    const pathVersion = route?.pathVersion ?? comment.pathVersion ?? 1
    const idempotencyKey = `RC-${id}-v${pathVersion}`
    return {
      ...state,
      version: state.version + 1,
      comments: state.comments.map((item) => item.id === id ? { ...item, status: '已接受' as const, pathVersion, confirmedAt: now() } : item),
      auditRecords: audit(state.auditRecords, { id: `AUD-${Date.now()}`, idempotencyKey, time: now(), actor: comment.author, action: `按新路径版本 v${pathVersion} 重新确认意见`, detail: '原失效记录保留，重新确认写入审计', routeId: route?.id }),
    }
  }),

  on(RouteActions.migrateLegacyComments, (state) => ({
    ...state,
    comments: migrateCommentsToCurrent(state.comments, state.routes),
    auditRecords: audit(state.auditRecords, { id: `AUD-${Date.now()}`, time: now(), actor: '系统', action: '旧意见迁移至当前路径版本', detail: '缺少路径版本的意见已归到当前版本' }),
  })),

  on(RouteActions.updateSegmentLevel, (state, { id, level }) => {
    const target = state.routes.find((route) => route.segments.some((segment) => segment.id === id))
    const updatedRoutes = state.routes.map((route) => ({
      ...route,
      pathVersion: route.id === target?.id ? route.pathVersion + 1 : route.pathVersion,
      segments: route.segments.map((segment) => segment.id === id ? { ...segment, level, status: level === '高' ? '需绕行' as const : '待复核' as const } : segment),
    }))
    const updatedTarget = updatedRoutes.find((route) => route.id === target?.id)
    return {
      ...state,
      version: state.version + 1,
      routes: updatedRoutes,
      comments: updatedTarget?.countersign ? invalidateConfirmedComments(state.comments, updatedTarget) : state.comments,
      auditRecords: audit(state.auditRecords, { id: `AUD-${Date.now()}`, time: now(), actor: '当前审阅人', action: `调整区段风险等级${target?.countersign ? '，已确认意见失效' : ''}`, detail: `区段 ${id} → ${level}`, routeId: target?.id }),
    }
  }),

  on(RouteActions.createAlternative, (state) => {
    const target = state.routes.find((route) => route.id === state.selectedRouteId)
    if (!target) return state
    const alt: RoutePackage = {
      ...target,
      id: `${target.id}-ALT`,
      score: Math.max(72, target.score - 2),
      pathVersion: target.pathVersion + 1,
      baselineLocked: false,
      updatedAt: now(),
    }
    return {
      ...state,
      version: state.version + 1,
      routes: state.routes.map((route) => route.id === state.selectedRouteId ? alt : route),
      comments: target.countersign ? invalidateConfirmedComments(state.comments, alt) : state.comments,
      auditRecords: audit(state.auditRecords, { id: `AUD-${Date.now()}`, time: now(), actor: '系统', action: '生成替代路径', detail: `风险分由 ${target.score} 降至 ${alt.score}`, routeId: alt.id }),
    }
  }),
)
