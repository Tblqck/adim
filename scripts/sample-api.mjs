// Sample admin API: a local stand-in for the live /api/v1/admin routes with
// specimen data only (ICAO 9303 "Utopia" people, no real personal data), so
// the dashboard can be clicked through without touching production.
//
// Any password works. Sign in with a Firm ID to be that firm's head admin;
// leave Firm empty to be the back office. Writes are accepted and do nothing.
import http from 'node:http'
const now = Date.now()
const iso = (msAgo) => new Date(now - msAgo).toISOString()

const dbs = [
  { name: 'UN Security Council Consolidated List', agency: 'United Nations', region: 'Global', added: '2026-05-01', category: 'sanctions', status: 'CLEAR' },
  { name: 'OFAC SDN List', agency: 'US Treasury', region: 'United States', added: '2026-05-01', category: 'sanctions', status: 'HIT' },
  { name: 'EU Financial Sanctions', agency: 'European Commission', region: 'European Union', added: '2026-05-01', category: 'sanctions', status: 'CLEAR' },
  { name: 'Every Politician', agency: 'mySociety', region: 'Global', added: '2026-05-01', category: 'pep', status: 'HIT' },
  { name: 'Wikidata PEPs', agency: 'Wikidata', region: 'Global', added: '2026-05-01', category: 'pep', status: 'CLEAR' },
  { name: 'ICIJ Offshore Leaks', agency: 'ICIJ', region: 'Global', added: '2026-05-01', category: 'adverse_media', status: 'UNAVAILABLE' },
]

const screen = {
  subject_name: 'ANNA MARIA ERIKSSON',
  risk_classification: 'POTENTIAL_MATCH',
  banner: 'Potential match — review before approving',
  match_confidence: 0.82,
  summary: 'One candidate on a PEP list with a matching date of birth.',
  matches: [
    {
      name: 'Anna Maria Eriksson',
      score: 0.82,
      topics: ['role.pep', 'sanction'],
      datasets: ['everypolitician', 'us_ofac_sdn'],
      source_urls: ['https://example.org/specimen'],
      country: 'se',
      position: 'Specimen official',
      birth_date: '1974-08-12',
      notes: 'Specimen record for testing.',
    },
  ],
  databases_checked: dbs,
}

const rows = Array.from({ length: 7 }, (_, i) => ({
  id: 1040 + i,
  created_at: iso(i * 3_600_000 * 5),
  deleted_at: i === 5 ? iso(3_600_000) : null,
  country: ['SE', 'NG', 'GB', 'CY', 'DE', 'FR', 'GR'][i],
  doc_type: ['passport', 'national_id', 'drivers_license', 'passport', 'residence_permit', 'passport', 'national_id'][i],
  user_ref: `applicant-${1040 + i}`,
  verification_mode: [3, 1, 3, 2, 3, 1, 3][i],
  verified: [true, false, true, null, true, false, true][i],
  overall_verdict: ['pass', 'mrz_tampered', 'face_only_pass', 'both_weak', 'pass_mrz_warn', 'fail', 'mrz_face_pass'][i],
  confidence_score: [0.94, 0.31, 0.77, 0.52, 0.88, 0.12, 0.83][i],
  reviewed: i === 0,
  reviewed_by: i === 0 ? 'Jane Smith' : null,
  extracted_id_data: [{ full_name: i === 3 ? '' : ['ANNA MARIA ERIKSSON', 'SPECIMEN ADEBAYO', 'SPECIMEN JONES', 'x', 'SPECIMEN MUSTERMANN', 'SPECIMEN DUPONT', 'ΔΟΚΙΜΑΣΤΙΔΗΣ DOKIMASTIDIS'][i] }],
}))

const svg = (label, color) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="50%" fill="#fff" font-family="sans-serif" font-size="36" text-anchor="middle">${label}</text></svg>`)

const detail = (id) => ({
  ...(rows.find((r) => r.id === id) ?? rows[0]),
  id,
  images: { id_front_url: svg('ID front (specimen)', '#334155'), id_back_url: svg('ID back', '#1e293b'), face_urls: [svg('Frame 1', '#3f3f46'), svg('Frame 2', '#27272a')] },
  corrected_fields: { surname: 'ERIKSSON' },
  verdict_overrides: {},
  pipeline_response: {
    ocr_fields: { surname: 'ERIKSSON', given_names: 'ANNA MARIA', dob: '12/08/1974', id_number: 'L898902C3', nationality: 'UTOPIAN', expiry: '15/04/2012' },
    template_match: {
      front: {
        side: 'front', status: 'compared', verdict: id === 1041 ? 'no_match' : 'likely_match', score: id === 1041 ? 0.21 : 0.47,
        components: { orientation: 0.41, structure: 0.52, colour: 0.63, layout: 0.84 }, compared_fraction: 0.49, turned_180: false,
        lighting: { brightness: 0.46, glare_fraction: 0.012, shadow_fraction: 0.0, colour_cast: 0.21 }, templates_checked: 3, samples_agreeing: 2,
        template_id: 'tpl0se0passfront', template_label: '2022 design',
        card_frame: svgData(cardSvg('PASSPORT', '#e3e9f2')), template_frame: svgData(cardSvg('PASSPORT', '#e8eef7')),
      },
      back: { side: 'back', status: 'no_templates', verdict: null, templates_checked: 0, draft: { created: true, template_id: 'tpl2gr0niddraft' } },
    },
    mrz_by_side: {
      front: { parsed: true, format: 'TD3', document_number: 'L898902C3', date_of_birth_normalized: '1974-08-12', surname: 'ERIKSSON', given_names: 'ANNA MARIA', expiry_date_normalized: '2012-04-15', nationality: 'UTO', checksum_valid: { document_number: true, date_of_birth: true, expiry_date: true, composite: false } },
      back: null,
      expected_side: 'front',
    },
  },
  face_match_score: 0.91, face_match_verdict: 'strong_match',
  liveness_score: 0.73, liveness_verdict: 'pass', liveness_method: 'onnx',
  document_match_score: 0.66, document_match_verdict: 'likely_match',
  mrz_verdict: 'valid_with_warnings',
  ocr_word_count: 87,
  forensics_result: { verdict: 'suspicious', exif_present: false, ela_score: 14.2, editing_software_detected: false, resave_detected: true, risk_flags: ['missing_exif', 'elevated_ela'] },
  pep_result: screen,
})

// ── Templates (redacted specimen cards, drawn as SVG) ────────────────────
const cardSvg = (title, colour, redacted = true) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="630" viewBox="0 0 1000 630">` +
  `<rect width="1000" height="630" rx="28" fill="${colour}"/>` +
  `<rect x="0" y="0" width="1000" height="110" fill="#1e3a8a" opacity="0.85"/>` +
  `<text x="500" y="70" fill="#fff" font-family="sans-serif" font-size="40" text-anchor="middle">REPUBLIC OF UTOPIA · ${title}</text>` +
  `<text x="360" y="200" fill="#334" font-family="sans-serif" font-size="26">Surname</text>` +
  `<text x="360" y="300" fill="#334" font-family="sans-serif" font-size="26">Given names</text>` +
  `<text x="360" y="400" fill="#334" font-family="sans-serif" font-size="26">Date of birth</text>` +
  (redacted
    ? `<rect x="60" y="150" width="250" height="320" fill="#9aa"/><rect x="360" y="215" width="380" height="40" fill="#bbb"/>` +
      `<rect x="360" y="315" width="380" height="40" fill="#bbb"/><rect x="360" y="415" width="220" height="40" fill="#bbb"/>` +
      `<rect x="0" y="510" width="1000" height="110" fill="#ccc"/>`
    : `<rect x="60" y="150" width="250" height="320" fill="#557"/><text x="360" y="245" font-size="30" font-family="monospace">ERIKSSON</text>` +
      `<text x="360" y="345" font-size="30" font-family="monospace">ANNA MARIA</text><text x="360" y="445" font-size="30" font-family="monospace">12 08 1974</text>` +
      `<text x="40" y="560" font-size="30" font-family="monospace">P&lt;UTOERIKSSON&lt;&lt;ANNA&lt;MARIA&lt;&lt;&lt;&lt;&lt;&lt;</text>`) +
  `</svg>`
const specimenBoxes = [
  { kind: 'face', x: 0.06, y: 0.238, w: 0.25, h: 0.508, note: '' },
  { kind: 'text', x: 0.36, y: 0.341, w: 0.38, h: 0.063, note: 'value' },
  { kind: 'text', x: 0.36, y: 0.5, w: 0.38, h: 0.063, note: 'value' },
  { kind: 'text', x: 0.36, y: 0.659, w: 0.22, h: 0.063, note: 'value' },
  { kind: 'mrz', x: 0, y: 0.81, w: 1, h: 0.175, note: '' },
]
const templates = [
  { id: 'tpl0se0passfront', country: 'SE', doc_type: 'passport', side: 'front', status: 'active', label: '2022 design', reason: null, width: 1000, height: 630, boxes: specimenBoxes, source: 'verification:1040', created_at: iso(30 * 86_400_000), updated_at: iso(30 * 86_400_000), approved_at: iso(29 * 86_400_000), approved_by: 'Back office', match_count: 14, last_matched: iso(3_600_000), has_original: false, colour: '#e8eef7' },
  { id: 'tpl1ng0nidfront', country: 'NG', doc_type: 'national_id', side: 'front', status: 'active', label: 'NIN slip 2019', reason: null, width: 1000, height: 630, boxes: specimenBoxes, source: 'verification:1041', created_at: iso(20 * 86_400_000), updated_at: iso(20 * 86_400_000), approved_at: iso(19 * 86_400_000), approved_by: 'Back office', match_count: 6, last_matched: iso(86_400_000), has_original: false, colour: '#e7f5ea' },
  { id: 'tpl2gr0niddraft', country: 'GR', doc_type: 'national_id', side: 'front', status: 'draft', label: null, reason: 'First document received for this design.', width: 1000, height: 630, boxes: specimenBoxes.slice(0, 3), source: 'payload:2026-09-26_09-36-08_abc123', created_at: iso(7_200_000), updated_at: iso(7_200_000), approved_at: null, approved_by: null, match_count: 0, last_matched: null, has_original: true, colour: '#f5eee7' },
]
// Sample slots per design side, small here so a full side is easy to reach.
const SLOTS = 3
// Fill the Sweden passport front's slots and queue one more draft for it.
for (let i = 1; i <= 2; i++) {
  templates.push({ ...templates[0], id: `tpl0se0passfr${i}x`, label: `sample ${i + 1}`, match_count: 10 - i, approved_at: iso((20 - i) * 86_400_000) })
}
templates.push({ ...templates[2], id: 'tpl3se0passdraft', country: 'SE', doc_type: 'passport', reason: 'Matches this design; offered as another sample. 3 of 3 sample slots filled.', colour: '#e8eef7' })
const publicTemplate = ({ colour, ...t }) => t
const svgData = (svg) => 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)

const sessions = [
  { id: 1, firm_id: 1, created_at: iso(3_600_000), user_ref: 'applicant-2001', status: 'pending', opened_at: null, expires_at: iso(-20 * 3_600_000) },
  { id: 2, firm_id: 2, created_at: iso(7_200_000), user_ref: 'applicant-2002', status: 'pending', opened_at: iso(3_000_000), expires_at: iso(-10 * 3_600_000) },
  { id: 3, firm_id: 1, created_at: iso(30 * 3_600_000), user_ref: null, status: 'used', opened_at: iso(29 * 3_600_000), expires_at: iso(6 * 3_600_000) },
  { id: 4, firm_id: 2, created_at: iso(50 * 3_600_000), user_ref: 'applicant-1999', status: 'pending', opened_at: null, expires_at: iso(26 * 3_600_000), deleted_at: iso(2 * 3_600_000) },
]

const firms = [
  { id: 1, name: 'Northwind Compliance', slug: 'northwind' },
  { id: 2, name: 'Utopia Bank', slug: 'utopia-bank' },
  { id: 3, name: 'Old Firm Ltd', slug: 'old-firm', deleted_at: iso(5 * 3_600_000) },
]

const users = [
  { id: 11, username: 'jane', display_name: 'Jane Smith', can_create_users: true, active: true, created_at: iso(90 * 86_400_000) },
  { id: 12, username: 'omar', display_name: 'Omar Specimen', can_create_users: false, active: false, created_at: iso(30 * 86_400_000) },
]

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    const path = url.pathname.replace(/^\/api\/v1\/admin/, '')
    const m = req.method
    if (path === '/login' && m === 'POST') {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        const back = !new URLSearchParams(raw).get('firm')
        res.setHeader('set-cookie', `admin_session=${back ? 'sample-back' : 'sample-firm'}; HttpOnly; Path=/; SameSite=lax`)
        send(res, 200, { ok: true, super_admin: back, display_name: back ? 'Super Admin' : 'Jane Smith', can_create_users: true })
      })
      return
    }
    if (path === '/logout') {
      res.setHeader('set-cookie', 'admin_session=; Max-Age=0; Path=/')
      return send(res, 200, { ok: true })
    }
    const session = (req.headers.cookie || '').match(/admin_session=(sample-back|sample-firm)/)?.[1]
    if (!session) return send(res, 401, { detail: 'Not authenticated' })
    const role = session === 'sample-back' ? 'super' : 'firm'
    if (path === '/me')
      return send(res, 200, role === 'super'
        ? { super_admin: true, display_name: 'Super Admin' }
        : { super_admin: false, firm_id: 1, firm_slug: 'northwind', firm_name: 'Northwind Compliance', display_name: 'Jane Smith', is_head_admin: true, can_create_users: true })
    if (path === '/verifications') {
      let items = rows
      if (url.searchParams.get('verified') === 'true') items = rows.filter((r) => r.verified === true)
      if (url.searchParams.get('verified') === 'false') items = rows.filter((r) => r.verified === false)
      // Same rules as the live list_results: filters are exact, and q matches
      // only the stored full name, document number and user_ref.
      const sp = url.searchParams
      if (sp.get('doc_type')) items = items.filter((r) => r.doc_type === sp.get('doc_type'))
      if (sp.get('country')) items = items.filter((r) => r.country === sp.get('country').toUpperCase())
      const q = sp.get('q')?.toLowerCase()
      if (q) items = items.filter((r) => (r.extracted_id_data[0].full_name || '').toLowerCase().includes(q) || (r.user_ref || '').toLowerCase().includes(q))
      const size = Number(url.searchParams.get('page_size') || 25)
      return send(res, 200, { items: items.slice(0, size), total: items.length, page: 1, page_size: size })
    }
    // Delete / restore, with the live server's rules: a firm login soft-deletes
    // (deleted_at), a back-office delete needs ?confirm=true and is permanent,
    // links are always soft-deleted.
    const binMatch = path.match(/^\/(verifications|sessions)\/(\d+)(\/restore)?$/)
    if (binMatch && (m === 'DELETE' || (m === 'POST' && binMatch[3]))) {
      const list = binMatch[1] === 'verifications' ? rows : sessions
      const index = list.findIndex((item) => item.id === Number(binMatch[2]))
      if (index < 0) return send(res, 404, { detail: 'Not found' })
      if (binMatch[3]) {
        list[index].deleted_at = null
        return send(res, 200, { ok: true })
      }
      if (binMatch[1] === 'verifications' && role === 'super') {
        if (url.searchParams.get('confirm') !== 'true') return send(res, 400, { detail: 'Permanent delete requires ?confirm=true' })
        list.splice(index, 1)
        return send(res, 200, { ok: true, permanent: true })
      }
      list[index].deleted_at = new Date().toISOString()
      return send(res, 200, { ok: true, retention_hours: 24 })
    }
    const v = path.match(/^\/verifications\/(\d+)$/)
    if (v && m === 'GET') return send(res, 200, detail(Number(v[1])))
    if (v && m !== 'GET') return send(res, 200, { ok: true })
    if (path === '/sessions' && m === 'GET') return send(res, 200, { items: sessions })
    if (path === '/sessions' && m === 'POST') return send(res, 200, { ok: true, token: 'specimen-token', url: 'https://capture.example.org/index.html?token=specimen-token', expires_at: iso(-24 * 3_600_000) })
    if (path === '/firms') return send(res, 200, { items: firms })
    if (path === '/firm-users') return send(res, 200, { items: users })
    if (path === '/databases-catalog') return send(res, 200, { pep: dbs.filter((d) => d.category === 'pep'), sanctions: dbs.filter((d) => d.category === 'sanctions'), adverse_media: dbs.filter((d) => d.category === 'adverse_media') })
    if (path === '/screen' || path === '/screen-company') return send(res, 200, screen)
    if (path === '/firm-api-key') return send(res, 200, { firm_id: 1, firm_name: 'Northwind Compliance', firm_slug: 'northwind', has_key: true })
    // Audit log (production/audit_log.py): specimen people only.
    if (path === '/audit' && m === 'GET') {
      const H = 3_600_000
      const cat = { 'login.success': 'access', 'login.failed': 'access', 'verification.reviewed': 'verifications', 'verification.received': 'verifications', 'verification.binned': 'verifications', 'link.created': 'links', 'link.used': 'links', 'screen.person': 'screening', 'screen.company': 'screening', 'document.checked': 'screening', 'user.created': 'account', 'api_key.rotated': 'account', 'template.approved': 'templates', 'ip.auto_banned': 'security' }
      const ev = (n, ago, action, actor, summary, extra = {}) => ({ id: `a:${n}`, at: iso(ago), action, category: cat[action], actor, actor_type: 'user', firm_id: 1, target_type: null, target_id: null, summary, outcome: null, ip: null, detail: null, recorded: true, ...extra })
      let items = [
        ev(1, 0.2 * H, 'login.success', 'Jane Smith', 'Signed in', { ip: '203.0.113.24', outcome: 'ok' }),
        ev(2, 0.5 * H, 'verification.reviewed', 'Jane Smith', 'Approved verification #1042', { target_type: 'verification', target_id: '1042', outcome: 'ok' }),
        ev(3, 1.1 * H, 'screen.person', 'Jane Smith', 'Screened Specimen Person (GB)', { recorded: false, outcome: 'ok' }),
        ev(4, 2 * H, 'verification.received', 'APP-2231', 'Verification #1042 received · GB passport', { actor_type: 'applicant', target_type: 'verification', target_id: '1042', recorded: false, outcome: 'warning' }),
        ev(5, 2.4 * H, 'link.used', 'APP-2231', 'Applicant completed a verification link', { actor_type: 'applicant', target_type: 'link', target_id: '7', recorded: false, outcome: 'ok' }),
        ev(6, 3 * H, 'link.created', 'Tom Reed', 'Verification link generated for APP-2231', { target_type: 'link', target_id: '7' }),
        ev(7, 5 * H, 'login.failed', 'tom', 'Sign-in failed for northwind', { ip: '198.51.100.7', outcome: 'error' }),
        ev(8, 26 * H, 'user.created', 'Jane Smith', 'Added team member Tom Reed (tom)'),
        ev(9, 27 * H, 'document.checked', 'Jane Smith', 'Checked a SE passport · Specimen Person', { recorded: false, outcome: 'warning' }),
        ev(10, 28 * H, 'screen.company', 'Tom Reed', 'Screened company Specimen Holdings Ltd (GB)', { recorded: false, outcome: 'ok' }),
        ev(11, 30 * H, 'verification.binned', null, 'Verification #1017 moved to the recycle bin', { target_type: 'verification', target_id: '1017', recorded: false }),
        ev(12, 50 * H, 'api_key.rotated', 'Jane Smith', 'Generated a new API key (the old one stopped working)'),
      ]
      if (role === 'super') items.push(
        ev(13, 4 * H, 'template.approved', 'Super Admin', 'Approved a template sample · SE passport front', { firm_id: null, target_type: 'template', target_id: 'tpl0se0passfr0x', outcome: 'ok' }),
        ev(14, 29 * H, 'ip.auto_banned', 'system', 'Blocked sign-ins from 198.51.100.99 after repeated failed attempts', { firm_id: null, actor_type: 'system', ip: '198.51.100.99', outcome: 'error' }),
      )
      const sp = url.searchParams
      if (sp.get('category')) items = items.filter((e) => e.category === sp.get('category'))
      const q = sp.get('q')?.toLowerCase()
      if (q) items = items.filter((e) => `${e.actor} ${e.summary}`.toLowerCase().includes(q))
      items.sort((a, b) => b.at.localeCompare(a.at))
      return send(res, 200, { items, next_before: null, recording: true })
    }
    // Templates (the EC2 relay's routes); anyone may read approved ones.
    if (path === '/templates' && m === 'GET') {
      const status = role === 'super' ? url.searchParams.get('status') : 'active'
      const items = templates.filter(
        (t) =>
          (!url.searchParams.get('country') || t.country === url.searchParams.get('country').toUpperCase()) &&
          (!url.searchParams.get('doc_type') || t.doc_type === url.searchParams.get('doc_type')) &&
          (!status || t.status === status),
      )
      return send(res, 200, { items: items.map(publicTemplate), slots: SLOTS })
    }
    const tm = path.match(/^\/templates\/([a-z0-9]+)(\/image|\/boxes|\/approve)?$/)
    if (tm) {
      const t = templates.find((x) => x.id === tm[1])
      if (!t) return send(res, 404, { detail: 'Template not found' })
      if (tm[2] === '/image') {
        res.writeHead(200, { 'content-type': 'image/svg+xml' })
        return res.end(cardSvg(t.doc_type.toUpperCase(), t.colour, url.searchParams.get('kind') !== 'original'))
      }
      if (m === 'GET') return send(res, 200, publicTemplate(t))
      if (role !== 'super') return send(res, 403, { detail: 'Super-admin access required' })
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : {}
        if (tm[2] === '/boxes') t.boxes = body.boxes
        else if (tm[2] === '/approve') {
          const same = templates.filter((x) => x.status === 'active' && x.country === t.country && x.doc_type === t.doc_type && x.side === t.side)
          if (body.replace_id) {
            const old = same.find((x) => x.id === body.replace_id)
            if (!old) return send(res, 400, { detail: 'the sample to replace must be an approved sample of the same design and side' })
            templates.splice(templates.indexOf(old), 1)
          } else if (same.length >= SLOTS) {
            return send(res, 409, { detail: `all ${SLOTS} slots for this design side are full -- choose a sample to replace` })
          }
          Object.assign(t, { status: 'active', approved_at: new Date().toISOString(), approved_by: 'Back office', label: body.label ?? t.label, has_original: false })
        }
        else if (m === 'PATCH') t.label = body.label
        else if (m === 'DELETE') templates.splice(templates.indexOf(t), 1)
        send(res, 200, m === 'DELETE' ? { ok: true } : publicTemplate(t))
      })
      return
    }
    if (/^\/templates\/backfill\/\d+$/.test(path) && m === 'POST') {
      if (role !== 'super') return send(res, 403, { detail: 'Super-admin access required' })
      return send(res, 200, { ok: true, ts: 'sample', status: 'queued' })
    }
    if (path === '/ip-bans') return send(res, 200, { items: { '203.0.113.7': iso(3_600_000) } })
    // Any other write (delete, restore, create, rotate, revoke): accepted, no effect.
    if (m !== 'GET') return send(res, 200, { ok: true, api_key: 'sample_key_not_real', user: { id: 99 } })
    return send(res, 404, { detail: 'Not Found' })
  })
  .listen(Number(process.env.SAMPLE_API_PORT || 5099), '127.0.0.1', () =>
    console.log(`sample API on http://127.0.0.1:${process.env.SAMPLE_API_PORT || 5099}`),
  )
