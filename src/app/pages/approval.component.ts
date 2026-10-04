import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatTabsModule } from '@angular/material/tabs'
import { MatChipsModule } from '@angular/material/chips'
import { MatIconModule } from '@angular/material/icon'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'
import type { BaselineSnapshot, RoutePackage } from '../types'

@Component({
  selector: 'app-approval',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTabsModule, MatChipsModule, MatIconModule],
  template: `
    <main class="page">
      <div class="page-head">
        <div><p class="eyebrow">安全 · 运营 · 应急会签</p><h1>逐区段审批与退回</h1><p>每条意见锚定路径版本，路径变更后已确认意见立即失效并按新版本重新确认。</p></div>
        <div class="head-actions">
          @if (!selectedRoute?.countersign) { <button mat-stroked-button (click)="enterCountersign()">进入会签</button> }
          <button mat-flat-button color="primary" (click)="lockBaseline()">确认并锁定基线</button>
        </div>
      </div>

      @if (selectedRoute) {
        <section class="card version-card">
          <div class="version-head">
            <div><span class="version-tag">当前路径版本</span><strong class="version-num">v{{ selectedRoute.pathVersion }}</strong></div>
            <div class="status-chips">
              @if (selectedRoute.countersign) { <mat-chip highlighted color="accent">会签中</mat-chip> }
              @if (selectedRoute.baselineLocked) { <mat-chip highlighted color="primary">基线已锁定</mat-chip> }
            </div>
          </div>
          <div class="demo-row">
            <span class="demo-label">演示：</span>
            <button mat-stroked-button (click)="simulateSegmentChange()">模拟路径区段变更</button>
            <button mat-stroked-button (click)="simulatePermitChange()">模拟许可变更</button>
            <button mat-stroked-button (click)="simulateConcurrent()">模拟两窗口并发提交</button>
            <button mat-stroked-button (click)="migrate()">迁移旧意见到当前版本</button>
          </div>
          @if (baseline) {
            <div class="baseline-box">
              <b>锁定基线</b>
              <span>路径版本 v{{ baseline.pathVersion }} · 锁定于 {{ baseline.lockedAt }} · {{ baseline.segmentCount }} 个区段 · {{ baseline.comments.length }} 条原意见</span>
              <small>许可：{{ baseline.permit }}</small>
              <small class="muted">基线保留原路径版本与原意见，只读保存。</small>
            </div>
          }
        </section>
      }

      <mat-tab-group>
        <mat-tab label="待处理意见">
          <section class="card comment-list">
            @for (comment of (state$ | async)?.comments || []; track comment.id) {
              <div class="comment" [class.invalidated]="comment.status === '已失效'">
                <div class="comment-head">
                  <div><b>{{comment.role}} · {{comment.author}}</b><small>{{comment.segmentId}} · {{comment.id}} · 路径版本 v{{comment.pathVersion ?? '?'}}</small></div>
                  <span class="status-badge" [class]="'status-' + comment.status">{{comment.status}}</span>
                </div>
                <p>{{comment.content}}</p>
                @if (comment.status === '已失效') {
                  <p class="invalidated-note">路径版本已变更，该意见依据旧版本失效，需按当前版本重新确认。</p>
                }
                <div class="actions">
                  @if (comment.status === '已失效') {
                    <button mat-flat-button color="primary" (click)="reconfirm(comment.id)">按 v{{ selectedRoute?.pathVersion }} 重新确认</button>
                  } @else {
                    <button mat-stroked-button color="warn" (click)="resolve(comment.id,'已退回')">退回补件</button>
                    <button mat-flat-button color="primary" (click)="resolve(comment.id,'已接受')">接受条件</button>
                  }
                </div>
              </div>
            }
          </section>
        </mat-tab>

        <mat-tab label="发表区段意见">
          <section class="card form-card">
            <div class="two">
              <mat-form-field><mat-label>专业角色</mat-label><mat-select [(ngModel)]="role"><mat-option>安全</mat-option><mat-option>运营</mat-option><mat-option>应急</mat-option></mat-select></mat-form-field>
              <mat-form-field><mat-label>区段</mat-label><mat-select [(ngModel)]="segmentId"><mat-option *ngFor="let segment of segments" [value]="segment.id">{{segment.id}} · {{segment.name}}</mat-option></mat-select></mat-form-field>
            </div>
            <mat-form-field class="wide"><mat-label>审批条件与依据</mat-label><textarea matInput rows="5" [(ngModel)]="content" placeholder="明确区段、约束、时限与验收证据"></textarea></mat-form-field>
            <button mat-flat-button color="primary" [disabled]="!content.trim()" (click)="addComment()">提交意见</button>
          </section>
        </mat-tab>

        <mat-tab [label]="'待恢复意见' + (pendingCount ? ' (' + pendingCount + ')' : '')">
          <section class="card comment-list">
            <div class="recover-bar">
              <span>保存失败后从服务端恢复待处理意见，重试确认幂等，不生成重复审计记录。</span>
              <button mat-stroked-button (click)="recover()">从服务端恢复</button>
            </div>
            @for (item of pendingComments; track item.idempotencyKey) {
              <div class="comment pending" [class.failed]="item.status === '保存失败'">
                <div class="comment-head">
                  <div><b>{{item.comment.role}} · {{item.comment.author}}</b><small>{{item.comment.segmentId}} · {{item.comment.id}} · {{item.idempotencyKey}}</small></div>
                  <span class="status-badge" [class]="'status-' + item.status">{{item.status}}</span>
                </div>
                <p>{{item.comment.content}}</p>
                @if (item.lastError) { <p class="error-note">失败原因：{{item.lastError}}（已重试 {{item.attempts}} 次）</p> }
                <div class="actions">
                  <button mat-flat-button color="primary" (click)="retry(item.idempotencyKey)">重试确认</button>
                </div>
              </div>
            }
            @if (!pendingComments.length) { <p class="empty-note">暂无待恢复意见。</p> }
          </section>
        </mat-tab>

        <mat-tab [label]="'并发冲突' + (conflicts.length ? ' (' + conflicts.length + ')' : '')">
          <section class="card comment-list">
            @for (conflict of conflicts; track conflict.id) {
              <div class="comment conflict">
                <div class="comment-head">
                  <div><b>窗口 {{conflict.window}} 提交落后</b><small>{{conflict.routeId}} · {{conflict.detectedAt}}</small></div>
                  <span class="status-badge status-已退回">冲突</span>
                </div>
                <p>先提交的路径版本 <b>v{{conflict.winnerVersion}}</b> 成为当前版本，后到内容（v{{conflict.loserVersion}}）留成冲突。</p>
                @if (conflict.differingSegments.length) {
                  <div class="diff-list">
                    @for (diff of conflict.differingSegments; track diff.segmentId) {
                      <div class="diff-item"><b>{{diff.segmentId}} · {{diff.segmentName}}</b>
                        @for (change of diff.changes; track change.field) {
                          <span class="diff-change">{{change.label}}：<s>{{change.from}}</s> → <em>{{change.to}}</em></span>
                        }
                      </div>
                    }
                  </div>
                } @else { <p class="muted">区段内容无差异。</p> }
              </div>
            }
            @if (!conflicts.length) { <p class="empty-note">暂无并发冲突。可点击「模拟两窗口并发提交」演示先到版本生效、后到留冲突。</p> }
          </section>
        </mat-tab>

        <mat-tab label="审计时间线">
          <section class="card timeline">
            @for (record of auditRecords; track record.id) {
              <div><i></i><b>{{record.time}} · {{record.action}}</b><p>{{record.actor}} · {{record.detail}}</p></div>
            }
          </section>
        </mat-tab>
      </mat-tab-group>
    </main>
  `,
  styles: [`
    h2{margin:0}.comment-list{padding:0}.comment{padding:18px;border-bottom:1px solid #e7ebf1}.comment-head{display:flex;justify-content:space-between}.comment-head small{display:block;color:#7a8798;margin-top:4px}.comment p{color:#475569}.actions{display:flex;gap:10px}.actions button{margin:8px 8px 0 0}.form-card{max-width:780px}.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}.two mat-form-field,.wide{width:100%}.timeline{padding:8px 18px}.timeline>div{position:relative;padding:14px 10px 14px 28px;border-left:2px solid #cbd5e1}.timeline i{position:absolute;width:9px;height:9px;border-radius:50%;background:#2563eb;left:-5.5px;top:20px}.timeline p{color:#7a8798;margin:5px 0 0}
    .head-actions{display:flex;gap:10px;align-items:center}.version-card{margin-bottom:16px}.version-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}.version-tag{color:#7a8798;font-size:13px;margin-right:8px}.version-num{font-size:22px;color:#2563eb}.status-chips{display:flex;gap:6px}.demo-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px;padding-top:12px;border-top:1px dashed #e7ebf1}.demo-label{color:#7a8798;font-size:13px}.baseline-box{margin-top:14px;padding:12px 14px;background:#f5f8ff;border:1px solid #c7d7fe;border-radius:6px;display:flex;flex-direction:column;gap:4px}.baseline-box small{color:#475569}.muted{color:#94a3b8}.invalidated{background:#f8fafc}.invalidated .comment-head b{color:#94a3b8}.invalidated-note{color:#b45309;font-size:13px;margin:6px 0 0}.status-badge{padding:2px 10px;border-radius:12px;font-size:12px;white-space:nowrap}.status-待确认{background:#dbeafe;color:#1d4ed8}.status-已接受{background:#dcfce7;color:#15803d}.status-已退回{background:#fee2e2;color:#b91c1c}.status-已失效{background:#e2e8f0;color:#64748b}.status-待保存{background:#fef3c7;color:#b45309}.status-保存失败{background:#fee2e2;color:#b91c1c}.recover-bar{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 18px;background:#f8fafc;border-bottom:1px solid #e7ebf1;font-size:13px;color:#475569}.pending.failed{background:#fef2f2}.error-note{color:#b91c1c;font-size:13px;margin:6px 0 0}.empty-note{padding:24px;color:#94a3b8;text-align:center}.diff-list{margin-top:8px;display:flex;flex-direction:column;gap:6px}.diff-item{background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:8px 10px;display:flex;flex-direction:column;gap:4px}.diff-item b{font-size:13px}.diff-change{font-size:12px;color:#475569}.diff-change s{color:#94a3b8}.diff-change em{color:#b91c1c;font-style:normal}
    @media(max-width:620px){.two{grid-template-columns:1fr}.version-head{flex-direction:column;align-items:flex-start}}
  `],
})
export class ApprovalComponent {
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly state$ = this.store.select('routes')
  role = '安全'
  segmentId = 'S-203'
  content = ''
  segments: RoutePackage['segments'] = []
  selectedRoute: RoutePackage | undefined
  baseline: BaselineSnapshot | undefined
  pendingComments: RouteState['pendingComments'] = []
  conflicts: RouteState['conflicts'] = []
  auditRecords: RouteState['auditRecords'] = []

  get pendingCount() { return this.pendingComments.length }

  constructor() {
    this.state$.subscribe((state) => {
      this.segments = state.routes.flatMap((route: RoutePackage) => route.segments)
      this.selectedRoute = state.routes.find((route: RoutePackage) => route.id === state.selectedRouteId)
      this.baseline = this.selectedRoute ? state.baselines[this.selectedRoute.id] : undefined
      this.pendingComments = state.pendingComments
      this.conflicts = state.conflicts
      this.auditRecords = state.auditRecords
    })
  }

  enterCountersign() { if (this.selectedRoute) this.store.dispatch(RouteActions.enterCountersign({ routeId: this.selectedRoute.id })) }
  lockBaseline() { if (this.selectedRoute) this.store.dispatch(RouteActions.lockBaseline({ routeId: this.selectedRoute.id })) }
  migrate() { this.store.dispatch(RouteActions.migrateLegacyComments()) }
  reconfirm(id: string) { this.store.dispatch(RouteActions.reconfirmComment({ id })) }
  resolve(id: string, status: '已接受' | '已退回') { this.store.dispatch(RouteActions.resolveComment({ id, status })) }
  recover() { this.store.dispatch(RouteActions.recoverPendingComments()) }
  retry(idempotencyKey: string) { this.store.dispatch(RouteActions.retryPendingComment({ idempotencyKey })) }

  addComment() {
    if (!this.content.trim() || !this.selectedRoute) return
    this.store.dispatch(RouteActions.saveComment({
      comment: {
        id: `RV-${Date.now().toString().slice(-4)}`,
        segmentId: this.segmentId,
        role: this.role,
        author: '当前审阅人',
        content: this.content,
        status: '待确认',
        pathVersion: this.selectedRoute.pathVersion,
      },
    }))
    this.content = ''
  }

  simulateSegmentChange() {
    if (!this.selectedRoute) return
    const segments = this.selectedRoute.segments.map((segment) =>
      segment.id === 'S-207' ? { ...segment, speed: segment.speed === '限速 80' ? '限速 60' : '限速 80' } : { ...segment },
    )
    this.store.dispatch(RouteActions.updateRouteContent({ routeId: this.selectedRoute.id, segments, reason: '郑州北至商丘区段限速调整' }))
  }

  simulatePermitChange() {
    if (!this.selectedRoute) return
    const permit = this.selectedRoute.permit.includes('变更') ? this.selectedRoute.permit : `${this.selectedRoute.permit}（变更）`
    this.store.dispatch(RouteActions.updateRouteContent({ routeId: this.selectedRoute.id, permit, reason: '运输许可更新' }))
  }

  simulateConcurrent() {
    if (!this.selectedRoute) return
    const route = this.selectedRoute
    const base = route.pathVersion
    const windowASegments = route.segments.map((segment) => ({ ...segment }))
    const windowBSegments = route.segments.map((segment) => segment.id === 'S-203' ? { ...segment, speed: '限速 60' } : { ...segment })
    this.store.dispatch(RouteActions.submitRouteVersion({ routeId: route.id, baseVersion: base, segments: windowASegments, permit: route.permit, window: 'A' }))
    this.store.dispatch(RouteActions.submitRouteVersion({ routeId: route.id, baseVersion: base, segments: windowBSegments, permit: route.permit, window: 'B' }))
  }
}
