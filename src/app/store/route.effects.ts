import { inject, Injectable } from '@angular/core'
import { Actions, createEffect, ofType } from '@ngrx/effects'
import { catchError, map, mergeMap, of, switchMap } from 'rxjs'
import { RouteApiService } from '../services/route-api.service'
import { idempotencyKeyFor } from '../store/route.reducer'
import * as RouteActions from './route.actions'

@Injectable()
export class RouteEffects {
  private readonly actions$ = inject(Actions)
  private readonly api = inject(RouteApiService)

  loadRoutes$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.loadRoutes),
    switchMap(() => this.api.getRoutePackages().pipe(
      map((routes) => RouteActions.loadRoutesSuccess({ routes })),
      catchError((error: unknown) => of(RouteActions.loadRoutesFailure({ error: error instanceof Error ? error.message : '无法读取路径数据' }))),
    )),
  ))

  /** 保存意见：失败后从服务端恢复待处理意见；重试确认幂等，不生成重复审计 */
  saveComment$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.saveComment),
    mergeMap((action) => {
      const idempotencyKey = idempotencyKeyFor(action.comment.id)
      return this.api.saveComment(action.comment, idempotencyKey).pipe(
        map(({ comment, audit }) => RouteActions.saveCommentSuccess({ comment, audit })),
        catchError((error: unknown) => of(
          RouteActions.saveCommentFailure({ idempotencyKey, error: error instanceof Error ? error.message : '保存失败' }),
          RouteActions.recoverPendingComments(),
        )),
      )
    }),
  ))

  recoverPending$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.recoverPendingComments),
    switchMap(() => this.api.recoverPendingComments().pipe(
      map((comments) => RouteActions.recoverPendingCommentsSuccess({ comments })),
      catchError(() => of()),
    )),
  ))

  retryPending$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.retryPendingComment),
    mergeMap((action) => this.api.confirmPending(action.idempotencyKey).pipe(
      map(({ comment, audit }) => RouteActions.saveCommentSuccess({ comment, audit })),
      catchError((error: unknown) => of(RouteActions.saveCommentFailure({ idempotencyKey: action.idempotencyKey, error: error instanceof Error ? error.message : '重试失败' }))),
    )),
  ))
}
