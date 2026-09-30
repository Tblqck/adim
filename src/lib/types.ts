/**
 * Shapes returned by the live admin API (development/api/production/api/
 * routers/admin.py). Loose on purpose: rows come straight from the database
 * and older rows lack newer columns, so every field a page reads is optional.
 */

export interface Me {
  super_admin: boolean
  display_name?: string | null
  firm_id?: number
  firm_slug?: string
  firm_name?: string | null
  is_head_admin?: boolean
  can_create_users?: boolean
}

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface ExtractedIdData {
  full_name?: string
  field_sources?: Record<string, string>
  [key: string]: unknown
}

export interface VerificationRow {
  id: number
  created_at?: string
  deleted_at?: string | null
  country?: string | null
  doc_type?: string | null
  user_ref?: string | null
  firm_id?: number | null
  /** 1 = ID + selfie, 2 = ID + holding photo, 3 = ID + liveness frames. */
  verification_mode?: number | null
  verified?: boolean | null
  overall_verdict?: string | null
  confidence_score?: number | null
  reviewed?: boolean
  reviewed_by?: string | null
  extracted_id_data?: ExtractedIdData[] | null
}

export interface MrzSide {
  parsed?: boolean
  ok?: boolean
  format?: string
  document_number?: string
  date_of_birth?: string
  date_of_birth_normalized?: string
  surname?: string
  given_names?: string
  expiry_date?: string
  expiry_date_normalized?: string
  nationality?: string
  sex?: string
  checksum_valid?: Record<string, boolean>
}

export interface ForensicsResult {
  verdict?: string
  error?: string
  exif_present?: boolean
  camera_make?: string
  camera_model?: string
  datetime_original?: string
  software_tag?: string
  gps_present?: boolean
  ela_score?: number
  editing_software_detected?: boolean
  resave_detected?: boolean
  ela_heatmap_b64?: string
  risk_flags?: string[]
}

export interface DatabaseEntry {
  name: string
  agency: string
  region: string
  added: string
  category?: 'pep' | 'sanctions' | 'adverse_media'
  status?: 'HIT' | 'CLEAR' | 'UNAVAILABLE' | string
}

export interface ScreeningMatch {
  name: string
  score?: number
  topics?: string[]
  datasets?: string[]
  program_ids?: string[]
  source_urls?: string[]
  wikipedia_url?: string
  notes?: string
  country?: string
  position?: string
  birth_date?: string
  jurisdiction?: string
  entity_type?: string
  status?: string
  registration_number?: string
  incorporation_date?: string
  website?: string
  address?: string
}

export interface ScreeningResult {
  subject_name?: string
  risk_classification?: 'CLEAN' | 'POTENTIAL_MATCH' | string
  banner?: string
  match_confidence?: number
  summary?: string
  error?: string
  matches?: ScreeningMatch[]
  databases_checked?: DatabaseEntry[]
}

/** One side's comparison with the approved templates (AI server templates_engine/match.py). */
export interface TemplateMatchSide {
  side: string
  status: 'compared' | 'no_templates' | 'insufficient' | 'no_card' | 'error'
  verdict: 'strong_match' | 'likely_match' | 'weak_match' | 'no_match' | null
  score?: number
  components?: { orientation: number; structure: number; colour: number | null; layout: number | null }
  compared_fraction?: number
  turned_180?: boolean
  lighting?: { brightness: number; glare_fraction: number; shadow_fraction: number; colour_cast: number }
  templates_checked?: number
  /** How many of the design's approved samples this card matches (likely or strong). */
  samples_agreeing?: number
  template_id?: string
  template_label?: string | null
  card_frame?: string | null
  template_frame?: string | null
  draft?: { created: boolean; template_id?: string; why?: string }
  error?: string
}

/** A document-design template on the AI server (templates_engine/store.py). */
export interface DesignTemplate {
  id: string
  country: string
  doc_type: string
  side: string
  status: 'draft' | 'active'
  label: string | null
  reason: string | null
  width: number
  height: number
  boxes: TemplateBox[]
  source: string | null
  created_at: string
  updated_at: string
  approved_at: string | null
  approved_by: string | null
  match_count: number
  last_matched: string | null
  has_original: boolean
}

export interface TemplateBox {
  kind: 'face' | 'text' | 'mrz' | 'barcode' | 'signature' | 'manual'
  x: number
  y: number
  w: number
  h: number
  note?: string
}

export interface VerificationDetail extends VerificationRow {
  images?: { id_front_url?: string; id_back_url?: string; face_urls?: string[] }
  corrected_fields?: Record<string, string> | null
  verdict_overrides?: Record<string, string> | null
  pipeline_response?: {
    ocr_fields?: Record<string, string>
    mrz_by_side?: {
      front?: MrzSide | null
      back?: MrzSide | null
      claude_reread?: MrzSide | null
      expected_side?: string
    }
    template_match?: Record<string, TemplateMatchSide> | null
  } | null
  face_match_score?: number | null
  face_match_verdict?: string | null
  liveness_score?: number | null
  liveness_verdict?: string | null
  liveness_method?: string | null
  document_match_score?: number | null
  document_match_verdict?: string | null
  mrz_verdict?: string | null
  ocr_word_count?: number | null
  forensics_result?: ForensicsResult | null
  pep_result?: ScreeningResult | null
}

export interface Firm {
  id: number
  name: string
  slug?: string
  active?: boolean
  deleted_at?: string | null
  created_at?: string
}

export interface FirmUser {
  id: number
  username: string
  display_name: string
  can_create_users: boolean
  active: boolean
  created_at?: string
  deleted_at?: string | null
}

export interface LinkSession {
  id: number
  created_at?: string
  user_ref?: string | null
  status?: string
  opened_at?: string | null
  expires_at: string
  deleted_at?: string | null
  firm_id?: number
}

export interface DatabasesCatalog {
  pep: DatabaseEntry[]
  sanctions: DatabaseEntry[]
  adverse_media: DatabaseEntry[]
}

/** One row of GET /audit (production/audit_log.py). */
export type AuditCategory = 'access' | 'verifications' | 'links' | 'screening' | 'account' | 'templates' | 'security'

export interface AuditEvent {
  id: string
  at: string
  action: string
  category: AuditCategory
  actor: string | null
  actor_type: 'user' | 'applicant' | 'system'
  firm_id: number | null
  target_type: string | null
  target_id: string | null
  summary: string | null
  outcome: 'ok' | 'warning' | 'error' | null
  ip: string | null
  detail: Record<string, unknown> | null
  /** false = read from another table (a screen, a received verification, …), which may not know who did it. */
  recorded: boolean
}

export interface AuditPage {
  items: AuditEvent[]
  next_before: string | null
  /** Whether the server's audit_events table exists (sign-ins, reviews, account changes). */
  recording: boolean
}
