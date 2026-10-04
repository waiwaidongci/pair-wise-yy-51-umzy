import { Injectable, signal } from '@angular/core'
import type { RiskSegment, RoutePackage, SegmentConflict } from '../types'

export interface PendingResolveRequest {
  requestId: string
  commentId: string
  routeId: string
  routeVersion: number
  status: '已接受' | '已退回'
  author: string
  role: string
}

export interface RouteSubmission {
  windowName: string
  baseVersion: number
  segments: RiskSegment[]
  permit: string
}

export interface SubmissionAccepted {
  outcome: 'accepted'
  routeId: string
  windowName: string
  version: number
  segments: RiskSegment[]
  permit: string
}

export interface SubmissionRejected {
  outcome: 'conflict'
  routeId: string
  windowName: string
  baseVersion: number
  currentVersion: number
  segments: SegmentConflict[]
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 同一提交内容用于差异比对的指纹（限速、起讫、里程、风险、风险等级） */
function segmentSignature(segment: RiskSegment): string {
  return [segment.from, segment.to, segment.km, segment.speed, segment.level, segment.status, segment.risks.join('/')].join('|')
}

/**
 * 内存版“服务端”：
 * - 保存接口按 requestId 幂等，可切换到“保存失败”模式；失败时待处理确认仍保留，可恢复后重试；
 * - 同一路径版本先到先得，后到提交与当前版本逐区段比对，产出冲突清单。
 */
@Injectable({ providedIn: 'root' })
export class CountersignApiService {
  /** true 时确认保存一律失败（模拟网络/服务故障），用于演示恢复与重试 */
  readonly saveOffline = signal(false)

  private serverVersion: Record<string, number> = {}
  private currentSegments = new Map<string, RiskSegment[]>()
  private pendingResolves = new Map<string, PendingResolveRequest>()
  private processedRequests = new Map<string, { status: '已接受' | '已退回' }>()
  private processedSubmissions = new Map<string, SubmissionAccepted>()

  seedRouteVersion(routeId: string, version: number) {
    if (this.serverVersion[routeId] === undefined) this.serverVersion[routeId] = version
  }

  /** 保存一条会签确认；同 requestId 重复调用直接返回已处理结果，不会重复落账 */
  async resolveComment(request: PendingResolveRequest): Promise<{ ok: true }> {
    await delay(450)
    if (this.saveOffline()) throw new Error('服务端暂不可用，确认未保存，请稍后重试')
    const processed = this.processedRequests.get(request.requestId)
    if (processed) return { ok: true }
    this.processedRequests.set(request.requestId, { status: request.status })
    this.pendingResolves.delete(request.requestId)
    return { ok: true }
  }

  /** 保存失败后恢复：从服务端取回尚未完成的待处理确认 */
  async fetchPendingResolves(routeId: string): Promise<PendingResolveRequest[]> {
    await delay(400)
    return [...this.pendingResolves.values()].filter((item) => item.routeId === routeId)
  }

  async submitRouteVersion(routeId: string, route: RoutePackage, submission: RouteSubmission): Promise<SubmissionAccepted | SubmissionRejected> {
    await delay(500)
    const current = this.serverVersion[routeId] ?? route.routeVersion
    const accepted = this.processedSubmissions.get(submission.windowName)
    if (accepted) return accepted
    if (submission.baseVersion !== current) {
      return {
        outcome: 'conflict',
        routeId,
        windowName: submission.windowName,
        baseVersion: submission.baseVersion,
        currentVersion: current,
        // 与“先提交窗口已确立的当前区段”逐区段比对
        segments: this.diffSegments(this.currentSegments.get(routeId) ?? route.segments, submission.segments),
      }
    }
    const next: SubmissionAccepted = {
      outcome: 'accepted',
      routeId,
      windowName: submission.windowName,
      version: current + 1,
      segments: submission.segments,
      permit: submission.permit,
    }
    this.serverVersion[routeId] = next.version
    this.currentSegments.set(routeId, submission.segments)
    this.processedSubmissions.set(submission.windowName, next)
    return next
  }

  /** 演示用：复位某运输单的并发提交状态，允许再跑一轮双窗口提交 */
  resetSubmissions(routeId: string, version: number) {
    this.processedSubmissions.clear()
    this.serverVersion[routeId] = version
    this.currentSegments.delete(routeId)
  }

  stashPendingResolve(request: PendingResolveRequest) {
    this.pendingResolves.set(request.requestId, request)
  }

  private diffSegments(currentSegments: RiskSegment[], incoming: RiskSegment[]): SegmentConflict[] {
    const conflicts: SegmentConflict[] = []
    for (const theirs of incoming) {
      const ours = currentSegments.find((segment) => segment.id === theirs.id)
      if (!ours || segmentSignature(ours) === segmentSignature(theirs)) continue
      conflicts.push({
        segmentId: theirs.id,
        segmentName: theirs.name,
        current: `${ours.from}→${ours.to} · ${ours.km}km · ${ours.speed} · 风险${ours.level}`,
        incoming: `${theirs.from}→${theirs.to} · ${theirs.km}km · ${theirs.speed} · 风险${theirs.level}`,
      })
    }
    const incomingIds = new Set(incoming.map((segment) => segment.id))
    for (const ours of currentSegments) {
      if (!incomingIds.has(ours.id)) {
        conflicts.push({ segmentId: ours.id, segmentName: ours.name, current: '保留该区段', incoming: '已删除该区段' })
      }
    }
    return conflicts
  }
}
