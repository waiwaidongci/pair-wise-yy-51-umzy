import { createAction, props } from '@ngrx/store'
import type {
  ReviewComment,
  RiskLevel,
  RoutePackage,
  RouteSubmissionConflict,
  RiskSegment,
} from '../types'
import type { PendingResolveRequest, SubmissionAccepted } from '../services/countersign-api.service'

export const loadRoutes = createAction('[Route Workbench] Load Routes')
export const loadRoutesSuccess = createAction('[Route API] Load Routes Success', props<{ routes: RoutePackage[] }>())
export const loadRoutesFailure = createAction('[Route API] Load Routes Failure', props<{ error: string }>())
export const selectRoute = createAction('[Route Workbench] Select Route', props<{ id: string }>())
export const selectSegment = createAction('[Risk Map] Select Segment', props<{ id: string }>())

/** 进入多站段会签：历史无版本意见先归到当前路径版本 */
export const enterCountersign = createAction('[Approval] Enter Countersign', props<{ routeId: string }>())

/** 会签前调整风险等级（版本递增，但不作废意见） */
export const updateSegmentLevel = createAction('[Risk Map] Update Level', props<{ routeId: string; id: string; level: RiskLevel }>())

/** 会签中修订路径区段或许可：当前路径版本递增，原版本上的已确认意见立即失效 */
export const reviseRoute = createAction(
  '[Approval] Revise Route',
  props<{ routeId: string; reason: string; segments?: RiskSegment[]; permit?: string }>(),
)

export const addComment = createAction('[Approval] Add Comment', props<{ comment: ReviewComment }>())

/** 发起确认保存（带幂等 requestId） */
export const resolveCommentRequested = createAction(
  '[Approval] Resolve Comment Requested',
  props<{ requestId: string; commentId: string; status: '已接受' | '已退回' }>(),
)
export const resolveCommentSuccess = createAction(
  '[Approval] Resolve Comment Success',
  props<{ requestId: string; commentId: string; status: '已接受' | '已退回' }>(),
)
export const resolveCommentFailure = createAction(
  '[Approval] Resolve Comment Failure',
  props<{ requestId: string; commentId: string; error: string }>(),
)
/** 保存失败后从服务端恢复待处理确认（不带回本地未保存的内容） */
export const restorePendingResolves = createAction('[Approval] Restore Pending Resolves', props<{ routeId: string }>())
export const restorePendingResolvesSuccess = createAction(
  '[Approval] Restore Pending Resolves Success',
  props<{ pending: PendingResolveRequest[] }>(),
)

/** 两个窗口同时提交同一运输单 */
export const submitConcurrentWindows = createAction('[Approval] Submit Concurrent Windows', props<{ routeId: string }>())
export const routeVersionAccepted = createAction('[Approval] Route Version Accepted', props<{ result: SubmissionAccepted }>())
export const routeVersionConflict = createAction('[Approval] Route Version Conflict', props<{ conflict: RouteSubmissionConflict }>())
export const dismissConflict = createAction('[Approval] Dismiss Conflict', props<{ routeId: string }>())

/** 锁定审批基线：原路径版本与原意见只读保留 */
export const lockBaseline = createAction('[Approval] Lock Baseline', props<{ routeId: string }>())

export const createAlternative = createAction('[Risk Map] Create Alternative')
