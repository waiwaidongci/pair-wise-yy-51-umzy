// 仅供 scripts/ 下的纯逻辑验证使用：在 Node 中以最小实现替代 @ngrx/store
export function createAction(type) {
  const creator = (payload) => ({ type, ...payload })
  creator.type = type
  return creator
}
export function props() {
  return null
}
export function on(actionCreator, reducer) {
  return { type: actionCreator.type, reducer }
}
export function createReducer(initial, ...handlers) {
  const map = new Map(handlers.map((h) => [h.type, h.reducer]))
  return (state = initial, action) => {
    const reducer = map.get(action.type)
    return reducer ? reducer(state, action) : state
  }
}
