import { inject, Injectable } from '@angular/core'
import { Actions, createEffect, ofType } from '@ngrx/effects'
import { Store } from '@ngrx/store'
import { catchError, forkJoin, from, map, of, switchMap, tap } from 'rxjs'
import { RouteApiService } from '../services/route-api.service'
import {
  CountersignApiService,
  type RouteSubmission,
} from '../services/countersign-api.service'
import * as RouteActions from './route.actions'
import { RouteState } from './route.reducer'
import type { RiskSegment, RoutePackage } from '../types'

/** 双窗口演示：窗口 A 对全部高风险区段降速，窗口 B 给出另一套速度/里程调整 */
function buildWindowSubmissions(route: { routeVersion: number; permit: string; segments: RiskSegment[] }): RouteSubmission[] {
  const windowA: RouteSubmission = {
    windowName: '窗口A · 兰州值班台',
    baseVersion: route.routeVersion,
    permit: route.permit,
    segments: route.segments.map((segment) => segment.level === '高'
      ? { ...segment, speed: segment.speed.replace(/\d+/, (value) => String(Math.max(30, Number(value) - 10))) }
      : segment),
  }
  const windowB: RouteSubmission = {
    windowName: '窗口B · 郑州值班台',
    baseVersion: route.routeVersion,
    permit: route.permit,
    segments: route.segments.map((segment, index) => segment.level === '高'
      ? { ...segment, speed: segment.speed.replace(/\d+/, (value) => String(Math.max(30, Number(value) - 20))), km: (Number(segment.km) + 2.5 * (index + 1)).toFixed(1) }
      : segment),
  }
  return [windowA, windowB]
}

@Injectable()
export class RouteEffects {
  private readonly actions$ = inject(Actions)
  private readonly api = inject(RouteApiService)
  private readonly countersignApi = inject(CountersignApiService)
  private readonly store = inject(Store<{ routes: RouteState }>)

  loadRoutes$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.loadRoutes),
    switchMap(() => this.api.getRoutePackages().pipe(
      tap((routes) => routes.forEach((route) => this.countersignApi.seedRouteVersion(route.id, route.routeVersion ?? 3))),
      map((routes) => RouteActions.loadRoutesSuccess({ routes })),
      catchError((error: unknown) => of(RouteActions.loadRoutesFailure({ error: error instanceof Error ? error.message : '无法读取路径数据' }))),
    )),
  ))

  /**
   * 确认保存：requestId 在“发起”时生成并随失败保留，
   * 重试复用同一 requestId，服务端按幂等键去重，审计只记一条。
   */
  resolveComment$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.resolveCommentRequested),
    switchMap(({ requestId, commentId, status }) => {
      let routeId = ''
      let routeVersion = 0
      let author = ''
      let role = ''
      this.store.select((state: { routes: RouteState }): RouteState => state.routes).subscribe((state) => {
        const comment = state.comments.find((item) => item.id === commentId)
        const route = comment ? state.routes.find((item) => item.id === comment.routeId) : undefined
        routeId = comment?.routeId ?? ''
        routeVersion = route?.routeVersion ?? 0
        author = comment?.author ?? ''
        role = comment?.role ?? ''
      }).unsubscribe()
      return from(this.countersignApi.resolveComment({ requestId, commentId, routeId, routeVersion, status, author, role })).pipe(
        map(() => RouteActions.resolveCommentSuccess({ requestId, commentId, status })),
        catchError((error: unknown) => {
          // 失败时待处理确认留在服务端，可通过“恢复待处理意见”取回
          this.countersignApi.stashPendingResolve({ requestId, commentId, routeId, routeVersion, status, author, role })
          return of(RouteActions.resolveCommentFailure({
            requestId,
            commentId,
            error: error instanceof Error ? error.message : '确认保存失败',
          }))
        }),
      )
    }),
  ))

  restorePendingResolves$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.restorePendingResolves),
    switchMap(({ routeId }) => from(this.countersignApi.fetchPendingResolves(routeId)).pipe(
      map((pending) => RouteActions.restorePendingResolvesSuccess({ pending })),
      catchError(() => of(RouteActions.restorePendingResolvesSuccess({ pending: [] }))),
    )),
  ))

  /**
   * 两个窗口同时提交同一运输单：
   * 服务端串行裁决，先提交的成为当前版本，后到的逐区段返回冲突。
   */
  submitConcurrentWindows$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.submitConcurrentWindows),
    switchMap(({ routeId }) => {
      let route: RoutePackage | undefined
      this.store.select((state: { routes: RouteState }): RouteState => state.routes).subscribe((state) => {
        route = state.routes.find((item) => item.id === routeId)
      }).unsubscribe()
      if (!route) return of(RouteActions.dismissConflict({ routeId }))

      this.countersignApi.resetSubmissions(routeId, route.routeVersion)
      const [windowA, windowB] = buildWindowSubmissions(route)

      // 两个窗口几乎同时发起；服务端保证按到达顺序裁决
      return forkJoin([
        from(this.countersignApi.submitRouteVersion(routeId, route, windowA)),
        from(this.countersignApi.submitRouteVersion(routeId, route, windowB)),
      ]).pipe(
        switchMap(([resultA, resultB]) => {
          const actions: (ReturnType<typeof RouteActions.routeVersionAccepted> | ReturnType<typeof RouteActions.routeVersionConflict>)[] = []
          if (resultA.outcome === 'accepted') actions.push(RouteActions.routeVersionAccepted({ result: resultA }))
          if (resultB.outcome === 'accepted') actions.push(RouteActions.routeVersionAccepted({ result: resultB }))
          if (resultA.outcome === 'conflict') actions.push(RouteActions.routeVersionConflict({
            conflict: { routeId: resultA.routeId, windowName: resultA.windowName, baseVersion: resultA.baseVersion, currentVersion: resultA.currentVersion, segments: resultA.segments },
          }))
          if (resultB.outcome === 'conflict') actions.push(RouteActions.routeVersionConflict({
            conflict: { routeId: resultB.routeId, windowName: resultB.windowName, baseVersion: resultB.baseVersion, currentVersion: resultB.currentVersion, segments: resultB.segments },
          }))
          return from(actions)
        }),
        catchError(() => of(RouteActions.dismissConflict({ routeId }))),
      )
    }),
  ))
}
