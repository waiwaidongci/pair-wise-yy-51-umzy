import { createAction, props } from '@ngrx/store'
import type { AuditRecord, ReviewComment, RiskLevel, RiskSegment, RouteConflict, RoutePackage } from '../types'

export const loadRoutes = createAction('[Route Workbench] Load Routes')
export const loadRoutesSuccess = createAction('[Route API] Load Routes Success', props<{ routes: RoutePackage[] }>())
export const loadRoutesFailure = createAction('[Route API] Load Routes Failure', props<{ error: string }>())
export const selectRoute = createAction('[Route Workbench] Select Route', props<{ id: string }>())
export const selectSegment = createAction('[Risk Map] Select Segment', props<{ id: string }>())
export const updateSegmentLevel = createAction('[Risk Map] Update Level', props<{ id: string; level: RiskLevel }>())
export const addComment = createAction('[Approval] Add Comment', props<{ comment: ReviewComment }>())
export const resolveComment = createAction('[Approval] Resolve Comment', props<{ id: string; status: ReviewComment['status'] }>())
export const createAlternative = createAction('[Risk Map] Create Alternative')

// 多站段会签
export const enterCountersign = createAction('[Approval] Enter Countersign', props<{ routeId: string }>())
export const lockBaseline = createAction('[Approval] Lock Baseline', props<{ routeId: string }>())

// 路径区段/许可变更：版本递增，已确认意见失效
export const updateRouteContent = createAction('[Approval] Update Route Content', props<{ routeId: string; segments?: RiskSegment[]; permit?: string; reason: string }>())

// 并发提交：baseVersion 为提交方所依据的版本
export const submitRouteVersion = createAction('[Approval] Submit Route Version', props<{ routeId: string; baseVersion: number; segments: RiskSegment[]; permit: string; window: string }>())
export const submitRouteVersionConflict = createAction('[Approval] Submit Route Version Conflict', props<{ conflict: RouteConflict }>())

// 意见保存（发件箱 + 幂等）
export const saveComment = createAction('[Approval] Save Comment', props<{ comment: ReviewComment }>())
export const saveCommentSuccess = createAction('[Approval] Save Comment Success', props<{ comment: ReviewComment; audit: AuditRecord }>())
export const saveCommentFailure = createAction('[Approval] Save Comment Failure', props<{ idempotencyKey: string; error: string }>())
export const recoverPendingComments = createAction('[Approval] Recover Pending Comments')
export const recoverPendingCommentsSuccess = createAction('[Approval] Recover Pending Comments Success', props<{ comments: ReviewComment[] }>())
export const retryPendingComment = createAction('[Approval] Retry Pending Comment', props<{ idempotencyKey: string }>())

// 失效意见按新路径版本重新确认
export const reconfirmComment = createAction('[Approval] Reconfirm Comment', props<{ id: string }>())

// 旧意见迁移：没有路径版本的意见先归到当前版本
export const migrateLegacyComments = createAction('[Approval] Migrate Legacy Comments')
