import { createReducer, on } from '@ngrx/store'
import type { ApprovalBaseline, AuditEntry, ReviewComment, RiskSegment, RoutePackage, RouteSubmissionConflict } from '../types'
import type { PendingResolveRequest } from '../services/countersign-api.service'
import * as RouteActions from './route.actions'

export interface RouteState {
  routes: RoutePackage[]
  selectedRouteId: string
  selectedSegmentId: string
  comments: ReviewComment[]
  baselines: ApprovalBaseline[]
  conflicts: RouteSubmissionConflict[]
  audit: AuditEntry[]
  loading: boolean
  saving: boolean
  restoring: boolean
  submitting: boolean
  error: string
  saveError: string
}

function nowTime(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function normalizeRoute(route: RoutePackage): RoutePackage {
  return { ...route, routeVersion: route.routeVersion ?? 3, inCountersign: route.inCountersign ?? false }
}

function getRoute(state: RouteState, routeId: string): RoutePackage | undefined {
  return state.routes.find((route) => route.id === routeId)
}

/** 审计时间线按 requestId 去重：确认重试不会产生第二条记录 */
function appendAudit(entries: AuditEntry[], entry: Omit<AuditEntry, 'id' | 'at'> & { at?: string }): AuditEntry[] {
  if (entry.requestId && entries.some((item) => item.requestId === entry.requestId)) return entries
  const audit: AuditEntry = { id: `AU-${Date.now()}-${entries.length}`, at: entry.at ?? nowTime(), ...entry }
  return [audit, ...entries]
}

/**
 * 路径升版后，原版本上的已确认意见立即失效，退回待确认并要求按新版本重新确认。
 * 未确认/已退回意见不动；被锁基线里的快照不受影响。
 */
function invalidateAcceptedComments(comments: ReviewComment[], routeId: string, newVersion: number): ReviewComment[] {
  return comments.map((comment) => {
    if (comment.routeId !== routeId || comment.status !== '已接受') return comment
    if ((comment.routeVersion ?? 0) >= newVersion) return comment
    return { ...comment, status: '待确认' as const, invalidatedByVersion: newVersion }
  })
}

function bumpRoute(
  state: RouteState,
  routeId: string,
  patch: { segments?: RiskSegment[]; permit?: string; score?: number; inCountersign?: boolean },
  category: AuditEntry['category'],
  message: string,
  invalidationSummary = '',
): RouteState {
  const route = getRoute(state, routeId)
  if (!route) return state
  const newVersion = route.routeVersion + 1
  const comments = invalidationSummary && route.inCountersign
    ? invalidateAcceptedComments(state.comments, routeId, newVersion)
    : state.comments
  const routes = state.routes.map((item) => item.id === routeId
    ? { ...item, ...patch, routeVersion: newVersion, segments: patch.segments ?? item.segments }
    : item)
  let audit = appendAudit(state.audit, { category, message })
  if (invalidationSummary && route.inCountersign) {
    const invalidated = state.comments.filter((comment) => comment.routeId === routeId && comment.status === '已接受' && (comment.routeVersion ?? 0) < newVersion)
    if (invalidated.length > 0) {
      audit = appendAudit(audit, {
        category: '会签',
        message: `路径升至 v${newVersion}：${invalidated.length} 条已确认意见立即失效，须按新版本重新确认`,
        detail: invalidated.map((comment) => `${comment.id}（${comment.role}·${comment.segmentId}，原 v${comment.routeVersion ?? '?'}）`).join('；'),
      })
    }
  }
  return { ...state, routes, comments, audit }
}
const seedComments: ReviewComment[] = [
  { id: 'RV-31', routeId: 'HG-260929-018', segmentId: 'S-203', role: '安全', author: '韩洁', content: '水源地保护段限速 45 km/h，并要求随车配置吸附围油栏。', status: '待确认' },
  { id: 'RV-32', routeId: 'HG-260929-018', segmentId: 'S-207', role: '应急', author: '罗晋', content: '长隧道出口需增加 15 分钟现场监护窗口，接受后方可放行。', status: '已接受', routeVersion: 3 },
]

export const initialState: RouteState = {
  routes: [],
  selectedRouteId: '',
  selectedSegmentId: '',
  comments: seedComments,
  baselines: [],
  conflicts: [],
  audit: [
    { id: 'AU-SEED-3', at: '16:42', category: '会签', message: '韩洁新增 S-203 限速与吸附物资要求', detail: '安全专业 · 修改前记录保留' },
    { id: 'AU-SEED-2', at: '16:18', category: '会签', message: '罗晋接受隧道出口监护条件', detail: '应急专业 · 审批意见已签章' },
    { id: 'AU-SEED-1', at: '15:50', category: '路径', message: '系统生成替代路径 R-ALT-02', detail: '规则引擎 · 风险分由 78 降至 71' },
  ],
  loading: false,
  saving: false,
  restoring: false,
  submitting: false,
  error: '',
  saveError: '',
}

export const routeReducer = createReducer(
  initialState,
  on(RouteActions.loadRoutes, (state) => ({ ...state, loading: true, error: '' })),
  on(RouteActions.loadRoutesSuccess, (state, { routes }) => {
    const normalized = routes.map(normalizeRoute)
    return {
      ...state,
      loading: false,
      routes: normalized,
      selectedRouteId: state.selectedRouteId || normalized[0]?.id || '',
      selectedSegmentId: state.selectedSegmentId || normalized[0]?.segments[0]?.id || '',
    }
  }),
  on(RouteActions.loadRoutesFailure, (state, { error }) => ({ ...state, loading: false, error })),

  on(RouteActions.selectRoute, (state, { id }) => ({
    ...state,
    selectedRouteId: id,
    selectedSegmentId: state.routes.find((route) => route.id === id)?.segments[0]?.id ?? '',
  })),
  on(RouteActions.selectSegment, (state, { id }) => ({ ...state, selectedSegmentId: id })),

  on(RouteActions.enterCountersign, (state, { routeId }) => {
    const route = getRoute(state, routeId)
    if (!route || route.inCountersign) return state
    const routes = state.routes.map((item) => item.id === routeId ? { ...item, inCountersign: true } : item)
    // 旧意见没有路径版本时，先归到当前版本
    const comments = state.comments.map((comment) =>
      comment.routeId === routeId && comment.routeVersion === undefined ? { ...comment, routeVersion: route.routeVersion } : comment,
    )
    const audit = appendAudit(state.audit, {
      category: '会签',
      message: `${route.id} 进入多站段会签，当前路径 v${route.routeVersion}`,
      detail: '无版本号的历史意见已归入当前版本；此后路径或许可一经修改，已确认意见立即失效',
    })
    return { ...state, routes, comments, audit }
  }),

  on(RouteActions.updateSegmentLevel, (state, { routeId, id, level }) => {
    const route = getRoute(state, routeId)
    if (!route) return state
    const segments = route.segments.map((segment) => segment.id === id
      ? { ...segment, level, status: level === '高' ? '需绕行' as const : '待复核' as const }
      : segment)
    return bumpRoute(state, routeId, { segments }, '路径', `${id} 风险等级调整为「${level}」，路径草案升至 v${route.routeVersion + 1}`)
  }),

  on(RouteActions.reviseRoute, (state, { routeId, reason, segments, permit }) => {
    const route = getRoute(state, routeId)
    if (!route) return state
    return bumpRoute(
      state,
      routeId,
      { ...(segments ? { segments } : {}), ...(permit !== undefined ? { permit } : {}) },
      '路径',
      `${permit !== undefined ? '运输许可' : '路径区段'}修订（${reason}），版本 v${route.routeVersion} → v${route.routeVersion + 1}`,
      reason,
    )
  }),

  on(RouteActions.addComment, (state, { comment }) => ({
    ...state,
    comments: [comment, ...state.comments],
    audit: appendAudit(state.audit, { category: '会签', message: `${comment.author}（${comment.role}）对 ${comment.segmentId} 提交意见`, detail: comment.content }),
  })),

  on(RouteActions.resolveCommentRequested, (state, { requestId, commentId, status }) => ({
    ...state,
    saving: true,
    saveError: '',
    comments: state.comments.map((comment) => comment.id === commentId && !comment.pendingRequestId
      ? { ...comment, pendingRequestId: requestId, pendingStatus: status }
      : comment),
  })),
  on(RouteActions.resolveCommentSuccess, (state, { requestId, commentId, status }) => {
    const comment = state.comments.find((item) => item.id === commentId)
    const route = comment ? getRoute(state, comment.routeId) : undefined
    return {
      ...state,
      saving: false,
      saveError: '',
      comments: state.comments.map((item) => item.id === commentId
        // 重新确认即锚定到当前路径版本，失效标记清除
        ? { ...item, status, routeVersion: route?.routeVersion ?? item.routeVersion, invalidatedByVersion: undefined, pendingRequestId: undefined, pendingStatus: undefined }
        : item),
      audit: appendAudit(state.audit, {
        requestId,
        category: '会签',
        message: `${comment?.author ?? commentId}（${comment?.role ?? ''}）的意见${status === '已接受' ? '确认接受' : '退回补件'}${comment?.invalidatedByVersion ? `，已按 v${route?.routeVersion} 重新确认` : ''}`,
        detail: `区段 ${comment?.segmentId ?? ''} · 请求 ${requestId}`,
      }),
    }
  }),
  on(RouteActions.resolveCommentFailure, (state, { commentId, error }) => ({
    ...state,
    saving: false,
    saveError: `${error}（意见 ${commentId} 的待处理确认保留在服务端，恢复后可重试）`,
  })),

  on(RouteActions.restorePendingResolves, (state) => ({ ...state, restoring: true, saveError: '' })),
  on(RouteActions.restorePendingResolvesSuccess, (state, { pending }) => {
    const serverByComment = new Map(pending.map((item: PendingResolveRequest) => [item.commentId, item]))
    const comments = state.comments.map((comment) => {
      const serverPending = serverByComment.get(comment.id)
      if (serverPending) return { ...comment, pendingRequestId: serverPending.requestId, pendingStatus: serverPending.status }
      // 服务端没有记录的本地待处理内容一律清除，避免重试时重复落账
      return comment.pendingRequestId ? { ...comment, pendingRequestId: undefined, pendingStatus: undefined } : comment
    })
    return {
      ...state,
      restoring: false,
      comments,
      audit: appendAudit(state.audit, {
        category: '保存',
        message: `保存失败后从服务端恢复 ${pending.length} 条待处理确认`,
        detail: pending.length ? pending.map((item) => `${item.commentId}→${item.status}（${item.requestId}）`).join('；') : '服务端无未完成确认',
      }),
    }
  }),

  on(RouteActions.submitConcurrentWindows, (state) => ({ ...state, submitting: true, saveError: '' })),
  on(RouteActions.routeVersionAccepted, (state, { result }) => {
    const route = getRoute(state, result.routeId)
    if (!route) return { ...state, submitting: false }
    const comments = route.inCountersign ? invalidateAcceptedComments(state.comments, result.routeId, result.version) : state.comments
    let audit = appendAudit(state.audit, {
      category: '冲突',
      message: `窗口「${result.windowName}」先提交，路径版本确立为 v${result.version}`,
      detail: '同运输单的后到提交将与此版本逐区段比对',
    })
    const invalidated = state.comments.filter((comment) => comment.routeId === result.routeId && comment.status === '已接受' && (comment.routeVersion ?? 0) < result.version && route.inCountersign)
    if (invalidated.length > 0) {
      audit = appendAudit(audit, {
        category: '会签',
        message: `路径升至 v${result.version}：${invalidated.length} 条已确认意见失效，须按新版本重新确认`,
        detail: invalidated.map((comment) => `${comment.id}（${comment.segmentId}，原 v${comment.routeVersion ?? '?'}）`).join('；'),
      })
    }
    return {
      ...state,
      submitting: false,
      comments,
      routes: state.routes.map((item) => item.id === result.routeId ? { ...item, segments: result.segments, permit: result.permit, routeVersion: result.version } : item),
      audit,
    }
  }),
  on(RouteActions.routeVersionConflict, (state, { conflict }) => ({
    ...state,
    submitting: false,
    conflicts: [...state.conflicts.filter((item) => item.routeId !== conflict.routeId), conflict],
    audit: appendAudit(state.audit, {
      category: '冲突',
      message: `窗口「${conflict.windowName}」提交冲突：基于 v${conflict.baseVersion}，当前已是 v${conflict.currentVersion}`,
      detail: conflict.segments.map((segment) => `${segment.segmentId} ${segment.segmentName}：当前「${segment.current}」/ 后到「${segment.incoming}」`).join('；'),
    }),
  })),
  on(RouteActions.dismissConflict, (state, { routeId }) => ({
    ...state,
    conflicts: state.conflicts.filter((conflict) => conflict.routeId !== routeId),
  })),

  on(RouteActions.lockBaseline, (state, { routeId }) => {
    const route = getRoute(state, routeId)
    if (!route) return state
    const baseline: ApprovalBaseline = {
      id: `BL-${route.id}-v${route.routeVersion}`,
      routeId,
      lockedAt: nowTime(),
      routeVersion: route.routeVersion,
      permit: route.permit,
      segments: route.segments.map((segment) => ({ ...segment, coordinates: [...segment.coordinates] })),
      comments: state.comments.filter((comment) => comment.routeId === routeId).map((comment) => ({ ...comment })),
    }
    return {
      ...state,
      baselines: [...state.baselines.filter((item) => item.id !== baseline.id), baseline],
      audit: appendAudit(state.audit, {
        category: '基线',
        message: `审批基线已锁定：${route.id} @ v${route.routeVersion}`,
        detail: '原路径版本、运输许可与原意见只读保留，后续路径升版不改变基线内容',
      }),
    }
  }),

  on(RouteActions.createAlternative, (state) => {
    const route = getRoute(state, state.selectedRouteId)
    if (!route) return state
    return bumpRoute(
      state,
      route.id,
      { score: Math.max(72, route.score - 2) },
      '路径',
      `规则引擎生成替代方案，风险分 ${route.score} → ${Math.max(72, route.score - 2)}，路径版本升至 v${route.routeVersion + 1}`,
      route.inCountersign ? '替代方案' : '',
    )
  }),
)
