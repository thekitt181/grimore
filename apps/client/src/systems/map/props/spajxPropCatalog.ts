/**
 * Storage Chests and Treasure Boxes: 50 3D Models by spajx123c (itch.io).
 * Personal End Product; do not redistribute the models.
 * https://spajx123c.itch.io/storage-chests-treasure-boxes-50-3d-models
 */
import type { PropArt } from './propArt';

const T = '/props/spajx';
const M = '/props3d/spajx';

const STEMS = [
  '001_oak_ironbound_chest',
  '002_pine_rope_chest',
  '003_walnut_blanket_chest',
  '004_cedar_slatted_chest',
  '005_birch_travel_trunk',
  '006_carved_floral_coffer',
  '007_painted_coastal_chest',
  '008_log_cabin_chest',
  '009_woven_rattan_chest',
  '010_dark_merchant_chest',
  '011_riveted_steel_trunk',
  '012_aluminum_expedition_case',
  '013_copper_domed_chest',
  '014_brass_instrument_chest',
  '015_galvanized_farm_chest',
  '016_industrial_tool_chest',
  '017_vintage_steamer_trunk',
  '018_military_footlocker',
  '019_leather_campaign_trunk',
  '020_fireproof_strongbox',
  '021_stone_reliquary_chest',
  '022_gothic_iron_coffer',
  '023_dwarven_geometric_chest',
  '024_elven_leaf_chest',
  '025_desert_mosaic_chest',
  '026_nordic_rune_coffer',
  '027_crystal_inlaid_chest',
  '028_obsidian_treasury_chest',
  '029_ceramic_temple_chest',
  '030_bone_inlaid_coffer',
  '031_rescue_equipment_chest',
  '032_space_cargo_chest',
  '033_polar_research_chest',
  '034_underwater_storage_chest',
  '035_solar_outpost_chest',
  '036_medical_supply_chest',
  '037_reactor_service_chest',
  '038_mining_sample_chest',
  '039_modular_transit_chest',
  '040_carbon_fiber_vault',
  '041_bamboo_garden_chest',
  '042_red_lacquer_chest',
  '043_marquetry_heirloom_chest',
  '044_seaside_driftwood_chest',
  '045_quilted_leather_chest',
  '046_art_deco_coffer',
  '047_concrete_urban_chest',
  '048_recycled_plastic_chest',
  '049_terracotta_storage_chest',
  '050_cork_paneled_chest',
] as const;

function prettyName(stem: string): string {
  const raw = stem.replace(/^\d+_/, '').replace(/_/g, ' ');
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export const SPAJX_PROP_ART: PropArt[] = STEMS.map((stem) => {
  const pretty = prettyName(stem);
  return {
    id: `spajx-${stem.replace(/^\d+_/, '').replace(/_/g, '-')}`,
    name: pretty,
    short: pretty.replace(/ (chest|coffer|trunk|case|vault|strongbox|footlocker)$/i, ''),
    motion: 'toggle',
    play: 'lift',
    rest: `${T}/${stem}.png`,
    open: `${T}/${stem}_open.png`,
  };
});

export const SPAJX_PROP_MODELS: Record<string, { url: string; sizeBias?: number; hingeLid?: boolean }> =
  Object.fromEntries(
    SPAJX_PROP_ART.map((art, i) => [
      art.id,
      { url: `${M}/${STEMS[i]}.glb`, sizeBias: 0.95, hingeLid: true },
    ]),
  );

export const SPAJX_CREDIT =
  '50 3D chests by spajx123c (itch.io) · personal use, not redistributed';
