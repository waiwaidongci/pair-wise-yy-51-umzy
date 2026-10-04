export type RiskLevel = '高' | '中' | '低'

export interface RiskSegment {
  id: string
  name: string
  from: string
  to: string
  km: string
  speed: string
  risks: string[]
  level: RiskLevel
  status: '待复核' | '已确认' | '需绕行'
  coordinates: [number, number][]
}

export interface RoutePackage {
  id: string
  cargo: string
  hazardClass: string
  trainCode: string
  origin: string
  destination: string
  tonnage: number
  wagonCount: number
  permit: string
  permission: '有效' | '缺失' | '待补充'
  score: number
  updatedAt: string
  segments: RiskSegment[]
  /** 路径版本：会签意见锚定的路径基线，区段/许可变更时递增 */
  pathVersion: number
  /** 是否进入多站段会签 */
  countersign: boolean
  /** 审批基线是否已锁定 */
  baselineLocked: boolean
}

export type CommentStatus = '待确认' | '已接受' | '已退回' | '已失效'

export interface ReviewComment {
  id: string
  segmentId: string
  role: string
  author: string
  content: string
  status: CommentStatus
  /** 意见确认时所依据的路径版本；旧意见可能缺失，迁移时归到当前版本 */
  pathVersion?: number
  /** 最近一次确认时间，用于审计时间线 */
  confirmedAt?: string
  /** 幂等键：重试确认时携带，服务端据此去重，不生成重复审计 */
  idempotencyKey?: string
}

/** 锁定的审批基线快照：保留原路径版本与原意见 */
export interface BaselineSnapshot {
  routeId: string
  pathVersion: number
  permit: string
  lockedAt: string
  segmentIds: string[]
  segmentCount: number
  comments: ReviewComment[]
}

/** 两个路径版本之间的区段差异 */
export interface SegmentDiff {
  segmentId: string
  segmentName: string
  changes: { field: string; label: string; from: string; to: string }[]
}

/** 并发提交冲突记录：先提交的路径版本成为当前版本，后到内容留成冲突 */
export interface RouteConflict {
  id: string
  routeId: string
  winnerVersion: number
  loserVersion: number
  window: string
  differingSegments: SegmentDiff[]
  detectedAt: string
}

/** 待服务端保存的意见（发件箱），保存失败后据此恢复 */
export interface PendingComment {
  comment: ReviewComment
  idempotencyKey: string
  attempts: number
  lastError: string
  status: '待保存' | '保存失败'
}

/** 审计记录：只追加，幂等键去重 */
export interface AuditRecord {
  id: string
  idempotencyKey?: string
  time: string
  actor: string
  action: string
  detail: string
  routeId?: string
}
