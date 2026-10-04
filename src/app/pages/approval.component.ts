import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatTabsModule } from '@angular/material/tabs'
import { MatCheckboxModule } from '@angular/material/checkbox'
import { map } from 'rxjs'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'
import { CountersignApiService } from '../services/countersign-api.service'
import type { ReviewComment, RiskSegment, RoutePackage } from '../types'

interface ApprovalViewModel {
  route: RoutePackage | undefined
  comments: ReviewComment[]
  conflict: RouteState['conflicts'][number] | undefined
  baselines: RouteState['baselines']
  audit: RouteState['audit']
  saving: boolean
  restoring: boolean
  submitting: boolean
  saveError: string
}

@Component({
  selector: 'app-approval',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTabsModule, MatCheckboxModule],
  template: `
    <main class="page">
      <div class="page-head">
        <div>
          <p class="eyebrow">安全 · 运营 · 应急会签</p>
          <h1>多站段会签与版本控制</h1>
          <p>进入会签后路径或许可一改，已确认意见立即失效并按新版本重新确认；锁定基线保留原版本与原意见。</p>
        </div>
        <button mat-flat-button color="primary" [disabled]="!route() || !!route()?.inCountersign" (click)="enterCountersign()">进入多站段会签</button>
      </div>

      @if (route(); as route) {
        <div class="card version-bar">
          <div class="version-info">
            <span class="version-tag">当前路径 v{{route.routeVersion}}</span>
            <span class="status-pill" [class.live]="route.inCountersign">{{route.inCountersign ? '会签进行中' : '会签未开始'}}</span>
            <small>{{route.id}} · {{route.trainCode}} · {{route.origin}} → {{route.destination}}</small>
            <small>许可：{{route.permit}}（{{route.permission}}）</small>
          </div>
          <div class="version-actions">
            <button mat-stroked-button [disabled]="!route.inCountersign" (click)="reviseSegment()" title="模拟路径区段调整">区段一改</button>
            <button mat-stroked-button [disabled]="!route.inCountersign" (click)="revisePermit()">许可一变</button>
            <button mat-stroked-button color="accent" [disabled]="submitting()" (click)="concurrentSubmit()">{{submitting() ? '提交裁决中…' : '双窗口同时提交'}}</button>
            <button mat-flat-button (click)="lockBaseline()">锁定审批基线</button>
          </div>
        </div>

        @if (!route.inCountersign) {
          <p class="hint">会签尚未开始：此时修订只升版本号、不作废意见。点击右上角“进入多站段会签”后，旧意见将先归入当前版本，之后任何区段/许可修订都会让已确认意见立即失效。</p>
        }

        @if (conflict(); as conflict) {
          <section class="card conflict-box">
            <div class="conflict-head"><b>⚠ {{conflict.windowName}} 的提交与当前版本冲突</b><button mat-button color="warn" (click)="dismissConflict()">忽略</button></div>
            <p>该窗口基于 v{{conflict.baseVersion}} 提交，但「先提交」的窗口已将路径确立为 <b>v{{conflict.currentVersion}}</b>。以下区段内容不同：</p>
            <table>
              <thead><tr><th>区段</th><th>当前版本（先提交）</th><th>后到提交</th></tr></thead>
              <tbody>
                @for (item of conflict.segments; track item.segmentId) {
                  <tr><td><b>{{item.segmentId}}</b><small class="block">{{item.segmentName}}</small></td><td class="ok">{{item.current}}</td><td class="bad">{{item.incoming}}</td></tr>
                }
              </tbody>
            </table>
          </section>
        }
      }

      <mat-tab-group>
        <mat-tab [label]="'待处理意见（' + comments().length + '）'">
          <section class="card comment-list">
            <div class="recover-bar">
              <mat-checkbox [(ngModel)]="saveOffline" (ngModelChange)="setSaveOffline($event)" color="warn">模拟保存失败（服务端不可用）</mat-checkbox>
              <span class="spacer"></span>
              <button mat-stroked-button [disabled]="restoring()" (click)="recover()">{{restoring() ? '恢复中…' : '保存失败后从服务端恢复待处理意见'}}</button>
              @if (saving()) { <span class="saving">确认保存中…</span> }
            </div>
            @if (saveError()) { <p class="save-error">保存失败：{{saveError()}}</p> }
            @for (comment of comments(); track comment.id) {
              <div class="comment" [class.invalid]="comment.invalidatedByVersion">
                <div class="comment-head">
                  <div>
                    <b>{{comment.role}} · {{comment.author}}</b>
                    <small>{{comment.segmentId}} · {{comment.id}} · 锚定 v{{comment.routeVersion ?? '未归版'}}</small>
                  </div>
                  <span class="status-pill" [class.accepted]="comment.status==='已接受'" [class.rejected]="comment.status==='已退回'">{{comment.status}}</span>
                </div>
                <p>{{comment.content}}</p>
                @if (comment.invalidatedByVersion) {
                  <p class="invalid-note">该意见在 v{{comment.routeVersion}} 上确认，路径已升至 v{{comment.invalidatedByVersion}}，确认立即失效，请按新版本重新确认。</p>
                }
                @if (comment.pendingRequestId) {
                  <p class="pending-note">待处理请求 {{comment.pendingRequestId}}（{{comment.pendingStatus}}）已留在服务端，重试沿用同一请求号，不会重复落审计。</p>
                }
                <div class="actions">
                  @if (comment.pendingRequestId) {
                    <button mat-flat-button color="primary" [disabled]="saving()" (click)="retry(comment)">重试确认（{{comment.pendingStatus}} · 同一请求号）</button>
                  } @else {
                    <button mat-stroked-button color="warn" [disabled]="saving()" (click)="resolve(comment,'已退回')">退回补件</button>
                    <button mat-flat-button color="primary" [disabled]="saving()" (click)="resolve(comment,'已接受')">接受条件</button>
                  }
                </div>
              </div>
            } @empty {
              <p class="hint">当前运输单暂无会签意见。</p>
            }
          </section>
        </mat-tab>

        <mat-tab label="发表区段意见">
          <section class="card form-card">
            <div class="two">
              <mat-form-field><mat-label>专业角色</mat-label><mat-select [(ngModel)]="role"><mat-option>安全</mat-option><mat-option>运营</mat-option><mat-option>应急</mat-option></mat-select></mat-form-field>
              <mat-form-field><mat-label>区段</mat-label><mat-select [(ngModel)]="segmentId"><mat-option *ngFor="let segment of route()?.segments || []" [value]="segment.id">{{segment.id}} · {{segment.name}}</mat-option></mat-select></mat-form-field>
            </div>
            <mat-form-field class="wide"><mat-label>审批条件与依据</mat-label><textarea matInput rows="5" [(ngModel)]="content" placeholder="明确区段、约束、时限与验收证据"></textarea></mat-form-field>
            <button mat-flat-button color="primary" [disabled]="!content.trim() || !route()" (click)="addComment()">提交意见（锚定 v{{route()?.routeVersion}}）</button>
          </section>
        </mat-tab>

        <mat-tab [label]="'锁定基线（' + baselines().length + '）'">
          <section class="card">
            @for (baseline of baselines(); track baseline.id) {
              <div class="baseline">
                <div class="comment-head"><div><b>{{baseline.id}}</b><small>锁定于 {{baseline.lockedAt}} · 许可 {{baseline.permit}} · {{baseline.segments.length}} 个区段 · {{baseline.comments.length}} 条原意见</small></div><span class="status-pill accepted">只读</span></div>
                <p>此基线保留 v{{baseline.routeVersion}} 的原路径与原意见快照；后续路径升版、意见失效与重新确认都不会改变基线内容。</p>
                <ul class="snapshot-list">
                  @for (segment of baseline.segments; track segment.id) { <li>{{segment.id}} {{segment.name}} · {{segment.speed}} · {{segment.km}} km</li> }
                </ul>
              </div>
            } @empty {
              <p class="hint">尚未锁定基线。锁定后原路径版本和原意见将只读保存。</p>
            }
          </section>
        </mat-tab>

        <mat-tab label="审计时间线">
          <section class="card timeline">
            @for (entry of audit(); track entry.id) {
              <div>
                <i [class]="'cat-' + entry.category"></i>
                <b>{{entry.at}} · [{{entry.category}}] {{entry.message}}</b>
                @if (entry.detail) { <p>{{entry.detail}}</p> }
                @if (entry.requestId) { <small>幂等键 {{entry.requestId}}</small> }
              </div>
            }
          </section>
        </mat-tab>
      </mat-tab-group>
    </main>
  `,
  styles: [`
    .version-bar{display:flex;justify-content:space-between;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
    .version-info{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.version-info small{color:#7a8798}
    .version-tag{background:#1e293b;color:#fff;border-radius:5px;padding:3px 10px;font-weight:700;font-size:13px}
    .status-pill{border:1px solid #cbd5e1;border-radius:11px;padding:2px 10px;font-size:12px;color:#64748b}.status-pill.live{background:#ecfdf5;border-color:#6ee7b7;color:#047857;font-weight:700}
    .status-pill.accepted{background:#eff6ff;border-color:#93c5fd;color:#1d4ed8}.status-pill.rejected{background:#fef2f2;border-color:#fca5a5;color:#b91c1c}
    .version-actions{display:flex;gap:8px;flex-wrap:wrap}
    .hint{color:#667085;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:6px;padding:10px 14px;margin:0 0 12px}
    .comment-list{padding:0}.comment{padding:18px;border-bottom:1px solid #e7ebf1}.comment.invalid{background:#fff7ed;border-left:3px solid #ea580c}
    .comment-head{display:flex;justify-content:space-between;gap:8px}.comment-head small{display:block;color:#7a8798;margin-top:4px}.comment p{color:#475569}
    .invalid-note{color:#c2410c!important;font-weight:700}.pending-note{color:#1d4ed8!important;font-size:12px}
    .actions{display:flex;gap:10px}.actions button{margin:8px 8px 0 0}
    .recover-bar{display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid #e7ebf1;flex-wrap:wrap}.saving{color:#1d4ed8;font-size:13px}
    .save-error{color:#b91c1c;background:#fef2f2;padding:8px 14px;margin:0;border-top:1px solid #fecaca}
    .form-card{max-width:780px}.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}.two mat-form-field,.wide{width:100%}
    .conflict-box{border-color:#fca5a5;background:#fffdf5;margin-bottom:12px}.conflict-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
    .conflict-box table{width:100%;border-collapse:collapse;margin-top:8px}.conflict-box th,.conflict-box td{border:1px solid #e2e8f0;padding:8px 10px;text-align:left;font-size:13px;vertical-align:top}.conflict-box th{background:#f1f5f9}.conflict-box .ok{color:#15803d}.conflict-box .bad{color:#dc2626}
    .block{display:block;color:#7a8798;margin-top:3px}
    .baseline{padding:14px 4px;border-bottom:1px solid #e7ebf1}.snapshot-list{margin:8px 0 0;padding-left:18px;color:#475569;font-size:13px}
    .timeline{padding:8px 18px}.timeline>div{position:relative;padding:14px 10px 14px 28px;border-left:2px solid #cbd5e1}.timeline i{position:absolute;width:9px;height:9px;border-radius:50%;background:#94a3b8;left:-5.5px;top:20px}
    .timeline i.cat-路径{background:#2563eb}.timeline i.cat-会签{background:#7c3aed}.timeline i.cat-基线{background:#0f766e}.timeline i.cat-冲突{background:#dc2626}.timeline i.cat-保存{background:#d97706}
    .timeline p{color:#7a8798;margin:5px 0 0}.timeline small{color:#94a3b8}
    @media(max-width:620px){.two{grid-template-columns:1fr}}
  `],
})
export class ApprovalComponent {
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly api = inject(CountersignApiService)
  readonly vm$ = this.store.select('routes').pipe(
    map((state: RouteState): ApprovalViewModel => {
      const route = state.routes.find((item) => item.id === state.selectedRouteId)
      return {
        route,
        comments: route ? state.comments.filter((comment) => comment.routeId === route.id) : [],
        conflict: state.conflicts.find((item) => item.routeId === state.selectedRouteId),
        baselines: state.baselines.filter((item) => item.routeId === state.selectedRouteId),
        audit: state.audit,
        saving: state.saving,
        restoring: state.restoring,
        submitting: state.submitting,
        saveError: state.saveError,
      }
    }),
  )
  private vm: ApprovalViewModel | undefined
  role = '安全'
  segmentId = ''
  content = ''
  saveOffline = false

  constructor() {
    this.vm$.subscribe((vm) => {
      this.vm = vm
      if (vm.route && !vm.route.segments.some((segment) => segment.id === this.segmentId)) {
        this.segmentId = vm.route.segments[0]?.id ?? ''
      }
    })
  }

  setSaveOffline(offline: boolean) { this.api.saveOffline.set(offline) }

  route() { return this.vm?.route }
  comments() { return this.vm?.comments ?? [] }
  conflict() { return this.vm?.conflict }
  baselines() { return this.vm?.baselines ?? [] }
  audit() { return this.vm?.audit ?? [] }
  saving() { return this.vm?.saving ?? false }
  restoring() { return this.vm?.restoring ?? false }
  submitting() { return this.vm?.submitting ?? false }
  saveError() { return this.vm?.saveError ?? '' }

  enterCountersign() { const route = this.route(); if (route) this.store.dispatch(RouteActions.enterCountersign({ routeId: route.id })) }
  lockBaseline() { const route = this.route(); if (route) this.store.dispatch(RouteActions.lockBaseline({ routeId: route.id })) }
  recover() { const route = this.route(); if (route) this.store.dispatch(RouteActions.restorePendingResolves({ routeId: route.id })) }
  concurrentSubmit() { const route = this.route(); if (route) this.store.dispatch(RouteActions.submitConcurrentWindows({ routeId: route.id })) }
  dismissConflict() { const route = this.route(); if (route) this.store.dispatch(RouteActions.dismissConflict({ routeId: route.id })) }

  /** 演示用：把第一个高风险区段限速再降 5 km/h，作为“路径区段一改” */
  reviseSegment() {
    const route = this.route()
    if (!route) return
    const segments: RiskSegment[] = route.segments.map((segment) => {
      const target = route.segments.find((item) => item.level === '高') ?? route.segments[0]
      return segment.id === target.id
        ? { ...segment, speed: segment.speed.replace(/\d+/, (value) => String(Math.max(20, Number(value) - 5))) }
        : segment
    })
    this.store.dispatch(RouteActions.reviseRoute({ routeId: route.id, reason: '会签区段限速收紧', segments }))
  }

  /** 演示用：许可换发补充件，作为“许可一变” */
  revisePermit() {
    const route = this.route()
    if (!route) return
    const permit = route.permit.replace(/·变更件$/, '') + '·变更件'
    this.store.dispatch(RouteActions.reviseRoute({ routeId: route.id, reason: '运输许可换发补充件', permit }))
  }

  addComment() {
    const route = this.route()
    if (!route || !this.content.trim()) return
    this.store.dispatch(RouteActions.addComment({
      comment: {
        id: `RV-${Date.now().toString().slice(-5)}`,
        routeId: route.id,
        segmentId: this.segmentId,
        role: this.role,
        author: '当前审阅人',
        content: this.content,
        status: '待确认',
        routeVersion: route.routeVersion,
      },
    }))
    this.content = ''
  }

  resolve(comment: ReviewComment, status: '已接受' | '已退回') {
    const requestId = `REQ-${comment.id}-${Date.now()}`
    this.store.dispatch(RouteActions.resolveCommentRequested({ requestId, commentId: comment.id, status }))
  }

  /** 保存失败后的重试：沿用服务端保留的 requestId 与原结果，保证审计幂等 */
  retry(comment: ReviewComment) {
    if (!comment.pendingRequestId || !comment.pendingStatus) return
    this.store.dispatch(RouteActions.resolveCommentRequested({
      requestId: comment.pendingRequestId,
      commentId: comment.id,
      status: comment.pendingStatus,
    }))
  }
}
