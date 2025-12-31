/**
 * 缓存辅助工具
 * 用于减少数据库查询次数，降低 Cloudflare D1 的行读取量
 */

// 全局缓存对象
const CACHE = {
  tableStructures: new Map(), // 表结构缓存
  mailboxIds: new Map(),      // 邮箱ID缓存
  userQuotas: new Map(),      // 用户配额缓存
  systemStats: new Map(),     // 系统统计数据缓存（COUNT 等）
  lastClearTime: Date.now()   // 上次清理时间
};

// 缓存过期时间配置（毫秒）
const CACHE_TTL = {
  tableStructure: 60 * 60 * 1000,   // 表结构缓存1小时
  mailboxId: 10 * 60 * 1000,        // 邮箱ID缓存10分钟
  userQuota: 5 * 60 * 1000,         // 用户配额缓存5分钟
  systemStats: 10 * 60 * 1000,      // 系统统计缓存10分钟
  clearInterval: 30 * 60 * 1000     // 每30分钟清理一次过期缓存
};

/**
 * 获取表结构信息（带缓存）
 * @param {object} db - 数据库连接
 * @param {string} tableName - 表名
 * @returns {Promise<Array>} 列信息数组
 */
export async function getCachedTableStructure(db, tableName) {
  const cacheKey = tableName;
  const cached = CACHE.tableStructures.get(cacheKey);
  
  // 检查缓存是否有效
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL.tableStructure) {
    return cached.data;
  }
  
  // 查询数据库
  try {
    const res = await db.prepare(`PRAGMA table_info(${tableName})`).all();
    const cols = (res?.results || []).map(r => ({
      name: r.name || r?.['name'],
      type: r.type || r?.['type'],
      notnull: r.notnull ? 1 : 0,
      dflt_value: r.dflt_value
    }));
    
    // 更新缓存
    CACHE.tableStructures.set(cacheKey, {
      data: cols,
      timestamp: Date.now()
    });
    
    return cols;
  } catch (e) {
    console.error('获取表结构失败:', e);
    return [];
  }
}

/**
 * 检查列是否存在（使用缓存的表结构）
 * @param {object} db - 数据库连接
 * @param {string} tableName - 表名
 * @param {string} columnName - 列名
 * @returns {Promise<boolean>} 列是否存在
 */
export async function hasColumn(db, tableName, columnName) {
  const cols = await getCachedTableStructure(db, tableName);
  return cols.some(c => c.name === columnName);
}

/**
 * 获取邮箱ID（带缓存）
 * @param {object} db - 数据库连接
 * @param {string} address - 邮箱地址
 * @returns {Promise<number|null>} 邮箱ID
 */
export async function getCachedMailboxId(db, address) {
  const normalized = String(address || '').trim().toLowerCase();
  if (!normalized) return null;
  
  const cached = CACHE.mailboxIds.get(normalized);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL.mailboxId) {
    return cached.id;
  }
  
  // 查询数据库
  const res = await db.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(normalized).all();
  const id = (res.results && res.results.length) ? res.results[0].id : null;
  
  // 更新缓存（即使是 null 也缓存，避免重复查询不存在的邮箱）
  CACHE.mailboxIds.set(normalized, {
    id,
    timestamp: Date.now()
  });
  
  return id;
}

/**
 * 更新邮箱ID缓存
 * @param {string} address - 邮箱地址
 * @param {number} id - 邮箱ID
 */
export function updateMailboxIdCache(address, id) {
  const normalized = String(address || '').trim().toLowerCase();
  if (!normalized || !id) return;
  
  CACHE.mailboxIds.set(normalized, {
    id,
    timestamp: Date.now()
  });
}

/**
 * 使邮箱ID缓存失效
 * @param {string} address - 邮箱地址
 */
export function invalidateMailboxCache(address) {
  const normalized = String(address || '').trim().toLowerCase();
  CACHE.mailboxIds.delete(normalized);
}

/**
 * 获取用户配额（带缓存）
 * @param {object} db - 数据库连接
 * @param {number} userId - 用户ID
 * @returns {Promise<object>} {used, limit}
 */
export async function getCachedUserQuota(db, userId) {
  const cached = CACHE.userQuotas.get(userId);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL.userQuota) {
    return cached.data;
  }
  
  // 查询数据库
  const ures = await db.prepare('SELECT mailbox_limit FROM users WHERE id = ?').bind(userId).all();
  const limit = ures?.results?.[0]?.mailbox_limit ?? 10;
  const cres = await db.prepare('SELECT COUNT(1) AS c FROM user_mailboxes WHERE user_id = ?').bind(userId).all();
  const used = cres?.results?.[0]?.c || 0;
  
  const data = { used, limit };
  
  // 更新缓存
  CACHE.userQuotas.set(userId, {
    data,
    timestamp: Date.now()
  });
  
  return data;
}

/**
 * 使用户配额缓存失效
 * @param {number} userId - 用户ID
 */
export function invalidateUserQuotaCache(userId) {
  CACHE.userQuotas.delete(userId);
}

/**
 * 获取系统统计数据（带缓存）
 * @param {object} db - 数据库连接
 * @param {string} statKey - 统计类型（如 'total_mailboxes', 'total_messages'）
 * @param {Function} queryFn - 查询函数
 * @returns {Promise<number>} 统计数值
 */
export async function getCachedSystemStat(db, statKey, queryFn) {
  const cached = CACHE.systemStats.get(statKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL.systemStats) {
    return cached.value;
  }
  
  // 执行查询函数
  const value = await queryFn(db);
  
  // 更新缓存
  CACHE.systemStats.set(statKey, {
    value,
    timestamp: Date.now()
  });
  
  return value;
}

/**
 * 使系统统计缓存失效
 * @param {string} statKey - 统计类型，不提供则清空所有统计缓存
 */
export function invalidateSystemStatCache(statKey = null) {
  if (statKey) {
    CACHE.systemStats.delete(statKey);
  } else {
    CACHE.systemStats.clear();
  }
}

/**
 * 清理过期缓存
 */
export function clearExpiredCache() {
  const now = Date.now();
  
  // 避免频繁清理
  if (now - CACHE.lastClearTime < CACHE_TTL.clearInterval) {
    return;
  }
  
  CACHE.lastClearTime = now;
  
  // 清理过期的邮箱ID缓存
  for (const [key, value] of CACHE.mailboxIds.entries()) {
    if (now - value.timestamp > CACHE_TTL.mailboxId) {
      CACHE.mailboxIds.delete(key);
    }
  }
  
  // 清理过期的用户配额缓存
  for (const [key, value] of CACHE.userQuotas.entries()) {
    if (now - value.timestamp > CACHE_TTL.userQuota) {
      CACHE.userQuotas.delete(key);
    }
  }
  
  // 清理过期的系统统计缓存
  for (const [key, value] of CACHE.systemStats.entries()) {
    if (now - value.timestamp > CACHE_TTL.systemStats) {
      CACHE.systemStats.delete(key);
    }
  }
}

/**
 * 清空所有缓存
 */
export function clearAllCache() {
  CACHE.tableStructures.clear();
  CACHE.mailboxIds.clear();
  CACHE.userQuotas.clear();
  CACHE.systemStats.clear();
  CACHE.lastClearTime = Date.now();
}

/**
 * LRU 缓存类
 * 使用 Map 数据结构实现 LRU（最近最少使用）缓存淘汰策略
 */
class LRUCache {
  /**
   * @param {number} capacity - 缓存容量
   * @param {number} ttl - 缓存过期时间（毫秒）
   */
  constructor(capacity = 1000, ttl = 3600000) {
    this.capacity = capacity;
    this.ttl = ttl;
    this.cache = new Map();
  }

  /**
   * 获取缓存值
   * @param {string} key - 缓存键
   * @returns {any|null} 缓存值，不存在或过期返回 null
   */
  get(key) {
    if (!this.cache.has(key)) {
      return null;
    }

    const item = this.cache.get(key);

    // 检查是否过期
    if (Date.now() - item.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    // LRU: 将访问的项移到 Map 末尾（删除后重新插入）
    this.cache.delete(key);
    this.cache.set(key, item);

    return item.value;
  }

  /**
   * 设置缓存值
   * @param {string} key - 缓存键
   * @param {any} value - 缓存值
   */
  set(key, value) {
    // 如果 key 已存在，先删除（更新时间戳）
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // 检查容量，如果超过则删除最旧的项（Map 的第一个元素）
    if (this.cache.size >= this.capacity) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    // 添加新项
    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
  }

  /**
   * 删除缓存项
   * @param {string} key - 缓存键
   */
  delete(key) {
    this.cache.delete(key);
  }

  /**
   * 清空所有缓存
   */
  clear() {
    this.cache.clear();
  }

  /**
   * 获取当前缓存大小
   * @returns {number}
   */
  size() {
    return this.cache.size;
  }
}

/**
 * 邮件内容缓存实例
 * 容量：1000 封邮件
 * TTL：1 小时（3600000 毫秒）
 */
const emailContentCache = new LRUCache(1000, 3600000);

/**
 * 缓存邮件内容
 * @param {string|number} emailId - 邮件ID
 * @param {object} content - 邮件内容对象 { text_content, html_content, ... }
 */
export function cacheEmailContent(emailId, content) {
  const key = `email_content_${emailId}`;
  emailContentCache.set(key, content);
}

/**
 * 获取缓存的邮件内容
 * @param {string|number} emailId - 邮件ID
 * @returns {object|null} 邮件内容对象，不存在或过期返回 null
 */
export function getCachedEmailContent(emailId) {
  const key = `email_content_${emailId}`;
  return emailContentCache.get(key);
}

/**
 * 使邮件内容缓存失效
 * @param {string|number} emailId - 邮件ID
 */
export function invalidateEmailContentCache(emailId) {
  const key = `email_content_${emailId}`;
  emailContentCache.delete(key);
}

