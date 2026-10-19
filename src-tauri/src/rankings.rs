use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

use crate::config;

/// Hoeveel dagen historie per zoekterm bewaard blijft.
const MAX_DAYS: usize = 400;
/// Bovengrens voor het aantal gevolgde zoektermen.
const MAX_TRACKED: usize = 200;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RankPoint {
    pub date: String,
    pub position: f64,
}

/// Wat de frontend aanlevert bij het vastleggen van posities.
#[derive(Debug, Deserialize)]
pub struct RankPayload {
    pub keyword: String,
    pub date: String,
    pub position: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct RankingStore {
    /// Gevolgde zoektermen, in de volgorde waarin ze zijn toegevoegd.
    #[serde(default)]
    pub tracked: Vec<String>,
    /// Positie per dag per zoekterm, oud → nieuw.
    #[serde(default)]
    pub history: HashMap<String, Vec<RankPoint>>,
}

fn store_path() -> Option<PathBuf> {
    config::config_dir().map(|dir| dir.join("rankings.json"))
}

pub fn load() -> RankingStore {
    let Some(path) = store_path() else {
        return RankingStore::default();
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(store: &RankingStore) -> Result<(), String> {
    let Some(path) = store_path() else {
        return Err("Kon configuratiemap niet bepalen".into());
    };
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Kon configuratiemap niet aanmaken: {e}"))?;
    }
    let text = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| format!("Kon posities niet opslaan: {e}"))
}

fn clean(keyword: &str) -> String {
    keyword.trim().to_lowercase()
}

impl RankingStore {
    pub fn track(&mut self, keyword: &str) -> Result<(), String> {
        let keyword = clean(keyword);
        if keyword.is_empty() {
            return Err("Zoekterm is leeg".into());
        }
        if self.tracked.contains(&keyword) {
            return Ok(());
        }
        if self.tracked.len() >= MAX_TRACKED {
            return Err(format!("Maximaal {MAX_TRACKED} zoektermen volgen"));
        }
        self.tracked.push(keyword);
        Ok(())
    }

    pub fn untrack(&mut self, keyword: &str) {
        let keyword = clean(keyword);
        self.tracked.retain(|item| item != &keyword);
        self.history.remove(&keyword);
    }

    /// Voegt posities toe of werkt ze bij (per zoekterm op datum) en houdt de lijst gesorteerd.
    pub fn record(&mut self, points: Vec<RankPayload>) {
        for point in points {
            let keyword = clean(&point.keyword);
            if !self.tracked.contains(&keyword) || !point.position.is_finite() {
                continue;
            }
            let entry = self.history.entry(keyword).or_default();
            match entry.iter_mut().find(|existing| existing.date == point.date) {
                Some(existing) => existing.position = point.position,
                None => entry.push(RankPoint { date: point.date, position: point.position }),
            }
        }
        for points in self.history.values_mut() {
            points.sort_by(|a, b| a.date.cmp(&b.date));
            if points.len() > MAX_DAYS {
                let excess = points.len() - MAX_DAYS;
                points.drain(0..excess);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(keyword: &str, date: &str, position: f64) -> RankPayload {
        RankPayload { keyword: keyword.into(), date: date.into(), position }
    }

    #[test]
    fn volgt_en_onthoudt_alleen_gevolgde_zoektermen() {
        let mut store = RankingStore::default();
        store.track("Dukmes Titanium").unwrap();
        store.record(vec![
            point("dukmes titanium", "2026-10-01", 12.0),
            point("niet gevolgd", "2026-10-01", 3.0),
        ]);
        assert_eq!(store.tracked, vec!["dukmes titanium".to_string()]);
        assert!(store.history.contains_key("dukmes titanium"));
        assert!(!store.history.contains_key("niet gevolgd"));
    }

    #[test]
    fn werkt_bestaande_dag_bij_in_plaats_van_dubbel() {
        let mut store = RankingStore::default();
        store.track("duiklamp").unwrap();
        store.record(vec![point("duiklamp", "2026-10-02", 9.0)]);
        store.record(vec![
            point("duiklamp", "2026-10-01", 11.0),
            point("duiklamp", "2026-10-02", 7.5),
        ]);
        let history = store.history.get("duiklamp").unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].date, "2026-10-01");
        assert_eq!(history[1].position, 7.5);
    }

    #[test]
    fn lege_zoekterm_wordt_geweigerd() {
        let mut store = RankingStore::default();
        assert!(store.track("   ").is_err());
    }
}
