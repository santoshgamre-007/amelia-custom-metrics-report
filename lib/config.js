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
  return { port: Number(env.PORT || (cfg.server && cfg.server.port) || 8740), reportsDir: rel(cfg.reports_dir, 'reports'), dictionariesDir: rel(cfg.dictionaries_dir, 'dictionaries'), templatePath: cfg.template ? rel(cfg.template) : undefined, powerpoint: cfg.powerpoint !== false,
    defaultDictionary: String(cfg.default_dictionary || ''), containedCalls: (Array.isArray(cfg.contained_calls) ? cfg.contained_calls : []).map(String).filter(Boolean), connection: conn, hasConnection: !!(conn.base_url && (conn.session_cookie || (conn.username && conn.password))), defaults: { customer: d.customer || '', timezone: d.timezone || 'UTC', domain: d.domain || '', days: Number(d.days) || 7, timeLabel: d.time_label || '' } };
}
module.exports = { loadConfig };
