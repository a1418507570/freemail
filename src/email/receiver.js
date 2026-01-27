/**
 * 邮件接收处理模块
 * @module email/receiver
 */

import { extractEmail } from '../utils/common.js';
import { getOrCreateMailboxId } from '../db/index.js';
import { parseEmailBody, extractVerificationCode } from './parser.js';

/**
 * 安全截断内容以符合 D1 2MB/行限制
 * @param {string} str - 待截断字符串
 * @param {number} maxBytes - 最大字节数
 * @returns {string} 截断后的字符串
 */
function truncateByBytes(str, maxBytes) {
  if (!str) return '';
  const encoder = new TextEncoder();
  const encoded = encoder.encode(str);
  if (encoded.length <= maxBytes) return str;
  // 截断并解码，处理可能的不完整 UTF-8 序列
  const truncated = encoded.slice(0, maxBytes);
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(truncated);
  } catch (_) {
    return str.slice(0, Math.floor(maxBytes / 3)); // 回退到字符截断
  }
}

/**
 * 处理通过 HTTP 接收的邮件
 * @param {Request} request - HTTP 请求对象
 * @param {object} db - 数据库连接
 * @param {object} env - 环境变量
 * @returns {Promise<Response>} HTTP 响应
 */
export async function handleEmailReceive(request, db, env) {
  try {
    const emailData = await request.json();
    const to = String(emailData?.to || '');
    const from = String(emailData?.from || '');
    const subject = String(emailData?.subject || '(无主题)');
    const text = String(emailData?.text || '');
    const html = String(emailData?.html || '');

    const mailbox = extractEmail(to);
    const sender = extractEmail(from);
    const mailboxId = await getOrCreateMailboxId(db, mailbox);

    // 截断内容以防止 D1 行大小限制错误（保守设置为 400KB 每字段）
    const textContent = truncateByBytes(text, 400 * 1024);
    const htmlContent = truncateByBytes(html, 400 * 1024);

    const previewBase = (text || html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const preview = String(previewBase || '').slice(0, 120);
    let verificationCode = '';
    try {
      verificationCode = extractVerificationCode({ subject, text, html });
    } catch (_) { }

    await db.prepare(`
      INSERT INTO messages (mailbox_id, sender, to_addrs, subject, verification_code, preview, text_content, html_content)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      mailboxId,
      sender,
      String(to || ''),
      subject || '(无主题)',
      verificationCode || null,
      preview || null,
      textContent || '',
      htmlContent || ''
    ).run();

    return Response.json({ success: true });
  } catch (error) {
    console.error('处理邮件时出错:', error);
    return new Response('处理邮件失败', { status: 500 });
  }
}
