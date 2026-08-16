/**
 * 简易 LRU 缓存：超出 max 时淘汰最久未访问的条目。
 *
 * 基于 Map 的键序（插入序）实现，get/set 都会把条目刷新到末尾；
 * 淘汰时取表头（最久未访问）。适用于长驻进程里「最近使用的少量原始内容」
 * 这类场景——例如 projects.ts 的冲突检测缓存。
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>()

  constructor(private readonly max: number) {
    if (!Number.isInteger(max) || max < 1) {
      throw new RangeError(`LruCache 上限必须是正整数，收到 ${max}`)
    }
  }

  get size(): number {
    return this.map.size
  }

  has(key: K): boolean {
    return this.map.has(key)
  }

  /** 读取并把条目刷新为最近使用；不存在返回 undefined。 */
  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined
    const value = this.map.get(key) as V
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  /** 写入（覆盖）并把条目刷新为最近使用；超出上限时淘汰最久未访问。 */
  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    this.evict()
  }

  delete(key: K): boolean {
    return this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }

  private evict(): void {
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) return
      this.map.delete(oldest)
    }
  }
}