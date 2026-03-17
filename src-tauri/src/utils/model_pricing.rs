use std::collections::HashMap;
use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

/// Per-model token pricing in USD per **million** tokens.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelPricing {
    /// Cost per 1M input tokens.
    pub input_per_m_tok: f64,
    /// Cost per 1M output tokens.
    pub output_per_m_tok: f64,
    /// Cost per 1M cache-write tokens (5-minute TTL default).
    pub cache_write_per_m_tok: f64,
    /// Cost per 1M cache-read tokens (hits & refreshes).
    pub cache_read_per_m_tok: f64,
}

/// Static pricing table keyed by short model name (e.g. `"opus-4.6"`).
pub static PRICING_TABLE: LazyLock<HashMap<&'static str, ModelPricing>> = LazyLock::new(|| {
    let mut m = HashMap::new();

    // ── Opus family ──────────────────────────────────────────────────
    m.insert("opus-4.6", ModelPricing {
        input_per_m_tok: 5.0,
        output_per_m_tok: 25.0,
        cache_write_per_m_tok: 6.25,
        cache_read_per_m_tok: 0.50,
    });
    m.insert("opus-4.5", ModelPricing {
        input_per_m_tok: 5.0,
        output_per_m_tok: 25.0,
        cache_write_per_m_tok: 6.25,
        cache_read_per_m_tok: 0.50,
    });
    m.insert("opus-4.1", ModelPricing {
        input_per_m_tok: 15.0,
        output_per_m_tok: 75.0,
        cache_write_per_m_tok: 18.75,
        cache_read_per_m_tok: 1.50,
    });
    m.insert("opus-4", ModelPricing {
        input_per_m_tok: 15.0,
        output_per_m_tok: 75.0,
        cache_write_per_m_tok: 18.75,
        cache_read_per_m_tok: 1.50,
    });
    m.insert("opus-3", ModelPricing {
        input_per_m_tok: 15.0,
        output_per_m_tok: 75.0,
        cache_write_per_m_tok: 18.75,
        cache_read_per_m_tok: 1.50,
    });

    // ── Sonnet family ────────────────────────────────────────────────
    m.insert("sonnet-4.5", ModelPricing {
        input_per_m_tok: 3.0,
        output_per_m_tok: 15.0,
        cache_write_per_m_tok: 3.75,
        cache_read_per_m_tok: 0.30,
    });
    m.insert("sonnet-4", ModelPricing {
        input_per_m_tok: 3.0,
        output_per_m_tok: 15.0,
        cache_write_per_m_tok: 3.75,
        cache_read_per_m_tok: 0.30,
    });
    m.insert("sonnet-3.7", ModelPricing {
        input_per_m_tok: 3.0,
        output_per_m_tok: 15.0,
        cache_write_per_m_tok: 3.75,
        cache_read_per_m_tok: 0.30,
    });

    // ── Haiku family ─────────────────────────────────────────────────
    m.insert("haiku-4.5", ModelPricing {
        input_per_m_tok: 1.0,
        output_per_m_tok: 5.0,
        cache_write_per_m_tok: 1.25,
        cache_read_per_m_tok: 0.10,
    });
    m.insert("haiku-3.5", ModelPricing {
        input_per_m_tok: 0.80,
        output_per_m_tok: 4.0,
        cache_write_per_m_tok: 1.00,
        cache_read_per_m_tok: 0.08,
    });
    m.insert("haiku-3", ModelPricing {
        input_per_m_tok: 0.25,
        output_per_m_tok: 1.25,
        cache_write_per_m_tok: 0.30,
        cache_read_per_m_tok: 0.025,
    });

    m
});

/// Regex used by [`model_id_to_key`] to parse full model identifiers.
static MODEL_ID_RE: LazyLock<Regex> = LazyLock::new(|| {
    // Matches e.g. "claude-opus-4-5-20251101" or "claude-sonnet-4-20250514"
    Regex::new(r"claude-(\w+)-([\d]+(?:-[\d]+)?)-\d{8}").expect("invalid model-id regex")
});

/// Default fallback pricing (Sonnet 4).
fn default_pricing() -> &'static ModelPricing {
    PRICING_TABLE
        .get("sonnet-4")
        .expect("sonnet-4 must be present in the pricing table")
}

/// Extract a short model key from a full model identifier.
///
/// # Examples
/// ```
/// # use pericode::utils::model_pricing::model_id_to_key;
/// assert_eq!(model_id_to_key("claude-opus-4-5-20251101"), "opus-4.5");
/// assert_eq!(model_id_to_key("claude-sonnet-4-20250514"), "sonnet-4");
/// assert_eq!(model_id_to_key("opus-4.6"), "opus-4.6");
/// ```
pub fn model_id_to_key(model_id: &str) -> String {
    if let Some(caps) = MODEL_ID_RE.captures(model_id) {
        let family = &caps[1];
        let version = caps[2].replace('-', ".");
        format!("{family}-{version}")
    } else {
        // Fallback: strip the "claude-" prefix if present.
        model_id
            .strip_prefix("claude-")
            .unwrap_or(model_id)
            .to_string()
    }
}

/// Look up pricing for a model, falling back to Sonnet 4 pricing.
pub fn get_pricing(model_id: &str) -> &'static ModelPricing {
    let key = model_id_to_key(model_id);
    PRICING_TABLE.get(key.as_str()).unwrap_or_else(default_pricing)
}

/// Estimate the total cost in USD for a single API call.
pub fn estimate_cost(
    model_id: &str,
    input_tokens: u64,
    output_tokens: u64,
    cache_creation_input_tokens: u64,
    cache_read_input_tokens: u64,
) -> f64 {
    let p = get_pricing(model_id);
    let per_token: f64 = 1_000_000.0;

    (input_tokens as f64 / per_token) * p.input_per_m_tok
        + (output_tokens as f64 / per_token) * p.output_per_m_tok
        + (cache_creation_input_tokens as f64 / per_token) * p.cache_write_per_m_tok
        + (cache_read_input_tokens as f64 / per_token) * p.cache_read_per_m_tok
}

/// Return pricing info together with the resolved model key.
pub fn get_model_pricing(model_id: &str) -> (String, &'static ModelPricing) {
    let key = model_id_to_key(model_id);
    let pricing = PRICING_TABLE.get(key.as_str()).unwrap_or_else(default_pricing);
    (key, pricing)
}

/// Return a snapshot of the full pricing table.
pub fn get_all_pricings() -> &'static HashMap<&'static str, ModelPricing> {
    &PRICING_TABLE
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_id_to_key_full_id() {
        assert_eq!(model_id_to_key("claude-opus-4-5-20251101"), "opus-4.5");
        assert_eq!(model_id_to_key("claude-sonnet-4-20250514"), "sonnet-4");
        assert_eq!(model_id_to_key("claude-haiku-3-5-20241022"), "haiku-3.5");
    }

    #[test]
    fn model_id_to_key_short_id() {
        assert_eq!(model_id_to_key("claude-opus-4.6"), "opus-4.6");
        assert_eq!(model_id_to_key("opus-4.6"), "opus-4.6");
    }

    #[test]
    fn estimate_cost_basic() {
        // 1M input + 1M output on sonnet-4 => $3 + $15 = $18
        let cost = estimate_cost("claude-sonnet-4-20250514", 1_000_000, 1_000_000, 0, 0);
        assert!((cost - 18.0).abs() < 1e-9);
    }

    #[test]
    fn estimate_cost_with_caching() {
        // 500k input + 200k output + 100k cache-write + 300k cache-read on opus-4.6
        let cost = estimate_cost("claude-opus-4-6-20260101", 500_000, 200_000, 100_000, 300_000);
        let expected = (0.5 * 5.0) + (0.2 * 25.0) + (0.1 * 6.25) + (0.3 * 0.50);
        assert!((cost - expected).abs() < 1e-9);
    }

    #[test]
    fn unknown_model_falls_back_to_sonnet4() {
        let pricing = get_pricing("claude-mystery-99-20260101");
        let sonnet4 = PRICING_TABLE.get("sonnet-4").unwrap();
        assert_eq!(pricing.input_per_m_tok, sonnet4.input_per_m_tok);
        assert_eq!(pricing.output_per_m_tok, sonnet4.output_per_m_tok);
    }

    #[test]
    fn all_pricings_has_expected_count() {
        // 5 opus + 3 sonnet + 3 haiku = 11
        assert_eq!(get_all_pricings().len(), 11);
    }
}
