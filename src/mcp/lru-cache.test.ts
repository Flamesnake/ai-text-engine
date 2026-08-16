import { describe, expect, it } from 'vitest'
import { LruCache } from './lru-cache.js'

describe('LruCache', () => {
  it('超出上限淘汰最久未访问的条目', () => {
    const cache = new LruCache<string, number>(3)
    for (let i = 1; i <= 5; i++) cache.set(`k${i}`, i)
    expect(cache.size).toBe(3)
    expect(cache.has('k1')).toBe(false) // k1/k2 被淘汰
    expect(cache.has('k2')).toBe(false)
    expect(cache.get('k3')).toBe(3)
    expect(cache.get('k4')).toBe(4)
    expect(cache.get('k5')).toBe(5)
  })

  it('get 刷新访问顺序：最近读过的条目不被淘汰', () => {
    const cache = new LruCache<string, number>(3)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    cache.get('a') // a 变最近使用
    cache.set('d', 4)
    expect(cache.has('a')).toBe(true) // a 保留
    expect(cache.has('b')).toBe(false) // b 被淘汰
  })

  it('重复 set 覆盖值并刷新顺序', () => {
    const cache = new LruCache<string, number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('a', 10) // a 刷新 + 覆盖
    cache.set('c', 3)
    expect(cache.get('a')).toBe(10)
    expect(cache.has('b')).toBe(false)
  })

  it('delete / clear / size / has 基础行为', () => {
    const cache = new LruCache<string, number>(10)
    expect(cache.get('x')).toBeUndefined()
    cache.set('x', 1)
    expect(cache.has('x')).toBe(true)
    expect(cache.delete('x')).toBe(true)
    expect(cache.delete('x')).toBe(false)
    cache.set('y', 2)
    cache.clear()
    expect(cache.size).toBe(0)
  })

  it('非正数上限抛 RangeError', () => {
    expect(() => new LruCache(0)).toThrow(RangeError)
    expect(() => new LruCache(1.5)).toThrow(RangeError)
  })
})