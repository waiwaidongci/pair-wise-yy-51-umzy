import { inject, Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { map, of, throwError } from 'rxjs'
import type { AuditRecord, ReviewComment, RoutePackage } from '../types'

const now = () => {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

@Injectable({ providedIn: 'root' })
export class RouteApiService {
  private readonly http = inject(HttpClient)

  /**
   * 服务端待处理意见存储：idempotencyKey -> { comment, audit }
   * 保存失败后意见仍留在服务端，可据此恢复；重试确认幂等，不生成重复审计。
   */
  private readonly pendingStore = new Map<string, { comment: ReviewComment; audit: AuditRecord | null }>()

  getRoutePackages() {
    return this.http.get<{ items: RoutePackage[] }>('route-data.json').pipe(map((response) => response.items))
  }

  /** 保存意见：服务端先收到待处理意见，再模拟首次响应丢失（失败） */
  saveComment(comment: ReviewComment, idempotencyKey: string) {
    const existing = this.pendingStore.get(idempotencyKey)
    if (existing) {
      // 幂等重试：服务端已存在，直接返回既有结果，不重复生成审计
      return of({ comment: existing.comment, audit: existing.audit ?? this.makeAudit(existing.comment), duplicated: true })
    }
    this.pendingStore.set(idempotencyKey, { comment: { ...comment, idempotencyKey }, audit: null })
    return throwError(() => new Error('网络中断：保存响应丢失'))
  }

  /** 从服务端恢复待处理意见 */
  recoverPendingComments() {
    return of([...this.pendingStore.values()].map((entry) => entry.comment))
  }

  /** 重试确认：幂等，首次生成审计，之后返回同一审计记录 */
  confirmPending(idempotencyKey: string) {
    const existing = this.pendingStore.get(idempotencyKey)
    if (!existing) return throwError(() => new Error('待处理意见不存在或已确认'))
    if (!existing.audit) existing.audit = this.makeAudit(existing.comment)
    return of({ comment: existing.comment, audit: existing.audit, duplicated: true })
  }

  private makeAudit(comment: ReviewComment): AuditRecord {
    return {
      id: `AUD-SRV-${comment.id}`,
      idempotencyKey: comment.idempotencyKey,
      time: now(),
      actor: comment.author,
      action: `确认意见 ${comment.id}`,
      detail: '服务端审计 · 幂等去重',
    }
  }
}
