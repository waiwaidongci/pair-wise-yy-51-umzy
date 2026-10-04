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
  /** 当前路径版本号；区段或许可每修订一次递增 */
  routeVersion: number
  /** 是否进入多站段会签；进入后再修订会让已确认意见立即失效 */
  inCountersign: boolean
  segments: RiskSegment[]
}

export type ReviewStatus = '待确认' | '已接受' | '已退回'

export interface ReviewComment {
  id: string
  routeId: string
  segmentId: string
  role: string
  author: string
  content: string
  status: ReviewStatus
  /** 意见确认时锚定的路径版本；历史数据没有版本时先归一到当前版本 */
  routeVersion?: number
  /** 被更高路径版本作废后，记录其失效时的新版本号 */
  invalidatedByVersion?: number
  /** 保存失败后由服务端恢复的待处理确认请求编号，用于重试幂等 */
  pendingRequestId?: string
  /** 与 pendingRequestId 配对的待处理结果，重试时沿用，避免换按钮造成孤儿请求 */
  pendingStatus?: '已接受' | '已退回'
}

export interface ApprovalBaseline {
  id: string
  routeId: string
  lockedAt: string
  /** 锁定时的路径版本，之后路径再改也不影响基线 */
  routeVersion: number
  permit: string
  /** 锁定时的路径区段快照 */
  segments: RiskSegment[]
  /** 锁定时的原意见快照 */
  comments: ReviewComment[]
}

export interface SegmentConflict {
  segmentId: string
  segmentName: string
  /** 先提交窗口确立的当前值 */
  current: string
  /** 后到窗口提交的值 */
  incoming: string
}

export interface RouteSubmissionConflict {
  routeId: string
  windowName: string
  baseVersion: number
  currentVersion: number
  segments: SegmentConflict[]
}

export interface AuditEntry {
  id: string
  at: string
  category: '路径' | '会签' | '基线' | '冲突' | '保存'
  message: string
  detail?: string
  /** 幂等键：同一次确认/提交即便重试也只产生一条审计记录 */
  requestId?: string
}
