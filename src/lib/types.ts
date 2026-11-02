import type { WeatherSample } from "@shared/domain/weather.ts";
import type { ReviewState, Tier } from "@shared/domain/tiers.ts";

export type Role = "viewer" | "member" | "admin" | "owner";
export type Geometry = GeoJSON.Geometry;

export interface Organization {
  id: string;
  name: string;
  timezone: string;
  probable_threshold: number;
  created_at: string;
}

export interface Membership {
  org_id: string;
  user_id: string;
  role: Role;
  organizations: Organization;
}

export interface Member {
  user_id: string;
  role: Role;
  display_name: string;
  email: string;
  joined_at: string;
}

export interface HuntingArea {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  color: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  area_m2: number | null;
  created_at: string;
}

export type MapFeatureKind = "stand" | "feeding_station" | "salt_lick" | "marker" | "path" | "zone" | "parking" | "drag_route";

export interface MapFeature {
  id: string;
  org_id: string;
  area_id: string | null;
  kind: MapFeatureKind;
  name: string;
  notes: string | null;
  geometry: Geometry;
  properties: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
}

export interface Camera {
  id: string;
  org_id: string;
  area_id: string | null;
  name: string;
  model: string | null;
  serial: string | null;
  lat: number | null;
  lon: number | null;
  heading_deg: number | null;
  notes: string | null;
  active: boolean;
  offline_after_hours: number;
  last_seen_at: string | null;
  last_battery_pct: number | null;
  ingest_token_prefix: string | null;
  created_at: string;
}

export type ImageStatus = "pending" | "processing" | "analyzed" | "needs_review" | "failed" | "duplicate";

export interface CameraImage {
  id: string;
  org_id: string;
  camera_id: string | null;
  storage_path: string;
  sha256: string;
  phash: string | null;
  width: number | null;
  height: number | null;
  captured_at: string | null;
  captured_at_source: "exif" | "camera" | "upload" | "manual" | null;
  uploaded_at: string;
  uploaded_by: string | null;
  source: "upload" | "ingest";
  status: ImageStatus;
  duplicate_of: string | null;
  thumb_path: string | null;
  gps_lat: number | null;
  gps_lon: number | null;
  has_animals: boolean | null;
  analysis_provider: string | null;
  analysis_model: string | null;
  analysis_error: string | null;
  analyzed_at: string | null;
  weather: WeatherSample | null;
}

export interface Detection {
  id: string;
  org_id: string;
  image_id: string;
  species_code: string;
  count: number | null;
  confidence: number | null;
  bbox: [number, number, number, number] | null;
  source: "ai" | "manual";
  provider: string | null;
  model: string | null;
  ai_species_code: string | null;
  review: ReviewState;
  reviewed_by: string | null;
  reviewed_at: string | null;
  notes: string | null;
  tier: Tier;
  camera_id: string | null;
  captured_at: string | null;
}

export type ObservationKind = "sighting" | "track" | "scat" | "sound" | "bed" | "browsing" | "carcass" | "other";

export interface Observation {
  id: string;
  org_id: string;
  session_id: string | null;
  area_id: string | null;
  species_code: string;
  kind: ObservationKind;
  count: number | null;
  observed_at: string;
  lat: number | null;
  lon: number | null;
  accuracy_m: number | null;
  notes: string | null;
  photo_paths: string[];
  weather: WeatherSample | null;
  created_by: string | null;
  created_at: string;
}

export interface HuntSession {
  id: string;
  org_id: string;
  area_id: string | null;
  title: string;
  hunt_type: string | null;
  started_at: string;
  ended_at: string | null;
  lat: number | null;
  lon: number | null;
  notes: string | null;
  weather: WeatherSample | null;
  created_by: string | null;
  created_at: string;
}

export interface Participant {
  id: string;
  session_id: string;
  org_id: string;
  user_id: string | null;
  guest_name: string | null;
  role: string | null;
}

export interface Harvest {
  id: string;
  org_id: string;
  session_id: string | null;
  species_code: string;
  sex: "male" | "female" | "unknown";
  age_class: "juvenile" | "yearling" | "adult" | "unknown";
  weight_kg: number | null;
  antler_points: number | null;
  harvested_at: string;
  lat: number | null;
  lon: number | null;
  shooter_user_id: string | null;
  shooter_name: string | null;
  notes: string | null;
  photo_paths: string[];
  created_by: string | null;
}

export interface NotificationRow {
  id: string;
  event: string;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationRuleRow {
  id: string;
  org_id: string;
  user_id: string;
  name: string;
  event: "detection" | "species_detected" | "camera_offline" | "observation_created" | "harvest_created" | "daily_summary";
  species_codes: string[];
  camera_ids: string[];
  min_tier: "uncertain" | "probable" | "confirmed";
  channels: ("in_app" | "email" | "push")[];
  enabled: boolean;
}

export interface AuditEvent {
  id: number;
  actor_id: string | null;
  action: "insert" | "update" | "delete";
  entity: string;
  entity_id: string | null;
  changes: { label?: string; fields?: string[] };
  at: string;
}
