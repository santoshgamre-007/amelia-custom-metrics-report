'use strict';
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
/** config.yaml (optional) + environment variables (AMELIA_URL, AMELIA_USER, AMELIA_PASSWORD, AMELIA_COOKIE, PORT). */
function loadConfig(root, env = process.env) {
  const file = env.AMELIA_METRICS_CONFIG || path.join(root, 'config.yaml'); let cfg = {};
  if (fs.existsSync(file)) { try { cfg = YAML.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (e) { throw new Error(`config.yaml could not be read: ${e.message}`); } }
  const c = cfg.connection || {}; const conn = { base_url: env.AMELIA_URL || c.base_url || '', auth_mode: c.auth_mode || (env.AMELIA_COOKIE ? 'session_cookie' : 'password'), username: env.AMELIA_USER || c.username || '', password: env.AMELIA_PASSWORD || c.password || '', session_cookie: env.AMELIA_COOKIE || c.session_cookie || '' };
  const d = cfg.defaults || {}; const rel = (p, dflt) => path.resolve(root, p || dflt);
  const h = cfg.hosted || {}; const list = (v) => String(v || '').split(/[\s,;]+/).filter(Boolean);
  const hosted = { enabled: env.HOSTED === '1' || env.HOSTED === 'true' || h.enabled === true, accessCode: String(env.ACCESS_CODE || h.access_code || ''), allowedHosts: list(env.ALLOWED_AMELIA_HOSTS || (Array.isArray(h.allowed_amelia_hosts) ? h.allowed_amelia_hosts.join(' ') : h.allowed_amelia_hosts)),
    idleMinutes: Number(env.IDLE_MINUTES || h.idle_minutes) || 45, maxVisitors: Number(env.MAX_VISITORS || h.max_visitors) || 20, maxUploadMb: Number(env.MAX_UPLOAD_MB || h.max_upload_mb) || 100, allowInsecureAmelia: env.ALLOW_INSECURE_AMELIA === '1' };
  return { hosted, host: env.HOST || (hosted.enabled ? '0.0.0.0' : '127.0.0.1'), port: Number(env.PORT || (cfg.server && cfg.server.port) || 8740), reportsDir: rel(env.REPORTS_DIR || cfg.reports_dir, 'reports'), dictionariesDir: rel(cfg.dictionaries_dir, 'dictionaries'), templatePath: cfg.template ? rel(cfg.template) : undefined, powerpoint: cfg.powerpoint !== false,
    defaultDictionary: String(cfg.default_dictionary || ''), containedCalls: (Array.isArray(cfg.contained_calls) ? cfg.contained_calls : []).map(String).filter(Boolean), connection: conn, hasConnection: !!(conn.base_url && (conn.session_cookie || (conn.username && conn.password))), defaults: { customer: d.customer || '', timezone: d.timezone || 'UTC', domain: d.domain || '', days: Number(d.days) || 7, timeLabel: d.time_label || '' } };
}
module.exports = { loadConfig };
