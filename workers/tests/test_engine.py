from engine.confidence import PropInput, compute_confidence, is_ev_alert, projection_prob
from engine.odds_math import BookPrice, consensus_line, devig_pair, expected_value, market_fair_prob

HOT = [31, 28, 22, 27, 30, 25, 19, 29, 33, 26, 21, 24, 28, 30, 18, 27, 25, 29, 31, 23]


def test_devig_sums_to_one():
    o, u = devig_pair(1.87, 1.95)
    assert abs(o + u - 1) < 1e-9 and o > u


def test_over_hot_player_high_confidence():
    r = compute_confidence(PropInput(24.5, "over", HOT, [29, 26, 31], 1.08, 0.54, 1.95))
    assert r.confidence >= 60
    assert r.ev is not None and r.ev > 0
    assert r.hits["l10"] == (8, 10)


def test_under_is_mirror():
    over = compute_confidence(PropInput(24.5, "over", HOT, dvp_factor=1.08))
    under = compute_confidence(PropInput(24.5, "under", HOT, dvp_factor=1.08))
    assert over.confidence > 50 > under.confidence


def test_small_sample_is_shrunk():
    r = compute_confidence(PropInput(10.5, "over", [15, 14, 16], market_prob=0.5))
    assert r.confidence < 75  # 3/3 não vira 100%


def test_no_data_is_neutral():
    assert compute_confidence(PropInput(1.5, "over", [])).confidence == 50


def test_poisson_projection_integer_line_push():
    p_over = projection_prob(2.0, 1.4, 2.0, "over")
    p_under = projection_prob(2.0, 1.4, 2.0, "under")
    assert abs(p_over + p_under - 1) < 1e-9


def test_market_helpers_and_alert():
    prices = [
        BookPrice("pinnacle", 24.5, 1.90, 1.95, True),
        BookPrice("bet365", 24.5, 2.05, 1.75),
        BookPrice("betano", 23.5, 1.80, 2.00),
    ]
    assert consensus_line(prices) == 24.5
    fair = market_fair_prob(prices, 24.5, "over")
    assert abs(fair - devig_pair(1.90, 1.95)[0]) < 1e-9
    r = compute_confidence(PropInput(24.5, "over", HOT, [29, 26, 31], 1.08, fair, 2.05))
    assert expected_value(fair, 2.05) > 0
    assert is_ev_alert(r, 2.05)
